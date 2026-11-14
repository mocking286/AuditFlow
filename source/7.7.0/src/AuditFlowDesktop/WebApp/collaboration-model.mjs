import crypto from "node:crypto";
import { applyAssessmentTaskChange, recordAssessmentTaskNotification } from "./assessment-tasks.mjs";

export const MAX_PROJECT_USERS = 15;
export const JIRAFLOW_EVIDENCE_AUTHORITY = Symbol("AuditFlow verified JiraFlow issue creation");
export const JIRA_EVIDENCE_AUTHORITY = Symbol("AuditFlow verified Jira REST issue creation");
// Parsed document text, tables, atomic items, assessment state, and project
// configuration share one revisioned payload. Source attachment binaries stay
// out of this JSON snapshot; a separately authenticated file service owns them.
export const MAX_SHARED_SNAPSHOT_BYTES = 12 * 1024 * 1024;
// The browser reconciles shared project state on this bounded cadence.  Changes
// are also pulled immediately after a successful save, so users normally see a
// result sooner while the idle synchronization promise remains about 3 seconds.
export const POLL_INTERVAL_MS = 3_000;
export const LOCK_TTL_MS = 90_000;
export const PRESENCE_TTL_MS = 120_000;
export const ROLES = ["Lead Assessor", "Assessor", "Viewer"];
export const PERMISSION_SCHEMA_VERSION = 1;
export const PERMISSION_KEYS = Object.freeze(["view", "use", "forms", "remarks", "traceability"]);
// These identities are provisioned as lead assessors by the deployment
// bootstrap. They retain access to every shared project so a newly-created
// project does not become invisible until an administrator adds three rows to
// its project membership table.
export const GLOBAL_LEAD_ASSESSOR_EMAILS = Object.freeze([
  "zoya.logunova@johnsonelectric.com",
  "min.m.zhang@johnsonelectric.com",
  "anne.q.liu@johnsonelectric.com"
]);
export const fault = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const text = (value, max = 240) => String(value ?? "").trim().slice(0, max);
const scopes = values => [...new Set((Array.isArray(values) ? values : []).map(v => text(v, 40)).filter(Boolean))];
const object = value => value && typeof value === "object" && !Array.isArray(value);
const list = value => Array.isArray(value) ? value : [];
const FINDING_TYPES = Object.freeze(["strength", "weakness", "recommendation", "observation", "comment", "question"]);
const TEMPLATE_SCOPES = Object.freeze(["global", "project", "personal"]);
const TEMPLATE_FILE_PATTERN = /\b[\w .()[\]-]+\.(?:pdf|docx?|docm|pptx?|xlsx?|xlsm|csv|json|xml|zip)\b/gi;

function normalizedList(value, max = 80, itemMax = 160) {
  return [...new Set((Array.isArray(value) ? value : String(value || "").split(/[,;\n]/))
    .map(item => text(item, itemMax))
    .filter(Boolean))].slice(0, max);
}

export function normalizeFindingTemplateText(value) {
  const source = text(value, 12000);
  return source
    .replace(TEMPLATE_FILE_PATTERN, "[Work Product]")
    .replace(/\b(?:https?:\/\/|file:\/\/)[^\s)]+/gi, "[Evidence Locator]");
}

export function normalizeFindingTemplate(value = {}, identity = {}, existing = {}) {
  const source = object(value) ? value : {};
  const type = FINDING_TYPES.includes(String(source.type || existing.type)) ? String(source.type || existing.type) : "observation";
  const scope = TEMPLATE_SCOPES.includes(String(source.scope || existing.scope)) ? String(source.scope || existing.scope) : "personal";
  const textValue = normalizeFindingTemplateText(source.text ?? existing.text);
  const placeholders = normalizedList(source.placeholders || [], 30, 120);
  const derivedPlaceholders = [...new Set([
    ...placeholders,
    ...(textValue.match(/\[[^\]]{1,120}\]/g) || []).map(item => item.slice(1, -1))
  ])].slice(0, 30);
  const ownerId = text(source.ownerId || existing.ownerId || identity.userId, 160);
  const ownerName = text(source.ownerName || existing.ownerName || identity.userName, 160);
  const now = new Date().toISOString();
  return {
    id: text(source.id || existing.id || `RT-${crypto.randomUUID()}`, 160),
    name: text(source.name || existing.name || "Untitled finding template", 240),
    type,
    text: textValue,
    indicators: normalizedList(source.indicators ?? existing.indicators, 80, 80),
    processes: normalizedList(source.processes ?? existing.processes, 40, 40),
    evidenceType: text(source.evidenceType || existing.evidenceType || "Work Product", 160),
    scope,
    ownerId,
    ownerName,
    sourceFile: text(source.sourceFile || existing.sourceFile, 255),
    sourceFormat: text(source.sourceFormat || existing.sourceFormat, 40).toLowerCase(),
    sourceKind: text(source.sourceKind || existing.sourceKind || "assessor-authored", 80),
    placeholders: derivedPlaceholders,
    description: text(source.description || existing.description, 1000),
    imported: source.imported === true || existing.imported === true,
    usageCount: Math.max(0, Math.min(1000000, Number(source.usageCount ?? existing.usageCount ?? 0) || 0)),
    createdAt: text(source.createdAt || existing.createdAt || now, 40),
    updatedAt: now
  };
}
export const memberFor = (entry, identity) => entry?.members?.find(m => m.userId === identity?.userId) || null;
export const isGlobalAdmin = identity => identity?.isAdmin === true
  || identity?.account?.isAdmin === true
  || identity?.account?.email?.toLowerCase() === "yumeng.li@johnsonelectric.com";
export const isGlobalLeadAssessor = identity => GLOBAL_LEAD_ASSESSOR_EMAILS.includes(String(identity?.account?.email || identity?.email || "").trim().toLowerCase());
export const canManageProject = (entry, identity) => {
  if (isGlobalAdmin(identity) || isGlobalLeadAssessor(identity) || entry?.ownerId === identity?.userId) return true;
  return memberFor(entry, identity)?.role === "Lead Assessor";
};

export function normalizePermissions(role, value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const editable = role !== "Viewer";
  const permissions = Object.fromEntries(PERMISSION_KEYS.map(key => [key, typeof source[key] === "boolean" ? source[key] : key === "view" ? true : editable]));
  if (role === "Lead Assessor") Object.assign(permissions, { view: true, use: true, forms: true, remarks: true, traceability: true });
  if (role === "Viewer") Object.assign(permissions, { view: permissions.view, use: false, forms: false, remarks: false, traceability: false });
  if (!permissions.view) Object.assign(permissions, { use: false, forms: false, remarks: false, traceability: false });
  if (!permissions.use) Object.assign(permissions, { forms: false, remarks: false, traceability: false });
  return permissions;
}

