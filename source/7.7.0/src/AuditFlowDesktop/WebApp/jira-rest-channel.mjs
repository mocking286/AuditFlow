import http from "node:http";

const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const projectPattern = /^[A-Z][A-Z0-9_]{0,39}$/;
const issuePattern = /^[A-Z][A-Z0-9_]{0,39}-[1-9]\d*$/;
const idPattern = /^\d{1,30}$/;
const labelPattern = /^[A-Za-z0-9_-]{1,255}$/;
const fault = (message, code, status = 502, extra = {}) => Object.assign(new Error(message), { code, status, ...extra });
const text = (value, limit) => String(value ?? "").trim().slice(0, limit);

export function isAllowedJiraRestRequest(path, method = "GET") {
  if (typeof path !== "string" || path.length > 8192 || !path.startsWith("/") || /[\s\\#]/.test(path)) return false;
  let parsed;
  try { parsed = new URL(path, "http://127.0.0.1"); } catch { return false; }
  if (parsed.origin !== "http://127.0.0.1" || parsed.pathname !== path.split("?")[0] || parsed.pathname.includes("%")) return false;
  const verb = String(method).toUpperCase();
  if (verb === "POST") return parsed.pathname === "/rest/api/2/issue" && !parsed.search;
  if (verb !== "GET") return false;
  if (parsed.pathname === "/rest/api/2/user/assignable/search") {
    const allowed = new Set(["project", "username", "startAt", "maxResults"]);
    for (const key of parsed.searchParams.keys()) if (!allowed.has(key) || parsed.searchParams.getAll(key).length !== 1) return false;
    const startAt = parsed.searchParams.get("startAt") || "0";
    const maxResults = parsed.searchParams.get("maxResults") || "50";
    const username = parsed.searchParams.get("username") || "";
    return projectPattern.test(parsed.searchParams.get("project") || "")
      && username.length > 0 && username.length <= 200 && !/[\r\n\0]/.test(username)
      && /^\d+$/.test(startAt) && Number(startAt) <= 10000
      && /^\d+$/.test(maxResults) && Number(maxResults) >= 1 && Number(maxResults) <= 100;
  }
  return /^\/rest\/api\/2\/(?:project|issuetype|priority|search)$/.test(parsed.pathname)
    || /^\/rest\/api\/2\/project\/[A-Z][A-Z0-9_]{0,39}$/.test(parsed.pathname)
    || /^\/rest\/api\/2\/issue\/[A-Z][A-Z0-9_]{0,39}-[1-9]\d*$/.test(parsed.pathname);
}

export function createJiraRestClient({ env = process.env, relay = null } = {}) {
  const port = Number(env.AUDITFLOW_JIRA_PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw fault("Jira REST port is invalid", "jira_config_invalid", 503);
  const pat = String(env.AUDITFLOW_JIRA_PAT || "").trim();
  const username = String(env.AUDITFLOW_JIRA_USERNAME || "").trim();
  const password = String(env.AUDITFLOW_JIRA_PASSWORD || "");
  if (/[^\x21-\x7e]/.test(pat) || /[:\r\n\0]/.test(username) || password.includes("\0")) {
    throw fault("Jira REST credentials are invalid", "jira_config_invalid", 503);
  }
  const authorization = pat ? `Bearer ${pat}` : username && password ? `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` : "";
  const authConfigured = Boolean(authorization);
  const allowedProjects = new Set(String(env.AUDITFLOW_JIRA_PROJECT_KEYS || "").split(",").map(value => value.trim().toUpperCase()).filter(Boolean));
  if ([...allowedProjects].some(key => !projectPattern.test(key))) throw fault("Jira REST project allowlist is invalid", "jira_config_invalid", 503);

  function assertProjectAccess(path, verb, body) {
    if (!allowedProjects.size) return;
    const url = new URL(path, "http://127.0.0.1");
    let projectKey;
    const project = /^\/rest\/api\/2\/project\/([A-Z][A-Z0-9_]{0,39})$/.exec(url.pathname);
    const issue = /^\/rest\/api\/2\/issue\/([A-Z][A-Z0-9_]{0,39})-[1-9]\d*$/.exec(url.pathname);
    if (project) projectKey = project[1];
    else if (issue) projectKey = issue[1];
    else if (verb === "POST") projectKey = String(body?.fields?.project?.key || "");
    else if (url.pathname === "/rest/api/2/user/assignable/search") projectKey = url.searchParams.get("project");
    else if (url.pathname === "/rest/api/2/search") {
      const query = /^project = "([A-Z][A-Z0-9_]{0,39})" AND labels = "([A-Za-z0-9_-]{1,255})"$/.exec(url.searchParams.get("jql") || "");
      projectKey = query?.[1] || "";
    } else return;
    if (!allowedProjects.has(projectKey)) throw fault("Jira project is not allowed by the local connector", "jira_project_not_allowed", 403);
  }
  const filteredResult = (path, result) => allowedProjects.size && new URL(path, "http://127.0.0.1").pathname === "/rest/api/2/project" && Array.isArray(result)
    ? result.filter(item => allowedProjects.has(String(item?.key || "").toUpperCase()))
    : result;

  async function request(path, { method = "GET", body } = {}) {
    const verb = String(method).toUpperCase();
    if (!isAllowedJiraRestRequest(path, verb)) throw fault("Jira REST route is not allowed", "jira_route_denied", 400);
    assertProjectAccess(path, verb, body);
    if (verb === "GET" && body !== undefined) throw fault("Jira GET requests cannot contain a body", "jira_request_invalid", 400);
    let serialized;
    try { serialized = body === undefined ? undefined : JSON.stringify(body); } catch { throw fault("Jira REST request body is invalid", "jira_request_invalid", 400); }
    if (serialized !== undefined && Buffer.byteLength(serialized) > MAX_BYTES) throw fault("Jira REST request body is too large", "jira_request_too_large", 413);
    if (relay) {
      let result;
      let timer;
      try {
        result = await Promise.race([
          relay(path, { method: verb, ...(body === undefined ? {} : { body }) }),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(fault("Jira REST relay request timed out", "jira_request_timeout", 504)), TIMEOUT_MS);
            timer.unref?.();
          })
        ]);
      } catch (error) {
        if (error?.code === "jira_request_timeout") throw error;
        throw fault("Jira REST relay request failed", "jira_relay_unavailable");
      } finally { clearTimeout(timer); }
      let size;
      try { size = Buffer.byteLength(JSON.stringify(result)); } catch { throw fault("Jira REST relay response is invalid", "jira_response_invalid"); }
      if (size > MAX_BYTES) throw fault("Jira REST response is too large", "jira_response_too_large");
      return filteredResult(path, result);
    }
    if (!authorization) throw fault("Local Jira REST credentials are not configured", "jira_not_configured", 503);
    return new Promise((resolve, reject) => {
      let complete = false;
      const finish = (error, value) => {
        if (complete) return;
        complete = true;
        clearTimeout(timer);
        error ? reject(error) : resolve(value);
      };
      const outgoing = http.request({
        hostname: "127.0.0.1",
        port,
        path,
        method: verb,
        headers: {
          accept: "application/json",
          authorization,
          ...(serialized === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(serialized) })
        }
      }, incoming => {
        let bytes = 0;
        const chunks = [];
        incoming.on("data", chunk => {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) {
            finish(fault("Jira REST response is too large", "jira_response_too_large"));
            incoming.destroy();
            outgoing.destroy();
          } else chunks.push(chunk);
        });
        incoming.on("error", () => finish(fault("Jira REST response was interrupted", "jira_response_incomplete")));
        incoming.on("end", () => {
          const upstreamStatus = Number(incoming.statusCode || 0);
          if (upstreamStatus < 200 || upstreamStatus >= 300) {
            finish(fault("Jira REST rejected the request", "jira_api_rejected", 502, { upstreamStatus }));
            return;
          }
          try {
            const raw = Buffer.concat(chunks).toString("utf8");
            finish(null, filteredResult(path, raw ? JSON.parse(raw) : {}));
          } catch { finish(fault("Jira REST response is invalid", "jira_response_invalid")); }
        });
      });
      const timer = setTimeout(() => {
        finish(fault("Jira REST request timed out", "jira_request_timeout", 504));
        outgoing.destroy();
      }, TIMEOUT_MS);
      timer.unref?.();
      outgoing.on("error", () => finish(fault("Local Jira REST is unavailable", "jira_unavailable", 503)));
      if (serialized !== undefined) outgoing.write(serialized);
      outgoing.end();
    });
  }

  return Object.freeze({ configured: Boolean(relay || authConfigured), authConfigured, transport: "jira-rest-v2", request });
}

