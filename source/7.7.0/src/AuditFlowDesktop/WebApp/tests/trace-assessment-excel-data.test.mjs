import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const sourcePath = fileURLToPath(new URL("../report-templates.js", import.meta.url));
const source = await readFile(sourcePath, "utf8");

function load() {
  const context = { Date, Blob, URL, console };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: sourcePath });
  return context.AuditFlowReportTemplates;
}

function fixture() {
  return {
    id: "TA-262",
    name: "2025-11 Murten",
    language: "en",
    organization: "Example Org",
    processes: ["SYS.1", "SYS.2"],
    activeInstanceId: "INS-1",
    activeWorkspaceId: "WS-1",
    instances: [{ id: "INS-1", name: "DrivePilot" }],
    workspaces: [{ id: "WS-1", shortname: "TMM" }],
    assessments: [{
      id: "AS-1",
      process: "SYS.1",
      code: "BP1",
      pa: "PA 1.1",
      title: "Requirements elicitation",
      rating: "P",
      displayRating: "P+",
      reviewed: true,
      scopeStatus: "in-scope",
      findings: [{ id: "F-1", type: "weakness", text: "The approval record is missing." }],
      closureEvidence: ["Approved baseline", "Review record"],
      governance: { owner: "Assessor A", due: "2026-12-01" }
    }],
    records: [{
      id: "F-1",
      type: "weakness",
      text: "The approval record is missing.",
      indicators: ["SYS.1.BP1"],
      owner: "Project Owner",
      dueDate: "2026-12-05",
      status: "Draft"
    }],
    evidence: [
      {
        id: "EV-1",
        code: "EV.001",
        name: "Requirements.xlsx",
        type: "Workbook",
        primaryProcesses: ["SYS.1"],
        confirmed: true,
        atomicItems: [{
          id: "ITEM-1",
          externalId: "SYS.1.001",
          title: "Stakeholder request record",
          itemType: "Observation",
          text: "Customer request CR-42 was reviewed on 2025-11-03 and approved by the requirements owner.",
          locator: "Requirements.xlsx!Requests!A12:F12",
          primaryProcess: "SYS.1",
          evidenceRole: "direct"
        }]
      },
      {
        id: "EV-2",
        code: "EV.002",
        name: "Other-process.xlsx",
        type: "Workbook",
        primaryProcesses: ["SYS.2"],
        atomicItems: [{
          id: "ITEM-2",
          title: "System specification",
          text: "System requirement SYS-17 is allocated to the DrivePilot function.",
          locator: "Other-process.xlsx!SYS!B4",
          primaryProcess: "SYS.2",
          evidenceRole: "direct"
        }]
      },
      {
        id: "EV-3",
        code: "EV.003",
        name: "Index-only.pdf",
        type: "PDF",
        primaryProcesses: ["SYS.1"],
        atomicItems: [{
          id: "ITEM-3",
          title: "Index entry",
          locator: "Index-only.pdf!p1",
          primaryProcess: "SYS.1",
          evidenceRole: "direct"
        }]
      }
    ],
    traceLinks: [
      { id: "TL-1", findingId: "F-1", assessmentId: "AS-1", indicator: "SYS.1.BP1", evidenceId: "EV-1", itemId: "ITEM-1", evidenceRole: "direct", locator: "Requirements.xlsx!Requests!A12:F12", confirmed: true, source: "Assessor confirmed" },
      { id: "TL-2", findingId: "F-1", assessmentId: "AS-1", indicator: "SYS.1.BP1", evidenceId: "EV-2", itemId: "ITEM-2", evidenceRole: "direct", locator: "Other-process.xlsx!SYS!B4", confirmed: true, source: "Assessor confirmed" },
      { id: "TL-3", assessmentId: "AS-1", indicator: "SYS.1.BP1", evidenceId: "EV-3", itemId: "ITEM-3", evidenceRole: "direct", locator: "Index-only.pdf!p1", confirmed: true, source: "Assessor confirmed" }
    ]
  };
}

