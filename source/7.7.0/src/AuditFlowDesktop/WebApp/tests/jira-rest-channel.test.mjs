import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { buildJiraRestFields, createJiraRestClient, isAllowedJiraRestRequest, jiraRestSourceMarker, normalizeJiraRestIssue } from "../jira-rest-channel.mjs";

async function mockJira(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { AUDITFLOW_JIRA_PORT: String(server.address().port), AUDITFLOW_JIRA_PAT: "private-test-pat" };
}
const draft = {
  assessmentId: "assessment-1", assessmentName: "Example assessment", findingId: "NC-1",
  summary: "[SYS.2] Review record missing", description: "No approval was retained.\nEvidence: review table row 3",
  process: "SYS.2", indicators: ["SYS.2.BP1"], severity: "High", owner: "Human readable name",
  dueDate: "2026-11-30", traceOriginalRecordUrl: "https://audit.example.test/index.html#/standard/project-1?record=NC-1"
};

test("Jira REST whitelist accepts only fixed v2 metadata, issue read/search and explicit issue creation", () => {
  for (const route of ["/rest/api/2/project", "/rest/api/2/project/ASPICE", "/rest/api/2/issuetype", "/rest/api/2/priority", "/rest/api/2/search?jql=project%3DASPICE", "/rest/api/2/issue/ASPICE-12?fields=summary,status"]) {
    assert.equal(isAllowedJiraRestRequest(route, "GET"), true, route);
  }
  assert.equal(isAllowedJiraRestRequest("/rest/api/2/issue", "POST"), true);
  assert.equal(isAllowedJiraRestRequest("/rest/api/2/user/assignable/search?project=ASPICE&username=assessor.login&maxResults=20", "GET"), true);
  for (const route of ["http://example.test/rest/api/2/project", "//example.test/rest/api/2/project", "/rest/api/2/../2/project", "/rest/api/2/%70roject", "/rest/api/2/issue/ASPICE-1/transitions", "/rest/api/2/user", "/rest/api/2/issue/ASPICE-0", "/rest/api/2/project#secret", "/rest/api/2/project\r\nx:bad"]) {
    assert.equal(isAllowedJiraRestRequest(route, "GET"), false, route);
  }
  assert.equal(isAllowedJiraRestRequest("/rest/api/2/issue", "DELETE"), false);
  assert.equal(isAllowedJiraRestRequest("/rest/api/2/issue?override=true", "POST"), false);
  assert.equal(isAllowedJiraRestRequest("/rest/api/2/issue/ASPICE-1", "POST"), false);
  for (const query of ["project=ASPICE", "project=ASPICE&username=someone&maxResults=1000", "project=ASPICE&username=someone&email=private", "project=ASPICE&username=someone&username=other"]) {
    assert.equal(isAllowedJiraRestRequest(`/rest/api/2/user/assignable/search?${query}`), false);
  }
});

test("Jira REST credentials stay in loopback authorization headers and PAT takes precedence", async t => {
  const observed = [];
  const env = await mockJira(t, (req, res) => {
    observed.push({ url: req.url, authorization: req.headers.authorization, host: req.headers.host });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify([{ key: "ASPICE" }]));
  });
  const client = createJiraRestClient({ env: { ...env, AUDITFLOW_JIRA_USERNAME: "ignored-user", AUDITFLOW_JIRA_PASSWORD: "ignored-password" } });
  assert.equal(client.configured, true);
  assert.deepEqual(await client.request("/rest/api/2/project"), [{ key: "ASPICE" }]);
  assert.equal(observed[0].authorization, "Bearer private-test-pat");
  assert.equal(observed[0].url, "/rest/api/2/project");
  assert.match(observed[0].host, /^127\.0\.0\.1:/);
  assert.equal(Object.hasOwn(client, "authorization"), false);
  const basic = createJiraRestClient({ env: { AUDITFLOW_JIRA_PORT: env.AUDITFLOW_JIRA_PORT, AUDITFLOW_JIRA_USERNAME: "local-user", AUDITFLOW_JIRA_PASSWORD: "local-password" } });
  await basic.request("/rest/api/2/project");
  assert.equal(observed[1].authorization, `Basic ${Buffer.from("local-user:local-password").toString("base64")}`);
});

test("Jira REST missing credentials fail closed while owner-bound relays do not require local credentials", async () => {
  const disabled = createJiraRestClient({ env: {} });
  assert.equal(disabled.configured, false);
  await assert.rejects(disabled.request("/rest/api/2/project"), error => error.code === "jira_not_configured");
  let received;
  const remote = createJiraRestClient({ env: {}, relay: async (...args) => { received = args; return { key: "ASPICE-1" }; } });
  assert.equal(remote.configured, true);
  assert.equal(remote.authConfigured, false);
  assert.deepEqual(await remote.request("/rest/api/2/issue", { method: "POST", body: { fields: { summary: "Test" } } }), { key: "ASPICE-1" });
  assert.deepEqual(received, ["/rest/api/2/issue", { method: "POST", body: { fields: { summary: "Test" } } }]);
  await assert.rejects(remote.request("/rest/api/2/user"), error => error.code === "jira_route_denied");
  assert.throws(() => createJiraRestClient({ env: { AUDITFLOW_JIRA_PORT: "8080/path" } }), /port is invalid/);
});

