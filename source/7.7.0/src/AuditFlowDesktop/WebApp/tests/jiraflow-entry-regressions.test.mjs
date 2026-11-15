import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const scriptPath = fileURLToPath(new URL("../workbench-jiraflow-link.js", import.meta.url));
const script = await readFile(scriptPath, "utf8");

function createHarness({ embedded = false, fetchHealth, storedWorkspace, locationHref } = {}) {
  const listeners = new Map();
  const attributes = new Map();
  const parentMessages = [];
  const timers = new Map();
  let nextTimerId = 1;
  const link = {
    dataset: {},
    href: "#",
    title: "",
    addEventListener(type, callback) { listeners.set(`link:${type}`, callback); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    removeAttribute(name) { attributes.delete(name); }
  };
  const parent = {
    postMessage(message, targetOrigin) { parentMessages.push({ message, targetOrigin }); }
  };
  const pageUrl = new URL(locationHref || (embedded
    ? "http://127.0.0.1:4173/index.html?embedded=1"
    : "file:///AuditFlow/index.html"));
  const window = {
    location: {
      search: pageUrl.search,
      origin: pageUrl.origin,
      protocol: pageUrl.protocol,
      href: pageUrl.href
    },
    parent: embedded ? parent : null,
    localStorage: {
      getItem(key) {
        if (key !== "auditflow-ai-workspace-v1" || storedWorkspace === undefined) return null;
        return JSON.stringify(storedWorkspace);
      }
    },
    fetch: fetchHealth || (async () => { throw new Error("unavailable"); }),
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(type, callback) { listeners.set(`window:${type}`, callback); }
  };
  window.parent ||= window;
  const document = {
    visibilityState: "visible",
    querySelector(selector) { return selector === ".jiraflow-link" ? link : null; },
    addEventListener(type, callback) { listeners.set(`document:${type}`, callback); }
  };
  const context = vm.createContext({
    AbortController,
    URL,
    URLSearchParams,
    document,
    window
  });
  vm.runInContext(script, context, { filename: scriptPath });

  return {
    attributes,
    link,
    listeners,
    parent,
    parentMessages,
    async settle() {
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));
    },
    runTimerWithDelay(delay) {
      const match = [...timers.entries()].find(([, timer]) => timer.delay === delay);
      if (!match) return false;
      const [id, timer] = match;
      timers.delete(id);
      timer.callback();
      return true;
    }
  };
}

test("file JiraFlow entry discovers a healthy whitelisted loopback service", async () => {
  const calls = [];
  const harness = createHarness({
    fetchHealth: async url => {
      calls.push(url);
      if (url !== "http://127.0.0.1:4188/health") throw new Error("not this port");
      return {
        ok: true,
        async json() { return { status: "ok", service: "JiraFlow", version: "2.1.0" }; }
      };
    }
  });
  await harness.settle();

  assert.equal(harness.link.dataset.jiraFlowStatus, "healthy");
  assert.equal(harness.link.href, "http://127.0.0.1:4188/");
  assert.equal(harness.attributes.get("aria-disabled"), "false");
  assert.deepEqual(calls, [
    "http://127.0.0.1:4173/api/health",
    "http://127.0.0.1:4173/health",
    "http://127.0.0.1:6195/health",
    "http://127.0.0.1:4188/health"
  ]);
});

test("embedded desktop JiraFlow entry uses its current backend origin before fallback ports", async () => {
  const calls = [];
  const harness = createHarness({
    embedded: true,
    locationHref: "http://127.0.0.1:4176/index.html?embedded=1",
    fetchHealth: async url => {
      calls.push(url);
      if (url === "http://127.0.0.1:4176/api/health") {
        return {
          ok: true,
          async json() {
            return {
              status: "ok",
              jiraFlow: {
                available: true,
                healthy: true,
                status: "healthy",
                port: 4194,
                baseUri: "http://127.0.0.1:4194/",
                version: "2.1.0"
              }
            };
          }
        };
      }
      if (url === "http://127.0.0.1:4194/health") {
        return {
          ok: true,
          async json() { return { status: "ok", service: "JiraFlow", version: "2.1.0" }; }
        };
      }
      throw new Error("unexpected fallback probe");
    }
  });
  await harness.settle();
  assert.equal(harness.link.href, "http://127.0.0.1:4194/");
  assert.deepEqual(calls, [
    "http://127.0.0.1:4176/api/health",
    "http://127.0.0.1:4194/health"
  ]);
});