export function normalizeEntry(entry) {
  if (!entry) return null;
  // Legacy file projects recorded the creator in their first event. Never infer ownership from a role.
  entry.ownerId ||= entry.events?.find(e => e.revision === 1)?.userId || "";
  entry.members = (entry.members || []).map(m => {
    const role = ROLES.includes(m.role) ? m.role : (m.permissions?.use ? "Assessor" : "Viewer");
    return { ...m, role, processScopes: scopes(m.processScopes), permissionVersion: Number(m.permissionVersion) || PERMISSION_SCHEMA_VERSION, permissions: normalizePermissions(role, m.permissions) };
  });
  const owner = entry.members.find(m => m.userId === entry.ownerId);
  if (owner) Object.assign(owner, { role: "Lead Assessor", processScopes: ["*"], permissionVersion: PERMISSION_SCHEMA_VERSION, permissions: normalizePermissions("Lead Assessor") });
  entry.members.forEach(m => {
    if (m.userId !== entry.ownerId && !ROLES.includes(m.role)) m.role = m.permissions.use ? "Assessor" : "Viewer";
    m.permissionVersion = PERMISSION_SCHEMA_VERSION;
    m.permissions = normalizePermissions(m.role, m.permissions);
  });
  entry.locks = (entry.locks || []).filter(l => l.kind !== "project-session" && !l.resourceId.startsWith("project-session:") && Date.parse(l.expiresAt) > Date.now());
  entry.presence = (entry.presence || []).filter(p => Date.parse(p.expiresAt) > Date.now());
  entry.events ||= [];
  return entry;
}

export function authorize(entry, identity, { owner = false, use = false, processes = [] } = {}) {
  if (entry && isGlobalAdmin(identity)) return { userId: identity.userId, role: "Administrator", permissionVersion: PERMISSION_SCHEMA_VERSION, permissions: normalizePermissions("Lead Assessor"), processScopes: ["*"] };
  if (!entry) throw fault("Project not found", 404);
  const member = memberFor(entry, identity)
    || (isGlobalLeadAssessor(identity) ? { userId: identity.userId, name: identity.userName, role: "Lead Assessor", permissionVersion: PERMISSION_SCHEMA_VERSION, processScopes: ["*"], permissions: normalizePermissions("Lead Assessor"), global: true } : null)
    || (entry.ownerId === identity?.userId ? { userId: identity.userId, role: "Lead Assessor", permissionVersion: PERMISSION_SCHEMA_VERSION, processScopes: ["*"], permissions: normalizePermissions("Lead Assessor") } : null);
  if (!member || !member.permissions?.view) throw fault("Project access has not been granted", 403);
  if (owner && !canManageProject(entry, identity)) throw fault("Only a project lead assessor or administrator can administer this project", 403);
  if (use && !member.permissions.use) throw fault("Project use permission denied", 403);
  if (use && entry.ownerId !== identity.userId && !member.processScopes.includes("*")) {
    const denied = scopes(processes).filter(p => !member.processScopes.includes(p));
    if (!processes.length || denied.length) throw fault("Process permission denied", 403, { deniedProcesses: denied });
  }
  return member;
}

function revision(entry, body) {
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) throw fault("expectedRevision must be a nonnegative integer");
  if (body.expectedRevision !== (entry?.revision || 0)) throw fault("Project revision changed; reload before retrying", 409, { code: "revision-conflict", revision: entry?.revision || 0, conflict: true });
}

function event(entry, identity, summary, change, processes = []) {
  entry.revision++;
  entry.updatedBy = identity.userId;
  entry.updatedByName = identity.userName;
  entry.updatedAt = new Date().toISOString();
  const item = { revision: entry.revision, userId: identity.userId, userName: identity.userName, changeSummary: text(summary, 500), processes, ...(change ? { change } : {}), createdAt: entry.updatedAt };
  entry.events = [...entry.events, item].slice(-500);
  return item;
}

function findingRows(snapshot) {
  return [
    ...(Array.isArray(snapshot?.records) ? snapshot.records.map(record => ({ record, collection: "records" })) : []),
    ...(Array.isArray(snapshot?.ncRecords) ? snapshot.ncRecords.map(record => ({ record, collection: "ncRecords" })) : [])
  ];
}

function normalizeJiraFlowIssueUrl(value, issueKey, provider = "jiraflow") {
  const url = text(value, 1000);
  if (!url) return "";
  if (!url.startsWith("/") || url.startsWith("//") || /[\u0000-\u001f\\]/.test(url)) {
    throw fault("JiraFlow issue URL must be a same-origin relative path");
  }
  let parsed;
  try { parsed = new URL(url, "https://auditflow.invalid"); }
  catch { throw fault("Invalid JiraFlow issue URL"); }
  if (parsed.origin !== "https://auditflow.invalid" || parsed.hash) throw fault("JiraFlow issue URL must remain same-origin");
  if (provider === "jiraflow" && /^\/jiraflow\/?$/i.test(parsed.pathname)) {
    if (parsed.search) throw fault("JiraFlow issue URL may not contain query data");
    return `${parsed.pathname}?issueKey=${encodeURIComponent(issueKey)}`;
  }
  const detail = new RegExp(`^/api/${provider}-findings/([A-Za-z0-9][A-Za-z0-9._:-]{0,159})/([A-Za-z][A-Za-z0-9_-]*-\\d{1,12})$`, "i").exec(parsed.pathname);
  if (detail && detail[2].toUpperCase() === issueKey) {
    if (parsed.search) throw fault("JiraFlow issue URL may not contain query data");
    return parsed.pathname;
  }
  throw fault("JiraFlow issue URL must point to a same-origin JiraFlow issue view");
}

