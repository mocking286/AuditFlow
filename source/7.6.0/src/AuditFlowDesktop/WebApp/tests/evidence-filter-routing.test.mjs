import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import "../evidence-catalog.js";

const catalog = globalThis.AuditFlowEvidenceCatalog;
const routing = await import("../upload-routing.mjs").catch(() => ({}));
const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");

function appFunction(name) {
  const start = appSource.search(new RegExp(`^  (?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, `Missing ${name}`);
  const end = appSource.indexOf("\n  }\n", start);
  return appSource.slice(start, end + 5);
}

test("Tree selectors combine process, type, role, attribute, source and instance without editing evidence", () => {
  assert.equal(typeof catalog.filterEvidenceRows, "function");
  const rows = [
    { id: "A", externalId: "REQ-01", primaryProcess: "SYS.2", relatedProcesses: ["SWE.1"], workProductType: "system-requirement", evidenceRole: "direct", reviewed: true, locator: "Table 1 Row 2", sourceEvidenceId: "EV-1", instanceIds: ["PUMP"], attributes: { baseline: "B1" } },
    { id: "B", externalId: "REQ-02", primaryProcess: "SYS.2", workProductType: "system-requirement", evidenceRole: "corroborating", reviewed: false, locator: "Paragraph 4", sourceEvidenceId: "EV-1", instanceIds: ["PUMP"] },
    { id: "C", primaryProcess: "SWE.6", workProductType: "test-report", evidenceRole: "direct", reviewed: false, locator: "Page 7", sourceEvidenceId: "EV-2", instanceIds: ["FAN"] }
  ];
  const before = structuredClone(rows);
  const selected = catalog.filterEvidenceRows(rows, { process: "SWE.1", type: "system-requirement", role: "direct", attribute: "reviewed", source: "EV-1", instance: "PUMP" });
  assert.deepEqual(selected.map(row => row.id), ["A"]);
  assert.equal(selected[0], rows[0]);
  assert.deepEqual(catalog.filterEvidenceRows(rows, { attribute: "unreviewed" }).map(row => row.id), ["B", "C"]);
  assert.deepEqual(catalog.filterEvidenceRows(rows, { attribute: { key: "baseline", value: "B1" } }).map(row => row.id), ["A"]);
  assert.deepEqual(catalog.filterEvidenceRows(rows, { attribute: "missing-locator" }), []);
  assert.deepEqual(rows, before);
});

test("upload classification distinguishes requirements, tests and project information as unconfirmed evidence candidates", () => {
  assert.equal(typeof routing.classifyUploadedFile, "function");
  const cases = [
    ["System Requirements.docx", { content: "REQ-1 The controller shall issue a diagnostic event.", atomicItems: [{ itemType: "requirement" }] }, "requirement"],
    ["Verification_Report.pdf", { content: "TC-1 expected 20 ms; actual 18 ms; result PASS." }, "test"],
    ["Project Overview.docx", { content: "Project organization, product overview and contact list." }, "project-information"]
  ];
  for (const [name, parsed, kind] of cases) {
    const result = routing.classifyUploadedFile({ name, parsed: { ...parsed, parseStatus: "parsed" } });
    assert.equal(result.kind, kind);
    assert.equal(result.candidateOnly, true);
    assert.equal(result.reviewed, false);
    assert.equal(routing.routeUploadClassification(result), "evidence-candidate");
  }
});

function issueUpload() {
  return {
    name: "TUV Issue Ledger.xlsx",
    parsed: {
      parseStatus: "parsed",
      content: "Imported issue table",
      sheetRows: [{
        name: "Issues",
        rows: [
          ["Assessment issue ledger"],
          ["Issue No", "Description", "Process", "Owner", "Due Date", "Status"],
          ["ISS-21", "No approved baseline found", "SUP.8", "Assessor", "2026-12-01", "Closed"]
        ]
      }]
    }
  };
}

test("real issue tables route only to local issue candidates with source locators and no formal closure", () => {
  assert.equal(typeof routing.classifyUploadedFile, "function");
  const upload = issueUpload();
  const before = structuredClone(upload);
  const classified = routing.classifyUploadedFile(upload);
  assert.equal(classified.kind, "issue");
  assert.equal(routing.routeUploadClassification(classified), "issue-candidate");
  const rows = routing.extractIssueCandidates({ ...upload, jobId: "JOB-1", attachmentId: "ATT-1" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].issueNo, "ISS-21");
  assert.equal(rows[0].sourceStatus, "Closed");
  assert.equal(rows[0].status, "open", "a source Closed cell cannot close an assessor NC");
  assert.equal(rows[0].sourceCell, "Issues!row 3");
  assert.equal(rows[0].sourceAttachmentId, "ATT-1");
  assert.equal(rows[0].candidateOnly, true);
  assert.equal(rows[0].assessorConfirmed, false);
  assert.equal(rows[0].evidenceRole, "corroborating");
  assert.equal(rows[0].jiraFlowSyncState, "not-submitted");
  assert.equal(rows[0].selectedProcess, "");
  assert.deepEqual(rows[0].processCandidates, ["SUP.8"]);
  assert.deepEqual(upload, before);
});

test("classified issue queue is idempotent and separate from evidence, NCs and formal report action plans", () => {
  const context = { UploadRouting: routing };
  vm.createContext(context);
  vm.runInContext(`${appFunction("queueUploadIssueCandidates")}; globalThis.queue = queueUploadIssueCandidates;`, context);
  const project = { evidence: [{ id: "EV1" }], assessments: [{ rating: "F", reviewed: true }], ncRecords: [], actionPlanIssues: [] };
  const formal = structuredClone(project);
  const upload = issueUpload();
  const args = [project, { name: upload.name }, upload.parsed, { jobId: "J1" }, { index: 0, attachmentId: "ATT1" }];
  assert.equal(context.queue(...args), 1);
  assert.equal(context.queue(...args), 0);
  assert.equal(project.uploadIssueCandidates.length, 1);
  assert.equal(project.uploadIssueCandidates[0].candidateOnly, true);
  for (const key of Object.keys(formal)) assert.deepEqual(project[key], formal[key]);
  assert.match(appSource, /actionPlanIssues: \[\.\.\.\(project\.actionPlanIssues \|\| \[\]\), \.\.\.project\.uploadIssueCandidates\]/);
});

test("mentions of issues in requirements are not issue tables, and failed or ambiguous parsing needs review", () => {
  assert.equal(typeof routing.classifyUploadedFile, "function");
  const requirement = routing.classifyUploadedFile({
    name: "Requirements.xlsx",
    parsed: { parseStatus: "parsed", sheetRows: [{ name: "Requirements", rows: [["ID", "Description", "Status"], ["REQ-1", "The controller shall issue an alarm.", "Draft"]] }] }
  });
  assert.equal(requirement.kind, "requirement");
  assert.equal(routing.routeUploadClassification(requirement), "evidence-candidate");
  for (const upload of [
    { name: "System Requirements.docx", parsed: { parseStatus: "failed", content: "" } },
    { name: "unknown.bin", mime: "application/octet-stream", parsed: { content: "" } }
  ]) {
    assert.equal(routing.routeUploadClassification(routing.classifyUploadedFile(upload)), "review-required");
  }
});

test("explicit requirement filenames outrank incidental verification vocabulary", () => {
  const result = routing.classifyUploadedFile({ name: "System Requirements.docx", parsed: { parseStatus: "parsed", content: "The controller shall stop within 10 ms. Verification method: test." } });
  assert.equal(result.kind, "requirement");
});

test("the upload handler retains a stable target and stages a TUV issue table without evidence or remote writes", async () => {
  const upload = issueUpload();
  const sourceFile = { name: upload.name, size: 256, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  const project = { id: "P1", name: "Assessment", evidence: [], assessments: [{ rating: "F", reviewed: true }], actionPlanIssues: [], ncRecords: [] };
  const other = { id: "P2", evidence: [] };
  const snapshot = structuredClone(project);
  let syncCalls = 0;
  const saved = [];
  const context = {
    UploadRouting: routing,
    ui: { evidenceTarget: { type: "standard", id: "P1" } },
    db: { uploadJobs: [], activity: [], settings: {} },
    runningUploadJobs: new Set(),
    scheduleUploadProject: routing.createUploadScheduler(),
    getContainer: (_, id) => id === "P1" ? project : other,
    requireCollaborationRole: () => true, id: () => "JOB1",
    storeUploadSource: async (_, entry, file) => { entry.sourceStored = true; return file; },
    parseEvidenceFile: async () => { context.ui.evidenceTarget.id = "P2"; return upload.parsed; },
    saveNow: () => saved.push(structuredClone(context.db.uploadJobs)),
    renderUploadProgress() {}, drawerRoot: { querySelector: () => null },
    window: { TuvIssueLedgerGuard: { isTuvAuditIssueLedger: () => true } },
    uiText: (_, en) => en, uploadStatusLabel: value => value,
    touchCollaboration() {}, render() {}, toast() {},
    syncEvidenceToFileAnalyst: async () => { syncCalls++; }
  };
  vm.createContext(context);
  vm.runInContext([appFunction("queueUploadIssueCandidates"), appFunction("handleEvidenceFiles"), "globalThis.upload = handleEvidenceFiles;"].join(String.fromCharCode(10)), context);
  const result = await context.upload([sourceFile]);
  assert.equal(result.issueCandidateCount, 1);
  assert.equal(result.evidenceCount, 0);
  assert.equal(syncCalls, 0);
  assert.equal(project.uploadIssueCandidates.length, 1);
  assert.equal(other.uploadIssueCandidates, undefined);
  assert.equal(context.db.uploadJobs[0].status, "complete");
  assert.equal(context.db.uploadJobs[0].files[0].sourceStored, true);
  assert.ok(saved.length > 2);
  for (const key of Object.keys(snapshot)) assert.deepEqual(project[key], snapshot[key]);
  upload.parsed.sheetRows.push({ name: "Requirements", rows: [["Requirement ID", "Description"], ["REQ-3", "The controller shall stop."]] });
  context.ui.evidenceTarget = { type: "standard", id: "P1" };
  const mixed = await context.upload([sourceFile]);
  assert.equal(mixed.issueCandidateCount, 0, "mixed issue and requirement data must remain available for explicit classification review");
  assert.equal(context.db.uploadJobs[0].status, "review-required");
  assert.equal(context.db.uploadJobs[0].files[0].evidenceBlocked, true);
});

test("mixed issue and engineering worksheets require review so retained requirements are not discarded", () => {
  assert.equal(typeof routing.classifyUploadedFile, "function");
  const upload = issueUpload();
  upload.parsed.sheetRows.push({ name: "Requirements", rows: [["Requirement ID", "Description"], ["REQ-2", "The controller shall start within 200 ms."]] });
  assert.equal(routing.routeUploadClassification(routing.classifyUploadedFile(upload)), "review-required");
});

test("cancelling the first parse retains every original file so a reloaded job can retry the rest", async () => {
  const stored = [];
  const project = { id: "P1", name: "Assessment", evidence: [] };
  const context = {
    UploadRouting: routing, ui: { evidenceTarget: { type: "standard", id: "P1" } },
    db: { uploadJobs: [], activity: [], settings: {} },
    runningUploadJobs: new Set(), scheduleUploadProject: routing.createUploadScheduler(),
    getContainer: () => project, requireCollaborationRole: () => true, id: () => "J-CANCEL",
    storeUploadSource: async (_, entry, file) => { if (!entry.sourceStored) stored.push(entry.index); entry.sourceStored = true; return file; },
    parseEvidenceFile: async () => { context.db.uploadJobs[0].cancelRequested = true; return {}; },
    saveNow() {}, renderUploadProgress() {}, drawerRoot: { querySelector: () => null },
    uiText: (_, en) => en, uploadStatusLabel: value => value, render() {}, toast() {}
  };
  vm.createContext(context);
  vm.runInContext(`${appFunction("handleEvidenceFiles")}; globalThis.upload = handleEvidenceFiles;`, context);
  await context.upload([{ name: "a.txt" }, { name: "b.txt" }]);
  assert.deepEqual(stored, [0, 1]);
  assert.equal(context.db.uploadJobs[0].status, "cancelled");
  assert.deepEqual(routing.retryUploadFileIndexes(context.db.uploadJobs[0]), [0, 1]);
});

test("upload job progress survives JSON persistence and retries only unfinished files", () => {
  assert.equal(typeof routing.createUploadJob, "function");
  const job = routing.createUploadJob({ jobId: "J1", projectId: "P1", targetType: "standard", files: [{ name: "a.docx", size: 12 }, { name: "b.pdf", size: 24 }] });
  routing.updateUploadJob(job, { stage: "routing", fileIndex: 0, fileStatus: "complete", route: "evidence-candidate" });
  const event = routing.uploadProgressEvent(job);
  assert.deepEqual(event, { jobId: "J1", stage: "routing", completed: 1, total: 2, status: "running" });
  const restored = routing.recoverUploadJobs(JSON.parse(JSON.stringify([job])));
  assert.equal(restored[0].status, "interrupted");
  assert.deepEqual(routing.retryUploadFileIndexes(restored[0]), [1]);
  assert.equal(restored[0].files[0].status, "complete");
  assert.equal(restored[0].projectId, "P1");
});

test("jobs for one project execute in order while another project can proceed", async () => {
  assert.equal(typeof routing.createUploadScheduler, "function");
  const schedule = routing.createUploadScheduler();
  const events = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = schedule("P1", async () => { events.push("first-start"); await gate; events.push("first-end"); });
  const second = schedule("P1", async () => events.push("second"));
  await schedule("P2", async () => events.push("other"));
  assert.deepEqual(events, ["first-start", "other"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first-start", "other", "first-end", "second"]);
});

test("an active upload prevents cloud polling from replacing its project", () => {
  const context = { db: { uploadJobs: [{ projectId: "P1", status: "running" }] } };
  vm.createContext(context);
  vm.runInContext(`${appFunction("hasPendingProjectChanges")}; globalThis.pending = hasPendingProjectChanges;`, context);
  assert.equal(context.pending({ id: "P1" }), true);
  assert.equal(context.pending({ id: "P2" }), false);
  context.db.uploadJobs[0].status = "complete";
  assert.equal(context.pending({ id: "P1" }), false);
});

test("cancellation after parsing never routes the current file, and retry keeps prior completed files", async () => {
  assert.equal(typeof routing.runUploadJob, "function");
  const job = routing.createUploadJob({ jobId: "J2", projectId: "P1", files: [{ name: "a.txt" }, { name: "b.txt" }] });
  const routed = [];
  await routing.runUploadJob(job, {
    parse: async (_, index) => {
      if (index === 1) job.cancelRequested = true;
      return { parseStatus: "parsed", content: "Project overview." };
    },
    route: async (_, index) => { routed.push(index); return { route: "evidence-candidate" }; }
  });
  assert.deepEqual(routed, [0]);
  assert.equal(job.status, "cancelled");
  assert.deepEqual(routing.retryUploadFileIndexes(job), [1]);
  await routing.runUploadJob(job, {
    parse: async () => ({ parseStatus: "parsed", content: "Project overview." }),
    route: async (_, index) => { routed.push(index); return { route: "evidence-candidate" }; }
  });
  assert.deepEqual(routed, [0, 1]);
  assert.equal(job.status, "complete");
  assert.equal(job.completed, 2);
});

test("per-file errors remain retryable while other upload files can complete", async () => {
  assert.equal(typeof routing.runUploadJob, "function");
  const job = routing.createUploadJob({ jobId: "J3", projectId: "P1", files: [{ name: "bad.pdf" }, { name: "good.txt" }] });
  const events = [];
  await routing.runUploadJob(job, {
    parse: async (_, index) => {
      if (!index) throw new Error("PDF parser unavailable");
      return { content: "Project overview", parseStatus: "parsed" };
    },
    route: async () => ({ route: "evidence-candidate" }),
    onProgress: event => events.push(event)
  });
  assert.equal(job.status, "error");
  assert.equal(job.files[0].error, "PDF parser unavailable");
  assert.equal(job.files[1].status, "complete");
  assert.deepEqual(routing.retryUploadFileIndexes(job), [0]);
  assert.equal(events.at(-1).completed, 1);
});

test("active Tree uses its project-scoped funnel selector without mutating assessor state", () => {
  const start = appSource.indexOf("  function filterTreeEvidenceRows(");
  assert.ok(start >= 0, "active Tree selector must be implemented");
  const end = appSource.indexOf("\n  function ", start + 5);
  const fn = appSource.slice(start, end);
  const context = {
    window: { AuditFlowEvidenceCatalog: catalog },
    treeV10: { onlyLinked: false, evidenceFilters: { P1: { process: "SUP.8", attribute: "unreviewed" } } },
    ui: { traceEvidenceSearch: "" },
    traceLinkMatchesDocumentItem: (link, item) => link.evidenceItemId === item.id
  };
  vm.createContext(context);
  vm.runInContext(`${fn}; globalThis.select = filterTreeEvidenceRows;`, context);
  const rows = [{ id: "A", primaryProcess: "SUP.8", reviewed: false }, { id: "B", primaryProcess: "SYS.2", reviewed: true }];
  const project = { id: "P1", assessments: [{ rating: "F", reviewed: true }] };
  const original = structuredClone(project);
  assert.deepEqual(Array.from(context.select(rows, project, []), row => row.id), ["A"]);
  context.treeV10.onlyLinked = true;
  assert.deepEqual(Array.from(context.select(rows, project, [{ evidenceItemId: "B" }]), row => row.id), []);
  assert.deepEqual(project, original);
  const activeTree = appSource.slice(appSource.indexOf("  function renderTraceStudio(project)"), appSource.indexOf("\n  function flowAssessment("));
  assert.match(activeTree, /tree-v10-evidence-filter/);
  assert.match(activeTree, /filterTreeEvidenceRows\(allEvidence, treeProject, links\)/);
});
