(function () {
  "use strict";
  var theme = localStorage.getItem("auditflow-theme") === "dark" ? "dark" : "light";
  function apply(next, persist) {
    theme = next === "dark" ? "dark" : "light";
    if (persist) localStorage.setItem("auditflow-theme", theme);
    var root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.colorScheme = theme;
    root.classList.toggle("theme-dark", theme === "dark");
    root.style.colorScheme = theme;
    if (document.body) {
      document.body.dataset.theme = theme;
      document.body.classList.toggle("theme-dark", theme === "dark");
    }
    var darkSheet = document.getElementById("darkThemeStyles");
    if (darkSheet) darkSheet.disabled = theme !== "dark";
    try { window.dispatchEvent(new CustomEvent("auditflow-theme-change", { detail: { theme: theme } })); } catch (_) {}
  }
  apply(theme, false);
  window.AuditFlowTheme = { get: function () { return theme; }, set: function (next) { apply(next, true); }, toggle: function () { apply(theme === "dark" ? "light" : "dark", true); } };
  window.addEventListener("storage", function (event) {
    if (event.key === "auditflow-theme") apply(event.newValue, false);
  });
  document.addEventListener("DOMContentLoaded", function () { apply(theme, false); }, { once: true });
}());
