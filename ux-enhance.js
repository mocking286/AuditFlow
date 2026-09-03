/* ============================================================
   AuditFlow v5.4 · UX enhancements
   - Drop files anywhere in the workspace: a full-screen overlay
     appears, and files are routed to the visible evidence
     dropzone (keeps the app's own drop handling intact).
   ============================================================ */
(function () {
  "use strict";
  if (window.__auditflowUX) return;
  window.__auditflowUX = true;

  var OVERLAY_CLASS = "af-drop-overlay";

  function hasFiles(e) {
    return !!(e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") !== -1);
  }

  function showOverlay() {
    if (document.querySelector("." + OVERLAY_CLASS)) return;
    var el = document.createElement("div");
    el.className = OVERLAY_CLASS;
    el.innerHTML =
      '<div>' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 16V4m0 0 4 4m-4-4L8 8"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>' +
      "</svg>" +
      "<strong>松开以导入证据</strong>" +
      "<p>文件将自动进入当前项目的 Evidence Inventory，并在浏览器本地解析正文与表格。</p>" +
      "</div>";
    document.body.appendChild(el);
  }

  function hideOverlay() {
    var el = document.querySelector("." + OVERLAY_CLASS);
    if (el) el.remove();
  }

  function isAppDropTarget(target) {
    if (!target || typeof target.closest !== "function") return false;
    return !!target.closest(
      ".dropzone,[data-plan-drop],[data-schedule-drop],[data-schedule-status-drop]"
    );
  }

  document.addEventListener("dragover", function (e) {
    if (!hasFiles(e)) return;
    if (isAppDropTarget(e.target)) {
      hideOverlay();
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    showOverlay();
  });

  document.addEventListener("dragleave", function (e) {
    if (!e.relatedTarget && hasFiles(e)) hideOverlay();
  });

  document.addEventListener("dragend", hideOverlay);

  document.addEventListener("drop", function (e) {
    if (!hasFiles(e)) return;
    // The app already handled this drop (dropzone or board).
    if (e.defaultPrevented) {
      hideOverlay();
      return;
    }
    var dz = document.querySelector(".dropzone");
    if (!dz) {
      hideOverlay();
      return;
    }
    e.preventDefault();
    hideOverlay();
    // Re-dispatch the files through the visible dropzone so the app's own
    // handler decides the evidence target and parsing pipeline.
    var dt = new DataTransfer();
    Array.prototype.forEach.call(e.dataTransfer.files, function (f) {
      dt.items.add(f);
    });
    dz.dispatchEvent(new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt
    }));
  });
})();
