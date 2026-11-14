import assert from "node:assert/strict";
import { test } from "node:test";
import "../evidence-catalog.js";

const catalog = globalThis.AuditFlowEvidenceCatalog;

function productProject() {
  return {
    id: "P-PUMP",
    processes: ["SYS.2", "SWE.1"],
    instances: [{ id: "PUMP-01", name: "Coolant pump" }],
    evidence: [{
      id: "EV-SYS",
      code: "P-PUMP.EV.0001",
      name: "System_Requirements.docx",
      primaryProcesses: [{ id: "SYS.2", title: "System Requirements Analysis" }],
      instanceId: "PUMP-01",
      atomicItems: [
        { id: "ATOM-01", externalId: "REQ-101", itemType: "requirement", title: "Speed control", text: "The motor shall reach the target speed within 200 ms.", locator: "Paragraph 12", evidenceRole: "direct", reviewed: true },
        { id: "ATOM-02", externalId: "REQ-102", itemType: "requirement", title: "PWM output", text: "The PWM frequency shall remain at 20 kHz.", locator: "Table 1 Row 4", evidenceRole: "corroborating", relatedProcesses: [{ processId: "SWE.1" }] },
        { id: "ATOM-03", externalId: "REQ-103", itemType: "requirement", title: "Thermal limit", text: "The motor shall stop when the measured temperature exceeds 150 C.", locator: "Paragraph 18", evidenceRole: "direct", confirmed: false },
        { id: "ATOM-04", externalId: "REQ-104", itemType: "requirement", title: "Diagnostics", text: "The controller shall store a diagnostic fault after a sensor timeout.", locator: "Paragraph 20", evidenceRole: "index-only" },
        { id: "CONTEXT-01", itemType: "information", text: "The nominal supply voltage is 12 V.", locator: "Paragraph 2", evidenceRole: "index-only" },
        { id: "HEADING-01", itemType: "heading", title: "1.2 Operating conditions", locator: "Paragraph 1", evidenceRole: "index-only" }
      ]
    }]
  };
}

test("retention preserves every parsed product requirement and context item", () => {
  const project = productProject();
  const atoms = project.evidence[0].atomicItems;
  const retained = catalog.retainEvidenceItems(atoms);
  assert.equal(retained.length, 6);
  assert.notEqual(retained, atoms);
  retained.forEach((item, index) => assert.equal(item, atoms[index]));
  const before = structuredClone(project);
  const rows = catalog.buildEvidenceCatalog(project);
  assert.equal(rows.length, 6);
  assert.deepEqual(project, before, "a read-only catalog must not mutate source or formal scope");
  assert.deepEqual(rows.map(row => row.externalId), ["REQ-101", "REQ-102", "REQ-103", "REQ-104", "", ""]);
  assert.equal(rows[4].itemType, "information");
  assert.equal(rows[4].reviewed, false);
  assert.equal(rows[4].evidenceRole, "index-only");
  assert.equal(rows[5].workProductType, "heading");
  assert.equal(rows[2].confirmed, false);
});

test("process records and display labels normalize without object stringification", () => {
  assert.equal(catalog.normalizeProcessId({ id: "SYS.2", title: "System requirements" }), "SYS.2");
  assert.equal(catalog.normalizeProcessId({ processId: "SWE-3" }), "SWE.3");
  assert.equal(catalog.normalizeProcessId({ primaryProcess: { code: "SUP10" } }), "SUP.10");
  assert.equal(catalog.normalizeProcessId("SYS.2 \u00b7 System Requirements Analysis"), "SYS.2");
  assert.equal(catalog.normalizeProcessId("[object Object]"), "");
  assert.equal(catalog.normalizeProcessId("SYS-1234"), "");
  const circular = {};
  circular.process = circular;
  assert.equal(catalog.normalizeProcessId(circular), "");
  assert.deepEqual(catalog.normalizeProcessIds(["SYS.2", { id: "SYS-2" }, { code: "SWE.1" }]), ["SYS.2", "SWE.1"]);
});

