import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = new URL("../", import.meta.url);
const reportTemplates = readFileSync(fileURLToPath(new URL("report-templates.js", webRoot)), "utf8");
const app = readFileSync(fileURLToPath(new URL("app.js", webRoot)), "utf8");

test("TUV issue ledger is a data-driven report template", () => {
  const entry = reportTemplates.match(/\{ id: "tuv-aspice-issue-ledger"[^}]+\}/)?.[0] || "";
  assert.match(entry, /format: "pptx"/);
  assert.doesNotMatch(entry, /staticAsset|referenceOnly/);
  assert.match(reportTemplates, /if \(templateId === "tuv-aspice-issue-ledger"\)/);
  assert.match(reportTemplates, /tuvReferences/);
  assert.doesNotMatch(reportTemplates, /This is a reference template/);
});

test("TUV reference library is routed to Reports and omitted from evidence scope", () => {
  const reports = app.indexOf("${renderTuvIssueReferencePanel(project)}");
  const evidence = app.indexOf("renderSupportIssueEvidencePanel(project, { omitReference: true })");
  assert.ok(reports >= 0, "Reports view must render the TUV reference library");
  assert.ok(evidence >= 0, "Evidence view must explicitly omit the TUV reference library");
  assert.ok(reports < evidence, "Reports routing must be defined before evidence rendering");
});
