import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { createHarnessRunLedger } from "../harness-run-ledger.mjs";

test("harness ledger emits an auditable stage and artifact graph without content", () => {
  const ledger = createHarnessRunLedger({
    idFactory: () => "run-001",
    now: (() => { let time = Date.parse("2026-10-27T00:00:00.000Z"); return () => time++; })()
  });
  const run = ledger.start({
    ownerId: "assessor-1",
    operation: "indicator-review",
    provider: "deepseek",
    model: "deepseek-flash",
    inputs: [{ id: "DOC-1", type: "document", label: "Selected evidence package" }]
  });
  ledger.stage(run.id, {
    id: "evidence-filter",
    status: "running",
    summary: "Ignore this arbitrary summary and never expose it.",
    inputs: [{ id: "DOC-1", type: "document", label: "Selected evidence package" }],
    outputs: [{ id: "FILTERED-1", type: "evidence-set", label: "Ignore arbitrary labels too." }],
    metrics: { inputCount: 8 }
  });
  ledger.stage(run.id, {
    id: "model-review",
    status: "running",
    summary: "Assess the selected candidate indicators."
  });
  const completed = ledger.complete(run.id, {
    outputs: [{ id: "OUT-1", type: "candidate-review", label: "AI candidate response" }],
    metrics: { outputCount: 3 }
  });

  assert.equal(completed.status, "complete");
  assert.deepEqual(completed.graph.edges.map(edge => [edge.from, edge.to]), [
    ["request-accepted", "evidence-filter"],
    ["evidence-filter", "model-review"],
    ["model-review", "completed"]
  ]);
  assert.equal(completed.graph.nodes[1].outputs[0].id, "FILTERED-1");
  assert.equal(completed.graph.nodes[1].outputs[0].label, "Eligible evidence set");
  assert.equal(JSON.stringify(completed).includes("Ignore this arbitrary summary"), false);
  assert.equal(JSON.stringify(completed).includes("Ignore arbitrary labels"), false);
  assert.equal(completed.events.find(event => event.stage === "evidence-filter").metrics.inputCount, 8);
  assert.equal(ledger.get(run.id, "other-user"), null);
});

test("ledger ignores prompts, evidence text, provider output, and private reasoning fields", () => {
  const ledger = createHarnessRunLedger({ idFactory: () => "run-secret" });
  const run = ledger.start({ ownerId: "assessor", operation: "review" });
  ledger.stage(run.id, {
    id: "model-review",
    summary: "private chain-of-thought",
    prompt: "customer requirement secret",
    evidenceText: "sensitive evidence",
    output: "provider answer",
    reasoning: "private chain-of-thought",
    chainOfThought: "private chain-of-thought",
    inputs: [{ id: "DOC-7", label: "private chain-of-thought" }]
  });
  ledger.complete(run.id, {
    outputs: [{ id: "OUT-7", type: "response", label: "Candidate response" }],
    prompt: "secret prompt",
    output: "private chain-of-thought"
  });
  const serialized = JSON.stringify(ledger.get(run.id, "assessor"));
  for (const secret of ["customer requirement secret", "sensitive evidence", "provider answer", "private chain-of-thought", "secret prompt"]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(serialized.includes('"reasoning"'), false);
  assert.equal(serialized.includes('"prompt"'), false);
});

test("run failures expose a bounded diagnostic code, not raw provider errors", () => {
  const ledger = createHarnessRunLedger({ idFactory: () => "run-failed" });
  const run = ledger.start({ ownerId: "assessor", operation: "review" });
  const failed = ledger.fail(run.id, "provider-unavailable: customer text and secret");
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorCode, "unexpected");
  assert.equal(JSON.stringify(failed).includes("customer text"), false);
});

test("subscribers receive immutable public snapshots and can unsubscribe", () => {
  const ledger = createHarnessRunLedger({ idFactory: () => "run-subscribed" });
  const run = ledger.start({ ownerId: "assessor", operation: "review" });
  const received = [];
  const unsubscribe = ledger.subscribe(run.id, "assessor", snapshot => received.push(snapshot.status));
  ledger.stage(run.id, { id: "scan", status: "complete", summary: "Scan complete." });
  unsubscribe();
  ledger.complete(run.id);
  assert.deepEqual(received, ["running"]);
});

test("metadata-only harness history survives a ledger restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "auditflow-harness-ledger-"));
  const storagePath = path.join(root, "runs.json");
  const first = createHarnessRunLedger({
    storagePath,
    idFactory: () => "run-persisted",
    now: () => Date.parse("2026-10-27T00:00:00.000Z")
  });
  const run = first.start({
    ownerId: "assessor",
    projectId: "ASP-LOCAL-DEFAULT",
    processCodes: ["SYS.2"],
    assessmentRefs: ["SYS.2.BP1"],
    evidenceRefs: [{ id: "EV-1", code: "SYS2-REQ", locator: "SRS.docx p.4", role: "direct" }],
    inputs: [{ id: "CTX-1", type: "review-context" }]
  });
  first.stage(run.id, {
    id: "evidence-filter",
    status: "complete",
    inputs: [{ id: "CTX-1", type: "review-context" }],
    outputs: [{ id: "EV-1", type: "evidence-set" }]
  });
  first.complete(run.id, { outputs: [{ id: "OUT-1", type: "assessment-candidate" }] });

  const stored = JSON.parse(await readFile(storagePath, "utf8"));
  assert.equal(stored.runs.length, 1);
  assert.equal(JSON.stringify(stored).includes("customer evidence text"), false);

  const second = createHarnessRunLedger({ storagePath, now: () => Date.parse("2026-10-27T00:01:00.000Z") });
  const restored = second.get("run-persisted", "assessor");
  assert.equal(restored.status, "complete");
  assert.equal(restored.projectId, "ASP-LOCAL-DEFAULT");
  assert.deepEqual(restored.processCodes, ["SYS.2"]);
  assert.deepEqual(restored.assessmentRefs, ["SYS.2.BP1"]);
  assert.deepEqual(restored.evidenceRefs, [{ id: "EV-1", code: "SYS2-REQ", locator: "SRS.docx p.4", role: "direct" }]);
});