test("catalog assigns stable process numbers without changing source identifiers", () => {
  const project = productProject();
  const original = structuredClone(project);
  let rows = catalog.buildEvidenceCatalog(project, { assignNumbers: true });
  assert.deepEqual(rows.map(row => row.catalogCode), ["SYS.2.001", "SYS.2.002", "SYS.2.003", "SYS.2.004", "SYS.2.005", "SYS.2.006"]);
  assert.equal(rows.filter(row => row.externalId === "REQ-102").length, 1, "related processes must not duplicate the source item");
  assert.deepEqual(rows[1].relatedProcesses, ["SWE.1"]);
  const filtered = catalog.filterEvidenceCatalog(rows, { process: "SWE.1" });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].catalogCode, "SYS.2.002");
  project.evidence[0].atomicItems.unshift({
    id: "ATOM-NEW", externalId: "REQ-105", itemType: "requirement",
    text: "The controller shall record the restart counter.", locator: "Paragraph 21"
  });
  rows = catalog.buildEvidenceCatalog(project, { assignNumbers: true });
  assert.equal(rows[0].catalogCode, "SYS.2.007");
  assert.equal(rows[2].catalogCode, "SYS.2.002");
  const restored = JSON.parse(JSON.stringify(project));
  assert.deepEqual(
    catalog.buildEvidenceCatalog(restored).map(row => row.catalogCode),
    rows.map(row => row.catalogCode)
  );
  project.evidence[0].atomicItems.slice(1).forEach((item, index) => {
    const { catalogCode, ...unchanged } = item;
    assert.ok(catalogCode);
    assert.deepEqual(unchanged, original.evidence[0].atomicItems[index]);
  });
  assert.equal(project.evidence[0].code, original.evidence[0].code);
  assert.deepEqual(project.processes, original.processes);
});

test("number collisions and unclassified items receive unique display aliases", () => {
  const project = {
    evidence: [{
      id: "EV-1", atomicItems: [
        { id: "A", primaryProcess: "SYS.2", catalogCode: "SYS.2.004", text: "Same text", locator: "Paragraph 1" },
        { id: "B", primaryProcess: "SYS.2", catalogCode: "SYS.2.004", text: "Same text", locator: "Paragraph 2" },
        { id: "C", text: "Unclassified source" }
      ]
    }]
  };
  const rows = catalog.buildEvidenceCatalog(project, { assignNumbers: true });
  assert.deepEqual(rows.map(row => row.catalogCode), ["SYS.2.004", "SYS.2.005", "UNCLASSIFIED.001"]);
  assert.equal(rows.length, 3);
  assert.equal(rows[2].process, "UNCLASSIFIED");
  assert.deepEqual(catalog.filterEvidenceCatalog(rows, { process: "UNCLASSIFIED" }).map(row => row.id), ["C"]);
});

test("requested engineering work products include test reports as itemized categories", () => {
  const definitions = [
    ["System Requirements.docx", "SYS.2", "system-requirement"],
    ["System Architecture.docx", "SYS.3", "system-architecture"],
    ["Software Requirements.docx", "SWE.1", "software-requirement"],
    ["Software Architecture.docx", "SWE.2", "software-architecture"],
    ["Software Detailed Design.docx", "SWE.3", "software-detail-design"],
    ["Software Test Plan.docx", "SWE.6", "test-plan"],
    ["Software Test Case.docx", "SWE.6", "test-case"],
    ["Software Test Report.docx", "SWE.6", "test-report"],
    ["\u7cfb\u7edf\u6d4b\u8bd5\u62a5\u544a.docx", "SYS.5", "test-report"]
  ];
  const project = { evidence: definitions.map(([name, process], index) => ({
    id: `EV-${index}`, name, primaryProcesses: [process],
    atomicItems: [{ id: `A-${index}`, text: "Measured output: 2500 rpm; pass.", evidenceRole: "corroborating" }]
  })) };
  const before = structuredClone(project);
  const rows = catalog.buildEvidenceCatalog(project);
  assert.deepEqual(rows.map(row => row.workProductType), definitions.map(([, , type]) => type));
  assert.equal(catalog.filterEvidenceCatalog(rows, { type: "test-report" }).length, 2);
  assert.equal(rows.every(row => row.reviewed === false), true);
  assert.equal(rows.every(row => !("formalRating" in row) && !("confirmed" in row)), true);
  assert.deepEqual(project, before);
  assert.equal(catalog.classifyWorkProduct({ userAssignedItemType: "information" }, { name: "Software Requirements.docx" }, "SWE.1"), "information");
});

