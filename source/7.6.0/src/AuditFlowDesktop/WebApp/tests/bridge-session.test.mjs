import assert from "node:assert/strict";
import http from "node:http";
import { existsSync } from "node:fs";
import test from "node:test";

const moduleUrl = new URL("../bridge-session.mjs", import.meta.url);
async function bridgeModule() {
  assert.ok(existsSync(moduleUrl), "Outbound bridge session module must exist");
  return import(moduleUrl);
}
const connectorToken = "bridge-test-connector-token-with-32-characters";

test("bridge sessions enforce owner, connector token, fixed routes, expiry and revocation", async () => {
  const { createBridgeSessionStore } = await bridgeModule();
  let now = 1000;
  const store = createBridgeSessionStore({ now: () => now, ttlMs: 2000 });
  assert.throws(() => store.create({ userId: "U1", routes: [{ name: "jira", target: "http://192.168.1.8:8080" }], connectorToken }), /route/i);
  const session = store.create({ userId: "U1", routes: ["jira", "confluence"], connectorToken });
  assert.deepEqual(session.routes, ["jira", "confluence"]);
  assert.doesNotMatch(JSON.stringify(session), /bridge-test-connector|192.168|password/);
  assert.throws(() => store.get(session.sessionId, "U2"), /access/i);
  assert.throws(() => store.heartbeat(session.sessionId, "wrong"), /token/i);
  assert.equal(store.heartbeat(session.sessionId, connectorToken).status, "connected");
  assert.throws(() => store.enqueue(session.sessionId, "U1", { route: "http://192.168.1.8:8080", path: "/" }), /route/i);
  assert.throws(() => store.enqueue(session.sessionId, "U1", { route: "jira", path: "http://169.254.169.254/" }), /path/i);
  now += 2001;
  assert.throws(() => store.get(session.sessionId, "U1"), /expired/i);
  const next = store.create({ userId: "U1", routes: ["jira"], connectorToken });
  store.revoke(next.sessionId, "U1");
  assert.throws(() => store.heartbeat(next.sessionId, connectorToken), /expired|revoked/i);
});

test("public relay queues requests until the authenticated outbound connector completes them", async () => {
  const { createBridgeSessionStore } = await bridgeModule();
  const store = createBridgeSessionStore();
  const session = store.create({ userId: "U1", routes: ["jira"], connectorToken });
  store.heartbeat(session.sessionId, connectorToken);
  const queued = store.enqueue(session.sessionId, "U1", { route: "jira", path: "/rest/api/2/serverInfo", method: "GET" });
  const jobs = await store.poll(session.sessionId, connectorToken, 0);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].route, "jira");
  assert.equal(jobs[0].path, "/rest/api/2/serverInfo");
  assert.equal(jobs[0].target, undefined, "Public relay has no private target URL");
  assert.throws(() => store.settle(session.sessionId, "wrong", jobs[0].id, { status: 200, body: "" }), /token/i);
  store.settle(session.sessionId, connectorToken, jobs[0].id, { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from('{"ok":true}').toString("base64") });
  assert.equal((await queued.result).status, 200);
});

test("local relay preserves browser login payloads while isolating cookie names and redirect paths", async t => {
  const { relayLocalBridgeRequest, rewriteBridgeResponse, bridgeRequestHeaders } = await bridgeModule();
  const observed = [];
  const upstream = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    observed.push({ url: request.url, cookie: request.headers.cookie, body: Buffer.concat(chunks).toString(), csrf: request.headers["x-atlassian-token"] });
    if (request.url === "/login.jsp") {
      response.writeHead(302, { location: "/secure/Dashboard.jspa", "set-cookie": "JSESSIONID=test-cookie; Path=/; HttpOnly; SameSite=Lax" });
      response.end();
    } else { response.writeHead(200, { "content-type": "text/html" }); response.end('<html><head></head><body><script src="/assets/app.js"></script><form action="/login.jsp"></form></body></html>'); }
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  const prefix = "/bridge/sessions/SESSION-1/jira/";
  const login = await relayLocalBridgeRequest({ route: "jira", path: "/login.jsp", method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-atlassian-token": "no-check" }, body: Buffer.from("os_username=test&os_password=test-only").toString("base64") }, { ports: { jira: upstream.address().port } });
  const rewritten = rewriteBridgeResponse(login, { sessionId: "SESSION-1", route: "jira" });
  assert.equal(rewritten.headers.location, `${prefix}secure/Dashboard.jspa`);
  assert.match(rewritten.headers["set-cookie"][0], /AFB_SESSION1_jira_JSESSIONID=test-cookie/);
  assert.ok(rewritten.headers["set-cookie"][0].includes(`Path=${prefix}`));
  const requestHeaders = bridgeRequestHeaders({ cookie: "auditflow_session=DO-NOT-FORWARD; AFB_SESSION1_jira_JSESSIONID=test-cookie; AFB_SESSION1_confluence_JSESSIONID=OTHER" }, { sessionId: "SESSION-1", route: "jira" });
  assert.equal(requestHeaders.cookie, "JSESSIONID=test-cookie");
  const page = await relayLocalBridgeRequest({ route: "jira", path: "/", method: "GET", headers: requestHeaders }, { ports: { jira: upstream.address().port } });
  const output = rewriteBridgeResponse(page, { sessionId: "SESSION-1", route: "jira" });
  assert.ok(Buffer.from(output.body, "base64").toString().includes(`src="${prefix}assets/app.js"`));
  assert.equal(observed[0].body, "os_username=test&os_password=test-only");
  assert.equal(observed[0].csrf, "no-check");
  assert.equal(observed[1].cookie, "JSESSIONID=test-cookie");
  await assert.rejects(() => relayLocalBridgeRequest({ route: "jira", path: "//192.168.1.8/", method: "GET" }), /path/i);
});

test("known Atlassian base URLs are rewritten without creating private target routes", async () => {
  const { rewriteBridgeResponse } = await bridgeModule();
  for (const [route, origin] of [["jira", "http://192.168.8.31:8080"], ["jira", "http://192.168.8.42:8080"], ["confluence", "http://192.168.8.42:8090"]]) {
    const prefix = `/bridge/sessions/SESSION-1/${route}/`;
    const redirect = rewriteBridgeResponse({ status: 302, headers: { location: `${origin}/login.action` }, body: "" }, { sessionId: "SESSION-1", route });
    assert.equal(redirect.headers.location, `${prefix}login.action`);
    const page = rewriteBridgeResponse({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from(`<a href="${origin}/view">View</a>`).toString("base64") }, { sessionId: "SESSION-1", route });
    assert.ok(Buffer.from(page.body, "base64").toString().includes(`href="${prefix}view"`));
  }
  assert.throws(() => rewriteBridgeResponse({ status: 302, headers: { location: "http://192.168.8.99:8080/" }, body: "" }, { sessionId: "SESSION-1", route: "jira" }), /leaves/i);
});
