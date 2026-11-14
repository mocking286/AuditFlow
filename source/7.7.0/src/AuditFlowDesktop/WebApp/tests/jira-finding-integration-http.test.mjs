import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { startAuditFlowServer } from "./helpers/start-server.mjs";

const projectId = "AF-JIRA-FINDING-HTTP";
const projectKey = "ASPICE";
async function request(base, route, options = {}) {
  const response = await fetch(`${base}${route}`, options);
  const body = await response.json();
  return { response, body };
}

test("real Jira REST finding flow previews, confirms, reads back and synchronizes corroborating evidence", async t => {
  const calls = [];
  let issue = null;
  let hideSearchResults = false;
  let readbackChange = null;
  let creationGate = null;
  let releaseCreation = () => {};
  t.after(() => releaseCreation());
  const jira = http.createServer(async (incoming, outgoing) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
    const url = new URL(incoming.url, "http://127.0.0.1");
    calls.push({ method: incoming.method, path: url.pathname, query: url.searchParams, body });
    outgoing.setHeader("content-type", "application/json");
    assert.equal(incoming.headers.authorization, "Bearer jira-http-fixture-pat");
    if (url.pathname === "/rest/api/2/project") {
      outgoing.end(JSON.stringify([{ key: projectKey, name: "Remediation" }, { key: "OTHER", name: "Not allowed" }]));
    } else if (url.pathname === `/rest/api/2/project/${projectKey}`) {
      outgoing.end(JSON.stringify({ key: projectKey, name: "Remediation", issueTypes: [{ id: "10001", name: "Task", subtask: false }, { id: "10002", name: "Sub-task", subtask: true }] }));
    } else if (url.pathname === "/rest/api/2/search") {
      assert.match(url.searchParams.get("jql"), /^project = "ASPICE" AND labels = "auditflow-[a-f0-9]{32}"$/);
      const label = /labels = "([^"]+)"/.exec(url.searchParams.get("jql"))[1];
      const matches = !hideSearchResults && issue?.fields.labels.includes(label) ? [issue] : [];
      outgoing.end(JSON.stringify({ total: matches.length, issues: matches }));
    } else if (url.pathname === "/rest/api/2/user/assignable/search") {
      assert.equal(url.searchParams.get("project"), projectKey);
      outgoing.end(JSON.stringify([{ name: "mapped.assessor", active: true }]));
    } else if (url.pathname === "/rest/api/2/issue" && incoming.method === "POST") {
      if (creationGate) await creationGate;
      issue = {
        key: `${projectKey}-${42 + calls.filter(call => call.path === "/rest/api/2/issue" && call.method === "POST").length}`,
        fields: { ...body.fields, status: { id: "1", name: "Open" }, updated: "2026-11-14T06:00:00.000+0000" }
      };
      outgoing.writeHead(201);
      outgoing.end(JSON.stringify({ key: issue.key }));
    } else if (url.pathname === `/rest/api/2/issue/${issue?.key}` && issue) {
      const result = structuredClone(issue);
      readbackChange?.(result);
      outgoing.end(JSON.stringify(result));
    } else {
      outgoing.writeHead(404);
      outgoing.end('{"error":"Unexpected fixture route"}');
    }
  });
  await new Promise(resolve => jira.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => jira.close(resolve)));
  const runtime = await startAuditFlowServer({
    env: {
      AUDITFLOW_SERVER_ROLE: "desktop",
      AUDITFLOW_JIRA_PORT: String(jira.address().port),
      AUDITFLOW_JIRA_PAT: "jira-http-fixture-pat",
      AUDITFLOW_JIRA_PROJECT_KEYS: projectKey,
      JIRAFLOW_AUTOSTART: "0"
    }
  });
  t.after(runtime.stop);
  async function login(number) {
    const result = await request(runtime.base, "/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `test-user-${number}@auditflow.local`, password: runtime.password })
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    return result.body;
  }
  const lead = await login("01");
  const other = await login("02");
  const viewer = await login("03");
  const headers = { "x-auditflow-session": lead.sessionToken, "content-type": "application/json" };
  const otherHeaders = { ...headers, "x-auditflow-session": other.sessionToken };
  const viewerHeaders = { ...headers, "x-auditflow-session": viewer.sessionToken };
  const original = {
    id: projectId, name: "Drive Pilot assessment", processes: ["SYS.2"],
    assessments: [{ id: "SYS2-BP1", process: "SYS.2", code: "BP1", indicator: "SYS.2.BP1", rating: "P", reviewed: true }],
    evidence: [{
      id: "EV-1", code: "EV.001", name: "Requirements.xlsx",
      content: "The requirement baseline has no approval record.", primaryProcess: "SYS.2",
      locators: [{ locator: "Sheet1!A12", excerpt: "Approval missing" }]
    }],
    records: [
      { id: "F-1", type: "weakness", title: "Missing approval", text: "The approval record was not retained.", indicators: ["SYS.2.BP1"], evidenceIds: ["EV-1"], reviewed: true, status: "open", closureState: "Pending", owner: "Human readable owner", dueDate: "2026-12-15" },
      { id: "F-2", type: "weakness", text: "Unreviewed", indicators: ["SYS.2.BP1"], reviewed: false },
      { id: "F-3", type: "weakness", text: "Out of scope", indicators: ["SYS.3.BP1"], reviewed: true }
    ]
  };
  const created = await request(runtime.base, "/api/projects", { method: "POST", headers, body: JSON.stringify({ projectId, expectedRevision: 0, snapshot: original }) });
  assert.equal(created.response.status, 200, JSON.stringify(created.body));
  let stored = await request(runtime.base, `/api/projects/${projectId}`, { headers });
  const addMember = await request(runtime.base, `/api/projects/${projectId}/members`, {
    method: "POST", headers,
    body: JSON.stringify({ expectedRevision: stored.body.project.revision, userId: other.user.userId || other.user.id, name: "Other process assessor", role: "Assessor", processScopes: ["SYS.3"], permissions: { view: true, use: true, forms: true, remarks: true, traceability: true } })
  });
  assert.equal(addMember.response.status, 200, JSON.stringify(addMember.body));
  stored = await request(runtime.base, `/api/projects/${projectId}`, { headers });
  const addViewer = await request(runtime.base, `/api/projects/${projectId}/members`, {
    method: "POST", headers,
    body: JSON.stringify({ expectedRevision: stored.body.project.revision, userId: viewer.user.userId || viewer.user.id, name: "Other process viewer", role: "Viewer", processScopes: ["SYS.3"], permissions: { view: true, use: false, forms: false, remarks: false, traceability: false } })
  });
  assert.equal(addViewer.response.status, 200, JSON.stringify(addViewer.body));
  const prefix = `/api/integrations/jira/projects/${projectId}`;
  const finding = `${prefix}/assessment-findings`;
  const post = body => ({ method: "POST", headers, body: JSON.stringify(body) });
  const creates = () => calls.filter(call => call.method === "POST" && call.path === "/rest/api/2/issue").length;
  assert.equal((await request(runtime.base, `${finding}/F-1/preview?projectKey=${projectKey}`)).response.status, 401);
  assert.equal((await request(runtime.base, `${finding}/F-1/preview?projectKey=${projectKey}`, { headers: otherHeaders })).response.status, 403);
  assert.equal((await request(runtime.base, `${finding}/F-2/preview?projectKey=${projectKey}`, { headers })).response.status, 403);
  assert.equal((await request(runtime.base, `${finding}/F-3/preview?projectKey=${projectKey}`, { headers })).response.status, 403);
  const options = await request(runtime.base, `${prefix}/options`, { headers });
  assert.equal(options.response.status, 200, JSON.stringify(options.body));
  assert.deepEqual(options.body.projects.map(item => item.key), [projectKey]);
  const preview = await request(runtime.base, `${finding}/F-1/preview?projectKey=${projectKey}`, { headers });
  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  assert.deepEqual(preview.body.issueTypes, [{ id: "10001", name: "Task" }]);
  assert.match(preview.body.preview.description, /The requirement baseline has no approval record/);
  assert.equal(creates(), 0);
  const mapping = { expectedRevision: preview.body.expectedRevision, confirmed: true, projectKey, issueTypeId: "10001", assigneeName: "mapped.assessor" };
  assert.equal((await request(runtime.base, `${finding}/F-1/issue`, post({ ...mapping, confirmed: false }))).response.status, 400);
  assert.equal((await request(runtime.base, `${finding}/F-1/issue`, post({ ...mapping, assigneeName: "not-assignable" }))).response.status, 400);
  assert.equal(creates(), 0);
  const pushed = await request(runtime.base, `${finding}/F-1/issue`, post(mapping));
  assert.equal(pushed.response.status, 200, JSON.stringify(pushed.body));
  assert.equal(pushed.body.issue.key, "ASPICE-43");
  assert.equal(pushed.body.evidence.sourceKind, "jira-assessment-finding");
  assert.equal(pushed.body.evidence.evidenceRole, "corroborating");
  assert.equal(pushed.body.evidence.issueUrl, `/api/jira-findings/${projectId}/ASPICE-43`);
  assert.equal(pushed.body.formalRatingChanged, false);
  assert.equal(pushed.body.formalClosureChanged, false);
  assert.equal(creates(), 1);
  assert.deepEqual(issue.fields.assignee, { name: "mapped.assessor" });
  stored = await request(runtime.base, `/api/projects/${projectId}`, { headers });
  const record = stored.body.project.snapshot.records[0];
  assert.equal(record.jiraKey, "ASPICE-43");
  assert.equal(record.status, "open");
  assert.equal(record.closureState, "Pending");
  assert.equal(stored.body.project.snapshot.assessments[0].rating, "P");
  hideSearchResults = true;
  const retryPreview = await request(runtime.base, `${finding}/F-1/preview?projectKey=${projectKey}`, { headers });
  const retry = await request(runtime.base, `${finding}/F-1/issue`, post({ ...mapping, expectedRevision: retryPreview.body.expectedRevision }));
  assert.equal(retry.response.status, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.outcome, "linked");
  assert.equal(creates(), 1);
  hideSearchResults = false;
  const detail = await fetch(`${runtime.base}${pushed.body.evidence.issueUrl}`, { headers });
  assert.equal(detail.status, 200);
  assert.match(await detail.text(), /ASPICE-43/);
  const deniedDetail = await fetch(`${runtime.base}${pushed.body.evidence.issueUrl}`, { headers: otherHeaders });
  assert.equal(deniedDetail.status, 403);
  const deniedViewerDetail = await fetch(`${runtime.base}${pushed.body.evidence.issueUrl}`, { headers: viewerHeaders });
  assert.equal(deniedViewerDetail.status, 403);
  issue.fields.status = { id: "5", name: "Resolved" };
  issue.fields.updated = "2026-11-14T07:00:00.000+0000";
  issue.fields.description += "\nOwner retained the approval record.";
  const synced = await request(runtime.base, `${prefix}/sync`, post({}));
  assert.equal(synced.response.status, 200, JSON.stringify(synced.body));
  assert.equal(synced.body.updated, 1);
  stored = await request(runtime.base, `/api/projects/${projectId}`, { headers });
  assert.equal(stored.body.project.snapshot.records[0].jira.status, "Resolved");
  assert.equal(stored.body.project.snapshot.records[0].status, "open");
  assert.equal(stored.body.project.snapshot.records[0].closureState, "Pending");
  assert.equal(stored.body.project.snapshot.assessments[0].rating, "P");
  const staleSnapshot = structuredClone(stored.body.project.snapshot);
  staleSnapshot.evidence = staleSnapshot.evidence.filter(item => item.sourceKind !== "jira-assessment-finding");
  staleSnapshot.records[0].evidenceIds = ["EV-1"];
  staleSnapshot.records[0].evidenceAnalysis = [];
  delete staleSnapshot.records[0].jira;
  delete staleSnapshot.records[0].jiraKey;
  const saved = await request(runtime.base, "/api/projects", post({ projectId, expectedRevision: stored.body.project.revision, snapshot: staleSnapshot }));
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  stored = await request(runtime.base, `/api/projects/${projectId}`, { headers });
  assert.equal(stored.body.project.snapshot.evidence.filter(item => item.sourceKind === "jira-assessment-finding").length, 1);
  assert.ok(stored.body.project.snapshot.records[0].evidenceIds.includes("JIRA-ASPICE-43"));
  for (const change of [
    value => { value.fields.project.key = "OTHER"; },
    value => { value.fields.labels = []; },
    value => { value.fields.description = "Unrelated issue"; }
  ]) {
    readbackChange = change;
    const invalid = await request(runtime.base, `${prefix}/sync`, post({}));
    assert.equal(invalid.response.status, 502, JSON.stringify(invalid.body));
  }
  readbackChange = null;
  const retained = await request(runtime.base, `/api/projects/${projectId}`, { headers });
  assert.equal(retained.body.project.snapshot.evidence.find(item => item.issueKey === "ASPICE-43").status, "Resolved");
  assert.equal(creates(), 1);
  const nextSnapshot = structuredClone(retained.body.project.snapshot);
  nextSnapshot.records.push({ id: "F-4", type: "weakness", text: "Concurrent lead assignment", indicators: ["SYS.2.BP1"], reviewed: true, status: "open", closureState: "Pending" });
  const withNext = await request(runtime.base, "/api/projects", post({ projectId, expectedRevision: retained.body.project.revision, snapshot: nextSnapshot }));
  assert.equal(withNext.response.status, 200, JSON.stringify(withNext.body));
  stored = await request(runtime.base, `/api/projects/${projectId}`, { headers });
  const promoteOther = await request(runtime.base, `/api/projects/${projectId}/members`, {
    method: "POST", headers,
    body: JSON.stringify({ expectedRevision: stored.body.project.revision, userId: other.user.userId || other.user.id, name: "Second lead", role: "Lead Assessor", processScopes: ["*"] })
  });
  assert.equal(promoteOther.response.status, 200, JSON.stringify(promoteOther.body));
  const nextPreview = await request(runtime.base, `${finding}/F-4/preview?projectKey=${projectKey}`, { headers });
  assert.equal(nextPreview.response.status, 200, JSON.stringify(nextPreview.body));
  creationGate = new Promise(resolve => { releaseCreation = resolve; });
  const nextMapping = { ...mapping, expectedRevision: nextPreview.body.expectedRevision, assigneeName: "" };
  const firstLeadPush = request(runtime.base, `${finding}/F-4/issue`, post(nextMapping));
  for (let attempt = 0; attempt < 100 && creates() < 2; attempt += 1) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(creates(), 2, "first lead reached Jira creation");
  const secondLeadPush = await request(runtime.base, `${finding}/F-4/issue`, { ...post(nextMapping), headers: otherHeaders });
  assert.equal(secondLeadPush.response.status, 409, JSON.stringify(secondLeadPush.body));
  releaseCreation();
  const firstLeadResult = await firstLeadPush;
  assert.equal(firstLeadResult.response.status, 200, JSON.stringify(firstLeadResult.body));
  assert.equal(firstLeadResult.body.issue.key, "ASPICE-44");
  assert.equal(creates(), 2, "one Jira issue is created across both lead requests");
});
