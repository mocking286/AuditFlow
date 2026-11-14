import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { getReportTemplates, readReportTemplate, handleReportTemplateRequest } from "../report-templates.mjs";

const templateDirectory = new URL("../templates/", import.meta.url).pathname;
const context = vm.createContext({});
vm.runInContext(readFileSync(new URL("../report-templates.js", import.meta.url), "utf8"), context);
const reports = context.AuditFlowReportTemplates;

test("TUV ledger is discoverable and downloadable through the stable API catalog", async () => {
  const catalog = await getReportTemplates({ templateDirectory });
  const entry = catalog.templates.find(item => item.id === "tuv-aspice-issue-ledger");
  assert.ok(entry, "TUV ledger template must be in the served catalog");
  const output = await readReportTemplate(entry.id, { templateDirectory });
  assert.equal(output.filename, "TUV-ASPICE-Audit-Issue-Ledger-2026.pptx");
  assert.equal(output.data.subarray(0, 2).toString(), "PK");
  const response = { setHeader() {}, end(body) { this.body = body; } };
  await handleReportTemplateRequest({ method: "GET", url: entry.url }, response, { templateDirectory });
  assert.equal(response.statusCode, 200);
});

for (const [name, processes, issues] of [
  ["empty", ["SYS.2"], []],
  ["single process", ["SYS.2"], [{ id: "NC-1", process: "SYS.2", description: "Requirement review is pending" }]],
  ["multiple processes", ["SYS.2", "SWE.1"], [{ id: "NC-1", process: "SYS.2", description: "System review" }, { id: "NC-2", process: "SWE.1", description: "Software review" }]]
]) {
  test(`TUV ${name} ledger preview renders every page`, () => {
    const model = reports.buildReportModel({ id: "TUV-76", name: "Ledger", processes, evidence: [], records: [], assessments: [], ncRecords: issues }, { language: "en" });
    const html = reports.printDocument(model, { templateId: "tuv-aspice-issue-ledger" });
    assert.match(html, /TUV ASPICE Audit Issue Ledger 2026/);
    assert.equal((html.match(/class="slide"/g) || []).length, issues.length ? 3 + processes.length + issues.length : 5);
    assert.doesNotMatch(html, /undefined|null/);
  });
}
