import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_RUNS = 1000;
const STORAGE_SCHEMA_VERSION = 1;
const ALLOWED_ERROR_CODES = new Set([
  "cancelled",
  "invalid-output",
  "provider-unavailable",
  "request-timeout",
  "unexpected"
]);
const STAGE_LABELS = Object.freeze({
  "request-accepted": "Request accepted",
  scan: "Input scan",
  "input-prepared": "Review input prepared",
  "evidence-filter": "ASPICE evidence filter",
  "parse-document": "Document parsing",
  "ocr-image": "Local image OCR",
  "extract-tables": "Table extraction",
  "map-evidence": "Evidence mapping",
  "model-review": "AI candidate review",
  "build-report": "Report assembly",
  "human-review": "Assessor review gate",
  completed: "Run completed",
  failed: "Run failed"
});
const ARTIFACT_LABELS = Object.freeze({
  document: "Selected source document",
  image: "Selected source image",
  "review-context": "Review context",
  "evidence-set": "Eligible evidence set",
  "ocr-result": "OCR extraction result",
  "table-set": "Extracted tables",
  "indicator-set": "Candidate indicators",
  "model-response": "AI candidate response",
  "assessment-candidate": "Assessment candidate",
  report: "Report draft",
  artifact: "Artifact"
});

function boundedText(value, maxLength = 120) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}

function boundedCode(value, maxLength) {
  return boundedText(value, maxLength).replace(/[^a-z0-9._:-]/gi, "");
}

function normalizeCodes(value, maxItems = 80) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, maxItems)
    .map(item => boundedCode(item, 96))
    .filter(item => /^[A-Z0-9][A-Z0-9._:-]*$/i.test(item)))];
}

function normalizeEvidenceRefs(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const id = boundedCode(item.id, 120);
    const code = boundedCode(item.code, 96);
    if (!id || !code) return [];
    const role = ["direct", "corroborating", "index-only"].includes(item.role) ? item.role : "";
    return [{
      id,
      code,
      locator: boundedText(item.locator, 180),
      role,
      ...(boundedCode(item.process, 48) ? { process: boundedCode(item.process, 48) } : {}),
      ...(boundedCode(item.indicator, 96) ? { indicator: boundedCode(item.indicator, 96) } : {})
    }];
  });
}

function normalizeArtifacts(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const id = boundedCode(item.id, 120);
    if (!id) return [];
    const type = boundedCode(item.type || "artifact", 48) || "artifact";
    return [{
      id,
      type,
      label: ARTIFACT_LABELS[type] || "Artifact"
    }];
  });
}

function normalizeCandidateSummaries(value, run) {
  const processes = new Set(run.processCodes);
  const indicators = new Set(run.assessmentRefs);
  const evidence = new Set(run.evidenceRefs.map(item => item.code));
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const process = boundedCode(item.process, 48);
    const code = boundedCode(item.indicator || item.code, 96);
    const indicator = code.startsWith(`${process}.`) ? code : `${process}.${code}`;
    const rating = item.aiCandidateRating || item.rating;
    if (!processes.has(process) || !indicators.has(indicator) || !["N", "P-", "P", "P+", "L-", "L", "L+", "F"].includes(rating)) return [];
    const findingTypes = normalizeCodes(item.findingTypes || (Array.isArray(item.findings) ? item.findings.map(finding => finding?.type) : []), 8)
      .filter(type => ["O", "S", "W", "R", "NC", "OFI", "RC"].includes(type));
    const evidenceCodes = normalizeCodes(item.evidenceCodes || (Array.isArray(item.evidenceAnalysis) ? item.evidenceAnalysis.map(ref => ref?.evidenceCode) : []), 40)
      .filter(code => evidence.has(code));
    return [{ process, indicator, rating, findingTypes, evidenceCodes, candidateOnly: true }];
  });
}