function applyJiraFlowEvidence(entry, body, identity, projectId, provider = "jiraflow") {
  const isJira = provider === "jira";
  const service = isJira ? "Jira" : "JiraFlow";
  const field = isJira ? "jira" : "jiraFlow";
  const kind = `${provider}-assessment-finding`;
  if (body.authority !== (isJira ? JIRA_EVIDENCE_AUTHORITY : JIRAFLOW_EVIDENCE_AUTHORITY)) {
    throw fault("JiraFlow evidence can only be attached after verified server-side issue creation", 403);
  }
  const snapshot = entry.snapshot || (entry.snapshot = {});
  const projectBinding = text(body[`${field}ProjectId`], 160);
  const projectKey = text(body[`${field}ProjectKey`], 64).toUpperCase();
  const issueKey = text(body.issueKey, 80).toUpperCase();
  const targetRecordId = text(body.targetRecordId, 160);
  const sourceIssueId = text(body.sourceIssueId, 160);
  const process = text(body.process, 40).toUpperCase();
  const indicator = text(body.indicator, 160);
  const issueRevision = Number(body.issueRevision || 0);
  if (!Number.isSafeInteger(issueRevision) || issueRevision < 0) throw fault("JiraFlow issue revision must be a nonnegative integer");
  if (projectBinding !== projectId || !/^[A-Z][A-Z0-9_-]{0,63}$/.test(projectKey)
    || !new RegExp(`^${projectKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d{1,12}$`).test(issueKey)) {
    throw fault("JiraFlow issue does not match the verified project mapping", 403);
  }
  if (!/^[A-Z]{2,8}\.\d{1,2}$/.test(process) || !indicator.startsWith(`${process}.`)) {
    throw fault("JiraFlow finding must include a valid target process and indicator");
  }
  if (!list(snapshot.processes).map(value => String(value).toUpperCase()).includes(process)) {
    throw fault("JiraFlow target process is outside the formal project scope", 403);
  }
  const member = authorize(entry, identity, { use: true, processes: [process] });
  if (entry.ownerId !== identity.userId && !member.processScopes.includes("*") && !member.processScopes.includes(process)) {
    throw fault("Process permission denied", 403, { deniedProcesses: [process] });
  }
  if (snapshot.assessmentState === "Closed" || snapshot.status === "complete") {
    throw fault("Reopen the assessment before linking a corrective issue", 409);
  }
  const target = findingRows(snapshot).find(item => item.record.id === targetRecordId);
  if (!target) throw fault("Finding record does not exist in this project", 404);
  const record = target.record;
  const recordProcesses = new Set([
    ...list(record.processes),
    record.process || record.processId || record.primaryProcess,
    ...list(record.indicators || record.targetIndicators).map(key => {
      const value = String(key || "").toUpperCase();
      return snapshot.assessments?.find(item => (item.indicator || `${item.process}.${item.code}`) === value)?.process || /^([A-Z]{2,8}\.\d{1,2})\./.exec(value)?.[1];
    })
  ].filter(Boolean).map(value => String(value).toUpperCase()));
  if (!recordProcesses.has(process)
    || !list(record.indicators || record.targetIndicators).map(value => String(value).toUpperCase()).includes(indicator)) {
    throw fault("Finding is not linked to the supplied in-scope process indicator", 403);
  }
  if (!(record.type === "weakness" || target.collection === "ncRecords" || record.sourceKind === "nc")) {
    throw fault("JiraFlow remediation tickets can only link to an existing weakness finding", 400);
  }
  if (sourceIssueId !== targetRecordId) throw fault("JiraFlow source issue must retain the originating finding id", 400);
  const records = findingRows(snapshot);
  const duplicate = records.find(item => String(item.record[`${field}Key`] || "").toUpperCase() === issueKey);
  if (duplicate) {
    if (duplicate.record.id !== targetRecordId) throw fault("JiraFlow issue is already linked to another finding", 409, { code: "jiraflow_issue_already_linked" });
    const existingEvidence = list(snapshot.evidence).find(item => item.sourceKind === kind && item.issueKey === issueKey);
    if (existingEvidence && list(record.evidenceIds).includes(existingEvidence.id)
      && issueRevision <= (Number(existingEvidence.issueRevision) || 0)) {
      return { duplicate: true, evidence: structuredClone(existingEvidence), record: structuredClone(record), process };
    }
  }
  snapshot.evidence = Array.isArray(snapshot.evidence) ? snapshot.evidence : (snapshot.evidence = []);
  const evidenceId = `${provider.toUpperCase()}-${issueKey}`;
  const existing = snapshot.evidence.find(item => item.id === evidenceId || item.sourceKind === kind && item.issueKey === issueKey);
  if (existing && (existing.findingRecordId !== targetRecordId || existing[`${field}ProjectKey`] !== projectKey)) {
    throw fault("JiraFlow evidence identity conflicts with an existing project item", 409, { code: "jiraflow_evidence_conflict" });
  }
  const title = text(body.issueSummary, 1000) || issueKey;
  const description = text(body.issueDescription, 12000);
  const status = text(body.issueStatus, 80) || "Open";
  const issueUrl = normalizeJiraFlowIssueUrl(body.issueUrl, issueKey, provider);
  const now = new Date().toISOString();
  const evidence = {
    ...(existing || {}),
    id: evidenceId,
    code: issueKey,
    name: title,
    filename: title,
    type: `${service} corrective-action issue`,
    source: service,
    sourceKind: kind,
    sourceSystem: service,
    issueKey,
    issueUrl,
    [`${field}ProjectId`]: projectBinding,
    [`${field}ProjectKey`]: projectKey,
    sourceIssueId,
    findingRecordId: targetRecordId,
    issueRevision,
    primaryProcess: process,
    primaryProcesses: [process],
    scope: process,
    evidenceRole: "corroborating",
    role: "corroborating",
    corroborating: true,
    external: true,
    content: description || title,
    summary: title,
    status,
    parseStatus: "parsed",
    size: Buffer.byteLength(description || title),
    date: existing?.date || now,
    uploadedAt: existing?.uploadedAt || now,
    uploadedBy: existing?.uploadedBy || identity.userName || identity.userId,
    locators: [{ locator: issueUrl || `${service} ${issueKey}`, excerpt: description || title }],
    sourceLinks: [{ type: "problem", sourceProcess: process, targetProcess: process, indicator, issueKey, issueRevision, status, url: issueUrl }]
  };
  const evidenceIndex = snapshot.evidence.findIndex(item => item.id === evidenceId || item.sourceKind === kind && item.issueKey === issueKey);
  if (evidenceIndex >= 0) snapshot.evidence[evidenceIndex] = evidence;
  else snapshot.evidence.push(evidence);
  record.evidenceIds = [...new Set([...list(record.evidenceIds).map(String), evidenceId])];
  record.evidenceAnalysis = [
    ...list(record.evidenceAnalysis).filter(item => item.sourceKind !== kind || item.issueKey !== issueKey),
    {
      evidenceId,
      evidenceCode: issueKey,
      source: service,
      sourceKind: kind,
      sourceIssueId,
      issueKey,
      issueUrl,
      excerpt: description || title,
      locator: issueUrl || `${service} ${issueKey}`,
      originProcess: process,
      targetProcess: process,
      indicator,
      issueRevision,
      relationType: "problem",
      evidenceRole: "corroborating",
      strength: "corroborating",
      confirmed: false,
      status
    }
  ];
  record[`${field}Key`] = issueKey;
  record.externalTicket = issueKey;
  record[field] = { key: issueKey, projectKey, projectId: projectBinding, revision: issueRevision, status, url: issueUrl };
  snapshot[`${field}Mapping`] = { ...(snapshot[`${field}Mapping`] || {}), key: projectKey, auditflowProjectId: projectBinding };
  if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_SHARED_SNAPSHOT_BYTES) throw fault("Snapshot exceeds 12 MiB", 413);
  return {
    duplicate: false,
    evidence: structuredClone(evidence),
    record: structuredClone(record),
    collection: target.collection,
    process,
    summary: `${service} ${issueKey} linked as corroborating evidence to ${targetRecordId}`
  };
}