test("standalone JiraFlow entry follows the dynamic port advertised by local backend health", async () => {
  const calls = [];
  const harness = createHarness({
    storedWorkspace: {
      settings: { backendUrl: "http://127.0.0.1:4176" }
    },
    fetchHealth: async url => {
      calls.push(url);
      if (url === "http://127.0.0.1:4176/api/health") {
        return {
          ok: true,
          async json() {
            return {
              status: "ok",
              app: "JEAuditFlow",
              version: "6.6.0",
              jiraFlow: {
                available: true,
                healthy: true,
                status: "healthy",
                port: 4194,
                baseUri: "http://127.0.0.1:4194/",
                version: "2.1.0"
              }
            };
          }
        };
      }
      if (url === "http://127.0.0.1:4194/health") {
        return {
          ok: true,
          async json() { return { status: "ok", service: "JiraFlow", version: "2.1.0" }; }
        };
      }
      throw new Error("unexpected probe");
    }
  });
  await harness.settle();

  assert.equal(harness.link.dataset.jiraFlowStatus, "healthy");
  assert.equal(harness.link.href, "http://127.0.0.1:4194/");
  assert.equal(harness.attributes.get("aria-disabled"), "false");
  assert.deepEqual(calls, [
    "http://127.0.0.1:4176/api/health",
    "http://127.0.0.1:4194/health"
  ]);
});

test("backend health falls back from /api/health to /health for dynamic JiraFlow discovery", async () => {
  const calls = [];
  const harness = createHarness({
    fetchHealth: async url => {
      calls.push(url);
      if (url === "http://127.0.0.1:4173/api/health") {
        return { ok: false, async json() { return {}; } };
      }
      if (url === "http://127.0.0.1:4173/health") {
        return {
          ok: true,
          async json() {
            return {
              status: "ok",
              jiraFlow: {
                available: true,
                healthy: true,
                status: "healthy",
                port: 4194,
                baseUri: "http://127.0.0.1:4194/",
                version: "2.1.0"
              }
            };
          }
        };
      }
      if (url === "http://127.0.0.1:4194/health") {
        return {
          ok: true,
          async json() { return { status: "ok", service: "JiraFlow", version: "2.1.0" }; }
        };
      }
      throw new Error("unexpected probe");
    }
  });
  await harness.settle();

  assert.equal(harness.link.href, "http://127.0.0.1:4194/");
  assert.deepEqual(calls, [
    "http://127.0.0.1:4173/api/health",
    "http://127.0.0.1:4173/health",
    "http://127.0.0.1:4194/health"
  ]);
});

test("backend health cannot advertise a non-loopback JiraFlow URL", async () => {
  const calls = [];
  const harness = createHarness({
    fetchHealth: async url => {
      calls.push(url);
      if (url === "http://127.0.0.1:4173/api/health" || url === "http://127.0.0.1:4173/health") {
        return {
          ok: true,
          async json() {
            return {
              status: "ok",
              jiraFlow: {
                available: true,
                healthy: true,
                status: "healthy",
                port: 4194,
                baseUri: "http://192.168.1.10:4194/",
                version: "2.1.0"
              }
            };
          }
        };
      }
      throw new Error("unexpected probe");
    }
  });
  await harness.settle();

  assert.equal(harness.link.dataset.jiraFlowStatus, "unavailable");
  assert.equal(harness.attributes.get("aria-disabled"), "true");
  assert.equal(harness.link.dataset.jiraFlowHref, "");
  assert.deepEqual(calls.slice(0, 2), [
    "http://127.0.0.1:4173/api/health",
    "http://127.0.0.1:4173/health"
  ]);
});

