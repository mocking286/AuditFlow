import http from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrateRequirements, requirementState, validateRequirements, changeRequirements, exportRequirements } from "./requirements.mjs";
import { buildDocumentBundle, buildDocumentTree, importDocumentBundle, normalizeDocumentRecord, validateDocumentParents } from "./document-library.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(process.env.FILEANALYST_CLIENT_ROOT || path.join(here, "client"));
const dataRoot = path.resolve(process.env.FILEANALYST_DATA_DIR || (process.env.FILEANALYST_DATA_FILE ? path.dirname(process.env.FILEANALYST_DATA_FILE) : path.join(here, "data")));
const uploadRoot = path.join(dataRoot, "uploads");
const defaultDataFile = process.env.FILEANALYST_DATA_FILE || path.join(dataRoot, "workspace.json");
const port = Number(process.env.FILEANALYST_PORT || 4310);
const host = process.env.FILEANALYST_HOST || "127.0.0.1";
const basePath = String(process.env.FILEANALYST_BASE_PATH || "").replace(/\/$/, "");
const auditflowAuthUrl = String(process.env.FILEANALYST_AUDITFLOW_AUTH_URL || "http://127.0.0.1:4180/api/auth/me");
const auditflowProjectsUrl = String(process.env.FILEANALYST_AUDITFLOW_PROJECTS_URL || (() => {
  const endpoint = new URL(auditflowAuthUrl);
  endpoint.pathname = endpoint.pathname.replace(/\/auth\/me\/?$/, "/projects");
  endpoint.search = "";
  return endpoint.toString();
})());
const storagePreference = String(process.env.FILEANALYST_STORAGE || "auto").trim().toLowerCase();
const configuredMysqlUrl = String(process.env.FILEANALYST_MYSQL_URL || process.env.AUDITFLOW_MYSQL_URL || process.env.MYSQL_URL || "").trim();
const mysqlUrl = storagePreference === "local-json" ? "" : configuredMysqlUrl;
const productionMode = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
// Explicit opt-in for local browser verification. Production and authenticated
// desktop launches continue to require an AuditFlow session.
const localOnlyMode = process.env.FILEANALYST_LOCAL_ONLY === "1";
const requireDatabase = storagePreference === "mysql" || (productionMode && process.env.FILEANALYST_REQUIRE_DATABASE !== "0");
const storageMode = mysqlUrl ? "mysql" : "local-json";
let mysqlPool = null;
let mysqlSchemaPromise = null;
let mysql = null;
const projectIdPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,190}$/;
const FILEANALYST_VERSION = "6.5.0";
// FileAnalyst 6.5 persists the same document model with an explicit schema
// revision so new documents and migrated records advertise the release they
// were validated against.
const FILEANALYST_SCHEMA_REVISION = "6.5.0";
const COLLABORATION_SCHEMA_VERSION = 1;
const PRESENCE_TTL_MS = 120_000;
const LOCK_TTL_MS = 90_000;

const WORK_ITEM_FIELDS = Object.freeze([
  { id: "severity", label: "Severity", type: "select", group: "Planning", options: ["Unassigned", "Low", "Medium", "High", "Critical"] },
  { id: "author", label: "Author", type: "text", group: "Ownership" },
  { id: "project", label: "Project", type: "text", group: "Ownership" },
  { id: "categories", label: "Categories", type: "tags", group: "Classification" },
  { id: "assignees", label: "Assignees", type: "tags", group: "Ownership" },
  { id: "priority", label: "Priority", type: "select", group: "Planning", options: ["Unassigned", "Low", "Medium", "High", "Urgent"] },
  { id: "resolution", label: "Resolution", type: "select", group: "Workflow", options: ["Unresolved", "Fixed", "Won't fix", "Duplicate", "Invalid"] },
  { id: "initialEstimate", label: "Initial estimate", type: "duration", group: "Planning" },
  { id: "timeSpent", label: "Time spent", type: "duration", group: "Planning" },
  { id: "remainingEstimate", label: "Remaining estimate", type: "duration", group: "Planning" },
  { id: "plannedIn", label: "Planned in", type: "text", group: "Planning" },
  { id: "plannedStart", label: "Planned start", type: "date", group: "Planning" },
  { id: "plannedEnd", label: "Planned end", type: "date", group: "Planning" },
  { id: "planningConstraints", label: "Planning constraints", type: "text", group: "Planning" },
  { id: "dueDate", label: "Due date", type: "date", group: "Planning" },
  { id: "hyperlinks", label: "Hyperlinks", type: "links", group: "Relations" },
  { id: "linkedRevisions", label: "Linked revisions", type: "links", group: "Relations" }
]);

const DEFAULT_WORK_ITEM_CONFIGURATION = Object.freeze({
  schemaVersion: 1,
  fields: WORK_ITEM_FIELDS,
  presentation: [
    { id: "identity", label: "Identity", fields: ["type", "id", "title", "project", "author"] },
    { id: "classification", label: "Classification", fields: ["process", "categories", "severity", "priority", "asil"] },
    { id: "ownership", label: "Ownership", fields: ["owner", "assignees", "plannedIn"] },
    { id: "workflow", label: "Workflow", fields: ["status", "resolution", "approval"] },
    { id: "planning", label: "Planning", fields: ["initialEstimate", "timeSpent", "remainingEstimate", "plannedStart", "plannedEnd", "dueDate", "planningConstraints"] },
    { id: "relations", label: "Relations", fields: ["hyperlinks", "linkedRevisions", "attachments", "linkedWorkItems"] }
  ],
  workflow: {
    statuses: ["Draft", "Open", "In Review", "Approved", "Ready for Test", "Resolved", "Closed"],
    transitions: [
      { id: "submit-review", from: ["Draft"], to: "In Review", label: "Submit for review" },
      { id: "approve", from: ["In Review"], to: "Approved", label: "Approve" },
      { id: "ready-for-test", from: ["Approved"], to: "Ready for Test", label: "Mark ready for test" },
      { id: "resolve", from: ["Open", "Ready for Test"], to: "Resolved", label: "Resolve" },
      { id: "close", from: ["Resolved"], to: "Closed", label: "Close" },
      { id: "reopen", from: ["Resolved", "Closed"], to: "Open", label: "Reopen" }
    ]
  },
  relationTypes: [
    { id: "implements", label: "implements", inverse: "implemented by", requiresEvidence: true },
    { id: "verifies", label: "verifies", inverse: "verified by", requiresEvidence: true },
    { id: "derives", label: "derives from", inverse: "derived by", requiresEvidence: false },
    { id: "affects", label: "affects", inverse: "affected by", requiresEvidence: false },
    { id: "duplicates", label: "duplicates", inverse: "duplicated by", requiresEvidence: false },
    { id: "relates", label: "relates to", inverse: "relates to", requiresEvidence: false }
  ]
});

function defaultWorkItemConfiguration() {
  return structuredClone(DEFAULT_WORK_ITEM_CONFIGURATION);
}

function normalizeCustomFields(value = {}, record = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const existing = record.customFields && typeof record.customFields === "object" ? record.customFields : {};
  const next = { ...existing };
  for (const field of WORK_ITEM_FIELDS) {
    if (!Object.hasOwn(source, field.id)) continue;
    const raw = source[field.id];
    if (field.type === "tags" || field.type === "links") {
      next[field.id] = Array.isArray(raw)
        ? raw.map(entry => text(entry, 500)).filter(Boolean).slice(0, 100)
        : String(raw || "").split(/[,;\n]/).map(entry => text(entry, 500)).filter(Boolean).slice(0, 100);
    } else {
      next[field.id] = text(raw, field.type === "duration" ? 80 : 500);
    }
  }
  return next;
}

function normalizeWorkItemConfiguration(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const configuredFields = Array.isArray(source.fields) ? source.fields : [];
  const fields = WORK_ITEM_FIELDS.map(defaultField => {
    const override = configuredFields.find(field => field?.id === defaultField.id) || {};
    return { ...defaultField, ...override, options: Array.isArray(override.options) ? override.options.slice(0, 50).map(item => text(item, 120)) : defaultField.options };
  });
  const presentation = Array.isArray(source.presentation) && source.presentation.length
    ? source.presentation.map(section => ({ id: text(section.id, 80), label: text(section.label, 120), fields: Array.isArray(section.fields) ? section.fields.map(item => text(item, 80)).filter(Boolean) : [] })).filter(section => section.id && section.fields.length)
    : defaultWorkItemConfiguration().presentation;
  const workflow = source.workflow && typeof source.workflow === "object" ? source.workflow : {};
  const statuses = Array.isArray(workflow.statuses) && workflow.statuses.length ? workflow.statuses.map(item => text(item, 80)).filter(Boolean).slice(0, 50) : defaultWorkItemConfiguration().workflow.statuses;
  const transitions = Array.isArray(workflow.transitions) ? workflow.transitions.map(item => ({ id: text(item.id, 80), from: Array.isArray(item.from) ? item.from.map(value => text(value, 80)).filter(Boolean) : [], to: text(item.to, 80), label: text(item.label, 160) })).filter(item => item.id && item.to) : defaultWorkItemConfiguration().workflow.transitions;
  const relationTypes = Array.isArray(source.relationTypes) && source.relationTypes.length ? source.relationTypes.map(item => ({ id: text(item.id, 80), label: text(item.label, 120), inverse: text(item.inverse, 120), requiresEvidence: item.requiresEvidence === true })).filter(item => item.id && item.label) : defaultWorkItemConfiguration().relationTypes;
  return { schemaVersion: 1, fields, presentation, workflow: { statuses, transitions }, relationTypes };
}

function workspaceFile(projectId) {
  if (!projectId) return defaultDataFile;
  const key = createHash("sha256").update(projectId).digest("hex");
  return path.join(dataRoot, "projects", `${key}.json`);
}

function uploadDirectory(projectId) {
  if (!projectId) return uploadRoot;
  const key = createHash("sha256").update(projectId).digest("hex");
  return path.join(uploadRoot, key);
}

if (requireDatabase && !mysqlUrl) {
  throw new Error("Production FileAnalyst requires FILEANALYST_MYSQL_URL, AUDITFLOW_MYSQL_URL or MYSQL_URL");
}

const now = () => new Date().toISOString();
const id = prefix => `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const item = (key, type, title, body, process, status, owner, role = "direct") => ({
  id: key, type, title, body, process, status, owner, evidenceRole: role,
  asil: "QM", updatedAt: now(), version: 1, revision: 1, revisionId: `${key}:r1`,
  approval: "Pending review", verification: "", tags: [], customFields: {
    severity: "Unassigned", author: owner, project: "", categories: [], assignees: owner ? [owner] : [],
    priority: "Unassigned", resolution: "Unresolved", initialEstimate: "", timeSpent: "", remainingEstimate: "",
    plannedIn: "", plannedStart: "", plannedEnd: "", planningConstraints: "", dueDate: "", hyperlinks: [], linkedRevisions: []
  }, history: [], audit: []
});

const ATTACHMENT_SCHEMA = `
  create table if not exists auditflow_fileanalyst_attachments (
    attachment_id varchar(80) primary key,
    project_id varchar(191) not null,
    item_id varchar(80) null,
    document_id varchar(80) null,
    file_name varchar(255) not null,
    mime_type varchar(160) not null,
    file_size bigint unsigned not null default 0,
    file_data longblob not null,
    sha256 char(64) null,
    parser_version varchar(80) null,
    parse_status varchar(40) not null default 'unparsed',
    uploaded_by varchar(191) not null,
    uploaded_by_name varchar(255) not null,
    uploaded_at datetime(6) not null default current_timestamp(6),
    key idx_fileanalyst_project_item (project_id, item_id),
    key idx_fileanalyst_project_document (project_id, document_id),
    key idx_fileanalyst_project_time (project_id, uploaded_at)
  ) engine=InnoDB default character set=utf8mb4 collate=utf8mb4_unicode_ci
