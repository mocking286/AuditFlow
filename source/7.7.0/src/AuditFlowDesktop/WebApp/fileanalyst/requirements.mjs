import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { parseDocument, stringify } from "yaml";

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const clean = (value, limit = 12000) => String(value ?? "").replace(/\u0000/g, "").trim().slice(0, limit);
const uidPattern = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
const requirement = record => /Requirement/.test(record.type || "");
export const fingerprint = record => createHash("sha256").update(JSON.stringify([
  record.title, record.body, record.verification, record.rationale, record.normative !== false,
  record.active !== false, record.documentId, record.parents || []
])).digest("hex");

export function migrateRequirements(workspace) {
  workspace.meta ||= {};
  workspace.meta.version = "6.5.0";
  workspace.meta.schemaVersion = Math.max(Number(workspace.meta.schemaVersion) || 1, 3);
  workspace.meta.requirementsRevision ||= 0;
  for (const key of ["items", "documents", "links", "baselines", "testRuns", "attachments", "requirementDocuments", "requirementEvents", "auditEvents", "savedQueries", "documentNodes", "linkTypes"]) workspace[key] ||= [];
  workspace.linkTypes ||= [];
  if (!workspace.linkTypes.length) workspace.linkTypes.push(
    { id: "derives-from", label: "derives from", sourceTypes: ["*"], targetTypes: ["*"], requiresEvidence: false },
    { id: "satisfies", label: "satisfies", sourceTypes: ["*"], targetTypes: ["*"], requiresEvidence: true },
    { id: "implemented-by", label: "implemented by", sourceTypes: ["*"], targetTypes: ["*"], requiresEvidence: true },
    { id: "verified-by", label: "verified by", sourceTypes: ["*"], targetTypes: ["*"], requiresEvidence: true },
    { id: "affected-by", label: "affected by", sourceTypes: ["*"], targetTypes: ["*"], requiresEvidence: false },
    { id: "evidences", label: "evidences", sourceTypes: ["*"], targetTypes: ["*"], requiresEvidence: true }
  );
  for (const record of workspace.items) {
    record.objectId ||= record.id;
    record.process ||= "SYS.2";
    record.revision ||= record.version || 1;
    record.revisionId ||= `${record.id}:r${record.revision}`;
    record.contentHash ||= fingerprint(record);
    record.sourceLocator ||= null;
  }
  for (const record of workspace.documents) {
    record.objectId ||= record.id;
    record.revision ||= Number(record.version) || 1;
    record.revisionId ||= `${record.id}:r${record.revision}`;
  }
  const needsLinkReviewMigration = Number(workspace.meta.linkReviewSchemaVersion) < 1;
  for (const link of workspace.links) {
    link.type ||= "legacy-relates";
    const source = workspace.items.find(item => item.id === link.from);
    const target = workspace.items.find(item => item.id === link.to);
    if (needsLinkReviewMigration && link.status === "valid" && !link.review?.actor) {
      link.status = "suspect";
      link.reviewRequiredReason = "Legacy confirmation has no reviewer and endpoint revision record";
    } else if (!["candidate", "valid", "suspect", "invalid", "unreviewed"].includes(link.status)) {
      link.status = "unreviewed";
    } else {
      link.status ||= "unreviewed";
    }
    link.sourceVersion ||= source?.revision || source?.version || 1;
    link.targetVersion ||= target?.revision || target?.version || 1;
    link.currentSourceVersion ||= source?.revision || source?.version || 1;
    link.currentTargetVersion ||= target?.revision || target?.version || 1;
    link.revision ||= 1;
    link.locator ||= null;
  }
  workspace.meta.linkReviewSchemaVersion = 1;
  if (!workspace.requirementDocuments.length) workspace.requirementDocuments.push({ id: "REQ", title: "Requirements", parent: null, prefix: "REQ", digits: 3 });
  for (const record of workspace.items.filter(requirement)) {
    record.documentId ||= "REQ";
    record.parents ||= [];
    record.parentFingerprints ||= {};
    record.active ??= true;
    record.normative ??= true;
    record.rationale ||= "";
    record.history ||= [];
  }
  return workspace;
}

