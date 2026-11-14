import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { startAuditFlowServer } from "./helpers/start-server.mjs";
import * as routing from "../upload-routing.mjs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
function appFunction(name) {
  const start = app.search(new RegExp(`^  (?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, `Missing ${name}`);
  return app.slice(start, app.indexOf("\n  }\n", start) + 5);
}

test("JiraFlow upload preview lists exact candidate fields and requires an explicit confirmation action", () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${appFunction("uploadCandidateExportFields")}; globalThis.fields = uploadCandidateExportFields;`, context);
  const candidate = { id: "C1", title: "Review baseline", description: "Approval is pending", sourceFile: "issues.xlsx", sourceSheet: "OPL", sourceCell: "OPL!row 3", processCandidates: ["SUP.8"], owner: "Reviewer", dueDate: "2026-12-01", severity: "Major", sourceStatus: "Closed", candidateOnly: true, sourceValues: ["PRIVATE UNUSED COLUMN"], assessorConfirmed: false };
  const exported = context.fields(candidate);
  assert.equal(exported.id, "C1");
  assert.equal(exported.candidateOnly, true);
  assert.equal(exported.status, "open");
  assert.equal(exported.origin, "classified-upload");
  assert.equal(exported.sourceValues, undefined);
  assert.equal(exported.sourceStatus, "Closed");
  assert.match(app, /data-action="confirm-upload-jiraflow"/);
  assert.match(app, /targetProjectKey/);
  assert.match(app, /duplicatePolicy/);
});

test("backend candidate submission uses the encoded authenticated project integration route", async () => {
  const calls = [];
  const window = { location: { protocol: "http:", origin: "http://127.0.0.1:47583", search: "" } };
  const context = { window, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, localStorage: { getItem: () => null }, fetch: async (url, options) => {
    calls.push({ url, options }); return { ok: true, json: async () => ({ candidates: [] }) };
  } };
  vm.runInNewContext(readFileSync(new URL("../backend-client.js", import.meta.url), "utf8"), context);
  assert.equal(typeof window.AuditFlowBackend.submitUploadJiraCandidates, "function");
  window.AuditFlowBackend.authHeaders = extra => ({ "x-auditflow-session": "fixture-session", ...extra });
  await window.AuditFlowBackend.submitUploadJiraCandidates("AF::P/1", { candidateIds: ["C1"], targetProjectKey: "AF1", expectedRevision: 1, confirmed: true });
  assert.equal(calls[0].url, "http://127.0.0.1:47583/api/integrations/jiraflow/projects/AF%3A%3AP%2F1/upload-candidates");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(calls[0].options.headers["x-auditflow-session"], "fixture-session");
});

test("explicit candidate submit links the acknowledged task and retries without creating duplicate local or formal records", async () => {
  const candidate = { id: "C1", title: "Review baseline", description: "Approval pending", sourceFile: "issues.xlsx", sourceCell: "OPL!row 3", processCandidates: ["SUP.8"], candidateOnly: true, origin: "classified-upload" };
  const project = { id: "P76", uploadIssueCandidates: [candidate], evidence: [{ id: "EV1" }], ncRecords: [{ id: "NC1", status: "closed" }], assessments: [{ rating: "F", reviewed: true }] };
  const formal = structuredClone(project);
  const calls = [];
  const context = {
    UploadRouting: routing, uploadJiraPreviews: new Map(), db: { standardProjects: [project], uploadJobs: [] },
    requireCollaborationRole: () => true, cloudProjectKey: value => value.id,
    persistUploadCandidateSelection: async (_, candidates) => { assert.equal(candidates[0].sourceFile, "issues.xlsx"); return 3; },
    configureCloudClient() {}, closeDrawer() {}, saveNow() {}, renderUploadProgress() {}, render() {}, toast() {},
    uiText: (_, en) => en, id: () => "JOB1",
    AuditFlowBackend: { submitUploadJiraCandidates: async (projectId, body) => {
      calls.push({ projectId, body });
      return { candidates: [{ candidateId: "C1", key: "UP76-1", projectKey: "UP76", status: "BACKLOG", revision: 1, candidateOnly: true }] };
    } }
  };
  vm.createContext(context);
  vm.runInContext([appFunction("uploadCandidateExportFields"), appFunction("submitUploadJiraPreview"), "globalThis.submit = submitUploadJiraPreview; globalThis.fields = uploadCandidateExportFields;"].join("\n"), context);
  const fields = context.fields(candidate);
  context.uploadJiraPreviews.set("TOKEN", { projectId: project.id, targetProjectKey: "UP76", candidates: [fields], fingerprint: JSON.stringify([fields]) });
  await context.submit("TOKEN");
  assert.equal(candidate.jiraFlowKey, "UP76-1");
  assert.equal(candidate.candidateOnly, true);
  assert.equal(candidate.jiraFlow.status, "BACKLOG");
  assert.equal(context.db.uploadJobs[0].completed, 1);
  assert.equal(context.db.uploadJobs[0].status, "complete");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.confirmed, true);
  await context.submit("TOKEN");
  assert.equal(calls.length, 1);
  assert.deepEqual(project.evidence, formal.evidence);
  assert.deepEqual(project.ncRecords, formal.ncRecords);
  assert.deepEqual(project.assessments, formal.assessments);
});