export function jiraRestSourceMarker(draft) {
  const assessmentId = text(draft?.assessmentId, 160);
  const findingId = text(draft?.findingId, 160);
  if (!assessmentId || !findingId) throw fault("Jira finding source identity is missing", "jira_source_invalid", 400);
  return `JEAuditFlow-Source: ${encodeURIComponent(assessmentId)}/${encodeURIComponent(findingId)}`;
}

export function buildJiraRestFields(draft, { projectKey, issueTypeId, priorityId = "", assigneeName = "", label } = {}) {
  const key = text(projectKey, 80).toUpperCase();
  const typeId = text(issueTypeId, 80);
  const priority = text(priorityId, 80);
  const login = text(assigneeName, 255);
  const sourceLabel = text(label, 300);
  if (!projectPattern.test(key) || !idPattern.test(typeId) || priority && !idPattern.test(priority) || !labelPattern.test(sourceLabel)) {
    throw fault("Jira issue field mapping is invalid", "jira_fields_invalid", 400);
  }
  if (login && (/[\r\n\0]/.test(login) || login.length > 200)) throw fault("Jira assignee mapping is invalid", "jira_assignee_invalid", 400);
  const sourceMarker = jiraRestSourceMarker(draft);
  const summary = text(draft?.summary, 255);
  if (!summary) throw fault("Jira issue summary is required", "jira_fields_invalid", 400);
  const dueDate = text(draft?.dueDate, 80);
  const parsedDate = dueDate ? new Date(`${dueDate}T12:00:00Z`) : null;
  if (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dueDate)) {
    throw fault("Jira due date is invalid", "jira_fields_invalid", 400);
  }
  const description = [
    text(draft?.description, 24000),
    `Finding: ${text(draft?.findingId, 160)}`,
    `Process area: ${text(draft?.process, 80)}`,
    `BP/GP: ${(Array.isArray(draft?.indicators) ? draft.indicators : []).map(value => text(value, 80)).join(", ")}`,
    `Severity: ${text(draft?.severity, 80) || "Not rated"}`,
    `AuditFlow owner: ${text(draft?.owner, 300) || "Unassigned"}`,
    `Due date: ${dueDate || "Not set"}`,
    `Assessment: ${text(draft?.assessmentName || draft?.assessmentId, 300)}`,
    `Trace original record: ${text(draft?.traceOriginalRecordUrl, 2000)}`,
    sourceMarker
  ].filter(Boolean).join("\n\n");
  return {
    project: { key },
    issuetype: { id: typeId },
    summary,
    description,
    labels: [sourceLabel],
    ...(priority ? { priority: { id: priority } } : {}),
    ...(login ? { assignee: { name: login } } : {}),
    ...(dueDate ? { duedate: dueDate } : {})
  };
}

