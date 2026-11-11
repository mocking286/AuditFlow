(() => {
  "use strict";

  async function record(event, page, details = {}) {
    try {
      await fetch("./api/v1/telemetry", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event,
          page,
          source: window.top === window ? "web" : "desktop",
          appVersion: "6.9.0",
          platform: navigator.platform,
          ...details
        })
      });
    } catch (_) {
      // Usage monitoring is non-blocking and never changes audit behavior.
    }
  }

  let lastRoute = location.hash || "/dashboard";
  record("workbench.open", lastRoute);

  window.addEventListener("hashchange", () => {
    const nextRoute = location.hash || "/dashboard";
    if (nextRoute !== lastRoute) {
      lastRoute = nextRoute;
      record("workbench.route", nextRoute);
    }
  });

  document.addEventListener("click", event => {
    const target = event.target.closest("[data-action], [data-nav]");
    if (!target) return;
    const action = target.getAttribute("data-action") || target.getAttribute("data-nav");
    if (/^[a-z0-9][a-z0-9_.:-]{0,63}$/i.test(action || "")) {
      record(`action.${action}`, lastRoute);
    }
  }, { passive: true });
})();
