import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startAuditFlowServer } from "./helpers/start-server.mjs";

const auditflowProjectId = "AF-JIRA-SYNC-01";
const projectKey = "AF01";
const token = "mock-jiraflow-token-with-more-than-24";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function request(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, options);
  const body = await response.json();
  return { response, body };
}

test("AuditFlow proxies only mapped JiraFlow projects visible to the signed-in assessor", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "auditflow-jiraflow-sync-"));
  const jiraFlowDataDir = path.join(root, "jiraflow-data");
  await mkdir(jiraFlowDataDir, { recursive: true });
  await writeFile(path.join(jiraFlowDataDir, ".token"), `${token}\n`, { mode: 0o600 });
  await writeFile(path.join(jiraFlowDataDir, ".token-user"), "auditflow-service\n", { mode: 0o600 });

  const issueState = new Map([
    [`${projectKey}-17`, {
      key: `${projectKey}-17`,
      projectKey,
      processArea: "MAN.3",
      summary: "MAN.3 verification evidence",
      status: "In Progress",
      revision: 4
    }],
    [`${projectKey}-18`, {
      key: `${projectKey}-18`,
      projectKey,
      processArea: "SYS.2",
      summary: "SYS.2 requirements review",
      status: "In Progress",
      revision: 7
    }]
  ]);
  let automaticIssueCreates = 0;
  const projectMappings = new Map([
    [projectKey, auditflowProjectId],
    ["AF02", "AF-NOT-AUTHORIZED"],
    ["AF03", ""]
  ]);
  const calls = [];
  const jiraFlow = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const body = rawBody ? JSON.parse(rawBody) : {};
    calls.push({
      method: request.method,
      pathname: url.pathname,
      authorization: request.headers.authorization,
      actor: request.headers["x-jiraflow-user"],
      body
    });
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (url.pathname === "/api/integrations/auditflow/projects" && request.method === "GET") {
      response.end(JSON.stringify({
        projects: [...projectMappings]
          .filter(([, mappedId]) => mappedId)
          .map(([key, mappedId]) => ({ key, name: `${key} assessment`, auditflowProjectId: mappedId }))
      }));
      return;
    }
    if (url.pathname === "/api/projects" && request.method === "GET") {
      response.end(JSON.stringify({
        projects: [...projectMappings]
          .map(([key, mappedId]) => ({ key, name: `${key} assessment`, auditflowProjectId: mappedId }))
      }));
      return;
    }
    const mappingMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/auditflow-mapping$/);
    if (mappingMatch && request.method === "PUT") {
      const jiraKey = mappingMatch[1];
      projectMappings.set(jiraKey, body.auditflowProjectId);
      response.end(JSON.stringify({
        project: { key: jiraKey, name: `${jiraKey} assessment`, auditflowProjectId: body.auditflowProjectId }
      }));
      return;
    }
    if (url.pathname === "/api/search" && request.method === "GET") {
      if (url.searchParams.get("project") !== projectKey) {
        response.writeHead(400);
        response.end(JSON.stringify({ error: "Project search scope is required" }));
        return;
      }
      const startAt = Number(url.searchParams.get("startAt") || 0);
      const maxResults = Number(url.searchParams.get("maxResults") || 100);
      const allIssues = [...issueState.values()];
      response.end(JSON.stringify({
        startAt,
        maxResults,
        total: allIssues.length,
        issues: allIssues.slice(startAt, startAt + maxResults)
      }));
      return;
    }
    if (url.pathname === "/api/integrations/auditflow/issues/upsert" && request.method === "POST") {
      automaticIssueCreates += 1;
      response.end(JSON.stringify({ outcome: "created", issue: { key: `${projectKey}-99`, projectKey } }));
      return;
    }
    const issueMatch = url.pathname.match(/^\/api\/issues\/([^/]+)$/);
    if (issueMatch && request.method === "GET") {
      const issue = issueState.get(issueMatch[1]);
      if (!issue) {
        response.writeHead(404);
        response.end(JSON.stringify({ error: "Issue not found" }));
        return;
      }
      response.end(JSON.stringify({
        issue
      }));
      return;
    }
    if (url.pathname === `/api/integrations/auditflow/projects/${auditflowProjectId}/events` && request.method === "GET") {
      response.end(JSON.stringify({
        auditflowProjectId,
        events: [
          {
            eventId: "event-17",
            id: 17,
            sourceRevision: 4,
            issueKey: `${projectKey}-17`,
            processArea: "MAN.3",
            type: "issue.updated",
            payload: { summary: "MAN.3 private event" }
          },
          {
            eventId: "event-18",
            id: 18,
            sourceRevision: 7,
            issueKey: `${projectKey}-18`,
            processArea: "SYS.2",
            type: "issue.updated",
            payload: { summary: "SYS.2 visible event" }
          }
        ],
        nextRevision: 18,
        hasMore: false
      }));
      return;
    }
    if (url.pathname === `/api/projects/${projectKey}/workflow` && request.method === "GET") {
      response.end(JSON.stringify({
        projectKey,
        transitions: [
          { id: 1, name: "Begin work", from: "TODO", to: "IN_PROGRESS", enabled: true },
          { id: 2, name: "Finish work", from: "IN_PROGRESS", to: "DONE", enabled: true }
        ]
      }));
      return;
    }
    if (url.pathname === "/api/integrations/auditflow/transitions" && request.method === "POST") {
      assert.equal(body.auditflowProjectId, auditflowProjectId);
      assert.ok(body.idempotencyKey);
      const issue = issueState.get(body.issueKey);
      assert.ok(issue, `Expected a known JiraFlow issue, got ${body.issueKey}`);
      assert.equal(body.expectedRevision, issue.revision);
      issue.revision += 1;
      issue.status = body.targetStatus;
      response.end(JSON.stringify({
        outcome: "applied",
        idempotencyKey: body.idempotencyKey,
        currentRevision: issue.revision,
        issue: { ...issue, status: { name: issue.status } }
      }));
      return;
    }
    response.writeHead(404);
    response.end(JSON.stringify({ error: "Not found" }));
  });
  const jiraFlowPort = await listen(jiraFlow);
  t.after(async () => {
    await new Promise(resolve => jiraFlow.close(resolve));
    await rm(root, { recursive: true, force: true });
  });

  const runtime = await startAuditFlowServer({
    env: {
      JIRAFLOW_PORT: String(jiraFlowPort),
      JIRAFLOW_DATA_DIR: jiraFlowDataDir,
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
  const create = await request(runtime.base, "/api/projects", {
    method: "POST",
    headers,
    body: JSON.stringify({
      projectId: auditflowProjectId,
      expectedRevision: 0,
      snapshot: {
        id: auditflowProjectId,
        name: "Mapped assessment",
        processes: ["MAN.3", "SYS.2"],
        assessments: [],
        records: [{
          id: "FORMAL-NC-1",
          type: "weakness",
          status: "open",
          title: "Missing assessor-confirmed closure evidence"
        }],
        ncRecords: [{
          id: "NC-UNREVIEWED-1",
          type: "NC",
          processArea: "SYS.2",
          status: "Open",
          summary: "Unreviewed NC must not be auto-created"
        }]
      }
    })
  });
  assert.equal(create.response.status, 200);
  const sync = await request(runtime.base, `/api/integrations/jiraflow/projects/${encodeURIComponent(auditflowProjectId)}/sync`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  assert.equal(sync.response.status, 200, JSON.stringify(sync.body));
  assert.equal(sync.body.created, 0);
  assert.equal(automaticIssueCreates, 0, "routine sync must not create corrective issues without explicit finding confirmation");
  const viewerMember = await request(runtime.base, `/api/projects/${auditflowProjectId}/members`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      userId: "LOCAL-TEST-02",
      role: "Assessor",
      processScopes: ["SYS.2"],
      permissions: { view: true, use: true, forms: false, remarks: false, traceability: false },
      expectedRevision: create.body.revision
    })
  });
  assert.equal(viewerMember.response.status, 200, JSON.stringify(viewerMember.body));

  const catalog = await request(runtime.base, "/api/integrations/jiraflow/projects", { headers });
  assert.equal(catalog.response.status, 200, JSON.stringify(catalog.body));
  assert.deepEqual(catalog.body.projects.map(project => project.auditflowProjectId), [auditflowProjectId]);
  assert.deepEqual(catalog.body.projects.map(project => project.key), [projectKey]);

  const options = await request(runtime.base, `/api/integrations/jiraflow/projects/${auditflowProjectId}/mapping-options`, { headers });
  assert.equal(options.response.status, 200, JSON.stringify(options.body));
  assert.deepEqual(options.body.projects.map(project => project.key), [projectKey, "AF03"]);
  assert.doesNotMatch(JSON.stringify(options.body), /AF02|AF-NOT-AUTHORIZED/);
  const takeOver = await request(runtime.base, `/api/integrations/jiraflow/projects/AF02/auditflow-mapping`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ auditflowProjectId })
  });
  assert.equal(takeOver.response.status, 409, JSON.stringify(takeOver.body));
  assert.equal(calls.filter(call => call.pathname === "/api/projects/AF02/auditflow-mapping").length, 0);

  const mapping = await request(runtime.base, `/api/integrations/jiraflow/projects/${projectKey}/auditflow-mapping`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ auditflowProjectId })
  });
  assert.equal(mapping.response.status, 200, JSON.stringify(mapping.body));
  assert.equal(mapping.body.project.auditflowProjectId, auditflowProjectId);

  const issues = await request(runtime.base, `/api/integrations/jiraflow/projects/${auditflowProjectId}/issues`, { headers });
  assert.equal(issues.response.status, 200, JSON.stringify(issues.body));
  assert.equal(issues.body.project.auditflowProjectId, auditflowProjectId);
  assert.equal(issues.body.issues[0].key, `${projectKey}-17`);
  assert.equal(issues.body.issues[0].revision, 4);
  assert.equal(issues.body.issues[0].status, "In Progress");
  assert.deepEqual(issues.body.issues.map(item => item.key), [`${projectKey}-17`, `${projectKey}-18`]);

  const issue = await request(runtime.base, `/api/integrations/jiraflow/projects/${auditflowProjectId}/issues/${projectKey}-17`, { headers });
  assert.equal(issue.response.status, 200, JSON.stringify(issue.body));
  assert.equal(issue.body.issue.key, `${projectKey}-17`);

  const events = await request(runtime.base, `/api/integrations/jiraflow/projects/${auditflowProjectId}/events?afterRevision=10`, { headers });
  assert.equal(events.response.status, 200, JSON.stringify(events.body));
  assert.equal(events.body.nextRevision, 18);
  assert.deepEqual(events.body.events.map(event => event.eventId), ["event-17", "event-18"]);

  const workflow = await request(runtime.base, `/api/integrations/jiraflow/projects/${auditflowProjectId}/workflow`, { headers });
  assert.equal(workflow.response.status, 200, JSON.stringify(workflow.body));
  assert.equal(workflow.body.transitions.length, 2);

  const transition = await request(runtime.base, "/api/integrations/jiraflow/transitions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      auditflowProjectId,
      issueKey: `${projectKey}-17`,
      targetStatus: "PENDING_VERIFICATION",
      expectedRevision: 4,
      idempotencyKey: "af-command-17"
    })
  });
  assert.equal(transition.response.status, 200, JSON.stringify(transition.body));
  assert.equal(transition.body.outcome, "applied");
  assert.equal(transition.body.issue.status.name, "PENDING_VERIFICATION");
  assert.ok(calls.every(call => call.authorization === `Bearer ${token}`));
  assert.ok(calls.every(call => call.actor === "auditflow-service"));

  const otherLogin = await request(runtime.base, "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "test-user-02@auditflow.local", password: runtime.password })
  });
  assert.equal(otherLogin.response.status, 200);
  const denied = await request(runtime.base, `/api/integrations/jiraflow/projects/${auditflowProjectId}/issues`, {
    headers: { "x-auditflow-session": otherLogin.body.sessionToken }
  });
  assert.equal(denied.response.status, 200, JSON.stringify(denied.body));
  assert.deepEqual(denied.body.issues.map(item => item.key), [`${projectKey}-18`]);

  const restrictedDetail = await request(runtime.base, `/api/integrations/jiraflow/projects/${auditflowProjectId}/issues/${projectKey}-17`, {
    headers: { "x-auditflow-session": otherLogin.body.sessionToken }
  });
  assert.equal(restrictedDetail.response.status, 403, JSON.stringify(restrictedDetail.body));
  const visibleDetail = await request(runtime.base, `/api/integrations/jiraflow/projects/${auditflowProjectId}/issues/${projectKey}-18`, {
    headers: { "x-auditflow-session": otherLogin.body.sessionToken }
  });
  assert.equal(visibleDetail.response.status, 200, JSON.stringify(visibleDetail.body));

  const restrictedEvents = await request(runtime.base, `/api/integrations/jiraflow/projects/${auditflowProjectId}/events?afterRevision=10`, {
    headers: { "x-auditflow-session": otherLogin.body.sessionToken }
  });
  assert.deepEqual(restrictedEvents.body.events.map(event => event.eventId), ["event-18"]);
  assert.doesNotMatch(JSON.stringify(restrictedEvents.body), /MAN\.3 private event|AF01-17/);

  const transitionCount = calls.filter(call => call.pathname === "/api/integrations/auditflow/transitions").length;
  const deniedTransition = await request(runtime.base, "/api/integrations/jiraflow/transitions", {
    method: "POST",
    headers: { "x-auditflow-session": otherLogin.body.sessionToken, "content-type": "application/json" },
    body: JSON.stringify({
      auditflowProjectId,
      issueKey: `${projectKey}-17`,
      targetStatus: "DONE",
      expectedRevision: issueState.get(`${projectKey}-17`).revision,
      idempotencyKey: "viewer-transition-17"
    })
  });
  assert.equal(deniedTransition.response.status, 403, JSON.stringify(deniedTransition.body));
  assert.equal(calls.filter(call => call.pathname === "/api/integrations/auditflow/transitions").length, transitionCount);

  const doneTransition = await request(runtime.base, "/api/integrations/jiraflow/transitions", {
    method: "POST",
    headers: { "x-auditflow-session": otherLogin.body.sessionToken, "content-type": "application/json" },
    body: JSON.stringify({
      auditflowProjectId,
      issueKey: `${projectKey}-18`,
      targetStatus: "DONE",
      expectedRevision: issueState.get(`${projectKey}-18`).revision,
      idempotencyKey: "scoped-done-transition-18"
    })
  });
  assert.equal(doneTransition.response.status, 200, JSON.stringify(doneTransition.body));
  assert.equal(doneTransition.body.outcome, "applied");
  assert.equal(doneTransition.body.issue.status.name, "DONE");
  const storedProject = await request(runtime.base, `/api/projects/${auditflowProjectId}`, { headers });
  assert.equal(storedProject.response.status, 200);
  assert.equal(storedProject.body.project.snapshot.records[0].status, "open");
});
