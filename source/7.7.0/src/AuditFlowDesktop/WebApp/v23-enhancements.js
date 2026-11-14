/* JEAuditFlow 2.3 client refinements. No evidence text leaves the browser. */
(function () {
  "use strict";
  const KEY = "jeauditflow-v23-layout-v1";
  const layout = { scope: 230, evidence: 390 };

  function readLayout() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (saved && Number.isFinite(Number(saved.scope))) layout.scope = Math.max(180, Math.min(420, Number(saved.scope)));
      if (saved && Number.isFinite(Number(saved.evidence))) layout.evidence = Math.max(280, Math.min(620, Number(saved.evidence)));
    } catch (_) { /* local layout is optional */ }
  }

  function saveLayout() {
    try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch (_) { /* ignore storage failures */ }
  }

  function addResizer(studio, side, before) {
    const divider = document.createElement("span");
    divider.className = "af-v23-resizer";
    divider.dataset.side = side;
    divider.setAttribute("role", "separator");
    divider.setAttribute("aria-label", side === "scope" ? "Resize assessment scope" : "Resize evidence inventory");
    divider.tabIndex = 0;
    let dragging = false;
    const move = event => {
      if (!dragging) return;
      const rect = studio.getBoundingClientRect();
      if (side === "scope") layout.scope = Math.max(180, Math.min(420, event.clientX - rect.left));
      else layout.evidence = Math.max(280, Math.min(620, rect.right - event.clientX));
      studio.style.setProperty(`--af-v23-${side}-width`, `${side === "scope" ? layout.scope : layout.evidence}px`);
    };
    const stop = () => { if (!dragging) return; dragging = false; divider.dataset.dragging = "false"; document.body.classList.remove("af-v23-dragging"); saveLayout(); };
    divider.addEventListener("pointerdown", event => { dragging = true; divider.dataset.dragging = "true"; document.body.classList.add("af-v23-dragging"); divider.setPointerCapture?.(event.pointerId); });
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", stop);
    divider.addEventListener("pointercancel", stop);
    divider.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -16 : 16;
      if (side === "scope") layout.scope = Math.max(180, Math.min(420, layout.scope + delta));
      else layout.evidence = Math.max(280, Math.min(620, layout.evidence - delta));
      studio.style.setProperty(`--af-v23-${side}-width`, `${side === "scope" ? layout.scope : layout.evidence}px`);
      saveLayout();
    });
    if (before) before.parentNode.insertBefore(divider, before); else studio.appendChild(divider);
  }

  function enhanceStudio(studio) {
    if (studio.dataset.afV23Ready === "true") return;
    studio.dataset.afV23Ready = "true";
    studio.classList.add("af-v23-resizable");
    studio.style.setProperty("--af-v23-scope-width", `${layout.scope}px`);
    studio.style.setProperty("--af-v23-evidence-width", `${layout.evidence}px`);
    const center = studio.querySelector(".trace-center-v81");
    const evidence = studio.querySelector(".trace-evidence-pane");
    if (center) addResizer(studio, "scope", center);
    if (evidence) addResizer(studio, "evidence", evidence);
    const syncMode = () => studio.dataset.paneMode = window.innerWidth <= 760 ? "stacked" : "split";
    syncMode();
    window.addEventListener("resize", syncMode, { passive: true });
  }

  function addPresence() {
    const actions = document.querySelector(".top-actions");
    if (!actions || document.getElementById("afV23Presence")) return;
    const node = document.createElement("span");
    node.id = "afV23Presence";
    node.className = "af-v23-presence";
    node.dataset.state = "offline";
    node.innerHTML = "<i aria-hidden=\"true\"></i><span>本地协作</span>";
    node.title = "2.3 协作状态：本地优先；同步端点由项目设置控制";
    actions.insertBefore(node, actions.firstChild);
    window.AuditFlowBackend?.collaborationStatus?.(1800).then(() => { node.dataset.state = "online"; node.lastElementChild.textContent = "协作可用"; }).catch(() => {});
  }

  function scan() {
    readLayout();
    document.querySelectorAll(".trace-studio-v81").forEach(enhanceStudio);
    addPresence();
    document.body.dataset.auditflowVersion = "4.1.0";
  }

  window.AuditFlowV23 = { scan, layout };
  window.addEventListener("DOMContentLoaded", scan, { once: true });
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
}());