test("hosted JiraFlow uses the same-origin proxy and never probes the visitor's localhost", async () => {
  const calls = [];
  const harness = createHarness({
    locationHref: "https://aspice-auditflow.cloud/index.html?fromLanding=1#/dashboard",
    fetchHealth: async url => {
      calls.push(url);
      if (url === "https://aspice-auditflow.cloud/api/health") {
        return {
          ok: true,
          async json() {
            return {
              status: "ok",
              role: "collaboration",
              jiraFlow: {
                available: true,
                healthy: true,
                status: "healthy",
                port: 4188,
                baseUri: "http://127.0.0.1:4188/",
                proxyBaseUri: "http://127.0.0.1:4173/jiraflow/",
                version: "2.1.0"
              }
            };
          }
        };
      }
      if (url === "https://aspice-auditflow.cloud/jiraflow/health") {
        return {
          ok: true,
          async json() { return { status: "ok", service: "JiraFlow", version: "2.1.0" }; }
        };
      }
      throw new Error(`unexpected hosted probe: ${url}`);
    }
  });
  await harness.settle();

  assert.equal(harness.link.dataset.jiraFlowStatus, "healthy");
  assert.equal(harness.link.href, "https://aspice-auditflow.cloud/jiraflow/");
  assert.equal(harness.attributes.get("aria-disabled"), "false");
  assert.deepEqual(calls, ["https://aspice-auditflow.cloud/jiraflow/health"]);
});

test("7.7 loopback web entry uses its authenticated same-origin proxy and ignores stale saved ports", async () => {
  const calls = [];
  const harness = createHarness({
    locationHref: "http://127.0.0.1:47683/index.html?fromLanding=1#/dashboard",
    storedWorkspace: {
      settings: { backendUrl: "http://127.0.0.1:4176", codexBridgeUrl: "http://127.0.0.1:4194" }
    },
    fetchHealth: async (url, options) => {
      calls.push({ url, credentials: options.credentials });
      if (url !== "http://127.0.0.1:47683/jiraflow/health") throw new Error("unexpected legacy port probe");
      return { ok: true, async json() { return { status: "ok", service: "JiraFlow", version: "2.1.0" }; } };
    }
  });
  await harness.settle();
  assert.equal(harness.link.href, "http://127.0.0.1:47683/jiraflow/");
  assert.equal(harness.attributes.get("aria-disabled"), "false");
  assert.deepEqual(calls, [{ url: "http://127.0.0.1:47683/jiraflow/health", credentials: "same-origin" }]);
});

test("loopback web entry stays same-origin when health advertises old direct and proxy ports", async () => {
  const calls = [];
  const harness = createHarness({
    locationHref: "http://localhost:47683/index.html",
    storedWorkspace: { settings: { backendUrl: "http://127.0.0.1:4173" } },
    fetchHealth: async url => {
      calls.push(url);
      if (url === "http://localhost:47683/api/health") {
        return { ok: true, async json() {
          return {
            jiraFlow: {
              available: true, healthy: true, status: "healthy", version: "2.1.0",
              port: 4194, baseUri: "http://127.0.0.1:4194/", proxyBaseUri: "http://127.0.0.1:4173/jiraflow/"
            }
          };
        } };
      }
      return { ok: false, async json() { return {}; } };
    }
  });
  await harness.settle();
  assert.equal(harness.attributes.get("aria-disabled"), "true");
  assert.equal(harness.link.href, "#");
  assert.deepEqual(calls, [
    "http://localhost:47683/jiraflow/health", "http://localhost:47683/api/health",
    "http://localhost:47683/jiraflow/health", "http://localhost:47683/health"
  ]);
});

test("loopback web entry never scans legacy ports while its proxy is unauthenticated or offline", async () => {
  for (const status of [401, 503]) {
    const calls = [];
    const harness = createHarness({
      locationHref: "http://127.0.0.1:47683/index.html",
      storedWorkspace: { settings: { backendUrl: "http://127.0.0.1:4176", codexBridgeUrl: "http://localhost:4173" } },
      fetchHealth: async (url, options) => {
        calls.push({ url, credentials: options.credentials });
        return { ok: false, status, async json() { return {}; } };
      }
    });
    await harness.settle();
    assert.equal(harness.attributes.get("aria-disabled"), "true");
    assert.equal(harness.runTimerWithDelay(1500), true);
    await harness.settle();
    assert.equal(calls.length, 6);
    assert.ok(calls.every(call => new URL(call.url).origin === "http://127.0.0.1:47683"));
    assert.ok(calls.every(call => call.credentials === "same-origin"));
  }
});