function resultMetadata(value = {}) {
  return {
    transport: ["provider", "local-codex-cli", "codex-cli", "copilot-studio-direct-line", "local-ocr", "unavailable"].includes(value.transport) ? value.transport : "",
    modelStatus: ["running", "complete", "skipped", "failed"].includes(value.modelStatus) ? value.modelStatus : "running",
    candidateOnly: value.candidateOnly === true,
    assessmentGenerated: value.assessmentGenerated === true
  };
}

function normalizeStoredEvent(item) {
  if (!item || !STAGE_LABELS[item.stage]) return null;
  const metrics = {};
  for (const key of ["inputCount", "outputCount", "durationMs"]) {
    if (Number.isFinite(Number(item.metrics?.[key])) && Number(item.metrics[key]) >= 0) metrics[key] = Math.min(Math.floor(Number(item.metrics[key])), 1_000_000_000);
  }
  return { sequence: Math.max(0, Math.floor(Number(item.sequence) || 0)), stage: item.stage, status: ["running", "complete", "skipped", "failed"].includes(item.status) ? item.status : "failed", at: boundedText(item.at, 40), summary: STAGE_LABELS[item.stage], inputs: normalizeArtifacts(item.inputs), outputs: normalizeArtifacts(item.outputs), metrics };
}

function publicRun(run) {
  return {
    id: run.id,
    operation: run.operation,
    provider: run.provider,
    model: run.model,
    ...resultMetadata(run),
    candidateSummaries: structuredClone(run.candidateSummaries || []),
    projectId: run.projectId,
    processCodes: [...run.processCodes],
    assessmentRefs: [...run.assessmentRefs],
    evidenceRefs: structuredClone(run.evidenceRefs),
    status: run.status,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt,
    graph: {
      nodes: structuredClone(run.nodes),
      edges: structuredClone(run.edges)
    },
    events: structuredClone(run.events),
    ...(run.errorCode ? { errorCode: run.errorCode } : {})
  };
}

/**
 * Metadata-only ledger for user-visible, auditable work stages.
 * The active map is paired with an optional private local JSON snapshot. It
 * deliberately does not accept or retain prompts, evidence text, model
 * output, credentials, or private chain-of-thought.
 */
