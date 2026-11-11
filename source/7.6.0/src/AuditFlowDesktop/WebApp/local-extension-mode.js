(() => {
  "use strict";
  if (location.protocol !== "chrome-extension:") return;
  const cloudOrigin = "https://www.aspice-auditflow.cloud";
  const defaultBackendOrigin = "http://127.0.0.1:47373";
  const originalFetch = window.fetch.bind(window);
  const legacyDefaultPorts = new Set(["4173", "46973"]);
  const loopbackOrigin = value => {
    try {
      const url = new URL(value, location.href);
      if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return "";
      return url.origin;
    } catch (_) { return ""; }
  };
  const configuredBackendOrigin = value => {
    const origin = loopbackOrigin(value);
    if (!origin) return "";
    try {
      return legacyDefaultPorts.has(new URL(origin).port) ? "" : origin;
    } catch (_) { return ""; }
  };
  const savedBackendOrigin = (() => {
    try {
      const stored = JSON.parse(localStorage.getItem("auditflow-ai-workspace-v1") || "null");
      return configuredBackendOrigin(stored?.settings?.backendUrl);
    } catch (_) { return ""; }
  })();
  const runtimeBackendOrigin = configuredBackendOrigin(window.AuditFlowBackend?.baseUrl);
  const localOrigin = savedBackendOrigin || runtimeBackendOrigin || defaultBackendOrigin;
  const isLoopback = value => Boolean(loopbackOrigin(value));
  const acceptedBackendOrigin = value => configuredBackendOrigin(value) || localOrigin;
  window.fetch = (resource, options) => {
    const url = resource instanceof Request ? resource.url : String(resource);
    if (/^https?:/i.test(new URL(url, location.href).href) && !isLoopback(url)) {
      return Promise.reject(new Error("The local extension only contacts cloud through the project Update button. / 本地插件仅通过项目更新按钮读取云端。"));
    }
    return originalFetch(resource, options);
  };
  window.AuditFlowExtension = Object.freeze({
    localOnly: true,
    cloudOrigin,
    localOrigin,
    async requestCloudProjectSnapshot(projectId) {
      if (navigator.userActivation && !navigator.userActivation.isActive) {
        throw new Error("Click the project Update button to read the cloud snapshot. / 请点击项目更新按钮读取云端快照。");
      }
      const granted = await chrome.permissions.request({ origins: [`${cloudOrigin}/*`] });
      if (!granted) throw new Error("Cloud read permission was not granted. / 未授予云端读取权限。");
      const result = await chrome.runtime.sendMessage({ type: "auditflow-read-cloud-snapshot", projectId });
      if (!result?.ok) throw new Error(result?.error || "Cloud snapshot is unavailable / 无法读取云端快照");
      return result.project;
    }
  });
  document.addEventListener("DOMContentLoaded", () => {
    const fileAnalyst = document.querySelector(".fileanalyst-link");
    const projectId = window.AuditFlowProjectContext?.projectIdFromLocation?.() || new URLSearchParams(location.search).get("project") || "";
    const fileAnalystUrl = new URL("/fileanalyst/", localOrigin);
    if (projectId) fileAnalystUrl.searchParams.set("project", projectId);
    if (fileAnalyst) fileAnalyst.href = fileAnalystUrl.href;
    if (window.AuditFlowBackend) {
      let backendBase = localOrigin;
      Object.defineProperty(window.AuditFlowBackend, "baseUrl", {
        configurable: false,
        get: () => backendBase,
        set: value => { backendBase = acceptedBackendOrigin(value); }
      });
    }
  });
})();
