import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const templatePath = fileURLToPath(new URL("../report-templates.js", import.meta.url));
const templateSource = await readFile(templatePath, "utf8");

function loadBrowserReportTemplates() {
  const context = {};
  context.globalThis = context;
  vm.runInNewContext(templateSource, context, { filename: templatePath });
  return context.AuditFlowReportTemplates;
}

function projectWithAssessment(overrides = {}) {
  return {
    id: "BROWSER-GATE-1",
    name: "Browser report gate fixture",
    organization: "AuditFlow",
    product: "Fixture",
    pam: "Automotive SPICE 4.0",
    processes: ["SYS.2"],
    assessmentState: "Closed",
    evidence: [],
    traceLinks: [],
    records: [],
    assessments: [{
      id: "A1",
      process: "SYS.2",
      code: "BP1",
      pa: "PA 1.1",
      title: "Requirement analysis",
      rating: "F",
      reviewed: true,
      scopeStatus: "in-scope",
      evidenceSufficiency: { status: "insufficient", coverage: 0 },
      refs: []
    }],
    ...overrides
  };
}

function formalAssessmentRows(model) {
  const section = model.sections.find(item => item.title.startsWith("3 "));
  return section?.tables?.[0]?.rows || [];
}

function build(project, options = {}) {
  return loadBrowserReportTemplates().buildReportModel(project, {
    gate: { gatePass: true },
    includeCandidates: false,
    processSummary: [],
    reportableAssessmentIds: [],
    ...options
  });
}

test("browser report omits reviewed ratings with insufficient evidence and no formal support", () => {
  const model = build(projectWithAssessment());

  assert.equal(model.status, "CONTROLLED DRAFT");
  assert.equal(formalAssessmentRows(model).some(row => row[0] === "SYS.2.BP1"), false);
});

test("browser report keeps assessor-supported ratings outside selected scope out of formal rows", () => {
  const project = projectWithAssessment({
    processes: ["SYS.2"],
    assessments: [{
      id: "A-SUP8",
      process: "SUP.8",
      code: "BP1",
      pa: "PA 1.1",
      title: "Configuration management",
      rating: "F",
      reviewed: true,
      scopeStatus: "in-scope"
    }],
    records: [{
      id: "REC-SUP8",
      type: "weakness",
      status: "Final",
      indicators: ["SUP.8.BP1"],
      text: "Finalized assessor finding"
    }]
  });

  const model = build(project, { reportableAssessmentIds: ["A-SUP8"] });

  assert.equal(model.status, "CONTROLLED DRAFT");
  assert.equal(formalAssessmentRows(model).some(row => row[0] === "SUP.8.BP1"), false);
});

test("browser report retains an assessor-confirmed direct link to an eligible in-scope item", () => {
  const project = projectWithAssessment({
    evidence: [{
      id: "EV-001",
      code: "EV-001",
      atomicItems: [{
        id: "ITEM-001",
        itemType: "requirement",
        title: "SYS.2 requirement",
        text: "SYS.2 requirement shall be analyzed and reviewed.",
        locator: "Requirements.xlsx!SYS.2!A2",
        primaryProcess: "SYS.2",
        evidenceRole: "direct"
      }]
    }],
    traceLinks: [{
      id: "TL-HUMAN",
      indicator: "SYS.2.BP1",
      evidenceId: "EV-001",
      itemId: "ITEM-001",
      evidenceCode: "EV-001",
      strength: "direct",
      confirmed: true,
      source: "Assessor confirmed",
      locator: "Requirements.xlsx!SYS.2!A2"
    }]
  });

  const row = formalAssessmentRows(build(project, { reportableAssessmentIds: ["A1"] })).find(item => item[0] === "SYS.2.BP1");

  assert.equal(row?.[2], "F");
  assert.match(row?.[5] || "", /assessor-confirmed link/);
});

test("browser report does not promote an AI link marked confirmed into assessor evidence", () => {
  const project = projectWithAssessment({
    records: [{
      id: "REC-FINAL",
      type: "weakness",
      status: "Final",
      indicators: ["SYS.2.BP1"],
      text: "Assessor-finalized finding"
    }],
    evidence: [{
      id: "EV-001",
      code: "EV-001",
      atomicItems: [{
        id: "ITEM-001",
        itemType: "requirement",
        title: "SYS.2 requirement",
        text: "SYS.2 requirement shall be analyzed and reviewed.",
        locator: "Requirements.xlsx!SYS.2!A2",
        primaryProcess: "SYS.2",
        evidenceRole: "direct"
      }]
    }],
    traceLinks: [{
      id: "TL-AI",
      indicator: "SYS.2.BP1",
      evidenceId: "EV-001",
      itemId: "ITEM-001",
      evidenceCode: "EV-001",
      strength: "direct",
      confirmed: true,
      source: "AI inferred",
      locator: "Requirements.xlsx!SYS.2!A2"
    }]
  });

  const row = formalAssessmentRows(build(project, { reportableAssessmentIds: ["A1"] })).find(item => item[0] === "SYS.2.BP1");

  assert.equal(row?.[2], "F", "the finalized finding independently qualifies the rating");
  assert.match(row?.[5] || "", /link not confirmed/);
  assert.doesNotMatch(row?.[5] || "", /assessor-confirmed link/);
});
