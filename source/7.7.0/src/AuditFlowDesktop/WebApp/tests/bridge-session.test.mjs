import assert from "node:assert/strict";
import http from "node:http";
import { existsSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

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

test("JiraFlow backend relay is owner-bound and injects local service credentials only at the connector", async () => {
  const { createBridgeSessionStore, relayLocalBridgeRequest } = await bridgeModule();
  const store = createBridgeSessionStore();
  const session = store.create({ userId: "U1", routes: ["jiraflow"], connectorToken });
  assert.equal(store.connectedForUser("U1", "jiraflow"), null);
  store.heartbeat(session.sessionId, connectorToken);
  assert.equal(store.connectedForUser("U1", "jiraflow").sessionId, session.sessionId);
  assert.equal(store.connectedForUser("U2", "jiraflow"), null);

  const server = http.createServer((request, response) => {
    assert.equal(request.url, "/api/integrations/auditflow/projects");
    assert.equal(request.headers.authorization, "Bearer local-jiraflow-service-token");
    assert.equal(request.headers["x-jiraflow-user"], "auditflow-service");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ projects: [{ key: "AF-1" }] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await relayLocalBridgeRequest({
      route: "jiraflow", path: "/api/integrations/auditflow/projects", method: "GET", body: ""
    }, {
      localTargets: {
        jiraflow: {
          host: "127.0.0.1",
          port: server.address().port,
          token: "local-jiraflow-service-token",
          actor: "auditflow-service"
        }
      }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(Buffer.from(response.body, "base64").toString()), { projects: [{ key: "AF-1" }] });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("JiraFlow connector rejects arbitrary paths, private-network targets and missing local credentials", async () => {
  const { relayLocalBridgeRequest } = await bridgeModule();
  const job = { route: "jiraflow", path: "/api/integrations/auditflow/projects", method: "GET", body: "" };
  await assert.rejects(() => relayLocalBridgeRequest(job, {
    localTargets: { jiraflow: { host: "192.168.8.42", port: 47585, token: "token", actor: "auditflow-service" } }
  }), /loopback/i);
  await assert.rejects(() => relayLocalBridgeRequest({ ...job, path: "/etc/passwd" }, {
    localTargets: { jiraflow: { host: "127.0.0.1", port: 47585, token: "token", actor: "auditflow-service" } }
  }), /route|path/i);
  await assert.rejects(() => relayLocalBridgeRequest(job, {
    localTargets: { jiraflow: { host: "127.0.0.1", port: 47585, token: "", actor: "auditflow-service" } }
  }), /credential/i);
});

test("JiraFlow connector permits only complete integration paths and their intended methods", async () => {
  const { isAllowedJiraFlowBridgeRequest } = await bridgeModule();
  for (const pathname of ["/health", "/api/projects", "/api/search?project=AF1", "/api/issues/AF1-42", "/api/projects/AF1/workflow", "/api/integrations/auditflow/projects/AF1/events"]) {
    assert.equal(isAllowedJiraFlowBridgeRequest(pathname, "GET"), true, pathname);
  }
  for (const pathname of ["/api/integrations/auditflow/projects/ensure", "/api/integrations/auditflow/issues/upsert", "/api/integrations/auditflow/transitions"]) {
    assert.equal(isAllowedJiraFlowBridgeRequest(pathname, "POST"), true, pathname);
  }
  assert.equal(isAllowedJiraFlowBridgeRequest("/api/projects/AF1/auditflow-mapping", "PUT"), true);
  for (const pathname of ["/api/projects/AF1/users", "/api/issues/AF1-42/attachments", "/health/admin", "/api/integrations/auditflow/projects/ensure/admin", "/api/users"]) {
    for (const method of ["GET", "POST", "DELETE"]) assert.equal(isAllowedJiraFlowBridgeRequest(pathname, method), false, `${method} ${pathname}`);
  }
  assert.equal(isAllowedJiraFlowBridgeRequest("/api/integrations/auditflow/issues/upsert", "GET"), false);
  assert.equal(isAllowedJiraFlowBridgeRequest("/api/search", "POST"), false);
});

test("Jira REST channel is backend-only and uses a local client without forwarding browser authentication", async () => {
  const { createBridgeSessionStore, relayLocalBridgeRequest } = await bridgeModule();
  const store = createBridgeSessionStore();
  const session = store.create({ userId: "U1", routes: ["jira-api"], connectorToken });
  store.heartbeat(session.sessionId, connectorToken);
  const calls = [];
  const client = {
    configured: true,
    async request(pathname, options) { calls.push({ pathname, options }); return { key: "AUDIT-42" }; }
  };
  const job = { route: "jira-api", path: "/rest/api/2/issue", method: "POST", headers: { authorization: "Bearer browser-value", cookie: "session=browser-value" }, body: Buffer.from('{"fields":{"summary":"Finding"}}').toString("base64") };
  const response = await relayLocalBridgeRequest(job, { localTargets: { "jira-api": client } });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers, undefined);
  assert.deepEqual(calls[0].options.body, { fields: { summary: "Finding" } });
  assert.doesNotMatch(JSON.stringify(store.list("U1")), /browser-value|request|password|token/);
  await assert.rejects(() => relayLocalBridgeRequest({ ...job, path: "/plugins/servlet/admin" }, { localTargets: { "jira-api": client } }), /route/i);
  await assert.rejects(() => relayLocalBridgeRequest(job), /credentials/i);
  store.close();
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

test("Polarion initial static resource burst completes without starving its GWT bootstrap", async t => {
  const { createBridgeSessionStore } = await bridgeModule();
  const store = createBridgeSessionStore();
  t.after(() => store.close());
  const session = store.create({ userId: "U1", routes: ["polarion"], connectorToken });
  store.heartbeat(session.sessionId, connectorToken);
  const results = [];
  for (let index = 0; index < 96; index += 1) {
    const queued = store.enqueue(session.sessionId, "U1", {
      route: "polarion", method: "GET", path: `/gwt/com.polarion.UI/resource-${index}.cache.js`
    });
    queued.result.catch(() => {});
    results.push(queued.result);
  }
  for (let index = 0; index < 32; index += 1) {
    const queued = store.enqueue(session.sessionId, "U1", { route: "polarion", method: "POST", path: "/gwt/com.polarion.UI/xsrf" });
    queued.result.catch(() => {});
    results.push(queued.result);
  }
  assert.throws(() => store.enqueue(session.sessionId, "U1", { route: "polarion", method: "GET", path: "/one-more.js" }), cause => cause.status === 429);
  let jobs;
  do {
    jobs = await store.poll(session.sessionId, connectorToken, 0);
    for (const job of jobs) store.settle(session.sessionId, connectorToken, job.id, { status: 200, body: "" });
  } while (jobs.length);
  assert.equal((await Promise.all(results)).filter(result => result.status === 200).length, 128);
});

test("an API query containing a filename cannot take the larger static asset budget", async t => {
  const { createBridgeSessionStore } = await bridgeModule();
  const store = createBridgeSessionStore();
  t.after(() => store.close());
  const session = store.create({ userId: "U1", routes: ["polarion"], connectorToken });
  for (let index = 0; index < 32; index += 1) {
    const queued = store.enqueue(session.sessionId, "U1", { route: "polarion", method: "GET", path: `/rest/api/status?name=${index}.js` });
    queued.result.catch(() => {});
  }
  assert.throws(() => {
    const queued = store.enqueue(session.sessionId, "U1", { route: "polarion", method: "GET", path: "/rest/api/status?name=next.js" });
    queued.result.catch(() => {});
  }, cause => cause.status === 429);
});

test("browser asset loading keeps a separate bounded budget from API mutations", async t => {
  const { createBridgeSessionStore } = await bridgeModule();
  const store = createBridgeSessionStore();
  t.after(() => store.close());
  const session = store.create({ userId: "U1", routes: ["polarion"], connectorToken });
  store.heartbeat(session.sessionId, connectorToken);
  for (let index = 0; index < 300; index += 1) {
    const queued = store.enqueue(session.sessionId, "U1", { route: "polarion", method: "GET", path: `/ria/assets/${index}.js` });
    const [job] = await store.poll(session.sessionId, connectorToken, 0);
    store.settle(session.sessionId, connectorToken, job.id, { status: 200, body: "" });
    await queued.result;
  }
  for (let index = 0; index < 32; index += 1) {
    const queued = store.enqueue(session.sessionId, "U1", { route: "polarion", method: "POST", path: "/api/update" });
    queued.result.catch(() => {});
  }
  assert.throws(() => store.enqueue(session.sessionId, "U1", { route: "polarion", method: "POST", path: "/api/update" }), cause => cause.status === 429);
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

test("Polarion response cookies survive a coalesced Swift header with Expires commas", async () => {
  const { rewriteBridgeResponse, bridgeRequestHeaders, createBridgeSessionStore } = await bridgeModule();
  const store = createBridgeSessionStore();
  const session = store.create({ userId: "U1", routes: ["polarion"], connectorToken });
  store.heartbeat(session.sessionId, connectorToken);
  const queued = store.enqueue(session.sessionId, "U1", { route: "polarion", path: "/", method: "GET" });
  const [job] = await store.poll(session.sessionId, connectorToken, 0);
  const expiry = "Wed, 21 Oct 2037 07:28:00 GMT";
  store.settle(session.sessionId, connectorToken, job.id, {
    status: 200,
    headers: {
      "set-cookie": `JSESSIONID=session-fixture; Path=/polarion; HttpOnly; SameSite=Lax; Expires=${expiry}, X-CSRF-Token=csrf-fixture; Path=/polarion/; Secure; SameSite=Strict, UI_PREF="compact,mode=table"; Path=/polarion/ui; Expires=${expiry}`
    },
    body: ""
  });
  const response = rewriteBridgeResponse(await queued.result, { sessionId: session.sessionId, route: "polarion" });
  const prefix = `/bridge/sessions/${session.sessionId}/polarion/`;
  const namePrefix = `AFB_${session.sessionId.replace(/-/g, "")}_polarion_`;
  assert.deepEqual(response.headers["set-cookie"], [
    `${namePrefix}JSESSIONID=session-fixture; Path=${prefix}; HttpOnly; SameSite=Lax; Expires=${expiry}`,
    `${namePrefix}X-CSRF-Token=csrf-fixture; Path=${prefix}; Secure; SameSite=Strict`,
    `${namePrefix}UI_PREF="compact,mode=table"; Path=${prefix}ui; Expires=${expiry}`
  ]);
  const requestHeaders = bridgeRequestHeaders({
    cookie: response.headers["set-cookie"].slice(0, 2).map(cookie => cookie.split(";")[0]).join("; ")
  }, { sessionId: session.sessionId, route: "polarion" });
  assert.equal(requestHeaders.cookie, "JSESSIONID=session-fixture; X-CSRF-Token=csrf-fixture");
  store.close();
});

test("Polarion multi-megabyte GWT script survives connector settlement without a regex stack overflow", async t => {
  const { createBridgeSessionStore, rewriteBridgeResponse } = await bridgeModule();
  const store = createBridgeSessionStore();
  t.after(() => store.close());
  const session = store.create({ userId: "U1", routes: ["polarion"], connectorToken });
  store.heartbeat(session.sessionId, connectorToken);
  const queued = store.enqueue(session.sessionId, "U1", { route: "polarion", method: "GET", path: "/gwt/com.polarion.UI/bootstrap.cache.js" });
  queued.result.catch(() => {});
  const [job] = await store.poll(session.sessionId, connectorToken, 0);
  const bytes = Buffer.alloc(7_082_204, 65);
  store.settle(session.sessionId, connectorToken, job.id, {
    status: 200, headers: { "content-type": "text/javascript" }, body: bytes.toString("base64")
  });
  const response = rewriteBridgeResponse(await queued.result, { sessionId: session.sessionId, route: "polarion" });
  assert.deepEqual(Buffer.from(response.body, "base64"), bytes);
  for (const invalid of ["A", "A===", "AAAA\n", "AA=A", "===="]) {
    assert.throws(() => store.enqueue(session.sessionId, "U1", { route: "polarion", method: "POST", path: "/", body: invalid }), cause => cause.status === 413);
  }
});

test("Polarion GWT requests restore only their module-base metadata to the native context", async () => {
  const { bridgeRequestBody, bridgeRequestHeaders } = await bridgeModule();
  const prefix = "/bridge/sessions/SESSION-1/polarion/";
  const moduleBase = `https://auditflow.example${prefix}gwt/com.polarion.UI/`;
  const nativeBase = "https://auditflow.example/polarion/gwt/com.polarion.UI/";
  const options = { sessionId: "SESSION-1", route: "polarion", publicOrigin: "https://auditflow.example" };
  const headers = { "content-type": "text/x-gwt-rpc; charset=UTF-8", "x-gwt-module-base": moduleBase };
  const original = Buffer.from(`7|0|5|${moduleBase}|POLICY|XsrfService|getNewXsrfToken|${moduleBase}evidence|1|2|3|4|0|`);
  const restored = bridgeRequestBody(original, { ...options, headers });
  assert.equal(restored.toString(), `7|0|5|${nativeBase}|POLICY|XsrfService|getNewXsrfToken|${moduleBase}evidence|1|2|3|4|0|`);
  assert.equal(bridgeRequestHeaders(headers, options)["x-gwt-module-base"], nativeBase);
  assert.deepEqual(bridgeRequestBody(original, { ...options, headers: { "content-type": "application/json" } }), original);
  assert.deepEqual(bridgeRequestBody(original, { ...options, route: "jira", headers }), original);
  assert.deepEqual(bridgeRequestBody(original, { ...options, publicOrigin: "https://other.example", headers }), original);
});

test("Polarion bridge stays inside the route and maps its fixed context path", async t => {
  const { createBridgeSessionStore, relayLocalBridgeRequest, rewriteBridgeResponse, bridgeRequestHeaders } = await bridgeModule();
  const observed = [];
  const upstream = http.createServer((request, response) => {
    observed.push({ path: request.url, host: request.headers.host, cookie: request.headers.cookie || "" });
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "set-cookie": [
        "JSESSIONID=polarion-fixture; Path=/polarion; HttpOnly; SameSite=Lax",
        "X-CSRF-Token=csrf-fixture; Path=/polarion; SameSite=Lax"
      ]
    });
    response.end('<html><head></head><body><a href="http://192.168.8.90:9080/polarion/#/project/test">Project</a><script src="https://172.16.2.5:9443/polarion/assets/app.js"></script></body></html>');
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => upstream.close(resolve)));

  const store = createBridgeSessionStore();
  const session = store.create({ userId: "U1", routes: ["polarion"], connectorToken });
  store.heartbeat(session.sessionId, connectorToken);
  const queued = store.enqueue(session.sessionId, "U1", { route: "polarion", path: "/api/health", method: "GET" });
  const [job] = await store.poll(session.sessionId, connectorToken, 0);
  const port = upstream.address().port;
  const response = await relayLocalBridgeRequest(job, {
    localTargets: {
      polarion: { host: "127.0.0.1", port, protocol: "http:", baseUrl: `http://127.0.0.1:${port}/polarion/` }
    }
  });
  store.settle(session.sessionId, connectorToken, job.id, response);
  assert.equal((await queued.result).status, 200);
  assert.deepEqual(observed, [{ path: "/polarion/api/health", host: `127.0.0.1:${port}`, cookie: "" }]);

  const page = rewriteBridgeResponse(response, { sessionId: session.sessionId, route: "polarion" });
  const html = Buffer.from(page.body, "base64").toString("utf8");
  assert.ok(html.includes(`/bridge/sessions/${session.sessionId}/polarion/#/project/test`));
  assert.ok(html.includes(`/bridge/sessions/${session.sessionId}/polarion/assets/app.js`));
  const cookiePrefix = `/bridge/sessions/${session.sessionId}/polarion/`;
  assert.deepEqual(page.headers["set-cookie"].map(cookie => cookie.match(/;\s*Path=([^;]+)/)?.[1]), [cookiePrefix, cookiePrefix]);
  const requestHeaders = bridgeRequestHeaders({
    cookie: `AFB_${session.sessionId.replace(/-/g, "")}_polarion_JSESSIONID=polarion-fixture; AFB_${session.sessionId.replace(/-/g, "")}_polarion_X-CSRF-Token=csrf-fixture`
  }, { sessionId: session.sessionId, route: "polarion" });
  assert.equal(requestHeaders.cookie, "JSESSIONID=polarion-fixture; X-CSRF-Token=csrf-fixture");
  await relayLocalBridgeRequest({ ...job, path: "/rest/api", headers: requestHeaders }, {
    localTargets: {
      polarion: { host: "127.0.0.1", port, protocol: "http:", baseUrl: `http://127.0.0.1:${port}/polarion/` }
    }
  });
  assert.equal(observed[1].path, "/polarion/rest/api");
  assert.equal(observed[1].cookie, "JSESSIONID=polarion-fixture; X-CSRF-Token=csrf-fixture");
  const bootstrap = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  const requests = [];
  const context = {
    URL,
    Request,
    location: new URL(`https://auditflow.example/bridge/sessions/${session.sessionId}/polarion/`),
    document: { documentElement: {}, addEventListener() {} },
    Document: class {},
    MutationObserver: class { observe() {} },
    XMLHttpRequest: class { open() {} }
  };
  context.window = { fetch: (...args) => requests.push(args) };
  vm.createContext(context);
  vm.runInContext(bootstrap, context);
  context.fetch = context.window.fetch;
  vm.runInContext('fetch("http://192.168.8.90:9080/polarion/rest/api")', context);
  assert.equal(requests[0][0], `https://auditflow.example/bridge/sessions/${session.sessionId}/polarion/rest/api`);
  await assert.rejects(() => relayLocalBridgeRequest(job, {
    localTargets: { polarion: { host: "127.0.0.1", port, protocol: "https:", baseUrl: `https://127.0.0.1:${port}/polarion/` } }
  }), error => ["EPROTO", "ERR_SSL_WRONG_VERSION_NUMBER"].includes(error.code));
  await assert.rejects(() => relayLocalBridgeRequest(job, {
    localTargets: { polarion: { host: "127.0.0.1", port: port + 1, protocol: "http:", baseUrl: `http://127.0.0.1:${port}/polarion/` } }
  }), /must match/i);
  assert.throws(() => store.create({ userId: "U1", routes: ["http://192.168.8.90"], connectorToken }), /route/i);
  await assert.rejects(() => relayLocalBridgeRequest({ ...job, route: "polarion" }, {
    hosts: { polarion: "8.8.8.8" },
    ports: { polarion: upstream.address().port }
  }), /private ip/i);
});

test("Atlassian login pages preserve the native two-step login mount instead of posting legacy credentials", async () => {
  const { rewriteBridgeResponse } = await bridgeModule();
  const html = '<html><head></head><body><div id="react-container"></div><script>WRM._dataArrived()</script></body></html>';
  const output = rewriteBridgeResponse({
    status: 200,
    headers: { "content-type": "text/html; charset=UTF-8" },
    body: Buffer.from(`${html}<!-- login-gateway-data -->`).toString("base64")
  }, { sessionId: "SESSION-1", route: "jira" });
  const text = Buffer.from(output.body, "base64").toString("utf8");
  assert.match(text, /<div id="react-container"><\/div>/);
  assert.doesNotMatch(text, /name="os_password"/);
  assert.match(text, /WRM\._dataArrived\(\)/);
});

test("bridge JavaScript preserves regex literals and executes native authentication requests through the adapter", async () => {
  const { rewriteBridgeResponse } = await bridgeModule();
  const source = 'const quote = /"/g; fetch("/rest/tsv/1.0/authenticate", {method:"POST"});';
  const output = rewriteBridgeResponse({ status: 200, headers: { "content-type": "application/javascript" }, body: Buffer.from(source).toString("base64") }, { sessionId: "SESSION-1", route: "jira" });
  const rewritten = Buffer.from(output.body, "base64").toString();
  assert.doesNotThrow(() => new vm.Script(rewritten));
  const page = rewriteBridgeResponse({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from('<html><head></head><body></body></html>').toString("base64") }, { sessionId: "SESSION-1", route: "jira" });
  const script = Buffer.from(page.body, "base64").toString().match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  const requests = [];
  const context = { URL, Request, location: new URL("https://auditflow.example/bridge/sessions/SESSION-1/jira/login.jsp"), document: { documentElement: {}, addEventListener() {} }, Document: class {}, MutationObserver: class { observe() {} }, XMLHttpRequest: class { open() {} } };
  context.window = { fetch: (...args) => requests.push(args) };
  vm.createContext(context);
  vm.runInContext(script, context);
  context.fetch = context.window.fetch;
  vm.runInContext(rewritten, context);
  assert.equal(requests[0][0], "https://auditflow.example/bridge/sessions/SESSION-1/jira/rest/tsv/1.0/authenticate");
  assert.equal(requests[0][1].method, "POST");
});

test("inline login scripts keep their syntax while HTML assets remain bridge scoped", async () => {
  const { rewriteBridgeResponse } = await bridgeModule();
  const source = 'const quote = /"/g; const markup = \'<a href="/">Home</a>\';';
  const output = rewriteBridgeResponse({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from(`<html><head><script>${source}</script><script src="/login.js"></script></head><body><a href="/secure/Signup!default.jspa">Register</a></body></html>`).toString("base64") }, { sessionId: "SESSION-1", route: "jira" });
  const html = Buffer.from(output.body, "base64").toString();
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  assert.doesNotThrow(() => new vm.Script(inline));
  assert.equal(inline, source);
  assert.match(html, /src="\/bridge\/sessions\/SESSION-1\/jira\/login.js"/);
  assert.match(html, /href="\/bridge\/sessions\/SESSION-1\/jira\/secure\/Signup!default.jspa"/);
});

test("Jira context path scopes native post-login navigation without changing JSON shortcut data", async () => {
  const { rewriteBridgeResponse } = await bridgeModule();
  const options = { sessionId: "SESSION-1", route: "jira" };
  const html = '<html><head><meta name="ajs-context-path" content=""></head><body></body></html>';
  const output = rewriteBridgeResponse({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from(html).toString("base64") }, options);
  assert.match(Buffer.from(output.body, "base64").toString(), /name="ajs-context-path" content="\/bridge\/sessions\/SESSION-1\/jira"/);
  const json = '{"shortcut":"/","description":"Use / to search"}';
  const data = rewriteBridgeResponse({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(json).toString("base64") }, options);
  assert.equal(Buffer.from(data.body, "base64").toString(), json);
});

test("Jira native WRM context scopes lazy scripts and post-login navigation", async () => {
  const { rewriteBridgeResponse } = await bridgeModule();
  const source = String.raw`window.contextPath = '';
WRM._unparsedData["com.atlassian.plugins.atlassian-plugins-webresource-plugin:context-path.context-path"]="\u0022\u0022";
const example = "window.contextPath = '';";
const unrelated = {"shortcut":"/","description":"Use / to search"};`;
  const output = rewriteBridgeResponse({
    status: 200, headers: { "content-type": "text/html" },
    body: Buffer.from(`<html><head><script>${source}</script></head><body></body></html>`).toString("base64")
  }, { sessionId: "SESSION-1", route: "jira" });
  const html = Buffer.from(output.body, "base64").toString();
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  const context = { window: { location: {} }, WRM: { _unparsedData: {} }, AJS: {} };
  context.window.AJS = context.AJS;
  context.WRM.data = { claim: key => JSON.parse(context.WRM._unparsedData[key]) };
  vm.createContext(context);
  vm.runInContext(script, context);
  // Jira's native WRM caches this claim; modern login uses AJS.contextPath().
  vm.runInContext(`(function () {
    let cached = null;
    AJS.contextPath = WRM.contextPath = function () {
      if (cached === null) cached = WRM.data.claim("com.atlassian.plugins.atlassian-plugins-webresource-plugin:context-path.context-path");
      return cached;
    };
    window.location.href = window.AJS.contextPath() + "/default.jsp";
  })();`, context);
  assert.equal(context.WRM.contextPath() + "/s/lazy/batch.js", "/bridge/sessions/SESSION-1/jira/s/lazy/batch.js");
  assert.equal(context.window.location.href, "/bridge/sessions/SESSION-1/jira/default.jsp");
  assert.equal(context.window.contextPath + "/default.jsp", "/bridge/sessions/SESSION-1/jira/default.jsp");
  assert.ok(script.includes(`const example = "window.contextPath = '';";`));
  assert.ok(script.includes('{"shortcut":"/","description":"Use / to search"}'));
});

test("Jira post-signup login destinations use service paths instead of stale LAN origins", async () => {
  const { rewriteBridgeResponse } = await bridgeModule();
  const options = { sessionId: "SESSION-1", route: "jira" };
  for (const [destination, expected] of [
    ["http://192.168.8.31:8080/secure/MyJiraHome.jspa", "/secure/MyJiraHome.jspa"],
    ["/bridge/sessions/SESSION-1/jira/default.jsp", "/default.jsp"],
    ["https://untrusted.invalid/", "/default.jsp"]
  ]) {
    const response = rewriteBridgeResponse({ status: 302, headers: { location: `/login.jsp?os_destination=${encodeURIComponent(destination)}` }, body: "" }, options);
    const target = new URL(response.headers.location, "https://auditflow.example");
    assert.equal(target.pathname, "/bridge/sessions/SESSION-1/jira/login.jsp");
    assert.equal(target.searchParams.get("os_destination"), expected);
  }
});

test("relay uses the approved bridge authority without accepting browser proxy headers", async t => {
  const { relayLocalBridgeRequest } = await bridgeModule();
  const upstream = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(request.headers));
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  const result = await relayLocalBridgeRequest({
    route: "jira", path: "/login.jsp", method: "POST",
    headers: { host: "attacker.invalid", "x-forwarded-host": "attacker.invalid", origin: "https://attacker.invalid" }
  }, { ports: { jira: upstream.address().port }, publicOrigin: "http://127.0.0.1:47583" });
  const headers = JSON.parse(Buffer.from(result.body, "base64").toString());
  assert.equal(headers.host, "127.0.0.1:47583");
  assert.equal(headers.origin, "http://127.0.0.1:47583");
  assert.equal(headers["x-forwarded-host"], undefined);
  await assert.rejects(() => relayLocalBridgeRequest({ route: "jira", path: "/" }, { publicOrigin: "http://attacker.invalid" }), /HTTPS/i);
});

test("public bridge redirects and base URL metadata retain one session prefix", async () => {
  const { rewriteBridgeResponse } = await bridgeModule();
  const options = { sessionId: "SESSION-1", route: "jira", publicOrigin: "http://127.0.0.1:47583" };
  const redirect = rewriteBridgeResponse({ status: 302, headers: { location: "http://127.0.0.1:47583/login.jsp" }, body: "" }, options);
  assert.equal(redirect.headers.location, "/bridge/sessions/SESSION-1/jira/login.jsp");
  const page = rewriteBridgeResponse({
    status: 200, headers: { "content-type": "text/html" },
    body: Buffer.from('<html><head><meta name="ajs-base-url" content="http://192.168.8.31:8080"><meta name="ajs-jira-base-url" content="http://192.168.8.31:8080"></head><body><a href="http://192.168.8.31:8080/">Home</a></body></html>').toString("base64")
  }, options);
  const html = Buffer.from(page.body, "base64").toString();
  assert.match(html, /name="ajs-base-url" content="http:\/\/127.0.0.1:47583\/bridge\/sessions\/SESSION-1\/jira"/);
  assert.match(html, /href="\/bridge\/sessions\/SESSION-1\/jira\/"/);
  assert.doesNotMatch(html, /jira\/bridge\/sessions/);
});

test("Jira history navigation remains inside the bridge and preserves omitted URLs", async () => {
  const { rewriteBridgeResponse } = await bridgeModule();
  const output = rewriteBridgeResponse({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("<html><head></head></html>").toString("base64") }, { sessionId: "SESSION-1", route: "jira" });
  const script = Buffer.from(output.body, "base64").toString().match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  const paths = [];
  const context = { URL, Request, location: new URL("http://127.0.0.1:47583/bridge/sessions/SESSION-1/jira/issues/"), document: { documentElement: {}, addEventListener() {} }, Document: class {}, MutationObserver: class { observe() {} }, XMLHttpRequest: class { open() {} } };
  context.window = { history: { pushState: (...args) => paths.push(args), replaceState: (...args) => paths.push(args) } };
  vm.runInNewContext(script, context);
  context.window.history.pushState({}, "", "/browse/ASPICE-3?jql=test");
  context.window.history.replaceState({}, "", "/bridge/sessions/SESSION-1/jira/browse/ASPICE-2");
  context.window.history.replaceState({}, "");
  assert.equal(paths[0][2], "http://127.0.0.1:47583/bridge/sessions/SESSION-1/jira/browse/ASPICE-3?jql=test");
  assert.equal(paths[1][2], "/bridge/sessions/SESSION-1/jira/browse/ASPICE-2");
  assert.equal(paths[2].length, 2);
});

test("runtime image and link attribute changes stay inside the Polarion session without observer loops", async () => {
  const { rewriteBridgeResponse } = await bridgeModule();
  const output = rewriteBridgeResponse({
    status: 200, headers: { "content-type": "text/html" },
    body: Buffer.from("<html><head></head></html>").toString("base64")
  }, { sessionId: "SESSION-1", route: "polarion" });
  const script = Buffer.from(output.body, "base64").toString().match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  let changed, observed;
  const context = {
    URL, Request, location: new URL("https://auditflow.example/bridge/sessions/SESSION-1/polarion/"),
    document: { documentElement: {}, addEventListener() {} }, Document: class {},
    MutationObserver: class {
      constructor(callback) { changed = callback; }
      observe(_node, options) { observed = options; }
    },
    XMLHttpRequest: class { open() {} }, window: {}
  };
  vm.runInNewContext(script, context);
  const attributes = new Map([["src", "/polarion/ria/images/tree/L-_lite.svg"]]);
  let writes = 0;
  const image = {
    nodeType: 1,
    getAttribute: name => attributes.get(name),
    setAttribute: (name, value) => { attributes.set(name, value); writes += 1; }
  };
  changed([{ type: "attributes", target: image, addedNodes: [] }]);
  assert.equal(attributes.get("src"), "https://auditflow.example/bridge/sessions/SESSION-1/polarion/ria/images/tree/L-_lite.svg");
  changed([{ type: "attributes", target: image, addedNodes: [] }]);
  assert.equal(writes, 1, "rewritten attributes must not trigger an endless mutation cycle");
  assert.equal(observed.attributes, true);
});

test("off-DOM Polarion image preloads use the bridge before issuing a network request", async () => {
  const { rewriteBridgeResponse } = await bridgeModule();
  const output = rewriteBridgeResponse({
    status: 200, headers: { "content-type": "text/html" },
    body: Buffer.from("<html><head></head></html>").toString("base64")
  }, { sessionId: "SESSION-1", route: "polarion" });
  const script = Buffer.from(output.body, "base64").toString().match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  const requested = [];
  class ImageElement {
    get src() { return this.address; }
    set src(value) { this.address = value; requested.push(value); }
  }
  const context = {
    URL, Request, location: new URL("https://auditflow.example/bridge/sessions/SESSION-1/polarion/"),
    document: { documentElement: {}, addEventListener() {} }, Document: class {},
    MutationObserver: class { observe() {} }, XMLHttpRequest: class { open() {} },
    window: { HTMLImageElement: ImageElement }
  };
  vm.runInNewContext(script, context);
  const image = new ImageElement();
  image.src = "/polarion/ria/images/searchHintIcon.png";
  assert.deepEqual(requested, ["https://auditflow.example/bridge/sessions/SESSION-1/polarion/ria/images/searchHintIcon.png"]);
});

test("Jira lazy script and stylesheet properties are scoped before native loading", async () => {
  const { rewriteBridgeResponse } = await bridgeModule();
  const output = rewriteBridgeResponse({
    status: 200, headers: { "content-type": "text/html" },
    body: Buffer.from("<html><head></head></html>").toString("base64")
  }, { sessionId: "SESSION-1", route: "jira" });
  const script = Buffer.from(output.body, "base64").toString().match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  const requested = [];
  class ScriptElement {
    get src() { return this.address; }
    set src(value) { this.address = value; requested.push(value); }
  }
  class LinkElement {
    get href() { return this.address; }
    set href(value) { this.address = value; requested.push(value); }
  }
  vm.runInNewContext(script, {
    URL, Request, location: new URL("https://auditflow.example/bridge/sessions/SESSION-1/jira/secure/RapidBoard.jspa"),
    document: { documentElement: {}, addEventListener() {} }, Document: class {},
    MutationObserver: class { observe() {} }, XMLHttpRequest: class { open() {} },
    window: { HTMLScriptElement: ScriptElement, HTMLLinkElement: LinkElement }
  });
  new ScriptElement().src = "/s/hash/_/download/contextbatch/js/chunk/batch.js?locale=zh-CN";
  new LinkElement().href = "/s/hash/_/download/contextbatch/css/chunk/batch.css";
  new ScriptElement().src = "https://cdn.example/app.js";
  assert.deepEqual(requested, [
    "https://auditflow.example/bridge/sessions/SESSION-1/jira/s/hash/_/download/contextbatch/js/chunk/batch.js?locale=zh-CN",
    "https://auditflow.example/bridge/sessions/SESSION-1/jira/s/hash/_/download/contextbatch/css/chunk/batch.css",
    "https://cdn.example/app.js"
  ]);
});
