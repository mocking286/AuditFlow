export const HELIX_EXPORT_CATEGORIES = Object.freeze([
  Object.freeze({ id: "task", label: "task" }),
  Object.freeze({ id: "re_tc", label: "RE/TC" }),
  Object.freeze({ id: "sw", label: "SW" }),
  Object.freeze({ id: "swa", label: "SWA" }),
  Object.freeze({ id: "sys", label: "SYS" }),
  Object.freeze({ id: "sysa", label: "SYSA" }),
  Object.freeze({ id: "cus_je", label: "CUS/JE" }),
  Object.freeze({ id: "swdd", label: "SWDD" }),
  Object.freeze({ id: "inf", label: "INF" }),
  Object.freeze({ id: "tit", label: "TIT" }),
  Object.freeze({ id: "unclassified", label: "Unclassified" })
]);

const CATEGORY_BY_ID = new Map(HELIX_EXPORT_CATEGORIES.map(category => [category.id, category]));
const CATEGORY_FIELDS = /^(?:category|classification|item ?type|artifact ?type|work ?product ?type|work ?item ?type|issue ?type|requirement ?type|document ?type|process(?: code)?|module)$/i;
const MODIFIED_FIELDS = /(?:modified|updated|last change|changed).*(?:at|date|time)?|(?:last modified|last updated)/i;
const VERSION_FIELDS = /^(?:version|revision|release|baseline|configuration item|ci version)$/i;
const OWNER_FIELDS = /^(?:owner|assigned to|assignee|responsible|responsible person|author)$/i;

function asText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    for (const key of ["label", "name", "text", "tag", "username", "dateTime", "date", "string", "value"]) {
      const text = asText(value[key]);
      if (text) return text;
    }
  }
  return "";
}

function normalizeToken(value) {
  return asText(value).toUpperCase().replace(/[\s_-]+/g, "").replace(/[()[\]]/g, "");
}

function codeCategory(value) {
  const token = normalizeToken(value);
  if (!token) return null;

  if (["TASK", "TASKS", "ACTIONITEM", "WORKTASK"].includes(token)) return "task";
  if (["RE", "REQ", "REQUIREMENT", "REQUIREMENTS", "TC", "TESTCASE", "TESTCASES", "RETC"].includes(token)) return "re_tc";
  if (["CUS", "JE", "CUSJE", "JEINTERNAL"].includes(token)) return "cus_je";
  if (["SW", "SOFTWARE", "SWE"].includes(token)) return "sw";
  if (["SWA", "SOFTWAREARCHITECTURE"].includes(token)) return "swa";
  if (["SYS", "SYSTEM"].includes(token)) return "sys";
  if (["SYSA", "SYSTEMARCHITECTURE"].includes(token)) return "sysa";
  if (["SWDD", "SOFTWAREDETAILDESIGN"].includes(token)) return "swdd";
  if (["INF", "INFO", "INFORMATION"].includes(token)) return "inf";
  if (["TIT"].includes(token)) return "tit";

  if (/^SWE(?:\.|$)/.test(asText(value).toUpperCase())) return "sw";
  if (/^SWA(?:\.|$)/.test(asText(value).toUpperCase())) return "swa";
  if (/^SYS(?:\.|$)/.test(asText(value).toUpperCase())) return "sys";
  if (/^SYSA(?:\.|$)/.test(asText(value).toUpperCase())) return "sysa";
  if (/^SWDD(?:\.|[-_]|$)/.test(asText(value).toUpperCase())) return "swdd";
  if (/^(?:CUS|JE)(?:\.|[-_]|\/|$)/.test(asText(value).toUpperCase())) return "cus_je";
  if (/^(?:RE|TC)(?:\.|[-_]|\/|$)/.test(asText(value).toUpperCase())) return "re_tc";
  if (/^TASK(?:\.|[-_]|$)/.test(asText(value).toUpperCase())) return "task";
  if (/^INF(?:\.|[-_]|$)/.test(asText(value).toUpperCase())) return "inf";
  if (/^TIT(?:\.|[-_]|$)/.test(asText(value).toUpperCase())) return "tit";
  return null;
}

function getFieldValue(fields, pattern) {
  for (const field of Array.isArray(fields) ? fields : []) {
    const label = asText(field?.label);
    if (!pattern.test(label)) continue;
    const value = asText(field?.value);
    if (value) return { value, label };
  }
  return null;
}

function getExplicitCategory(item) {
  for (const field of ["category", "classification", "itemType", "artifactType", "workProductType", "workItemType", "issueType", "requirementType", "documentType", "process", "processCode", "module"]) {
    const value = asText(item?.[field]);
    if (!value) continue;
    return { category: codeCategory(value) || "unclassified", source: field };
  }

  const fieldValue = getFieldValue(item?.fields, CATEGORY_FIELDS);
  if (fieldValue) return { category: codeCategory(fieldValue.value) || "unclassified", source: `field:${fieldValue.label}` };

  const tagCategory = codeCategory(item?.tag);
  if (tagCategory) return { category: tagCategory, source: "tag" };
  return null;
}