function build(project, overrides = {}) {
  return load().buildReportModel(project, {
    language: "en",
    generatedAt: "2026-11-13T00:00:00.000Z",
    gate: { gatePass: true },
    reportableAssessmentIds: ["AS-1"],
    includeCandidates: false,
    ...overrides
  });
}

test("Trace Assessment Excel expands assessor records and retains locatable evidence content", () => {
  const model = build(fixture());
  const workbook = model.traceWorkbook;
  assert.deepEqual(Array.from(workbook.sections, section => section.sheetName), ["Records", "Evidence", "JiraImport", "Info"]);
  const records = workbook.sections[0].tables[0];
  assert.equal(records.headers[0], "SortID");
  assert.equal(records.headers[1], "ID");
  assert.equal(records.headers[2], "Indicator");
  assert.equal(records.headers[13], "Modified date");
  assert.equal(records.headers[14], "Evidence content");
  const finding = records.rows.find(row => row[1] === "F-1");
  assert.ok(finding);
  assert.equal(finding[2], "SYS.1.BP1");
  assert.equal(finding[8], "P", "formal rating is taken only from the assessor-confirmed in-scope assessment");
  assert.match(finding[14], /Customer request CR-42/);
  assert.match(finding[15], /Requirements\.xlsx!Requests!A12:F12/);
  assert.equal(finding[16], "direct; corroborating", "cross-process evidence is never labeled direct for SYS.1");
  assert.equal(finding[17], "Project Owner");
  assert.equal(finding[18], "2026-12-05");
});

test("evidence from another process is corroborating, and unparsed/index-only references are not promoted", () => {
  const workbook = build(fixture()).traceWorkbook;
  const finding = workbook.sections[0].tables[0].rows.find(row => row[1] === "F-1");
  assert.match(finding[14], /System requirement SYS-17/);
  assert.equal(finding[16], "direct; corroborating");

  const evidence = workbook.sections[1].tables[0].rows;
  assert.equal(evidence.find(row => row[2] === "SYS.1.001")[9], "Customer request CR-42 was reviewed on 2025-11-03 and approved by the requirements owner.");
  assert.equal(evidence.find(row => row[2] === "SYS.1.001")[10], "Requirements.xlsx!Requests!A12:F12");
  assert.equal(evidence.find(row => row[2] === "EV.003")[12], "index-only");
  assert.match(evidence.find(row => row[2] === "EV.003")[9], /Content unavailable/);
});

test("unavailable source content is explicit and never replaced with a filename or ID", () => {
  const project = fixture();
  project.traceLinks = project.traceLinks.filter(link => link.findingId === "F-1" && link.itemId === "ITEM-1");
  const link = project.traceLinks[0];
  link.itemId = "MISSING-ITEM";
  link.evidenceId = "EV-1";
  link.locator = "";
  const finding = build(project).traceWorkbook.sections[0].tables[0].rows.find(row => row[1] === "F-1");
  assert.match(finding[14], /Content unavailable/);
  assert.doesNotMatch(finding[14], /Requirements\.xlsx|EV\.001|ITEM-1/);
  assert.equal(finding[16], "index-only");
});

test("a direct-role claim without assessor link confirmation remains corroborating", () => {
  const project = fixture();
  project.traceLinks = project.traceLinks.filter(link => link.findingId === "F-1" && link.itemId === "ITEM-1");
  project.traceLinks[0].confirmed = false;
  const finding = build(project).traceWorkbook.sections[0].tables[0].rows.find(row => row[1] === "F-1");
  assert.equal(finding[16], "corroborating");
});

test("Chinese source evidence is retained when an English translation is unavailable", () => {
  const project = fixture();
  project.evidence[0].atomicItems[0].text = "客户请求 CR-42 已于 2025-11-03 评审并经需求负责人批准。";
  const finding = build(project).traceWorkbook.sections[0].tables[0].rows.find(row => row[1] === "F-1");
  assert.match(finding[14], /客户请求 CR-42/);
  assert.doesNotMatch(finding[14], /Source-language content requires assessor translation/);
});
