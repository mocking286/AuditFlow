import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startAuditFlowServer } from "./helpers/start-server.mjs";

const projectId = "AF-JF-FINDING-01";
const projectKey = "AFJF01";
const token = "mock-jiraflow-token-with-more-than-24";

async function request(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, options);
  return { response, body: await response.json() };
}

test("Lead assessor previews and confirms an in-scope weakness into JiraFlow corroborating evidence", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "auditflow-jiraflow-finding-"));
  const dataDir = path.join(root, "jiraflow-data");
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, ".token"), `${token}\n`, { mode: 0o600 });
  await writeFile(path.join(dataDir, ".token-user"), "auditflow-service\n", { mode: 0o600 });
  const calls = [];
  let issue = null;
  const jiraFlow = http.createServer(async (incoming, outgoing) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    const url = new URL(incoming.url || "/", "http://127.0.0.1");
    calls.push({ method: incoming.method, pathname: url.pathname, body });
    outgoing.setHeader("content-type", "application/json; charset=utf-8");
    if (url.pathname === "/api/integrations/auditflow/projects" && incoming.method === "GET") {
      outgoing.end(JSON.stringify({ projects: [{ key: projectKey, name: "Finding remediation", auditflowProjectId: projectId }] }));
      return;
    }
    if (url.pathname === "/api/integrations/auditflow/issues/upsert" && incoming.method === "POST") {
      assert.equal(body.auditflowProjectId, projectId);
      assert.equal(body.sourceIssueId, "F-1");
      assert.equal(body.sourceRecordId, "F-1");
      assert.match(body.description, /SYS\.2\.BP1/);
      assert.match(body.description, /Requirements\.xlsx · Sheet1!A12/);
      issue = {
        key: `${projectKey}-43`,
        projectKey,
        summary: body.summary,
        description: body.description,
        status: "In Progress",
        revision: 1,
        sourceIssueId: body.sourceIssueId,
        sourceSystem: body.sourceSystem,
        sourceKind: body.sourceKind,
        findingId: body.findingId,
        assessmentId: body.assessmentId,
        traceOriginalRecordUrl: body.traceOriginalRecordUrl
      };
      outgoing.end(JSON.stringify({ outcome: "created", issue }));
      return;
    }
    if (url.pathname === "/api/search" && incoming.method === "GET") {
      outgoing.end(JSON.stringify({ startAt: 0, maxResults: 200, total: issue ? 1 : 0, issues: issue ? [issue] : [] }));
      return;
    }
    const issueMatch = url.pathname.match(/^\/api\/issues\/([^/]+)$/);
    if (issueMatch && incoming.method === "GET" && issue?.key === issueMatch[1]) {
      outgoing.end(JSON.stringify({ issue }));
      return;
    }
    outgoing.writeHead(404);
    outgoing.end(JSON.stringify({ error: "Unexpected mock route" }));
  });
  await new Promise(resolve => jiraFlow.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise(resolve => jiraFlow.close(resolve));
    await rm(root, { recursive: true, force: true });
  });

  const runtime = await startAuditFlowServer({
    env: {
      JIRAFLOW_PORT: String(jiraFlow.address().port),
      JIRAFLOW_DATA_DIR: dataDir,
      JIRAFLOW_AUTOSTART: "0"
    }
  });
  t.after(runtime.stop);

  const login = await request(runtime.base, "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "test-user-01@auditflow.local", password: runtime.password })
  });
  assert.equal(login.response.status, 200);
  const headers = {
    "x-auditflow-session": login.body.sessionToken,
    "content-type": "application/json"
  };

  const created = await request(runtime.base, "/api/projects", {
    method: "POST",
    headers,
    body: JSON.stringify({
      projectId,
      expectedRevision: 0,
      snapshot: {
        id: projectId,
        name: "Drive Pilot assessment",
        processes: ["SYS.2"],
        assessments: [{
          id: "SYS2-BP1",
          process: "SYS.2",
          code: "BP1",
          indicator: "SYS.2.BP1",
          title: "Analyze stakeholder requirements",
          rating: "P",
          reviewed: true
        }],
        evidence: [{
          id: "EV-1",
          code: "EV.001",
          name: "Requirements.xlsx",
          content: "The requirement baseline has no approval record.",
          primaryProcess: "SYS.2",
          locators: [{ locator: "Sheet1!A12", excerpt: "Approval: missing" }]
        }],
        records: [
          {
            id: "F-1",
            type: "weakness",
            title: "Unapproved requirements baseline",
            text: "The requirements baseline has no approval record.",
            indicators: ["SYS.2.BP1"],
            evidenceIds: ["EV-1"],
            owner: "Assessor A",
            dueDate: "2026-12-15",
            reviewed: true,
            status: "open",
            closureState: "待处理"
          },
          {
            id: "F-2",
            type: "weakness",
            text: "This weakness is not assessor-reviewed.",
            indicators: ["SYS.2.BP1"],
            reviewed: false
          },
          {
            id: "F-3",
            type: "weakness",
            text: "This finding is outside the formal assessment scope.",
            indicators: ["SYS.3.BP1"],
            reviewed: true
          }
        ],
        ncRecords: [{
          id: "NC-1",
          type: "NC",
          text: "The NC table record must retain traceability.",
          indicators: ["SYS.2.BP1"],
          reviewed: true,
          status: "Open",
          closureState: "待处理"
        }]
      }
    })
  });
  assert.equal(created.response.status, 200, JSON.stringify(created.body));

  const prefix = `/api/integrations/jiraflow/projects/${encodeURIComponent(projectId)}/assessment-findings`;
  const anonymousPreview = await request(runtime.base, `${prefix}/F-1/preview`);
  assert.equal(anonymousPreview.response.status, 401);

  const unreviewed = await request(runtime.base, `${prefix}/F-2/preview`, { headers });
  assert.equal(unreviewed.response.status, 403);
  assert.equal(calls.filter(call => call.pathname.endsWith("/upsert")).length, 0);

  const outOfScope = await request(runtime.base, `${prefix}/F-3/preview`, { headers });
  assert.equal(outOfScope.response.status, 403);
  assert.equal(calls.filter(call => call.pathname.endsWith("/upsert")).length, 0);

  const ncPreview = await request(runtime.base, `${prefix}/NC-1/preview`, { headers });
  assert.equal(ncPreview.response.status, 200, JSON.stringify(ncPreview.body));
  assert.equal(ncPreview.body.preview.findingId, "NC-1");
  assert.equal(calls.filter(call => call.pathname.endsWith("/upsert")).length, 0);

  const preview = await request(runtime.base, `${prefix}/F-1/preview`, { headers });
  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.project.projectKey, projectKey);
  assert.equal(preview.body.preview.findingId, "F-1");
  assert.equal(preview.body.preview.process, "SYS.2");
  assert.equal(preview.body.preview.indicators[0], "SYS.2.BP1");
  assert.match(preview.body.preview.description, /Requirements\.xlsx · Sheet1!A12/);
  assert.match(preview.body.preview.description, /Trace original record:/);
  assert.equal(calls.filter(call => call.pathname.endsWith("/upsert")).length, 0, "preview must not create a JiraFlow issue");

  const deniedConfirmation = await request(runtime.base, `${prefix}/F-1/issue`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      findingId: "F-1",
      expectedRevision: preview.body.expectedRevision,
      projectKey,
      confirmed: false
    })
  });
  assert.equal(deniedConfirmation.response.status, 400);
  assert.equal(calls.filter(call => call.pathname.endsWith("/upsert")).length, 0);

  const pushed = await request(runtime.base, `${prefix}/F-1/issue`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      findingId: "F-1",
      expectedRevision: preview.body.expectedRevision,
      projectKey,
      confirmed: true
    })
  });
  assert.equal(pushed.response.status, 200, JSON.stringify(pushed.body));
  assert.equal(pushed.body.issue.key, `${projectKey}-43`);
  assert.equal(pushed.body.issue.status, "In Progress");
  assert.equal(pushed.body.evidence.evidenceRole, "corroborating");
  assert.equal(pushed.body.evidence.issueUrl, `/api/jiraflow-findings/${projectId}/${projectKey}-43`);
  assert.equal(pushed.body.evidence.sourceLinks[0].indicator, "SYS.2.BP1");
  assert.equal(pushed.body.formalRatingChanged, false);
  assert.equal(pushed.body.formalClosureChanged, false);
  assert.equal(calls.filter(call => call.pathname.endsWith("/upsert")).length, 1);
  assert.equal(calls.filter(call => call.pathname === `/api/issues/${projectKey}-43`).length, 1);
  const openedIssue = await fetch(`${runtime.base}${pushed.body.evidence.issueUrl}`, { headers });
  const openedHtml = await openedIssue.text();
  assert.equal(openedIssue.status, 200, openedHtml);
  assert.match(openedIssue.headers.get("content-type"), /text\/html/);
  assert.match(openedHtml, /ASPICE Finding/);

  const stored = await request(runtime.base, `/api/projects/${encodeURIComponent(projectId)}`, { headers });
  const snapshot = stored.body.project.snapshot;
  assert.equal(snapshot.records.find(record => record.id === "F-1").jiraFlowKey, `${projectKey}-43`);
  assert.deepEqual(snapshot.records.find(record => record.id === "F-1").evidenceIds, ["EV-1", `JIRAFLOW-${projectKey}-43`]);
  assert.equal(snapshot.evidence.find(item => item.id === `JIRAFLOW-${projectKey}-43`).evidenceRole, "corroborating");
  assert.equal(snapshot.records.find(record => record.id === "F-1").closureState, "待处理");
  assert.equal(snapshot.records.find(record => record.id === "F-1").evidenceAnalysis.at(-1).indicator, "SYS.2.BP1");
  assert.equal(snapshot.assessments[0].rating, "P");

  issue.status = "Resolved";
  issue.revision = 2;
  issue.description = "Resolution evidence was added in JiraFlow.";
  const synced = await request(runtime.base, `/api/integrations/jiraflow/projects/${encodeURIComponent(projectId)}/sync`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  assert.equal(synced.response.status, 200, JSON.stringify(synced.body));
  assert.equal(synced.body.linkedEvidenceUpdated, 1);
  const afterSync = await request(runtime.base, `/api/projects/${encodeURIComponent(projectId)}`, { headers });
  const refreshedRecord = afterSync.body.project.snapshot.records.find(record => record.id === "F-1");
  assert.equal(refreshedRecord.jiraFlow.status, "Resolved");
  assert.equal(afterSync.body.project.snapshot.evidence.find(item => item.issueKey === `${projectKey}-43`).status, "Resolved");
  assert.equal(refreshedRecord.status, "open");
  assert.equal(refreshedRecord.closureState, "待处理");
  assert.equal(afterSync.body.project.snapshot.assessments[0].rating, "P");
});
