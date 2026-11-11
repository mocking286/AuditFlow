(() => {
  "use strict";

  const APP_VERSION = "7.6.0";
  const REMOTE_ENDPOINT = "https://www.aspice-auditflow.cloud";
  const REMOTE_ENDPOINT_KEY = "auditflow-desktop-remote-endpoint";
  const authView = document.getElementById("authView");
  const appView = document.getElementById("appView");
  const authForm = document.getElementById("authForm");
  const authTitle = document.getElementById("authTitle");
  const authSubtitle = document.getElementById("authSubtitle");
  const authSubmit = document.getElementById("authSubmit");
  const authMessage = document.getElementById("authMessage");
  const loginTab = document.getElementById("loginTab");
  const registerTab = document.getElementById("registerTab");
  const localModeTab = document.getElementById("localModeTab");
  const cloudModeTab = document.getElementById("cloudModeTab");
  const accountModeTabs = document.getElementById("accountModeTabs");
  const localModeHint = document.getElementById("localModeHint");
  const consentRow = document.getElementById("consentRow");
  const remoteEndpointInput = document.getElementById("remoteEndpoint");
  const password = document.getElementById("password");
  const frame = document.getElementById("workbenchFrame");
  const feedbackModal = document.getElementById("feedbackModal");
  const toast = document.getElementById("toast");
  const backendStatus = document.getElementById("backendStatus");
  let mode = "login";
  let currentUser = null;
  let heartbeat = null;
  let serviceState = null;
  let remoteSession = null;
  let accessMode = "local";
  const normalizeProjectId = value => String(value || "").trim().slice(0, 191);
  const initialProjectId = () => normalizeProjectId(new URLSearchParams(window.location.search).get("project"));
  function normalizeRemoteEndpoint(value) {
    const raw = String(value || "").trim().replace(/\/+$/, "");
    const parsed = new URL(raw || REMOTE_ENDPOINT);
    const localHttp = parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
    if (parsed.protocol !== "https:" && !localHttp) throw new Error("协作服务器地址必须使用 HTTPS；本机测试可使用 localhost 或 127.0.0.1。");
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("协作服务器地址不能包含账户、查询参数或片段。");
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  }
  function projectIdFromWorkbench() {
    try {
      const match = String(frame.contentWindow?.location?.hash || "").match(/^#\/standard\/([^/?#]+)/);
      if (match) return normalizeProjectId(decodeURIComponent(match[1]));
    } catch (_) {}
    try {
      const source = new URL(frame.src, window.location.href);
      const match = source.hash.match(/^#\/standard\/([^/?#]+)/);
      if (match) return normalizeProjectId(decodeURIComponent(match[1]));
    } catch (_) {}
    return "";
  }
  function auditFlowUrl(projectId = "") {
    const id = normalizeProjectId(projectId);
    return id
      ? `./index.html?embedded=1&fromLanding=1#/standard/${encodeURIComponent(id)}`
      : "./index.html?embedded=1&fromLanding=1#/dashboard";
  }
  function showLanding() {
    currentUser = null;
    window.clearInterval(heartbeat);
    heartbeat = null;
    authView.hidden = true;
    appView.hidden = false;
    frame.title = `JEAuditFlow ${APP_VERSION} · ASPICE Audit Workbench`;
    frame.src = "./landing.html?embedded=1";
  }
  function fileAnalystUrl(projectId = "") {
    const params = new URLSearchParams({ desktop: "1" });
    const id = normalizeProjectId(projectId);
    if (id) params.set("project", id);
    return `./fileanalyst/?${params.toString()}#library`;
  }

  function lessonLearnUrl(projectId = "") {
    const params = new URLSearchParams({ desktop: "1" });
    const id = normalizeProjectId(projectId);
    if (id) params.set("project", id);
    return `./lessonlearn/?${params.toString()}`;
  }

  function controlledJiraFlowUrl(value, portValue) {
    const port = Number(portValue);
    if (!Number.isInteger(port) || port <= 0 || port > 65535 || !value) return null;
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
  }
  function setBackendStatus(state, detail = "") {
    if (!backendStatus) return;
    backendStatus.classList.toggle("online", state === "online");
    backendStatus.classList.toggle("offline", state === "offline");
    backendStatus.textContent = state === "online" ? "后端已连接" : state === "offline" ? "后端未连接" : "后端连接中";
    backendStatus.title = detail || (state === "online" ? "本地后端服务正常" : "FileAnalyst 和本地审核仍可离线使用");
  }
  async function refreshBackendStatus() {
    setBackendStatus("pending");
    try {
      const response = await fetch("./api/health", { cache: "no-store", signal: AbortSignal.timeout(2500) });
      const health = await response.json().catch(() => ({}));
      if (!response.ok || health.status !== "ok") throw new Error(health.error || `HTTP ${response.status}`);
      setBackendStatus("online", `${health.app || "JEAuditFlow"} ${health.version || ""}`.trim());
      const jiraFlow = health.jiraFlow && typeof health.jiraFlow === "object" ? health.jiraFlow : {};
      serviceState = {
        ...(serviceState || {}),
        backendHealthy: true,
        backendVersion: health.version || "",
        jiraFlowAvailable: jiraFlow.available === true,
        jiraFlowHealthy: jiraFlow.healthy === true,
        jiraFlowStatus: String(jiraFlow.status || "unavailable"),
        jiraFlowBaseUri: typeof jiraFlow.baseUri === "string" ? jiraFlow.baseUri : "",
        jiraFlowProxyBaseUri: typeof jiraFlow.proxyBaseUri === "string" ? jiraFlow.proxyBaseUri : "",
        jiraFlowPort: Number(jiraFlow.port) || 0,
        jiraFlowVersion: typeof jiraFlow.version === "string" ? jiraFlow.version : ""
      };
      postContext();
    } catch (error) {
      setBackendStatus("offline", `后端不可用：${error.message || "network error"}`);
      serviceState = { ...(serviceState || {}), backendHealthy: false };
      postContext();
    }
  }

  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    window.setTimeout(() => { toast.hidden = true; }, 3200);
  }

  async function api(pathname, options = {}) {
    const response = await fetch(pathname, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json", ...(options.headers || {}) },
      ...options
    });
    const payload = await response.json().catch(() => ({}));
    const data = payload && Object.prototype.hasOwnProperty.call(payload, "data") ? payload.data : payload;
    if (!response.ok) {
      const error = payload?.error ?? data?.error;
      const message = typeof error === "string" ? error : error?.message;
      throw new Error(message || `请求失败（${response.status}）`);
    }
    return data;
  }

  function setMode(nextMode) {
    mode = nextMode;
    const registering = mode === "register";
    loginTab.classList.toggle("active", !registering);
    registerTab.classList.toggle("active", registering);
    loginTab.setAttribute("aria-selected", String(!registering));
    registerTab.setAttribute("aria-selected", String(registering));
    authTitle.textContent = registering ? "注册邮箱账户" : "邮箱登录";
    authSubtitle.textContent = registering ? "注册完成后直接进入云端协作工作台。" : "登录后进入已配置的 6.8 云端协作服务器。";
    authSubmit.textContent = registering ? "注册并进入" : "登录";
    password.autocomplete = registering ? "new-password" : "current-password";
    consentRow.hidden = !registering;
    authMessage.textContent = "";
  }

  async function telemetry(event, page = location.pathname, details = {}) {
    if (!currentUser) return;
    try {
      await api("./api/telemetry", {
        method: "POST",
        body: JSON.stringify({ event, page, source: "desktop", appVersion: APP_VERSION, platform: navigator.platform, ...details })
      });
    } catch (_) {
      // Operational telemetry must never interrupt audit work.
    }
  }

  function postContext() {
    frame.contentWindow?.postMessage({
      type: "auditflow-desktop-context",
      embedded: true,
      localMode: accessMode === "local",
      version: APP_VERSION,
      // The workbench uses a stable identity for collaboration membership and
      // local workspace scoping. Older shells only forwarded email/role,
      // which left currentUserId empty after desktop login.
      user: currentUser ? {
        id: currentUser.id || currentUser.userId || `desktop-${String(currentUser.email || "user").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        userId: currentUser.userId || currentUser.id || `desktop-${String(currentUser.email || "user").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        email: currentUser.email,
        name: currentUser.name || currentUser.displayName || currentUser.email,
        displayName: currentUser.displayName || currentUser.name || currentUser.email,
        role: currentUser.role || currentUser.defaultRole || "user",
        isAdmin: currentUser.isAdmin === true || String(currentUser.role || "").toLowerCase() === "admin"
        ,localOnly: currentUser.localOnly === true
      } : null,
      remoteSession: remoteSession ? { endpoint: remoteSession.endpoint || REMOTE_ENDPOINT, sessionToken: remoteSession.sessionToken, user: remoteSession.user } : null,
      projectId: projectIdFromWorkbench(),
      services: serviceState
    }, "*");
  }

  function postDesktopCommand(command) {
    if (!globalThis.chrome?.webview?.postMessage) return false;
    globalThis.chrome.webview.postMessage({ type: "desktop-command", command });
    return true;
  }

  function enterApp(user) {
    currentUser = user;
    authView.hidden = true;
    appView.hidden = false;
    if (frame.src === "about:blank" || frame.src.includes("/landing.html")) frame.src = auditFlowUrl(initialProjectId());
    else postContext();
    telemetry("session.start");
    window.clearInterval(heartbeat);
    heartbeat = window.setInterval(() => {
      if (document.visibilityState === "visible") telemetry("session.heartbeat", "/workbench");
    }, 60_000);
  }

  function enterLocalApp() {
    remoteSession = null;
    sessionStorage.removeItem("auditflow_session_token");
    sessionStorage.removeItem("auditflow_session_endpoint");
    enterApp({ id: "desktop-local", userId: "desktop-local", name: "Local user", displayName: "Local user", role: "user", isAdmin: false, localOnly: true });
  }

  function setAccessMode(nextMode) {
    accessMode = nextMode === "cloud" ? "cloud" : "local";
    const local = accessMode === "local";
    localModeTab?.classList.toggle("active", local);
    cloudModeTab?.classList.toggle("active", !local);
    localModeTab?.setAttribute("aria-selected", String(local));
    cloudModeTab?.setAttribute("aria-selected", String(!local));
    accountModeTabs.hidden = local;
    authForm.hidden = local;
    localModeHint.hidden = !local;
    if (local) enterLocalApp();
    else if (currentUser?.localOnly) leaveApp();
    else setMode(mode);
  }

  function leaveApp() {
    currentUser = null;
    window.clearInterval(heartbeat);
    heartbeat = null;
    frame.src = "about:blank";
    appView.hidden = true;
    authView.hidden = false;
    authForm.reset();
    document.getElementById("telemetryConsent").checked = true;
    setMode("login");
  }

  async function logout() {
    if (remoteSession?.sessionToken) {
      const endpoint = remoteSession.endpoint || REMOTE_ENDPOINT;
      try { await fetch(`${endpoint}/api/auth/logout`, { method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-auditflow-session": remoteSession.sessionToken }, body: "{}" }); } catch (_) { }
    }
    try { await api("./api/auth/logout", { method: "POST", body: "{}" }); } catch (_) { }
    remoteSession = null;
    sessionStorage.removeItem("auditflow_session_token");
    sessionStorage.removeItem("auditflow_session_endpoint");
    leaveApp();
  }

  function openFeedback() {
    feedbackModal.hidden = false;
    document.getElementById("feedbackMessage").focus();
    telemetry("feedback.open");
  }

  function closeFeedback() {
    feedbackModal.hidden = true;
    document.getElementById("feedbackMessageStatus").textContent = "";
  }

  function nativeCommand(command) {
    if (globalThis.chrome?.webview?.postMessage) {
      chrome.webview.postMessage({ type: "desktop-command", command });
      return true;
    }
    return false;
  }

  function fileAnalystErrorBanner(message, healthSummary, code, detail) {
    const safe = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    frame.srcdoc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
      body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#1a1d21;font-family:'Segoe UI',system-ui,sans-serif;color:#e8eaed}
      .banner{max-width:560px;width:90%;background:#2d1b1b;border:1px solid #5c2626;border-radius:10px;padding:32px 28px;box-shadow:0 8px 32px rgba(0,0,0,.4)}
      h1{font-size:18px;margin:0 0 12px;color:#f87171;font-weight:600}
      .msg{font-size:14px;line-height:1.6;color:#fca5a5;margin:0 0 16px}
      .meta{font-size:12px;color:#9ca3af;background:#1f2937;border-radius:6px;padding:10px 12px;margin:0 0 16px;word-break:break-all}
      .meta b{color:#d1d5db}
      ul{margin:0;padding-left:18px;font-size:13px;line-height:1.8;color:#9ca3af}
      code{background:#374151;padding:1px 5px;border-radius:3px;font-size:12px;color:#e5e7eb}
      .retry{margin-top:20px;display:inline-block;background:#374151;color:#e5e7eb;border:none;padding:8px 18px;border-radius:6px;font-size:13px;cursor:pointer}
      .retry:hover{background:#4b5563}
    </style></head><body><div class="banner">
      <h1>\u26A0 FileAnalyst Unavailable</h1>
      <p class="msg">${safe(message)}</p>
      ${healthSummary ? `<div class="meta"><b>Health response:</b> ${safe(healthSummary)}</div>` : ""}
      ${code ? `<div class="meta"><b>Error code:</b> ${safe(code)}${detail ? ` &middot; <b>Detail:</b> ${safe(detail)}` : ""}</div>` : ""}
      <ul>
        <li>Check logs: <code>%LOCALAPPDATA%\\JEAuditFlow\\Logs\\desktop-*.log</code></li>
        <li>Verify FileAnalyst service: <code>WebApp\\start-fileanalyst.cmd</code></li>
        <li>Restart JEAuditFlow application</li>
        <li>Clear WebView2 cache: delete <code>%LOCALAPPDATA%\\JEAuditFlow\\WebView2</code> then restart</li>
      </ul>
      <button class="retry" onclick="history.back()">\u2190 Back to Workbench</button>
    </div></body></html>`;
  }

  async function openFileAnalyst(projectId = "") {
    if (!currentUser) return;
    const selectedProjectId = normalizeProjectId(projectId) || projectIdFromWorkbench();
    let healthSummary = "";
    let errorCode = "";
    let errorDetail = "";
    try {
      const manifestResponse = await fetch("./fileanalyst/package.json", {
        cache: "no-store",
        signal: AbortSignal.timeout(5000)
      });
      const manifest = await manifestResponse.json().catch(() => ({}));
      const expectedVersion = typeof manifest.version === "string" ? manifest.version.trim() : "";
      if (!manifestResponse.ok || !expectedVersion) {
        errorCode = "MANIFEST_UNAVAILABLE";
        errorDetail = "FileAnalyst runtime manifest does not provide a version";
        throw new Error(errorDetail);
      }
      const response = await fetch("./fileanalyst/api/health", {
        cache: "no-store",
        signal: AbortSignal.timeout(5000)
      });
      const health = await response.json().catch(() => ({}));
      healthSummary = JSON.stringify(health).slice(0, 300);
      if (!response.ok) {
        errorCode = health.code || `HTTP_${response.status}`;
        errorDetail = health.detail || health.error || "";
        throw new Error(errorDetail || `FileAnalyst health check failed (HTTP ${response.status})`);
      }
      if (health.product !== "FileAnalyst" || health.version !== expectedVersion) {
        errorCode = "VERSION_MISMATCH";
        errorDetail = `Expected FileAnalyst ${expectedVersion}, got ${health.product || "?"} ${health.version || "?"}`;
        throw new Error(errorDetail);
      }
      frame.removeAttribute("srcdoc");
      frame.srcdoc = "";
      frame.title = `FileAnalyst ${expectedVersion} | Controlled engineering workspace`;
      frame.src = fileAnalystUrl(selectedProjectId);
    } catch (error) {
      const message = error.message || "FileAnalyst service is not ready";
      if (!errorCode && error.name === "TimeoutError") errorCode = "TIMEOUT";
      if (!errorCode && error.name === "TypeError") errorCode = "NETWORK_ERROR";
      showToast(message);
      fileAnalystErrorBanner(message, healthSummary, errorCode, errorDetail);
    }
  }

  function openAuditFlow(projectId = "") {
    if (!currentUser) return;
    frame.title = "JEAuditFlow 工作台";
    frame.src = auditFlowUrl(normalizeProjectId(projectId) || initialProjectId());
  }

  function openLessonLearn(projectId = "") {
    if (!currentUser) return;
    frame.title = "LessonLearn | JEAuditFlow";
    frame.src = lessonLearnUrl(normalizeProjectId(projectId) || projectIdFromWorkbench());
  }

  function openJiraFlow(projectId = "") {
    if (!currentUser) return;
    const proxyUrl = typeof serviceState?.jiraFlowProxyBaseUri === "string" &&
      /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/jiraflow\/?$/.test(serviceState.jiraFlowProxyBaseUri)
      ? serviceState.jiraFlowProxyBaseUri.replace(/\/?$/, "/")
      : "";
    const url = proxyUrl || controlledJiraFlowUrl(serviceState?.jiraFlowBaseUri, serviceState?.jiraFlowPort);
    const healthy = serviceState?.jiraFlowAvailable === true &&
      serviceState?.jiraFlowHealthy === true &&
      String(serviceState?.jiraFlowStatus || "").toLowerCase() === "healthy" &&
      Boolean(url);
    if (!healthy) {
      showToast(`JiraFlow 当前不可用（${serviceState?.jiraFlowStatus || "unavailable"}）`);
      return;
    }
    if (globalThis.chrome?.webview?.postMessage) {
      nativeCommand("open-jiraflow");
      return;
    }
    window.open(url, "_blank", "noopener");
  }

  async function handleWorkbenchCommand(command, payload = {}) {
    if (command === "open-fileanalyst") return openFileAnalyst(payload.projectId);
    if (command === "open-auditflow") return openAuditFlow(payload.projectId);
    if (command === "open-lessonlearn") return openLessonLearn(payload.projectId);
    if (command === "open-jiraflow") return openJiraFlow(payload.projectId);
    if (command === "feedback") return openFeedback();
    if (command === "logout") return logout();
    if (command === "open-operations") {
      if (currentUser?.role !== "admin") return showToast("只有本机管理员可打开运营后台");
      window.open("./ops.html", "_blank", "noopener");
      return;
    }
    if (command === "open-portal" || command === "open-downloads") {
      window.open("./portal.html", "_blank", "noopener");
      return;
    }
    if (command === "request-context") return postContext();
    if (command === "check-update") return postDesktopCommand("check-update");
    if (!nativeCommand(command)) showToast("该命令需要在 AuditFlow Windows 程序中运行");
  }

  loginTab.addEventListener("click", () => setMode("login"));
  registerTab.addEventListener("click", () => setMode("register"));
  localModeTab?.addEventListener("click", () => setAccessMode("local"));
  cloudModeTab?.addEventListener("click", () => setAccessMode("cloud"));

  authForm.addEventListener("submit", async event => {
    event.preventDefault();
    authMessage.textContent = "";
    authSubmit.disabled = true;
    try {
      const credentials = { email: document.getElementById("email").value, password: password.value, telemetryConsent: document.getElementById("telemetryConsent").checked };
      const endpoint = normalizeRemoteEndpoint(remoteEndpointInput?.value || REMOTE_ENDPOINT);
      localStorage.setItem(REMOTE_ENDPOINT_KEY, endpoint);
      const response = await fetch(`${endpoint}/api/auth/${mode}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(credentials), signal: AbortSignal.timeout(12000) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : payload?.error?.message || `远端登录失败（${response.status}）`);
      }
      const sessionToken = String(payload.sessionToken || "").trim();
      if (!sessionToken) throw new Error("远端登录未返回有效会话令牌，未进入本地模式。");
      if (!payload.user || !payload.user.email || !(payload.user.id || payload.user.userId)) throw new Error("远端登录未返回有效账户身份。");
      remoteSession = { endpoint, sessionToken, user: payload.user || null };
      enterApp(payload.user);
    } catch (error) {
      authMessage.textContent = error.message;
    } finally {
      authSubmit.disabled = false;
    }
  });

  document.getElementById("feedbackClose").addEventListener("click", closeFeedback);
  document.getElementById("feedbackCancel").addEventListener("click", closeFeedback);
  feedbackModal.addEventListener("click", event => { if (event.target === feedbackModal) closeFeedback(); });

  document.getElementById("feedbackForm").addEventListener("submit", async event => {
    event.preventDefault();
    const submit = document.getElementById("feedbackSubmit");
    const messageStatus = document.getElementById("feedbackMessageStatus");
    submit.disabled = true;
    messageStatus.textContent = "";
    try {
      await api("./api/feedback", {
        method: "POST",
        body: JSON.stringify({
          category: document.getElementById("feedbackCategory").value,
          rating: Number(document.getElementById("feedbackRating").value),
          message: document.getElementById("feedbackMessage").value,
          appVersion: APP_VERSION
        })
      });
      document.getElementById("feedbackForm").reset();
      closeFeedback();
      showToast("意见已保存到本地运营后台");
    } catch (error) {
      messageStatus.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  frame.addEventListener("load", () => { telemetry("workbench.load", "/workbench"); postContext(); });
  window.addEventListener("message", event => {
    if (event.source !== frame.contentWindow) return;
    if (event.data?.type === "auditflow-desktop-command" && event.data.command === "open-workspace") {
      enterLocalApp();
      return;
    }
    if (event.data?.type === "auditflow-desktop-auth-required") { leaveApp(); return; }
    if (event.data?.type !== "auditflow-desktop-command") return;
    handleWorkbenchCommand(String(event.data.command || ""), event.data);
  });
  if (globalThis.chrome?.webview?.addEventListener) {
    chrome.webview.addEventListener("message", event => {
      if (event.data?.type !== "auditflow-desktop-state") return;
      serviceState = event.data.services || null;
      postContext();
    });
  }
  backendStatus?.addEventListener("click", refreshBackendStatus);
  let backendStatusTimer = null;
  function scheduleBackendStatusRefresh(delay = 15_000) {
    window.clearTimeout(backendStatusTimer);
    if (document.visibilityState !== "visible") return;
    backendStatusTimer = window.setTimeout(async () => {
      await refreshBackendStatus();
      scheduleBackendStatusRefresh();
    }, delay);
  }
  refreshBackendStatus().finally(() => scheduleBackendStatusRefresh());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      telemetry("session.resume");
      refreshBackendStatus().finally(() => scheduleBackendStatusRefresh());
    } else {
      window.clearTimeout(backendStatusTimer);
    }
  });

  if (remoteEndpointInput) {
    remoteEndpointInput.defaultValue = localStorage.getItem(REMOTE_ENDPOINT_KEY) || REMOTE_ENDPOINT;
    remoteEndpointInput.value = remoteEndpointInput.defaultValue;
  }
  showLanding();
})();
