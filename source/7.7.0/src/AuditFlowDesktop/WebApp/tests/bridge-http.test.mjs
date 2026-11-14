import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { createOutboundBridgeConnector, relayLocalBridgeRequest } from "../bridge-session.mjs";

const serverPath = fileURLToPath(new URL("../server.mjs", import.meta.url));
const password = "BridgeFixturePassword76!";
async function startServer(t, envOverrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "auditflow-bridge-http-"));
  const child = spawn(process.execPath, [serverPath, "serve"], { cwd: path.dirname(serverPath), env: { ...process.env, AUDITFLOW_SERVER_ROLE: "collaboration", AUDITFLOW_LOCAL_TEST: "1", AUDITFLOW_ENABLE_POLARION_BRIDGE: "0", AUDITFLOW_PORT: "0", AUDITFLOW_OUTPUT_DIR: path.join(root, "output"), AUDITFLOW_COLLAB_DIR: path.join(root, "collaboration"), AUDITFLOW_USER_DATA_DIR: path.join(root, "users"), AUDITFLOW_TEST_PASSWORD: password, AUDITFLOW_MYSQL_URL: "", MYSQL_URL: "", FILEANALYST_AUTOSTART: "0", JIRAFLOW_AUTOSTART: "0", AUDITFLOW_MODEL_API_KEY: "", DEEPSEEK_API_KEY: "", ...envOverrides }, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
  t.after(async () => { child.kill("SIGTERM"); if (child.exitCode === null) await new Promise(resolve => child.once("exit", resolve)); await rm(root, { recursive: true, force: true }); });
  let base = ""; const deadline = Date.now() + 15000;
  while (Date.now() < deadline && child.exitCode === null) { base = output.match(/running at (http:[/][/]127[.]0[.]0[.]1:[0-9]+)[/]/)?.[1] || ""; if (base) break; await new Promise(resolve => setTimeout(resolve, 25)); }
  assert.ok(base, output);
  const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "test-user-01@auditflow.local", password }) });
  assert.equal(response.status, 200);
  const identity = await response.json();
  return { base, headers: { "x-auditflow-session": identity.sessionToken } };
}
async function json(server, pathname, body, headers = server.headers) {
  const response = await fetch(server.base + pathname, { method: body === undefined ? "GET" : "POST", headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { response, body: await response.json() };
}

test("authenticated public relay opens login, assets and redirect through a Mac outbound connector", async t => {
  const remote = await startServer(t);
  const anonymous = await json(remote, "/api/bridge/sessions", undefined, {});
  assert.equal(anonymous.response.status, 401);
  const upstreamRequests = [];
  const upstream = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    upstreamRequests.push({ path: request.url, method: request.method, host: request.headers.host, cookie: request.headers.cookie || "", csrf: request.headers["x-atlassian-token"], body: Buffer.concat(chunks).toString() });
    if (request.url === "/login.jsp") { response.writeHead(302, { location: "http://127.0.0.1:8080/secure/Dashboard.jspa", "set-cookie": "JSESSIONID=fixture-session; Path=/; HttpOnly; SameSite=Lax" }); response.end(); }
    else if (request.url === "/assets/app.js") { response.setHeader("content-type", "application/javascript"); response.end('window.fixtureLoaded=true;fetch("/rest/api/2/serverInfo")'); }
    else { response.setHeader("content-type", "text/html"); response.end('<html><head></head><body><script src="/assets/app.js"></script><form action="/login.jsp"></form><a href="http://localhost:8080/secure/Dashboard.jspa">Dashboard</a></body></html>'); }
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  const connectorToken = "fixture-connector-token-76-not-a-real-secret";
  const created = await json(remote, "/api/bridge/sessions", { routes: ["jira"], connectorToken });
  assert.equal(created.response.status, 201);
  assert.doesNotMatch(JSON.stringify(created.body), /fixture-connector|127[.]0[.]0[.]1/);
  const sessionId = created.body.sessionId;
  const prefix = `/bridge/sessions/${sessionId}/jira/`;
  const connector = createOutboundBridgeConnector({ remoteOrigin: remote.base, sessionId, connectorToken, relay: (job, options) => relayLocalBridgeRequest(job, { ...options, ports: { jira: upstream.address().port } }) });
  t.after(() => connector.stop());
  connector.start();
  const page = await fetch(remote.base + prefix, { headers: remote.headers });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes(`src="${prefix}assets/app.js"`));
  assert.ok(html.includes(`href="${prefix}secure/Dashboard.jspa"`), "local absolute URLs must remain in the session");
  const scriptStart = html.indexOf('<script nonce="');
  const injected = html.slice(html.indexOf(">", scriptStart) + 1, html.indexOf("</script>", scriptStart));
  assert.ok(scriptStart >= 0, "dynamic root URL requests need a browser adapter");
  assert.doesNotThrow(() => new vm.Script(injected));
  const script = await fetch(remote.base + prefix + "assets/app.js", { headers: remote.headers });
  assert.ok((await script.text()).includes('fetch("/rest/api/2/serverInfo")'), "JavaScript must execute unchanged; the browser adapter scopes requests");
  const login = await fetch(remote.base + prefix + "login.jsp", { method: "POST", headers: { ...remote.headers, origin: remote.base, "content-type": "application/x-www-form-urlencoded", "x-atlassian-token": "csrf-fixture", cookie: `auditflow_session=${remote.headers["x-auditflow-session"]}` }, body: "os_username=fixture&os_password=fixture-only", redirect: "manual" });
  assert.equal(login.status, 302);
  assert.equal(login.headers.get("location"), prefix + "secure/Dashboard.jspa");
  const serviceCookie = login.headers.getSetCookie()[0];
  assert.ok(serviceCookie.includes(`Path=${prefix}`));
  assert.ok(serviceCookie.includes("HttpOnly"));
  await fetch(remote.base + prefix + "secure/Dashboard.jspa", { headers: { ...remote.headers, cookie: `auditflow_session=${remote.headers["x-auditflow-session"]}; ${serviceCookie.split(";")[0]}` } });
  assert.equal(upstreamRequests.find(item => item.method === "POST").body, "os_username=fixture&os_password=fixture-only");
  assert.equal(upstreamRequests.find(item => item.method === "POST").csrf, "csrf-fixture");
  assert.ok(upstreamRequests.every(item => !item.cookie.includes("auditflow")));
  assert.ok(upstreamRequests.every(item => item.host === new URL(remote.base).host));
  assert.equal(upstreamRequests.at(-1).cookie, "JSESSIONID=fixture-session");
  const revoke = await fetch(`${remote.base}/api/bridge/sessions/${sessionId}`, { method: "DELETE", headers: remote.headers });
  assert.equal(revoke.status, 200);
  assert.equal((await fetch(remote.base + prefix, { headers: remote.headers })).status, 410);
  await connector.stop();
});

test("7.6 root opens the authenticated workspace and shared feedback validates image bytes", async t => {
  const server = await startServer(t);
  const root = await fetch(server.base + "/");
  assert.equal(root.status, 200);
  assert.ok((await root.text()).includes("auth-gate.js"));
  assert.equal((await fetch(server.base + "/landing.html")).status, 200);
  assert.equal((await json(server, "/api/feedback", { feature: "Tree", content: "Fixture" }, {})).response.status, 401);
  const crossOrigin = await json(server, "/api/feedback", { feature: "Tree", content: "Fixture" }, { ...server.headers, origin: "https://untrusted.invalid" });
  assert.equal(crossOrigin.response.status, 403);
  const invalid = await json(server, "/api/feedback", { feature: "Tree", content: "Fixture", attachment: { name: "bad.png", type: "image/png", data: Buffer.from("not-image").toString("base64") } });
  assert.equal(invalid.response.status, 400);
  const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const accepted = await json(server, "/api/feedback", { feature: "Tree", content: "Fixture", attachment: { name: "fixture.png", type: "image/png", size: image.length, data: `data:image/png;base64,${image.toString("base64")}` } });
  assert.equal(accepted.response.status, 201);
  assert.match(accepted.body.entry.id, /^FB-/);
  assert.doesNotMatch(JSON.stringify(accepted.body), /base64|attachmentData/);
});

test("Polarion route is omitted until the collaboration server explicitly enables it", async t => {
  const disabled = await startServer(t);
  const hidden = await json(disabled, "/api/bridge/capabilities");
  assert.deepEqual(hidden.body.routes, ["jira", "confluence", "jiraflow", "jira-api"]);
  const status = await fetch(`${disabled.base}/api/integrations/polarion/status`);
  assert.deepEqual(await status.json(), { configured: false, routeEnabled: false, protocol: null, basePath: null });
  const blocked = await json(disabled, "/api/bridge/sessions", {
    routes: ["polarion"],
    connectorToken: "polarion-route-test-connector-token-0001"
  });
  assert.equal(blocked.response.status, 503);

  const enabled = await startServer(t, { AUDITFLOW_ENABLE_POLARION_BRIDGE: "1" });
  const visible = await json(enabled, "/api/bridge/capabilities");
  assert.deepEqual(visible.body.routes, ["jira", "confluence", "jiraflow", "jira-api", "polarion"]);
  const created = await json(enabled, "/api/bridge/sessions", {
    routes: ["jira", "confluence", "jiraflow", "polarion"],
    connectorToken: "polarion-route-test-connector-token-0002"
  });
  assert.equal(created.response.status, 201);
  assert.deepEqual(created.body.routes, ["jira", "confluence", "jiraflow", "polarion"]);
});

test("Polarion GWT bootstrap and native module metadata survive the complete HTTP relay", async t => {
  const remote = await startServer(t, { AUDITFLOW_ENABLE_POLARION_BRIDGE: "1" });
  const script = Buffer.alloc(7_082_204, 65);
  let observed;
  const upstream = http.createServer(async (request, response) => {
    if (request.method === "GET") {
      response.setHeader("content-type", "text/javascript");
      response.end(script);
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    observed = { path: request.url, moduleBase: request.headers["x-gwt-module-base"], body: Buffer.concat(chunks).toString() };
    response.setHeader("content-type", "text/plain");
    response.end("RPC accepted");
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  const connectorToken = "polarion-gwt-fixture-connector-token-0001";
  const created = await json(remote, "/api/bridge/sessions", { routes: ["polarion"], connectorToken });
  const sessionId = created.body.sessionId;
  const prefix = `/bridge/sessions/${sessionId}/polarion/`;
  const connector = createOutboundBridgeConnector({
    remoteOrigin: remote.base, sessionId, connectorToken, routes: ["polarion"],
    localTargets: { polarion: { host: "127.0.0.1", port: upstream.address().port, protocol: "http:" } }
  });
  t.after(() => connector.stop());
  connector.start();
  const bootstrap = await fetch(remote.base + prefix + "gwt/com.polarion.UI/bootstrap.cache.js", { headers: remote.headers });
  assert.equal(bootstrap.status, 200);
  assert.deepEqual(Buffer.from(await bootstrap.arrayBuffer()), script);
  const moduleBase = remote.base + prefix + "gwt/com.polarion.UI/";
  const nativeBase = remote.base + "/polarion/gwt/com.polarion.UI/";
  const rpc = await fetch(remote.base + prefix + "gwt/com.polarion.UI/xsrf", {
    method: "POST",
    headers: { ...remote.headers, origin: remote.base, "content-type": "text/x-gwt-rpc; charset=UTF-8", "x-gwt-module-base": moduleBase },
    body: `7|0|4|${moduleBase}|POLICY|XsrfService|getNewXsrfToken|1|2|3|4|0|`
  });
  assert.equal(rpc.status, 200);
  assert.equal(await rpc.text(), "RPC accepted");
  assert.deepEqual(observed, {
    path: "/polarion/gwt/com.polarion.UI/xsrf", moduleBase: nativeBase,
    body: `7|0|4|${nativeBase}|POLICY|XsrfService|getNewXsrfToken|1|2|3|4|0|`
  });
  await connector.stop();
});

test("Polarion top action opens only the configured local target after authentication", async t => {
  const local = await startServer(t, {
    AUDITFLOW_SERVER_ROLE: "desktop",
    AUDITFLOW_POLARION_BASE_URL: "http://192.168.1.20/polarion/"
  });
  const page = await fetch(`${local.base}/index.html`);
  assert.match(await page.text(), /id="polarionServiceLink"[^>]+aria-label="打开 Polarion"/);
  const anonymous = await fetch(`${local.base}/api/integrations/polarion/open`, { redirect: "manual" });
  assert.equal(anonymous.status, 401);
  const opened = await fetch(`${local.base}/api/integrations/polarion/open?target=http://invalid.example`, { headers: local.headers, redirect: "manual" });
  assert.equal(opened.status, 302);
  assert.equal(opened.headers.get("location"), "http://192.168.1.20/polarion/");
  const remote = await startServer(t, { AUDITFLOW_ENABLE_POLARION_BRIDGE: "1" });
  const denied = await fetch(`${remote.base}/api/integrations/polarion/open`, { headers: remote.headers, redirect: "manual" });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("location"), null);
});

test("remote JiraFlow integrations use the connected owner's local outbound connector", async t => {
  const projectId = "AF-BRIDGED-JIRAFLOW-01";
  const remote = await startServer(t, { JIRAFLOW_PORT: "1" });
  const createdProject = await json(remote, "/api/projects", {
    projectId,
    expectedRevision: 0,
    snapshot: { id: projectId, name: "Bridge test", processes: ["SYS.2"], assessments: [], evidence: [], records: [] }
  });
  assert.equal(createdProject.response.status, 200);

  const localToken = "local-jiraflow-service-token-for-tests-123456789";
  const upstream = http.createServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${localToken}`);
    assert.equal(request.headers["x-jiraflow-user"], "auditflow-service");
    assert.equal(request.url, "/api/integrations/auditflow/projects");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      projects: [{ key: "AF-BRIDGED", name: "Remote mapped project", auditflowProjectId: projectId }]
    }));
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => upstream.close(resolve)));

  const connectorToken = "bridge-jiraflow-test-connector-token-123456789";
  const session = await json(remote, "/api/bridge/sessions", { routes: ["jiraflow"], connectorToken });
  assert.equal(session.response.status, 201);
  const connector = createOutboundBridgeConnector({
    remoteOrigin: remote.base,
    sessionId: session.body.sessionId,
    connectorToken,
    routes: session.body.routes,
    localTargets: {
      jiraflow: {
        host: "127.0.0.1",
        port: upstream.address().port,
        token: localToken,
        actor: "auditflow-service"
      }
    }
  });
  t.after(() => connector.stop());
  connector.start();

  let result;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    result = await json(remote, "/api/integrations/jiraflow/projects");
    if (result.response.status === 200) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.projects[0].key, "AF-BRIDGED");
  assert.equal(result.body.projects[0].auditflowProjectId, projectId);
  assert.doesNotMatch(JSON.stringify(result.body), /local-jiraflow-service-token/);
});
