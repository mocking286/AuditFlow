import { createHash } from "node:crypto";

const MAX_TEXT = 12000;
const safeText = (value, limit = MAX_TEXT) => String(value ?? "").replace(/\u0000/g, "").trim().slice(0, limit);
const safeId = value => safeText(value, 120).replace(/[^A-Za-z0-9_.:-]/g, "-");
const cleanHtml = value => safeText(value, 50000)
  .replace(/<\/?(script|style|iframe|object|embed|meta|link)[^>]*>/gi, "")
  .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
  .replace(/javascript\s*:/gi, "");

export function normalizeDocumentRecord(record = {}, fallbackIndex = 0) {
  const id = safeId(record.id) || `DOC-${String(fallbackIndex + 1).padStart(4, "0")}`;
  const version = String(record.version || "0.1");
  return {
    ...record,
    id,
    title: safeText(record.title || id, 240),
    space: safeText(record.space || "Requirements", 80),
    parentId: safeText(record.parentId || record.parent || "", 120) || null,
    documentType: safeText(record.documentType || record.type || "LiveDoc", 80),
    process: safeText(record.process || "", 40) || null,
    originalLanguage: safeText(record.originalLanguage || record.language || "", 32) || null,
    sourceFile: safeText(record.sourceFile || "", 255) || null,
    uploadedBy: safeText(record.uploadedBy || "", 191) || null,
    uploadedByName: safeText(record.uploadedByName || "", 255) || null,
    uploadedAt: record.uploadedAt || null,
    sourceLocator: record.sourceLocator && typeof record.sourceLocator === "object"
      ? structuredClone(record.sourceLocator)
      : (safeText(record.sourceLocator || "", 500) || null),
    status: safeText(record.status || "Draft", 40),
    version,
    revision: Number(record.revision || version.split(".")[0] || 1),
    revisionId: safeText(record.revisionId || `${id}:r${Number(record.revision || 1)}`, 160),
    body: cleanHtml(record.body || ""),
    workItemIds: [...new Set((Array.isArray(record.workItemIds) ? record.workItemIds : []).map(safeId).filter(Boolean))].slice(0, 500),
    baselineIds: [...new Set((Array.isArray(record.baselineIds) ? record.baselineIds : []).map(safeId).filter(Boolean))].slice(0, 100),
    nodeIds: [...new Set((Array.isArray(record.nodeIds) ? record.nodeIds : []).map(safeId).filter(Boolean))].slice(0, 5000),
    history: Array.isArray(record.history) ? record.history.slice(-50) : [],
    updatedAt: record.updatedAt || null
  };
}

