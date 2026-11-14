import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { createHarnessRunLedger } from "../harness-run-ledger.mjs";
import { assessSelectedIndicators } from "../engine.mjs";

test("persisted candidate summaries retain provider and known citations without customer text", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harness-evidence-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storagePath = path.join(directory, "runs.json");
  const ledger = createHarnessRunLedger({ storagePath, idFactory: () => "RUN-76" });
  const run = ledger.start({
    ownerId: "assessor", projectId: "P-76", provider: "deepseek", model: "deepseek-flash",
    processCodes: ["SYS.2"], assessmentRefs: ["SYS.2.BP1"],
    evidenceRefs: [{ id: "EV-1", code: "REQ-1", locator: "SRS §4", role: "direct", process: "SYS.2" }]
  });
  ledger.complete(run.id, {
    transport: "provider", modelStatus: "complete", candidateOnly: true,
    candidates: [{
      process: "SYS.2", code: "BP1", rating: "P", reason: "PRIVATE CUSTOMER TEXT",
      findings: [{ type: "W", text: "PRIVATE CUSTOMER TEXT" }],
      evidenceAnalysis: [{ evidenceCode: "REQ-1" }, { evidenceCode: "INVENTED" }]
    }],
    prompt: "SECRET PROMPT", apiKey: "SECRET API KEY"
  });
  const restored = createHarnessRunLedger({ storagePath }).get(run.id, "assessor");
  assert.equal(restored.provider, "deepseek");
  assert.equal(restored.model, "deepseek-flash");
  assert.equal(restored.transport, "provider");
  assert.equal(restored.modelStatus, "complete");
  assert.equal(restored.candidateOnly, true);
  assert.deepEqual(restored.candidateSummaries, [{
    process: "SYS.2", indicator: "SYS.2.BP1", rating: "P",
    findingTypes: ["W"], evidenceCodes: ["REQ-1"], candidateOnly: true
  }]);
  assert.doesNotMatch(await readFile(storagePath, "utf8"), /PRIVATE CUSTOMER|SECRET|INVENTED/);
});

test("missing DeepSeek credentials produces no model candidate or rating", async () => {
  const result = await assessSelectedIndicators({
    id: "P", processes: ["SYS.2"], evidence: [], records: [],
    assessments: [{ id: "A1", process: "SYS.2", kind: "BP", code: "BP1", rating: "L", reviewed: false }]
  }, { provider: "deepseek", enabled: false, model: "deepseek-flash", protocol: "chat-completions" }, { selectedProcesses: ["SYS.2"] });
  assert.equal(result.modelUnavailable, true);
  assert.equal(result.assessmentGenerated, false);
  assert.equal(result.modelStatus, "skipped");
  assert.equal(result.transport, "unavailable");
  assert.deepEqual(result.assessments, []);
  assert.equal(result.llm.used, false);
});

test("history groups process domains and links evidence without displaying arbitrary model text", () => {
  const context = vm.createContext({ URL, document: undefined });
  vm.runInContext(readFileSync(new URL("../ai-harness-ui.js", import.meta.url), "utf8"), context);
  const api = context.AuditFlowAiHarnessUI;
  const mount = { innerHTML: "", querySelectorAll: () => [] };
  api.render(mount, {
    availability: "ready", availabilityLabel: "Live", polling: false,
    runs: [api.normalizeRun({
      id: "R", projectId: "P", status: "complete", provider: "deepseek", model: "deepseek-flash",
      transport: "provider", candidateOnly: true, modelStatus: "complete", processCodes: ["SYS.2"],
      evidenceRefs: [{ id: "EV-1", code: "REQ-1", locator: "SRS §4", role: "direct", process: "SYS.2" }],
      candidateSummaries: [{ process: "SYS.2", indicator: "SYS.2.BP1", rating: "P", findingTypes: ["W"], evidenceCodes: ["REQ-1"] }],
      prompt: "PRIVATE PROMPT", graph: { nodes: [], edges: [] }, events: []
    })]
  });
  assert.match(mount.innerHTML, /data-process-domain="SYS.2"/);
  assert.match(mount.innerHTML, /data-ai-harness-evidence="EV-1"/);
  assert.match(mount.innerHTML, /SYS.2.BP1/);
  assert.match(mount.innerHTML, /deepseek-flash/);
  assert.doesNotMatch(mount.innerHTML, /PRIVATE PROMPT/);
});
