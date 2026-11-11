import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "ai-harness-ui.js"), "utf8");

function api(lang = "en") {
  const context = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    URL,
    document: {
      documentElement: { lang },
      readyState: "complete",
      querySelector: () => null
    }
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "ai-harness-ui.js" });
  return context.AuditFlowAiHarnessUI;
}

test("UI normalizes payloads to visible stage and IO metadata only", () => {
  const harness = api();
  const runs = harness.normalizePayload({
    data: {
      runs: [{
        id: "RUN-1",
        status: "running",
        provider: "deepseek",
        model: "private-model",
        prompt: "secret prompt",
        graph: {
          nodes: [{
            id: "evidence-filter",
            status: "complete",
            inputs: [{ id: "DOC-1", type: "document", text: "secret evidence" }],
            outputs: [{ id: "EV-1", type: "evidence-set" }]
          }],
          edges: [{ from: "evidence-filter", to: "candidate-review", outputs: [{ id: "EV-1", type: "evidence-set" }] }]
        },
        events: [{
          stage: "evidence-filter",
          status: "complete",
          sequence: 2,
          metrics: { inputCount: 8, outputCount: 3, durationMs: 120 },
          reasoning: "private chain of thought"
        }]
      }]
    }
  });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].nodes[0].label, "ASPICE evidence filter");
  assert.equal(runs[0].nodes[0].inputs[0].label, "Selected source document");
  assert.equal(JSON.stringify(runs[0].events[0].metrics), JSON.stringify({ inputCount: 8, outputCount: 3, durationMs: 120 }));
  const serialized = JSON.stringify(runs);
  assert.equal(runs[0].provider, "deepseek");
  assert.equal(runs[0].model, "private-model");
  for (const value of ["secret prompt", "secret evidence", "private chain of thought", '"reasoning"']) {
    assert.equal(serialized.includes(value), false);
  }
});

test("UI drops invalid stages, artifacts, edges, and IDs", () => {
  const harness = api();
  const normalized = harness.normalizeRun({
    id: "../secret",
    status: "running",
    events: [{ stage: "constructor" }],
    graph: { nodes: [{ id: "constructor" }], edges: [{ from: "constructor", to: "failed" }] }
  });
  assert.equal(normalized, null);
  const valid = harness.normalizeRun({
    id: "RUN-2",
    status: "unknown-state",
    graph: {
      nodes: [{
        id: "input-scan",
        status: "unknown-state",
        inputs: [{ id: "DOC-2", type: "constructor" }],
        outputs: [{ id: "OUT-2", type: "document" }]
      }],
      edges: [{ from: "input-scan", to: "constructor" }]
    },
    events: [{ stage: "input-scan", status: "unknown-state" }]
  });
  assert.equal(valid.status, "unknown");
  assert.equal(valid.nodes[0].inputs.length, 0);
  assert.equal(valid.nodes[0].outputs[0].id, "OUT-2");
  assert.equal(valid.edges.length, 0);
});

test("mount renders unavailable state when endpoint cannot be reached", async () => {
  const harness = api();
  const listeners = {};
  const mount = {
    innerHTML: "",
    querySelectorAll() { return []; },
    addEventListener(type, listener) { listeners[type] = listener; }
  };
  const instance = harness.mount({
    mount,
    intervalMs: 100000,
    fetchImpl: async () => { throw new Error("raw provider secret"); },
    now: () => "2026-10-27T00:00:00.000Z"
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(mount.innerHTML, /Harness endpoint unavailable/);
  assert.doesNotMatch(mount.innerHTML, /raw provider secret/);
  instance.stop();
});

test("mount polls the same-origin endpoint and renders normalized run data", async () => {
  const harness = api();
  const calls = [];
  const mount = {
    innerHTML: "",
    querySelectorAll() { return []; }
  };
  const instance = harness.mount({
    mount,
    intervalMs: 100000,
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      return {
        ok: true,
        json: async () => ({
          runs: [{
            id: "RUN-LIVE",
            status: "running",
            updatedAt: "2026-10-27T00:00:00.000Z",
            events: [{
              stage: "candidate-review",
              status: "running",
              sequence: 2,
              inputs: [{ id: "EV-2", type: "evidence-set" }],
              outputs: [{ id: "CAND-2", type: "assessment-candidate" }],
              metrics: { inputCount: 1, outputCount: 1 }
            }],
            graph: { nodes: [], edges: [] }
          }]
        })
      };
    },
    now: () => "2026-10-27T00:00:01.000Z"
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(calls[0][0], "/api/ai/harness/runs");
  assert.equal(calls[0][1].credentials, "same-origin");
  assert.match(mount.innerHTML, /RUN-LIVE/);
  assert.match(mount.innerHTML, /AI candidate review/);
  assert.match(mount.innerHTML, /EV-2/);
  assert.match(mount.innerHTML, /CAND-2/);
  assert.doesNotMatch(mount.innerHTML, /prompt|reasoning|model output/i);
  instance.stop();
});

test("history renders project, process, indicator and evidence locators without model reasoning", () => {
  const harness = api("zh-CN");
  const mount = { innerHTML: "", querySelectorAll: () => [] };
  harness.render(mount, {
    runs: [harness.normalizeRun({
      id: "RUN-AUDIT-1",
      status: "complete",
      projectId: "ASP-LOCAL-DEFAULT",
      processCodes: ["SYS.2"],
      assessmentRefs: ["SYS.2.BP1"],
      evidenceRefs: [{
        id: "EV-1",
        code: "SYS2-REQ-001",
        locator: "SRS.docx · Section 4.2",
        role: "direct",
        process: "SYS.2",
        indicator: "SYS.2.BP1"
      }],
      events: [{
        stage: "evidence-map",
        status: "complete",
        sequence: 4,
        at: "2026-10-27T00:00:04.000Z",
        metrics: {},
        inputs: [{ id: "EV-1", type: "evidence-set" }],
        outputs: [{ id: "SYS.2.BP1", type: "indicator-set" }]
      }],
      nodes: [],
      edges: []
    })],
    selectedId: "RUN-AUDIT-1",
    availability: "ready",
    availabilityLabel: "实时",
    emptyLabel: "",
    lastUpdated: "",
    polling: false
  });

  for (const value of ["ASP-LOCAL-DEFAULT", "SYS.2", "SYS.2.BP1", "SYS2-REQ-001", "SRS.docx · Section 4.2", "direct"]) {
    assert.match(mount.innerHTML, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(mount.innerHTML, /chain.of.thought|model output/i);
});

test("mount rejects cross-origin endpoints and Chinese mode labels stages", () => {
  const harness = api("zh-CN");
  const mount = { innerHTML: "", querySelectorAll: () => [] };
  assert.throws(() => harness.mount({
    mount,
    endpoint: "https://example.invalid/api/ai/harness/runs",
    fetchImpl: async () => ({ ok: true, json: async () => ({ runs: [] }) })
  }), /same-origin/);

  harness.render(mount, {
    runs: [{
      id: "RUN-ZH",
      status: "complete",
      events: [],
      nodes: [{
        id: "evidence-filter",
        label: "ASPICE 证据筛选",
        status: "complete",
        inputs: [{ id: "DOC-1", type: "document", label: "已选源文档" }],
        outputs: []
      }],
      edges: []
    }],
    selectedId: "RUN-ZH",
    availability: "ready",
    availabilityLabel: "实时",
    emptyLabel: "",
    lastUpdated: "",
    polling: false
  });
  assert.match(mount.innerHTML, /AI Harness 运行监控/);
  assert.match(mount.innerHTML, /IO 关系图/);
  assert.match(mount.innerHTML, /已完成/);
});