test("extension JiraFlow entry retains configured dynamic loopback discovery without page credentials", async () => {
  const calls = [];
  const harness = createHarness({
    locationHref: "chrome-extension://auditflow/index.html",
    storedWorkspace: { settings: { backendUrl: "http://127.0.0.1:47683" } },
    fetchHealth: async (url, options) => {
      calls.push({ url, credentials: options.credentials });
      if (url === "http://127.0.0.1:47683/api/health") {
        return { ok: true, async json() {
          return { jiraFlow: {
            available: true, healthy: true, status: "healthy", version: "2.1.0",
            port: 47685, baseUri: "http://127.0.0.1:47685/"
          } };
        } };
      }
      if (url === "http://127.0.0.1:47685/health") {
        return { ok: true, async json() { return { status: "ok", service: "JiraFlow", version: "2.1.0" }; } };
      }
      throw new Error("unexpected discovery request");
    }
  });
  await harness.settle();
  assert.equal(harness.link.href, "http://127.0.0.1:47685/");
  assert.deepEqual(calls, [
    { url: "http://127.0.0.1:47683/api/health", credentials: "omit" },
    { url: "http://127.0.0.1:47685/health", credentials: "omit" }
  ]);
});

test("LAN JiraFlow discovery uses only the same-origin proxy and never probes visitor localhost", async () => {
  const calls = [];
  const harness = createHarness({
    locationHref: "http://192.168.8.42:47273/index.html?fromLanding=1#/dashboard",
    fetchHealth: async url => {
      calls.push(url);
      if (url === "http://192.168.8.42:47273/jiraflow/health") {
        return {
          ok: true,
          async json() { return { status: "ok", service: "JiraFlow", version: "2.1.0" }; }
        };
      }
      throw new Error(`unexpected LAN discovery request: ${url}`);
    }
  });
  await harness.settle();

  assert.equal(harness.link.dataset.jiraFlowStatus, "healthy");
  assert.equal(harness.link.href, "http://192.168.8.42:47273/jiraflow/");
  assert.equal(harness.attributes.get("aria-disabled"), "false");
  assert.doesNotMatch(harness.attributes.get("data-tooltip-en"), /47273/);
  assert.deepEqual(calls, ["http://192.168.8.42:47273/jiraflow/health"]);
});

test("hosted JiraFlow stays disabled when its same-origin proxy does not answer", async () => {
  const calls = [];
  const harness = createHarness({
    locationHref: "https://aspice-auditflow.cloud/index.html",
    fetchHealth: async url => {
      calls.push(url);
      if (url === "https://aspice-auditflow.cloud/api/health") {
        return {
          ok: true,
          async json() {
            return {
              status: "ok",
              jiraFlow: {
                available: true,
                healthy: true,
                status: "healthy",
                port: 4188,
                version: "2.1.0"
              }
            };
          }
        };
      }
      throw new Error(`unexpected hosted probe: ${url}`);
    }
  });
  await harness.settle();

  assert.equal(harness.link.dataset.jiraFlowStatus, "unavailable");
  assert.equal(harness.attributes.get("aria-disabled"), "true");
  assert.deepEqual(calls, [
    "https://aspice-auditflow.cloud/jiraflow/health",
    "https://aspice-auditflow.cloud/api/health",
    "https://aspice-auditflow.cloud/jiraflow/health",
    "https://aspice-auditflow.cloud/health"
  ]);
});

