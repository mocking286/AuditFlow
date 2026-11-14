import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import "../evidence-catalog.js";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const catalog = globalThis.AuditFlowEvidenceCatalog;
const processCatalog = [
  ["SYS.1", "Requirements Elicitation"], ["SYS.2", "System Requirements Analysis"],
  ["SYS.3", "System Architectural Design"], ["SYS.4", "System Integration Verification"],
  ["SYS.5", "System Verification"], ["SWE.1", "Software Requirements Analysis"],
  ["SWE.2", "Software Architectural Design"], ["SWE.3", "Software Detailed Design"],
  ["SWE.4", "Software Unit Verification"], ["SWE.5", "Software Integration Verification"],
  ["SWE.6", "Software Verification"], ["MAN.3", "Project Management"],
  ["SUP.1", "Quality Assurance"], ["SUP.8", "Configuration Management"],
  ["SUP.9", "Problem Resolution Management"], ["SUP.10", "Change Request Management"]
].map(([id, en]) => ({ id, en, zh: `${id} name` }));

function functionSource(name) {
  const start = source.search(new RegExp(`^  (?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, `Missing ${name}`);
  const firstLineEnd = source.indexOf("\n", start);
  if (source.slice(start, firstLineEnd).trim().endsWith("}")) return source.slice(start, firstLineEnd);
  const end = source.indexOf("\n  }\n", start);
  assert.ok(end > start, `Could not isolate ${name}`);
  return source.slice(start, end + 5);
}

function createRecoveryHarness() {
  const sandbox = {
    window: { AuditFlowEvidenceCatalog: catalog },
    PROCESS_CATALOG: processCatalog,
    DOCUMENT_CLASSES: ["assessment-record", "requirements", "process-governance", "test", "traceability"].map(value => [value]),
    DOCUMENT_ITEM_TYPES: ["information", "requirement", "process", "heading"].map(value => [value]),
    db: { settings: { documentClassificationRules: [] } }
  };
  vm.createContext(sandbox);
  const helixConstants = source.slice(source.indexOf("  const HELIX_FIELD_GROUPS = "), source.indexOf("  const ICONS = "));
  vm.runInContext(helixConstants + [
    "normalizeCell", "processIdsFromText", "evidenceFileName", "evidenceSourceText",
    "isProjectOrQualityPlanEvidence", "aspiceProcessCandidates", "requirementLikeEvidenceItem",
    "formalEvidenceEligibility", "rememberEvidenceExclusions", "filterFormalEvidenceItems",
    "evidenceWordCount", "splitEvidenceText", "extractSourceRequirementId", "isEvidenceHeaderNoise",
    "humanEvidenceItemTitle", "evidenceItemTypeFromTableRow", "classifyAtomicEvidenceItem",
    "buildAtomicEvidenceItems", "tablesToEvidenceText", "restoreExcludedEvidenceItems",
    "matchingDocumentClassificationRule", "inferDocumentClass", "inferDocumentItemType",
    "ensureVisualEvidenceItems", "evidenceRank", "restoreTableHeaderEvidenceItems", "normalizeEvidenceAtomicItems",
    "uniqueHeaders", "helixFieldMatches", "classifyHelixStatus", "makeEvidenceTable",
    "parseDelimited", "summarizeHelixTables", "tableLocators", "parseEvidenceFile"
  ].map(functionSource).join("\n") + `
    EVIDENCE_PLAN_EXCEPTION = /(?:^|[\\s._-])(?:project|quality)[\\s._-]*(?:plan|management[\\s._-]*plan|assurance[\\s._-]*plan)|项目计划|质量计划/i;
  `, sandbox);
  return sandbox;
}

function requirementParagraphs(count = 8) {
  return Array.from({ length: count }, (_, index) => [
    { index: index * 2 + 1, locator: `Paragraph ${index * 2 + 1}`, text: `REQ-${101 + index}`, style: "" },
    { index: index * 2 + 2, locator: `Paragraph ${index * 2 + 2}`, text: `The motor shall reach speed ${1000 + index} rpm within ${200 + index} ms.`, style: "" }
  ]).flat();
}

function docxElement(name, content = [], attributes = {}) {
  const parts = Array.isArray(content) ? content : [content];
  const children = parts.filter(part => typeof part === "object");
  const node = {
    nodeType: 1, nodeName: name, tagName: name, localName: name.split(":").pop(),
    children, parentElement: null,
    get textContent() { return parts.map(part => typeof part === "string" ? part : part.textContent).join(""); },
    getAttribute(attribute) { return attributes[attribute] ?? null; },
    getAttributeNS(namespace, attribute) { return attributes[`r:${attribute}`] ?? null; },
    getElementsByTagName(tag) {
      return children.flatMap(child => [
        ...(tag === "*" || child.tagName === tag ? [child] : []),
        ...child.getElementsByTagName(tag)
      ]);
    }
  };
  children.forEach(child => { child.parentElement = node; });
  return node;
}

function docxText(value) {
  return docxElement("w:p", [docxElement("w:r", [docxElement("w:t", value)])]);
}

function createDocxHarness(tables) {
  const harness = createRecoveryHarness();
  const document = docxElement("document", [docxElement("w:body", tables)]);
  const relationships = docxElement("Relationships");
  // Node has no browser XML DOM. Keep its nested element surface real at the
  // parser boundary so the production DOCX traversal and item builder both run.
  harness.DOMParser = class {
    parseFromString(text) {
      if (text === "document fixture") return document;
      if (text === "relationships fixture") return relationships;
      throw new Error(`Unexpected DOCX XML fixture: ${text}`);
    }
  };
  const entries = {
    "word/document.xml": "document fixture",
    "word/_rels/document.xml.rels": "relationships fixture",
    "word/media/definition.png": new Uint8Array([137, 80, 78, 71])
  };
  harness.Blob = Blob;
  harness.JSZip = {
    loadAsync: async () => ({
      files: Object.fromEntries(Object.keys(entries).map(path => [path, { dir: false }])),
      file: path => path in entries ? { async: async () => entries[path] } : null
    })
  };
  vm.runInContext(["parseXml", "xmlElementText", "zipText", "imageMimeFromPath", "parseDocxPackage"].map(functionSource).join("\n"), harness);
  return harness;
}

test("complete product requirements remain available without ASPICE keywords or matching formal scope", () => {
  const harness = createRecoveryHarness();
  const evidence = {
    id: "EV-SYSTEM", code: "P.EV.0001", name: "System Requirements.docx",
    paragraphRecords: requirementParagraphs(12), atomicItems: []
  };
  const atoms = harness.normalizeEvidenceAtomicItems(evidence, ["SYS.2", "SWE.1"]);
  assert.equal(atoms.length, 12);
  assert.equal(evidence.retentionVersion, 2);
  assert.equal(evidence.filterStats.retainedCount, 12);
  assert.equal(atoms.every(item => item.primaryProcess === "SYS.2"), true);
  assert.equal(atoms.every(item => item.reviewed === false), true);
  assert.equal(atoms.every(item => !item.confirmed), true);
  assert.deepEqual(Array.from(atoms, item => item.externalId), Array.from({ length: 12 }, (_, index) => `REQ-${101 + index}`));
  const rows = catalog.buildEvidenceCatalog({ evidence: [evidence] }, { assignNumbers: true });
  assert.equal(rows.length, 12);
  assert.equal(catalog.filterEvidenceCatalog(rows, { query: "speed 1002" }).length, 1);
  assert.equal(catalog.filterEvidenceCatalog(rows, {}).length, 12);
});

test("legacy excluded paragraph sources recover with full text while existing assessor choices and trace IDs survive", () => {
  const harness = createRecoveryHarness();
  const paragraphs = requirementParagraphs(6);
  const original = {
    id: "ASSESSOR-ITEM", externalId: "REQ-101", text: paragraphs[1].text,
    title: "Assessor title", locator: "Paragraph 1", reviewed: true,
    evidenceRole: "corroborating", userAssignedProcess: "SYS.2",
    userAssignedDocumentClass: "requirements", userAssignedItemType: "requirement",
    catalogCode: "SYS.2.010", assessorNote: "Keep this reviewed judgment."
  };
  const evidence = {
    id: "EV-OLD", code: "P.EV.0002", name: "System Requirements.docx",
    atomicItems: [original], paragraphRecords: paragraphs,
    excludedItems: Array.from({ length: 5 }, (_, index) => ({
      id: `ITEM-${String(index + 2).padStart(4, "0")}`,
      externalId: `REQ-${102 + index}`, locator: `Paragraph ${index * 2 + 3}`,
      title: "Metadata cannot replace the original source", reason: "aspice-unrelated"
    }))
  };
  const traceLink = { evidenceId: "EV-OLD", itemId: "ASSESSOR-ITEM", confirmed: true, indicator: "SYS.2.BP1" };
  const normalized = harness.normalizeEvidenceAtomicItems(evidence, ["SYS.2"]);
  assert.equal(normalized.length, 6);
  const retainedOriginal = normalized.find(item => item.id === original.id);
  for (const field of ["id", "externalId", "text", "title", "locator", "reviewed", "evidenceRole",
    "userAssignedProcess", "userAssignedDocumentClass", "userAssignedItemType", "catalogCode", "assessorNote"]) {
    assert.deepEqual(retainedOriginal[field], original[field], field);
  }
  assert.equal(normalized.some(item => item.id === traceLink.itemId), true);
  assert.equal(normalized.slice(1).every(item => item.text.includes("The motor shall")), true);
  assert.equal(normalized.slice(1).every(item => item.reviewed === false), true);
  assert.equal(evidence.excludedItems.length, 5, "recovery preserves legacy import history");
  assert.equal(evidence.retentionRecovery.status, "reparsed");
  assert.equal(evidence.retentionRecovery.restoredCount, 5);
  const before = JSON.stringify(normalized);
  assert.equal(harness.normalizeEvidenceAtomicItems(evidence, ["SYS.2"]).length, 6);
  assert.equal(JSON.stringify(evidence.atomicItems), before, "recovery and normalization are idempotent");
});

test("table rows including information and design content remain itemized beside preserved whole tables", () => {
  const harness = createRecoveryHarness();
  const table = {
    name: "Architecture elements", location: "Table 2", headers: ["ID", "Item Type", "Description"],
    rows: [
      ["ARC-101", "Information", "Motor control receives the target speed from the command interface."],
      ["ARC-102", "Requirement", "The watchdog shall supervise the control task every 5 ms."],
      ["ARC-103", "Heading", "Controller interfaces"]
    ]
  };
  const evidence = {
    id: "EV-ARCH", code: "P.EV.0003", name: "Software Architecture.docx",
    preserveTables: true, tables: [table], atomicItems: [],
    excludedItems: [{ id: "OLD-2", title: "Discarded design context", reason: "information" }]
  };
  const atoms = harness.normalizeEvidenceAtomicItems(evidence, ["SWE.2"]);
  assert.equal(atoms.length, 3);
  assert.deepEqual(Array.from(atoms, item => item.itemType), ["information", "requirement", "heading"]);
  assert.equal(atoms.every(item => item.primaryProcess === "SWE.2"), true);
  assert.equal(atoms[0].formalEligibility.eligible, false);
  assert.equal(atoms[2].formalEligibility.eligible, false);
  assert.equal(evidence.tables[0], table);
  assert.equal(evidence.tables[0].rows.length, 3);
  const rows = catalog.buildEvidenceCatalog({ evidence: [evidence] });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.locator), ["Table 2 \u00b7 Row 1", "Table 2 \u00b7 Row 2", "Table 2 \u00b7 Row 3"]);
});

test("metadata-only legacy exclusions request the source instead of fabricating evidence", () => {
  const harness = createRecoveryHarness();
  const existing = { id: "A-OLD", externalId: "REQ-101", text: "Existing source.", locator: "Line 1" };
  const evidence = {
    id: "EV-NOSOURCE", atomicItems: [existing],
    excludedItems: [{ id: "MISSING", title: "Truncated title must not become a new requirement", locator: "Line 9" }]
  };
  assert.equal(harness.restoreExcludedEvidenceItems(evidence).length, 1);
  assert.equal(evidence.atomicItems[0], existing);
  assert.equal(evidence.retentionRecovery.status, "source-required");
  assert.equal(evidence.retentionRecovery.missingCount, 1);
});

test("legacy source text and paragraph aliases can both restore missing source atoms without identifier collisions", () => {
  const harness = createRecoveryHarness();
  for (const sourceFields of [
    { paragraphs: requirementParagraphs(3) },
    { content: "REQ-101\nThe motor shall start within 100 ms.\nREQ-102\nThe motor shall stop within 300 ms.\nREQ-103\nThe controller shall log a timeout." }
  ]) {
    const evidence = {
      id: "EV-ALT", name: "System Requirements.docx",
      ...sourceFields,
      atomicItems: [{ id: "ITEM-0002", externalId: "KEPT-900", title: "Existing assessor source", text: "An already reviewed source.", locator: "Other source", reviewed: true }],
      excludedItems: [{ id: "ITEM-0001", title: "Former exclusion", reason: "aspice-unrelated" }]
    };
    const restored = harness.restoreExcludedEvidenceItems(evidence, ["SYS.2"]);
    assert.equal(restored.length, 4);
    assert.equal(new Set(restored.map(item => item.id)).size, restored.length);
    assert.equal(restored[0].id, "ITEM-0002");
    assert.equal(restored[0].reviewed, true);
    assert.equal(restored.filter(item => item.externalId.startsWith("REQ-")).length, 3);
  }
});

test("recovery avoids identifiers already allocated by an earlier recovery", () => {
  const harness = createRecoveryHarness();
  const evidence = {
    id: "EV-RETRY", name: "System Requirements.docx", paragraphRecords: requirementParagraphs(2),
    atomicItems: [
      { id: "ITEM-0001", externalId: "OLD-801", text: "Reviewed source one.", locator: "Old source 1", reviewed: true },
      { id: "ITEM-RECOVERED-3", externalId: "OLD-802", text: "Reviewed source two.", locator: "Old source 2", reviewed: true }
    ],
    excludedItems: [{ id: "ITEM-0001", title: "Legacy metadata", reason: "aspice-unrelated" }]
  };
  const restored = harness.restoreExcludedEvidenceItems(evidence, ["SYS.2"]);
  assert.equal(restored.length, 4);
  assert.equal(new Set(restored.map(item => item.id)).size, restored.length, "existing recovered IDs remain unique trace references");
  assert.equal(restored[0].id, "ITEM-0001");
  assert.equal(restored[1].id, "ITEM-RECOVERED-3");
});

test("all engineering work-product sources retain their items and navigation classifications", () => {
  const harness = createRecoveryHarness();
  const definitions = [
    ["System Architecture.docx", "SYS.3", "system-architecture"],
    ["Software Requirements.docx", "SWE.1", "software-requirement"],
    ["Software Architecture.docx", "SWE.2", "software-architecture"],
    ["Software Detailed Design.docx", "SWE.3", "software-detail-design"],
    ["Software Test Plan.docx", "SWE.6", "test-plan"],
    ["Software Test Report.docx", "SWE.6", "test-report"]
  ];
  for (const [name, process, type] of definitions) {
    const evidence = {
      id: name, name,
      paragraphRecords: [
        { index: 1, locator: "Paragraph 1", text: "Input: speed command. Output: PWM duty cycle. Measured result: 75 percent." },
        { index: 2, locator: "Paragraph 2", text: "The control task executes every 5 ms." }
      ]
    };
    const atoms = harness.normalizeEvidenceAtomicItems(evidence, [process]);
    assert.equal(atoms.length, 2, name);
    assert.equal(atoms.every(item => item.primaryProcess === process), true, name);
    assert.equal(catalog.buildEvidenceCatalog({ evidence: [evidence] }).every(row => row.workProductType === type), true, name);
    assert.equal(atoms.every(item => item.reviewed === false), true, name);
  }
});

test("source tables retain every requirement row and columns beyond preview limits", () => {
  const harness = createRecoveryHarness();
  const headers = ["ID", ...Array.from({ length: 33 }, (_, index) => `Attribute ${index + 1}`), "Description"];
  const records = Array.from({ length: 180 }, (_, index) => [
    `REQ-${1000 + index}`, ...Array.from({ length: 33 }, (_, column) => `R${index}C${column}`),
    `The controller shall retain the final description END-${index}.`
  ]);
  const table = harness.makeEvidenceTable("System requirements", "DOCX", [headers, ...records], { preserveRows: true });
  assert.equal(table.rows.length, records.length);
  assert.equal(table.headers.length, headers.length);
  assert.equal(table.truncated, false);
  assert.equal(table.rows[179][34], records[179][34]);
  const evidence = { id: "EV-WIDE", name: "System Requirements.docx", tables: [table] };
  const atoms = harness.normalizeEvidenceAtomicItems(evidence, ["SYS.2"]);
  assert.equal(atoms.length, 180);
  assert.equal(atoms.some(item => item.externalId === "REQ-1179" && item.text.includes("END-179")), true);
});

test("full CSV import keeps requirement IDs after row 60 and the complete source body", async () => {
  const harness = createRecoveryHarness();
  const lines = ["ID,Description", ...Array.from({ length: 240 }, (_, index) =>
    `REQ-${2000 + index},The controller shall monitor signal CH-${index} within ${100 + index} ms.`
  )];
  const parsed = await harness.parseEvidenceFile({ name: "System Requirements.csv", text: async () => lines.join("\n") });
  const sourceIds = new Set(parsed.atomicItems.map(item => item.externalId).filter(Boolean));
  assert.equal(sourceIds.size, 240);
  assert.equal(sourceIds.has("REQ-2239"), true);
  assert.equal(parsed.content.includes("CH-239"), true);
  assert.equal(parsed.tables[0].rows.length, 240);
});

test("single-row exported requirement cards retain the complete definition and source requirement ID", () => {
  const harness = createRecoveryHarness();
  const cards = [
    { name: "Table 4", headers: ["SYS-1351", "General Overview The supplier SHALL implement the complete controller."], rows: [] },
    { name: "Table 183", headers: ["SYS-1244", "Operating temperature The fan SHALL operate between minus 40 and 105 degrees Celsius."], rows: [] },
    { name: "Table 200", headers: ["SYS-1889", "Test Coverage 3"], rows: [] }
  ];
  const evidence = { id: "EV-CARDS", name: "System Specification.docx", tables: cards };
  const atoms = harness.normalizeEvidenceAtomicItems(evidence, ["SYS.2"]);
  assert.equal(atoms.length, cards.length);
  assert.deepEqual(Array.from(atoms, item => item.externalId), ["SYS-1351", "SYS-1244", "SYS-1889"]);
  for (const [index, item] of atoms.entries()) {
    assert.equal(item.text.includes(cards[index].headers[1]), true);
    assert.equal(item.locator, `${cards[index].name} \u00b7 Source row 1`);
    assert.equal(item.itemType, "requirement");
    assert.equal(item.reviewed, false);
  }
});

test("nested DOCX definition cells appear once in source-card evidence while whole tables and images survive", async () => {
  const nested = docxElement("w:tbl", [
    docxElement("w:tr", [docxElement("w:tc", [docxText("Mode")]), docxElement("w:tc", [docxText("Response")])]),
    docxElement("w:tr", [docxElement("w:tc", [docxText("RUN")]), docxElement("w:tc", [docxText("The controller SHALL retain normal response.")])]),
    docxElement("w:tr", [docxElement("w:tc", [docxText("RUN")]), docxElement("w:tc", [docxText("The controller SHALL retain safe response.")])])
  ]);
  const card = docxElement("w:tbl", [docxElement("w:tr", [
    docxElement("w:tc", [docxText("SYS-1347")]),
    docxElement("w:tc", [docxText("Fan start"), nested, docxText("End of definition.")])
  ])]);
  const harness = createDocxHarness([card]);
  const parsed = await harness.parseDocxPackage({ name: "System Specification.docx", arrayBuffer: async () => new ArrayBuffer(0) });
  const sourceCard = parsed.items.filter(item => item.metadata.sourceTableHeaderRecord && item.externalId === "SYS-1347");
  assert.equal(sourceCard.length, 1);
  assert.equal(sourceCard[0].text, "SYS-1347 | Fan start Mode Response RUN The controller SHALL retain normal response. RUN The controller SHALL retain safe response. End of definition.");
  assert.equal(sourceCard[0].locator, "Table 1 \u00b7 Source row 1");
  assert.equal(parsed.tables.length, 2, "the nested table remains a whole-table resource");
  assert.equal(parsed.tables[0].rows.length, 3, "existing whole-table row inventory remains available");
  assert.equal(parsed.tables[1].rows[1][1], "The controller SHALL retain safe response.");
  assert.equal(parsed.visualAssets.length, 1);
  assert.equal(parsed.visualAssets[0].size, 4);
});

test("DOCX definition cards retain legitimate physical columns after the definition", async () => {
  const card = docxElement("w:tbl", [docxElement("w:tr", [
    docxElement("w:tc", [docxText("SYS-1351")]),
    docxElement("w:tc", [docxText("The controller SHALL supervise the fan.")]),
    docxElement("w:tc", [docxText("ASIL: QM")]),
    docxElement("w:tc", [docxText("Owner: Controls")])
  ])]);
  const harness = createDocxHarness([card]);
  const parsed = await harness.parseDocxPackage({ name: "System Specification.docx", arrayBuffer: async () => new ArrayBuffer(0) });
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].text, "SYS-1351 | The controller SHALL supervise the fan. | ASIL: QM | Owner: Controls");
  assert.equal(parsed.items[0].externalId, "SYS-1351");
  assert.deepEqual(Array.from(parsed.tables[0].headers), ["SYS-1351", "The controller SHALL supervise the fan.", "ASIL: QM", "Owner: Controls"]);
});

test("an already imported document recovers definition cards without replacing prior assessor atoms or links", () => {
  const harness = createRecoveryHarness();
  const original = {
    id: "REVIEWED-MATRIX-ROW", externalId: "SYS-1351-MATRIX", title: "Assessor title",
    text: "SYS-1351 (General Overview) | CUS-1099", locator: "Table 205 \u00b7 Row 1",
    reviewed: true, evidenceRole: "corroborating", itemType: "information",
    userAssignedItemType: "information", catalogCode: "SYS.2.017"
  };
  const evidence = {
    id: "EV-LEGACY-CARD", name: "System Specification.docx", retentionVersion: 2,
    atomicItems: [original],
    tables: [{ name: "Table 4", headers: ["SYS-1351", "The supplier SHALL implement the complete controller."], rows: [] }]
  };
  const atoms = harness.normalizeEvidenceAtomicItems(evidence, ["SYS.2"]);
  assert.equal(atoms.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(atoms[0])).title, original.title);
  assert.equal(atoms[0].id, original.id);
  assert.equal(atoms[0].itemType, "information");
  assert.equal(atoms[0].catalogCode, "SYS.2.017");
  assert.equal(atoms[1].externalId, "SYS-1351");
  assert.equal(atoms[1].text.includes("complete controller"), true);
  assert.equal(new Set(atoms.map(item => item.id)).size, 2);
  const snapshot = JSON.stringify(atoms);
  harness.normalizeEvidenceAtomicItems(evidence, ["SYS.2"]);
  assert.equal(JSON.stringify(evidence.atomicItems), snapshot);
});

test("a restored definition card stays removed after an assessor removes it", () => {
  const harness = createRecoveryHarness();
  const evidence = {
    id: "EV-REMOVED-CARD", name: "System Specification.docx",
    atomicItems: [{ id: "EXISTING", title: "Retain this reviewed source", text: "Existing source.", locator: "Paragraph 1" }],
    tables: [{ name: "Table 4", headers: ["SYS-1351", "The controller SHALL supervise the fan."], rows: [] }]
  };
  harness.normalizeEvidenceAtomicItems(evidence, ["SYS.2"]);
  assert.equal(evidence.atomicItems.length, 2);
  evidence.atomicItems = evidence.atomicItems.filter(item => item.externalId !== "SYS-1351");
  const reloaded = JSON.parse(JSON.stringify(evidence));
  harness.normalizeEvidenceAtomicItems(reloaded, ["SYS.2"]);
  assert.equal(reloaded.atomicItems.length, 1);
  assert.equal(reloaded.atomicItems[0].id, "EXISTING");
  reloaded.atomicItems = [];
  harness.normalizeEvidenceAtomicItems(reloaded, ["SYS.2"]);
  assert.equal(reloaded.atomicItems.length, 0);
});

test("orphan architecture diagrams remain index-only catalog sources across normalization", () => {
  const harness = createRecoveryHarness();
  const evidence = {
    id: "EV-DIAGRAM", name: "System Architecture.docx",
    visualAssets: [{ id: "DIAGRAM-1", name: "control-interfaces.png" }],
    atomicItems: [{ id: "ARCH-1", title: "Interface connections", text: "The control unit receives the speed command.", locator: "Paragraph 1" }]
  };
  const atoms = harness.normalizeEvidenceAtomicItems(evidence, ["SYS.3"]);
  assert.equal(atoms.length, 2);
  const diagram = atoms.find(item => item.visualOnly);
  assert.ok(diagram);
  assert.equal(diagram.evidenceRole, "index-only");
  assert.equal(diagram.reviewed, false);
  assert.equal(diagram.formalEligibility.eligible, false);
  assert.deepEqual(Array.from(diagram.visualAssetIds), ["DIAGRAM-1"]);
  assert.equal(catalog.buildEvidenceCatalog({ evidence: [evidence] }).length, 2);
  assert.equal(harness.normalizeEvidenceAtomicItems(evidence, ["SYS.3"]).length, 2);
});

test("architecture and verification document context outranks generic requirement ID prefixes", () => {
  const harness = createRecoveryHarness();
  for (const [name, process] of [
    ["System Architecture.docx", "SYS.3"],
    ["Software Architecture.docx", "SWE.2"],
    ["Software Detailed Design.docx", "SWE.3"],
    ["Software Unit Test Report.docx", "SWE.4"],
    ["Software Integration Test Plan.docx", "SWE.5"],
    ["Software Test Report.docx", "SWE.6"]
  ]) {
    const externalId = process.startsWith("SYS") ? "SYS-301" : "SWE-301";
    const item = harness.classifyAtomicEvidenceItem({ externalId, text: "Control unit interface connections and observed behavior." }, name, [process]);
    assert.equal(item.primaryProcess, process, name);
    assert.equal(item.reviewed, false, name);
    const assigned = harness.classifyAtomicEvidenceItem({ externalId, text: item.text, userAssignedProcess: "SUP.8", reviewed: true }, name, [process, "SUP.8"]);
    assert.equal(assigned.primaryProcess, "SUP.8", "assessor classification keeps precedence");
    assert.equal(assigned.reviewed, true);
  }
});