export function requirementState(workspace) {
  const byId = new Map(workspace.items.map(record => [record.id, record]));
  return {
    revision: workspace.meta.requirementsRevision,
    documents: workspace.requirementDocuments,
    items: workspace.items.filter(requirement).map(record => ({ ...record,
      reviewCurrent: Boolean(record.review && record.review.fingerprint === fingerprint(record)),
      suspectParents: (record.parents || []).filter(parent => !byId.has(parent) || record.parentFingerprints?.[parent] !== fingerprint(byId.get(parent)))
    })),
    events: workspace.requirementEvents
  };
}

function cycle(nodes, edgeKey) {
  const indexed = new Map(nodes.map(record => [record.id, record]));
  const active = new Set(), complete = new Set();
  function visit(identifier) {
    if (active.has(identifier)) return true;
    if (complete.has(identifier) || !indexed.has(identifier)) return false;
    active.add(identifier);
    const raw = indexed.get(identifier)[edgeKey];
    const parents = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (parents.some(visit)) return true;
    active.delete(identifier); complete.add(identifier); return false;
  }
  return nodes.some(record => visit(record.id));
}

export function validateRequirements(workspace) {
  const state = requirementState(workspace), issues = [];
  const add = (severity, code, identifier, message) => issues.push({ severity, code, id: identifier, message });
  const documents = new Map(state.documents.map(record => [record.id, record]));
  const items = new Map(state.items.map(record => [record.id, record]));
  if (items.size !== state.items.length) add("error", "duplicate-uid", "", "Duplicate item IDs");
  if (documents.size !== state.documents.length) add("error", "duplicate-document", "", "Duplicate document IDs");
  if (cycle(state.documents, "parent")) add("error", "document-cycle", "", "Document hierarchy contains a cycle");
  if (cycle(state.items, "parents")) add("error", "trace-cycle", "", "Requirement links contain a cycle");
  for (const doc of state.documents) if (doc.parent && !documents.has(doc.parent)) add("error", "missing-document-parent", doc.id, "Parent document does not exist");
  for (const record of state.items) {
    if (!uidPattern.test(record.id)) add("error", "invalid-uid", record.id, "UID must be a safe, stable identifier");
    const doc = documents.get(record.documentId);
    if (!doc) add("error", "missing-document", record.id, "Requirement document does not exist");
    if (record.active === false) continue;
    if (!clean(record.body)) add("error", "empty-text", record.id, "Requirement text is empty");
    if (record.normative !== false && !clean(record.verification)) add("warning", "verification", record.id, "Define verification method and measurable acceptance criteria");
    if (doc?.parent && !record.parents.length && record.normative !== false) add("warning", "unlinked", record.id, "Child requirement has no parent trace");
    if (!record.reviewCurrent) add("warning", "review", record.id, "Human review is missing or outdated");
    for (const parent of record.parents || []) {
      if (!items.has(parent)) add("error", "missing-parent", record.id, `Missing parent: ${parent}`);
      else if (doc?.parent && items.get(parent).documentId !== doc.parent) add("error", "wrong-parent-document", record.id, `Parent ${parent} is not in ${doc.parent}`);
      if (record.suspectParents.includes(parent)) add("warning", "suspect", record.id, `Review changed or unconfirmed parent: ${parent}`);
    }
  }
  return { valid: !issues.some(issue => issue.severity === "error"), issues,
    counts: { requirements: state.items.length, errors: issues.filter(issue => issue.severity === "error").length, warnings: issues.filter(issue => issue.severity === "warning").length } };
}

function yamlObject(content) {
  if (typeof content !== "string" || content.length > 100000) fail("YAML file is missing or too large");
  const document = parseDocument(content, { schema: "core", uniqueKeys: true, resolveKnownTags: false });
  if (document.errors.length || document.warnings.length) fail("Invalid or unsupported YAML");
  const value = document.toJS({ maxAliasCount: 0 });
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Expected a YAML mapping");
  return value;
}

