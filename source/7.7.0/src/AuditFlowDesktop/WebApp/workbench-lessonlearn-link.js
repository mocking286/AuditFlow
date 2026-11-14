(() => {
  "use strict";

  const link = document.querySelector(".lessonlearn-link");
  if (!link) return;

  const embedded = () =>
    new URLSearchParams(window.location.search).get("embedded") === "1" &&
    window.parent !== window;

  const projectId = () =>
    window.AuditFlowProjectContext?.projectIdFromLocation?.() ||
    new URLSearchParams(window.location.search).get("project") ||
    "";

  link.addEventListener("click", event => {
    if (!embedded()) return;
    event.preventDefault();
    window.parent.postMessage({
      type: "auditflow-desktop-command",
      command: "open-lessonlearn",
      projectId: projectId()
    }, window.location.origin);
  });
})();