export function normalizeJiraRestIssue(issue, { projectKey, label, sourceMarker } = {}) {
  const key = text(issue?.key, 80);
  const expectedKey = text(projectKey, 80).toUpperCase();
  const fields = issue?.fields;
  const description = typeof fields?.description === "string" ? fields.description : "";
  const labels = Array.isArray(fields?.labels) ? fields.labels.filter(value => typeof value === "string") : [];
  const revision = Date.parse(String(fields?.updated || ""));
  if (!projectPattern.test(expectedKey) || !issuePattern.test(key) || !key.startsWith(`${expectedKey}-`)
    || fields?.project?.key !== expectedKey || !labelPattern.test(String(label || "")) || !labels.includes(label)
    || !String(sourceMarker || "").startsWith("JEAuditFlow-Source: ") || !description.split(/\r?\n/).includes(sourceMarker)
    || !Number.isFinite(revision) || revision < 0 || !text(fields?.status?.name, 120)) {
    throw fault("Jira issue did not match the assessment source", "jira_issue_mismatch");
  }
  return {
    key, projectKey: expectedKey, summary: text(fields.summary, 1000), description: description.slice(0, 32000),
    status: text(fields.status.name, 120), statusId: text(fields.status.id, 80),
    updatedAt: new Date(revision).toISOString(), updated: revision, revision, labels,
    assigneeName: text(fields.assignee?.name, 200), dueDate: text(fields.duedate, 80), sourceMarker
  };
}