function importFiles(workspace, files) {
  if (!Array.isArray(files) || !files.length || files.length > 500) fail("Select 1–500 YAML files");
  const entries = files.map(file => {
    const name = String(file.path || "").replace(/\\/g, "/");
    if (!name || name.startsWith("/") || name.split("/").some(part => part === "..") || !/\.ya?ml$/i.test(name)) fail("Unsafe or unsupported YAML path");
    return { path: name, directory: path.posix.dirname(name), value: yamlObject(file.content) };
  });
  const documentPaths = new Map();
  for (const entry of entries.filter(record => path.posix.basename(record.path) === ".doorstop.yml")) {
    const settings = entry.value.settings || {}, prefix = clean(settings.prefix, 80);
    if (!uidPattern.test(prefix)) fail("Document prefix is missing or invalid");
    const existing = workspace.requirementDocuments.find(doc => doc.id === prefix);
    if (existing && !(prefix === "REQ" && !workspace.items.some(record => record.documentId === prefix) && !existing.parent && !settings.parent)) fail(`Document already exists: ${prefix}`, 409);
    const digits = Number(settings.digits || 3);
    if (!Number.isInteger(digits) || digits < 1 || digits > 8) fail("Invalid document digits");
    if (!existing) workspace.requirementDocuments.push({ id: prefix, prefix, title: prefix, digits, parent: settings.parent || null });
    documentPaths.set(entry.directory, prefix);
  }
  for (const entry of entries.filter(record => path.posix.basename(record.path) !== ".doorstop.yml")) {
    const source = entry.value;
    const identifier = path.posix.basename(entry.path).replace(/\.ya?ml$/i, "");
    if (!uidPattern.test(identifier)) fail(`Invalid item UID: ${identifier}`);
    if (workspace.items.some(record => record.id === identifier)) fail(`Item already exists: ${identifier}`, 409);
    if (source.links !== undefined && !Array.isArray(source.links)) fail("links must be a sequence");
    const parents = (source.links || []).map(link => typeof link === "string" ? link : link && typeof link === "object" && Object.keys(link).length === 1 ? Object.keys(link)[0] : fail("Invalid parent link"));
    if (parents.some(parent => !uidPattern.test(parent))) fail("Invalid parent UID");
    workspace.items.push({ id: identifier, type: "System Requirement", documentId: documentPaths.get(entry.directory) || "REQ",
      title: clean(source.header || identifier, 240), body: clean(source.text), verification: clean(source.verification),
      rationale: clean(source.rationale, 2000), active: source.active !== false, normative: source.normative !== false,
      parents: [...new Set(parents)], parentFingerprints: {}, status: "Draft", approval: "Pending review", version: 1,
      process: clean(source.process || "SYS.2", 40), evidenceRole: "index-only", history: [],
      imported: { source: "doorstop", path: entry.path, reviewed: clean(source.reviewed, 200), level: source.level ?? null }, updatedAt: new Date().toISOString() });
  }
  const result = validateRequirements(workspace);
  if (!result.valid) fail(result.issues.filter(issue => issue.severity === "error").map(issue => `${issue.id}: ${issue.message}`).join("; "));
}

