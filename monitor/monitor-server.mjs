#!/usr/bin/env node
/**
 * AuditFlow 后台数据监控桥接服务（只读）
 * ============================================================
 * 用途：为 AuditFlow 协作服务器（MySQL 模式）提供后台数据的只读监控 API，
 *       并托管单文件监控工作台 monitor.html。
 *
 * 数据来源（MySQL，全部只读 SELECT）：
 *   - auditflow_projects           项目快照与编辑元数据（谁在何时修改、revision）
 *   - auditflow_project_events     全局修改事件流（哪个人改了哪个项目哪个过程）
 *   - auditflow_project_locks      正在进行的编辑锁（实时编辑中）
 *   - auditflow_project_presence   在线成员
 *   - snapshot_json                解析 traceLinks（证据溯源）与 assessments（AI 评估）
 *
 * 环境变量：
 *   AUDITFLOW_MYSQL_URL            必填，如 mysql://user:pass@127.0.0.1:3306/auditflow
 *   AUDITFLOW_MONITOR_PORT         端口，默认 4175
 *   AUDITFLOW_MONITOR_HOST         监听地址，默认 127.0.0.1；仅配置了 token 才建议 0.0.0.0
 *   AUDITFLOW_MONITOR_TOKEN        访问令牌（推荐必配）；命中后需 ?token= 或 X-Monitor-Token 头
 *   AUDITFLOW_MONITOR_ALLOWED_ORIGIN 跨域白名单（可选，如 https://xxx.workbuddy.link）
 *   AUDITFLOW_MONITOR_HTML         monitor.html 路径，默认与脚本同目录
 *
 * 安全说明：本服务只做 SELECT；建议在生产环境为监控单独创建只读 MySQL 账号。
 * ============================================================
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const VERSION = "1.0.0";

/* ------------------------------------------------------------------ */
/* 工具函数                                                             */
/* ------------------------------------------------------------------ */
function clean(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

/** MySQL datetime(3)（UTC）→ ISO8601 */
function toIso(value) {
  const text = clean(value);
  if (!text) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(text);
  if (!m) return text;
  const ms = String(m[7] || "0").padEnd(3, "0");
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${ms}Z`;
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "")); } catch (_) { return fallback; }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/* ------------------------------------------------------------------ */
/* 快照解析：从 project.snapshot_json 提取监控所需字段                    */
/* ------------------------------------------------------------------ */
function snapshotSummary(snapshot = {}) {
  const assessments = Array.isArray(snapshot.assessments) ? snapshot.assessments : [];
  const traceLinks = Array.isArray(snapshot.traceLinks) ? snapshot.traceLinks : [];
  const evidence = Array.isArray(snapshot.evidence) ? snapshot.evidence : [];
  const aiAssessed = assessments.filter(item => item && item.aiCandidateRating !== undefined && item.aiCandidateRating !== null && String(item.aiCandidateRating) !== "").length;
  const reviewed = assessments.filter(item => item && item.reviewed === true).length;
  const aiInferredLinks = traceLinks.filter(link => link && String(link.source || "") === "AI inferred").length;
  const confirmedLinks = traceLinks.filter(link => link && (link.confirmed === true || String(link.source || "") === "Assessor confirmed")).length;
  return {
    name: clean(snapshot.name || snapshot.title || "", "未命名项目"),
    organization: clean(snapshot.organization, ""),
    product: clean(snapshot.product, ""),
    status: clean(snapshot.status || snapshot.assessmentState || "", ""),
    statusLabel: clean(snapshot.statusLabel, ""),
    progress: Number(snapshot.progress) || 0,
    achievedLevel: clean(snapshot.achievedLevel, ""),
    reportNo: clean(snapshot.reportNo, ""),
    aiOpinion: clean(snapshot.aiOpinion, ""),
    assessmentCount: assessments.length,
    aiAssessed,
    reviewed,
    pendingAi: Math.max(0, assessments.length - reviewed),
    traceLinkCount: traceLinks.length,
    aiInferredLinks,
    confirmedLinks,
    evidenceCount: evidence.length,
    processCount: Array.isArray(snapshot.processes) ? snapshot.processes.length : 0
  };
}

function minimalAssessments(snapshot = {}, limit = 200) {
  const assessments = Array.isArray(snapshot.assessments) ? snapshot.assessments : [];
  return assessments.slice(0, limit).map(item => ({
    id: clean(item.id, ""),
    code: clean(item.code, ""),
    title: clean(item.title, ""),
    process: clean(item.process, ""),
    pa: clean(item.pa, ""),
    rating: item.rating !== undefined && item.rating !== null ? clean(item.rating, "") : "",
    aiCandidateRating: item.aiCandidateRating !== undefined && item.aiCandidateRating !== null ? clean(item.aiCandidateRating, "") : "",
    reviewed: item.reviewed === true,
    confidence: item.confidence !== undefined && item.confidence !== null ? Number(item.confidence) : null,
    reason: clean(item.reason, "").slice(0, 300),
    evidenceAnalysis: Array.isArray(item.evidenceAnalysis) ? item.evidenceAnalysis.slice(0, 20).map(ea => ({
      evidenceId: clean(ea.evidenceId, ""),
      evidenceCode: clean(ea.evidenceCode, ""),
      strength: clean(ea.strength, ""),
      relationType: clean(ea.relationType, ""),
      locator: clean(ea.locator, ""),
      claim: clean(ea.claim, "").slice(0, 200)
    })) : []
  })).filter(item => item.id || item.code);
}

function minimalTraceLinks(snapshot = {}, limit = 300) {
  const traceLinks = Array.isArray(snapshot.traceLinks) ? snapshot.traceLinks : [];
  return traceLinks.slice(0, limit).map(link => ({
    id: clean(link.id, ""),
    indicator: clean(link.indicator, ""),
    evidenceId: clean(link.evidenceId, ""),
    evidenceCode: clean(link.evidenceCode, ""),
    strength: clean(link.strength, ""),
    claim: clean(link.claim, "").slice(0, 200),
    locator: clean(link.locator, ""),
    source: clean(link.source, link.confirmed === true ? "Assessor confirmed" : ""),
    confirmed: link.confirmed === true
  })).filter(item => item.evidenceId || item.evidenceCode || item.id);
}

function minimalEvidence(snapshot = {}, limit = 200) {
  const evidence = Array.isArray(snapshot.evidence) ? snapshot.evidence : [];
  return evidence.slice(0, limit).map(item => ({
    id: clean(item.id, ""),
    code: clean(item.code, ""),
    name: clean(item.name, "").slice(0, 120),
    type: clean(item.type, ""),
    primaryProcesses: Array.isArray(item.primaryProcesses) ? item.primaryProcesses.slice(0, 10) : [],
    helixBlocked: Number(item.helix?.statusCounts?.blocked || 0),
    locators: Array.isArray(item.locators) ? item.locators.slice(0, 5) : []
  })).filter(item => item.id || item.code);
}

/* ------------------------------------------------------------------ */
/* MySQL 只读存储                                                       */
/* ------------------------------------------------------------------ */
export function createMysqlMonitorStore({ url }) {
  if (!url) throw new Error("AUDITFLOW_MYSQL_URL is required for the monitor bridge");
  const parsed = new URL(url);
  const pool = mysql.createPool({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    ssl: parsed.protocol === "mysqls:" ? { rejectUnauthorized: false } : undefined,
    connectionLimit: 4,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  });

  async function health() {
    const started = Date.now();
    const [rows] = await pool.query("select 1 as ok");
    return { ok: true, pingMs: Date.now() - started, mysql: rows[0]?.ok === 1 };
  }

  async function listProjectsRaw() {
    const [rows] = await pool.query(
      "select id, workspace_id, snapshot_json, revision, owner_id, updated_by, updated_by_name, updated_at from auditflow_projects order by updated_at desc"
    );
    return rows;
  }

  async function listEventsRaw(limit = 500) {
    const safeLimit = Math.min(2000, Math.max(1, Number(limit) || 500));
    const [rows] = await pool.query(
      "select id, project_id, revision, user_id, user_name, change_summary, processes_json, change_json, created_at from auditflow_project_events order by created_at desc limit ?",
      [safeLimit]
    );
    return rows;
  }

  async function listLocksRaw() {
    const [rows] = await pool.query(
      "select id, project_id, resource_id, kind, label, process, affected_processes_json, user_id, user_name, acquired_at, expires_at from auditflow_project_locks where expires_at > utc_timestamp(3) order by acquired_at desc"
    );
    return rows;
  }

  async function listPresenceRaw() {
    const [rows] = await pool.query(
      "select project_id, user_id, user_name, project_name, phase, status, last_seen, expires_at from auditflow_project_presence where expires_at > utc_timestamp(3) order by last_seen desc"
    );
    return rows;
  }

  function eventToPublic(row) {
    const change = parseJson(row.change_json, {});
    const processes = Array.isArray(parseJson(row.processes_json, [])) ? parseJson(row.processes_json, []) : [];
    return {
      id: Number(row.id),
      projectId: clean(row.project_id),
      revision: Number(row.revision) || 0,
      userId: clean(row.user_id),
      userName: clean(row.user_name),
      changeSummary: clean(row.change_summary),
      processes,
      createdAt: toIso(row.created_at),
      changeType: clean(change.type, ""),
      entityId: clean(change.entityId, ""),
      operation: clean(change.operation, "")
    };
  }

  async function overview() {
    const [projects, events, locks, presence] = await Promise.all([listProjectsRaw(), listEventsRaw(2000), listLocksRaw(), listPresenceRaw()]);
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const eventsPublic = events.map(eventToPublic);
    const projectsPublic = projects.map(row => {
      const summary = snapshotSummary(parseJson(row.snapshot_json));
      const eventCount = eventsPublic.filter(event => event.projectId === row.id).length;
      const lastEvent = eventsPublic.find(event => event.projectId === row.id);
      return {
        id: clean(row.id),
        workspaceId: clean(row.workspace_id),
        revision: Number(row.revision) || 0,
        updatedBy: clean(row.updated_by),
        updatedByName: clean(row.updated_by_name),
        updatedAt: toIso(row.updated_at),
        ...summary,
        eventCount,
        lastEventSummary: lastEvent ? lastEvent.changeSummary : "",
        lastEventAt: lastEvent ? lastEvent.createdAt : toIso(row.updated_at)
      };
    });

    const dailyMap = new Map();
    const processMap = new Map();
    const todayKey = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
    let events24h = 0;
    let events7d = 0;
    for (const event of eventsPublic) {
      const t = new Date(event.createdAt).getTime();
      if (!Number.isFinite(t)) continue;
      if (now - t <= dayMs) events24h += 1;
      if (now - t <= 7 * dayMs) events7d += 1;
      const d = new Date(t);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      dailyMap.set(key, (dailyMap.get(key) || 0) + 1);
      for (const process of event.processes) {
        processMap.set(process, (processMap.get(process) || 0) + 1);
      }
    }
    const daily = [...dailyMap.entries()]
      .sort((a, b) => a[0] < b[0] ? -1 : 1)
      .slice(-30)
      .map(([date, count]) => ({ date, count }));
    const processDist = [...processMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([process, count]) => ({ process, count }));

    const activeLocks = locks.map(lock => ({
      id: clean(lock.id),
      projectId: clean(lock.project_id),
      resourceId: clean(lock.resource_id),
      kind: clean(lock.kind),
      label: clean(lock.label),
      process: clean(lock.process),
      affectedProcesses: Array.isArray(parseJson(lock.affected_processes_json, [])) ? parseJson(lock.affected_processes_json, []) : [],
      userId: clean(lock.user_id),
      userName: clean(lock.user_name),
      acquiredAt: toIso(lock.acquired_at),
      expiresAt: toIso(lock.expires_at)
    }));
    const online = presence.map(row => ({
      projectId: clean(row.project_id),
      userId: clean(row.user_id),
      userName: clean(row.user_name),
      projectName: clean(row.project_name),
      phase: clean(row.phase),
      status: clean(row.status),
      lastSeen: toIso(row.last_seen)
    }));

    const modified24h = projectsPublic.filter(project => {
      const t = new Date(project.updatedAt).getTime();
      return Number.isFinite(t) && now - t <= dayMs;
    });
    const pendingAi = projectsPublic.flatMap(project => {
      const snapshot = parseJson(projects.find(row => row.id === project.id)?.snapshot_json);
      const assessments = Array.isArray(snapshot.assessments) ? snapshot.assessments : [];
      return assessments
        .filter(item => item && item.aiCandidateRating !== undefined && item.aiCandidateRating !== null && String(item.aiCandidateRating) !== "" && item.reviewed !== true)
        .slice(0, 5)
        .map(item => ({
          projectId: project.id,
          projectName: project.name,
          id: clean(item.id, ""),
          code: clean(item.code, ""),
          title: clean(item.title, ""),
          process: clean(item.process, ""),
          aiCandidateRating: clean(item.aiCandidateRating, "")
        }));
    }).slice(0, 20);

    const stats = {
      projects: projectsPublic.length,
      events: eventsPublic.length,
      events24h,
      events7d,
      activeLocks: activeLocks.length,
      onlineUsers: new Set(online.map(item => item.userId)).size,
      aiAssessed: projectsPublic.reduce((sum, p) => sum + p.aiAssessed, 0),
      reviewed: projectsPublic.reduce((sum, p) => sum + p.reviewed, 0),
      pendingAi: projectsPublic.reduce((sum, p) => sum + p.pendingAi, 0),
      traceLinks: projectsPublic.reduce((sum, p) => sum + p.traceLinkCount, 0),
      confirmedLinks: projectsPublic.reduce((sum, p) => sum + p.confirmedLinks, 0),
      evidence: projectsPublic.reduce((sum, p) => sum + p.evidenceCount, 0)
    };

    const topProjects = [...projectsPublic]
      .sort((a, b) => b.eventCount - a.eventCount)
      .slice(0, 8)
      .map(p => ({ id: p.id, name: p.name, eventCount: p.eventCount }));

    return {
      generatedAt: new Date().toISOString(),
      todayKey,
      stats,
      daily,
      processDist,
      topProjects,
      today: {
        locks: activeLocks,
        online,
        modified24h: modified24h.map(p => ({ id: p.id, name: p.name, updatedByName: p.updatedByName, updatedAt: p.updatedAt, revision: p.revision })),
        pendingAi
      }
    };
  }

  async function projects() {
    const rows = await listProjectsRaw();
    return rows.map(row => {
      const summary = snapshotSummary(parseJson(row.snapshot_json));
      return {
        id: clean(row.id),
        workspaceId: clean(row.workspace_id),
        revision: Number(row.revision) || 0,
        updatedBy: clean(row.updated_by),
        updatedByName: clean(row.updated_by_name),
        updatedAt: toIso(row.updated_at),
        ...summary
      };
    });
  }

  async function project(projectId) {
    const [rows] = await pool.query("select id, workspace_id, snapshot_json, revision, owner_id, updated_by, updated_by_name, updated_at from auditflow_projects where id=? limit 1", [projectId]);
    if (!rows.length) return null;
    const row = rows[0];
    const snapshot = parseJson(row.snapshot_json);
    const [eventRows] = await pool.query(
      "select id, project_id, revision, user_id, user_name, change_summary, processes_json, change_json, created_at from auditflow_project_events where project_id=? order by created_at desc limit 300",
      [projectId]
    );
    const [lockRows] = await pool.query(
      "select id, project_id, resource_id, kind, label, process, affected_processes_json, user_id, user_name, acquired_at, expires_at from auditflow_project_locks where project_id=? and expires_at > utc_timestamp(3) order by acquired_at desc",
      [projectId]
    );
    const [presenceRows] = await pool.query(
      "select project_id, user_id, user_name, project_name, phase, status, last_seen, expires_at from auditflow_project_presence where project_id=? and expires_at > utc_timestamp(3) order by last_seen desc",
      [projectId]
    );
    return {
      id: clean(row.id),
      workspaceId: clean(row.workspace_id),
      revision: Number(row.revision) || 0,
      ownerId: clean(row.owner_id),
      updatedBy: clean(row.updated_by),
      updatedByName: clean(row.updated_by_name),
      updatedAt: toIso(row.updated_at),
      ...snapshotSummary(snapshot),
      events: eventRows.map(eventToPublic),
      locks: lockRows.map(lock => ({
        id: clean(lock.id),
        resourceId: clean(lock.resource_id),
        kind: clean(lock.kind),
        label: clean(lock.label),
        process: clean(lock.process),
        userId: clean(lock.user_id),
        userName: clean(lock.user_name),
        acquiredAt: toIso(lock.acquired_at),
        expiresAt: toIso(lock.expires_at)
      })),
      presence: presenceRows.map(row => ({
        userId: clean(row.user_id),
        userName: clean(row.user_name),
        phase: clean(row.phase),
        status: clean(row.status),
        lastSeen: toIso(row.last_seen)
      })),
      assessments: minimalAssessments(snapshot),
      traceLinks: minimalTraceLinks(snapshot),
      evidence: minimalEvidence(snapshot),
      processes: Array.isArray(snapshot.processes) ? snapshot.processes.slice(0, 50).map(p => isPlainObject(p) ? clean(p.id || p.name || p.code, "") : clean(p)) : [],
      aiOpinion: clean(snapshot.aiOpinion, "")
    };
  }

  async function events({ limit = 500, projectId = "" } = {}) {
    let rows;
    if (projectId) {
      [rows] = await pool.query(
        "select id, project_id, revision, user_id, user_name, change_summary, processes_json, change_json, created_at from auditflow_project_events where project_id=? order by created_at desc limit ?",
        [projectId, Math.min(1000, Math.max(1, Number(limit) || 500))]
      );
    } else {
      rows = await listEventsRaw(limit);
    }
    return rows.map(eventToPublic);
  }

  async function traceEval() {
    const rows = await listProjectsRaw();
    return rows.map(row => {
      const snapshot = parseJson(row.snapshot_json);
      const summary = snapshotSummary(snapshot);
      const assessments = Array.isArray(snapshot.assessments) ? snapshot.assessments : [];
      const indicators = new Map();
      for (const assessment of assessments) {
        const key = clean(assessment.code || assessment.id || assessment.title, "");
        if (!key) continue;
        const record = indicators.get(key) || { key, process: clean(assessment.process, ""), pa: clean(assessment.pa, ""), title: clean(assessment.title, ""), rating: clean(assessment.rating, ""), aiCandidateRating: clean(assessment.aiCandidateRating, ""), reviewed: assessment.reviewed === true, evidenceLinks: 0 };
        const analysis = Array.isArray(assessment.evidenceAnalysis) ? assessment.evidenceAnalysis : [];
        record.evidenceLinks += analysis.length;
        indicators.set(key, record);
      }
      return {
        id: clean(row.id),
        name: summary.name,
        updatedAt: toIso(row.updated_at),
        aiAssessed: summary.aiAssessed,
        reviewed: summary.reviewed,
        pendingAi: summary.pendingAi,
        traceLinkCount: summary.traceLinkCount,
        aiInferredLinks: summary.aiInferredLinks,
        confirmedLinks: summary.confirmedLinks,
        evidenceCount: summary.evidenceCount,
        aiOpinion: summary.aiOpinion,
        indicators: [...indicators.values()].slice(0, 100)
      };
    });
  }

  async function close() {
    await pool.end();
  }

  return { provider: "MySQL", health, overview, projects, project, events, traceEval, close };
}

/* ------------------------------------------------------------------ */
/* HTTP 服务                                                           */
/* ------------------------------------------------------------------ */
export function createMonitorServer({ store, htmlPath, token = "", allowedOrigin = "", host = "127.0.0.1", port = 4175 } = {}) {
  if (!store) throw new Error("A monitor store is required");
  const htmlFile = htmlPath && existsSync(htmlPath) ? htmlPath : path.join(currentDir, "monitor.html");
  let htmlCache = "";

  function corsHeaders(response) {
    const origin = String(response?.monitorOrigin || "");
    const allowed = allowedOrigin && origin === allowedOrigin ? origin : "";
    return {
      ...(allowed ? { "access-control-allow-origin": allowed, "access-control-allow-credentials": "true" } : {}),
      "access-control-allow-headers": "content-type, x-monitor-token",
      "access-control-allow-methods": "GET, OPTIONS",
      "cache-control": "no-store"
    };
  }

  function authorized(request) {
    if (!token) return true;
    const supplied = String(request.headers["x-monitor-token"] || new URL(request.url, `http://${request.headers.host || "localhost"}`).searchParams.get("token") || "");
    return supplied === token;
  }

  function sendJson(response, status, value) {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...corsHeaders(response) });
    response.end(JSON.stringify(value));
  }

  async function sendHtml(response) {
    if (!htmlCache) {
      try {
        htmlCache = await readFile(htmlFile, "utf8");
      } catch (error) {
        sendJson(response, 500, { error: `monitor.html not found at ${htmlFile}` });
        return;
      }
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", ...corsHeaders(response) });
    response.end(htmlCache);
  }

  function guard(request, response) {
    if (!authorized(request)) {
      sendJson(response, 401, { error: "缺少或错误的监控令牌（AUDITFLOW_MONITOR_TOKEN）" });
      return false;
    }
    return true;
  }

  async function safeHandle(fn, response) {
    try {
      await fn();
    } catch (error) {
      sendJson(response, Number(error.status || 500), { error: error.message || "Internal monitor error" });
    }
  }

  const server = http.createServer(async (request, response) => {
    response.monitorOrigin = String(request.headers.origin || "");
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders(request));
      response.end();
      return;
    }
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const routePath = url.pathname;

    if (request.method === "GET" && routePath === "/") {
      await sendHtml(response);
      return;
    }
    if (request.method === "GET" && routePath === "/api/monitor/health") {
      if (!guard(request, response)) return;
      await safeHandle(async () => {
        const result = await store.health();
        sendJson(response, 200, { ok: true, service: "auditflow-monitor", version: VERSION, ...result, time: new Date().toISOString() });
      }, response);
      return;
    }
    if (request.method === "GET" && routePath === "/api/monitor/overview") {
      if (!guard(request, response)) return;
      await safeHandle(async () => sendJson(response, 200, await store.overview()), response);
      return;
    }
    if (request.method === "GET" && routePath === "/api/monitor/projects") {
      if (!guard(request, response)) return;
      await safeHandle(async () => sendJson(response, 200, { projects: await store.projects() }), response);
      return;
    }
    const projectMatch = routePath.match(/^\/api\/monitor\/projects\/([^/]+)$/);
    if (request.method === "GET" && projectMatch) {
      if (!guard(request, response)) return;
      const projectId = decodeURIComponent(projectMatch[1]);
      await safeHandle(async () => {
        const result = await store.project(projectId);
        if (!result) { sendJson(response, 404, { error: "Project not found" }); return; }
        sendJson(response, 200, { project: result });
      }, response);
      return;
    }
    if (request.method === "GET" && routePath === "/api/monitor/events") {
      if (!guard(request, response)) return;
      const limit = Number(url.searchParams.get("limit") || 500);
      const projectId = String(url.searchParams.get("projectId") || "");
      await safeHandle(async () => sendJson(response, 200, { events: await store.events({ limit, projectId }) }), response);
      return;
    }
    if (request.method === "GET" && routePath === "/api/monitor/trace-eval") {
      if (!guard(request, response)) return;
      await safeHandle(async () => sendJson(response, 200, { projects: await store.traceEval() }), response);
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  });

  return {
    server,
    listen(callback) {
      server.listen(port, host, callback);
    },
    close() {
      server.close();
    }
  };
}