test("display filters search source references, text, process, type, role and instance without source writes", () => {
  const project = productProject();
  const rows = catalog.buildEvidenceCatalog(project, { assignNumbers: true });
  const before = JSON.stringify(project);
  const searches = [
    ["System_Requirements", 6], ["REQ-102", 1], ["PWM", 1],
    ["20 kHz", 1], ["SWE.1", 1], ["Paragraph 18", 1],
    ["system-requirement", 5], ["corroborating", 1], ["Coolant pump", 6]
  ];
  for (const [query, count] of searches) {
    assert.equal(catalog.filterEvidenceCatalog(rows, { query }).length, count, query);
  }
  assert.equal(catalog.filterEvidenceCatalog(rows, { process: "SYS.2", role: "direct", source: "EV-SYS", instance: "PUMP-01" }).length, 2);
  assert.equal(catalog.filterEvidenceCatalog(rows, { query: "never-present" }).length, 0);
  assert.equal(catalog.filterEvidenceCatalog(rows, {}).length, rows.length, "clearing filters restores the complete retained catalog");
  assert.equal(JSON.stringify(project), before);
});

test("empty atomic collections retain a document-level source row", () => {
  const project = { evidence: [{ id: "DOC-1", code: "EV.001", name: "Unparsed.pdf", atomicItems: [], content: "Original source content." }] };
  const rows = catalog.buildEvidenceCatalog(project, { assignNumbers: true });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].isDocumentLevel, true);
  assert.equal(rows[0].catalogCode, "UNCLASSIFIED.001");
  assert.equal(rows[0].sourceEvidenceId, "DOC-1");
  assert.equal(rows[0].itemId, "");
  assert.equal(rows[0].text, "Original source content.");
  assert.equal(rows[0].evidenceRole, "index-only");
  assert.equal(project.evidence[0].catalogCode, "UNCLASSIFIED.001");
});

test("legacy metadata exclusions signal source reconstruction without inventing missing evidence", () => {
  const evidence = {
    atomicItems: [{ id: "R-1", itemType: "requirement", text: "A surviving requirement." }],
    excludedItems: [{ id: "OLD-1", title: "Truncated title", locator: "Paragraph 7", reason: "aspice-unrelated" }],
    paragraphRecords: [{ index: 7, text: "The complete original requirement shall be retained." }],
    content: "The complete original requirement shall be retained.",
    tables: [{ rows: [["REQ-1", "Original requirement"]] }]
  };
  const before = structuredClone(evidence);
  const summary = catalog.summarizeEvidenceRetention(evidence);
  assert.equal(summary.retainedCount, 1);
  assert.equal(summary.metadataOnlyExcludedCount, 1);
  assert.equal(summary.missingSourceItemCount, 1);
  assert.equal(summary.needsSourceReparse, true);
  assert.deepEqual(summary.recoveryInputs, ["paragraphRecords", "tables", "content"]);
  assert.equal(summary.requiresSourceFile, false);
  assert.equal(catalog.buildEvidenceCatalog({ evidence: [evidence] }).length, 1, "metadata-only exclusions cannot be passed off as restored source text");
  assert.deepEqual(evidence, before);
  assert.equal(catalog.summarizeEvidenceRetention({ excludedItems: [{ title: "Metadata only" }] }).requiresSourceFile, true);
  const recovered = {
    ...evidence,
    atomicItems: [...evidence.atomicItems, { id: "REPARSED-ID", text: "The complete original requirement shall be retained.", locator: "Paragraph 7" }]
  };
  assert.equal(catalog.summarizeEvidenceRetention(recovered).needsSourceReparse, false, "a restored locator must not trigger repeated reparsing");
  assert.equal(catalog.summarizeEvidenceRetention(recovered).metadataOnlyExcludedCount, 1, "legacy exclusion history remains intact");
});
