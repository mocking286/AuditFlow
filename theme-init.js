(function () {
  "use strict";
  var theme = localStorage.getItem("auditflow-theme") === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  var darkSheet = document.getElementById("darkThemeStyles");
  if (darkSheet) darkSheet.disabled = theme !== "dark";
}());