function categoryForItem(item) {
  const explicit = getExplicitCategory(item);
  if (explicit) return explicit;

  const kind = normalizeToken(item?.kind || item?.type || item?.sectionKey);
  const routeCategories = new Map([
    ["REQUIREMENTS", "re_tc"],
    ["DOCUMENTS", "re_tc"],
    ["TESTCASES", "re_tc"],
    ["TASK", "task"]
  ]);
  if (routeCategories.has(kind)) return { category: routeCategories.get(kind), source: "helix-section" };

  return { category: "unclassified", source: "unclassified" };
}

function parseModifiedAt(item) {
  const candidates = [
    ["modifiedAt", item?.modifiedAt],
    ["lastModifiedAt", item?.lastModifiedAt],
    ["updatedAt", item?.updatedAt],
    ["lastUpdatedAt", item?.lastUpdatedAt],
    ["modified", item?.modified],
    ["updated", item?.updated]
  ];

  for (const [source, rawValue] of candidates) {
    const raw = asText(rawValue);
    if (!raw) continue;
    const epoch = Date.parse(raw);
    if (Number.isFinite(epoch)) {
      return { modifiedAt: new Date(epoch).toISOString(), modifiedAtRaw: raw, modifiedAtSource: source, modifiedAtStatus: "available" };
    }
    return { modifiedAt: null, modifiedAtRaw: raw, modifiedAtSource: source, modifiedAtStatus: "invalid" };
  }

  const fieldValue = getFieldValue(item?.fields, MODIFIED_FIELDS);
  if (fieldValue?.value) {
    const epoch = Date.parse(fieldValue.value);
    if (Number.isFinite(epoch)) {
      return {
        modifiedAt: new Date(epoch).toISOString(),
        modifiedAtRaw: fieldValue.value,
        modifiedAtSource: `field:${fieldValue.label}`,
        modifiedAtStatus: "available"
      };
    }
    return { modifiedAt: null, modifiedAtRaw: fieldValue.value, modifiedAtSource: `field:${fieldValue.label}`, modifiedAtStatus: "invalid" };
  }

  return {
    modifiedAt: null,
    modifiedAtRaw: "",
    modifiedAtSource: "",
    modifiedAtStatus: "missing"
  };
}

function getVersionOrBaseline(item) {
  const direct = asText(item?.version) || asText(item?.revision) || asText(item?.release) || asText(item?.baseline);
  if (direct) return direct;
  return getFieldValue(item?.fields, VERSION_FIELDS)?.value || "";
}

function getOwner(item) {
  const direct = asText(item?.owner) || asText(item?.assignee) || asText(item?.assignedTo) || asText(item?.responsible);
  const candidate = direct || getFieldValue(item?.fields, OWNER_FIELDS)?.value || "";
  return candidate.includes("@") ? "" : candidate;
}

function stableId(item, section) {
  const identity = asText(item?.id) || asText(item?.number) || asText(item?.tag);
  if (identity) return identity;
  const fallback = asText(item?.summary) || asText(item?.name) || asText(item?.title) || "unidentified";
  return `${section || "helix"}:${fallback.slice(0, 120)}`;
}

function hasCorroboratingContent(item) {
  return Boolean(asText(item?.summary) || asText(item?.state) || (Array.isArray(item?.fields) && item.fields.length) || Number(item?.linkCount) > 0);
}

export function normalizeHelixExportItem(item, { sectionKey = "", sectionLabel = "", projectId = "", index = 0 } = {}) {
  const sourceItem = item && typeof item === "object" ? item : {};
  const category = categoryForItem(sourceItem);
  const modified = parseModifiedAt(sourceItem);
  const id = stableId(sourceItem, sectionKey || sourceItem.kind);
  const sourceLocator = asText(sourceItem.sourceLocator) || asText(sourceItem.locator) || `${asText(sourceItem.kind) || sectionKey || "Helix"}/${id}`;
  const evidenceRole = asText(sourceItem.evidenceRole) === "index-only" || !hasCorroboratingContent(sourceItem)
    ? "index-only"
    : "corroborating";
  const categoryDefinition = CATEGORY_BY_ID.get(category.category);

  return {
    ...sourceItem,
    id,
    stableId: id,
    projectId: asText(sourceItem.projectId) || projectId,
    sectionKey: asText(sourceItem.sectionKey) || sectionKey,
    sectionLabel: asText(sourceItem.sectionLabel) || sectionLabel,
    sourceUrl: asText(sourceItem.sourceUrl) || asText(sourceItem.self) || asText(sourceItem.ttstudioURL),
    category: category.category,
    categoryLabel: categoryDefinition?.label || "Unclassified",
    categorySource: category.source,
    sourceLocator,
    modifiedAt: modified.modifiedAt,
    modifiedAtRaw: modified.modifiedAtRaw,
    modifiedAtSource: modified.modifiedAtSource,
    modifiedAtStatus: modified.modifiedAtStatus,
    owner: getOwner(sourceItem),
    versionOrBaseline: getVersionOrBaseline(sourceItem),
    evidenceRole,
    formalEvidenceRole: "non-direct"
  };
}

