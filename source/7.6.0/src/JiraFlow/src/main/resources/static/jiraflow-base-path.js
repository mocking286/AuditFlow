(function (global) {
  "use strict";

  function normalizeBasePath(value) {
    const raw = String(value || "").trim();
    if (!raw || raw === "/") return "";
    const normalized = `/${raw.replace(/^\/+|\/+$/g, "")}`;
    return /^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(normalized)
      ? normalized
      : "";
  }

  function inferJiraFlowBasePath(locationPath = "", configuredPath = "") {
    const configured = normalizeBasePath(configuredPath);
    if (configured) return configured;
    const pathname = String(locationPath || "").split("?", 1)[0].split("#", 1)[0];
    return /^\/jiraflow(?:\/|$)/i.test(pathname) ? "/jiraflow" : "";
  }

  function resolveJiraFlowApiPath(value, basePath = "") {
    const raw = String(value || "").trim();
    if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) return raw;
    const base = normalizeBasePath(basePath);
    if (!base) return raw;
    if (raw === base || raw.startsWith(`${base}/`)) return raw;
    if (raw.startsWith("/api/") || raw === "/api") return `${base}${raw}`;
    return raw;
  }

  const locationPath = global.location?.pathname || "";
  const configuredPath = global.JiraFlowBasePath || global.__JIRAFLOW_BASE_PATH || "";
  const basePath = inferJiraFlowBasePath(locationPath, configuredPath);
  global.JiraFlowBasePath = basePath;
  global.resolveJiraFlowApiPath = value => resolveJiraFlowApiPath(value, basePath);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      normalizeBasePath,
      inferJiraFlowBasePath,
      resolveJiraFlowApiPath
    };
  }
})(typeof window !== "undefined" ? window : globalThis);
