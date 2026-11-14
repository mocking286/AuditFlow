(() => {
  "use strict";

  const link = document.querySelector(".jiraflow-link");
  if (!link) return;

  const embedded = () =>
    new URLSearchParams(window.location.search).get("embedded") === "1" &&
    window.parent !== window;

  const projectId = () =>
    window.AuditFlowProjectContext?.projectIdFromLocation?.() ||
    new URLSearchParams(window.location.search).get("project") ||
    "";
  const canProbeLocalServices = () => {
    const protocol = String(window.location.protocol || "").toLowerCase();
    if (protocol === "chrome-extension:") return true;
    try {
      const pageUrl = new URL(window.location.href);
      return pageUrl.protocol === "http:" &&
        ["127.0.0.1", "localhost", "::1"].includes(pageUrl.hostname);
    } catch (_) {
      return false;
    }
  };

  // Direct JiraFlow probing is only a fallback; the backend health document
  // advertises the dynamically allocated companion port.
  const JIRAFLOW_PORTS = Object.freeze([
    6195,
    4188,
    4194,
    4173,
    4273,
    4274,
    4275,
    4276,
    4277,
    4278,
    4279,
    4280,
    4281,
    4282
  ]);
  const PROBE_TIMEOUT_MS = 800;
  const RETRY_INITIAL_MS = 1500;
  const RETRY_MAX_MS = 30000;
  const HEALTHY_RECHECK_MS = 5000;
  const CONTEXT_RETRY_MS = 1200;
  const CONTEXT_RETRY_LIMIT = 5;
  const DEFAULT_BACKEND_URL = "http://127.0.0.1:4173";
  const EXTENSION_BACKEND_PORTS = Object.freeze([4173, 4176, 4180]);
  const BACKEND_HEALTH_PATHS = Object.freeze(["/api/health", "/health"]);

  let bridgeState = null;
  let discoveredState = null;
  let probeInFlight = null;
  let confirmedPort = 0;
  let retryTimer = 0;
  let contextRetryTimer = 0;
  let retryDelay = RETRY_INITIAL_MS;
  let contextAttempts = 0;

  const normalizePort = value => {
    const port = Number(value);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
  };

  const loopbackUrl = port => `http://127.0.0.1:${port}/`;

  const controlledUrl = (value, portValue) => {
    const port = normalizePort(portValue);
    if (!port || !value) return null;
    try {
      const parsed = new URL(String(value));
      if (
        parsed.protocol !== "http:" ||
        parsed.hostname !== "127.0.0.1" ||
        parsed.port !== String(port) ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        parsed.pathname !== "/"
      ) return null;
      return parsed.href;
    } catch (_) {
      return null;
    }
  };

  const controlledProxyUrl = value => {
    if (!value) return null;
    try {
      const parsed = new URL(String(value), window.location.href);
      const localProxy = parsed.protocol === "http:" &&
        ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
      const sameOriginProxy = parsed.origin === window.location.origin &&
        ["http:", "https:"].includes(parsed.protocol);
      if (
        (!localProxy && !sameOriginProxy) ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        !/^\/jiraflow\/?$/.test(parsed.pathname)
      ) return null;
      parsed.pathname = "/jiraflow/";
      return parsed.href;
    } catch (_) {
      return null;
    }
  };

  const statusText = status => ({
    healthy: "JiraFlow 已就绪",
    starting: "JiraFlow 正在启动",
    degraded: "JiraFlow 暂不可用",
    unavailable: "JiraFlow 未连接",
    failed: "JiraFlow 启动失败"
  }[status] || "JiraFlow 状态未知");

  const statusTextEnglish = status => ({
    healthy: "JiraFlow is ready",
    starting: "JiraFlow is starting",
    degraded: "JiraFlow is temporarily unavailable",
    unavailable: "JiraFlow unavailable",
    failed: "JiraFlow failed to start"
  }[status] || "JiraFlow status unknown");

  const currentLanguageIsEnglish = () => {
    const root = document.documentElement;
    return Boolean(
      root &&
      (root.lang === "en" ||
        root.hasAttribute?.("data-auditflow-english-only"))
    );
  };

  const statePort = state => {
    const directPort = normalizePort(state?.upstreamPort);
    if (directPort) return directPort;
    if (state?.proxyHref) return 0;
    try {
      return normalizePort(new URL(state?.href || "").port);
    } catch (_) {
      return 0;
    }
  };

  const stateVersion = state => {
    const version = typeof state?.version === "string" ? state.version.trim() : "";
    return version ? `v${version.replace(/^v/i, "")}` : "";
  };

  const statusLabels = state => {
    const status = state?.status || "starting";
    const port = statePort(state);
    const version = stateVersion(state);
    const endpoint = [
      port ? `端口 ${port}` : "",
      version
    ].filter(Boolean).join(" · ");
    const endpointEnglish = [
      port ? `port ${port}` : "",
      version
    ].filter(Boolean).join(" · ");
    const zh = state?.ready && status === "healthy"
      ? [statusText(status), endpoint].filter(Boolean).join(" · ")
      : status === "starting"
        ? `${statusText(status)} · 正在检查本机服务`
        : status === "degraded"
          ? `${statusText(status)} · 服务响应异常`
          : status === "failed"
            ? `${statusText(status)} · 请检查后端服务`
            : `${statusText(status)} · 正在扫描本机服务`;
    const en = state?.ready && status === "healthy"
      ? [statusTextEnglish(status), endpointEnglish].filter(Boolean).join(" · ")
      : status === "starting"
        ? `${statusTextEnglish(status)} · discovering local service`
        : status === "degraded"
          ? `${statusTextEnglish(status)} · service response is unhealthy`
          : status === "failed"
            ? `${statusTextEnglish(status)} · check the backend service`
            : `${statusTextEnglish(status)} · discovering local service`;
    return {
      zh,
      en,
      ariaZh: `打开 JiraFlow · ${zh}`,
      ariaEn: `Open JiraFlow · ${en}`
    };
  };

  const normalizeState = state => {
    const value = state && typeof state === "object" ? state : {};
    const nested = value.jiraFlow && typeof value.jiraFlow === "object"
      ? value.jiraFlow
      : value;
    let status = String(
      nested.jiraFlowStatus ??
      nested.status ??
      "unavailable"
    ).toLowerCase();
    const directHref = controlledUrl(
      nested.jiraFlowBaseUri ?? nested.baseUri,
      nested.jiraFlowPort ?? nested.port
    );
    const proxyHref = controlledProxyUrl(
      nested.jiraFlowProxyBaseUri ?? nested.proxyBaseUri
    );
    const href = proxyHref || directHref;
    const ready = (nested.jiraFlowAvailable ?? nested.available) === true &&
      (nested.jiraFlowHealthy ?? nested.healthy) === true &&
      status === "healthy" &&
      Boolean(href);
    if (status === "healthy" && !ready) status = "unavailable";
    return {
      status,
      href: ready ? href : "",
      directHref: ready && directHref ? directHref : "",
      proxyHref: ready && proxyHref ? proxyHref : "",
      upstreamPort: normalizePort(nested.jiraFlowPort ?? nested.port),
      ready,
      version: typeof (nested.jiraFlowVersion ?? nested.version) === "string"
        ? (nested.jiraFlowVersion ?? nested.version)
        : ""
    };
  };

  const selectedState = () => {
    const bridge = bridgeState;
    const discovered = discoveredState;
    if (bridge?.ready) return { ...bridge, source: "bridge" };
    if (discovered?.ready) return { ...discovered, source: "probe" };
    if (bridge) return { ...bridge, source: "bridge" };
    if (discovered) return { ...discovered, source: "probe" };
    return { status: "starting", href: "", ready: false, source: "probe" };
  };

  const renderState = () => {
    const state = selectedState();
    const labels = statusLabels(state);
    const english = currentLanguageIsEnglish();
    link.dataset.jiraFlowStatus = state.status;
    link.dataset.jiraFlowHref = state.ready ? state.href : "";
    link.setAttribute("aria-disabled", String(!state.ready));
    link.setAttribute("data-tooltip-zh", labels.zh);
    link.setAttribute("data-tooltip-en", labels.en);
    link.setAttribute("data-aria-zh", labels.ariaZh);
    link.setAttribute("data-aria-en", labels.ariaEn);
    link.dataset.tooltip = english ? labels.en : labels.zh;
    link.title = link.dataset.tooltip;
    link.setAttribute("aria-label", english ? labels.ariaEn : labels.ariaZh);
    if (state.ready) {
      link.href = state.href;
      link.removeAttribute("tabindex");
    } else {
      link.href = "#";
      link.setAttribute("tabindex", "0");
    }
    return state;
  };

  const requestDesktopContext = () => {
    if (!embedded()) return;
    try {
      window.parent.postMessage({
        type: "auditflow-desktop-command",
        command: "request-context"
      }, window.location.origin);
    } catch (_) {
      // The standalone loopback probe remains available if a host blocks messaging.
    }
  };

  const scheduleContextRetry = () => {
    if (!embedded() || contextRetryTimer || contextAttempts >= CONTEXT_RETRY_LIMIT) return;
    contextRetryTimer = window.setTimeout(() => {
      contextRetryTimer = 0;
      if (!bridgeState && contextAttempts < CONTEXT_RETRY_LIMIT) {
        contextAttempts += 1;
        requestDesktopContext();
        scheduleContextRetry();
      }
    }, CONTEXT_RETRY_MS);
  };

  const probePort = async port => {
    if (!JIRAFLOW_PORTS.includes(port)) return null;
    return probeJiraFlow(loopbackUrl(port), port);
  };

  const readConfiguredBackendUrls = () => {
    const values = [];
    try {
      const pageUrl = new URL(window.location.href);
      if (
        (pageUrl.protocol === "https:" ||
          (pageUrl.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(pageUrl.hostname))) &&
        !pageUrl.username &&
        !pageUrl.password
      ) values.push(pageUrl.origin);
    } catch (_) {
      // Extension pages do not have a loopback origin.
    }
    if (canProbeLocalServices()) values.push(DEFAULT_BACKEND_URL);
    if (String(window.location.protocol || "").toLowerCase() === "chrome-extension:") {
      for (const port of EXTENSION_BACKEND_PORTS) values.push(loopbackUrl(port).slice(0, -1));
    }
    try {
      const storage = window.localStorage;
      const raw = storage?.getItem?.("auditflow-ai-workspace-v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        values.unshift(parsed?.settings?.backendUrl, parsed?.settings?.codexBridgeUrl);
      }
    } catch (_) {
      // A blocked or malformed localStorage entry must not disable fallback discovery.
    }
    return [...new Set(values.filter(value => typeof value === "string").map(value => value.trim()))];
  };

  const controlledBackendUrl = value => {
    if (!value) return null;
    try {
      const parsed = new URL(String(value));
      const sameOriginHttps = parsed.protocol === "https:" &&
        parsed.origin === window.location.origin;
      const loopbackHttp = canProbeLocalServices() &&
        parsed.protocol === "http:" &&
        ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
      if (
        (!sameOriginHttps && !loopbackHttp) ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        parsed.pathname !== "/"
      ) return null;
      return parsed.href;
    } catch (_) {
      return null;
    }
  };

  const fetchJson = async url => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await window.fetch(url, {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: controller.signal
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (_) {
      return null;
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const probeJiraFlow = async (baseUri, port) => {
    const payload = await fetchJson(`${baseUri}health`);
    if (
      !payload ||
      payload.status !== "ok" ||
      payload.service !== "JiraFlow" ||
      typeof payload.version !== "string" ||
      !/^2\.\d+\.\d+$/.test(payload.version)
    ) return null;
    return normalizeState({
      jiraFlowAvailable: true,
      jiraFlowHealthy: true,
      jiraFlowStatus: "healthy",
      ...(String(baseUri).includes("/jiraflow/")
        ? { jiraFlowProxyBaseUri: baseUri }
        : { jiraFlowBaseUri: baseUri }),
      jiraFlowPort: port,
      jiraFlowVersion: payload.version
    });
  };

  const probeBackend = async backendUrl => {
    const baseUri = controlledBackendUrl(backendUrl);
    if (!baseUri) return null;
    for (const healthPath of BACKEND_HEALTH_PATHS) {
      const payload = await fetchJson(`${baseUri}${healthPath.slice(1)}`);
      if (
        !payload ||
        !payload.jiraFlow ||
        typeof payload.jiraFlow !== "object"
      ) continue;
      const upstreamPort = normalizePort(payload.jiraFlow.port);
      const canUseHealthProxy = payload.jiraFlow.available === true &&
        payload.jiraFlow.healthy === true &&
        String(payload.jiraFlow.status || "").toLowerCase() === "healthy";
      if (canUseHealthProxy && !canProbeLocalServices()) {
        const sameOriginProxy = new URL("/jiraflow/", window.location.href).href;
        const verifiedProxy = await probeJiraFlow(sameOriginProxy, upstreamPort);
        if (verifiedProxy) {
          return { ...verifiedProxy, proxyHref: sameOriginProxy, href: sameOriginProxy, upstreamPort };
        }
      }
      const state = normalizeState(payload);
      if (!state.ready || !/^2\.\d+\.\d+$/.test(state.version)) continue;
      if (state.proxyHref) {
        const verifiedProxy = await probeJiraFlow(state.proxyHref, upstreamPort);
        if (verifiedProxy) return { ...verifiedProxy, proxyHref: state.proxyHref, href: state.proxyHref, upstreamPort };
      }
      if (state.directHref) {
        const verifiedDirect = await probeJiraFlow(state.directHref, upstreamPort);
        if (verifiedDirect) return verifiedDirect;
      }
    }
    return null;
  };

  const probeSameOriginProxy = async () => {
    if (canProbeLocalServices()) return null;
    try {
      const pageUrl = new URL(window.location.href);
      if (!["http:", "https:"].includes(pageUrl.protocol)) return null;
      const proxyUrl = controlledProxyUrl(new URL("/jiraflow/", pageUrl.origin).href);
      return proxyUrl ? await probeJiraFlow(proxyUrl, 0) : null;
    } catch (_) {
      return null;
    }
  };

  const discover = async () => {
    if (probeInFlight || document.visibilityState === "hidden") return probeInFlight;
    probeInFlight = (async () => {
      let found = await probeSameOriginProxy();
      if (found) {
        confirmedPort = found.upstreamPort || 0;
      } else {
        for (const backendUrl of readConfiguredBackendUrls()) {
          found = await probeBackend(backendUrl);
          if (found) {
            confirmedPort = found.upstreamPort || normalizePort(new URL(found.href).port);
            break;
          }
        }
      }

      if (!found && canProbeLocalServices()) {
        const candidates = confirmedPort
          ? [confirmedPort, ...JIRAFLOW_PORTS.filter(port => port !== confirmedPort)]
          : JIRAFLOW_PORTS;
        for (const port of candidates) {
          found = await probePort(port);
          if (found) {
            confirmedPort = port;
            break;
          }
        }
      }

      if (found) {
        discoveredState = found;
        retryDelay = RETRY_INITIAL_MS;
      } else {
        discoveredState = { status: "unavailable", href: "", ready: false, version: "" };
        confirmedPort = 0;
      }
      renderState();
      return found;
    })().finally(() => {
      probeInFlight = null;
      if (retryTimer) window.clearTimeout(retryTimer);
      const delay = discoveredState?.ready ? HEALTHY_RECHECK_MS : retryDelay;
      if (!discoveredState?.ready) retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
      retryTimer = window.setTimeout(() => {
        retryTimer = 0;
        discover();
      }, delay);
    });
    return probeInFlight;
  };

  const open = async event => {
    const state = renderState();
    if (!state.ready) {
      event.preventDefault();
      requestDesktopContext();
      discover();
      return;
    }
    const auditflowProject = projectId();
    if (auditflowProject && typeof window.AuditFlowEnsureJiraProject === "function") {
      event.preventDefault();
      const pendingTab = embedded() ? null : window.open("about:blank", "_blank");
      if (pendingTab) pendingTab.opener = null;
      try {
        const key = await window.AuditFlowEnsureJiraProject(auditflowProject);
        if (!key) { pendingTab?.close(); return; }
        if (embedded()) {
          window.parent.postMessage({
            type: "auditflow-desktop-command",
            command: "open-jiraflow",
            projectId: auditflowProject,
            projectKey: key
          }, window.location.origin);
        } else {
          const target = new URL(state.href);
          target.searchParams.set("project", key);
          if (pendingTab) pendingTab.location.replace(target.href);
          else window.location.assign(target.href);
        }
      } catch (_) {
        pendingTab?.close();
      }
      return;
    }
    if (embedded()) {
      event.preventDefault();
      window.parent.postMessage({
        type: "auditflow-desktop-command",
        command: "open-jiraflow",
        projectId: projectId()
      }, window.location.origin);
    }
  };

  link.addEventListener("click", open);
  window.addEventListener("message", event => {
    if (
      !embedded() ||
      event.source !== window.parent ||
      event.origin !== window.location.origin ||
      event.data?.type !== "auditflow-desktop-context"
    ) return;
    bridgeState = normalizeState(event.data.services);
    contextAttempts = CONTEXT_RETRY_LIMIT;
    if (contextRetryTimer) window.clearTimeout(contextRetryTimer);
    contextRetryTimer = 0;
    renderState();
  });
  window.addEventListener("hashchange", () => {
    link.dataset.jiraFlowProject = projectId();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") discover();
  });
  link.dataset.jiraFlowProject = projectId();

  renderState();
  if (embedded()) {
    requestDesktopContext();
    scheduleContextRetry();
  }
  discover();
})();