`;

function mysqlConnectionOptions(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\/+/, "")),
    waitForConnections: true,
    connectionLimit: Number(process.env.FILEANALYST_MYSQL_POOL_SIZE || 5),
    maxIdle: Number(process.env.FILEANALYST_MYSQL_POOL_SIZE || 5),
    idleTimeout: 60_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  };
}

async function ensureMysqlStorage() {
  if (!mysqlUrl) return null;
  if (!mysqlSchemaPromise) {
    mysqlSchemaPromise = (async () => {
      mysql = (await import("mysql2/promise")).default;
      mysqlPool = mysql.createPool(mysqlConnectionOptions(mysqlUrl));
      await mysqlPool.query(ATTACHMENT_SCHEMA);
      for (const statement of [
        "alter table auditflow_fileanalyst_attachments add column sha256 char(64) null",
        "alter table auditflow_fileanalyst_attachments add column parser_version varchar(80) null",
        "alter table auditflow_fileanalyst_attachments add column parse_status varchar(40) not null default 'unparsed'"
      ]) {
        try {
          await mysqlPool.query(statement);
        } catch (error) {
          if (error?.code !== "ER_DUP_FIELDNAME" && error?.errno !== 1060) throw error;
        }
      }
      return mysqlPool;
    })().catch(error => {
      mysqlSchemaPromise = null;
      mysqlPool = null;
      throw error;
    });
  }
  return mysqlSchemaPromise;
}

function attachmentRecord(row) {
  const uploadedAt = row.uploaded_at ? new Date(row.uploaded_at).toISOString() : now();
  return {
    id: row.attachment_id,
    projectId: row.project_id,
    name: row.file_name,
    storage: "mysql",
    mime: row.mime_type || "application/octet-stream",
    size: Number(row.file_size || 0),
    sha256: row.sha256 || null,
    parserVersion: row.parser_version || null,
    parseStatus: row.parse_status || "unparsed",
    itemId: row.item_id || null,
    documentId: row.document_id || null,
    uploadedBy: row.uploaded_by,
    uploadedByName: row.uploaded_by_name,
    uploadedAt
  };
}

async function listMysqlAttachments(projectId, { itemId = "", documentId = "" } = {}) {
  const pool = await ensureMysqlStorage();
  const filters = ["project_id = ?"];
  const values = [projectId];
  if (itemId) { filters.push("item_id = ?"); values.push(itemId); }
  if (documentId) { filters.push("document_id = ?"); values.push(documentId); }
  const [rows] = await pool.execute(
    `select attachment_id, project_id, item_id, document_id, file_name, mime_type, file_size, sha256, parser_version, parse_status, uploaded_by, uploaded_by_name, uploaded_at
       from auditflow_fileanalyst_attachments
      where ${filters.join(" and ")}
      order by uploaded_at desc`,
    values
  );
  return rows.map(attachmentRecord);
}

async function findMysqlAttachment(projectId, attachmentId) {
  const pool = await ensureMysqlStorage();
  const [rows] = await pool.execute(
    `select attachment_id, project_id, item_id, document_id, file_name, mime_type, file_size, sha256, parser_version, parse_status, file_data, uploaded_by, uploaded_by_name, uploaded_at
       from auditflow_fileanalyst_attachments
      where project_id = ? and attachment_id = ?
      limit 1`,
    [projectId, attachmentId]
  );
  return rows[0] || null;
}

function seed() {
  return {
    meta: { product: "FileAnalyst", version: FILEANALYST_VERSION, schemaVersion: 5, project: "Drive Pilot", projectId: "drivepilot", createdAt: now(), updatedAt: now() },
    documents: [{
      id: "DOC-SYS-001", title: "System Requirement Specification", space: "Requirements", status: "In Review", version: "0.4",
      body: "<h1>System Requirement Specification</h1><h2>1. Scope</h2><p>This controlled document records approved system requirements and their verification intent for the display program.</p><h2>2. Communication status</h2><p>CAN messages shall be handled within the operational timing budget.</p><h2>3. Verification intent</h2><p>Each approved requirement needs an objective method, conditions, pass/fail rule, and linked test case before baseline.</p>",
      workItemIds: ["SYS-REQ-001", "SYS-REQ-002"], updatedAt: now(), history: []
    }],
    items: [
      item("SYS-REQ-001", "System Requirement", "Display shall show CAN status within 100 ms", "The display ECU shall update the status indication within 100 ms after receiving a valid CAN status message.", "SYS.2", "In Review", "Li Wei"),
      item("SYS-REQ-002", "System Requirement", "Display shall expose a diagnostic state", "The system shall provide the current diagnostic state to the vehicle service interface.", "SYS.2", "Draft", "Li Wei"),
      item("SWE-DES-001", "Software Design", "CAN signal update component", "The component validates the received status signal and publishes the normalized display state.", "SWE.2", "Approved", "Chen Yu"),
      item("SWE-TC-001", "Software Test Case", "Verify status update timing", "Precondition: integration target and CAN simulator are available. Procedure: transmit valid status frame. Pass: visible state updates in 100 ms or less.", "SWE.4", "Ready for Test", "Wang Fang"),
      item("SYS-TC-001", "System Test Case", "Verify diagnostic state through service interface", "Precondition: diagnostic session is active. Pass: returned state matches display state.", "SYS.4", "Draft", "Wang Fang"),
      item("ISS-001", "Problem Report", "Timing evidence pending", "Measurement log for the integration build has not been attached.", "SUP.9", "Open", "Zhang Min", "corroborating"),
      item("CR-001", "Change Request", "Clarify invalid CAN message behavior", "Assess the behavior for timeout and invalid status data before implementation.", "SUP.10", "Proposed", "Li Wei", "corroborating")
    ],
    links: [
      { id: "LNK-001", from: "SYS-REQ-001", to: "SWE-DES-001", role: "implemented by", status: "valid", createdAt: now() },
      { id: "LNK-002", from: "SWE-DES-001", to: "SWE-TC-001", role: "verified by", status: "valid", createdAt: now() },
      { id: "LNK-003", from: "SYS-REQ-002", to: "SYS-TC-001", role: "verified by", status: "missing evidence", createdAt: now() },
      { id: "LNK-004", from: "CR-001", to: "SYS-REQ-001", role: "affects", status: "valid", createdAt: now() }
    ],
    workItemConfiguration: defaultWorkItemConfiguration(),
    baselines: [],
    attachments: [],
    importStaging: [],
    glossary: [
      { id: "TERM-001", term: "FTTI", definition: "Fault Tolerant Time Interval: maximum time between a fault occurring and reaching the safe state.", owner: "Safety Engineering", status: "Approved", version: 1, updatedAt: now(), history: [] },
      { id: "TERM-002", term: "Direct evidence", definition: "Evidence record that directly demonstrates the process outcome and can support an assessor decision.", owner: "ASPICE Reviewer", status: "Approved", version: 1, updatedAt: now(), history: [] }
    ],
    testRuns: [{ id: "RUN-001", title: "Display integration verification", build: "Display-INT-0.4", environment: "HIL bench / CANoe", status: "In progress", createdAt: now(), results: [{ itemId: "SWE-TC-001", status: "Passed", actual: "104 ms observed; within requirement limit" }, { itemId: "SYS-TC-001", status: "Not run", actual: "" }] }],
    documentNodes: [], collaborationEvents: [], collaborationOperations: [], presence: [], locks: [], commentThreads: [], reviewDecisions: []
  };
}

function emptyWorkspace(projectContext) {
  return {
    meta: {
      product: "FileAnalyst",
      version: FILEANALYST_VERSION,
      schemaVersion: 5,
      project: projectContext.projectName,
      projectId: projectContext.projectId,
      createdAt: now(),
      updatedAt: now()
    },
    documents: [],
    items: [],
    workItemConfiguration: defaultWorkItemConfiguration(),
    links: [],
    baselines: [],
    attachments: [],
    importStaging: [],
    glossary: [],
    testRuns: [],
    auditEvents: [],
    savedQueries: [],
    documentNodes: [],
    requirementDocuments: [],
    requirementEvents: [],
    linkTypes: [],
    collaborationEvents: [],
    collaborationOperations: [],
    presence: [],
    locks: [],
    commentThreads: [],
    reviewDecisions: []
  };
}

function nodeRevision(node) {
  return Number(node?.revision || 1);
}

function nodeIdFor(documentId, suffix) {
  return `${documentId}:node:${suffix}`;
}

function createDocumentNodes(documentRecord) {
  const stamp = now();
  const rootId = nodeIdFor(documentRecord.id, "root");
  const nodes = [{
    nodeId: rootId,
    documentId: documentRecord.id,
    parentId: null,
    orderKey: "m",
    nodeType: "section",
    content: { title: documentRecord.title },
    styleProfile: { kind: "document-root" },
    sourceLocator: null,
    revision: 1,
    createdAt: stamp,
    updatedAt: stamp,
    tombstone: false
  }];
  const body = String(documentRecord.body || "");
  const fragments = body.match(/<(h[1-6]|p|table|figure|img)\b[\s\S]*?<\/\1>|<(img)\b[^>]*>/gi) || [];
  fragments.forEach((html, index) => {
    const tag = html.match(/^<\s*([a-z0-9]+)/i)?.[1]?.toLowerCase() || "paragraph";
    const nodeType = tag === "table" ? "table" : tag === "figure" || tag === "img" ? "figure" : /^h[1-6]$/.test(tag) ? "heading" : "paragraph";
    const nodeId = nodeIdFor(documentRecord.id, String(index + 1).padStart(6, "0"));
    nodes.push({
      nodeId,
      documentId: documentRecord.id,
      parentId: rootId,
      orderKey: `m${String(index + 1).padStart(6, "0")}`,
      nodeType,
      content: { html, text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() },
      styleProfile: { tag },
      sourceLocator: { kind: "html", index },
      revision: 1,
      createdAt: stamp,
      updatedAt: stamp,
      tombstone: false
    });
  });
  return nodes;
}

function ensureDocumentGraph(workspace, documentRecord) {
  workspace.documentNodes ||= [];
  let nodes = workspace.documentNodes.filter(node => node.documentId === documentRecord.id);
  if (!nodes.length) {
    nodes = createDocumentNodes(documentRecord);
    workspace.documentNodes.push(...nodes);
  }
  documentRecord.nodeIds = nodes.filter(node => !node.tombstone).sort((a, b) => a.orderKey.localeCompare(b.orderKey)).map(node => node.nodeId);
  documentRecord.revision = Number(documentRecord.revision || documentRecord.version || 1);
  documentRecord.schemaRevision ||= FILEANALYST_SCHEMA_REVISION;
  documentRecord.baselineIds ||= [];
  return nodes;
}

function pruneEphemeralCollaboration(workspace) {
  const threshold = Date.now() - PRESENCE_TTL_MS;
  workspace.presence = (workspace.presence || []).filter(entry => Date.parse(entry.lastSeen || entry.updatedAt || 0) >= threshold);
  workspace.locks = (workspace.locks || []).filter(lock => Date.parse(lock.expiresAt || 0) > Date.now());
}

function collaborationResource(workspace, resourceId) {
  const value = text(resourceId, 240);
  const match = value.match(/^(document|node|item|table|diagram):(.+)$/);
  if (!match) throw Object.assign(new Error("Invalid collaboration resource"), { status: 400 });
  const [, kind, identifier] = match;
  if (kind === "document") {
    const record = workspace.documents.find(document => document.id === identifier);
    if (!record) throw Object.assign(new Error("Document not found"), { status: 404 });
    return { kind, id: identifier, record };
  }
  if (kind === "node" || kind === "table" || kind === "diagram") {
    const node = workspace.documentNodes.find(candidate => candidate.nodeId === identifier);
    if (!node) throw Object.assign(new Error("Document node not found"), { status: 404 });
    return { kind, id: identifier, record: node, document: workspace.documents.find(document => document.id === node.documentId) };
  }
  const record = workspace.items.find(itemRecord => itemRecord.id === identifier);
  if (!record) throw Object.assign(new Error("Work item not found"), { status: 404 });
  return { kind, id: identifier, record };
}

function assertCollaborationScope(projectContext, workspace, resource) {
  if (resource.document) assertDocumentScope(projectContext, workspace, resource.document);
  else if (resource.kind === "document") assertDocumentScope(projectContext, workspace, resource.record);
  else assertItemScope(projectContext, resource.record);
}

function collaborationEvent(workspace, event) {
  workspace.collaborationEvents ||= [];
  const record = { id: id("CEV"), at: now(), schemaVersion: COLLABORATION_SCHEMA_VERSION, sequence: event.sequence || sequenceFor(workspace), ...event };
  workspace.collaborationEvents.push(record);
  workspace.collaborationEvents = workspace.collaborationEvents.slice(-3000);
  auditEvent(workspace, { action: event.action || "collaboration", objectType: event.resourceType || "resource", objectId: event.resourceId || null, actor: event.actor, operationId: event.operationId || null, reason: event.reason || null });
  return record;
}

function activeLock(workspace, resourceId) {
  pruneEphemeralCollaboration(workspace);
  return (workspace.locks || []).find(lock => lock.resourceId === resourceId) || null;
}

function requireOwnedLock(workspace, resourceId, identity, clientId) {
  const lock = activeLock(workspace, resourceId);
  if (!lock) throw Object.assign(new Error("A short-lived lock is required for this structural operation"), { status: 423, lock: null, retryAfterMs: 1000 });
  if (lock.ownerId !== identity.id || (clientId && lock.clientId !== clientId)) {
    throw Object.assign(new Error("Resource is locked by another collaborator"), { status: 423, lock, retryAfterMs: 1000 });
  }
  return lock;
}

function conflictPayload(resource, baseRevision, authoritativeRevision, record) {
  return { code: "revision-conflict", error: "Resource changed since it was opened", resourceId: resource, baseRevision, authoritativeRevision, conflictSet: [{ resourceId: resource, revision: authoritativeRevision, record }] };
}

function documentNodesFor(workspace, documentId) {
  return workspace.documentNodes.filter(node => node.documentId === documentId).sort((a, b) => a.orderKey.localeCompare(b.orderKey));
}

function cleanRichHtml(value, max = 20000) {
  return String(value ?? "")
    .replace(/<\/?(script|style|iframe|object|embed|meta|link)[^>]*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/\u0000/g, "")
    .slice(0, max);
}

function syncDocumentBodyFromNodes(workspace, documentRecord) {
  const nodes = documentNodesFor(workspace, documentRecord.id).filter(node => !node.tombstone && node.nodeId !== nodeIdFor(documentRecord.id, "root"));
  if (nodes.length) documentRecord.body = nodes.map(node => node.content?.html || "").join("");
  documentRecord.nodeIds = nodes.map(node => node.nodeId);
  documentRecord.schemaRevision = FILEANALYST_SCHEMA_REVISION;
}

function syncDocumentNodesFromBody(workspace, documentRecord) {
  const existing = documentNodesFor(workspace, documentRecord.id).filter(node => node.nodeId !== nodeIdFor(documentRecord.id, "root"));
  const fragments = String(documentRecord.body || "").match(/<(h[1-6]|p|table|figure|img)\b[\s\S]*?<\/\1>|<(img)\b[^>]*>/gi) || [];
  const stamp = now();
  fragments.forEach((html, index) => {
    const tag = html.match(/^<\s*([a-z0-9]+)/i)?.[1]?.toLowerCase() || "p";
    const nodeType = tag === "table" ? "table" : tag === "figure" || tag === "img" ? "figure" : /^h[1-6]$/.test(tag) ? "heading" : "paragraph";
    const node = existing[index] || { nodeId: nodeIdFor(documentRecord.id, String(index + 1).padStart(6, "0")), documentId: documentRecord.id, parentId: nodeIdFor(documentRecord.id, "root"), revision: 0, createdAt: stamp, tombstone: false };
    node.parentId = nodeIdFor(documentRecord.id, "root");
    node.orderKey = `m${String(index + 1).padStart(6, "0")}`;
    node.nodeType = nodeType;
    node.content = { ...(node.content || {}), html, text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() };
    node.styleProfile = { ...(node.styleProfile || {}), tag };
    node.revision = Math.max(1, node.revision || 1);
    node.updatedAt = stamp;
    node.tombstone = false;
    if (!workspace.documentNodes.includes(node)) workspace.documentNodes.push(node);
  });
  for (const node of existing.slice(fragments.length)) {
    node.tombstone = true;
    node.deletedAt = stamp;
    node.deletedBy = "compatibility-api";
  }
  ensureDocumentGraph(workspace, documentRecord);
}

function setDocumentRevision(documentRecord) {
  documentRecord.revision = Number(documentRecord.revision || documentRecord.version || 1) + 1;
  documentRecord.version = String((Number(documentRecord.version || "0.1") + 0.1).toFixed(1));
  documentRecord.revisionId = `${documentRecord.id}:r${documentRecord.revision}`;
  documentRecord.updatedAt = now();
}

function sequenceFor(workspace) {
  workspace.meta.collaborationSequence = Number(workspace.meta.collaborationSequence || 0) + 1;
  return workspace.meta.collaborationSequence;
}

function applyCollaborationOperation(workspace, resource, input, identity, projectContext) {
  const operationType = text(input.operationType, 40);
  const targetId = text(input.target?.nodeId || input.target?.id || input.nodeId, 240);
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const clientId = text(input.clientId, 120) || "web";
  const documentRecord = resource.document || (resource.kind === "document" ? resource.record : null);
  const structural = ["insertNode", "moveNode", "deleteNode", "replaceTableCell", "embedItem"].includes(operationType);
  if (structural) requireOwnedLock(workspace, input.resourceId, identity, clientId);
  const target = targetId ? workspace.documentNodes.find(node => node.nodeId === targetId) : null;
  if (targetId && !target) throw Object.assign(new Error("Operation target not found"), { status: 404 });
  if (target && resource.document && target.documentId !== resource.document.id) throw Object.assign(new Error("Operation target is outside the document"), { status: 400 });
  const expectedRevision = target ? nodeRevision(target) : currentRevision(resource.record);
  if (input.baseRevision !== undefined && Number(input.baseRevision) !== expectedRevision) {
    throw Object.assign(new Error("Resource changed since it was opened"), { status: 409, payload: conflictPayload(input.resourceId, input.baseRevision, expectedRevision, target || resource.record) });
  }

  if (operationType === "updateText") {
    if (!target) throw Object.assign(new Error("updateText requires a node target"), { status: 400 });
    target.content = { ...(target.content || {}), html: cleanRichHtml(payload.html ?? payload.content ?? ""), text: text(payload.text ?? String(payload.html ?? "").replace(/<[^>]+>/g, " "), 12000) };
  } else if (operationType === "setField") {
    if (resource.kind !== "item") throw Object.assign(new Error("setField requires an item resource"), { status: 400 });
    const field = text(payload.field, 80);
    if (!["title", "body", "status", "owner", "verification", "evidenceRole", "asil", "glossaryTerm"].includes(field)) throw Object.assign(new Error("Unsupported item field"), { status: 400 });
    assertItemScope(projectContext, resource.record);
    resource.record[field] = field === "body" ? cleanRichHtml(payload.value, 12000) : text(payload.value, 2000);
    resource.record.updatedAt = now();
    resource.record.updatedBy = identity.id;
    resource.record.version = Number(resource.record.version || 1) + 1;
    resource.record.revision = currentRevision(resource.record) + 1;
    resource.record.revisionId = `${resource.record.id}:r${resource.record.revision}`;
    resource.record.contentHash = contentHash({ title: resource.record.title, body: resource.record.body, process: resource.record.process, status: resource.record.status, evidenceRole: resource.record.evidenceRole });
  } else if (operationType === "insertNode") {
    if (!documentRecord) throw Object.assign(new Error("insertNode requires a document resource"), { status: 400 });
    const parentId = text(payload.parentId, 240) || nodeIdFor(documentRecord.id, "root");
    const parent = workspace.documentNodes.find(node => node.nodeId === parentId && node.documentId === documentRecord.id);
    if (!parent) throw Object.assign(new Error("Parent node not found"), { status: 404 });
    const nodeId = text(payload.nodeId, 240) || nodeIdFor(documentRecord.id, `custom-${id("N")}`);
    if (workspace.documentNodes.some(node => node.nodeId === nodeId)) throw Object.assign(new Error("Node ID already exists"), { status: 409 });
    const nodeType = text(payload.nodeType, 40) || "paragraph";
    const node = { nodeId, documentId: documentRecord.id, parentId, orderKey: text(payload.orderKey, 80) || `m${Date.now()}`, nodeType, content: { html: cleanRichHtml(payload.html || "<p></p>"), text: text(payload.text, 12000), ...(text(payload.itemId, 80) ? { itemId: text(payload.itemId, 80), displayMode: text(payload.displayMode, 40) || "compact" } : {}) }, styleProfile: payload.styleProfile && typeof payload.styleProfile === "object" ? payload.styleProfile : {}, sourceLocator: payload.sourceLocator || null, revision: 1, createdAt: now(), updatedAt: now(), tombstone: false };
    workspace.documentNodes.push(node);
    if (node.content.itemId) {
      const embedded = workspace.items.find(itemRecord => itemRecord.id === node.content.itemId);
      if (!embedded) throw Object.assign(new Error("Work item not found"), { status: 404 });
      assertItemScope(projectContext, embedded);
      documentRecord.workItemIds = [...new Set([...(documentRecord.workItemIds || []), embedded.id])];
    }
    syncDocumentBodyFromNodes(workspace, documentRecord);
  } else if (operationType === "moveNode") {
    if (!target || !documentRecord) throw Object.assign(new Error("moveNode requires a document node"), { status: 400 });
    const parentId = text(payload.parentId, 240) || target.parentId;
    if (parentId === target.nodeId) throw Object.assign(new Error("A node cannot be its own parent"), { status: 400 });
    const parent = workspace.documentNodes.find(node => node.nodeId === parentId && node.documentId === documentRecord.id);
    if (!parent) throw Object.assign(new Error("Destination node not found"), { status: 404 });
    target.parentId = parentId;
    target.orderKey = text(payload.orderKey, 80) || `m${Date.now()}`;
    syncDocumentBodyFromNodes(workspace, documentRecord);
  } else if (operationType === "deleteNode") {
    if (!target || !documentRecord) throw Object.assign(new Error("deleteNode requires a document node"), { status: 400 });
    if (target.nodeId === nodeIdFor(documentRecord.id, "root")) throw Object.assign(new Error("The document root cannot be deleted"), { status: 400 });
    target.tombstone = true;
    target.deletedAt = now();
    target.deletedBy = identity.id;
    syncDocumentBodyFromNodes(workspace, documentRecord);
  } else if (operationType === "replaceTableCell") {
    if (!target || target.nodeType !== "table") throw Object.assign(new Error("replaceTableCell requires a table node"), { status: 400 });
    const cellIndex = Number(payload.cellIndex);
    if (!Number.isInteger(cellIndex) || cellIndex < 0) throw Object.assign(new Error("A valid table cell index is required"), { status: 400 });
    const cells = Array.isArray(target.content?.cells) ? [...target.content.cells] : [];
    if (cellIndex >= cells.length) throw Object.assign(new Error("Table cell not found"), { status: 404 });
    cells[cellIndex] = { ...(cells[cellIndex] || {}), html: cleanRichHtml(payload.html ?? payload.value ?? "") };
    target.content = { ...(target.content || {}), cells };
  } else if (operationType === "embedItem") {
    if (!target || !documentRecord) throw Object.assign(new Error("embedItem requires a document node"), { status: 400 });
    const itemId = text(payload.itemId, 80);
    const itemRecord = workspace.items.find(item => item.id === itemId);
    if (!itemRecord) throw Object.assign(new Error("Work item not found"), { status: 404 });
    assertItemScope(projectContext, itemRecord);
    target.nodeType = "item-embedding";
    target.content = { ...(target.content || {}), itemId, displayMode: text(payload.displayMode, 40) || "compact", html: cleanRichHtml(payload.html || `<p>${itemId}</p>`) };
    documentRecord.workItemIds = [...new Set([...(documentRecord.workItemIds || []), itemId])];
    syncDocumentBodyFromNodes(workspace, documentRecord);
  } else {
    throw Object.assign(new Error(`Unsupported collaboration operation: ${operationType}`), { status: 400 });
  }

  if (target) {
    target.revision = nodeRevision(target) + 1;
    target.updatedAt = now();
  }
  if (documentRecord) {
    setDocumentRevision(documentRecord);
  }
  return { target: target || resource.record, revision: target ? nodeRevision(target) : currentRevision(resource.record), document: documentRecord || null };
}

async function getWorkspace(projectContext) {
  await ensureMysqlStorage();
  const projectId = projectContext?.projectId || "drivepilot";
  const projectName = projectContext?.projectName || "Local FileAnalyst workspace";
  const file = workspaceFile(projectId);
  await mkdir(path.dirname(file), { recursive: true });
  if (!existsSync(file) && projectId === "drivepilot" && defaultDataFile !== file && existsSync(defaultDataFile)) {
    const legacy = JSON.parse(await readFile(defaultDataFile, "utf8"));
    const migrated = migrateRequirements(legacy);
    migrated.meta ||= {};
    migrated.meta.projectId = projectId;
    migrated.meta.project = projectName;
    await writeWorkspace(migrated, false);
  }
  if (!existsSync(file)) {
    const initial = migrateRequirements(projectContext?.preview ? seed() : emptyWorkspace({ projectId, projectName }));
    initial.meta.projectId = projectId;
    initial.meta.project = projectName;
    for (const document of initial.documents) ensureDocumentGraph(initial, document);
    await writeWorkspace(initial, false);
    if (mysqlUrl) initial.attachments = await listMysqlAttachments(projectId);
    return initial;
  }
  const workspace = JSON.parse(await readFile(file, "utf8"));
  const previous = JSON.stringify(workspace);
  workspace.meta ||= {};
  workspace.meta.product = "FileAnalyst";
  workspace.meta.version = FILEANALYST_VERSION;
  workspace.meta.schemaVersion = Math.max(Number(workspace.meta.schemaVersion) || 1, 5);
  workspace.meta.project = projectName;
  workspace.meta.projectId = projectId;
  workspace.testRuns ||= [];
  workspace.attachments ||= [];
  workspace.importStaging ||= [];
  workspace.glossary ||= [];
  workspace.auditEvents ||= [];
  workspace.savedQueries ||= [];
  workspace.documentNodes ||= [];
  workspace.collaborationEvents ||= [];
  workspace.collaborationOperations ||= [];
  workspace.presence ||= [];
  workspace.locks ||= [];
  workspace.commentThreads ||= [];
  workspace.reviewDecisions ||= [];
  workspace.workItemConfiguration = normalizeWorkItemConfiguration(workspace.workItemConfiguration);
  workspace.meta.workItemConfigurationRevision = Number(workspace.meta.workItemConfigurationRevision || 1);
  workspace.linkTypes ||= [
    { id: "derives-from", label: "derives from", sourceTypes: ["*"], targetTypes: ["*"], requiresEvidence: false },
    { id: "satisfies", label: "satisfies", sourceTypes: ["*"], targetTypes: ["*"], requiresEvidence: true },
    { id: "implemented-by", label: "implemented by", sourceTypes: ["*"], targetTypes: ["*"], requiresEvidence: true },
    { id: "verified-by", label: "verified by", sourceTypes: ["*"], targetTypes: ["*"], requiresEvidence: true },
    { id: "affected-by", label: "affected by", sourceTypes: ["*"], targetTypes: ["*"], requiresEvidence: false },
    { id: "evidences", label: "evidences", sourceTypes: ["*"], targetTypes: ["*"], requiresEvidence: true }
  ];
  workspace.requirementDocuments ||= [];
  workspace.requirementEvents ||= [];
  workspace.items = (workspace.items || []).map(record => ({
    ...record,
    customFields: normalizeCustomFields(record.customFields || {}, record),
    history: record.history || []
  }));
  workspace.documents = (workspace.documents || []).map(record => ({
    ...normalizeDocumentRecord(record),
    history: record.history || [],
    revision: Number(record.revision || record.version || 1),
    schemaRevision: record.schemaRevision || FILEANALYST_SCHEMA_REVISION,
    baselineIds: record.baselineIds || [],
    nodeIds: record.nodeIds || []
  }));
  migrateRequirements(workspace);
  for (const document of workspace.documents) ensureDocumentGraph(workspace, document);
  pruneEphemeralCollaboration(workspace);
  if (previous !== JSON.stringify(workspace)) await writeWorkspace(workspace, false);
  if (mysqlUrl) workspace.attachments = await listMysqlAttachments(projectId);
  return workspace;
}

function contentHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function actorFrom(identity) {
  return { id: identity?.id || "unknown", name: identity?.name || identity?.id || "Unknown" };
}

function auditEvent(workspace, event) {
  workspace.auditEvents ||= [];
  workspace.auditEvents.push({ id: id("EVT"), at: now(), ...event });
  workspace.auditEvents = workspace.auditEvents.slice(-2000);
}

function currentRevision(record) {
  return Number(record?.revision || record?.version || 1);
}

function assertPermission(projectContext, permission) {
  if (projectContext.permissions?.[permission] !== true) {
    throw Object.assign(new Error(`Project ${permission} permission denied`), { status: 403 });
  }
}

function assertProcessScope(projectContext, process) {
  const processId = text(process, 40);
  if (!processId || projectContext.processScopes?.includes("*")) return;
  if (!projectContext.processScopes?.includes(processId)) {
    throw Object.assign(new Error(`Process scope denied for ${processId}`), { status: 403 });
  }
}

function assertItemScope(projectContext, record) {
  if (record) assertProcessScope(projectContext, record.process);
}

function assertDocumentScope(projectContext, workspace, record, workItemIds = record?.workItemIds || []) {
  for (const workItemId of workItemIds) {
    const itemRecord = workspace.items.find(item => item.id === workItemId);
    if (!itemRecord) throw Object.assign(new Error(`Work item not found: ${workItemId}`), { status: 404 });
    assertItemScope(projectContext, itemRecord);
  }
}

function findLinkType(workspace, value) {
  return (workspace.linkTypes || []).find(type => type.id === value || type.label === value);
}

function refreshSuspectLinks(workspace, changedId, identity) {
  const changed = workspace.items.find(record => record.id === changedId);
  const changedRevision = currentRevision(changed);
  for (const link of workspace.links || []) {
    if (link.from === changedId || link.to === changedId) {
      const source = workspace.items.find(record => record.id === link.from);
      const target = workspace.items.find(record => record.id === link.to);
      link.currentSourceVersion = currentRevision(source);
      link.currentTargetVersion = currentRevision(target);
      if (link.status === "valid") {
        const previousStatus = link.status;
        link.status = "suspect";
        link.revision = Number(link.revision || 1) + 1;
        link.reviewRequiredReason = `Endpoint ${changedId} changed to revision ${changedRevision}; assessor re-confirmation is required`;
        link.review = {
          ...(link.review || {}),
          invalidatedAt: now(),
          invalidatedBy: identity?.id || "unknown",
          invalidatedReason: link.reviewRequiredReason
        };
        auditEvent(workspace, {
          action: "link-suspect",
          objectType: "link",
          objectId: link.id,
          actor: actorFrom(identity),
          previousStatus,
          status: link.status,
          changedObjectId: changedId,
          sourceRevision: link.currentSourceVersion,
          targetRevision: link.currentTargetVersion,
          reason: link.reviewRequiredReason,
          linkRevision: link.revision
        });
      }
    }
  }
}
async function writeWorkspace(workspace, advanceRevision = true) {
  await mkdir(dataRoot, { recursive: true });
  if (advanceRevision) workspace.meta.requirementsRevision = (workspace.meta.requirementsRevision || 0) + 1;
  workspace.meta.updatedAt = now();
  const file = workspaceFile(workspace.meta.projectId);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  const persisted = mysqlUrl ? { ...workspace, attachments: [] } : workspace;
  await writeFile(temporary, JSON.stringify(persisted, null, 2), "utf8");
  await rename(temporary, file);
}
function json(res, code, value) { if (res.headersSent || res.writableEnded) return; res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(value)); }
function bad(res, message, code = 400) { json(res, code, { error: message }); }
async function body(req) { let raw = ""; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 15_000_000) throw Object.assign(new Error("Request too large"), { status: 413 }); } const value = raw ? JSON.parse(raw) : {}; if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("Expected a JSON object"), { status: 400 }); return value; }
function text(value, max = 12000) { return String(value || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max); }
const IMPORT_EXTENSIONS = new Set([".docx", ".pdf", ".xlsx", ".xls", ".csv", ".json", ".html", ".htm", ".txt", ".md", ".yaml", ".yml"]);
function safeImportName(value) {
  const name = path.basename(String(value || "import.bin")).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);
  return name || "import.bin";
}
function importPreview(content, mime, name) {
  const ext = path.extname(name).toLowerCase();
  const textLike = /^text\//i.test(mime) || [".csv", ".json", ".html", ".htm", ".txt", ".md", ".yaml", ".yml"].includes(ext);
  if (!textLike) return { kind: "binary", text: "", itemCount: 0 };
  const value = content.toString("utf8").replace(/\u0000/g, "").slice(0, 5000);
  const itemCount = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).length;
  return { kind: "text", text: value, itemCount };
}
function publicFile(file) { return file === "/" ? "index.html" : file.replace(/^\/+/, ""); }

async function auditflowUser(req) {
  const forwarded = forwardedSession(req);
  if (forwarded) {
    try {
      const response = await fetch(auditflowAuthUrl, { headers: { cookie: forwarded }, signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        const envelope = await response.json();
        const payload = envelope.data || envelope;
        const identifier = payload.user?.userId || payload.user?.id;
        if (payload.authenticated && identifier) return {
          id: identifier,
          name: payload.user.displayName || payload.user.name || payload.user.email || identifier,
          email: payload.user.email || "",
          isAdmin: payload.user.isAdmin === true
        };
      }
    } catch (_) {}
  }
  if (localOnlyMode) {
    return { id: "local-preview", name: "JEAuditFlow local verification", mode: "local" };
  }
  if (process.env.FILEANALYST_DESKTOP_MODE === "1") {
    return { id: "desktop-local", name: "JEAuditFlow Desktop", mode: "local" };
  }
  if (process.env.FILEANALYST_LOCAL_PREVIEW === "1") return { id: "local-preview", name: "Local preview", mode: "local" };
  return null;
}

function forwardedSession(req) {
  return req.headers.cookie || (req.headers["x-auditflow-session"] ? `auditflow_session=${req.headers["x-auditflow-session"]}` : "");
}

async function auditflowProjects(req, identity) {
  if (identity.mode === "local") {
    const requestedProject = text(req.headers["x-auditflow-project-id"], 191);
    const projectId = requestedProject && projectIdPattern.test(requestedProject)
      ? requestedProject
      : identity.id === "local-preview" ? "drivepilot" : "desktop-local";
    return [{
      id: projectId,
      projectId,
      name: identity.id === "local-preview" ? "FileAnalyst local verification workspace" : "Local FileAnalyst workspace",
      member: { role: "Project Administrator", processScopes: ["*"], permissions: { view: true, use: true, forms: true, remarks: true, traceability: true } }
    }];
  }
  const response = await fetch(auditflowProjectsUrl, {
    headers: { cookie: forwardedSession(req) },
    signal: AbortSignal.timeout(2500)
  });
  if (!response.ok) throw Object.assign(new Error("Unable to verify AuditFlow project access"), { status: response.status === 401 ? 401 : 503 });
  const envelope = await response.json();
  const projects = envelope.data?.projects || envelope.projects;
  if (!Array.isArray(projects)) throw Object.assign(new Error("AuditFlow project access response is invalid"), { status: 503 });
  return projects;
}

function normalizedProcessScopes(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(entry => text(entry, 40))
    .filter(Boolean))];
}

function processScopesFor(project, member, identity) {
  const role = String(member?.role || "");
  if (identity?.isAdmin || ["Administrator", "Project Administrator", "Lead Assessor"].includes(role)) return ["*"];
  if (role === "Viewer") return [];

  const memberScopes = normalizedProcessScopes(member?.processScopes);
  if (memberScopes.length) return memberScopes;

  // A permission-versioned empty list is an intentional restriction. Do not
  // widen it from a project default or a legacy compatibility rule.
  if (member && member.permissionVersion !== undefined && member.permissionVersion !== null) return [];

  const projectScopes = normalizedProcessScopes(project?.processScopes || project?.processScope);
  if (projectScopes.length) return projectScopes;

  // Pre-5.1 project members had no process scope field. Preserve their
  // existing use permission until an administrator explicitly assigns a
  // versioned scope.
  if (member?.permissions?.use === true) return ["*"];
  return [];
}

function resolveProjectContext(req, url, identity, projects) {
  const requestedId = text(req.headers["x-auditflow-project-id"] || url.searchParams.get("project"), 191);
  if (!requestedId && projects.length > 1) return null;
  const project = requestedId ? projects.find(entry => (entry.projectId || entry.id) === requestedId) : projects[0];
  if (!project || !projectIdPattern.test(String(project.projectId || project.id || ""))) {
    throw Object.assign(new Error("Project access has not been granted"), { status: 403 });
  }
  const member = project.member || (project.ownerId === identity.id ? { role: "Lead Assessor", processScopes: ["*"], permissions: { view: true, use: true, forms: true, remarks: true, traceability: true } } : null);
  const role = identity.isAdmin ? "Administrator" : String(member?.role || "");
  const permissions = identity.isAdmin
    ? { view: true, use: true, forms: true, remarks: true, traceability: true }
    : member?.permissions || { view: true, use: false, forms: false, remarks: false, traceability: false };
  if (!permissions.view) throw Object.assign(new Error("Project access has not been granted"), { status: 403 });
  return {
    projectId: String(project.projectId || project.id),
    projectName: text(project.name, 240) || String(project.projectId || project.id),
    role: role || "Viewer",
    processScopes: processScopesFor(project, member, identity),
    permissions,
    preview: identity.id === "local-preview"
  };
}

async function serveStatic(req, res) {
  const requestPath = new URL(req.url, "http://localhost").pathname;
  const relativePath = basePath && requestPath.startsWith(`${basePath}/`) ? requestPath.slice(basePath.length) : requestPath;
  const requested = publicFile(relativePath);
  const staticRoots = [clientRoot, here];
  const candidateLocations = staticRoots.map(root => path.resolve(root, requested));
  let location = candidateLocations.find(candidate => existsSync(candidate) && (
    candidate === path.join(clientRoot, "index.html")
    || candidate === path.join(here, "index.html")
    || candidate.startsWith(`${clientRoot}${path.sep}`)
    || candidate.startsWith(`${here}${path.sep}`)
  ));
  if (!location) location = path.join(clientRoot, "index.html");
  try {
    if (!existsSync(location) && !path.extname(location)) location = path.join(clientRoot, "index.html");
    const ext = path.extname(location);
    const type = ext === ".html"
      ? "text/html"
      : ext === ".js" || ext === ".mjs"
        ? "text/javascript"
        : ext === ".css"
          ? "text/css"
          : "application/octet-stream";
    const source = await readFile(location);
    const body = ext === ".html"
      ? source.toString("utf8")
        .replace(/<base href="[^"]*">/g, `<base href="${basePath || ""}/">`)
        .replace(/window.FILEANALYST_BASE_PATH="[^"]*"/, `window.FILEANALYST_BASE_PATH=${JSON.stringify(basePath)}`)
      : source;
    res.writeHead(200, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" }); res.end(body);
  } catch { bad(res, "Not found", 404); }
}

function safeUploadName(value) {
  const name = path.basename(String(value || "upload.bin")).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return name || "upload.bin";
}

async function serveUpload(req, res, url, projectContext) {
  const match = url.pathname.match(/^\/uploads\/([^/]+)$/);
  if (!match) return false;
  const workspace = await getWorkspace(projectContext);
  const attachmentId = decodeURIComponent(match[1]);
  if (mysqlUrl) {
    const row = await findMysqlAttachment(workspace.meta.projectId, attachmentId);
    if (!row) return false;
    res.writeHead(200, { "content-type": row.mime_type || "application/octet-stream", "content-disposition": `attachment; filename="${row.file_name}"`, "cache-control": "no-store" });
    res.end(row.file_data);
    return true;
  }
  const record = (workspace.attachments || []).find(x => x.id === attachmentId);
  if (!record) return false;
  const projectUploadRoot = uploadDirectory(workspace.meta.projectId);
  const location = path.resolve(projectUploadRoot, record.storageName);
  if (!location.startsWith(`${projectUploadRoot}${path.sep}`)) return false;
  try {
    const source = await readFile(location);
    res.writeHead(200, { "content-type": record.mime || "application/octet-stream", "content-disposition": `attachment; filename="${record.name}"`, "cache-control": "no-store" });
    res.end(source);
  } catch { bad(res, "Upload not found", 404); }
  return true;
}

async function api(req, res, url) {
  if (basePath && url.pathname.startsWith(`${basePath}/`)) url.pathname = url.pathname.slice(basePath.length) || "/";
  if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, {
    status: "ok",
    product: "FileAnalyst",
    version: FILEANALYST_VERSION,
    storage: storageMode,
    database: { provider: storageMode === "mysql" ? "mysql" : "file", configured: !!mysqlUrl }
  });
  const identity = await auditflowUser(req);
  const userId = identity?.id || "";
  const userName = identity?.name || "";
  if (!userId) return bad(res, "AuditFlow session required", 401);
  const projects = await auditflowProjects(req, identity);
  if (req.method === "GET" && url.pathname === "/api/projects") {
    return json(res, 200, projects.map(project => {
      const member = project.member || (project.ownerId === identity.id ? { role: "Lead Assessor", processScopes: ["*"], permissions: { view: true, use: true, forms: true, remarks: true, traceability: true } } : null);
      return {
        id: project.projectId || project.id,
        name: project.name || project.projectId || project.id,
        role: identity.isAdmin ? "Administrator" : member?.role || "Viewer",
        processScopes: processScopesFor(project, member, identity),
        permissions: identity.isAdmin
          ? { view: true, use: true, forms: true, remarks: true, traceability: true }
          : member?.permissions || { view: true, use: false, forms: false, remarks: false, traceability: false }
      };
    }));
  }
  const projectContext = resolveProjectContext(req, url, identity, projects);
  if (!projectContext) return bad(res, "Choose an authorized AuditFlow project", 400);
  const workspace = await getWorkspace(projectContext);
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  const presenceMutation = ["/api/collaboration/presence"].includes(url.pathname);
  if (mutating && !projectContext.permissions.use && !presenceMutation) return bad(res, "Project use permission denied", 403);
  if (req.method === "POST" && url.pathname === "/api/sync/auditflow-evidence") {
    assertPermission(projectContext, "forms");
    const input = await body(req);
    const incoming = Array.isArray(input.items) ? input.items.slice(0, 5000) : [];
    const sourceProjectId = text(input.projectId, 191) || workspace.meta.projectId;
    const existingBySource = new Map((workspace.items || []).filter(record => record.sourceAuditFlowId).map(record => [record.sourceAuditFlowId, record]));
    let created = 0;
    let updated = 0;
    for (const value of incoming) {
      const sourceId = text(value.sourceAuditFlowId || value.id, 191);
      const title = text(value.title || value.externalId || value.id, 240);
      if (!sourceId || !title) continue;
      const process = text(value.process || value.primaryProcess, 40) || "UNCLASSIFIED";
      const existing = existingBySource.get(sourceId);
      const record = existing || item("AF-" + sourceId.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 70), "Evidence item", title, text(value.body || value.text, 12000), process, "Imported", text(value.evidenceRole, 30) || "index-only");
      Object.assign(record, {
        title,
        body: text(value.body || value.text, 12000),
        process,
        evidenceRole: text(value.evidenceRole, 30) || record.evidenceRole || "index-only",
        sourceAuditFlowId: sourceId,
        auditflowProjectId: sourceProjectId,
        sourceFile: text(value.sourceFile, 255),
        sourceLocator: text(value.locator, 500),
        externalId: text(value.externalId, 191),
        updatedAt: now(),
        revision: Number(record.revision || 0) + 1,
        revisionId: (record.id || sourceId) + ":r" + (Number(record.revision || 0) + 1),
        customFields: { ...(record.customFields || {}), auditflowEvidenceId: sourceId, auditflowProjectId: sourceProjectId, sourceFile: text(value.sourceFile, 255), sourceLocator: text(value.locator, 500) }
      });
      if (existing) updated += 1;
      else { workspace.items.push(record); existingBySource.set(sourceId, record); created += 1; }
    }
    workspace.meta.auditflowEvidenceSyncRevision = Number(workspace.meta.auditflowEvidenceSyncRevision || 0) + 1;
    auditEvent(workspace, { action: "sync-auditflow-evidence", objectType: "evidence-library", objectId: sourceProjectId, actor: actorFrom(identity), revision: workspace.meta.auditflowEvidenceSyncRevision, reason: text(input.reason, 500) || "AuditFlow evidence item synchronization" });
    await writeWorkspace(workspace);
    return json(res, 200, { projectId: sourceProjectId, created, updated, total: incoming.length, revision: workspace.meta.auditflowEvidenceSyncRevision });
  }
  if (req.method === "GET" && url.pathname === "/api/workspace") {
    pruneEphemeralCollaboration(workspace);
    return json(res, 200, { ...workspace, identity: { id: userId, name: userName, roles: [projectContext.role], permissions: projectContext.permissions }, storage: storageMode });
  }
  if (req.method === "GET" && url.pathname === "/api/work-item-configuration") {
    return json(res, 200, { projectId: workspace.meta.projectId, revision: Number(workspace.meta.workItemConfigurationRevision || 1), configuration: workspace.workItemConfiguration });
  }
  if (req.method === "PUT" && url.pathname === "/api/work-item-configuration") {
    assertPermission(projectContext, "forms");
    const input = await body(req);
    const currentRevision = Number(workspace.meta.workItemConfigurationRevision || 1);
    if (input.baseRevision !== undefined && Number(input.baseRevision) !== currentRevision) {
      return json(res, 409, { error: "Work item configuration changed since it was opened", currentRevision, configuration: workspace.workItemConfiguration });
    }
    const configuration = normalizeWorkItemConfiguration(input.configuration);
    workspace.workItemConfiguration = configuration;
    workspace.meta.workItemConfigurationRevision = currentRevision + 1;
    auditEvent(workspace, {
      action: "configure",
      objectType: "work-item-configuration",
      objectId: workspace.meta.projectId,
      actor: actorFrom(identity),
      revision: workspace.meta.workItemConfigurationRevision,
      reason: text(input.reason, 500) || "Polarion-style work item configuration updated"
    });
    await writeWorkspace(workspace);
    return json(res, 200, { projectId: workspace.meta.projectId, revision: workspace.meta.workItemConfigurationRevision, configuration });
  }
  if (url.pathname === "/api/requirements" && req.method === "GET") return json(res, 200, requirementState(workspace));
  if (url.pathname === "/api/requirements/validate" && req.method === "GET") return json(res, 200, validateRequirements(workspace));
  if (url.pathname === "/api/requirements/export" && req.method === "GET") return json(res, 200, exportRequirements(workspace));
  if (url.pathname === "/api/documents/tree" && req.method === "GET") {
    return json(res, 200, { projectId: workspace.meta.projectId, tree: buildDocumentTree(workspace.documents || []) });
  }
  if (url.pathname === "/api/documents/export" && req.method === "GET") {
    return json(res, 200, buildDocumentBundle(workspace, { id: userId, name: userName }));
  }
  if (url.pathname === "/api/documents/import" && req.method === "POST") {
    assertPermission(projectContext, "forms");
    const input = await body(req);
    const result = importDocumentBundle(workspace, input.bundle || input, { id: userId, name: userName });
    auditEvent(workspace, { action: "import-document-library", objectType: "document-library", objectId: workspace.meta.projectId, actor: actorFrom(identity), reason: text(input.reason, 500) || "Polarion-style document library import", result });
    await writeWorkspace(workspace);
    return json(res, 201, { ...result, projectId: workspace.meta.projectId, revision: workspace.meta.requirementsRevision });
  }
  if (url.pathname === "/api/import-staging" && req.method === "GET") {
    return json(res, 200, { projectId: workspace.meta.projectId, staging: (workspace.importStaging || []).map(record => ({ ...record })) });
  }
  if (url.pathname === "/api/import-staging" && req.method === "POST") {
    assertPermission(projectContext, "forms");
    const input = await body(req);
    const name = safeImportName(input.name);
    const extension = path.extname(name).toLowerCase();
    if (!IMPORT_EXTENSIONS.has(extension)) return bad(res, `Unsupported ASPICE import type: ${extension || "unknown"}`);
    const encoded = String(input.data || "");
    if (!encoded || encoded.length > 14_000_000) return bad(res, "Import data is required and must be smaller than 10 MB");
    const content = Buffer.from(encoded.replace(/^data:[^;]+;base64,/, ""), "base64");
    if (!content.length || content.length > 10 * 1024 * 1024) return bad(res, "Import data is required and must be smaller than 10 MB");
    const mime = text(input.mime, 160) || "application/octet-stream";
    const preview = importPreview(content, mime, name);
    const record = {
      id: id("IMP"), name, extension, mime, size: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
      status: "staged", parseStatus: preview.kind === "binary" ? "metadata-only" : "preview-ready",
      preview: preview.text, previewKind: preview.kind, itemCount: preview.itemCount,
      originalLanguage: text(input.originalLanguage || input.language, 32) || null,
      sourceLocator: input.sourceLocator && typeof input.sourceLocator === "object" ? structuredClone(input.sourceLocator) : (text(input.sourceLocator, 500) || null),
      process: text(input.process, 40) || null, documentId: text(input.documentId, 80) || null,
      uploadedBy: userId, uploadedByName: userName, uploadedAt: now(), committedDocumentId: null, committedAt: null
    };
    if (record.process) assertProcessScope(projectContext, record.process);
    workspace.importStaging = [record, ...(workspace.importStaging || [])].slice(0, 200);
    auditEvent(workspace, { action: "stage-import", objectType: "import", objectId: record.id, actor: actorFrom(identity), sha256: record.sha256, sourceLocator: record.sourceLocator, process: record.process });
    await writeWorkspace(workspace);
    return json(res, 201, record);
  }
  const importCommitMatch = url.pathname.match(/^\/api\/import-staging\/([^/]+)\/commit$/);
  if (importCommitMatch && req.method === "POST") {
    assertPermission(projectContext, "forms");
    const input = await body(req);
    const staged = (workspace.importStaging || []).find(record => record.id === decodeURIComponent(importCommitMatch[1]));
    if (!staged) return bad(res, "Staged import not found", 404);
    if (staged.status === "committed") return json(res, 409, { error: "Staged import already committed", record: staged });
    const title = text(input.title, 240) || staged.name.replace(/\.[^.]+$/, "");
    const process = text(input.process || staged.process, 40) || null;
    if (process) assertProcessScope(projectContext, process);
    const parentId = text(input.parentId, 120) || null;
    if (parentId && !workspace.documents.some(document => document.id === parentId)) return bad(res, "Parent document not found", 400);
    const bodyText = staged.previewKind === "text" ? staged.preview : `Imported ${staged.name}; inspect the staged source before assessor approval.`;
    const escapedTitle = title.replace(/[<>&]/g, "");
    const record = normalizeDocumentRecord({
      id: id("DOC"), title, space: text(input.space, 80) || "Imported sources", parentId,
      documentType: "Imported Source", process, sourceLocator: staged.sourceLocator || { kind: "import", stagingId: staged.id },
      originalLanguage: staged.originalLanguage, sourceFile: staged.name,
      uploadedBy: staged.uploadedBy, uploadedByName: staged.uploadedByName, uploadedAt: staged.uploadedAt,
      status: "Draft", version: "0.1", revision: 1, revisionId: "", schemaRevision: FILEANALYST_SCHEMA_REVISION,
      baselineIds: [], body: `<h1>${escapedTitle}</h1><p>${bodyText.replace(/[<>&]/g, "")}</p>`, workItemIds: [], updatedAt: now(), history: []
    });
    record.revisionId = `${record.id}:r1`;
    ensureDocumentGraph(workspace, record);
    workspace.documents.unshift(record);
    staged.status = "committed";
    staged.committedDocumentId = record.id;
    staged.committedAt = now();
    staged.commitReason = text(input.reason, 500) || "Assessor-approved staged import";
    auditEvent(workspace, { action: "commit-import", objectType: "import", objectId: staged.id, actor: actorFrom(identity), documentId: record.id, sourceLocator: staged.sourceLocator, sha256: staged.sha256, reason: staged.commitReason });
    await writeWorkspace(workspace);
    return json(res, 201, { staging: staged, document: record });
  }
  const importDeleteMatch = url.pathname.match(/^\/api\/import-staging\/([^/]+)$/);
  if (importDeleteMatch && req.method === "DELETE") {
    assertPermission(projectContext, "forms");
    const identifier = decodeURIComponent(importDeleteMatch[1]);
    const index = (workspace.importStaging || []).findIndex(record => record.id === identifier);
    if (index < 0) return bad(res, "Staged import not found", 404);
    const [removed] = workspace.importStaging.splice(index, 1);
    auditEvent(workspace, { action: "discard-import", objectType: "import", objectId: identifier, actor: actorFrom(identity), sha256: removed.sha256 });
    await writeWorkspace(workspace);
    return json(res, 200, { id: identifier, discarded: true });
  }
  if (url.pathname === "/api/requirements" && req.method === "POST") {
    assertPermission(projectContext, "forms");
    const input = await body(req);
    const existingRequirement = input.id ? workspace.items.find(record => record.id === text(input.id, 80)) : null;
    if (["create", "edit", "review", "clear"].includes(input.action)) {
      assertItemScope(projectContext, existingRequirement);
      assertProcessScope(projectContext, input.process || existingRequirement?.process || "SYS.2");
    }
    const updated = changeRequirements(workspace, input, { id: userId, name: userName });
    await writeWorkspace(updated, false);
    return json(res, 200, requirementState(updated));
  }
  if (req.method === "GET" && url.pathname === "/api/audit") {
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 500);
    return json(res, 200, { events: (workspace.auditEvents || []).slice(-limit).reverse() });
  }
  if (req.method === "GET" && url.pathname === "/api/link-types") return json(res, 200, workspace.linkTypes || []);
  if (req.method === "GET" && url.pathname === "/api/query") {
    const q = text(url.searchParams.get("q"), 240).toLowerCase();
    const status = text(url.searchParams.get("status"), 40);
    const process = text(url.searchParams.get("process"), 40);
    const evidenceRole = text(url.searchParams.get("evidenceRole"), 30);
    const items = workspace.items.filter(record =>
      (!q || `${record.id} ${record.title} ${record.body}`.toLowerCase().includes(q)) &&
      (!status || record.status === status) &&
      (!process || record.process === process) &&
      (!evidenceRole || record.evidenceRole === evidenceRole)
    );
    return json(res, 200, { query: { q, status, process, evidenceRole }, total: items.length, items, generatedAt: now() });
  }
  if (req.method === "GET" && url.pathname === "/api/glossary") return json(res, 200, workspace.glossary || []);
  if (req.method === "GET" && url.pathname === "/api/uploads") {
    const itemId = text(url.searchParams.get("itemId"), 80), documentId = text(url.searchParams.get("documentId"), 80);
    const attachments = mysqlUrl
      ? await listMysqlAttachments(workspace.meta.projectId, { itemId, documentId })
      : (workspace.attachments || []).filter(x => (!itemId || x.itemId === itemId) && (!documentId || x.documentId === documentId));
    return json(res, 200, attachments);
  }
  if (req.method === "GET" && url.pathname === "/api/collaboration/events") {
    const resourceId = text(url.searchParams.get("resourceId"), 240);
    const after = Number(url.searchParams.get("after") || 0);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 500);
    const events = (workspace.collaborationEvents || []).filter(event => (!resourceId || event.resourceId === resourceId) && Number(event.sequence || 0) > after).slice(-limit);
    return json(res, 200, { events, cursor: events.at(-1)?.sequence || after });
  }
  if (req.method === "GET" && url.pathname === "/api/collaboration/presence") {
    pruneEphemeralCollaboration(workspace);
    const resourceId = text(url.searchParams.get("resourceId"), 240);
    return json(res, 200, (workspace.presence || []).filter(entry => !resourceId || entry.resourceId === resourceId));
  }
  if (req.method === "GET" && url.pathname === "/api/collaboration/locks") {
    pruneEphemeralCollaboration(workspace);
    const resourceId = text(url.searchParams.get("resourceId"), 240);
    return json(res, 200, (workspace.locks || []).filter(entry => !resourceId || entry.resourceId === resourceId));
  }
  const nodesMatch = url.pathname.match(/^\/api\/documents\/([^/]+)\/nodes$/);
  if (nodesMatch && req.method === "GET") {
    const documentId = decodeURIComponent(nodesMatch[1]);
    const documentRecord = workspace.documents.find(document => document.id === documentId);
    if (!documentRecord) return bad(res, "Document not found", 404);
    assertDocumentScope(projectContext, workspace, documentRecord);
    ensureDocumentGraph(workspace, documentRecord);
    return json(res, 200, { document: documentRecord, nodes: documentNodesFor(workspace, documentId) });
  }
  const collaborationResourceMatch = url.pathname.match(/^\/api\/collaboration\/resources\/([^/]+)$/);
  if (collaborationResourceMatch && req.method === "GET") {
    const resource = collaborationResource(workspace, decodeURIComponent(collaborationResourceMatch[1]));
    assertCollaborationScope(projectContext, workspace, resource);
    return json(res, 200, { resourceId: `${resource.kind}:${resource.id}`, kind: resource.kind, record: resource.record, nodes: resource.document ? documentNodesFor(workspace, resource.document.id) : undefined });
  }
  if (req.method === "POST" && url.pathname === "/api/collaboration/presence") {
    const input = await body(req);
    const resourceId = text(input.resourceId, 240);
    const resource = collaborationResource(workspace, resourceId);
    assertCollaborationScope(projectContext, workspace, resource);
    const clientId = text(input.clientId, 120) || "web";
    const entry = { id: `${userId}:${clientId}:${resourceId}`, userId, displayName: userName || userId, projectId: workspace.meta.projectId, resourceId, nodeId: text(input.nodeId, 240) || null, mode: ["view", "edit", "review"].includes(input.mode) ? input.mode : "edit", lastSeen: now(), expiresAt: new Date(Date.now() + PRESENCE_TTL_MS).toISOString() };
    workspace.presence = (workspace.presence || []).filter(candidate => candidate.id !== entry.id);
    workspace.presence.push(entry);
    pruneEphemeralCollaboration(workspace);
    await writeWorkspace(workspace, false);
    return json(res, 200, entry);
  }
  if (req.method === "DELETE" && url.pathname === "/api/collaboration/presence") {
    const input = await body(req);
    const resourceId = text(input.resourceId, 240);
    workspace.presence = (workspace.presence || []).filter(entry => !(entry.userId === userId && (!resourceId || entry.resourceId === resourceId)));
    await writeWorkspace(workspace, false);
    return json(res, 200, { removed: true });
  }
  if (req.method === "POST" && url.pathname === "/api/collaboration/locks") {
    assertPermission(projectContext, "forms");
    const input = await body(req);
    const resourceId = text(input.resourceId, 240);
    const resource = collaborationResource(workspace, resourceId);
    assertCollaborationScope(projectContext, workspace, resource);
    const clientId = text(input.clientId, 120) || "web";
    const existing = activeLock(workspace, resourceId);
    if (existing && (existing.ownerId !== userId || existing.clientId !== clientId)) return json(res, 423, { code: "resource-locked", error: "Resource is locked by another collaborator", lock: existing, retryAfterMs: 1000 });
    const lock = { id: existing?.id || id("LOCK"), resourceId, kind: text(input.kind, 40) || "structural", ownerId: userId, ownerName: userName || userId, clientId, acquiredAt: existing?.acquiredAt || now(), expiresAt: new Date(Date.now() + LOCK_TTL_MS).toISOString() };
    workspace.locks = (workspace.locks || []).filter(candidate => candidate.resourceId !== resourceId);
    workspace.locks.push(lock);
    collaborationEvent(workspace, { action: "lock-acquired", resourceType: resource.kind, resourceId, actor: actorFrom(identity), clientId, reason: text(input.reason, 500) || null });
    await writeWorkspace(workspace, false);
    return json(res, 200, lock);
  }
  const lockMatch = url.pathname.match(/^\/api\/collaboration\/locks\/([^/]+)$/);
  if (lockMatch && ["PUT", "DELETE"].includes(req.method)) {
    const resourceId = decodeURIComponent(lockMatch[1]);
    const lock = activeLock(workspace, resourceId);
    if (!lock) return bad(res, "Lock not found", 404);
    if (lock.ownerId !== userId) return json(res, 423, { code: "resource-locked", error: "Only the lock owner can change this lock", lock, retryAfterMs: 1000 });
    if (req.method === "DELETE") {
      workspace.locks = (workspace.locks || []).filter(candidate => candidate.id !== lock.id);
      collaborationEvent(workspace, { action: "lock-released", resourceType: "resource", resourceId, actor: actorFrom(identity), clientId: lock.clientId });
    } else {
      lock.expiresAt = new Date(Date.now() + LOCK_TTL_MS).toISOString();
      lock.lastSeen = now();
    }
    await writeWorkspace(workspace, false);
    return json(res, 200, req.method === "DELETE" ? { released: true } : lock);
  }
  const operationMatch = url.pathname.match(/^\/api\/collaboration\/resources\/([^/]+)\/operations$/);
  if (operationMatch && req.method === "POST") {
    assertPermission(projectContext, "forms");
    const input = await body(req);
    const resourceId = decodeURIComponent(operationMatch[1]);
    if (text(input.resourceId, 240) && text(input.resourceId, 240) !== resourceId) return bad(res, "resourceId does not match the route");
    const operationId = text(input.operationId, 120);
    if (!operationId) return bad(res, "operationId is required");
    const prior = (workspace.collaborationOperations || []).find(operation => operation.operationId === operationId);
    if (prior) return json(res, 200, prior.result);
    const resource = collaborationResource(workspace, resourceId);
    assertCollaborationScope(projectContext, workspace, resource);
    try {
      const beforeHash = contentHash(structuredClone(resource.record));
      const result = applyCollaborationOperation(workspace, resource, { ...input, resourceId }, identity, projectContext);
      const sequence = sequenceFor(workspace);
      const event = collaborationEvent(workspace, { action: input.operationType, resourceType: resource.kind, resourceId, operationId, clientId: text(input.clientId, 120) || "web", actor: actorFrom(identity), baseRevision: input.baseRevision, revision: result.revision, beforeHash, afterHash: contentHash(result.target), sourceLocator: input.sourceLocator || null, reason: text(input.reason, 500) || null, sequence });
      const response = { revision: result.revision, documentRevision: result.document ? currentRevision(result.document) : currentRevision(resource.record), appliedEvent: event, affectedResources: [resourceId], record: result.target, document: result.document || undefined };
      workspace.collaborationOperations.push({ operationId, resourceId, actorId: userId, result: response, at: now() });
      await writeWorkspace(workspace);
      return json(res, 200, response);
    } catch (error) {
      if (error.status === 409 && error.payload) return json(res, 409, error.payload);
      if (error.status === 423) return json(res, 423, { code: "resource-locked", error: error.message, lock: error.lock || null, retryAfterMs: error.retryAfterMs || 1000 });
      throw error;
    }
  }
  if (req.method === "GET" && url.pathname === "/api/collaboration/comments") {
    const resourceId = text(url.searchParams.get("resourceId"), 240);
    if (resourceId) assertCollaborationScope(projectContext, workspace, collaborationResource(workspace, resourceId));
    return json(res, 200, (workspace.commentThreads || []).filter(thread => !resourceId || thread.resourceId === resourceId));
  }
  if (req.method === "POST" && url.pathname === "/api/collaboration/comments") {
    assertPermission(projectContext, "remarks");
    const input = await body(req);
    const resourceId = text(input.resourceId, 240);
    const resource = collaborationResource(workspace, resourceId);
    assertCollaborationScope(projectContext, workspace, resource);
    const comment = { id: id("CMT"), resourceId, nodeId: text(input.nodeId, 240) || null, body: text(input.body, 4000), anchor: input.anchor && typeof input.anchor === "object" ? input.anchor : null, status: "open", createdAt: now(), createdBy: userId, createdByName: userName || userId, replies: [] };
    if (!comment.body) return bad(res, "Comment text is required");
    workspace.commentThreads.unshift(comment);
    collaborationEvent(workspace, { action: "comment-created", resourceType: resource.kind, resourceId, actor: actorFrom(identity), reason: "Comment thread created" });
    await writeWorkspace(workspace);
    return json(res, 201, comment);
  }
  if (req.method === "PUT" && url.pathname === "/api/collaboration/comments") {
    assertPermission(projectContext, "remarks");
    const input = await body(req);
    const comment = (workspace.commentThreads || []).find(thread => thread.id === text(input.commentId, 120));
    if (!comment) return bad(res, "Comment thread not found", 404);
    assertCollaborationScope(projectContext, workspace, collaborationResource(workspace, comment.resourceId));
    if (!["open", "resolved", "reopened"].includes(input.status)) return bad(res, "Invalid comment status");
    comment.status = input.status;
    comment.updatedAt = now();
    comment.updatedBy = userId;
    collaborationEvent(workspace, { action: `comment-${input.status}`, resourceType: "comment", resourceId: comment.resourceId, actor: actorFrom(identity), reason: text(input.reason, 500) || null });
    await writeWorkspace(workspace);
    return json(res, 200, comment);
  }
  if (req.method === "GET" && url.pathname === "/api/collaboration/review-decisions") {
    const resourceId = text(url.searchParams.get("resourceId"), 240);
    if (resourceId) assertCollaborationScope(projectContext, workspace, collaborationResource(workspace, resourceId));
    return json(res, 200, (workspace.reviewDecisions || []).filter(decision => !resourceId || decision.resourceId === resourceId));
  }
  if (req.method === "POST" && url.pathname === "/api/collaboration/review-decisions") {
    assertPermission(projectContext, "forms");
    const input = await body(req);
    const resourceId = text(input.resourceId, 240);
    const resource = collaborationResource(workspace, resourceId);
    assertCollaborationScope(projectContext, workspace, resource);
    const decision = text(input.decision, 40);
    if (!["accept", "reject", "request-changes", "acknowledge"].includes(decision)) return bad(res, "Invalid review decision");
    const record = { id: id("DEC"), resourceId, nodeId: text(input.nodeId, 240) || null, decision, reason: text(input.reason, 2000), actor: actorFrom(identity), targetRevision: Number(input.targetRevision || currentRevision(resource.record)), createdAt: now(), evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.slice(0, 50).map(value => text(value, 500)) : [], formal: true };
    if (!record.reason) return bad(res, "Review decision reason is required");
    workspace.reviewDecisions.unshift(record);
    collaborationEvent(workspace, { action: "review-decision", resourceType: resource.kind, resourceId, actor: actorFrom(identity), reason: record.reason, decision, targetRevision: record.targetRevision });
    await writeWorkspace(workspace);
    return json(res, 201, record);
  }
  if (req.method === "GET" && url.pathname === "/api/admin/users") return json(res, 200, [{ id: userId, name: userName || "AuditFlow user", email: identity.email || "", roles: [projectContext.role] }]);
  if (req.method === "GET" && url.pathname === "/api/admin/permissions") return json(res, 200, {
    projectId: projectContext.projectId,
    role: projectContext.role,
    processScopes: projectContext.processScopes,
    permissions: projectContext.permissions,
    enforcement: "AuditFlow collaboration API"
  });
  if (req.method === "GET" && url.pathname === "/api/items") {
    const q = text(url.searchParams.get("q"), 240).toLowerCase();
    const type = text(url.searchParams.get("type"), 80);
    const process = text(url.searchParams.get("process"), 40);
    const records = workspace.items.filter(record => (!q || `${record.id} ${record.title} ${record.body} ${record.status} ${record.owner}`.toLowerCase().includes(q)) && (!type || record.type === type) && (!process || record.process === process));
    return json(res, 200, records);
  }
  const documentGetMatch = url.pathname.match(/^\/api\/documents\/([^/]+)$/);
  if (documentGetMatch && req.method === "GET") {
    const record = workspace.documents.find(x => x.id === decodeURIComponent(documentGetMatch[1]));
    if (record) assertDocumentScope(projectContext, workspace, record);
    return record ? json(res, 200, record) : bad(res, "Document not found", 404);
  }
  if (req.method === "POST" && url.pathname === "/api/items") {
    assertPermission(projectContext, "forms");
    const input = await body(req); const title = text(input.title, 240); if (!title) return bad(res, "A title is required");
    const process = text(input.process, 40) || "SYS.2";
    assertProcessScope(projectContext, process);
    const owner = text(input.owner, 80) || userName || "Unassigned";
    const created = { id: id("WI"), type: text(input.type, 80) || "System Requirement", title, body: text(input.body), process, status: "Draft", owner, evidenceRole: ["direct", "corroborating", "index-only"].includes(input.evidenceRole) ? input.evidenceRole : "direct", asil: text(input.asil, 20) || "QM", updatedAt: now(), version: 1, revision: 1, revisionId: "", approval: "Pending review", verification: text(input.verification), tags: [], customFields: normalizeCustomFields({ author: owner, assignees: [owner], ...(input.customFields || {}) }, {}), updatedBy: userId, history: [] };
    created.revisionId = `${created.id}:r1`;
    created.contentHash = contentHash({ title: created.title, body: created.body, process: created.process });
    workspace.items.unshift(created);
    auditEvent(workspace, { action: "create", objectType: "item", objectId: created.id, actor: actorFrom(identity), revision: created.revisionId });
    await writeWorkspace(workspace); return json(res, 201, created);
  }
  const itemMatch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
  if (itemMatch && req.method === "PUT") {
    assertPermission(projectContext, "forms");
    const input = await body(req); const record = workspace.items.find(x => x.id === decodeURIComponent(itemMatch[1])); if (!record) return bad(res, "Work item not found", 404);
    assertItemScope(projectContext, record);
    assertProcessScope(projectContext, input.process || record.process);
    if (input.baseVersion !== undefined && Number(input.baseVersion) !== Number(record.version)) return json(res, 409, { error: "Work item changed since it was opened", currentVersion: record.version, record });
    if (input.baseRevision !== undefined && Number(input.baseRevision) !== currentRevision(record)) return json(res, 409, { error: "Work item revision conflict", currentRevision: currentRevision(record), record });
    const previous = structuredClone(record);
    for (const field of ["title", "body", "type", "process", "status", "owner", "evidenceRole", "asil", "approval", "verification", "glossaryTerm"]) if (field in input) record[field] = text(input[field], field === "body" ? 12000 : 240);
    if (input.customFields && typeof input.customFields === "object") record.customFields = normalizeCustomFields(input.customFields, record);
    record.updatedAt = now(); record.updatedBy = userId; record.version += 1; record.revision = currentRevision(record) + 1; record.revisionId = `${record.id}:r${record.revision}`;
    record.contentHash = contentHash({ title: record.title, body: record.body, process: record.process, status: record.status, evidenceRole: record.evidenceRole });
    record.history = [...(record.history || []), { ...previous, changedAt: record.updatedAt, changedBy: text(input.changedBy, 80) || userName || userId }].slice(-20);
    refreshSuspectLinks(workspace, record.id, identity);
    auditEvent(workspace, { action: "edit", objectType: "item", objectId: record.id, actor: actorFrom(identity), revision: record.revisionId, reason: text(input.reason, 500) || null });
    await writeWorkspace(workspace); return json(res, 200, record);
  }
  if (req.method === "POST" && url.pathname === "/api/uploads") {
    assertPermission(projectContext, "forms");
    const input = await body(req); const encoded = String(input.data || "");
    if (!encoded || encoded.length > 14_000_000) return bad(res, "File data is required and must be smaller than 10 MB");
    const itemId = text(input.itemId, 80), documentId = text(input.documentId, 80);
    const itemRecord = itemId ? workspace.items.find(x => x.id === itemId) : null;
    const documentRecord = documentId ? workspace.documents.find(x => x.id === documentId) : null;
    if (itemId && !itemRecord) return bad(res, "Work item not found", 404);
    if (documentId && !documentRecord) return bad(res, "Document not found", 404);
    assertItemScope(projectContext, itemRecord);
    for (const embeddedId of documentRecord?.workItemIds || []) assertItemScope(projectContext, workspace.items.find(record => record.id === embeddedId));
    if (!itemId && !documentId) return bad(res, "Attach the file to a work item or document");
    const content = Buffer.from(encoded.replace(/^data:[^;]+;base64,/, ""), "base64");
    if (!content.length || content.length > 10 * 1024 * 1024) return bad(res, "File data is required and must be smaller than 10 MB");
    const uploadId = id("ATT");
    const name = safeUploadName(input.name);
    const mime = text(input.mime, 120) || "application/octet-stream";
    const uploadedAt = now();
    if (mysqlUrl) {
      const pool = await ensureMysqlStorage();
      await pool.execute(
        `insert into auditflow_fileanalyst_attachments
          (attachment_id, project_id, item_id, document_id, file_name, mime_type, file_size, file_data, sha256, parser_version, parse_status, uploaded_by, uploaded_by_name, uploaded_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uploadId, workspace.meta.projectId, itemId || null, documentId || null, name, mime, content.length, content, createHash("sha256").update(content).digest("hex"), "fileanalyst-6.1", "unparsed", userId, userName, new Date(uploadedAt)]
      );
      const sha256 = createHash("sha256").update(content).digest("hex");
      auditEvent(workspace, { action: "attach", objectType: "attachment", objectId: uploadId, actor: actorFrom(identity), sha256, itemId: itemId || null, documentId: documentId || null });
      await writeWorkspace(workspace);
      return json(res, 201, { id: uploadId, projectId: workspace.meta.projectId, name, storage: "mysql", mime, size: content.length, sha256, parserVersion: "fileanalyst-6.1", parseStatus: "unparsed", itemId: itemId || null, documentId: documentId || null, uploadedBy: userId, uploadedByName: userName, uploadedAt });
    }
    const storageName = `${uploadId}-${name}`;
    const projectUploadRoot = uploadDirectory(workspace.meta.projectId);
    await mkdir(projectUploadRoot, { recursive: true });
    await writeFile(path.join(projectUploadRoot, storageName), content);
    const record = { id: uploadId, name, storageName, mime, size: content.length, sha256: createHash("sha256").update(content).digest("hex"), parserVersion: "fileanalyst-6.1", parseStatus: "unparsed", itemId: itemId || null, documentId: documentId || null, uploadedBy: userId, uploadedByName: userName, uploadedAt };
    workspace.attachments.unshift(record);
    auditEvent(workspace, { action: "attach", objectType: "attachment", objectId: record.id, actor: actorFrom(identity), sha256: record.sha256, itemId: itemId || null, documentId: documentId || null });
    await writeWorkspace(workspace); return json(res, 201, record);
  }
  const glossaryMatch = url.pathname.match(/^\/api\/glossary\/([^/]+)$/);
  if (glossaryMatch && req.method === "PUT") {
    assertPermission(projectContext, "forms");
    const input = await body(req); const record = (workspace.glossary || []).find(x => x.id === decodeURIComponent(glossaryMatch[1])); if (!record) return bad(res, "Glossary entry not found", 404);
    if (input.baseVersion !== undefined && Number(input.baseVersion) !== Number(record.version)) return json(res, 409, { error: "Glossary entry changed since it was opened", currentVersion: record.version, record });
    const previous = { version: record.version, term: record.term, definition: record.definition, owner: record.owner, status: record.status };
    for (const field of ["term", "definition", "owner", "status"]) if (field in input) record[field] = text(input[field], field === "definition" ? 2000 : 160);
    if (!record.term) return bad(res, "A glossary term is required");
    record.version += 1; record.updatedAt = now(); record.history = [...(record.history || []), { ...previous, changedAt: record.updatedAt, changedBy: text(input.changedBy, 80) || "Current user" }].slice(-20); await writeWorkspace(workspace); return json(res, 200, record);
  }
  if (req.method === "POST" && url.pathname === "/api/glossary") {
    assertPermission(projectContext, "forms");
    const input = await body(req); const term = text(input.term, 160); if (!term) return bad(res, "A glossary term is required");
    const record = { id: id("TERM"), term, definition: text(input.definition, 2000), owner: text(input.owner, 160) || "Unassigned", status: "Draft", version: 1, updatedAt: now(), history: [] }; workspace.glossary.unshift(record); await writeWorkspace(workspace); return json(res, 201, record);
  }
  if (req.method === "POST" && url.pathname === "/api/documents") {
    assertPermission(projectContext, "forms");
    const input = await body(req); const title = text(input.title, 240); if (!title) return bad(res, "A document title is required");
    const record = normalizeDocumentRecord({ id: id("DOC"), title, space: text(input.space, 80) || "Requirements", parentId: text(input.parentId || input.parent, 120) || null, documentType: text(input.documentType || input.type, 80) || "LiveDoc", process: text(input.process, 40) || null, sourceLocator: input.sourceLocator || null, status: "Draft", version: "0.1", revision: 1, revisionId: "", schemaRevision: FILEANALYST_SCHEMA_REVISION, baselineIds: [], body: "<h1>" + title.replace(/[<>&]/g, "") + "</h1><p>Start controlled content here.</p>", workItemIds: [], updatedAt: now(), history: [] });
    if (record.parentId && !workspace.documents.some(document => document.id === record.parentId)) return bad(res, "Parent document not found", 400);
    record.revisionId = `${record.id}:r1`;
    ensureDocumentGraph(workspace, record);
    workspace.documents.unshift(record); await writeWorkspace(workspace); return json(res, 201, record);
  }
  const documentMatch = url.pathname.match(/^\/api\/documents\/([^/]+)$/);
  if (documentMatch && req.method === "PUT") {
    assertPermission(projectContext, "forms");
    const input = await body(req); const record = workspace.documents.find(x => x.id === decodeURIComponent(documentMatch[1])); if (!record) return bad(res, "Document not found", 404);
    assertDocumentScope(projectContext, workspace, record);
    if (Array.isArray(input.workItemIds)) assertDocumentScope(projectContext, workspace, record, input.workItemIds);
    if (input.baseVersion !== undefined && String(input.baseVersion) !== String(record.version)) return json(res, 409, { error: "Document changed since it was opened", currentVersion: record.version, record });
    const previous = { version: record.version, title: record.title, body: record.body, status: record.status, updatedAt: record.updatedAt };
    if ("title" in input) record.title = text(input.title, 240); if ("body" in input) record.body = text(input.body, 50000); if ("status" in input) record.status = text(input.status, 40); if ("documentType" in input || "type" in input) record.documentType = text(input.documentType || input.type, 80) || record.documentType; if ("process" in input) record.process = text(input.process, 40) || null; if ("sourceLocator" in input) record.sourceLocator = input.sourceLocator && typeof input.sourceLocator === "object" ? input.sourceLocator : text(input.sourceLocator, 500); if ("parentId" in input || "parent" in input) {
      const parentId = text(input.parentId || input.parent, 120) || null;
      if (parentId && parentId === record.id) return bad(res, "A document cannot be its own parent");
      if (parentId && !workspace.documents.some(document => document.id === parentId)) return bad(res, "Parent document not found");
      record.parentId = parentId;
      try { validateDocumentParents(workspace.documents); } catch (error) { return bad(res, error.message, error.status || 400); }
    } if (Array.isArray(input.workItemIds)) record.workItemIds = input.workItemIds.map(x => text(x, 60)).filter(Boolean).slice(0, 100);
    record.history = [...(record.history || []), { ...previous, changedAt: now(), changedBy: text(input.changedBy, 80) || userName || userId }].slice(-20);
    syncDocumentNodesFromBody(workspace, record);
    setDocumentRevision(record);
    auditEvent(workspace, { action: "edit", objectType: "document", objectId: record.id, actor: actorFrom(identity), revision: record.revisionId, reason: text(input.reason, 500) || "Compatibility document update" });
    await writeWorkspace(workspace); return json(res, 200, record);
  }
  if (req.method === "POST" && url.pathname === "/api/links") {
    assertPermission(projectContext, "traceability");
    const input = await body(req); const from = text(input.from, 60), to = text(input.to, 60); if (!workspace.items.some(x => x.id === from) || !workspace.items.some(x => x.id === to)) return bad(res, "Both link endpoints must be existing work items");
    if (from === to) return bad(res, "A work item cannot link to itself");
    const fromRecord = workspace.items.find(x => x.id === from);
    const toRecord = workspace.items.find(x => x.id === to);
    assertItemScope(projectContext, fromRecord);
    assertItemScope(projectContext, toRecord);
    const role = text(input.role, 80) || "relates to";
    const definition = findLinkType(workspace, role);
    if (!definition && role !== "relates to") return bad(res, "Unknown link type; choose a registered relation");
    const sourceVersion = currentRevision(fromRecord);
    const targetVersion = currentRevision(toRecord);
    const record = { id: id("LNK"), from, to, role, type: definition?.id || "legacy-relates", status: input.candidate ? "candidate" : "unreviewed", sourceVersion, targetVersion, currentSourceVersion: sourceVersion, currentTargetVersion: targetVersion, revision: 1, locator: text(input.locator, 500) || null, createdAt: now(), createdBy: userId };
    workspace.links.unshift(record);
    auditEvent(workspace, { action: "link", objectType: "link", objectId: record.id, actor: actorFrom(identity), source: from, target: to, status: record.status });
    await writeWorkspace(workspace); return json(res, 201, record);
  }
  const linkMatch = url.pathname.match(/^\/api\/links\/([^/]+)\/status$/);
  if (linkMatch && req.method === "PUT") {
    assertPermission(projectContext, "traceability");
    const input = await body(req); const record = workspace.links.find(x => x.id === decodeURIComponent(linkMatch[1])); if (!record) return bad(res, "Link not found", 404);
    if (!["candidate", "valid", "suspect", "invalid", "unreviewed"].includes(input.status)) return bad(res, "Invalid link status");
    const source = workspace.items.find(item => item.id === record.from);
    const target = workspace.items.find(item => item.id === record.to);
    if (!source || !target) return bad(res, "Link endpoint not found", 404);
    assertItemScope(projectContext, source);
    assertItemScope(projectContext, target);
    const sourceRevision = currentRevision(source);
    const targetRevision = currentRevision(target);
    const reason = text(input.reason, 500);
    const locator = text(input.evidenceLocator || input.locator || record.locator, 500);
    if (Number.isSafeInteger(input.baseRevision) && Number(input.baseRevision) !== Number(record.revision || 1)) {
      return json(res, 409, { error: "Link changed since it was opened", currentRevision: record.revision || 1, record });
    }
    if (input.status === "valid") {
      if (!Number.isSafeInteger(input.baseRevision)) return bad(res, "A link revision is required before confirmation");
      if (!reason) return bad(res, "A confirmation reason is required");
      if (!locator) return bad(res, "A stable evidence locator or review basis is required");
      if (Number(input.sourceRevision || input.sourceVersion || sourceRevision) !== sourceRevision || Number(input.targetRevision || input.targetVersion || targetRevision) !== targetRevision) {
        return json(res, 409, { error: "Link endpoints changed; reload the current revisions before confirmation", sourceRevision, targetRevision, record });
      }
    } else if (["suspect", "invalid"].includes(input.status) && !reason) {
      return bad(res, "A review reason is required");
    }
    const previousStatus = record.status;
    record.status = input.status;
    record.currentSourceVersion = sourceRevision;
    record.currentTargetVersion = targetRevision;
    record.revision = Number(record.revision || 1) + 1;
    record.review = { actor: userId, at: now(), reason, evidenceLocator: locator || null, sourceRevision, targetRevision, linkRevision: record.revision };
    if (input.status === "valid") {
      record.sourceVersion = sourceRevision;
      record.targetVersion = targetRevision;
      record.locator = locator;
      record.reviewRequiredReason = null;
    } else if (input.status === "suspect") {
      record.reviewRequiredReason = reason;
    } else if (input.status === "invalid") {
      record.reviewRequiredReason = reason;
    }
    auditEvent(workspace, { action: "link-review", objectType: "link", objectId: record.id, actor: actorFrom(identity), previousStatus, status: record.status, reason, evidenceLocator: locator || null, sourceRevision, targetRevision, linkRevision: record.revision });
    await writeWorkspace(workspace); return json(res, 200, record);
  }
  if (req.method === "POST" && url.pathname === "/api/baselines") {
    assertPermission(projectContext, "forms");
    const input = await body(req); const title = text(input.title, 240); if (!title) return bad(res, "A baseline title is required");
    const snapshot = { items: structuredClone(workspace.items), documents: structuredClone(workspace.documents), links: structuredClone(workspace.links), attachments: (workspace.attachments || []).map(a => ({ id: a.id, sha256: a.sha256 || null, itemId: a.itemId, documentId: a.documentId })) };
    const record = { id: id("BL"), title, type: text(input.type, 40) || "workspace", status: "Frozen", createdAt: now(), createdBy: text(input.createdBy, 80) || userName || userId, itemVersions: workspace.items.map(x => ({ id: x.id, version: x.version, revision: currentRevision(x), contentHash: x.contentHash || null })), documentVersions: workspace.documents.map(x => ({ id: x.id, version: x.version })), manifestHash: contentHash(snapshot), snapshot };
    workspace.baselines.unshift(record);
    auditEvent(workspace, { action: "baseline", objectType: "baseline", objectId: record.id, actor: actorFrom(identity), manifestHash: record.manifestHash });
    await writeWorkspace(workspace); return json(res, 201, record);
  }
  if (req.method === "GET" && url.pathname === "/api/test-runs") return json(res, 200, workspace.testRuns || []);
  if (req.method === "POST" && url.pathname === "/api/test-runs") {
    assertPermission(projectContext, "forms");
    const input = await body(req); const title = text(input.title, 240); if (!title) return bad(res, "A test run title is required");
    const canUseProcess = processId => projectContext.processScopes?.includes("*") || projectContext.processScopes?.includes(processId);
    const record = { id: id("RUN"), title, build: text(input.build, 100), environment: text(input.environment, 160), status: "Not started", createdAt: now(), results: workspace.items.filter(x => /Test Case/.test(x.type) && canUseProcess(x.process)).map(x => ({ itemId: x.id, status: "Not run", actual: "" })) };
    workspace.testRuns = [record, ...(workspace.testRuns || [])]; await writeWorkspace(workspace); return json(res, 201, record);
  }
  const runMatch = url.pathname.match(/^\/api\/test-runs\/([^/]+)\/results\/([^/]+)$/);
  if (runMatch && req.method === "PUT") {
    assertPermission(projectContext, "forms");
    const input = await body(req); const run = (workspace.testRuns || []).find(x => x.id === decodeURIComponent(runMatch[1])); if (!run) return bad(res, "Test run not found", 404);
    const result = run.results.find(x => x.itemId === decodeURIComponent(runMatch[2])); if (!result) return bad(res, "Test case is not in this run", 404);
    assertItemScope(projectContext, workspace.items.find(item => item.id === result.itemId));
    if (!["Passed", "Failed", "Blocked", "Not run"].includes(input.status)) return bad(res, "Invalid test result status"); result.status = input.status; result.actual = text(input.actual, 1000); run.status = run.results.some(x => x.status === "Failed") ? "Failed" : run.results.every(x => x.status === "Passed") ? "Passed" : "In progress"; await writeWorkspace(workspace); return json(res, 200, run);
  }
  return bad(res, "API endpoint not found", 404);
}

