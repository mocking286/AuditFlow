(() => {
  const basePath = "fileanalyst/index.html";

  function extensionUrl(projectId = "") {
    const target = `${basePath}${projectId ? `?project=${encodeURIComponent(projectId)}` : ""}`;
    if (globalThis.chrome?.runtime?.getURL) return chrome.runtime.getURL(target);
    return new URL(`./${target}`, window.location.href).href;
  }

  function projectIdFromLocation(locationLike = window.location) {
    const hash = String(locationLike?.hash || "");
    const match = hash.match(/^#\/standard\/([^/?#]+)/);
    if (match) {
      try { return decodeURIComponent(match[1]); } catch (_) { return match[1]; }
    }
    return new URLSearchParams(locationLike?.search || "").get("project") || "";
  }

  function fileAnalystUrl(projectId = projectIdFromLocation()) {
    const id = String(projectId || "").trim();
    if (globalThis.chrome?.runtime?.getURL) return extensionUrl(id);
    const target = new URL("./fileanalyst/", window.location.href);
    if (id) target.searchParams.set("project", id);
    return `${target.pathname}${target.search}${target.hash}`;
  }

  window.AUDITFLOW_FILEANALYST_URL = "./fileanalyst/";
  window.AuditFlowProjectContext = Object.freeze({
    projectIdFromLocation,
    fileAnalystUrl
  });
})();
