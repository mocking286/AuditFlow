const text = value => String(value ?? "").trim();

export function workItemField(item, field) {
  if (!item) return "";
  const custom = item.customFields && typeof item.customFields === "object" ? item.customFields : {};
  const aliases = {
    id: item.id,
    title: item.title,
    type: item.type,
    process: item.process,
    status: item.status,
    owner: item.owner,
    author: custom.author || item.author,
    assignees: custom.assignees || item.assignees || item.assignee,
    priority: custom.priority || item.priority,
    severity: custom.severity || item.severity,
    resolution: custom.resolution || item.resolution,
    timePoint: custom.timePoint || item.timePoint,
    remaining: custom.remainingEstimate || item.remainingEstimate,
    remainingEstimate: custom.remainingEstimate || item.remainingEstimate,
    initialEstimate: custom.initialEstimate || item.initialEstimate,
    timeSpent: custom.timeSpent || item.timeSpent,
    plannedIn: custom.plannedIn || item.plannedIn,
    plannedStart: custom.plannedStart || item.plannedStart,
    plannedEnd: custom.plannedEnd || item.plannedEnd,
    dueDate: custom.dueDate || item.dueDate,
    updated: item.updatedAt || item.updated,
    created: item.createdAt || item.created,
    version: item.version,
    revision: item.revision
  };
  return aliases[field] ?? custom[field] ?? item[field] ?? "";
}

export function itemSchedule(item) {
  const plannedIn = text(workItemField(item, "plannedIn"));
  const plannedStart = text(workItemField(item, "plannedStart"));
  const plannedEnd = text(workItemField(item, "plannedEnd"));
  const dueDate = text(workItemField(item, "dueDate"));
  const scheduled = Boolean(plannedIn || plannedStart || plannedEnd || dueDate);
  const group = plannedIn || (plannedStart ? plannedStart.slice(0, 7) : plannedEnd ? plannedEnd.slice(0, 7) : dueDate ? dueDate.slice(0, 7) : "Unscheduled");
  return { plannedIn, plannedStart, plannedEnd, dueDate, scheduled, group };
}

function compareValues(left, right) {
  const a = Array.isArray(left) ? left.join(", ") : text(left);
  const b = Array.isArray(right) ? right.join(", ") : text(right);
  const aNumber = Number(a);
  const bNumber = Number(b);
  if (a && b && Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function sortWorkItems(items, { key = "updated", direction = "desc" } = {}) {
  const sign = direction === "asc" ? 1 : -1;
  return items.map((item, index) => ({ item, index })).sort((a, b) => {
    const primary = compareValues(workItemField(a.item, key), workItemField(b.item, key));
    if (primary) return primary * sign;
    const fallback = compareValues(workItemField(a.item, "id"), workItemField(b.item, "id"));
    return fallback || a.index - b.index;
  }).map(entry => entry.item);
}

export function filterWorkItems(items, { query = "", type = "", timePoint = "", predicate } = {}) {
  const needle = text(query).toLowerCase();
  return items.filter(item => {
    if (type && text(workItemField(item, "type")) !== text(type)) return false;
    if (timePoint && text(workItemField(item, "timePoint")) !== text(timePoint)) return false;
    if (predicate && !predicate(item)) return false;
    if (!needle) return true;
    const values = ["id", "title", "type", "process", "status", "owner", "author", "assignees", "priority", "severity", "resolution", "timePoint", "plannedIn"]
      .map(field => workItemField(item, field));
    return values.some(value => String(Array.isArray(value) ? value.join(", ") : value).toLowerCase().includes(needle));
  });
}

function parentReference(item) {
  const parents = Array.isArray(item?.parents) ? item.parents : [];
  return text(item?.parentId || parents[0] || item?.customFields?.parentId);
}

function nodeOrder(a, b) {
  const aOrder = text(a.item.orderKey);
  const bOrder = text(b.item.orderKey);
  if (aOrder && !bOrder) return -1;
  if (!aOrder && bOrder) return 1;
  const order = compareValues(aOrder, bOrder);
  if (order) return order;
  return compareValues(workItemField(a.item, "id"), workItemField(b.item, "id"));
}

export function buildDocumentWorkItemTree(items, { sort = true } = {}) {
  const records = (Array.isArray(items) ? items : []).map((item, index) => ({
    item,
    id: text(item?.id) || `item-${index + 1}`,
    parentId: parentReference(item),
    children: [],
    depth: 0,
    outlineNumber: "",
    hasCycle: false,
    orphan: false
  }));
  const byId = new Map(records.map(node => [node.id, node]));
  const roots = [];
  records.forEach(node => {
    if (!node.parentId) {
      roots.push(node);
      return;
    }
    const parent = byId.get(node.parentId);
    if (!parent || parent.id === node.id) {
      node.orphan = Boolean(parent?.id === node.id) || !parent;
      roots.push(node);
      return;
    }
    parent.children.push(node);
  });
  const sortChildren = node => {
    if (sort) node.children.sort(nodeOrder);
    node.children.forEach(sortChildren);
  };
  if (sort) roots.sort(nodeOrder);
  roots.forEach(sortChildren);

  const visited = new Set();
  const walk = (node, depth, outline, path) => {
    if (path.has(node.id)) {
      node.hasCycle = true;
      node.children = [];
      return;
    }
    node.depth = depth;
    node.outlineNumber = outline;
    visited.add(node.id);
    const nextPath = new Set(path).add(node.id);
    node.children.forEach((child, index) => walk(child, depth + 1, `${outline}.${index + 1}`, nextPath));
  };
  roots.forEach((node, index) => walk(node, 0, String(index + 1), new Set()));
  records.filter(node => !visited.has(node.id)).forEach(node => {
    node.orphan = true;
    roots.push(node);
    walk(node, 0, String(roots.length), new Set());
  });
  return roots;
}

export function flattenTree(tree, { maxDepth = Infinity } = {}) {
  const output = [];
  const visit = node => {
    output.push(node);
    if (node.depth >= maxDepth) return;
    node.children.forEach(visit);
  };
  (Array.isArray(tree) ? tree : []).forEach(visit);
  return output;
}

export function filterTree(tree, query) {
  const needle = text(query).toLowerCase();
  if (!needle) return tree;
  const visit = node => {
    const match = filterWorkItems([node.item], { query: needle }).length > 0;
    const children = node.children.map(visit).filter(Boolean);
    if (!match && !children.length) return null;
    return { ...node, children };
  };
  return (Array.isArray(tree) ? tree : []).map(visit).filter(Boolean);
}

export function roadmapBuckets(items, { timePoint = "" } = {}) {
  const filtered = filterWorkItems(items, { timePoint });
  const groups = new Map();
  filtered.forEach(item => {
    const schedule = itemSchedule(item);
    const key = schedule.group;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ item, schedule });
  });
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === "Unscheduled") return 1;
    if (b === "Unscheduled") return -1;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  });
  return keys.map(key => ({
    key,
    scheduled: key !== "Unscheduled",
    items: sortWorkItems(groups.get(key).map(entry => entry.item), { key: "plannedStart", direction: "asc" })
  }));
}