function preserveJiraFlowEvidence(previousSnapshot, nextSnapshot) {
  const prior = list(previousSnapshot?.evidence).filter(item => ["jiraflow-assessment-finding", "jira-assessment-finding"].includes(item?.sourceKind) && item?.issueKey && item?.findingRecordId);
  if (!prior.length) return;
  nextSnapshot.evidence = Array.isArray(nextSnapshot.evidence) ? nextSnapshot.evidence : [];
  nextSnapshot.records = Array.isArray(nextSnapshot.records) ? nextSnapshot.records : [];
  nextSnapshot.ncRecords = Array.isArray(nextSnapshot.ncRecords) ? nextSnapshot.ncRecords : [];
  for (const source of prior) {
    const evidence = structuredClone(source);
    const target = findingRows(nextSnapshot).find(item => item.record.id === evidence.findingRecordId);
    const record = target?.record;
    if (!record || !(record.type === "weakness" || target.collection === "ncRecords" || record.sourceKind === "nc")) continue;
    const processes = new Set([
      record.process || record.processId || record.primaryProcess,
      ...list(record.indicators || record.targetIndicators).map(value => /^([A-Z]{2,8}\.\d{1,2})\./.exec(String(value || "").toUpperCase())?.[1])
    ].filter(Boolean).map(value => String(value).toUpperCase()));
    if (!processes.has(String(evidence.primaryProcess || "").toUpperCase())
      || !list(record.indicators || record.targetIndicators).map(value => String(value).toUpperCase()).includes(
        (evidence.sourceLinks || []).find(item => item.issueKey === evidence.issueKey)?.indicator
          || list(record.indicators || record.targetIndicators).find(value => String(value || "").toUpperCase().startsWith(`${String(evidence.primaryProcess || "").toUpperCase()}.`))
      )) continue;
    const index = nextSnapshot.evidence.findIndex(item => item.id === evidence.id || item.sourceKind === evidence.sourceKind && item.issueKey === evidence.issueKey);
    if (index >= 0) nextSnapshot.evidence[index] = evidence;
    else nextSnapshot.evidence.push(evidence);
    record.evidenceIds = [...new Set([...list(record.evidenceIds).map(String), evidence.id])];
    const field = evidence.sourceKind === "jira-assessment-finding" ? "jira" : "jiraFlow";
    record[`${field}Key`] = evidence.issueKey;
    record[field] = { key: evidence.issueKey, projectKey: evidence[`${field}ProjectKey`], projectId: evidence[`${field}ProjectId`], revision: evidence.issueRevision, status: evidence.status, url: evidence.issueUrl };
    if (!record.externalTicket) record.externalTicket = evidence.issueKey;
  }
}

function touchPresence(entry, body, identity, limit) {
  const remaining = entry.presence.filter(p => p.userId !== identity.userId);
  if (body.status === "offline") {
    entry.presence = remaining;
    entry.locks = entry.locks.filter(l => l.userId !== identity.userId);
    return;
  }
  const active = new Set([...remaining.map(p => p.userId), ...entry.locks.map(l => l.userId)]);
  active.delete(identity.userId);
  if (active.size >= limit) throw fault(`Active user limit reached (${limit})`, 429, { code: "active-user-limit", limit });
  const now = Date.now();
  entry.presence = [...remaining, { userId: identity.userId, userName: identity.userName, projectId: entry.projectId, projectName: text(body.projectName || entry.snapshot?.name || entry.projectId), phase: text(body.phase || "overview", 80), status: text(body.status || "viewing", 40), lastSeen: new Date(now).toISOString(), expiresAt: new Date(now + PRESENCE_TTL_MS).toISOString() }];
}

function target(entry, resourceId, change = {}) {
  const id = text(resourceId, 300);
  if (id.startsWith("assessment:")) {
    let row = entry.snapshot.assessments?.find(r => r.id === id.slice(11));
    // Trace-link requests can arrive from a browser holding a pre-bootstrap
    // assessment id. Resolve them by the stable process indicator so evidence
    // linking remains available after a project snapshot migration.
    if (!row && change.type === "trace-link" && change.indicator) {
      row = entry.snapshot.assessments?.find(candidate => {
        const process = text(candidate.process || candidate.processId, 40);
        const code = String(candidate.code || "").replace(/\s+/g, "");
        const indicator = candidate.indicator || (process === "CUSTOM" ? code : `${process}.${code}`);
        return indicator === text(change.indicator, 160);
      });
    }
    if (!row) throw fault("Assessment item not found", 404);
    const process = text(row.process || row.processId, 40);
    if (!process) throw fault("Assessment item has no process");
    const code = String(row.code || "").replace(/\s+/g, "");
    const indicator = row.indicator || (process === "CUSTOM" ? code : `${process}.${code}`);
    return { resourceId: id, row, process, indicator };
  }
  throw fault("resourceId must be assessment:<existing item id>; project session locks are unsupported");
}

