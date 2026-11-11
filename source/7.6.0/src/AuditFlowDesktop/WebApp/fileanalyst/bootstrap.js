(() => {
  const baseHref = document.querySelector("base")?.getAttribute("href");
  if (!window.FILEANALYST_BASE_PATH) {
    window.FILEANALYST_BASE_PATH = baseHref
      ? new URL(baseHref, document.baseURI).pathname.replace(/\/$/, "") || "/"
      : ".";
  }
  if (globalThis.chrome?.runtime?.getURL && location.protocol === "chrome-extension:") {
    window.FILEANALYST_API_BASE_URL = "http://127.0.0.1:4173/fileanalyst";
  }

  const timeoutSeconds = 6;
  setTimeout(() => {
    const app = document.getElementById("app");
    if (app && app.childElementCount === 0 && !app.textContent.trim()) {
      app.innerHTML = `<div style="background:#2d1b1b;border:1px solid #5c2626;border-radius:10px;padding:28px 24px;margin:40px auto;max-width:520px;font-family:Segoe UI,system-ui,sans-serif;color:#fca5a5">
        <h2 style="margin:0 0 10px;font-size:16px;color:#f87171">[!] FileAnalyst UI failed to load</h2>
        <p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#d1d5db">The application module did not render within ${timeoutSeconds} seconds. This usually indicates a script load failure or network issue.</p>
        <p style="margin:0;font-size:12px;color:#9ca3af">Open browser DevTools (F12) -&gt; Console tab to see the underlying error. Common causes: blocked module import, service not running, stale WebView2 cache.</p>
      </div>`;
    }
  }, timeoutSeconds * 1000);
})();
