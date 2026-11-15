import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");

function functionSource(name, optional = false) {
  const start = source.search(new RegExp(`^  (?:async )?function ${name}\\(`, "m"));
  if (optional && start < 0) return "";
  assert.ok(start >= 0, `Missing ${name}`);
  const end = source.indexOf("\n  }\n", start);
  assert.ok(end > start, `Unterminated ${name}`);
  return source.slice(start, end + 5);
}

function workspaceContext(raw, extra = {}) {
  let stored = raw;
  const writes = [];
  const sandbox = {
    WEB_MODE: false,
    DB_VERSION: 61,
    DB_KEY: "workspace-test",
    APP_VERSION: "7.7.0",
    WORKSPACE_STORE: "workspace",
    WORKSPACE_SNAPSHOT_ID: "current-workspace",
    CEP_ONLY_PROJECT_ID: "cep",
    CEP_BUNDLED_PARSER_VERSION: 3,
    GRID_TOOL_BUTTONS: [],
    RATING_SCORE: { F: 92.5, L: 67.5 },
    workspaceRestoreStarted: false,
    workspaceCompatibilityError: null,
    workspaceRestoreComplete: false,
    deepCopy: structuredClone,
    id: prefix => `${prefix}-new`,
    console: { warn() {} },
    localStorage: {
      getItem: () => stored,
      setItem(key, value) { writes.push({ key, value }); stored = value; }
    },
    seedDatabase: () => ({ version: 61, settings: {}, standardProjects: [], customAudits: [] }),
    assessmentQuality: () => ({ ready: false }),
    importedRatingScore: () => 92.5,
    buildAssessments: () => [],
    canonicalCode: value => value,
    inferEvidencePrimaryProcesses: () => [],
    summarizeHelixTables: () => [],
    render() {},
    ...extra
  };
  for (const name of [
    "ensureCustomAuditTemplates", "ensureCollaborationModel", "ensureImportedTmmProject",
    "ensureCepOnlyWorkspace", "ensureExternalAssessmentProjects", "ensureCepXpProject",
    "ensureMbealItmsProject", "ensureLocalDefaultProject", "normalizeEvidenceAtomicItems",
    "ensureVisualEvidenceItems", "ensureUniqueAtomicIdentifiers", "ensureV84Project"
  ]) sandbox[name] ||= () => {};
  vm.createContext(sandbox);
  vm.runInContext([
    "workspaceFormatError", "assertWorkspaceFormat", "assertProjectSnapshotFormat",
    "preserveControlledWorkspaceData", "restoreControlledWorkspaceData",
    "migrateDatabase", "migrateDatabaseContents", "loadDatabase",
    "writeWorkspaceCache", "persistWorkspaceSnapshot", "restoreWorkspaceSnapshot",
    "replaceProjectFromRemote", "hydrateCloudProjects"
  ].map(name => functionSource(name, true)).join("\n"), sandbox);
  sandbox.serializedWorkspace = value => JSON.stringify(value);
  sandbox.WORKSPACE_CACHE_POLICIES = [{}];
  sandbox.isQuotaExceeded = () => false;
  return { sandbox, writes, raw: () => stored };
}

for (const web of [false, true]) {
  test(`${web ? "hosted" : "desktop"} startup refuses a newer workspace without downgrading stored bytes`, () => {
    const raw = JSON.stringify({ version: 62, standardProjects: [{ id: "P-1", extension: { raw: "keep" } }] });
    const state = workspaceContext(raw, { WEB_MODE: web });
    assert.throws(() => state.sandbox.loadDatabase(), error => error.code === "unsupported-workspace-version");
    assert.equal(state.raw(), raw);
    assert.equal(state.writes.length, 0);
  });
}

test("future snapshot envelope blocks subsequent persistent writes", async () => {
  const future = { version: 62, savedAt: 20, workspace: { version: 61, standardProjects: [] } };
  const puts = [];
  const state = workspaceContext(null, {
    db: { version: 61, _workspaceCacheSavedAt: 1, standardProjects: [] },
    workspaceStoreRequest: async (mode, operation) => operation({
      get: () => future,
      put: value => { puts.push(value); return true; }
    })
  });
  await assert.rejects(state.sandbox.restoreWorkspaceSnapshot(), error => error.code === "unsupported-workspace-version");
  assert.equal(await state.sandbox.persistWorkspaceSnapshot(state.sandbox.db), false);
  assert.equal(state.sandbox.writeWorkspaceCache(state.sandbox.db), false);
  assert.equal(puts.length, 0);
  assert.equal(state.writes.length, 0);
});

