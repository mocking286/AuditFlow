/*
 * Integration:
 *   <link rel="stylesheet" href="./ai-harness.css">
 *   <div id="aiHarnessPanel"></div>
 *   <script defer src="./ai-harness-ui.js"></script>
 *
 * The host can use [data-ai-harness-panel] instead of the fixed id, or call
 * window.AuditFlowAiHarnessUI.mount({ mount }) after the route is rendered.
 * The endpoint must be same-origin and return /api/ai/harness/runs metadata.
 */
(function (root, factory) {
  const api = factory(root);
  if (root) root.AuditFlowAiHarnessUI = api;
  if (root && root.document) {
    const boot = () => {
      const mount = root.document.querySelector("[data-ai-harness-panel], #aiHarnessPanel");
      if (mount) api.mount({ mount });
    };
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", boot, { once: true });
    else boot();
  }
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  const DEFAULT_ENDPOINT = "/api/ai/harness/runs";
  const DEFAULT_INTERVAL_MS = 5000;
  const MAX_RUNS = 20;
  const MAX_EVENTS = 64;
  const MAX_ARTIFACTS = 20;
  const STAGE_LABELS_EN = Object.freeze({
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
  const STAGE_LABELS_ZH = Object.freeze({
    "request-accepted": "请求已接收",
    "input-scan": "输入扫描",
    "document-parse": "文档解析",
    "ocr-extraction": "OCR 提取",
    "evidence-filter": "ASPICE 证据筛选",
    "evidence-map": "证据映射",
    "candidate-review": "AI 候选评审",
    "report-assembly": "报告组装",
    "assessor-review": "评估师复核门禁",
    completed: "运行完成",
    failed: "运行失败"
  });
  const STAGE_ALIASES = Object.freeze({
    scan: "input-scan",
    "input-prepared": "input-scan",
    "parse-document": "document-parse",
    "ocr-image": "ocr-extraction",
    "extract-tables": "document-parse",
    "map-evidence": "evidence-map",
    "model-review": "candidate-review",
    "build-report": "report-assembly",
    "human-review": "assessor-review"
  });
  const ARTIFACT_LABELS_EN = Object.freeze({
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
  const ARTIFACT_LABELS_ZH = Object.freeze({
    document: "已选源文档",
    image: "已选源图片",
    "review-context": "评审上下文",
    "evidence-set": "符合条件的证据集",
    "ocr-result": "未经验证的 OCR 提取",
    "table-set": "提取表格",
    "indicator-set": "候选指标",
    "model-response": "AI 候选响应",
    "assessment-candidate": "评估候选",
    report: "报告草稿",
    artifact: "产物",
    response: "AI 候选响应",
    "candidate-review": "AI 候选响应",
    evidence: "证据项",
    table: "提取表格"
  });
  const ARTIFACT_ALIASES_EN = Object.freeze({
    artifact: "Artifact",
    response: "AI candidate response",
    "candidate-review": "AI candidate response",
    evidence: "Evidence item",
    table: "Extracted table"
  });
  const ARTIFACT_ALIASES_ZH = Object.freeze({
    artifact: "Artifact",
    response: "AI 候选响应",
    "candidate-review": "AI 候选响应",
    evidence: "证据项",
    table: "提取表格"
  });
  const COPY = Object.freeze({
    en: {
      title: "AI harness run monitor",
      subtitle: "Auditable stages, evidence locators and indicator mapping; source text is never stored here",
      connecting: "Connecting",
      live: "Live",
      unavailable: "Unavailable",
      loading: "Loading harness runs...",
      noRuns: "No active harness runs",
      endpointUnavailable: "Harness endpoint unavailable",
      graph: "IO relationship graph",
      events: "Run events",
      stages: "stages",
      polling: "poll",
      on: "on",
      off: "off",
      noStages: "No visible stages",
      in: "IN",
      out: "OUT",
      io: "IO"
    },
    zh: {
      title: "AI Harness 运行监控",
      subtitle: "可审计阶段、证据定位与指标映射；不保存私有思维链",
      connecting: "连接中",
      live: "实时",
      unavailable: "不可用",
      loading: "正在加载运行记录...",
      noRuns: "当前没有活动运行",
      endpointUnavailable: "Harness 服务暂不可用",
      graph: "IO 关系图",
      events: "运行事件",
      stages: "个阶段",
      polling: "轮询",
      on: "开启",
      off: "关闭",
      noStages: "暂无可显示阶段",
      in: "输入",
      out: "输出",
      io: "IO"
    }
  });
  const STATUS_LABELS = Object.freeze({
    en: { running: "running", complete: "complete", failed: "failed", skipped: "skipped", unknown: "unknown" },
    zh: { running: "运行中", complete: "已完成", failed: "失败", skipped: "已跳过", unknown: "未知" }
  });
  const STATUSES = new Set(["running", "complete", "failed", "skipped", "unknown"]);

  function language() {
    return root && root.document && /^zh(?:-|$)/i.test(root.document.documentElement.lang || "") ? "zh" : "en";
  }

  function copy(key) {
    return COPY[language()][key] || COPY.en[key] || key;
  }

  function stageLabel(stage) {
    return (language() === "zh" ? STAGE_LABELS_ZH : STAGE_LABELS_EN)[stage] || "";
  }

  function canonicalStage(value) {
    const candidate = text(value, 48);
    return Object.prototype.hasOwnProperty.call(STAGE_LABELS_EN, candidate)
      ? candidate
      : Object.prototype.hasOwnProperty.call(STAGE_ALIASES, candidate)
        ? STAGE_ALIASES[candidate]
        : "";
  }

  function artifactLabel(type) {
    const labels = language() === "zh" ? ARTIFACT_LABELS_ZH : ARTIFACT_LABELS_EN;
    return labels[type] || (language() === "zh" ? ARTIFACT_ALIASES_ZH : ARTIFACT_ALIASES_EN)[type] || "";
  }

  function statusLabel(value) {
    return STATUS_LABELS[language()][value] || STATUS_LABELS.en.unknown;
  }

  function text(value, maxLength) {
    return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
  }

  function boundedAnswer(value, maxLength = 20000) {
    return String(value == null ? "" : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
  }

  function opaqueId(value) {
    const candidate = text(value, 96);
    return /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(candidate) ? candidate : "";
  }

  function finiteCount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.min(Math.floor(number), 1000000000) : null;
  }

  function status(value) {
    const candidate = text(value, 24).toLowerCase();
    return STATUSES.has(candidate) ? candidate : "unknown";
  }

  function artifact(value) {
    if (!value || typeof value !== "object") return null;
    const id = opaqueId(value.id);
    const type = text(value.type, 48);
    if (!id || (!Object.prototype.hasOwnProperty.call(ARTIFACT_LABELS_EN, type) &&
        !Object.prototype.hasOwnProperty.call(ARTIFACT_ALIASES_EN, type))) return null;
    return { id, type, label: artifactLabel(type) };
  }

  function artifacts(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_ARTIFACTS).map(artifact).filter(Boolean);
  }

  function normalizeEvent(value) {
    if (!value || typeof value !== "object") return null;
    const stage = canonicalStage(value.stage);
    if (!stage) return null;
    const metrics = {};
    for (const key of ["inputCount", "outputCount", "durationMs"]) {
      const count = finiteCount(value.metrics && value.metrics[key]);
      if (count !== null) metrics[key] = count;
    }
    return {
      stage,
      label: stageLabel(stage),
      status: status(value.status),
      sequence: finiteCount(value.sequence),
      at: text(value.at, 40),
      inputs: artifacts(value.inputs),
      outputs: artifacts(value.outputs),
      metrics
    };
  }

  function normalizeNode(value) {
    if (!value || typeof value !== "object") return null;
    const stage = canonicalStage(value.id);
    if (!stage) return null;
    return {
      id: stage,
      label: stageLabel(stage),
      status: status(value.status),
      inputs: artifacts(value.inputs),
      outputs: artifacts(value.outputs)
    };
  }

  function normalizeEdge(value) {
    if (!value || typeof value !== "object") return null;
    const from = canonicalStage(value.from);
    const to = canonicalStage(value.to);
    if (!from || !to) return null;
    return { from, to, inputs: artifacts(value.inputs), outputs: artifacts(value.outputs) };
  }

  function normalizeRun(value) {
    if (!value || typeof value !== "object") return null;
    const id = opaqueId(value.id);
    if (!id) return null;
    const graph = value.graph && typeof value.graph === "object" ? value.graph : {};
    const events = Array.isArray(value.events)
      ? value.events.slice(-MAX_EVENTS).map(normalizeEvent).filter(Boolean)
      : [];
    const nodes = Array.isArray(graph.nodes)
      ? graph.nodes.slice(0, MAX_EVENTS).map(normalizeNode).filter(Boolean)
      : [];
    const edges = Array.isArray(graph.edges)
      ? graph.edges.slice(0, MAX_EVENTS * 2).map(normalizeEdge).filter(Boolean)
      : [];
    return {
      id,
      status: status(value.status),
      provider: opaqueId(value.provider),
      model: opaqueId(value.model),
      transport: opaqueId(value.transport),
      modelStatus: ["running", "complete", "skipped", "failed"].includes(value.modelStatus) ? value.modelStatus : "",
      candidateOnly: value.candidateOnly === true,
      candidateSummaries: Array.isArray(value.candidateSummaries) ? value.candidateSummaries.slice(0, 100).flatMap(item => {
        if (!item || !Array.isArray(value.processCodes) || !value.processCodes.includes(item.process)) return [];
        const indicator = opaqueId(item.indicator);
        if (!indicator.startsWith(`${opaqueId(item.process)}.`) || !["N", "P-", "P", "P+", "L-", "L", "L+", "F"].includes(item.rating)) return [];
        const allowedEvidence = new Set((value.evidenceRefs || []).map(ref => opaqueId(ref?.code)));
        return [{ process: opaqueId(item.process), indicator, rating: item.rating, findingTypes: Array.isArray(item.findingTypes) ? item.findingTypes.filter(type => ["O", "S", "W", "R", "NC", "OFI", "RC"].includes(type)).slice(0, 8) : [], evidenceCodes: Array.isArray(item.evidenceCodes) ? item.evidenceCodes.map(opaqueId).filter(code => allowedEvidence.has(code)).slice(0, 40) : [] }];
      }) : [],
      startedAt: text(value.startedAt, 40),
      updatedAt: text(value.updatedAt, 40),
      completedAt: text(value.completedAt, 40),
      localAnswer: boundedAnswer(value.localAnswer),
      projectId: opaqueId(value.projectId),
      processCodes: Array.isArray(value.processCodes) ? value.processCodes.slice(0, 32).map(item => opaqueId(item)).filter(Boolean) : [],
      assessmentRefs: Array.isArray(value.assessmentRefs) ? value.assessmentRefs.slice(0, 100).map(item => opaqueId(item)).filter(Boolean) : [],
      evidenceRefs: Array.isArray(value.evidenceRefs) ? value.evidenceRefs.slice(0, 40).map(item => {
        if (!item || typeof item !== "object") return null;
        const id = opaqueId(item.id);
        const code = opaqueId(item.code);
        if (!id || !code) return null;
        return {
          id,
          code,
          locator: text(item.locator, 180),
          role: ["direct", "corroborating", "index-only"].includes(item.role) ? item.role : "",
          process: opaqueId(item.process),
          indicator: opaqueId(item.indicator)
        };
      }).filter(Boolean) : [],
      events,
      nodes,
      edges
    };
  }

  function extractRuns(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    if (Array.isArray(payload.runs)) return payload.runs;
    if (payload.data && Array.isArray(payload.data.runs)) return payload.data.runs;
    if (payload.data && Array.isArray(payload.data)) return payload.data;
    return [];
  }

  function normalizePayload(payload) {
    return extractRuns(payload).slice(0, MAX_RUNS).map(normalizeRun).filter(Boolean);
  }

  function escapeHtml(value) {
    return text(value, 1000).replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[character]));
  }

  function metricMarkup(metrics) {
    const values = [
      ["in", metrics.inputCount],
      ["out", metrics.outputCount],
      ["ms", metrics.durationMs]
    ].filter(([, value]) => value !== undefined);
    const labels = language() === "zh"
      ? { in: "入", out: "出", ms: "毫秒" }
      : { in: "in", out: "out", ms: "ms" };
    return values.map(([key, value]) => `<span class="af-harness-metric"><b>${labels[key]}</b><em>${value}</em></span>`).join("");
  }

  function ioMarkup(items) {
    if (!items.length) return `<span class="af-harness-empty-io">-</span>`;
    return `<ul class="af-harness-io-list">${items.map(item =>
      `<li><span class="af-harness-io-id">${escapeHtml(item.id)}</span><span class="af-harness-io-type">${escapeHtml(artifactLabel(item.type))}</span></li>`
    ).join("")}</ul>`;
  }

  function nodeMarkup(node) {
    return `<article class="af-harness-node af-harness-status-${escapeHtml(node.status)}" data-stage="${escapeHtml(node.id)}">
      <header><strong>${escapeHtml(stageLabel(node.id))}</strong><span>${escapeHtml(statusLabel(node.status))}</span></header>
      <div class="af-harness-node-id">${escapeHtml(node.id)}</div>
      <div class="af-harness-node-io"><section><small>${copy("in")}</small>${ioMarkup(node.inputs)}</section><section><small>${copy("out")}</small>${ioMarkup(node.outputs)}</section></div>
    </article>`;
  }

  function edgeMarkup(edge) {
    return `<li class="af-harness-edge"><span class="af-harness-edge-node">${escapeHtml(stageLabel(edge.from))}</span><i aria-hidden="true"></i><span class="af-harness-edge-node">${escapeHtml(stageLabel(edge.to))}</span><div class="af-harness-edge-io"><small>${copy("io")}</small>${ioMarkup(edge.outputs)}</div></li>`;
  }

  function eventMarkup(event) {
    return `<li class="af-harness-event af-harness-status-${escapeHtml(event.status)}">
      <div><strong>${escapeHtml(stageLabel(event.stage))}</strong><span>${escapeHtml(statusLabel(event.status))}</span></div>
      <small>${escapeHtml(event.stage)}${event.at ? ` · ${escapeHtml(event.at)}` : ""}</small>
      <div class="af-harness-event-metrics">${metricMarkup(event.metrics)}</div>
    </li>`;
  }

  function runMarkup(run, selected) {
    const processCodes = Array.isArray(run.processCodes) ? run.processCodes : [];
    const assessmentRefs = Array.isArray(run.assessmentRefs) ? run.assessmentRefs : [];
    const evidenceRefs = Array.isArray(run.evidenceRefs) ? run.evidenceRefs : [];
    const candidateSummaries = Array.isArray(run.candidateSummaries) ? run.candidateSummaries : [];
    const evidenceMarkup = ref => `<li><a href="#/standard/${encodeURIComponent(run.projectId || "")}/evidence" data-ai-harness-evidence="${escapeHtml(ref.id)}" data-project-id="${escapeHtml(run.projectId || "")}">${escapeHtml(ref.code)}</a> · ${escapeHtml(ref.locator || "-")} · ${escapeHtml(ref.role || "unclassified")}</li>`;
    const scopeMarkup = processCodes.map(process => {
      const summaries = candidateSummaries.filter(item => item.process === process);
      const refs = evidenceRefs.filter(ref => ref.process === process || ref.indicator.startsWith(`${process}.`));
      const indicators = assessmentRefs.filter(ref => ref.startsWith(`${process}.`));
      return `<section class="af-harness-process" data-process-domain="${escapeHtml(process)}"><h4>${escapeHtml(process)}</h4>${indicators.length ? `<p>${indicators.map(escapeHtml).join(" · ")}</p>` : ""}${summaries.length ? `<ul class="af-harness-candidates">${summaries.map(item => `<li><b>${escapeHtml(item.indicator)}</b> · ${escapeHtml(item.rating)}${item.findingTypes.length ? ` · ${item.findingTypes.map(escapeHtml).join(", ")}` : ""}${item.evidenceCodes.length ? ` · ${item.evidenceCodes.map(escapeHtml).join(", ")}` : ""} <small>${language() === "zh" ? "候选，待评估师确认" : "Candidate; assessor confirmation required"}</small></li>`).join("")}</ul>` : ""}${refs.length ? `<ul>${refs.map(evidenceMarkup).join("")}</ul>` : ""}</section>`;
    }).join("");
    const events = Array.isArray(run.events) ? run.events : [];
    const existingNodes = Array.isArray(run.nodes) ? run.nodes : [];
    const existingEdges = Array.isArray(run.edges) ? run.edges : [];
    const nodes = existingNodes.length ? existingNodes : events.map(event => ({
      id: event.stage, status: event.status,
      inputs: event.inputs, outputs: event.outputs
    }));
    const edges = existingEdges.length ? existingEdges : nodes.slice(1).map((node, index) => ({
      from: nodes[index].id, to: node.id, inputs: node.inputs, outputs: node.outputs
    }));
    return `<article class="af-harness-run ${selected ? "is-selected" : ""}" data-run-id="${escapeHtml(run.id)}">
      <button class="af-harness-run-header" type="button" data-ai-harness-run="${escapeHtml(run.id)}" aria-expanded="${selected ? "true" : "false"}">
        <span><strong>${escapeHtml(run.id)}</strong><small>${escapeHtml(statusLabel(run.status))}${run.projectId ? ` · ${escapeHtml(run.projectId)}` : ""}</small></span>
      </button>
      ${selected ? `<div class="af-harness-run-body">
        <p class="af-harness-model">${[run.provider, run.model, run.transport, run.modelStatus].filter(Boolean).map(escapeHtml).join(" · ")}${run.modelStatus === "skipped" ? ` · ${language() === "zh" ? "未执行模型推理，未生成评分" : "No model inference or rating generated"}` : ""}</p>
        ${run.localAnswer ? `<section class="af-harness-answer"><header><h3>${language() === "zh" ? "AI 候选意见（本机对话缓存）" : "AI candidate opinion (local chat cache)"}</h3></header><pre>${escapeHtml(run.localAnswer)}</pre></section>` : ""}
        ${processCodes.length || assessmentRefs.length || evidenceRefs.length ? `<section class="af-harness-audit-scope"><header><h3>${language() === "zh" ? "评估轨迹范围" : "Assessment trace scope"}</h3></header><div class="af-harness-scope-grid">${scopeMarkup}${evidenceRefs.some(ref => !ref.process && !ref.indicator) ? `<div><small>${language() === "zh" ? "证据定位" : "Evidence locators"}</small><ul>${evidenceRefs.filter(ref => !ref.process && !ref.indicator).map(evidenceMarkup).join("")}</ul></div>` : ""}</div></section>` : ""}
        <section class="af-harness-graph-section"><header><h3>${copy("graph")}</h3><span>${nodes.length} ${copy("stages")}</span></header>
          <div class="af-harness-graph-nodes">${nodes.map(nodeMarkup).join("") || `<p class="af-harness-empty">${copy("noStages")}</p>`}</div>
          ${edges.length ? `<ol class="af-harness-graph-edges">${edges.map(edgeMarkup).join("")}</ol>` : ""}
        </section>
        <section class="af-harness-events-section"><header><h3>${copy("events")}</h3><span>${run.events.length}</span></header>
          <ol class="af-harness-events">${events.map(eventMarkup).join("") || `<li class="af-harness-empty">No visible events</li>`}</ol>
        </section>
      </div>` : ""}
    </article>`;
  }

  function render(mount, state) {
    if (!mount) return;
    const runs = state.runs || [];
    const selected = runs.find(run => run.id === state.selectedId)?.id || runs[0]?.id || "";
    state.selectedId = selected;
    mount.innerHTML = `<section class="af-harness-panel" role="region" aria-label="${copy("title")}">
      <header class="af-harness-panel-header"><div><h2>${copy("title")}</h2><p>${copy("subtitle")}</p></div><span class="af-harness-availability af-harness-availability-${escapeHtml(state.availability)}" role="status" aria-live="polite">${escapeHtml(state.availabilityLabel)}</span></header>
      ${state.availability === "ready" && runs.length
        ? `<div class="af-harness-runs">${runs.map(run => runMarkup(run, run.id === selected)).join("")}</div>`
        : `<div class="af-harness-empty">${escapeHtml(state.emptyLabel)}</div>`}
      <footer class="af-harness-panel-footer"><span>${copy("polling")} ${state.polling ? copy("on") : copy("off")}</span></footer>
    </section>`;
    mount.querySelectorAll("[data-ai-harness-run]").forEach(button => {
      button.addEventListener("click", () => {
        state.selectedId = button.getAttribute("data-ai-harness-run") || "";
        render(mount, state);
      });
    });
    mount.querySelectorAll("[data-ai-harness-evidence]").forEach(link => {
      link.addEventListener("click", () => {
        if (root && root.dispatchEvent && typeof root.CustomEvent === "function") root.dispatchEvent(new root.CustomEvent("auditflow:harness-evidence", { detail: { projectId: link.getAttribute("data-project-id"), evidenceId: link.getAttribute("data-ai-harness-evidence") } }));
      });
    });
  }

  function mount({
    mount,
    endpoint = DEFAULT_ENDPOINT,
    intervalMs = DEFAULT_INTERVAL_MS,
    fetchImpl = root && root.fetch ? root.fetch.bind(root) : null,
    headers = {},
    credentials = "same-origin",
    localAnswers = []
  } = {}) {
    if (!mount || typeof mount !== "object") throw new Error("An AI harness mount element is required");
    const requestedEndpoint = String(endpoint || DEFAULT_ENDPOINT);
    if (requestedEndpoint.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(requestedEndpoint)) {
      throw new Error("The AI harness endpoint must be same-origin");
    }
    const location = root && root.location;
    const baseOrigin = location && location.origin || "http://localhost";
    const parsedEndpoint = new URL(requestedEndpoint, `${baseOrigin}/`);
    if (location && parsedEndpoint.origin !== location.origin) {
      throw new Error("The AI harness endpoint must be same-origin");
    }
    const safeEndpoint = `${parsedEndpoint.pathname}${parsedEndpoint.search}`;
    const state = {
      runs: [],
      selectedId: "",
      availability: "loading",
      availabilityLabel: copy("connecting"),
      emptyLabel: copy("loading"),
      polling: false
    };
    let stopped = false;
    let timer = null;
    let request = null;
    let controller = null;

    function schedule() {
      if (stopped) return;
      clearTimeout(timer);
      timer = setTimeout(poll, Math.max(1000, Number(intervalMs) || DEFAULT_INTERVAL_MS));
    }

    async function poll() {
      if (stopped || request) return;
      if (typeof fetchImpl !== "function") {
        state.availability = "unavailable";
        state.availabilityLabel = copy("unavailable");
        state.emptyLabel = copy("endpointUnavailable");
        state.polling = false;
        render(mount, state);
        schedule();
        return;
      }
      state.polling = true;
      render(mount, state);
      controller = typeof root.AbortController === "function" ? new root.AbortController() : null;
      const timeout = root.setTimeout(() => controller?.abort(), 8000);
      request = Promise.resolve().then(() => fetchImpl(safeEndpoint, {
        method: "GET",
        credentials,
        headers: { accept: "application/json", ...(headers || {}) },
        ...(controller ? { signal: controller.signal } : {})
      })).then(response => {
        if (!response || !response.ok) throw new Error("unavailable");
        return response.json();
      }).then(payload => {
        const answers = new Map((Array.isArray(localAnswers) ? localAnswers : [])
          .filter(item => item && typeof item === "object")
          .map(item => [opaqueId(item.runId), boundedAnswer(item.content)]));
        state.runs = normalizePayload(payload).map(run => ({
          ...run,
          localAnswer: answers.get(run.id) || ""
        }));
        state.availability = "ready";
        state.availabilityLabel = copy("live");
        state.emptyLabel = copy("noRuns");
      }).catch(() => {
        state.availability = "unavailable";
        state.availabilityLabel = copy("unavailable");
        state.emptyLabel = copy("endpointUnavailable");
      }).finally(() => {
        root.clearTimeout(timeout);
        controller = null;
        request = null;
        state.polling = false;
        render(mount, state);
        schedule();
      });
      await request;
      return state;
    }

    function stop() {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      if (request && typeof request.catch === "function") request.catch(() => {});
      state.polling = false;
    }

    render(mount, state);
    poll();
    return { poll, stop, state };
  }

  return {
    DEFAULT_ENDPOINT,
    STAGE_LABELS: STAGE_LABELS_EN,
    ARTIFACT_LABELS: ARTIFACT_LABELS_EN,
    normalizeEvent,
    normalizeRun,
    normalizePayload,
    render,
    mount
  };
});