test("Jira REST sends JSON fields and never follows redirects or reveals upstream errors", async t => {
  let received;
  const env = await mockJira(t, async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    res.writeHead(201, { "content-type": "application/json" });
    res.end('{"key":"ASPICE-1"}');
  });
  const client = createJiraRestClient({ env });
  assert.deepEqual(await client.request("/rest/api/2/issue", { method: "POST", body: { fields: { summary: "NC" } } }), { key: "ASPICE-1" });
  assert.deepEqual(received, { fields: { summary: "NC" } });
  const redirectEnv = await mockJira(t, (_req, res) => {
    res.writeHead(302, { location: "https://example.test/stolen" });
    res.end("private-test-pat");
  });
  await assert.rejects(createJiraRestClient({ env: redirectEnv }).request("/rest/api/2/project"), error =>
    error.code === "jira_api_rejected" && error.upstreamStatus === 302 && !error.message.includes("private-test-pat"));
});

test("Jira REST bounds requests and responses to four MiB", async t => {
  const env = await mockJira(t, (_req, res) => { res.end(JSON.stringify({ content: "x".repeat(4 * 1024 * 1024) })); });
  const client = createJiraRestClient({ env });
  await assert.rejects(client.request("/rest/api/2/project"), error => error.code === "jira_response_too_large");
  await assert.rejects(client.request("/rest/api/2/issue", { method: "POST", body: { content: "x".repeat(4 * 1024 * 1024) } }), error => error.code === "jira_request_too_large");
  await assert.rejects(client.request("/rest/api/2/project", { body: {} }), error => error.code === "jira_request_invalid");
});

test("the local connector enforces its project allowlist even when the hosted server has no matching policy", async () => {
  const calls = [];
  const client = createJiraRestClient({
    env: { AUDITFLOW_JIRA_PROJECT_KEYS: "ASPICE" },
    relay: async (path, options) => {
      calls.push({ path, options });
      return path === "/rest/api/2/project" ? [{ key: "ASPICE" }, { key: "OTHER" }] : {};
    }
  });
  assert.deepEqual(await client.request("/rest/api/2/project"), [{ key: "ASPICE" }]);
  for (const path of ["/rest/api/2/project/OTHER", "/rest/api/2/issue/OTHER-1", "/rest/api/2/search?jql=project%20%3D%20%22OTHER%22%20AND%20labels%20%3D%20%22auditflow-123%22", "/rest/api/2/user/assignable/search?project=OTHER&username=someone"]) {
    await assert.rejects(client.request(path), error => error.code === "jira_project_not_allowed");
  }
  await assert.rejects(client.request("/rest/api/2/search?jql=project%3DASPICE%20OR%20project%3DOTHER"), error => error.code === "jira_project_not_allowed");
  await assert.rejects(client.request("/rest/api/2/issue", { method: "POST", body: { fields: { project: { key: "OTHER" } } } }), error => error.code === "jira_project_not_allowed");
  assert.equal(calls.length, 1);
  await client.request("/rest/api/2/issue", { method: "POST", body: { fields: { project: { key: "ASPICE" } } } });
  assert.equal(calls.length, 2);
});

test("Jira field mapping retains evidence content and trace fields without guessing a Jira assignee", () => {
  const fields = buildJiraRestFields(draft, { projectKey: "ASPICE", issueTypeId: "10001", priorityId: "2", label: "auditflow-source-123" });
  assert.deepEqual(fields.project, { key: "ASPICE" });
  assert.deepEqual(fields.issuetype, { id: "10001" });
  assert.deepEqual(fields.priority, { id: "2" });
  assert.equal(fields.duedate, "2026-11-30");
  assert.equal(fields.assignee, undefined);
  for (const content of ["No approval was retained.", "review table row 3", "NC-1", "SYS.2.BP1", "High", "Human readable name", "Example assessment", draft.traceOriginalRecordUrl, jiraRestSourceMarker(draft)]) {
    assert.equal(fields.description.includes(content), true, content);
  }
  const explicit = buildJiraRestFields(draft, { projectKey: "ASPICE", issueTypeId: "10001", label: "auditflow-source-123", assigneeName: "mapped.jira.login" });
  assert.deepEqual(explicit.assignee, { name: "mapped.jira.login" });
  assert.throws(() => buildJiraRestFields({ ...draft, dueDate: "2026-02-30" }, { projectKey: "ASPICE", issueTypeId: "10001", label: "auditflow-source-123" }), /due date is invalid/);
  assert.throws(() => buildJiraRestFields({ ...draft, dueDate: "2026-13-40" }, { projectKey: "ASPICE", issueTypeId: "10001", label: "auditflow-source-123" }), error => error.code === "jira_fields_invalid");
});

test("Jira issue readback must match project, idempotency label and exact source marker", () => {
  const fields = buildJiraRestFields(draft, { projectKey: "ASPICE", issueTypeId: "10001", label: "auditflow-source-123" });
  const issue = { key: "ASPICE-1", fields: { ...fields, status: { id: "3", name: "In Progress" }, updated: "2026-11-14T06:00:00.000+0000" } };
  const expected = { projectKey: "ASPICE", label: "auditflow-source-123", sourceMarker: jiraRestSourceMarker(draft) };
  const normalized = normalizeJiraRestIssue(issue, expected);
  assert.equal(normalized.status, "In Progress");
  assert.equal(normalized.revision, Date.parse(issue.fields.updated));
  assert.equal(normalized.updatedAt, "2026-11-14T06:00:00.000Z");
  for (const bad of [
    { ...issue, key: "OTHER-1" },
    { ...issue, fields: { ...issue.fields, project: { key: "OTHER" } } },
    { ...issue, fields: { ...issue.fields, labels: [] } },
    { ...issue, fields: { ...issue.fields, description: `prefix ${expected.sourceMarker} suffix` } },
    { ...issue, fields: { ...issue.fields, updated: "not-a-date" } }
  ]) assert.throws(() => normalizeJiraRestIssue(bad, expected), /did not match/);
});
