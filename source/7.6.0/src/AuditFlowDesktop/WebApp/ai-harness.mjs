import crypto from "node:crypto";

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_RUNS = 128;
const MAX_ARTIFACTS_PER_STAGE = 20;
const MAX_ID_LENGTH = 96;

export const AI_HARNESS_STAGES = Object.freeze({
  "request-accepted": "Request accepted",
  "input-scan": "Input scan",
  "document-parse": "Document parsing",
  "ocr-extraction": "OCR extraction",
  "evidence-filter": "ASPICE evidence filter",
  "evidence-map": "Evidence mapping",
  "candidate-review": "AI candidate review",
  "report-assembly": "Report assembly",
  "assessor-review": "Assessor review gate",
  completed: "Run completed",
  failed: "Run failed"
});

export const AI_HARNESS_ARTIFACT_TYPES = Object.freeze({
  document: "Selected source document",
  image: "Selected source image",
  "review-context": "Review context",
  "evidence-set": "Eligible evidence set",
  "ocr-result": "Unverified OCR extraction",
  "table-set": "Extracted tables",
  "indicator-set": "Candidate indicators",
  "model-response": "AI candidate response",
  "assessment-candidate": "Assessment candidate",
  report: "Report draft"
});

const OPERATIONS = new Set([
  "document-review",
  "evidence-parse",
  "indicator-review",
  "report-generation",
  "traceability-review"
]);
const PROVIDERS = new Set([
  "codex",
  "deepseek",
  "local-ocr",
  "openai-compatible",
  "unspecified"
]);
const STATUSES = new Set(["running", "complete", "failed", "skipped"]);
const ERROR_CODES = new Set([
  "cancelled",
  "invalid-output",
  "provider-unavailable",
  "request-timeout",
  "unexpected"
]);
const METRIC_KEYS = ["inputCount", "outputCount", "durationMs"];

function normalizeOpaqueId(value, label = "id") {
  const id = String(value ?? "");
  if (
    !id ||
    id.length > MAX_ID_LENGTH ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(id)
  ) {
    throw new Error(`Invalid harness ${label}`);
  }
  return id;
}

function normalizeArtifacts(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("Harness artifacts must be an array");
  if (value.length > MAX_ARTIFACTS_PER_STAGE) {
    throw new Error(`Harness stages accept at most ${MAX_ARTIFACTS_PER_STAGE} artifacts`);
  }
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Invalid harness artifact");
    }
    const id = normalizeOpaqueId(item.id, "artifact id");
    const type = String(item.type || "");
    if (!Object.hasOwn(AI_HARNESS_ARTIFACT_TYPES, type)) {
      throw new Error("Unsupported harness artifact type");
    }
    const label = AI_HARNESS_ARTIFACT_TYPES[type];
    return { id, type, label };
  });
}

function normalizeMetrics(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Harness metrics must be an object");
  }
  const metrics = {};
  for (const key of METRIC_KEYS) {
    if (value[key] == null) continue;
    const number = Number(value[key]);
    if (!Number.isFinite(number) || number < 0) {
      throw new Error(`Invalid harness metric: ${key}`);
    }
    metrics[key] = Math.min(Math.floor(number), 1_000_000_000);
  }
  return metrics;
}