test("candidate persistence merges only upload candidates into the server revision without replacing formal content", async () => {
  const saved = [];
  const remote = { revision: 7, workspaceId: "SHARED", snapshot: { id: "P1", name: "Server project", assessments: [{ rating: "F" }], ncRecords: [{ id: "NC1" }], evidence: [{ id: "EV1" }], uploadIssueCandidates: [{ id: "OLD" }] } };
  const before = structuredClone(remote);
  const context = { cloudProjectKey: value => value.id, AuditFlowBackend: { pullProject: async () => remote, pushProject: async (id, body) => { saved.push({ id, body }); return { revision: 8 }; } } };
  vm.createContext(context);
  vm.runInContext(`${appFunction("persistUploadCandidateSelection")}; globalThis.persist = persistUploadCandidateSelection;`, context);
  assert.equal(await context.persist({ id: "P1", assessments: [] }, [{ id: "NEW", candidateOnly: true }]), 8);
  assert.equal(saved[0].body.expectedRevision, 7);
  assert.deepEqual(saved[0].body.snapshot.assessments, remote.snapshot.assessments);
  assert.deepEqual(Array.from(saved[0].body.snapshot.uploadIssueCandidates, item => item.id), ["OLD", "NEW"]);
  assert.deepEqual(remote, before);
});

test("candidate submission is scoped, confirmed, idempotent and never alters formal NCs or ratings", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "auditflow-upload-jira-"));
  const dataDir = path.join(root, "jira");
  await mkdir(dataDir);
  const token = "upload-candidate-service-fixture-token";
  await writeFile(path.join(dataDir, ".token"), token);
  await writeFile(path.join(dataDir, ".token-user"), "testuser");
  const issues = new Map();
  const writes = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/integrations/auditflow/projects") return res.end(JSON.stringify({ projects: [{ key: "UP76", name: "Candidate review", auditflowProjectId: "P76" }] }));
    if (req.url === "/api/integrations/auditflow/issues/upsert") {
      writes.push(body);
      const existing = issues.get(body.sourceIssueId);
      const issue = existing || { key: `UP76-${issues.size + 1}`, projectKey: "UP76", status: "BACKLOG", sourceSystem: "JEAuditFlow", sourceIssueId: body.sourceIssueId, revision: 1 };
      issues.set(body.sourceIssueId, issue);
      return res.end(JSON.stringify({ issue, outcome: existing ? "unchanged" : "created" }));
    }
    res.writeHead(404); res.end("{}");
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => upstream.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const server = await startAuditFlowServer({ env: { JIRAFLOW_PORT: String(upstream.address().port), JIRAFLOW_DATA_DIR: dataDir, JIRAFLOW_AUTOSTART: "0" } });
  t.after(server.stop);
  async function request(route, { method = "GET", body, headers = {} } = {}) {
    const response = await fetch(server.base + route, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  const login = await request("/api/auth/login", { method: "POST", body: { email: "test-user-01@auditflow.local", password: server.password } });
  const headers = { "x-auditflow-session": login.body.sessionToken };
  const snapshot = { id: "P76", name: "Candidate review", processes: ["SYS.2"], evidence: [{ id: "EV1" }], assessments: [{ id: "A1", rating: "F", reviewed: true }], ncRecords: [{ id: "NC1", status: "closed" }], records: [], uploadIssueCandidates: [{ id: "C1", title: "Review baseline", description: "Approval is pending", sourceFile: "issues.xlsx", sourceCell: "OPL!row 3", processCandidates: ["SYS.2"], candidateOnly: true, origin: "classified-upload", sourceStatus: "Closed" }] };
  const created = await request("/api/projects", { method: "POST", headers, body: { projectId: "P76", expectedRevision: 0, snapshot } });
  assert.equal(created.status, 200);
  const payload = { candidateIds: ["C1"], targetProjectKey: "UP76", expectedRevision: created.body.revision, confirmed: true };
  const route = "/api/integrations/jiraflow/projects/P76/upload-candidates";
  assert.equal((await request(route, { method: "POST", body: payload })).status, 401);
  assert.equal((await request(route, { method: "POST", headers, body: { ...payload, confirmed: false } })).status, 400);
  assert.equal((await request(route, { method: "POST", headers, body: { ...payload, expectedRevision: 99 } })).status, 409);
  assert.equal((await request(route, { method: "POST", headers, body: { ...payload, targetProjectKey: "OTHER" } })).status, 409);
  assert.equal((await request(route, { method: "POST", headers, body: { ...payload, candidateIds: ["NC1"] } })).status, 400);
  assert.equal(writes.length, 0);
  const result = await request(route, { method: "POST", headers, body: payload });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.candidates[0].candidateId, "C1");
  assert.equal(result.body.candidates[0].key, "UP76-1");
  assert.equal(result.body.candidates[0].candidateOnly, true);
  assert.equal(writes[0].sourceIssueId, "upload-candidate:C1");
  assert.equal(writes[0].sourceStatus, "open");
  assert.match(writes[0].description, /issues.xlsx/);
  assert.match(writes[0].description, /OPL!row 3/);
  const repeated = await request(route, { method: "POST", headers, body: payload });
  assert.equal(repeated.status, 200);
  assert.equal(issues.size, 1);
  assert.equal(repeated.body.candidates[0].outcome, "unchanged");
  const after = await request("/api/projects/P76", { headers });
  assert.deepEqual(after.body.project.snapshot.ncRecords, snapshot.ncRecords);
  assert.deepEqual(after.body.project.snapshot.assessments, snapshot.assessments);
  assert.deepEqual(after.body.project.snapshot.evidence, snapshot.evidence);
});