let requestQueue = Promise.resolve();
const server = http.createServer((req, res) => {
  requestQueue = requestQueue.then(async () => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const apiPath = basePath && url.pathname.startsWith(`${basePath}/`) ? url.pathname.slice(basePath.length) : url.pathname;
      if (!["GET", "HEAD"].includes(req.method) && req.headers.origin) {
        const expected = `${String(req.headers["x-forwarded-proto"] || "http").split(",")[0]}://${req.headers["x-forwarded-host"] || req.headers.host}`;
        if (req.headers.origin !== expected) return bad(res, "Cross-origin mutation rejected", 403);
      }
      if (apiPath.startsWith("/api/")) await api(req, res, url);
      else if (apiPath.startsWith("/uploads/")) {
        const identity = await auditflowUser(req);
        if (!identity) return bad(res, "AuditFlow session required", 401);
        const projects = await auditflowProjects(req, identity);
        const projectContext = resolveProjectContext(req, url, identity, projects);
        if (!projectContext) return bad(res, "Choose an authorized AuditFlow project", 400);
        url.pathname = apiPath;
        if (!(await serveUpload(req, res, url, projectContext))) bad(res, "Upload not found", 404);
      } else await serveStatic(req, res);
    } catch (error) { bad(res, error instanceof SyntaxError ? "Invalid JSON payload" : error.message || "Server error", error.status || (error instanceof SyntaxError ? 400 : 500)); }
  }).catch(() => bad(res, "Server error", 500));
});
server.requestTimeout = 30000;
if (mysqlUrl) await ensureMysqlStorage();
server.listen(port, host, () => console.log(`FileAnalyst listening on http://${host}:${port}`));