export function createHarnessRunLedger({
  ttlMs = DEFAULT_TTL_MS,
  maxRuns = DEFAULT_MAX_RUNS,
  now = () => Date.now(),
  idFactory = () => crypto.randomUUID(),
  storagePath = ""
} = {}) {
  const runs = new Map();
  const listeners = new Map();
  const persistencePath = storagePath ? path.resolve(String(storagePath)) : "";

  function persist() {
    if (!persistencePath) return;
    fs.mkdirSync(path.dirname(persistencePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${persistencePath}.${process.pid}.tmp`;
    const payload = JSON.stringify({
      schemaVersion: STORAGE_SCHEMA_VERSION,
      runs: [...runs.values()]
    });
    fs.writeFileSync(temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporaryPath, persistencePath);
    fs.chmodSync(persistencePath, 0o600);
  }

  function restore() {
    if (!persistencePath || !fs.existsSync(persistencePath)) return;
    const stored = JSON.parse(fs.readFileSync(persistencePath, "utf8"));
    if (stored?.schemaVersion !== STORAGE_SCHEMA_VERSION || !Array.isArray(stored.runs)) return;
    for (const item of stored.runs.slice(-Math.max(1, Number(maxRuns) || DEFAULT_MAX_RUNS))) {
      if (!item || typeof item !== "object" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(String(item.id || ""))) continue;
      if (!String(item.ownerId || "").trim() || !Array.isArray(item.events) || !Array.isArray(item.nodes) || !Array.isArray(item.edges)) continue;
      const restored = {
        id: String(item.id),
        ownerId: boundedText(item.ownerId, 120),
        operation: boundedCode(item.operation || "review", 48) || "review",
        provider: boundedCode(item.provider, 48),
        model: boundedCode(item.model, 120),
        projectId: boundedCode(item.projectId, 191),
        processCodes: normalizeCodes(item.processCodes, 32),
        assessmentRefs: normalizeCodes(item.assessmentRefs, 100),
        evidenceRefs: normalizeEvidenceRefs(item.evidenceRefs),
        status: ["running", "complete", "failed"].includes(item.status) ? item.status : "failed",
        startedAt: boundedText(item.startedAt, 40),
        updatedAt: boundedText(item.updatedAt, 40),
        updatedAtMs: Number(item.updatedAtMs) || Date.parse(item.updatedAt) || now(),
        completedAt: boundedText(item.completedAt, 40),
        ...resultMetadata(item),
        events: item.events.slice(-256).map(normalizeStoredEvent).filter(Boolean),
        nodes: item.nodes.slice(-128).flatMap(node => STAGE_LABELS[node?.id] ? [{ id: node.id, label: STAGE_LABELS[node.id], status: ["running", "complete", "skipped", "failed"].includes(node.status) ? node.status : "failed", inputs: normalizeArtifacts(node.inputs), outputs: normalizeArtifacts(node.outputs) }] : []),
        edges: item.edges.slice(-256).flatMap(edge => STAGE_LABELS[edge?.from] && STAGE_LABELS[edge?.to] ? [{ from: edge.from, to: edge.to, inputs: normalizeArtifacts(edge.inputs), outputs: normalizeArtifacts(edge.outputs) }] : []),
        previousNodeId: boundedCode(item.previousNodeId, 48),
        errorCode: ALLOWED_ERROR_CODES.has(item.errorCode) ? item.errorCode : ""
      };
      restored.candidateSummaries = normalizeCandidateSummaries(item.candidateSummaries, restored);
      runs.set(restored.id, restored);
    }
    prune();
  }

  function prune() {
    const cutoff = now() - ttlMs;
    let changed = false;
    for (const [id, run] of runs) {
      if (run.updatedAtMs < cutoff) {
        runs.delete(id);
        listeners.delete(id);
        changed = true;
      }
    }
    while (runs.size > maxRuns) {
      const oldestId = runs.keys().next().value;
      runs.delete(oldestId);
      listeners.delete(oldestId);
      changed = true;
    }
    if (changed) persist();
  }

  restore();

  function publish(run) {
    const snapshot = publicRun(run);
    for (const listener of listeners.get(run.id) || []) {
      try { listener(snapshot); } catch (_) { /* Observers cannot fail the run. */ }
    }
    return snapshot;
  }

  function start({
    ownerId,
    operation,
    provider = "",
    model = "",
    projectId = "",
    processCodes = [],
    assessmentRefs = [],
    evidenceRefs = [],
    inputs = []
  } = {}) {
    if (!String(ownerId || "").trim()) throw new Error("A run owner is required");
    prune();
    const timestamp = new Date(now()).toISOString();
    const id = String(idFactory());
    const run = {
      id,
      ownerId: boundedText(ownerId, 120),
      operation: boundedCode(operation || "review", 48) || "review",
      provider: boundedCode(provider, 48),
      model: boundedCode(model, 120),
      projectId: boundedCode(projectId, 191),
      processCodes: normalizeCodes(processCodes, 32),
      assessmentRefs: normalizeCodes(assessmentRefs, 100),
      evidenceRefs: normalizeEvidenceRefs(evidenceRefs),
      status: "running",
      startedAt: timestamp,
      updatedAt: timestamp,
      updatedAtMs: now(),
      completedAt: "",
      events: [],
      nodes: [],
      edges: [],
      previousNodeId: "",
      errorCode: ""
    };
    Object.assign(run, resultMetadata(), { candidateSummaries: [] });
    runs.set(id, run);
    stage(id, {
      id: "request-accepted",
      status: "complete",
      summary: "Request accepted; private input content is not recorded.",
      inputs
    });
    persist();
    return publicRun(run);
  }

  function stage(runId, {
    id,
    status = "running",
    summary = "",
    inputs = [],
    outputs = [],
    metrics = {}
  } = {}) {
    const run = runs.get(String(runId));
    if (!run || run.status !== "running") return null;
    const stageId = boundedCode(id, 48);
    if (!STAGE_LABELS[stageId]) throw new Error("Unsupported harness stage id");
    const validStatus = ["running", "complete", "failed", "skipped"].includes(status) ? status : "running";
    const event = {
      sequence: run.events.length + 1,
      stage: stageId,
      status: validStatus,
      at: new Date(now()).toISOString(),
      summary: STAGE_LABELS[stageId],
      inputs: normalizeArtifacts(inputs),
      outputs: normalizeArtifacts(outputs),
      metrics: {}
    };
    for (const key of ["inputCount", "outputCount", "durationMs"]) {
      const value = Number(metrics[key]);
      if (Number.isFinite(value) && value >= 0) event.metrics[key] = Math.min(Math.floor(value), 1_000_000_000);
    }
    run.events.push(event);
    const node = {
      id: stageId,
      status: validStatus,
      label: event.summary,
      inputs: event.inputs,
      outputs: event.outputs
    };
    const existingIndex = run.nodes.findIndex(item => item.id === stageId);
    if (existingIndex >= 0) run.nodes[existingIndex] = node;
    else {
      run.nodes.push(node);
      if (run.previousNodeId) {
        run.edges.push({
          from: run.previousNodeId,
          to: stageId,
          inputs: event.inputs,
          outputs: event.outputs
        });
      }
    }
    run.previousNodeId = stageId;
    run.updatedAt = event.at;
    run.updatedAtMs = now();
    if (validStatus === "failed" || (validStatus === "complete" && stageId === "completed")) {
      run.status = validStatus === "failed" ? "failed" : "complete";
      run.completedAt = event.at;
    }
    prune();
    const snapshot = publish(run);
    persist();
    return snapshot;
  }

  function complete(runId, { outputs = [], metrics = {}, candidates = [], transport = "", modelStatus = "complete", candidateOnly = false, assessmentGenerated = candidates.length > 0 } = {}) {
    const run = runs.get(String(runId));
    if (!run || run.status !== "running") return null;
    Object.assign(run, resultMetadata({ transport, modelStatus, candidateOnly, assessmentGenerated }));
    run.candidateSummaries = modelStatus === "complete" ? normalizeCandidateSummaries(candidates, run) : [];
    const snapshot = stage(runId, {
      id: "completed",
      status: "complete",
      outputs,
      metrics
    });
    return snapshot;
  }

  function fail(runId, errorCode = "unexpected") {
    const run = runs.get(String(runId));
    if (!run || run.status !== "running") return null;
    run.errorCode = ALLOWED_ERROR_CODES.has(errorCode) ? errorCode : "unexpected";
    Object.assign(run, resultMetadata({ transport: "unavailable", modelStatus: "failed" }));
    return stage(runId, {
      id: "failed",
      status: "failed",
      summary: "Run stopped; inspect the diagnostic code and local service logs."
    });
  }

  function get(runId, ownerId) {
    prune();
    const run = runs.get(String(runId));
    return run && run.ownerId === String(ownerId || "") ? publicRun(run) : null;
  }

  function list(ownerId, projectId = "") {
    prune();
    const owner = String(ownerId || "");
    const project = boundedCode(projectId, 191);
    return [...runs.values()]
      .filter(run => run.ownerId === owner && (!project || run.projectId === project))
      .map(publicRun)
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  }

  function subscribe(runId, ownerId, listener) {
    const run = runs.get(String(runId));
    if (!run || run.ownerId !== String(ownerId || "") || typeof listener !== "function") return () => {};
    const group = listeners.get(run.id) || new Set();
    group.add(listener);
    listeners.set(run.id, group);
    return () => {
      group.delete(listener);
      if (!group.size) listeners.delete(run.id);
    };
  }

  return { start, stage, complete, fail, get, list, subscribe, prune };
}