export function extractHelixExportRecords(snapshot) {
  const projectId = asText(snapshot?.project?.idOrName) || asText(snapshot?.project?.id) || "";
  const records = [];
  for (const section of Array.isArray(snapshot?.sections) ? snapshot.sections : []) {
    const sectionKey = asText(section?.key);
    const sectionLabel = asText(section?.label);
    const items = Array.isArray(section?.items) ? section.items : [];
    items.forEach((item, index) => records.push(normalizeHelixExportItem(item, {
      sectionKey,
      sectionLabel,
      projectId,
      index
    })));
  }
  return records;
}

function parseFilterDate(value) {
  if (!value) return null;
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new TypeError("modifiedSince must be a valid date");
  return epoch;
}

function compareStableId(a, b) {
  const left = String(a.stableId || a.id);
  const right = String(b.stableId || b.id);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function filterAndSortHelixItems(items, {
  categories = [],
  modifiedSince = "",
  includeUndated = undefined,
  limit = 1500
} = {}) {
  const normalized = (Array.isArray(items) ? items : []).map((item, index) => item?.category
    ? item
    : normalizeHelixExportItem(item, { index }));
  const requestedCategories = new Set((Array.isArray(categories) ? categories : [categories])
    .map(value => codeCategory(value) || asText(value).toLowerCase())
    .filter(value => CATEGORY_BY_ID.has(value)));
  const cutoff = parseFilterDate(modifiedSince);
  const keepUndated = includeUndated ?? cutoff == null;
  const matched = normalized.filter(item => !requestedCategories.size || requestedCategories.has(item.category));
  const dated = [];
  const undated = [];

  for (const item of matched) {
    const epoch = item.modifiedAt ? Date.parse(item.modifiedAt) : NaN;
    if (Number.isFinite(epoch)) {
      if (cutoff == null || epoch >= cutoff) dated.push(item);
    } else if (keepUndated) {
      undated.push(item);
    }
  }

  dated.sort((a, b) => {
    const delta = Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt);
    return delta || compareStableId(a, b);
  });
  undated.sort(compareStableId);

  const available = [...dated, ...undated];
  const maxItems = Number.isFinite(Number(limit)) ? Math.max(0, Math.min(1500, Math.floor(Number(limit)))) : 1500;
  const selected = available.slice(0, maxItems);
  const selectedDated = selected.filter(item => Number.isFinite(Date.parse(item.modifiedAt)));
  const selectedUndated = selected.filter(item => !Number.isFinite(Date.parse(item.modifiedAt)));
  return {
    items: selected,
    datedItems: selectedDated,
    undatedItems: selectedUndated,
    totalMatches: available.length,
    hasMore: available.length > selected.length,
    modifiedSince: cutoff == null ? "" : new Date(cutoff).toISOString()
  };
}

export function buildHelixCategoryExports(snapshot, options = {}) {
  const records = extractHelixExportRecords(snapshot);
  const requested = Array.isArray(options.categories) && options.categories.length
    ? new Set(options.categories.map(value => codeCategory(value) || asText(value).toLowerCase()))
    : null;

  return HELIX_EXPORT_CATEGORIES
    .filter(category => !requested || requested.has(category.id))
    .map(category => {
      const result = filterAndSortHelixItems(records, { ...options, categories: [category.id] });
      return {
        category: category.id,
        label: category.label,
        items: result.items,
        datedCount: result.datedItems.length,
        undatedCount: result.undatedItems.length,
        totalMatches: result.totalMatches,
        hasMore: result.hasMore
      };
    });
}

export function createHelixCategoryExport(categoryExport, {
  projectId = "",
  exportedAt = new Date().toISOString()
} = {}) {
  const category = CATEGORY_BY_ID.get(categoryExport?.category) || CATEGORY_BY_ID.get("unclassified");
  return {
    schema: "jeauditflow.helix-category-export/1",
    projectId: asText(projectId),
    category: category.id,
    categoryLabel: category.label,
    exportedAt,
    itemCount: Array.isArray(categoryExport?.items) ? categoryExport.items.length : 0,
    evidencePolicy: "Helix records are corroborating or index-only and are never direct target-process evidence by themselves.",
    items: Array.isArray(categoryExport?.items) ? categoryExport.items : []
  };
}
