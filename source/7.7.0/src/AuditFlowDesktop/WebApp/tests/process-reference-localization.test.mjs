import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../process-canvases.js", import.meta.url), "utf8");

function loadReference() {
  const sandbox = {
    window: {
      AuditFlowProcessModel: {
        "SYS.2": {
          id: "SYS.2",
          name: "System Requirements Analysis",
          purpose: "Establish system requirements.",
          outcomes: ["System requirements are specified."],
          practices: [{ code: "BP1", title: "Specify system requirements", description: "Specify." }]
        }
      }
    },
    document: { addEventListener() {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "process-canvases.js" });
  assert.equal(typeof sandbox.window.AuditFlowReference.renderProcessReference, "function", "locale-aware process reference renderer is required");
  return sandbox.window.AuditFlowReference;
}

test("Process Reference renders Chinese labels and clickable BP text", () => {
  const reference = loadReference();
  const html = reference.renderProcessReference({ id: "P-1", processes: ["SYS.2"] }, "SYS.2", { language: "zh-CN" });
  assert.match(html, /过程参考/);
  assert.match(html, /汽车 SPICE 4\.0/);
  assert.match(html, /结果/);
  assert.match(html, /系统需求规格/);
  assert.match(html, /data-canvas-node/);
  assert.match(html, /data-reference-review/);
});

test("Process Reference keeps English labels in English mode", () => {
  const reference = loadReference();
  const html = reference.renderProcessReference({ id: "P-1", processes: ["SYS.2"] }, "SYS.2", { language: "en" });
  assert.match(html, /Process reference/);
  assert.match(html, /Automotive SPICE 4\.0/);
  assert.match(html, /Outcomes/);
  assert.match(html, /System requirements specification/);
});

test("locale adapter preserves source graph and node/edge interaction identifiers", () => {
  const reference = loadReference();
  const before = JSON.stringify(reference.graphs);
  const chinese = reference.canvas("SYS.2", "P-1", "SYS.2", "", false, { language: "zh-CN" });
  const english = reference.canvas("SYS.2", "P-1", "SYS.2", "", false, { language: "en" });
  assert.match(chinese, /title="定义系统需求"/);
  assert.match(chinese, /双向可追溯性/);
  assert.match(chinese, /aria-label="缩小"/);
  const attributes = html => Array.from(html.matchAll(/data-canvas-(?:node|edge)="[^"]+"/g), match => match[0]);
  assert.deepEqual(attributes(chinese), attributes(english));
  assert.equal(JSON.stringify(reference.graphs), before);
});

test("all graph artifact and edge display labels have Chinese mappings", () => {
  const reference = loadReference();
  for (const graph of Object.values(reference.graphs)) {
    for (const edge of graph.edges) assert.notEqual(reference.label(edge.label, { language: "zh-CN" }), edge.label, `${graph.id}: ${edge.label}`);
    for (const node of graph.nodes.filter(item => !["gp", "bp"].includes(item.kind))) assert.notEqual(reference.displayNode(graph.id, node, { language: "zh-CN" }).title, node.title, `${graph.id}: ${node.title}`);
  }
});

test("full model retains outcome counts and English source after Chinese rendering", async () => {
  const modelSource = await readFile(new URL("../aspice-v40-model.js", import.meta.url), "utf8");
  const sandbox = { window: {}, document: { documentElement: { lang: "zh-CN" }, addEventListener() {} } };
  vm.createContext(sandbox);
  vm.runInContext(modelSource, sandbox);
  const before = JSON.stringify(sandbox.window.AuditFlowProcessModel);
  vm.runInContext(source, sandbox);
  for (const [id, original] of Object.entries(sandbox.window.AuditFlowProcessModel)) {
    const translated = sandbox.window.AuditFlowReference.describe(id, { language: "zh-CN" });
    assert.match(translated.name, /[\u3400-\u9fff]/, id);
    assert.equal(translated.outcomes.length, original.outcomes.length, id);
    assert.deepEqual(Array.from(translated.practices, item => item.code), Array.from(original.practices, item => item.code), id);
    for (const practice of translated.practices) assert.match(practice.title, /[\u3400-\u9fff]/, `${id} ${practice.code}`);
  }
  assert.equal(JSON.stringify(sandbox.window.AuditFlowProcessModel), before);
});