export function buildDocumentTree(documents = []) {
  const records = documents.map((record, index) => normalizeDocumentRecord(record, index));
  const byId = new Map(records.map(record => [record.id, { ...record, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parentId && byId.get(node.parentId);
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }
  const sort = nodes => {
    nodes.sort((a, b) => `${a.space}/${a.title}`.localeCompare(`${b.space}/${b.title}`, undefined, { numeric: true, sensitivity: "base" }));
    nodes.forEach(child => sort(child.children));
    return nodes;
  };
  return sort(roots);
}

function documentHash(documentRecord, nodes = []) {
  return createHash("sha256").update(JSON.stringify({
    id: documentRecord.id,
    revision: documentRecord.revision,
    body: documentRecord.body,
    nodes: nodes.map(node => ({ nodeId: node.nodeId, revision: node.revision, content: node.content, parentId: node.parentId, orderKey: node.orderKey }))
  })).digest("hex");
}

export function buildDocumentBundle(workspace, actor = null) {
  const documents = (workspace.documents || []).map((record, index) => normalizeDocumentRecord(record, index));
  const documentIds = new Set(documents.map(record => record.id));
  const nodes = (workspace.documentNodes || [])
    .filter(node => documentIds.has(node.documentId))
    .map(node => ({
      nodeId: safeId(node.nodeId),
      documentId: safeId(node.documentId),
      parentId: node.parentId ? safeId(node.parentId) : null,
      orderKey: safeText(node.orderKey || "m", 80),
      nodeType: safeText(node.nodeType || "paragraph", 40),
      content: node.content && typeof node.content === "object" ? structuredClone(node.content) : {},
      styleProfile: node.styleProfile && typeof node.styleProfile === "object" ? structuredClone(node.styleProfile) : {},
      sourceLocator: node.sourceLocator && typeof node.sourceLocator === "object" ? structuredClone(node.sourceLocator) : (node.sourceLocator || null),
      revision: Number(node.revision || 1),
      createdAt: node.createdAt || null,
      updatedAt: node.updatedAt || null,
      tombstone: node.tombstone === true
    }));
  const itemIds = new Set(documents.flatMap(document => document.workItemIds));
  const items = (workspace.items || [])
    .filter(item => itemIds.has(item.id) || item.documentId && documentIds.has(item.documentId))
    .map(item => structuredClone(item));
  const exportedItemIds = new Set(items.map(item => item.id));
  const links = (workspace.links || []).filter(link => exportedItemIds.has(link.from) && exportedItemIds.has(link.to)).map(link => structuredClone(link));
  const attachments = (workspace.attachments || []).filter(attachment => documentIds.has(attachment.documentId) || exportedItemIds.has(attachment.itemId)).map(attachment => ({
    id: attachment.id,
    name: attachment.name,
    mime: attachment.mime,
    size: attachment.size,
    sha256: attachment.sha256,
    parseStatus: attachment.parseStatus,
    parserVersion: attachment.parserVersion,
    itemId: attachment.itemId || null,
    documentId: attachment.documentId || null,
    uploadedBy: attachment.uploadedBy || null,
    uploadedByName: attachment.uploadedByName || null,
    uploadedAt: attachment.uploadedAt || null,
    storage: "metadata-only"
  }));
  return {
    schema: "fileanalyst.document-library/v1",
    version: "1.0",
    product: "FileAnalyst",
    projectId: safeText(workspace.meta?.projectId || "", 191),
    exportedAt: new Date().toISOString(),
    exportedBy: actor ? { id: safeText(actor.id, 120), name: safeText(actor.name, 240) } : null,
    documents: documents.map(document => ({ ...document, contentHash: documentHash(document, nodes.filter(node => node.documentId === document.id)) })),
    nodes,
    items,
    links,
    attachments,
    attachmentPolicy: "Attachment metadata is included; binary content remains in project-scoped storage and is never duplicated by this bundle.",
    manifest: {
      sourceLocators: documents.filter(document => document.sourceLocator).map(document => ({ id: document.id, sourceLocator: document.sourceLocator })),
      revisions: documents.map(document => ({ id: document.id, revision: document.revision, revisionId: document.revisionId, baselineIds: document.baselineIds })),
      languages: [...new Set(documents.map(document => document.originalLanguage).filter(Boolean))],
      integrity: "sha256 contentHash per document; attachment binaries remain in project-scoped storage"
    }
  };
}

function duplicateIds(existing, incoming, field, label) {
  const known = new Set(existing.map(record => record[field]));
  for (const record of incoming) {
    const value = safeId(record[field]);
    if (!value) throw Object.assign(new Error(`${label} ID is required`), { status: 400 });
    if (known.has(value)) throw Object.assign(new Error(`${label} already exists: ${value}`), { status: 409 });
    known.add(value);
  }
}

function assertNoParentCycle(documents) {
  const byId = new Map(documents.map(document => [document.id, document]));
  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visiting.has(id)) throw Object.assign(new Error(`Document parent cycle includes ${id}`), { status: 400 });
    if (visited.has(id) || !id) return;
    const document = byId.get(id);
    if (!document) throw Object.assign(new Error(`Document parent not found: ${id}`), { status: 400 });
    visiting.add(id);
    visit(document.parentId);
    visiting.delete(id);
    visited.add(id);
  };
  documents.forEach(document => visit(document.id));
}

export function validateDocumentParents(documents = []) {
  assertNoParentCycle(documents.map((record, index) => normalizeDocumentRecord(record, index)));
  return true;
}

export function importDocumentBundle(workspace, bundle, actor = {}) {
  if (!bundle || bundle.schema !== "fileanalyst.document-library/v1") throw Object.assign(new Error("Unsupported FileAnalyst document bundle"), { status: 400 });
  if (!Array.isArray(bundle.documents) || bundle.documents.length > 500) throw Object.assign(new Error("Document bundle must contain 1–500 documents"), { status: 400 });
  const incomingDocuments = bundle.documents.map((record, index) => normalizeDocumentRecord(record, index));
  const incomingNodes = Array.isArray(bundle.nodes) ? bundle.nodes.slice(0, 20000) : [];
  const incomingItems = Array.isArray(bundle.items) ? bundle.items.slice(0, 20000).map(item => structuredClone(item)) : [];
  const incomingLinks = Array.isArray(bundle.links) ? bundle.links.slice(0, 50000).map(link => structuredClone(link)) : [];
  duplicateIds(workspace.documents || [], incomingDocuments, "id", "Document");
  duplicateIds(workspace.items || [], incomingItems, "id", "Work item");
  duplicateIds(workspace.documentNodes || [], incomingNodes.map(node => ({ ...node, nodeId: safeId(node.nodeId) })), "nodeId", "Document node");
  duplicateIds(workspace.links || [], incomingLinks, "id", "Trace link");
  const allDocuments = [...(workspace.documents || []).map(normalizeDocumentRecord), ...incomingDocuments];
  assertNoParentCycle(allDocuments);
  const documentIds = new Set(incomingDocuments.map(document => document.id));
  const itemIds = new Set([...workspace.items.map(item => item.id), ...incomingItems.map(item => item.id)]);
  for (const node of incomingNodes) {
    if (!documentIds.has(safeId(node.documentId))) throw Object.assign(new Error(`Node document not found: ${node.documentId}`), { status: 400 });
    if (node.parentId && !incomingNodes.some(parent => parent.nodeId === node.parentId) && !workspace.documentNodes.some(parent => parent.nodeId === node.parentId)) throw Object.assign(new Error(`Node parent not found: ${node.parentId}`), { status: 400 });
    node.nodeId = safeId(node.nodeId);
    node.documentId = safeId(node.documentId);
    node.parentId = node.parentId ? safeId(node.parentId) : null;
    node.content = node.content && typeof node.content === "object" ? structuredClone(node.content) : {};
    if (typeof node.content.html === "string") node.content.html = cleanHtml(node.content.html);
    node.revision = Number(node.revision || 1);
    node.tombstone = node.tombstone === true;
  }
  for (const item of incomingItems) {
    item.id = safeId(item.id);
    item.title = safeText(item.title || item.id, 240);
    item.body = safeText(item.body, MAX_TEXT);
    item.sourceImport = { ...(item.sourceImport || {}), source: "fileanalyst-document-library", importedAt: new Date().toISOString(), importedBy: safeText(actor.id || "unknown", 120) };
    item.revision = Number(item.revision || item.version || 1);
    item.version = Number(item.version || 1);
    item.revisionId = `${item.id}:r${item.revision}`;
  }
  for (const link of incomingLinks) {
    link.id = safeId(link.id);
    link.from = safeId(link.from);
    link.to = safeId(link.to);
    if (!itemIds.has(link.from) || !itemIds.has(link.to)) throw Object.assign(new Error(`Trace link endpoint not found: ${link.id}`), { status: 400 });
    link.status = ["candidate", "valid", "suspect", "invalid", "unreviewed"].includes(link.status) ? link.status : "unreviewed";
    link.sourceVersion = Number(link.sourceVersion || 1);
    link.targetVersion = Number(link.targetVersion || 1);
    link.currentSourceVersion = Number(link.currentSourceVersion || link.sourceVersion);
    link.currentTargetVersion = Number(link.currentTargetVersion || link.targetVersion);
    link.revision = Number(link.revision || 1);
  }
  for (const document of incomingDocuments) {
    document.nodeIds = incomingNodes.filter(node => node.documentId === document.id && !node.tombstone).sort((a, b) => String(a.orderKey).localeCompare(String(b.orderKey))).map(node => node.nodeId);
    document.imported = { source: "fileanalyst-document-library", importedAt: new Date().toISOString(), importedBy: safeText(actor.id || "unknown", 120) };
  }
  workspace.documents.push(...incomingDocuments);
  workspace.documentNodes.push(...incomingNodes);
  workspace.items.push(...incomingItems);
  workspace.links.push(...incomingLinks);
  const attachmentMetadata = Array.isArray(bundle.attachments) ? bundle.attachments.length : 0;
  return { documents: incomingDocuments.length, nodes: incomingNodes.length, items: incomingItems.length, links: incomingLinks.length, attachmentsSkipped: attachmentMetadata };
}