function publicRun(run) {
  return {
    id: run.id,
    operation: run.operation,
    provider: run.provider,
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
 * In-memory run metadata for the visible AI workflow. It records stages and
 * opaque artifact references only; prompts, evidence text, model output, and
 * private chain-of-thought are never accepted into the public run record.
 */
export function createAiHarnessLedger({
  ttlMs = DEFAULT_TTL_MS,
  maxRuns = DEFAULT_MAX_RUNS,
  now = () => Date.now(),
  idFactory = () => crypto.randomUUID()
} = {}) {
  const retentionMs = Math.max(1, Number(ttlMs) || DEFAULT_TTL_MS);
  const runLimit = Math.max(1, Math.floor(Number(maxRuns) || DEFAULT_MAX_RUNS));
  const runs = new Map();
  const listeners = new Map();

  function prune() {
    const cutoff = now() - retentionMs;
    for (const [id, run] of runs) {
      if (run.updatedAtMs < cutoff) {
        runs.delete(id);
        listeners.delete(id);
      }
    }
    while (runs.size > runLimit) {
      const oldestId = runs.keys().next().value;
      runs.delete(oldestId);
      listeners.delete(oldestId);
    }
  }

  function publish(run) {
    const snapshot = publicRun(run);
    for (const listener of listeners.get(run.id) || []) {
      try {
        listener(structuredClone(snapshot));
      } catch (_) {
        // A UI observer cannot fail an assessment run.
      }
    }
    return snapshot;
  }

  function appendStage(run, stageId, {
    status = "running",
    inputs = [],
    outputs = [],
    metrics = {}
  } = {}) {
    if (!Object.hasOwn(AI_HARNESS_STAGES, stageId)) {
      throw new Error("Unsupported harness stage id");
    }
    if (!STATUSES.has(status)) throw new Error("Unsupported harness stage status");
    const event = {
      sequence: run.events.length + 1,
      stage: stageId,
      label: AI_HARNESS_STAGES[stageId],
      status,
      at: new Date(now()).toISOString(),
      inputs: normalizeArtifacts(inputs),
      outputs: normalizeArtifacts(outputs),
      metrics: normalizeMetrics(metrics)
    };
    run.events.push(event);

    const node = {
      id: stageId,
      label: event.label,
      status,
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

    if (status === "failed" || (status === "complete" && stageId === "completed")) {
      run.status = status === "failed" ? "failed" : "complete";
      run.completedAt = event.at;
    }
    prune();
    return publish(run);
  }

  function start({
    ownerId,
    operation = "indicator-review",
    provider = "unspecified",
    inputs = []
  } = {}) {
    if (!String(ownerId || "").trim()) throw new Error("A harness run owner is required");
    if (!OPERATIONS.has(operation)) throw new Error("Unsupported harness operation");
    if (!PROVIDERS.has(provider)) throw new Error("Unsupported harness provider");
    prune();
    const timestamp = new Date(now()).toISOString();
    const id = normalizeOpaqueId(idFactory(), "run id");
    if (runs.has(id)) throw new Error("Harness run id already exists");
    const run = {
      id,
      ownerId: String(ownerId),
      operation,
      provider,
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
    runs.set(id, run);
    appendStage(run, "request-accepted", {
      status: "complete",
      inputs
    });
    return publicRun(run);
  }

  function stage(runId, {
    id,
    status = "running",
    inputs = [],
    outputs = [],
    metrics = {}
  } = {}) {
    const run = runs.get(String(runId));
    if (!run || run.status !== "running") return null;
    const stageId = String(id || "");
    return appendStage(run, stageId, { status, inputs, outputs, metrics });
  }

  function complete(runId, { outputs = [], metrics = {} } = {}) {
    const run = runs.get(String(runId));
    if (!run || run.status !== "running") return null;
    return appendStage(run, "completed", {
      status: "complete",
      outputs,
      metrics
    });
  }

  function fail(runId, errorCode = "unexpected") {
    const run = runs.get(String(runId));
    if (!run || run.status !== "running") return null;
    run.errorCode = ERROR_CODES.has(errorCode) ? errorCode : "unexpected";
    return appendStage(run, "failed", { status: "failed" });
  }

  function get(runId, ownerId) {
    prune();
    const run = runs.get(String(runId));
    return run && run.ownerId === String(ownerId || "") ? publicRun(run) : null;
  }

  function subscribe(runId, ownerId, listener) {
    const run = runs.get(String(runId));
    if (!run || run.ownerId !== String(ownerId || "") || typeof listener !== "function") {
      return () => {};
    }
    const group = listeners.get(run.id) || new Set();
    group.add(listener);
    listeners.set(run.id, group);
    return () => {
      group.delete(listener);
      if (!group.size) listeners.delete(run.id);
    };
  }

  return { start, stage, complete, fail, get, subscribe, prune };
}