export function mutateProject(operation, current, projectId, body, identity, { lockTtlMs = LOCK_TTL_MS, maxActiveEditors = MAX_PROJECT_USERS } = {}) {
  if (!identity?.userId) throw fault("Authentication required", 401);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(projectId)) throw fault("Invalid projectId");
  if (!object(body)) throw fault("Request must be an object");
  const limit = Math.min(MAX_PROJECT_USERS, Math.max(1, Number(maxActiveEditors) || MAX_PROJECT_USERS));
  let entry = normalizeEntry(structuredClone(current));
  if (operation === "saveProject") {
    if (entry) authorize(entry, identity, { owner: true, use: true });
    revision(entry, body);
    if (!object(body.snapshot)) throw fault("snapshot must be an object");
    if (Buffer.byteLength(JSON.stringify(body.snapshot)) > MAX_SHARED_SNAPSHOT_BYTES) throw fault("Snapshot exceeds 12 MiB", 413);
    const rows = body.snapshot.assessments || [];
    if (!Array.isArray(rows) || rows.some(r => !object(r) || typeof r.id !== "string" || !r.id) || new Set(rows.map(r => r.id)).size !== rows.length) throw fault("Assessment ids must be unique nonempty strings");
    if (entry?.locks.length) throw fault("Release all active item locks before replacing the project snapshot", 423, { lock: entry.locks[0] });
    entry ||= { projectId, ownerId: identity.userId, revision: 0, members: [{ userId: identity.userId, name: identity.userName, role: "Lead Assessor", processScopes: ["*"], permissionVersion: PERMISSION_SCHEMA_VERSION, permissions: normalizePermissions("Lead Assessor"), avatarData: "" }], locks: [], presence: [], events: [] };
    entry.workspaceId = text(body.workspaceId || entry.workspaceId || "AUDITFLOW-LOCAL", 160);
    const taskState = entry.snapshot && {
      assessmentTasks: structuredClone(entry.snapshot.assessmentTasks || []),
      assessmentTaskNotifications: structuredClone(entry.snapshot.assessmentTaskNotifications || [])
    };
    const jiraFlowEvidence = list(entry.snapshot?.evidence)
      .filter(item => ["jiraflow-assessment-finding", "jira-assessment-finding"].includes(item?.sourceKind));
    entry.snapshot = structuredClone(body.snapshot);
    // Tasks and delivery receipts are revisioned server records. A browser
    // snapshot cannot erase them, forge assignments, or mark a mail as sent.
    entry.snapshot.assessmentTasks = taskState?.assessmentTasks || [];
    entry.snapshot.assessmentTaskNotifications = taskState?.assessmentTaskNotifications || [];
    // JiraFlow issue references are created only by the verified integration
    // route. A browser snapshot may not forge or remove those server records.
    entry.snapshot.evidence = list(entry.snapshot.evidence)
      .filter(item => !["jiraflow-assessment-finding", "jira-assessment-finding"].includes(item?.sourceKind));
    preserveJiraFlowEvidence({ evidence: jiraFlowEvidence }, entry.snapshot);
    event(entry, identity, body.changeSummary || "Project synchronized");
    return { entry, result: { conflict: false, projectId, ownerId: entry.ownerId, revision: entry.revision, snapshot: entry.snapshot, members: entry.members } };
  }
  authorize(entry, identity);
  let result;
  if (operation === "applyJiraFlowEvidence" || operation === "applyJiraEvidence") {
    revision(entry, body);
    const linked = applyJiraFlowEvidence(entry, body, identity, projectId, operation === "applyJiraEvidence" ? "jira" : "jiraflow");
    if (linked.duplicate) {
      result = { projectId, revision: entry.revision, ...linked };
    } else {
      const linkedEvent = event(entry, identity, linked.summary, {
        type: operation === "applyJiraEvidence" ? "jira-evidence" : "jiraflow-evidence",
        issueKey: linked.evidence.issueKey,
        evidence: linked.evidence,
        findingId: linked.record.id,
        collection: linked.collection
      }, [linked.process]);
      result = { projectId, revision: entry.revision, ...linked, event: linkedEvent };
    }
  } else if (operation === "applyTaskChange") {
    const member = authorize(entry, identity);
    revision(entry, body);
    const changed = applyAssessmentTaskChange(entry, body, identity, { member });
    if (Buffer.byteLength(JSON.stringify(entry.snapshot)) > MAX_SHARED_SNAPSHOT_BYTES) throw fault("Snapshot exceeds 12 MiB", 413);
    const taskEvent = event(entry, identity, changed.summary, { type: "assessment-task", operation: body.operation, task: changed.task }, changed.processes);
    result = { projectId, revision: entry.revision, task: changed.task, notification: changed.notification, event: taskEvent };
  } else if (operation === "recordTaskNotification") {
    const changed = recordAssessmentTaskNotification(entry, body);
    result = { projectId, revision: entry.revision, ...changed };
  } else if (operation === "setMember") {
    authorize(entry, identity, { owner: true });
    revision(entry, body);
    const userId = text(body.userId, 160);
    if (!userId) throw fault("Missing member userId");
    if (userId === entry.ownerId) throw fault("The project creator remains the project owner", 403);
    const old = memberFor(entry, { userId });
    const remove = body.operation === "remove";
    if (!remove && !ROLES.includes(body.role)) throw fault("Unsupported project role");
    if (!remove && !old && entry.members.length >= MAX_PROJECT_USERS) throw fault("Project member limit reached (15)", 429, { code: "member-limit", limit: MAX_PROJECT_USERS });
    const permissions = body.permissions || { view: true, use: ["Lead Assessor", "Assessor"].includes(body.role) };
    if (!remove && (!object(permissions) || PERMISSION_KEYS.some(key => Object.hasOwn(permissions, key) && typeof permissions[key] !== "boolean"))) throw fault("permissions must contain boolean values");
    const lead = body.role === "Lead Assessor";
    const next = remove ? null : { userId, name: text(body.name || old?.name || userId, 160), role: body.role, processScopes: lead ? ["*"] : scopes(body.processScopes), permissionVersion: PERMISSION_SCHEMA_VERSION, permissions: normalizePermissions(body.role, permissions), avatarData: "" };
    entry.members = entry.members.filter(m => m.userId !== userId);
    if (next) entry.members.push(next);
    entry.locks = entry.locks.filter(l => l.userId !== userId);
    entry.presence = entry.presence.filter(p => p.userId !== userId);
    event(entry, identity, `Member ${userId} ${remove ? "removed" : "updated"}`);
    result = { projectId, ownerId: entry.ownerId, revision: entry.revision, member: next, members: entry.members };
  } else if (operation === "transferOwnership") {
    authorize(entry, identity, { owner: true });
    revision(entry, body);
    const userId = text(body.userId, 160);
    const nextOwner = memberFor(entry, { userId });
    if (!nextOwner) throw fault("New project owner must already be a project member", 403);
    entry.ownerId = userId;
    Object.assign(nextOwner, {
      role: "Lead Assessor",
      processScopes: ["*"],
      permissionVersion: PERMISSION_SCHEMA_VERSION,
      permissions: normalizePermissions("Lead Assessor")
    });
    event(entry, identity, `Project ownership transferred to ${userId}`);
    result = { projectId, ownerId: entry.ownerId, revision: entry.revision, members: entry.members };
  } else if (operation === "setPresence") {
    touchPresence(entry, body, identity, limit);
    result = { projectId, presence: entry.presence, ttlMs: PRESENCE_TTL_MS };
  } else if (operation === "acquireLock") {
    const item = target(entry, body.resourceId);
    authorize(entry, identity, { use: true, processes: [item.process] });
    if (body.process && body.process !== item.process) throw fault("Lock process does not match stored item");
    const existing = entry.locks.find(l => l.resourceId === item.resourceId);
    if (existing && existing.userId !== identity.userId) throw fault(`${existing.userName} is editing ${existing.label}`, 423, { lock: existing });
    touchPresence(entry, { ...body, status: "editing" }, identity, limit);
    const now = Date.now();
    const lock = existing || { id: `LOCK-${crypto.randomUUID()}`, resourceId: item.resourceId, kind: "assessment", label: text(body.label || item.row.id), process: item.process, affectedProcesses: [item.process], userId: identity.userId, userName: identity.userName, acquiredAt: new Date(now).toISOString() };
    lock.expiresAt = new Date(now + lockTtlMs).toISOString();
    if (!existing) entry.locks.push(lock);
    result = { lock, locks: entry.locks, ttlMs: lockTtlMs, revision: entry.revision };
  } else if (operation === "heartbeatLock" || operation === "releaseLock") {
    const lock = entry.locks.find(l => l.id === body.lockId && l.userId === identity.userId);
    if (operation === "heartbeatLock") {
      if (!lock) throw fault("Edit lock is no longer held", 409, { code: "lock-lost" });
      authorize(entry, identity, { use: true, processes: [lock.process] });
      touchPresence(entry, { status: "editing" }, identity, limit);
      lock.expiresAt = new Date(Date.now() + lockTtlMs).toISOString();
      result = { lock, ttlMs: lockTtlMs };
    } else {
      entry.locks = entry.locks.filter(l => l !== lock);
      result = { released: !!lock, locks: entry.locks };
    }
  } else if (operation === "applyChange") {
    const change = body.change;
    if (!object(change) || !["assessment", "trace-link", "record", "trace-mark"].includes(change.type)) throw fault("Unsupported collaboration change type");
    const item = target(entry, change.resourceId, change);
    authorize(entry, identity, { use: true, processes: [item.process] });
    if ((entry.snapshot?.assessmentState === "Closed" || entry.snapshot?.status === "complete") && !isGlobalAdmin(identity) && !canManageProject(entry, identity)) {
      throw fault("Closed assessments cannot be edited", 403, { code: "assessment-closed" });
    }
    if (change.process !== item.process) throw fault("Change process does not match stored item");
    const managing = canManageProject(entry, identity);
    if (!managing) {
      const permission = change.type === "assessment" ? "remarks" : change.type === "record" ? "forms" : "traceability";
      if (!memberFor(entry, identity)?.permissions[permission]) throw fault(`${permission} permission denied`, 403);
      if (change.type === "assessment") {
        if (entry.snapshot?.assessmentState === "Closed" || entry.snapshot?.status === "complete") throw fault("Closed assessments cannot be edited", 403, { code: "assessment-closed" });
        // Assessor UI exposes only review notes and finding classification;
        // ratings, evidence and formal confirmation remain lead-owned.
        const editable = new Set(["reviewerNote", "reviewerNoteEn", "findingStatus", "findingStatusBy", "findingStatusAt"]);
        for (const key of new Set([...Object.keys(item.row), ...Object.keys(change.value || {})])) {
          if (!editable.has(key) && JSON.stringify(change.value?.[key]) !== JSON.stringify(item.row[key])) throw fault("Only the lead assessor may modify ratings, evidence or assessment configuration", 403);
        }
        if ((change.value?.reviewed === true) !== (item.row.reviewed === true)
          || (change.value?.confirmed === true) !== (item.row.confirmed === true)) {
          throw fault("Formal assessor confirmation requires the lead assessor", 403);
        }
      }
      if (change.type === "record" && change.operation !== "remove" && (change.value?.status !== "Draft" || ![undefined, "", "Not applicable", "不适用"].includes(change.value?.closureState))) throw fault("Members may submit draft forms only", 403);
      if (change.type === "record") {
        const old = entry.snapshot.records?.find(r => r.id === change.entityId);
        if (old && old.createdBy !== identity.userId) throw fault("Only the lead assessor can change another member's form", 403);
        if (change.value) change.value.createdBy = identity.userId;
      }
      if (change.type === "trace-link") {
        const old = entry.snapshot.traceLinks?.find(r => r.id === change.entityId);
        if (old?.confirmed || change.value?.confirmed === true) throw fault("Evidence relationship confirmation requires the lead assessor", 403);
      }
    }
    if (change.type === "assessment" && change.value?.findingStatus && !["weakness","major-weakness","comment","observation","strength","recommendation","question"].includes(change.value.findingStatus)) throw fault("Invalid finding status");
    revision(entry, body);
    // Assessment and traceability writes use optimistic project revisions;
    // records and trace marks retain item leases for their current workflows.
    const lock = entry.locks.find(l => l.id === body.lockId && l.userId === identity.userId && l.resourceId === item.resourceId);
    if (!["assessment", "trace-link"].includes(change.type) && !lock) throw fault("A valid item edit lock is required", 409, { code: "lock-lost" });
    if (change.type === "assessment") {
      if (change.entityId !== item.row.id || !object(change.value) || ["id", "process", "processId", "code", "kind", "indicator"].some(key => change.value[key] !== item.row[key])) throw fault("Assessment identity/process cannot be changed");
      entry.snapshot.assessments[entry.snapshot.assessments.findIndex(r => r.id === item.row.id)] = structuredClone(change.value);
    } else if (change.type === "trace-link") {
      if (!change.entityId || change.indicator !== item.indicator) throw fault("Trace link must target the locked assessment indicator");
      const rows = entry.snapshot.traceLinks || [];
      const existing = rows.find(r => r.id === change.entityId);
      if (existing && existing.indicator !== item.indicator) throw fault("Trace link belongs to another assessment", 403);
      if (change.operation !== "remove" && (!object(change.value) || change.value.id !== change.entityId || change.value.indicator !== item.indicator)) throw fault("Invalid trace link value");
      entry.snapshot.traceLinks = rows.filter(r => r.id !== change.entityId);
      if (change.operation !== "remove") entry.snapshot.traceLinks.push(structuredClone(change.value));
    } else if (change.type === "record") {
      const rows = entry.snapshot.records || [];
      const existing = rows.find(r => r.id === change.entityId);
      const bound = row => (!row.assessmentId || row.assessmentId === item.row.id) && row.indicators?.length && row.indicators.every(i => i === item.indicator);
      if (existing && !bound(existing)) throw fault("Record belongs to another assessment", 403);
      if (change.operation !== "remove" && (!object(change.value) || change.value.id !== change.entityId || change.value.assessmentId !== item.row.id || !Array.isArray(change.value.indicators) || !change.value.indicators.length || change.value.indicators.some(i => i !== item.indicator))) throw fault("Record must bind only to the locked assessment");
      if (!change.entityId) throw fault("Missing record entityId");
      entry.snapshot.records = rows.filter(r => r.id !== change.entityId);
      if (change.operation !== "remove") entry.snapshot.records.push(structuredClone(change.value));
    } else if (change.type === "trace-mark") {
      if (change.assessmentId !== item.row.id || change.indicator !== item.indicator || change.entityId !== `${item.indicator}|${change.evidenceId || ""}`) throw fault("Trace mark must bind to the locked assessment");
      if (change.operation !== "remove" && (!object(change.value) || change.value.assessmentId !== item.row.id)) throw fault("Invalid trace mark value");
      entry.snapshot.traceRelationMarks ||= {};
      if (change.operation === "remove") delete entry.snapshot.traceRelationMarks[change.entityId];
      else entry.snapshot.traceRelationMarks[change.entityId] = structuredClone(change.value);
    }
    if (Buffer.byteLength(JSON.stringify(entry.snapshot)) > MAX_SHARED_SNAPSHOT_BYTES) throw fault("Snapshot exceeds 12 MiB", 413);
    touchPresence(entry, { status: "editing" }, identity, limit);
    const itemEvent = event(entry, identity, change.summary || `${change.type} updated`, structuredClone(change), [item.process]);
    result = { projectId, revision: entry.revision, event: itemEvent };
  } else if (operation === "applyTemplateChange") {
    const member = authorize(entry, identity, { use: true });
    const change = body.change;
    if (!object(change) || !["create", "update", "delete", "import", "use"].includes(change.operation)) {
      throw fault("Unsupported finding template operation");
    }
    if (change.operation !== "use" && !member.permissions?.forms && !canManageProject(entry, identity)) {
      throw fault("forms permission denied", 403);
    }
    revision(entry, body);
    entry.snapshot.findingTemplates = Array.isArray(entry.snapshot.findingTemplates) ? entry.snapshot.findingTemplates : [];
    const templates = entry.snapshot.findingTemplates;
    const incoming = Array.isArray(change.templates) ? change.templates : change.template ? [change.template] : [];
    const imported = incoming.slice(0, 100).map(template => normalizeFindingTemplate(template, identity));
    const operation = change.operation;
    if (operation === "create" || operation === "import") {
      const existingIds = new Set(templates.map(template => template.id));
      for (const template of imported) {
        if (existingIds.has(template.id)) template.id = `RT-${crypto.randomUUID()}`;
        if (template.scope === "global" && !canManageProject(entry, identity)) {
          throw fault("Only a project lead assessor can publish a global template", 403);
        }
        templates.push(template);
      }
    } else if (operation === "update") {
      const template = imported[0];
      if (!template) throw fault("template is required");
      const index = templates.findIndex(item => item.id === template.id);
      if (index < 0) throw fault("Finding template not found", 404);
      const current = templates[index];
      if (current.ownerId && current.ownerId !== identity.userId && !canManageProject(entry, identity)) {
        throw fault("Only the template owner or project lead assessor can edit this template", 403);
      }
      templates[index] = normalizeFindingTemplate(template, identity, current);
    } else if (operation === "delete") {
      const templateId = text(change.templateId || imported[0]?.id, 160);
      const index = templates.findIndex(item => item.id === templateId);
      if (index < 0) throw fault("Finding template not found", 404);
      const current = templates[index];
      if (current.ownerId && current.ownerId !== identity.userId && !canManageProject(entry, identity)) {
        throw fault("Only the template owner or project lead assessor can delete this template", 403);
      }
      templates.splice(index, 1);
    } else if (operation === "use") {
      const templateId = text(change.templateId || imported[0]?.id, 160);
      const index = templates.findIndex(item => item.id === templateId);
      if (index < 0) throw fault("Finding template not found", 404);
      templates[index] = normalizeFindingTemplate({ ...templates[index], usageCount: Number(templates[index].usageCount || 0) + 1 }, identity, templates[index]);
    }
    const summary = operation === "use"
      ? `Finding template ${text(change.templateId || imported[0]?.id, 160)} used`
      : `Finding templates ${operation}`;
    const templateEvent = event(entry, identity, summary, {
      type: "finding-template",
      operation,
      source: text(change.source || "AuditFlow", 80),
      templateIds: (operation === "delete" ? [text(change.templateId || imported[0]?.id, 160)] : (operation === "use" ? [text(change.templateId || imported[0]?.id, 160)] : imported.map(template => template.id))).filter(Boolean)
    });
    result = { projectId, revision: entry.revision, event: templateEvent, templates: structuredClone(templates) };
  } else if (operation === "applyMcpChange") {
    authorize(entry, identity, { use: true, processes: body.processes || [] });
    const change = body.change;
    if (!object(change) || !["document", "assessment-configuration", "assessment-candidate", "ai-finding"].includes(change.type)) {
      throw fault("Unsupported MCP project change type");
    }
    revision(entry, body);
    const snapshot = entry.snapshot || (entry.snapshot = {});
    if (["assessment-candidate", "assessment-configuration", "ai-finding"].includes(change.type)) {
      const assessmentId = text(change.assessmentId || change.id, 160);
      const targetAssessment = (snapshot.assessments || []).find(item => item.id === assessmentId);
      if (!targetAssessment) throw fault("Assessment item not found", 404);
      const lock = entry.locks.find(candidate => candidate.id === text(body.lockId, 160) && candidate.userId === identity.userId && candidate.resourceId === `assessment:${assessmentId}`);
      if (!lock) throw fault("A valid assessment edit lock is required for MCP assessment writes", 409, { code: "lock-lost" });
    }
    if (change.type === "document") {
      const documentId = text(change.documentId || change.id, 160);
      const documents = Array.isArray(snapshot.documents) ? snapshot.documents : [];
      const index = documents.findIndex(document => document.id === documentId);
      if (index < 0) throw fault("Project document not found", 404);
      const current = documents[index];
      const patch = object(change.patch) ? change.patch : {};
      const allowed = new Set(["title", "body", "status", "space", "workItemIds", "process", "owner", "summary"]);
      const next = { ...current };
      for (const key of Object.keys(patch)) {
        if (!allowed.has(key)) throw fault(`MCP document field is not writable: ${key}`, 403);
        if (key === "workItemIds") next[key] = normalizedList(patch[key], 200, 160);
        else next[key] = text(patch[key], key === "body" ? 12000 : key === "summary" ? 2000 : 500);
      }
      next.updatedAt = new Date().toISOString();
      next.updatedBy = identity.userId;
      next.revision = Number(current.revision || current.version || 1) + 1;
      next.version = next.revision;
      documents[index] = next;
      snapshot.documents = documents;
    } else if (change.type === "assessment-candidate") {
      const assessmentId = text(change.assessmentId || change.id, 160);
      const assessments = Array.isArray(snapshot.assessments) ? snapshot.assessments : [];
      const index = assessments.findIndex(item => item.id === assessmentId);
      if (index < 0) throw fault("Assessment item not found", 404);
      const current = assessments[index];
      const patch = object(change.patch) ? change.patch : {};
      const allowed = new Set(["aiCandidateRating", "aiCandidateReason", "aiCandidateConfidence", "aiCandidateAt", "aiCandidateBy"]);
      const next = { ...current };
      for (const key of Object.keys(patch)) {
        if (!allowed.has(key)) throw fault(`MCP candidate field is not writable: ${key}`, 403);
        if (key === "aiCandidateConfidence") next[key] = Math.max(0, Math.min(100, Number(patch[key]) || 0));
        else next[key] = text(patch[key], 4000);
      }
      next.aiCandidate = true;
      next.aiCandidateAt = new Date().toISOString();
      next.aiCandidateBy = identity.userId;
      next.formalRatingUnchanged = true;
      next.reviewed = false;
      assessments[index] = next;
      snapshot.assessments = assessments;
    } else if (change.type === "ai-finding") {
      const assessmentId = text(change.assessmentId || change.id, 160);
      const assessment = (snapshot.assessments || []).find(item => item.id === assessmentId);
      if (!assessment) throw fault("Assessment item not found", 404);
      const candidate = object(change.finding) ? change.finding : {};
      const workspaceList = Array.isArray(snapshot.workspaces) ? snapshot.workspaces : (snapshot.workspaces = []);
      let workspace = workspaceList.find(item => /ai workspace/i.test(String(item?.name || "")));
      if (!workspace) {
        workspace = { id: `WS-AI-${crypto.randomUUID().slice(0, 8)}`, name: "AI Workspace", description: "AI-generated assessor candidates awaiting human review", final: false, system: true };
        workspaceList.push(workspace);
      }
      const records = Array.isArray(snapshot.records) ? snapshot.records : (snapshot.records = []);
      const allowedTypes = new Set(FINDING_TYPES);
      const type = allowedTypes.has(String(candidate.type || "")) ? String(candidate.type) : "observation";
      const indicator = text(candidate.indicator || assessment.indicator || `${assessment.process || "CUSTOM"}.${assessment.code || ""}`, 120);
      const record = {
        id: text(candidate.id || `AI-FINDING-${crypto.randomUUID()}`, 160),
        type,
        text: normalizeFindingTemplateText(candidate.text || candidate.description || "AI-generated finding candidate"),
        indicators: [indicator],
        evidenceIds: [],
        evidenceReferences: normalizedList(candidate.evidenceReferences || candidate.references || [], 30, 500),
        workspaceId: workspace.id,
        instanceId: text(candidate.instanceId || snapshot.activeInstanceId, 160),
        creator: identity.userName,
        created: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
        status: "Draft",
        closureState: "Not applicable",
        attachments: [],
        aiCandidate: true,
        requiresAssessorConfirmation: true,
        reviewed: false,
        evidenceConfirmed: false,
        formalRatingChanged: false,
        source: "mcp"
      };
      records.push(record);
      snapshot.records = records;
    } else {
      const assessmentId = text(change.assessmentId || change.id, 160);
      const assessments = Array.isArray(snapshot.assessments) ? snapshot.assessments : [];
      const index = assessments.findIndex(item => item.id === assessmentId);
      if (index < 0) throw fault("Assessment item not found", 404);
      const current = assessments[index];
      const patch = object(change.patch) ? change.patch : {};
      const allowed = new Set(["title", "criterion", "defaultAdvice", "defaultAdviceEn", "trainingReference", "requirements", "enabled", "notes"]);
      const next = { ...current };
      for (const key of Object.keys(patch)) {
        if (!allowed.has(key)) throw fault(`MCP assessment configuration field is not writable: ${key}`, 403);
        if (key === "requirements") next[key] = structuredClone(patch[key]);
        else if (key === "enabled") {
          if (typeof patch[key] !== "boolean") throw fault("enabled must be a boolean");
          next[key] = patch[key];
        } else next[key] = text(patch[key], key === "notes" ? 4000 : 2000);
      }
      next.configurationRevision = Number(current.configurationRevision || 0) + 1;
      next.configurationUpdatedAt = new Date().toISOString();
      next.configurationUpdatedBy = identity.userId;
      next.reviewed = false;
      assessments[index] = next;
      snapshot.assessments = assessments;
    }
    if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_SHARED_SNAPSHOT_BYTES) throw fault("Snapshot exceeds 12 MiB", 413);
    const mcpEvent = event(entry, identity, change.summary || `MCP updated ${change.type}`, {
      ...structuredClone(change),
      source: "mcp",
      actorType: "ai-assistant"
    }, body.processes || []);
    result = { projectId, revision: entry.revision, event: mcpEvent, snapshot: structuredClone(snapshot) };
  } else throw fault("Unsupported operation");
  return { entry, result };
}