test("hosted JiraFlow ignores stale loopback backend URLs from localStorage", async () => {
  const calls = [];
  const harness = createHarness({
    locationHref: "https://aspice-auditflow.cloud/index.html",
    storedWorkspace: {
      settings: {
        backendUrl: "http://127.0.0.1:4173",
        codexBridgeUrl: "http://localhost:4176"
      }
    },
    fetchHealth: async url => {
      calls.push(url);
      throw new Error(`unavailable: ${url}`);
    }
  });
  await harness.settle();

  assert.equal(harness.link.dataset.jiraFlowStatus, "unavailable");
  assert.doesNotMatch(calls.join("\n"), /http:\/\/(?:127\.0\.0\.1|localhost)/);
  assert.deepEqual(calls, [
    "https://aspice-auditflow.cloud/jiraflow/health",
    "https://aspice-auditflow.cloud/api/health",
    "https://aspice-auditflow.cloud/health"
  ]);
});

test("health responses from another product or unsupported version stay disabled", async () => {
  const harness = createHarness({
    fetchHealth: async () => ({
      ok: true,
      async json() { return { status: "ok", service: "JEAuditFlow", version: "6.5.0" }; }
    })
  });
  await harness.settle();

  assert.equal(harness.link.dataset.jiraFlowStatus, "unavailable");
  assert.equal(harness.attributes.get("aria-disabled"), "true");
  assert.equal(harness.link.dataset.jiraFlowHref, "");
});

test("unavailable JiraFlow is rediscovered after the initial backoff", async () => {
  let available = false;
  const harness = createHarness({
    fetchHealth: async url => {
      if (!available || url !== "http://127.0.0.1:4188/health") throw new Error("not ready");
      return {
        ok: true,
        async json() { return { status: "ok", service: "JiraFlow", version: "2.1.0" }; }
      };
    }
  });
  await harness.settle();
  assert.equal(harness.attributes.get("aria-disabled"), "true");
  available = true;
  assert.equal(harness.runTimerWithDelay(1500), true);
  await harness.settle();

  assert.equal(harness.attributes.get("aria-disabled"), "false");
  assert.equal(harness.link.href, "http://127.0.0.1:4188/");
});

test("embedded entry requests desktop context and sends the verified service command to the host", async () => {
  const harness = createHarness({ embedded: true });
  assert.ok(harness.parentMessages.some(item => item.message.command === "request-context"));

  const receiveMessage = harness.listeners.get("window:message");
  receiveMessage({
    source: harness.parent,
    origin: "https://attacker.example",
    data: {
      type: "auditflow-desktop-context",
      services: {
        jiraFlowAvailable: true,
        jiraFlowHealthy: true,
        jiraFlowStatus: "healthy",
        jiraFlowBaseUri: "http://127.0.0.1:4188/",
        jiraFlowPort: 4188,
        jiraFlowVersion: "2.1.0"
      }
    }
  });
  assert.equal(harness.attributes.get("aria-disabled"), "true");

  receiveMessage({
    source: harness.parent,
    origin: "http://127.0.0.1:4173",
    data: {
      type: "auditflow-desktop-context",
      services: {
        jiraFlowAvailable: true,
        jiraFlowHealthy: true,
        jiraFlowStatus: "healthy",
        jiraFlowBaseUri: "http://127.0.0.1:4188/",
        jiraFlowPort: 4188,
        jiraFlowVersion: "2.1.0"
      }
    }
  });
  assert.equal(harness.attributes.get("aria-disabled"), "false");

  let prevented = false;
  harness.listeners.get("link:click")({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(harness.link.href, "http://127.0.0.1:4188/");
  assert.equal(harness.link.getAttribute("aria-disabled"), "false");
  assert.equal(
    harness.parentMessages.some(item => item.message.command === "open-jiraflow"),
    true
  );
});

test("embedded bridge URLs cannot target a non-loopback host", async () => {
  const harness = createHarness({ embedded: true });
  harness.listeners.get("window:message")({
    source: harness.parent,
    origin: "http://127.0.0.1:4173",
    data: {
      type: "auditflow-desktop-context",
      services: {
        jiraFlowAvailable: true,
        jiraFlowHealthy: true,
        jiraFlowStatus: "healthy",
        jiraFlowBaseUri: "http://192.168.1.10:4188/",
        jiraFlowPort: 4188
      }
    }
  });
  await harness.settle();
  assert.equal(harness.link.dataset.jiraFlowStatus, "unavailable");
  assert.equal(harness.attributes.get("aria-disabled"), "true");
});
