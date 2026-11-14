import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import "../evidence-catalog.js";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");

function functionSource(name) {
  const start = source.search(new RegExp(`^  (?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, `Missing ${name}`);
  const end = source.indexOf("\n  }\n", start);
  assert.ok(end > start, `Could not isolate ${name}`);
  return source.slice(start, end + 5);
}

function createFilterHarness() {
  const sandbox = {
    window: { AuditFlowEvidenceCatalog: globalThis.AuditFlowEvidenceCatalog },
    normalizeCell: value => String(value ?? "").replace(/\s+/g, " ").trim(),
    PROCESS_CATALOG: [
      { id: "SYS.1", en: "Requirements Elicitation", zh: "需求挖掘" },
      { id: "SYS.2", en: "System Requirements Analysis", zh: "系统需求分析" },
      { id: "SWE.1", en: "Software Requirements Analysis", zh: "软件需求分析" },
      { id: "MAN.3", en: "Project Management", zh: "项目管理" },
      { id: "SUP.1", en: "Quality Assurance", zh: "质量保证" }
    ]
  };
  vm.createContext(sandbox);
  vm.runInContext([
    "processIdsFromText",
    "evidenceFileName",
    "evidenceSourceText",
    "isProjectOrQualityPlanEvidence",
    "aspiceProcessCandidates",
    "requirementLikeEvidenceItem",
    "formalEvidenceEligibility",
    "rememberEvidenceExclusions",
    "filterFormalEvidenceItems",
    "evidenceItemTypeFromTableRow"
  ].map(functionSource).join("\n") + `
    EVIDENCE_PLAN_EXCEPTION = /(?:^|[\\s._-])(?:project|quality)[\\s._-]*(?:plan|management[\\s._-]*plan|assurance[\\s._-]*plan)|项目计划|质量计划/i;
  `, sandbox);
  return sandbox;
}

test("evidence inventory retains all source items while formal eligibility stays independent", () => {
  const harness = createFilterHarness();
  const evidence = { name: "Software_Requirements.docx", scope: "SWE.1" };
  const items = [
    { id: "R-1", itemType: "requirement", text: "SWE.1 requirements shall be analyzed and assigned to software architecture.", locator: "Table 1 Row 1" },
    { id: "I-1", itemType: "information", text: "SWE.1 shall review this note, but it is classified as information.", locator: "Table 1 Row 2" },
    { id: "H-1", itemType: "heading", text: "SWE.1 shall be verified", locator: "Paragraph 3" },
    { id: "R-2", itemType: "requirement", text: "Unrelated payroll requirement shall be approved.", locator: "Paragraph 4" },
    { id: "IMG-1", itemType: "requirement", visualOnly: true, metadata: { visualReference: "image-only" }, text: "", locator: "Image 1" }
  ];
  const retained = harness.filterFormalEvidenceItems(evidence, items);
  assert.deepEqual(Array.from(retained, item => item.id), ["R-1", "I-1", "H-1", "R-2", "IMG-1"]);
  assert.equal(evidence.filterStats.policy, "complete-evidence-inventory-v75");
  assert.equal(evidence.filterStats.version, 2);
  assert.equal(evidence.filterStats.retainedCount, 5);
  assert.equal(evidence.filterStats.eligibleCount, 1);
  assert.equal(evidence.filterStats.excludedCount, 0);
  assert.equal(evidence.filterStats.formalIneligibleCount, 4);
  assert.deepEqual(
    Object.fromEntries(Object.entries(evidence.filterStats.byReason)),
    { "aspice-unrelated": 1, heading: 1, information: 1, "image-only": 1 }
  );
  assert.equal(evidence.excludedItems, undefined);
  assert.deepEqual({ ...retained[0].formalEligibility }, { eligible: true, reason: "requirement" });
  assert.deepEqual({ ...retained[3].formalEligibility }, { eligible: false, reason: "aspice-unrelated" });

  harness.filterFormalEvidenceItems(evidence, items);
  assert.equal(evidence.filterStats.retainedCount, 5, "normalization must preserve all source references");
  assert.equal(evidence.filterStats.excludedCount, 0);
  assert.equal(evidence.excludedItems, undefined, "formal ineligibility is no longer a destructive import exclusion");
  assert.equal(evidence.filterStats.byReason.information, 1);
});

test("substantive Project Plan and Quality Plan process items pass the exception", () => {
  const harness = createFilterHarness();
  for (const name of ["Project Plan.docx", "Quality Assurance Plan.docx"]) {
    const evidence = { name };
    const item = {
      id: name,
      itemType: "process",
      text: "The project defines owners, milestones, quality activities, review checkpoints, and approval responsibilities.",
      locator: "Paragraph 8"
    };
    assert.equal(harness.formalEvidenceEligibility(item, evidence).eligible, true, name);
  }
  const shortPlanItem = { id: "short", itemType: "process", text: "Milestone plan.", locator: "Paragraph 1" };
  assert.deepEqual(
    { ...harness.formalEvidenceEligibility(shortPlanItem, { name: "Project Plan.docx" }) },
    { eligible: false, reason: "plan-process-insufficient-content" }
  );
});

test("explicit Information and Heading table classifications override requirement keywords", () => {
  const harness = createFilterHarness();
  const headers = ["Item Type", "Requirement"];
  assert.equal(harness.evidenceItemTypeFromTableRow(["Information", "SWE.1 shall review a process summary"], headers), "information");
  assert.equal(harness.evidenceItemTypeFromTableRow(["Heading", "SWE.1 verification"], headers), "heading");
  assert.equal(harness.evidenceItemTypeFromTableRow(["Requirement", "SWE.1 shall verify the software requirement"], headers), "requirement");
});

test("client formal-report provenance helpers neutralize training-deck source names and locators", () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext([
    "isTrainingDeckProvenance",
    "reportSafeEvidenceSource",
    "reportSafeEvidenceLocator",
    "reportSafeEvidenceExcerpt",
    "reportSafeNarrative"
  ].map(functionSource).join("\n"), sandbox);

  assert.equal(sandbox.isTrainingDeckProvenance("ASPICE Introduction Training Rev1.pptx"), true);
  assert.equal(sandbox.isTrainingDeckProvenance("Slide 12 / Page 4"), true);
  assert.equal(sandbox.reportSafeEvidenceSource("ASPICE Introduction Training Rev1.pptx"), "Assessor-confirmed evidence / 受控评估输入");
  assert.equal(sandbox.reportSafeEvidenceLocator("Slide 12 / Page 4"), "Evidence locator / 证据定位");
  assert.equal(sandbox.reportSafeEvidenceExcerpt("Training deck Slide 12 / Page 4"), "Controlled evidence excerpt / 受控证据摘录");
  assert.equal(sandbox.reportSafeEvidenceSource("Requirements baseline §2.3"), "Requirements baseline §2.3");
  assert.equal(sandbox.reportSafeNarrative("PPT Page 9: assessor explanation"), "待评估师确认");
  assert.equal(sandbox.reportSafeNarrative("Objective evidence is recorded in the requirements baseline."), "Objective evidence is recorded in the requirements baseline.");
});
