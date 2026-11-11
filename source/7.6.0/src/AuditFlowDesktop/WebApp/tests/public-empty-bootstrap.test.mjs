import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const catalog = await readFile(new URL("../evidence-catalog.js", import.meta.url), "utf8");
const emptyAssessment = () => ({ project: null, processes: [], records: [], plans: [], sessions: [], importStats: {} });

async function emptyCoreModule(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "auditflow-empty-core-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await copyFile(new URL("../core-project-bootstrap.mjs", import.meta.url), path.join(directory, "core-project-bootstrap.mjs"));
  await writeFile(path.join(directory, "cep-xp-assessment-data.js"), `window.AUDITFLOW_CEP_XP_ASSESSMENT=${JSON.stringify(emptyAssessment())};`);
  await writeFile(path.join(directory, "external-assessment-data.js"), "window.AUDITFLOW_EXTERNAL_ASSESSMENTS=[];");
  return import(pathToFileURL(path.join(directory, "core-project-bootstrap.mjs")).href);
}

test("public empty source adapters create no core assessment projects or memberships", async t => {
  const module = await emptyCoreModule(t);
  assert.deepEqual(module.buildCoreProjects(), []);
  const writes = [];
  const result = await module.syncCoreAssessmentProjects({
    store: { async project(id) { throw new Error(`Unexpected project lookup: ${id}`); }, async saveProject(...args) { writes.push(args); } },
    administrator: { userId: "SYNTHETIC-ADMIN" },
    addMember() { throw new Error("Empty adapters must not create memberships"); }
  });
  assert.deepEqual(result, { created: [], membersAdded: [] });
  assert.equal(writes.length, 0);
});

test("empty core source adapters preserve explicit synthetic extra project bootstrap", async t => {
  const module = await emptyCoreModule(t), entries = new Map(), members = [];
  const snapshot = { id: "SYNTHETIC-PROJECT", name: "Synthetic assessment", assessments: [], records: [], evidence: [] };
  const result = await module.syncCoreAssessmentProjects({
    store: { async project(id) { return entries.get(id); }, async saveProject(id, value) { entries.set(id, value); } },
    administrator: { userId: "SYNTHETIC-ADMIN" },
    extraProjects: [{ projectId: snapshot.id, workspaceId: "SYNTHETIC-WORKSPACE", snapshot }],
    addMember(id) { members.push(id); return true; }
  });
  assert.deepEqual(result.created, [snapshot.id]);
  assert.deepEqual(members, [snapshot.id]);
  assert.equal(entries.get(snapshot.id).snapshot.name, "Synthetic assessment");
});

async function appBootstrap(web, saved) {
  const storage = new Map(), warnings = [], errors = [];
  if (saved) storage.set(`auditflow-ai-workspace-v1${web ? "-SYNTHETIC-USER" : ""}`, JSON.stringify(saved));
  const sandbox = {
    AuditFlowAuth: { web, authenticated: true, ready: Promise.resolve(), user: { id: "SYNTHETIC-USER", userId: "SYNTHETIC-USER", name: "Synthetic Assessor", email: "assessor@example.test", localOnly: !web } },
    AUDITFLOW_CEP_XP_ASSESSMENT: emptyAssessment(),
    AUDITFLOW_TMM_ASSESSMENT: emptyAssessment(),
    AUDITFLOW_EXTERNAL_ASSESSMENTS: [],
    AUDITFLOW_MBEAL_TARGETED_ISSUES: [],
    AUDITFLOW_TUV_ISSUE_REFERENCE: { issues: [] },
    location: new URL("http://127.0.0.1:4173/index.html"),
    document: { documentElement: { lang: "en" }, getElementById: () => null },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    sessionStorage: { getItem: () => null },
    Blob, Buffer, URL, URLSearchParams, TextEncoder, structuredClone, setTimeout, clearTimeout,
    console: { log() {}, warn(...args) { warnings.push(args); }, error(...args) { errors.push(args); } }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(catalog, sandbox);
  const marker = "  const workspaceRestorePromise = restoreWorkspaceSnapshot()";
  assert.ok(source.includes(marker));
  // Exercise real initialization with real helper declarations. Optional
  // import modules and later DOM/polling startup are outside this boundary.
  const program = source
    .replace(/  const (HelixExportModel|DocumentReviewChecklistModel|UploadRouting) = await import\([^\n]+\n/g, "  const $1 = null;\n")
    .replace(marker, `  globalThis.__boot = db; return;\n${marker}`);
  await vm.runInContext(program, sandbox, { timeout: 10_000 });
  assert.equal(errors.length, 0, errors.map(args => args.map(item => item?.stack || String(item)).join(" ")).join("\n"));
  assert.equal(warnings.length, 0, "Empty public adapters must not trigger a load failure fallback");
  assert.ok(sandbox.__boot, "Initialization must complete before DOM startup");
  return JSON.parse(JSON.stringify(sandbox.__boot));
}

test("fresh public web initialization handles all absent customer source adapters", async () => {
  const database = await appBootstrap(true);
  assert.deepEqual(database.standardProjects.map(project => project.id), ["ASP-LOCAL-DEFAULT"]);
  assert.deepEqual(database.standardProjects[0].evidence, []);
  assert.deepEqual(database.standardProjects[0].records, []);
  assert.deepEqual(database.customAudits, []);
  assert.deepEqual(database.activity, []);
});

test("fresh public local initialization does not import absent source assessments", async () => {
  const database = await appBootstrap(false);
  assert.ok(database.standardProjects.some(project => project.id === "ASP-LOCAL-DEFAULT"));
  assert.ok(database.standardProjects.every(project => !project.importSource?.importId));
  assert.ok(database.standardProjects.every(project => !/CEP|TMM|MBEAL|STELLANTIS/i.test(project.id)));
  assert.ok(database.standardProjects.every(project => !(project.assessments || []).some(item => item.sourceAssessment)));
});

test("current-version local workspace keeps user project data with empty adapters", async () => {
  const initial = await appBootstrap(false);
  const userProject = structuredClone(initial.standardProjects[0]);
  userProject.id = "SYNTHETIC-USER-PROJECT";
  userProject.localDefault = false;
  userProject.name = "Synthetic user project";
  userProject.assessorOwnedField = "preserved";
  initial.standardProjects = [initial.standardProjects[0], userProject];
  const restored = await appBootstrap(false, initial);
  assert.equal(restored.standardProjects.find(project => project.id === userProject.id).assessorOwnedField, "preserved");
  assert.equal(restored.standardProjects.length, 2);
});