export function readEvents(entry, after) {
  if (!Number.isSafeInteger(after) || after < 0) throw fault("afterRevision must be a nonnegative integer");
  const events = entry.events.filter(e => e.revision > after).slice(0, 100);
  const resetRequired = after > entry.revision || (after < entry.revision && (!entry.events.length || after < entry.events[0].revision - 1));
  const nextRevision = events.at(-1)?.revision ?? after;
  return { projectId: entry.projectId, revision: entry.revision, events, nextRevision, hasMore: nextRevision < entry.revision, resetRequired, pollIntervalMs: POLL_INTERVAL_MS };
}

export const MUTATIONS = ["saveProject", "setMember", "transferOwnership", "setPresence", "acquireLock", "heartbeatLock", "releaseLock", "applyChange", "applyTemplateChange", "applyMcpChange", "applyTaskChange", "recordTaskNotification", "applyJiraFlowEvidence", "applyJiraEvidence"];
export function projectSummary(entry, identity) {
  const member = memberFor(entry, identity) || (isGlobalLeadAssessor(identity) ? {
    userId: identity.userId,
    name: identity.userName,
    role: "Lead Assessor",
    permissionVersion: PERMISSION_SCHEMA_VERSION,
    processScopes: ["*"],
    permissions: normalizePermissions("Lead Assessor"),
    global: true
  } : null);
  return { id: entry.projectId, projectId: entry.projectId, name: entry.snapshot?.name || entry.projectId, ownerId: entry.ownerId, revision: entry.revision, updatedAt: entry.updatedAt, member };
}