test("snapshot persistence refuses a future workspace even when restore has not run", async () => {
  const puts = [];
  const transactionModes = [];
  const database = {
    transaction(name, mode) {
      transactionModes.push(mode);
      const transaction = {
        objectStore: () => ({
          get() {
            const request = {};
            queueMicrotask(() => {
              request.result = { version: 61, workspace: { version: 62, standardProjects: [] } };
              request.onsuccess?.();
            });
            return request;
          },
          put(value) { puts.push(value); return {}; }
        }),
        abort() { queueMicrotask(() => transaction.onabort?.()); }
      };
      return transaction;
    },
    close() {}
  };
  const { sandbox } = workspaceContext(null, {
    openAttachmentDatabase: async () => database,
    workspaceStoreRequest: async (mode, operation) => operation({
      get: () => ({ version: 61, workspace: { version: 62, standardProjects: [] } }),
      put: value => { puts.push(value); return true; }
    })
  });
  assert.equal(await sandbox.persistWorkspaceSnapshot({ version: 61, standardProjects: [] }), false);
  assert.equal(puts.length, 0);
  assert.deepEqual(transactionModes, ["readwrite"], "version preflight and put must share the same IndexedDB transaction");
});

test("a compatible IndexedDB snapshot is replaced only after its write transaction completes", async () => {
  const puts = [];
  let closed = false;
  const database = {
    transaction(name, mode) {
      assert.equal(mode, "readwrite");
      const transaction = {
        objectStore: () => ({
          get() {
            const request = {};
            queueMicrotask(() => { request.result = { version: 60, workspace: { version: 60, standardProjects: [] } }; request.onsuccess(); });
            return request;
          },
          put(value) { puts.push(value); queueMicrotask(() => transaction.oncomplete()); return {}; }
        })
      };
      return transaction;
    },
    close() { closed = true; }
  };
  const { sandbox } = workspaceContext(null, { openAttachmentDatabase: async () => database });
  const workspace = { version: 61, standardProjects: [{ id: "P-1", extension: { original: true } }] };
  assert.equal(await sandbox.persistWorkspaceSnapshot(workspace, 42), true);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].workspace, workspace);
  assert.equal(puts[0].savedAt, 42);
  assert.equal(closed, true);
});

test("closed projects and controlled version snapshots are not truncated by cache serialization", () => {
  const sandbox = {
    WORKSPACE_CACHE_POLICIES: [{ content: 4, itemText: 4, description: 4, itemLimit: 1, traceItemLimit: 1, locatorLimit: 1, locatorText: 4, tableLimit: 1, tableRows: 1, tableColumns: 1, cellText: 4, recordText: 4, assessmentText: 4, runLimit: 1, logLimit: 1 }]
  };
  vm.createContext(sandbox);
  vm.runInContext([
    "storageText", "compactPlainValue", "compactEvidenceTable", "compactAtomicItem", "compactAssessment",
    "compactEvidence", "compactRecord", "compactProject", "serializedWorkspace"
  ].map(name => functionSource(name)).join("\n"), sandbox);
  const baseline = { id: "BASELINE-1", signature: "original-signature", snapshot: { assessment: { rating: "F", originalText: "Complete formal conclusion" } } };
  const run = { id: "RUN-1", assessments: [{ id: "A-1", reason: "Complete historical conclusion" }] };
  const closed = { id: "P-CLOSED", assessmentState: "Closed", logs: [{ id: "L-1", comment: "Original close approval" }], assessments: [{ id: "A-1", reason: "Complete formal conclusion" }], baselines: [baseline], runs: [run], records: [{ id: "NC-1", evidenceReferences: ["EV-1"] }] };
  const workspace = { version: 61, standardProjects: [closed, { id: "P-OPEN", baselines: [baseline], runs: [run] }] };
  const original = structuredClone(workspace);
  const result = JSON.parse(sandbox.serializedWorkspace(workspace));
  assert.deepEqual(result.standardProjects[0], closed);
  assert.deepEqual(result.standardProjects[1].baselines, [baseline]);
  assert.deepEqual(result.standardProjects[1].runs, [run]);
  assert.deepEqual(workspace, original, "serializing a cache must not mutate the canonical in-memory workspace");
});

test("closed legacy projects retain exact conclusions, history, baseline and extension fields", () => {
  const closed = {
    id: "P-CLOSED", assessmentState: "Closed", status: "complete", progress: 100,
    qualityModelVersion: 5, dataVersion: "DV-24", achievedLevel: "CL2",
    assessments: [{ id: "A-1", rating: "F", reviewed: true, reason: "Original conclusion", achievementPercent: 100, unknown: { raw: "original" } }],
    evidence: [{ id: "EV-1", source: "Jira original reference", visualAssets: [{ id: "IMG-1", extension: { raw: "image provenance" } }] }],
    records: [{ id: "NC-1", type: "weakness", jiraKey: "OLD-1", closureState: "verified" }],
    logs: [{ id: "L-1", action: "Close", comment: "Approved" }],
    runs: [{ id: "R-1", assessments: [{ id: "A-1", rating: "F" }] }],
    baselines: [{ id: "B-1", signature: "immutable-signature", snapshot: { rating: "F" } }],
    extension: { raw: { original: true } }
  };
  const original = structuredClone(closed);
  const workspace = { version: 51, settings: {}, standardProjects: [closed], customAudits: [] };
  const { sandbox } = workspaceContext(null);
  const migrated = sandbox.migrateDatabase(workspace);
  assert.deepEqual(JSON.parse(JSON.stringify(migrated.standardProjects.find(project => project.id === "P-CLOSED"))), original);
  assert.equal(migrated.compatibilityReview.projects["P-CLOSED"].status, "review-required");
  assert.equal(migrated.compatibilityReview.projects["P-CLOSED"].formalConclusionsPreserved, true);
  assert.equal(migrated.version, 61);
});