/* ------------------------------------------------------------------ */
/* CLI 入口                                                            */
/* ------------------------------------------------------------------ */
function parseEnv() {
  return {
    mysqlUrl: String(process.env.AUDITFLOW_MYSQL_URL || "").trim(),
    port: Number(process.env.AUDITFLOW_MONITOR_PORT || 4175),
    host: String(process.env.AUDITFLOW_MONITOR_HOST || "127.0.0.1").trim(),
    token: String(process.env.AUDITFLOW_MONITOR_TOKEN || "").trim(),
    allowedOrigin: String(process.env.AUDITFLOW_MONITOR_ALLOWED_ORIGIN || "").trim(),
    htmlPath: String(process.env.AUDITFLOW_MONITOR_HTML || "").trim()
  };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const env = parseEnv();
  if (!env.mysqlUrl) {
    console.error("缺少 AUDITFLOW_MYSQL_URL（如 mysql://user:pass@127.0.0.1:3306/auditflow）");
    process.exit(1);
  }
  const store = createMysqlMonitorStore({ url: env.mysqlUrl });
  const service = createMonitorServer({ store, htmlPath: env.htmlPath, token: env.token, allowedOrigin: env.allowedOrigin, host: env.host, port: env.port });
  service.listen(() => {
    console.log(`AuditFlow Monitor v${VERSION} running at http://${env.host}:${env.port}/`);
    console.log(`MySQL: configured${env.token ? " · token auth: enabled" : " · WARNING: no token configured (bind 127.0.0.1 only)"}`);
  });
  const shutdown = async () => {
    try { await store.close(); } catch (_) { /* noop */ }
    service.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
