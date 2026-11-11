import assert from "node:assert/strict";
import test from "node:test";
import { createAiHarnessLedger } from "../ai-harness.mjs";

test("ledger publishes an enumerated stage and IO graph without content fields", () => {
  let time = Date.parse("2026-10-27T00:00:00.000Z");
  const ledger = createAiHarnessLedger({
    idFactory: () => "RUN-001",
    now: () => time++
  });
  const run = ledger.start({
    ownerId: "assessor-1",
    operation: "indicator-review",
    provider: "deepseek",
    inputs: [{ id: "DOC-1", type: "document", label: "private filename.pdf" }]
  });

  ledger.stage(run.id, {
    id: "evidence-filter",
    status: "complete",
    inputs: [{ id: "DOC-1", type: "document" }],
    outputs: [{ id: "EV-1", type: "evidence-set" }],
    metrics: { inputCount: 8, outputCount: 3, durationMs: 125 }
  });
  ledger.stage(run.id, {
    id: "candidate-review",
    status: "running",
    inputs: [{ id: "EV-1", type: "evidence-set" }],
    outputs: [{ id: "CAND-1", type: "assessment-candidate" }],
    summary: "private summary",
    prompt: "customer prompt",
    output: "private model response",
    reasoning: "private chain-of-thought"
  });
  const completed = ledger.complete(run.id, {
    outputs: [{ id: "REPORT-1", type: "report" }],
    metrics: { outputCount: 1 }
  });

  assert.equal(completed.status, "complete");
  assert.deepEqual(completed.graph.edges.map(edge => [edge.from, edge.to]), [
    ["request-accepted", "evidence-filter"],
    ["evidence-filter", "candidate-review"],
    ["candidate-review", "completed"]
  ]);
  assert.deepEqual(completed.graph.nodes[1].outputs[0], {
    id: "EV-1",
    type: "evidence-set",
    label: "Eligible evidence set"
  });
  assert.deepEqual(completed.events[1].metrics, {
    inputCount: 8,
    outputCount: 3,
    durationMs: 125
  });
  const serialized = JSON.stringify(completed);
  for (const value of [
    "private filename.pdf",
    "private summary",
    "customer prompt",
    "private model response",
    "private chain-of-thought",
    '"reasoning"',
    '"prompt"'
  ]) {
    assert.equal(serialized.includes(value), false);
  }
  assert.equal(ledger.get(run.id, "other-user"), null);
});

test("unknown operations, providers, stages, statuses and artifact types fail closed", () => {
  const ledger = createAiHarnessLedger({ idFactory: () => "RUN-002" });
  assert.throws(() => ledger.start({
    ownerId: "assessor",
    operation: "a free-form summary"
  }), /Unsupported harness operation/);
  assert.throws(() => ledger.start({
    ownerId: "assessor",
    provider: "provider with customer content"
  }), /Unsupported harness provider/);

  const run = ledger.start({ ownerId: "assessor" });
  assert.throws(() => ledger.stage(run.id, { id: "free-form stage" }), /Unsupported harness stage id/);
  assert.throws(() => ledger.stage(run.id, { id: "constructor" }), /Unsupported harness stage id/);
  assert.throws(() => ledger.stage(run.id, { id: "input-scan", status: "anything" }), /Unsupported harness stage status/);
  assert.throws(() => ledger.stage(run.id, {
    id: "input-scan",
    outputs: [{ id: "OUT-1", type: "customer-sensitive-payload" }]
  }), /Unsupported harness artifact type/);
  assert.throws(() => ledger.stage(run.id, {
    id: "input-scan",
    outputs: [{ id: "OUT-1", type: "constructor" }]
  }), /Unsupported harness artifact type/);
  assert.throws(() => ledger.stage(run.id, {
    id: "input-scan",
    outputs: [{ id: "../customer/file.pdf", type: "document" }]
  }), /Invalid harness artifact id/);
});

test("failure stores only a safe diagnostic code and ends the run", () => {
  const ledger = createAiHarnessLedger({ idFactory: () => "RUN-003" });
  const run = ledger.start({ ownerId: "assessor" });
  const failed = ledger.fail(run.id, "provider-unavailable: customer text");
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorCode, "unexpected");
  assert.equal(JSON.stringify(failed).includes("customer text"), false);
  assert.equal(ledger.stage(run.id, { id: "candidate-review" }), null);
});

test("subscribers receive isolated snapshots and owner-scoped access", () => {
  const ledger = createAiHarnessLedger({ idFactory: () => "RUN-004" });
  const run = ledger.start({ ownerId: "assessor" });
  const snapshots = [];
  const unsubscribe = ledger.subscribe(run.id, "assessor", snapshot => {
    snapshots.push(snapshot);
    snapshot.events[0].label = "mutated observer copy";
  });
  ledger.stage(run.id, { id: "input-scan", status: "complete" });
  unsubscribe();
  ledger.complete(run.id);

  assert.equal(snapshots.length, 1);
  assert.equal(ledger.get(run.id, "assessor").events[0].label, "Request accepted");
});

test("expired runs are pruned", () => {
  let time = 1_000;
  const ledger = createAiHarnessLedger({
    idFactory: () => "RUN-005",
    ttlMs: 10,
    now: () => time
  });
  const run = ledger.start({ ownerId: "assessor" });
  time = 2_000;
  assert.equal(ledger.get(run.id, "assessor"), null);
});
