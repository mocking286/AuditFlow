(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TuvIssueLedgerGuard = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const PROCESS_SHEET = /^(SYS|SWE)\.(\d+)$/i;
  const REQUIRED_HEADERS = [
    "issueidopl",
    "issuedescription",
    "internalcomment",
    "rootcause",
    "improvementmeasures",
    "personresponsible",
    "duedate",
    "descriptioninhelix"
  ];

  function cellText(value) {
    if (value == null) return "";
    return String(value).replace(/\s+/g, " ").trim();
  }

  function compact(value) {
    return cellText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function isTuvAuditIssueLedger(fileName, sheetRows) {
    const extension = String(fileName || "").split(".").pop().toLowerCase();
    if (!new Set(["xlsx", "xlsm"]).has(extension)) return false;
    const normalizedName = String(fileName || "").toLowerCase().replace(/[_-]+/g, " ");
    if (normalizedName.includes("tuv audit issue record form")) return true;
    if (!Array.isArray(sheetRows)) return false;

    const dashboard = sheetRows.find(sheet => /^dashboard$/i.test(cellText(sheet?.name || "")));
    const dashboardText = (dashboard?.rows || []).flat().map(cellText).join(" ").toLowerCase();
    if (!dashboardText.includes("tuv audit issue record form") || !dashboardText.includes("findings dashboard")) return false;

    const signedProcessSheets = new Set();
    for (const sheet of sheetRows) {
      const name = cellText(sheet?.name || "");
      if (!PROCESS_SHEET.test(name)) continue;
      const hasSignature = (sheet.rows || []).some(row => {
        const headers = (row || []).map(compact);
        return REQUIRED_HEADERS.every(required => headers.some(header => header.includes(required)));
      });
      if (hasSignature) signedProcessSheets.add(name.toUpperCase());
    }

    const hasSys = [...signedProcessSheets].some(name => name.startsWith("SYS."));
    const hasSwe = [...signedProcessSheets].some(name => name.startsWith("SWE."));
    return signedProcessSheets.size >= 6 && hasSys && hasSwe;
  }

  return Object.freeze({ isTuvAuditIssueLedger });
});