export function changeRequirements(original, input, actor) {
  if (!input || typeof input !== "object") fail("Request must be an object");
  if (!Number.isSafeInteger(input.revision) || input.revision !== original.meta.requirementsRevision) fail("Requirements changed since they were opened; reload before saving", 409);
  const workspace = structuredClone(original);
  const timestamp = new Date().toISOString();
  let selected = null;
  if (input.action === "document") {
    const identifier = clean(input.id, 80);
    if (!uidPattern.test(identifier) || workspace.requirementDocuments.some(doc => doc.id === identifier)) fail("Document ID must be unique and safe");
    if (input.parent && !workspace.requirementDocuments.some(doc => doc.id === input.parent)) fail("Parent document not found");
    workspace.requirementDocuments.push({ id: identifier, prefix: identifier, digits: 3, title: clean(input.title || identifier, 240), parent: input.parent || null });
  } else if (input.action === "import") {
    importFiles(workspace, input.files);
  } else if (["create", "edit", "review", "clear"].includes(input.action)) {
    selected = workspace.items.find(record => record.id === input.id && requirement(record));
    if (input.action === "create") {
      const doc = workspace.requirementDocuments.find(record => record.id === input.documentId);
      if (!doc) fail("Document not found");
      let sequence = 1, identifier;
      do { identifier = `${doc.prefix}${String(sequence++).padStart(doc.digits, "0")}`; } while (workspace.items.some(record => record.id === identifier));
      selected = { id: identifier, type: "System Requirement", documentId: doc.id, process: clean(input.process || "SYS.2", 40), status: "Draft", approval: "Pending review", evidenceRole: "index-only", version: 0, history: [], parents: [], parentFingerprints: {}, active: true, normative: true };
      workspace.items.push(selected);
    } else if (!selected) fail("Requirement not found", 404);
    if (["edit", "create"].includes(input.action)) {
      const previous = structuredClone(selected);
      for (const field of ["title", "body", "verification", "rationale", "owner", "process"]) if (field in input) selected[field] = clean(input[field], field === "body" ? 12000 : 2000);
      if ("parents" in input) {
        if (!Array.isArray(input.parents) || input.parents.length > 100) fail("parents must be a list of at most 100 IDs");
        selected.parents = [...new Set(input.parents.map(parent => clean(parent, 80)))];
      }
      if (!selected.title || !selected.body) fail("Title and requirement text are required");
      selected.version += 1;
      selected.history.push({ ...previous, history: undefined, changedAt: timestamp, changedBy: actor.id });
    } else if (input.action === "review") {
      selected.review = { fingerprint: fingerprint(selected), by: actor.id, at: timestamp };
    } else {
      selected.parentFingerprints = Object.fromEntries(selected.parents.map(parent => {
        const parentItem = workspace.items.find(record => record.id === parent);
        if (!parentItem) fail(`Missing parent: ${parent}`);
        return [parent, fingerprint(parentItem)];
      }));
    }
    selected.updatedBy = actor.id; selected.updatedAt = timestamp;
    const validation = validateRequirements(workspace);
    if (!validation.valid) fail(validation.issues.filter(issue => issue.severity === "error").map(issue => issue.message).join("; "));
  } else if (input.action === "baseline") {
    const validation = validateRequirements(workspace);
    if (!validation.valid || validation.issues.length) fail("Resolve validation errors, review items, and clear suspect links before freezing a requirements baseline", 409);
    if (!clean(input.title)) fail("Baseline title is required");
    workspace.baselines.unshift({ id: `RBL-${randomUUID()}`, title: clean(input.title, 240), status: "Frozen snapshot", createdAt: timestamp, createdBy: actor.id,
      itemVersions: workspace.items.filter(requirement).map(record => ({ id: record.id, version: record.version })), documentVersions: [],
      requirements: structuredClone(requirementState(workspace)), validation });
  } else fail("Unknown requirements action");
  workspace.meta.requirementsRevision += 1;
  workspace.requirementEvents.push({ id: randomUUID(), action: input.action, itemId: selected?.id || input.id || null, by: actor.id, at: timestamp, revision: workspace.meta.requirementsRevision });
  return workspace;
}

export function exportRequirements(workspace) {
  const state = requirementState(workspace), files = [];
  for (const doc of state.documents) {
    files.push({ path: `${doc.id}/.doorstop.yml`, content: stringify({ settings: { prefix: doc.prefix, digits: doc.digits, sep: "", ...(doc.parent ? { parent: doc.parent } : {}) } }) });
    for (const record of state.items.filter(item => item.documentId === doc.id)) {
      files.push({ path: `${doc.id}/${record.id}.yml`, content: stringify({ active: record.active, normative: record.normative,
        derived: false, level: record.imported?.level || 1, header: record.title, text: record.body, links: record.parents,
        reviewed: null, verification: record.verification || "", rationale: record.rationale || "", process: record.process || "" }) });
    }
  }
  return { schema: "fileanalyst.doorstop-bundle/1", version: "6.5.0", revision: state.revision,
    policy: "Review fingerprints are FileAnalyst-specific. Doorstop must review exported items independently.", files, validation: validateRequirements(workspace) };
}