test("legacy open projects retain unknown nested image metadata and existing assessment identifiers", () => {
  const project = {
    id: "P-OPEN", processes: ["SYS.2"], qualityModelVersion: 6,
    assessments: [{ id: "ASSESSMENT-ORIGINAL", process: "SYS.2", code: "BP1", reviewed: true, rating: "F", reviewerNote: "Final human note", extension: { raw: ["keep"] } }],
    evidence: [{ id: "EV-1", visualAssets: [{ id: "IMG-1", path: "image.png", extension: { raw: ["camera", "revision"] } }] }],
    runs: [{ id: "RUN-ORIGINAL", assessments: [{ id: "ASSESSMENT-ORIGINAL", rating: "L", extension: { history: true } }] }]
  };
  const { sandbox } = workspaceContext(null, {
    buildAssessments: () => [{ id: "NEW-ID", process: "SYS.2", code: "BP1", rating: "L", reason: "Regenerated", inferred: true }]
  });
  const migrated = sandbox.migrateDatabase({ version: 4, settings: {}, standardProjects: [project], customAudits: [] });
  const result = migrated.standardProjects[0];
  assert.equal(result.assessments[0].id, "ASSESSMENT-ORIGINAL");
  assert.equal(result.assessments[0].reviewerNote, "Final human note");
  assert.deepEqual(result.assessments[0].extension, { raw: ["keep"] });
  assert.equal(result.runs[0].assessments[0].rating, "L");
  assert.deepEqual(result.runs[0].assessments[0].extension, { history: true });
  assert.deepEqual(result.evidence[0].visualAssets[0].extension, { raw: ["camera", "revision"] });
});

test("server project load refuses an unsupported snapshot before replacing the local object", () => {
  const local = { id: "P-1", assessments: [{ id: "A-1", rating: "L" }], extension: { keep: true } };
  const original = structuredClone(local);
  let normalizations = 0;
  const { sandbox } = workspaceContext(null, {
    remoteProjectEntry: value => value,
    MBEAL_ITMS_LEGACY_PROJECT_IDS: new Set(),
    initializeProjectModel: value => { normalizations++; return value; },
    applyRemoteCollaborationMetadata() {}
  });
  assert.throws(() => sandbox.replaceProjectFromRemote(local, { snapshot: { id: "P-1", snapshotVersion: 3, snapshotPolicy: "metadata-only" } }), error => error.code === "unsupported-workspace-version");
  assert.deepEqual(local, original);
  assert.equal(normalizations, 0);
});

test("server workspace refresh validates all snapshots before changing any project", async () => {
  const local = { id: "P-1", assessments: [{ id: "A-1", rating: "F" }] };
  let saves = 0;
  const { sandbox } = workspaceContext(null, {
    db: { settings: { collaborationSyncEnabled: true }, standardProjects: [local] },
    collaborationRuntime: {},
    cloudCollaborationMode: () => true,
    configureCloudClient() {},
    hasPendingProjectChanges: () => false,
    remoteProjectEntry: value => value,
    MBEAL_ITMS_LEGACY_PROJECT_IDS: new Set(),
    initializeProjectModel: value => value,
    applyRemoteCollaborationMetadata() {},
    restrictStandardProjectsForUser: value => value,
    save() { saves++; },
    AuditFlowBackend: {
      projects: async () => ({ projects: [{ id: "P-1" }, { id: "P-2" }] }),
      pullProject: async id => ({ snapshot: { id, name: "remote", workspaceFormatVersion: id === "P-1" ? 61 : 62 } })
    }
  });
  await assert.rejects(sandbox.hydrateCloudProjects(), error => error.code === "unsupported-workspace-version");
  assert.equal(sandbox.db.standardProjects[0], local);
  assert.equal(local.name, undefined);
  assert.equal(saves, 0);
});

test("project assessment ordinals and unrelated extension versions are not mistaken for format versions", () => {
  const { sandbox } = workspaceContext(null);
  const project = { id: "P-LEGACY", version: 77, revision: 100, schemaVersion: "custom/v900", snapshotVersion: 999, databaseVersion: 999, workspaceVersion: 999 };
  assert.equal(sandbox.assertProjectSnapshotFormat(project), project);
});
