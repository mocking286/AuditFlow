(() => {
  "use strict";

  const promoFrame = document.getElementById("landingPromo");
  let navigationStarted = false;

  window.addEventListener("message", event => {
    if (event.source !== promoFrame?.contentWindow) return;
    if (event.data?.type !== "auditflow-desktop-command" || event.data.command !== "open-workspace") return;
    if (navigationStarted) return;
    navigationStarted = true;

    const extensionUrl = globalThis.chrome?.runtime?.getURL;
    const target = extensionUrl
      ? extensionUrl("index.html?fromLanding=1#/dashboard")
      : new URL("./index.html?fromLanding=1#/dashboard", window.location.href).href;
    window.location.assign(target);
  });
})();
