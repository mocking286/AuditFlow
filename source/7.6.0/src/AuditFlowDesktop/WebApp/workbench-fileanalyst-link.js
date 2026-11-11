document.addEventListener("DOMContentLoaded", () => {
  const link = document.querySelector(".fileanalyst-link");
  const projectId = () => window.AuditFlowProjectContext?.projectIdFromLocation?.() || "";
  const syncFileAnalystLink = () => {
    if (link) {
      link.href = window.AuditFlowProjectContext?.fileAnalystUrl?.(projectId())
        || window.AUDITFLOW_FILEANALYST_URL
        || "./fileanalyst/";
    }
  };

  syncFileAnalystLink();
  window.addEventListener("hashchange", syncFileAnalystLink);
  link?.addEventListener("click", event => {
    const embedded = new URLSearchParams(window.location.search).get("embedded") === "1";
    if (!embedded || window.parent === window) return;
    event.preventDefault();
    const targetUrl = window.AuditFlowProjectContext?.fileAnalystUrl?.(projectId());
    window.parent.postMessage({
      type: "auditflow-desktop-command",
      command: "open-fileanalyst",
      projectId: projectId(),
      url: targetUrl
    }, "*");
  });
}, { once: true });
