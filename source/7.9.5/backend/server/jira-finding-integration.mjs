import crypto from "node:crypto";
import { authorize, fault, JIRA_EVIDENCE_AUTHORITY } from "./collaboration-model.mjs";
import { buildJiraRestFields, jiraRestSourceMarker, normalizeJiraRestIssue } from "./jira-rest-channel.mjs";

const issueFields = "summary,description,status,project,labels,updated,assignee,duedate";
const keyPattern = /^[A-Z][A-Z0-9_]{0,63}$/;
const labelFor = (projectId, findingId) => `auditflow-${crypto.createHash("sha256").update(JSON.stringify([projectId, findingId])).digest("hex").slice(0, 32)}`;
const html = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

export function createJiraFindingIntegration({ store, clientFor, resolveFinding, draftFor, requireLead, originFor, readBody, sendJson, sendText, env = process.env }) {
  const pending = new Map();
  const recoverableKeys = new Map();
  async function context(projectId, identity, { lead = true } = {}) {
    const entry = await store.project(projectId);
    if (!entry) throw fault("Project not found", 404);
    if (lead) requireLead(entry, identity);
    else authorize(entry, identity);
    return { entry, client: clientFor(identity) };
  }
  function permittedProject(key) {
    const projectKey = String(key || "").toUpperCase();
    const allowlist = String(env.AUDITFLOW_JIRA_PROJECT_KEYS || "").split(",").map(value => value.trim().toUpperCase()).filter(Boolean);
    if (!keyPattern.test(projectKey) || allowlist.length && !allowlist.includes(projectKey)) {
      throw fault("Choose an allowed Jira project key", 403, { code: "jira_project_not_allowed" });
    }
    return projectKey;
  }
  async function preview(projectId, findingId, projectKey, identity, request) {
    const { entry, client } = await context(projectId, identity);
    const { process } = resolveFinding(entry.snapshot || {}, findingId);
    authorize(entry, identity, { use: true, processes: [process] });
    const key = permittedProject(projectKey || entry.snapshot?.jiraMapping?.key);
    const project = await client.request(`/rest/api/2/project/${encodeURIComponent(key)}`);
    if (String(project?.key || "").toUpperCase() !== key) throw fault("Jira project readback mismatch", 502);
    const issueTypes = (Array.isArray(project.issueTypes) ? project.issueTypes : [])
      .filter(item => !item.subtask && /^\d{1,20}$/.test(String(item.id)))
      .map(item => ({ id: String(item.id), name: String(item.name || "").slice(0, 100) }));
    if (!issueTypes.length) throw fault("The Jira project has no available standard issue type", 409);
    const draft = { ...draftFor(projectId, entry.snapshot || {}, findingId, key, originFor(request)), assessmentId: projectId };
    return { project: { projectId, projectKey: key, name: String(project.name || key) }, issueTypes, expectedRevision: entry.revision, preview: draft };
  }
  async function attach(projectId, findingId, entry, identity, issue, draft) {
    return store.applyJiraEvidence(projectId, {
      authority: JIRA_EVIDENCE_AUTHORITY,
      expectedRevision: entry.revision,
      jiraProjectId: projectId,
      jiraProjectKey: issue.projectKey,
      issueKey: issue.key,
      issueSummary: issue.summary,
      issueDescription: issue.description,
      issueStatus: issue.status,
      issueRevision: issue.revision,
      issueUrl: `/api/jira-findings/${encodeURIComponent(projectId)}/${encodeURIComponent(issue.key)}`,
      sourceIssueId: findingId,
      targetRecordId: findingId,
      process: draft.process,
      indicator: draft.indicators.find(value => value.startsWith(`${draft.process}.`))
    }, identity);
  }
  async function create(projectId, findingId, identity, body, request) {
    const allowed = ["expectedRevision", "confirmed", "projectKey", "issueTypeId", "assigneeName"];
    if (Object.keys(body).some(key => !allowed.includes(key)) || body.confirmed !== true) {
      throw fault("Preview and explicitly confirm the Jira issue fields before creation", 400);
    }
    const prepared = await preview(projectId, findingId, body.projectKey, identity, request);
    if (body.expectedRevision !== prepared.expectedRevision) throw fault("Assessment changed after preview; reload before retrying", 409);
    const issueTypeId = String(body.issueTypeId || "");
    if (!prepared.issueTypes.some(item => item.id === issueTypeId)) throw fault("Choose an issue type available in the selected Jira project", 400);
    const { entry, client } = await context(projectId, identity);
    if (entry.revision !== prepared.expectedRevision) throw fault("Assessment changed after preview; reload before retrying", 409);
    const draft = prepared.preview;
    const projectKey = prepared.project.projectKey;
    const label = labelFor(projectId, findingId);
    const sourceMarker = jiraRestSourceMarker(draft);
    const recoveryId = JSON.stringify([projectId, findingId, projectKey]);
    for (const [key, value] of recoverableKeys) if (value.expiresAt <= Date.now()) recoverableKeys.delete(key);
    const recoveredKey = recoverableKeys.get(recoveryId)?.key;
    const query = new URLSearchParams({ jql: `project = "${projectKey}" AND labels = "${label}"`, maxResults: "2", fields: issueFields });
    const found = await client.request(`/rest/api/2/search?${query}`);
    if (!Array.isArray(found.issues) || !Number.isSafeInteger(found.total) || found.total < 0 || found.total > 1 || found.issues.length !== found.total) {
      throw fault("Jira source mapping is ambiguous; review the matching issues before retrying", 409);
    }
    if (recoveredKey && found.issues[0]?.key && found.issues[0].key !== recoveredKey) {
      throw fault("Jira source mapping changed after creation; review the matching issues", 409);
    }
    let issueKey = found.issues[0]?.key || recoveredKey;
    let outcome = "linked";
    if (!issueKey) {
      let assigneeName = String(body.assigneeName || "").trim();
      if (assigneeName) {
        if (assigneeName.length > 191 || /[\r\n\x00]/.test(assigneeName)) throw fault("Invalid Jira assignee login", 400);
        const assigneeQuery = new URLSearchParams({ project: projectKey, username: assigneeName, maxResults: "50" });
        const users = await client.request(`/rest/api/2/user/assignable/search?${assigneeQuery}`);
        if (!Array.isArray(users) || !users.some(user => user.name === assigneeName && user.active === true)) {
          throw fault("The Jira login is not assignable in the selected project", 400);
        }
      }
      const fields = buildJiraRestFields(draft, { projectKey, issueTypeId, assigneeName, label });
      const created = await client.request("/rest/api/2/issue", { method: "POST", body: { fields } });
      issueKey = String(created.key || "");
      outcome = "created";
    }
    if (!new RegExp(`^${projectKey}-\\d{1,12}$`).test(String(issueKey))) throw fault("Jira returned an invalid issue key", 502);
    // Jira's search index can lag a successful create; retries still verify the exact issue.
    if (!recoverableKeys.has(recoveryId) && recoverableKeys.size >= 1000) recoverableKeys.delete(recoverableKeys.keys().next().value);
    recoverableKeys.set(recoveryId, { key: issueKey, expiresAt: Date.now() + 5 * 60 * 1000 });
    const readback = await client.request(`/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=${issueFields}`);
    const issue = normalizeJiraRestIssue(readback, { projectKey, label, sourceMarker });
    const latest = await store.project(projectId);
    const currentFinding = resolveFinding(latest?.snapshot || {}, findingId);
    authorize(latest, identity, { use: true, processes: [currentFinding.process] });
    // A created issue remains recoverable through its source label after a stale-write conflict.
    if (latest.revision !== entry.revision) throw fault("Issue exists in Jira; reload the assessment and retry to link it", 409);
    const linked = await attach(projectId, findingId, latest, identity, issue, draft);
    return { project: prepared.project, issue: { key: issue.key, summary: issue.summary, status: issue.status, url: linked.evidence.issueUrl }, evidence: linked.evidence, outcome, duplicate: linked.duplicate, formalRatingChanged: false, formalClosureChanged: false, assessorConfirmationRequired: true };
  }
  return {
    async handle(request, response, url, identity) {
      const options = /^\/api\/integrations\/jira\/projects\/([^/]+)\/options$/.exec(url.pathname);
      const finding = /^\/api\/integrations\/jira\/projects\/([^/]+)\/assessment-findings\/([^/]+)\/(preview|issue)$/.exec(url.pathname);
      const sync = /^\/api\/integrations\/jira\/projects\/([^/]+)\/sync$/.exec(url.pathname);
      const detail = /^\/api\/jira-findings\/([^/]+)\/([A-Z][A-Z0-9_]*-\d{1,12})$/.exec(url.pathname);
      if (!options && !finding && !sync && !detail) return false;
      if (options && request.method === "GET") {
        const { client } = await context(decodeURIComponent(options[1]), identity);
        const result = await client.request("/rest/api/2/project");
        const projects = (Array.isArray(result) ? result : []).slice(0, 500).flatMap(item => {
          try { return [{ key: permittedProject(item.key), name: String(item.name || item.key).slice(0, 300) }]; } catch { return []; }
        });
        sendJson(response, 200, { projects });
      } else if (finding && finding[3] === "preview" && request.method === "GET") {
        sendJson(response, 200, await preview(decodeURIComponent(finding[1]), decodeURIComponent(finding[2]), url.searchParams.get("projectKey"), identity, request));
      } else if (finding && finding[3] === "issue" && request.method === "POST") {
        const projectId = decodeURIComponent(finding[1]), findingId = decodeURIComponent(finding[2]);
        const body = await readBody(request);
        const key = JSON.stringify([projectId, findingId]);
        if (pending.has(key)) throw fault("Jira creation is already in progress for this finding", 409);
        const operation = create(projectId, findingId, identity, body, request);
        pending.set(key, operation);
        try { sendJson(response, 200, await operation); } finally { pending.delete(key); }
      } else if (sync && request.method === "POST") {
        const body = await readBody(request);
        if (Object.keys(body).length) throw fault("Jira synchronization reads only persisted issue links", 400);
        const projectId = decodeURIComponent(sync[1]);
        const { entry, client } = await context(projectId, identity, { lead: false });
        let updated = 0;
        const links = (entry.snapshot?.evidence || []).filter(item => item.sourceKind === "jira-assessment-finding");
        for (const link of links) {
          const current = await store.project(projectId);
          const member = authorize(current, identity);
          if (member.permissions?.use !== true || !member.processScopes.includes("*") && !member.processScopes.includes(link.primaryProcess)) continue;
          const draft = { ...draftFor(projectId, current.snapshot, link.findingRecordId, link.jiraProjectKey, originFor(request)), assessmentId: projectId };
          const issue = normalizeJiraRestIssue(await client.request(`/rest/api/2/issue/${encodeURIComponent(link.issueKey)}?fields=${issueFields}`), {
            projectKey: permittedProject(link.jiraProjectKey), label: labelFor(projectId, link.findingRecordId), sourceMarker: jiraRestSourceMarker(draft)
          });
          const result = await attach(projectId, link.findingRecordId, current, identity, issue, draft);
          if (!result.duplicate) updated++;
        }
        sendJson(response, 200, { updated, formalRatingChanged: false, formalClosureChanged: false });
      } else if (detail && request.method === "GET") {
        const projectId = decodeURIComponent(detail[1]), issueKey = detail[2];
        const { entry, client } = await context(projectId, identity, { lead: false });
        const link = (entry.snapshot?.evidence || []).find(item => item.sourceKind === "jira-assessment-finding" && item.issueKey === issueKey);
        if (!link) throw fault("Jira issue is not linked to this project", 404);
        const member = authorize(entry, identity);
        if (!member.processScopes.includes("*") && !member.processScopes.includes(link.primaryProcess)) {
          throw fault("Process permission denied", 403);
        }
        const draft = { assessmentId: projectId, findingId: link.findingRecordId };
        const issue = normalizeJiraRestIssue(await client.request(`/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=${issueFields}`), {
          projectKey: permittedProject(link.jiraProjectKey), label: labelFor(projectId, link.findingRecordId), sourceMarker: jiraRestSourceMarker(draft)
        });
        sendText(response, 200, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(issueKey)} · Jira</title><style>body{max-width:900px;margin:32px auto;padding:0 20px;font:15px/1.6 Arial;color:#263238}h1{font-size:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}</style><h1>${html(issueKey)} · ${html(issue.summary)}</h1><p>${html(issue.status)} · ${html(issue.assigneeName || "Unassigned")} · ${html(issue.dueDate || "No due date")}</p><pre>${html(issue.description)}</pre></html>`, "text/html; charset=utf-8");
      } else throw fault("Method not allowed", 405);
      return true;
    }
  };
}
