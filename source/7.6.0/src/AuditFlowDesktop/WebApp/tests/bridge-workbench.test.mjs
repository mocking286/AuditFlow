import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../bridge-workbench.js", import.meta.url), "utf8");
const root = { location: { hostname: "127.0.0.1" } };
vm.runInNewContext(source, { window: root, URL });
const validate = root.AuditFlowBridgeWorkbench.validateConnection;
test("bridge connection accepts a public origin or loopback test origin", () => {
  const connection = validate({ remoteOrigin: "https://auditflow.example.com", sessionId: "test-session", connectorToken: "a".repeat(64) });
  assert.equal(connection.remoteOrigin, "https://auditflow.example.com");
  assert.equal(validate({ ...connection, remoteOrigin: "http://127.0.0.1:47583" }).remoteOrigin, "http://127.0.0.1:47583");
});
test("bridge UI rejects insecure, credential-bearing and path origins", () => {
  for (const remoteOrigin of ["http://public.example.com", "https://name:password@example.com", "https://example.com/path", "https://example.com/?token=secret"]) assert.throws(() => validate({ remoteOrigin, sessionId: "session", connectorToken: "a".repeat(64) }));
  assert.throws(() => validate({ remoteOrigin: "https://example.com", sessionId: "../session", connectorToken: "short" }));
});
test("bridge tokens remain in transient UI state only", () => {
  assert.doesNotMatch(source, /localStorage|sessionStorage|console\.log/);
  assert.match(source, /form\.elements\.connectorToken\.value = ""/);
  assert.match(source, /secret = null/);
});

function bridgeHarness(overrides = {}) {
  const dialogs = [], children = [], handlers = {}, revoked = [], timers = new Set();
  const trigger = { dataset: {}, attributes: {}, addEventListener() {}, setAttribute(name, value) { this.attributes[name] = value; }, focus() {} };
  const backend = {
    baseUrl: "https://auditflow.example.test",
    async listBridgeSessions() { return { sessions: [] }; },
    async createBridgeSession() { return { session: { sessionId: "SESSION-CURRENT" }, connectorToken: "test-token-for-bridge-ui-lifecycle-only-12345" }; },
    async revokeBridgeSession(sessionId) { revoked.push(sessionId); },
    ...overrides
  };
  const browser = {
    location: { hostname: "auditflow.example.test", href: "https://auditflow.example.test/index.html" },
    document: {
      readyState: "complete",
      documentElement: { lang: "en" },
      getElementById() { return trigger; },
      createElement() {
        const nodes = new Map();
        const dialog = {
          open: false, handlers: {},
          setAttribute() {},
          showModal() { this.open = true; },
          remove() { this.open = false; const index = children.indexOf(this); if (index >= 0) children.splice(index, 1); },
          addEventListener(name, callback) { this.handlers[name] = callback; },
          querySelector(selector) {
            if (selector === "form") return null;
            if (!nodes.has(selector)) nodes.set(selector, { hidden: true, value: "", innerHTML: "", textContent: "", dataset: {} });
            return nodes.get(selector);
          }
        };
        dialogs.push(dialog);
        return dialog;
      },
      body: { append(node) { children.push(node); } }
    },
    AuditFlowBackend: backend,
    setInterval() { const id = timers.size + 1; timers.add(id); return id; },
    addEventListener(name, callback) { handlers[name] = callback; }
  };
  vm.runInNewContext(source, { window: browser, URL, clearInterval(id) { timers.delete(id); } });
  async function click(dialog, attribute) {
    const button = { disabled: false, hasAttribute: name => name === attribute };
    await dialog.handlers.click({ target: { closest: () => button } });
  }
  return { api: browser.AuditFlowBridgeWorkbench, dialogs, children, handlers, revoked, trigger, timers, click };
}

test("late creation response cannot populate a reopened bridge dialog", async () => {
  let resolveCreation;
  const creation = new Promise(resolve => { resolveCreation = resolve; });
  const harness = bridgeHarness({ createBridgeSession: () => creation });
  harness.api.open();
  const pending = harness.click(harness.dialogs[0], "data-bridge-create");
  harness.api.close();
  harness.api.open();
  resolveCreation({ session: { sessionId: "SESSION-OLD" }, connectorToken: "old-window-token-for-regression-only-12345" });
  await pending;
  const current = harness.dialogs[1];
  assert.equal(current.querySelector("[data-bridge-secret]").hidden, true);
  assert.equal(current.querySelector("[data-bridge-details]").value, "");
  assert.deepEqual(harness.revoked, ["SESSION-OLD"]);
  harness.api.close();
});

test("late session refresh cannot overwrite a reopened dialog", async () => {
  let resolveFirstRefresh, reads = 0;
  const firstRefresh = new Promise(resolve => { resolveFirstRefresh = resolve; });
  const harness = bridgeHarness({ listBridgeSessions: () => ++reads === 1 ? firstRefresh : Promise.resolve({ sessions: [] }) });
  harness.api.open();
  harness.api.close();
  harness.api.open();
  for (let i = 0; i < 4; i++) await Promise.resolve();
  const current = harness.dialogs[1], before = current.querySelector("[data-bridge-sessions]").innerHTML;
  resolveFirstRefresh({ sessions: [{ sessionId: "SESSION-OLD", status: "connecting", expiresAt: new Date().toISOString(), routes: [] }] });
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.equal(current.querySelector("[data-bridge-sessions]").innerHTML, before);
  assert.doesNotMatch(before, /SESSION-OLD/);
  harness.api.close();
});

for (const event of ["pagehide", "auditflow-logged-out"]) {
  test(`${event} removes token-bearing bridge DOM and stops polling`, async () => {
    const harness = bridgeHarness();
    harness.api.open();
    const dialog = harness.dialogs[0];
    await harness.click(dialog, "data-bridge-create");
    assert.match(dialog.querySelector("[data-bridge-details]").value, /connectorToken/);
    assert.equal(harness.children.length, 1);
    assert.equal(harness.timers.size, 1);
    harness.handlers[event]();
    assert.equal(harness.children.length, 0);
    assert.equal(dialog.open, false);
    assert.equal(harness.timers.size, 0);
    assert.equal(harness.trigger.attributes["aria-expanded"], "false");
    harness.api.open();
    assert.equal(harness.dialogs[1].querySelector("[data-bridge-details]").value, "");
    harness.api.close();
  });
}
