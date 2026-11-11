(() => {
  const params = new URLSearchParams(location.search);
  if (params.get("embedded") === "1" || params.get("fromLanding") === "1") return;
  if (!/\/index\.html$/i.test(location.pathname)) return;
  if (/^#\/[^/]+(?:\/.*)?$/.test(location.hash)) return;

  // Direct workbench entry belongs to the existing authentication gate.
  // The marketing page remains available through its explicit URL.
})();
