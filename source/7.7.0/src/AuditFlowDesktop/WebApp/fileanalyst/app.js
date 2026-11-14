import { mountRequirements } from "./requirements.js";
import {
  buildDocumentWorkItemTree,
  filterTree,
  filterWorkItems,
  flattenTree,
  itemSchedule,
  roadmapBuckets,
  sortWorkItems,
  workItemField
} from "./view-models.mjs";

function secureRandomUuid(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== "function") {
    throw new Error("Web Crypto secure random values are unavailable");
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const state = {
  workspace: null,
  projects: [],
  projectId: "",
  returnProjectId: "",
  projectError: "",
  view: routeView(),
  selectedItem: null,
  selectedDocument: null,
  detailTab: "properties",
  filter: "",
  documentFilter: "",
  traceFilter: "",
  typeFilter: "",
  treeFilter: "",
  treeDepth: Infinity,
  tableSortKey: "updated",
  tableSortDirection: "desc",
  tableTimePoint: "",
  tableColumns: ["type", "id", "title", "priority", "severity", "status", "resolution", "author", "assignees", "timePoint", "created", "updated"],
  roadmapTimePoint: "",
  toast: "",
  collaboration: { documentId: "", clientId: sessionStorage.getItem("fileanalyst.clientId") || secureRandomUuid(), presence: [], locks: [], comments: [], status: "saved", timer: null }
};
sessionStorage.setItem("fileanalyst.clientId", state.collaboration.clientId);
const localRouteBasePath = String(window.FILEANALYST_BASE_PATH || "").replace(/\/$/, "");
const apiBasePath = String(
  window.FILEANALYST_API_BASE_URL || localRouteBasePath
).replace(/\/$/, "");
const apiPath = path => `${apiBasePath}${path}`;
const routePath = path => String(path).startsWith("/uploads/")
  ? apiPath(path)
  : `${localRouteBasePath}${path}`;

const navItems = [
  ["home", "⌂", "Home"], ["dashboard", "◉", "Dashboard"], ["requirements", "◇", "Requirements"],
  ["design", "⌁", "Design"], ["risks", "⚠", "Risks"], ["planning", "⚑", "Planning"],
  ["development", "⌘", "Development"], ["testing", "✓", "Testing"], ["maintenance", "◌", "Maintenance"],
  ["items", "✣", "Work Items"], ["tree", "⌄", "Tree"], ["matrix", "▦", "Matrix"], ["glossary", "Aa", "Glossary"]
];
const desktopMode = new URLSearchParams(window.location.search).get("desktop") === "1";
const esc = value => String(value ?? "").replace(/[&<>\"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch]));
const translateUi = value => typeof window.FileAnalystI18n?.translate === "function" ? window.FileAnalystI18n.translate(String(value ?? "")) : String(value ?? "");
const displayError = (error, fallback = "FileAnalyst could not load this workspace.") => {
  const translated = translateUi(error?.message || fallback);
  return window.FileAnalystI18n?.isEnglish?.() && /[\u3400-\u9fff\uf900-\ufaff]/.test(translated)
    ? fallback
    : translated || fallback;
};
const label = value => ({ "System Requirement": "System Requirement", "Software Design": "Software Design", "Software Test Case": "Software Test Case", "System Test Case": "System Test Case", "Problem Report": "Problem Report", "Change Request": "Change Request" }[value] || value);
const statusClass = value => String(value || "").toLowerCase().replace(/\s+/g, "-");
const linkStatusLabel = value => ({ valid: "Valid", suspect: "Suspect", invalid: "Rejected", candidate: "Candidate", unreviewed: "Unreviewed" }[value] || value || "Unreviewed");
const tableColumnLabels = {
  type: "Type", id: "ID", title: "Title", priority: "Priority", severity: "Severity", status: "Status",
  resolution: "Resolution", author: "Author", assignees: "Assignee(s)", timePoint: "Time Point",
  remaining: "Remaining", created: "Created", updated: "Updated"
};
const tableColumnWidths = {
  type: "minmax(145px, 1fr)", id: "minmax(105px, .8fr)", title: "minmax(240px, 1.8fr)", priority: "minmax(105px, .8fr)",
  severity: "minmax(105px, .8fr)", status: "minmax(125px, 1fr)", resolution: "minmax(120px, 1fr)", author: "minmax(135px, 1fr)",
  assignees: "minmax(135px, 1fr)", timePoint: "minmax(120px, .9fr)", remaining: "minmax(110px, .8fr)", created: "minmax(115px, .9fr)", updated: "minmax(115px, .9fr)"
};
const dateText = value => value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "-";
const shortDate = value => value ? new Date(value).toLocaleDateString("en-GB") : "-";
const itemById = id => state.workspace.items.find(item => item.id === id);
const canMutate = () => state.workspace?.identity?.permissions?.use !== false;
const currentRevision = record => Number(record?.revision || record?.version || 1);
const typeIcon = type => /Test Case/.test(type) ? "◒" : /Requirement/.test(type) ? "▣" : /Design/.test(type) ? "◈" : /Problem|Change/.test(type) ? "⚠" : "◇";
const formatBytes = value => { const n = Number(value) || 0; return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`; };
const projectName = () => state.workspace?.meta?.project || "AuditFlow project";
const currentUserName = () => state.workspace?.identity?.name || "AuditFlow user";
const currentUserInitials = () => currentUserName().split(/\s+/).filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "AF";
const workItemConfiguration = () => state.workspace?.workItemConfiguration || { fields: [], presentation: [], workflow: { statuses: [] }, relationTypes: [] };
const customFieldValue = (item, field) => {
  const value = item?.customFields?.[field.id];
  if (Array.isArray(value)) return value.join(", ");
  return value ?? "";
};
function customFieldEditor(field, item) {
  const value = customFieldValue(item, field);
  const options = Array.isArray(field.options) ? field.options : [];
  const input = field.type === "select"
    ? `<select data-custom-edit="${esc(field.id)}" data-custom-type="${esc(field.type)}">${options.map(option => `<option value="${esc(option)}" ${String(option) === String(value) ? "selected" : ""}>${esc(option)}</option>`).join("")}</select>`
    : field.type === "date"
      ? `<input type="date" data-custom-edit="${esc(field.id)}" data-custom-type="${esc(field.type)}" value="${esc(value)}">`
      : field.type === "links" || field.type === "tags"
        ? `<input data-custom-edit="${esc(field.id)}" data-custom-type="${esc(field.type)}" value="${esc(value)}" placeholder="Comma-separated values">`
        : `<input data-custom-edit="${esc(field.id)}" data-custom-type="${esc(field.type)}" value="${esc(value)}">`;
  return `<label class="polarion-custom-field"><span>${esc(field.label)}</span>${input}</label>`;
}
function customFieldSections(item) {
  const config = workItemConfiguration();
  return (config.presentation || []).map(section => {
    const fields = (section.fields || []).map(id => config.fields.find(field => field.id === id)).filter(Boolean);
    if (!fields.length) return "";
    return `<section class="drawer-property-section"><div class="drawer-section-title">${esc(section.label)} <span>${fields.length}</span></div><div class="custom-field-grid">${fields.map(field => customFieldEditor(field, item)).join("")}</div></section>`;
  }).join("");
}
function customFieldSummary(item) {
  const fields = workItemConfiguration().fields || [];
  return fields.map(field => {
    const value = customFieldValue(item, field);
    return value ? `<span><small>${esc(field.label)}</small><strong>${esc(value)}</strong></span>` : "";
  }).join("");
}
const uploadUrl = attachmentId => {
  const query = new URLSearchParams({ project: state.projectId || state.workspace?.meta?.projectId || "" });
  return `${apiPath(`/uploads/${encodeURIComponent(attachmentId)}`)}?${query.toString()}`;
};

function requestedProjectId() {
  return new URLSearchParams(window.location.search).get("project") || sessionStorage.getItem("fileanalyst.projectId") || "";
}

function auditFlowProjectId(projectId) {
  const value = String(projectId || "").trim();
  const sharedMarker = "::shared::";
  const markerIndex = value.indexOf(sharedMarker);
  return markerIndex >= 0 ? value.slice(markerIndex + sharedMarker.length) : value;
}

function updateProjectUrl(projectId) {
  const params = new URLSearchParams(window.location.search);
  if (projectId) {
    params.set("project", projectId);
    sessionStorage.setItem("fileanalyst.projectId", projectId);
  } else {
    params.delete("project");
    sessionStorage.removeItem("fileanalyst.projectId");
  }
  const query = params.toString();
  history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
}

function auditFlowUrl(hash = "") {
  const normalizedHash = hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";
  const runtime = globalThis.chrome?.runtime;
  if (runtime && typeof runtime.getURL === "function") {
    return runtime.getURL(`index.html${normalizedHash}`);
  }
  return new URL(`../index.html${normalizedHash}`, window.location.href).href;
}

function routeView() {
  const path = `${location.pathname}${location.hash}`.toLowerCase();
  if (path.includes("dashboard")) return "dashboard";
  if (path.includes("library")) return "library";
  if (path.includes("workitems") || path.includes("work-items")) return "items";
  if (path.includes("roadmap") || path.includes("planning")) return "roadmap";
  if (path.includes("tree")) return "tree";
  if (path.includes("matrix")) return "matrix";
  if (path.includes("testing") || path.includes("test-runs")) return "runs";
  if (path.includes("requirements")) return "requirements";
  if (path.includes("design")) return "design";
  if (path.includes("trace")) return "trace";
  if (path.includes("baseline")) return "baselines";
  if (path.includes("admin")) return "admin";
  if (path.includes("glossary")) return "glossary";
  return "home";
}

async function api(path, options = {}) {
  const sessionToken = window.opener?.AuditFlowAuth?.sessionToken || window.AuditFlowAuth?.sessionToken || sessionStorage.getItem("auditflow_session_token") || "";
  const projectHeader = state.projectId || requestedProjectId();
  const response = await fetch(apiPath(path), { credentials: "include", headers: { "content-type": "application/json", ...(sessionToken ? { "x-auditflow-session": sessionToken } : {}), ...(projectHeader ? { "x-auditflow-project-id": projectHeader } : {}), ...(options.headers || {}) }, ...options });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

const collaborationResource = value => encodeURIComponent(value);
const documentNodes = documentId => (state.workspace?.documentNodes || [])
  .filter(node => node.documentId === documentId && !node.tombstone && !String(node.nodeId).endsWith(":root"))
  .sort((a, b) => String(a.orderKey).localeCompare(String(b.orderKey)));
const operationId = () => secureRandomUuid();

async function loadDocumentCollaboration(documentId) {
  if (!documentId) return;
  const resourceId = `document:${documentId}`;
  try {
    state.collaboration.documentId = documentId;
    state.collaboration.status = "saved";
    await api("/api/collaboration/presence", { method: "POST", body: JSON.stringify({ resourceId, clientId: state.collaboration.clientId, mode: "edit" }) });
    const [presence, locks, comments] = await Promise.all([
      api(`/api/collaboration/presence?resourceId=${collaborationResource(resourceId)}`),
      api(`/api/collaboration/locks?resourceId=${collaborationResource(resourceId)}`),
      api(`/api/collaboration/comments?resourceId=${collaborationResource(resourceId)}`)
    ]);
    state.collaboration.presence = presence;
    state.collaboration.locks = locks;
    state.collaboration.comments = comments;
    updateCollaborationChrome();
    if (state.collaboration.timer) clearInterval(state.collaboration.timer);
    state.collaboration.timer = window.setInterval(async () => {
      try {
        await api("/api/collaboration/presence", { method: "POST", body: JSON.stringify({ resourceId, clientId: state.collaboration.clientId, mode: "edit" }) });
        state.collaboration.presence = await api(`/api/collaboration/presence?resourceId=${collaborationResource(resourceId)}`);
        state.collaboration.locks = await api(`/api/collaboration/locks?resourceId=${collaborationResource(resourceId)}`);
        updateCollaborationChrome();
      } catch (_) { state.collaboration.status = "offline"; updateCollaborationChrome(); }
    }, 45_000);
  } catch (error) {
    state.collaboration.status = error.status === 403 ? "view-only" : "offline";
    updateCollaborationChrome();
  }
}

function updateCollaborationChrome() {
  const status = document.querySelector("#editor-collaboration-status");
  if (status) status.textContent = state.collaboration.status;
  const participants = document.querySelector("#editor-participants");
  if (participants) participants.textContent = `${state.collaboration.presence.length} active`;
  const lock = document.querySelector("#editor-lock-status");
  if (lock) {
    const current = state.collaboration.locks.find(item => item.resourceId === `document:${state.collaboration.documentId}`);
    lock.textContent = current ? `Lock: ${current.ownerId === currentUserId() ? "you" : current.ownerName}` : "No structural lock";
  }
}

const currentUserId = () => state.workspace?.identity?.id || "unknown";

async function refreshDocumentCollaboration() {
  const documentId = state.collaboration.documentId;
  if (!documentId) return;
  const resourceId = `document:${documentId}`;
  const [presence, locks, comments] = await Promise.all([
    api(`/api/collaboration/presence?resourceId=${collaborationResource(resourceId)}`),
    api(`/api/collaboration/locks?resourceId=${collaborationResource(resourceId)}`),
    api(`/api/collaboration/comments?resourceId=${collaborationResource(resourceId)}`)
  ]);
  state.collaboration.presence = presence;
  state.collaboration.locks = locks;
  state.collaboration.comments = comments;
  updateCollaborationChrome();
}

async function submitDocumentOperation(documentId, operationType, target, payload, baseRevision, reason = "Document draft edit") {
  const resourceId = `document:${documentId}`;
  state.collaboration.status = "saving";
  updateCollaborationChrome();
  const result = await api(`/api/collaboration/resources/${collaborationResource(resourceId)}/operations`, {
    method: "POST",
    body: JSON.stringify({
      operationId: operationId(),
      clientId: state.collaboration.clientId,
      resourceId,
      baseRevision,
      operationType,
      target,
      payload,
      reason
    })
  });
  state.collaboration.status = "saved";
  return result;
}

async function loadWorkspaceForProject(projectId) {
  state.projectId = String(projectId || "");
  state.returnProjectId = auditFlowProjectId(state.projectId);
  state.workspace = await api("/api/workspace");
  state.projectError = "";
  updateProjectUrl(state.projectId);
}

async function bootWorkspace() {
  state.projects = await api("/api/projects");
  const requested = requestedProjectId();
  const selected = state.projects.find(project => project.id === requested)
    || (state.projectId && state.projects.find(project => project.id === state.projectId))
    || (state.projects.length === 1 ? state.projects[0] : null);
  if (!selected) {
    state.workspace = null;
    state.projectId = "";
    return;
  }
  await loadWorkspaceForProject(selected.id);
}

function projectChooserView() {
  const options = state.projects.map(project => `<option value="${esc(project.id)}">${esc(project.name)} · ${esc(project.role || "Viewer")}</option>`).join("");
  document.querySelector("#app").innerHTML = `<main class="project-chooser">
    <section class="polarion-panel project-chooser-panel">
      <span class="drawer-eyebrow">FILEANALYST 6.5.0 · AUDITFLOW CONTEXT</span>
      <h1>Select an authorized project</h1>
      <p>FileAnalyst data is isolated by AuditFlow project. Choose the project whose documents, work items and trace links you want to open.</p>
      ${state.projectError ? `<p class="rm-status">${esc(state.projectError)}</p>` : ""}
      ${state.projects.length ? `<label>AuditFlow project<select id="project-picker">${options}</select></label><button class="tool-button primary-tool" data-action="select-project">Open project</button>` : `<div class="empty-state"><strong>No authorized projects</strong><span>Ask an AuditFlow administrator to grant project access.</span></div>`}
    </section>
  </main>`;
  const picker = document.querySelector("#project-picker");
  const open = document.querySelector("[data-action='select-project']");
  if (open && picker) open.onclick = async () => {
    try {
      await loadWorkspaceForProject(picker.value);
      state.view = routeView();
      render();
    } catch (error) {
      state.projectError = displayError(error);
      projectChooserView();
    }
  };
}

function notify(message) {
  state.toast = message;
  render();
  window.setTimeout(() => { state.toast = ""; render(); }, 2800);
}

function requestText({ title, label = "Value", value = "", placeholder = "", multiline = false, submitLabel = "Continue" }) {
  return new Promise(resolve => {
    document.querySelector(".fa-dialog-backdrop")?.remove();
    const backdrop = document.createElement("div");
    const fieldId = `fa-dialog-field-${secureRandomUuid()}`;
    backdrop.className = "fa-dialog-backdrop";
    backdrop.innerHTML = `<section class="fa-dialog" role="dialog" aria-modal="true" aria-labelledby="${fieldId}-title"><form><div class="fa-dialog-header"><h2 id="${fieldId}-title">${esc(title)}</h2><button type="button" class="fa-dialog-close" data-dialog-cancel aria-label="Close">×</button></div><label for="${fieldId}">${esc(label)}${multiline ? `<textarea id="${fieldId}" data-dialog-field rows="4" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input id="${fieldId}" data-dialog-field value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">`}</label><div class="fa-dialog-actions"><button type="button" class="tool-button" data-dialog-cancel>Cancel</button><button type="submit" class="tool-button primary-tool">${esc(submitLabel)}</button></div></form></section>`;
    document.body.append(backdrop);
    const field = backdrop.querySelector("[data-dialog-field]");
    const finish = result => {
      backdrop.remove();
      resolve(result);
    };
    backdrop.querySelector("form").onsubmit = event => {
      event.preventDefault();
      finish(field.value.trim());
    };
    backdrop.querySelectorAll("[data-dialog-cancel]").forEach(button => { button.onclick = () => finish(null); });
    backdrop.onclick = event => { if (event.target === backdrop) finish(null); };
    field.focus();
    if (typeof field.select === "function") field.select();
  });
}

function navigate(view) {
  state.view = view;
  state.selectedItem = null;
  state.selectedDocument = null;
  const route = view === "home" ? "wiki/Home" : view === "items" ? "workitems" : view === "planning" ? "roadmap" : view;
  history.replaceState({}, "", routePath(`/project/${encodeURIComponent(state.workspace.meta.projectId || "drivepilot")}/${route}`));
  render();
}

function shell(content) {
  const w = state.workspace;
  const counts = {
    items: w.items.length,
    requirements: w.items.filter(i => /Requirement/.test(i.type)).length,
    links: w.links.length,
    runs: (w.testRuns || []).length
  };
  document.querySelector("#app").innerHTML = `<div class="polarion-shell">
    <header class="polarion-topbar">
      <button class="desktop-return" type="button" data-action="back-auditflow" aria-label="Back to AuditFlow" title="Back to AuditFlow"><span aria-hidden="true">←</span><span>AuditFlow</span></button>
      <div class="fileanalyst-wordmark"><span class="wordmark-mark">F</span><span>FileAnalyst</span><small>6.5.0</small></div>
      <div class="topbar-project">${state.projects.length > 1 ? `<select id="project-switcher" aria-label="AuditFlow project">${state.projects.map(project => `<option value="${esc(project.id)}" ${project.id === state.projectId ? "selected" : ""}>${esc(project.name)}</option>`).join("")}</select>` : esc(w.meta.project)} <span>⌄</span></div>
      <div class="topbar-spacer"></div>
      <button class="topbar-icon" data-action="global-search" title="Search">⌕</button>
      <button class="topbar-icon" data-action="new-item" title="Create work item">＋</button>
      <button class="topbar-language" type="button" data-fileanalyst-language title="Switch language" aria-label="Switch language">Chinese</button>
      <span class="topbar-status"><i></i> connected</span>
      <button class="user-menu" data-view="admin"><span class="user-avatar">${esc(w.identity?.name?.slice(0, 2) || "AF")}</span><span>${esc(w.identity?.name || "AuditFlow user")}</span><b>⌄</b></button>
    </header>
    <div class="polarion-body">
      <aside class="polarion-sidebar">
      <div class="project-mark"><div class="diamond">◇</div><strong>${esc(projectName())}</strong><span>⌄</span></div>
        <div class="sidebar-search"><span>⌕</span><input id="global-search" placeholder="Search" value="${esc(state.filter)}"></div>
        <div class="identity-card"><div class="identity-avatar">${esc(currentUserInitials())}</div><div><strong>${esc(currentUserName())}</strong><small>${state.workspace?.identity?.mode === "local" || state.workspace?.identity?.id === "local-preview" ? "Local verification session" : "Authenticated AuditFlow session"}</small></div><span>⌄</span></div>
        <nav class="polarion-nav">
        <button class="polarion-nav-item" data-view="library"><span class="nav-icon">▤</span><span>Requirements 6.5.0</span></button>
          ${navItems.map(([id, icon, title]) => `<button class="polarion-nav-item ${state.view === id || (id === "planning" && state.view === "roadmap") ? "active" : ""}" data-view="${id}"><span class="nav-icon">${icon}</span><span>${title}</span>${id === "items" ? `<b>${counts.items}</b>` : id === "requirements" ? `<b>${counts.requirements}</b>` : id === "testing" ? `<b>${counts.runs}</b>` : id === "glossary" ? `<b>${(w.glossary || []).length}</b>` : ""}</button>`).join("")}
        </nav>
        <div class="sidebar-divider"></div>
        <button class="polarion-nav-item ${state.view === "trace" ? "active" : ""}" data-view="trace"><span class="nav-icon">⌁</span><span>Traceability</span><b>${counts.links}</b></button>
        <button class="polarion-nav-item ${state.view === "baselines" ? "active" : ""}" data-view="baselines"><span class="nav-icon">◫</span><span>Baselines</span></button>
        <button class="polarion-nav-item ${state.view === "admin" ? "active" : ""}" data-view="admin"><span class="nav-icon">⚙</span><span>Administration</span></button>
        <div class="sidebar-footer"><span class="online-dot"></span> ${esc(w.storage || "Project workspace")} <small>v${esc(w.meta.version)}</small></div>
      </aside>
      <main class="polarion-main">${content}</main>
    </div>
    ${state.toast ? `<div class="toast"><span>✓</span>${esc(state.toast)}</div>` : ""}
  </div>`;
  bind();
}

function breadcrumb(section, page) {
  return `<div class="breadcrumb"><span>${esc(projectName())}</span><b>›</b><span>${esc(section)}</span><b>›</b><strong>${esc(page)}</strong></div>`;
}

function pageToolbar(title, subtitle = "", actions = "") {
  return `<div class="page-toolbar"><div><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><div class="page-actions">${actions}</div></div>`;
}

function homeView() {
  const w = state.workspace;
  const docs = w.documents.slice(0, 4);
  const tests = w.items.filter(i => /Test Case/.test(i.type)).slice(0, 4);
  return `<div class="page-frame home-frame">${breadcrumb("Home", "Home")}
    ${pageToolbar("Home", `${projectName()} controlled engineering workspace`, `<button class="tool-button" data-action="new-doc">＋ New Page</button><button class="tool-button primary-tool" data-action="new-item">＋ Work Item</button>`)}
    <div class="wiki-layout"><article class="wiki-article">
      <section class="wiki-section"><h2>Purpose</h2><p>${esc(projectName())} engineering documentation, requirements and verification evidence are maintained in controlled project spaces. Use the navigation tree to work with each process artifact.</p><ul><li>Controlled engineering work products.</li><li>Versioned requirements and trace links.</li><li>ASPICE evidence preparation with human review.</li></ul></section>
      <section class="wiki-section"><h2>Output</h2><p>The project output is organized as controlled documents and linked work items. Each row below opens the corresponding FileAnalyst workflow.</p>
        <div class="polarion-data-table"><div class="data-head"><span>Title</span><span>Status</span><span>Updated</span><span>Updated By</span></div>
          ${docs.map(d => `<button class="data-row" data-doc="${esc(d.id)}"><span class="title-cell"><i class="doc-icon">▤</i><strong>${esc(d.title)}</strong></span><span class="approved"><i>✓</i>${esc(d.status)}</span><span>${shortDate(d.updatedAt)}</span><span class="linkish">${esc(currentUserName())}</span></button>`).join("")}
        </div><div class="items-found">${docs.length} items found <i>i</i></div>
      </section>
      <section class="wiki-section"><h2>Process</h2><p>Process artifacts retain their owners, evidence roles, verification criteria and links.</p>
        <div class="polarion-data-table"><div class="data-head"><span>Process</span><span>Work Items</span><span>Direct Evidence</span><span>Status</span></div>
          ${["SYS.2", "SWE.2", "SWE.4", "SUP.9", "SUP.10"].map(proc => { const rows = w.items.filter(i => i.process === proc); const direct = rows.filter(i => i.evidenceRole === "direct").length; return `<button class="data-row" data-view="items"><span class="title-cell"><i class="process-badge">${proc.split(".")[0]}</i><strong>${proc} · ${processName(proc)}</strong></span><span>${rows.length}</span><span>${direct}</span><span class="${direct ? "approved" : "attention"}">${direct ? "Evidence available" : "Needs evidence"}</span></button>`; }).join("")}
        </div>
      </section>
      <section class="wiki-section"><h2>Test Coverage</h2><p>Test cases and their execution results stay linked to the requirement and design chain.</p>
        <div class="polarion-data-table"><div class="data-head"><span>Title</span><span>Process</span><span>Status</span><span>Owner</span></div>
          ${tests.map(i => `<button class="data-row" data-item="${esc(i.id)}"><span class="title-cell"><i class="test-icon">◒</i><strong>${esc(i.title)}</strong></span><span>${esc(i.process)}</span><span class="${i.status === "Approved" ? "approved" : "attention"}">${esc(i.status)}</span><span>${esc(i.owner)}</span></button>`).join("")}
        </div>
      </section>
    </article><aside class="page-toc"><strong>On this page</strong><a href="#purpose">Purpose</a><a href="#output">Output</a><a href="#process">Process</a><a href="#test-coverage">Test Coverage</a><div class="toc-rule"></div><button data-action="expand-tools">Expand Tools</button></aside></div>
  </div>`;
}

function processName(proc) {
  return ({ "SYS.2": "System Requirements Analysis", "SWE.2": "Software Architectural Design", "SWE.4": "Software Unit Verification", "SUP.9": "Problem Resolution Management", "SUP.10": "Change Request Management" }[proc] || proc);
}

function dashboardView() {
  const w = state.workspace;
  const direct = w.items.filter(i => i.evidenceRole === "direct").length;
  const valid = w.links.filter(l => l.status === "valid").length;
  const pending = w.items.filter(i => i.approval !== "Approved").length;
  const releaseDone = Math.round(valid / Math.max(w.links.length, 1) * 100);
  const statusCounts = ["Draft", "In Review", "Approved", "Ready for Test", "Open", "Proposed"].map(status => ({ status, count: w.items.filter(i => i.status === status).length })).filter(x => x.count);
  const maxStatus = Math.max(...statusCounts.map(x => x.count), 1);
  return `<div class="page-frame">${breadcrumb("Dashboard", "Project Dashboard")}${pageToolbar("Project Dashboard", "Polarion-style release, iteration and evidence overview", `<button class="tool-button" data-action="new-baseline">◫ Create Baseline</button>`)}
    <section class="dashboard-release"><div class="release-heading"><div><span class="release-kicker">CURRENT RELEASE</span><h2>FileAnalyst <b>6.5.0</b></h2><p>${esc(w.meta.project)} · Controlled ASPICE workspace</p></div><span class="release-state">${releaseDone}% ready</span></div><div class="release-progress"><span style="width:${Math.max(6, releaseDone)}%"></span><i style="left:${Math.max(6, releaseDone)}%">Done</i><em>Target: 100%</em></div><div class="release-meta"><span><b>${w.items.length}</b> work items</span><span><b>${w.documents.length}</b> documents</span><span><b>${(w.attachments || []).length}</b> files</span><span><b>${(w.glossary || []).length}</b> glossary terms</span></div></section>
    <div class="dashboard-grid"><div class="metric-card"><small>WORK ITEMS</small><strong>${w.items.length}</strong><span>${w.items.filter(i => /Requirement/.test(i.type)).length} requirements</span></div><div class="metric-card"><small>DOCUMENTS</small><strong>${w.documents.length}</strong><span>${w.documents.filter(d => d.status === "In Review").length} in review</span></div><div class="metric-card"><small>DIRECT EVIDENCE</small><strong>${direct}</strong><span>human-confirmed source records</span></div><div class="metric-card"><small>TRACE LINKS</small><strong>${valid}/${w.links.length}</strong><span>${w.links.filter(l => l.status !== "valid").length} need attention</span></div></div>
    <div class="dashboard-columns"><section class="polarion-panel iteration-panel"><div class="panel-title"><div><span class="release-kicker">CURRENT ITERATION</span><h2>Iteration 1 · Evidence readiness</h2><p>Progress is calculated from valid trace links and approved records.</p></div><span class="readiness-number">${releaseDone}%</span></div><div class="iteration-chart"><div class="chart-y"><span>100</span><span>50</span><span>0</span></div><div class="chart-area"><div class="chart-line ideal"></div><div class="chart-line actual" style="height:${Math.max(10, releaseDone)}%"></div><div class="chart-bars">${[12, 22, 35, 48, 62, releaseDone].map(value => `<i style="height:${value}%"></i>`).join("")}</div><div class="chart-x"><span>Week 1</span><span>Week 2</span><span>Week 3</span><span>Week 4</span><span>Week 5</span><span>Today</span></div></div></div><div class="chart-legend"><span><i class="legend-dot ideal-dot"></i>Ideal progress</span><span><i class="legend-dot actual-dot"></i>Evidence ready</span><span><i class="legend-dot bar-dot"></i>Items completed</span></div></section><section class="polarion-panel status-panel"><div class="panel-title"><div><h2>Planned items by status</h2><p>${w.items.length} tracked records</p></div></div><div class="status-overview"><div class="status-donut" style="--approved:${w.items.filter(i => i.status === "Approved").length};--review:${w.items.filter(i => i.status === "In Review").length};--draft:${w.items.filter(i => !["Approved", "In Review"].includes(i.status)).length}"><strong>${w.items.length}</strong><span>items</span></div><div class="status-list">${statusCounts.map(x => `<div><span><i class="status-swatch swatch-${statusClass(x.status)}"></i>${esc(x.status)}</span><b>${x.count}</b><em><i style="width:${Math.round(x.count / maxStatus * 100)}%"></i></em></div>`).join("")}</div></div></section></div>
    <div class="dashboard-columns"><section class="polarion-panel"><div class="panel-title"><div><h2>Assessment preparation</h2><p>Candidate signals only; formal ratings remain with the assessor.</p></div><span class="readiness-number">${releaseDone}%</span></div><div class="readiness-bar"><span style="width:${Math.max(8, releaseDone)}%"></span></div><div class="check-row"><i class="check-ok">✓</i><div><strong>Project scope is defined</strong><small>SYS.2 · SWE.2 · SWE.4</small></div></div><div class="check-row"><i class="check-warn">!</i><div><strong>${pending} work items need human approval</strong><small>AI and statistics do not replace review authority</small></div></div><div class="check-row"><i class="check-warn">!</i><div><strong>Direct evidence is required for ratings</strong><small>Corroborating and index-only records remain clearly labeled</small></div></div></section><section class="polarion-panel"><div class="panel-title"><div><h2>Recent activity</h2><p>Versioned project changes</p></div><button class="text-button" data-view="items">View all ›</button></div>${w.items.slice(0, 6).map(i => `<button class="activity-row" data-item="${esc(i.id)}"><i class="activity-type">${typeIcon(i.type)}</i><span><strong>${esc(i.title)}</strong><small>${esc(i.id)} · ${esc(i.process)} · ${esc(i.owner)}</small></span><em>v${i.version}<br>${esc(i.status)}</em></button>`).join("")}</section></div>
  </div>`;
}

function itemScope() {
  if (state.view === "requirements") return i => /Requirement/.test(i.type);
  if (state.view === "development") return i => /Design/.test(i.type);
  if (state.view === "maintenance" || state.view === "risks") return i => /Problem|Change/.test(i.type);
  return () => true;
}

function itemsView() {
  const scope = itemScope();
  const rows = sortWorkItems(filterWorkItems(state.workspace.items, {
    query: state.filter,
    type: state.typeFilter,
    timePoint: state.tableTimePoint,
    predicate: scope
  }), { key: state.tableSortKey, direction: state.tableSortDirection });
  const visibleColumns = state.tableColumns.filter(column => tableColumnLabels[column]);
  const grid = visibleColumns.map(column => tableColumnWidths[column]).join(" ");
  const title = state.view === "requirements" ? "Requirements" : state.view === "development" ? "Development" : state.view === "maintenance" ? "Maintenance" : state.view === "risks" ? "Risks" : "Work Items";
  const subtitle = state.view === "items" ? "Track requirements, design, tests, changes and issues" : `Project ${title.toLowerCase()} space`;
  const timePoints = [...new Set(state.workspace.items.map(item => workItemField(item, "timePoint")).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  const columnPicker = `<details class="column-picker"><summary>Columns</summary><div class="column-picker-menu">${Object.entries(tableColumnLabels).map(([key, text]) => `<label><input type="checkbox" data-column-toggle="${key}" ${visibleColumns.includes(key) ? "checked" : ""}>${text}</label>`).join("")}</div></details>`;
  const cell = (item, column) => {
    const value = workItemField(item, column);
    if (column === "type") return `<span class="table-type"><i class="wi-icon ${/Requirement/.test(item.type) ? "req" : /Test/.test(item.type) ? "test" : /Design/.test(item.type) ? "design" : "issue"}">${typeIcon(item.type)}</i>${esc(label(value))}</span>`;
    if (column === "id") return `<strong class="table-id">${esc(value)}</strong>`;
    if (column === "title") return `<span class="wi-title"><strong>${esc(value)}</strong><small>${esc(item.process || "Unassigned")} · r${esc(item.revision || item.version || 1)}</small></span>`;
    if (column === "status") return `<em class="status-label ${statusClass(value)}">${esc(value || "Unassigned")}</em>`;
    if (["created", "updated"].includes(column)) return `<span class="muted-cell">${esc(shortDate(value))}</span>`;
    if (column === "assignees") return `<span>${esc(Array.isArray(value) ? value.join(", ") : value || "-")}</span>`;
    return `<span>${esc(value || "-")}</span>`;
  };
  const header = column => `<button class="table-sort ${state.tableSortKey === column ? "active" : ""}" data-sort-key="${column}" title="Sort by ${tableColumnLabels[column]}">${tableColumnLabels[column]}${state.tableSortKey === column ? `<b>${state.tableSortDirection === "asc" ? "↑" : "↓"}</b>` : ""}</button>`;
  return `<div class="page-frame">${breadcrumb(title, title)}${pageToolbar(title, subtitle, `<button class="tool-button" data-action="new-baseline">◫ Baseline</button><button class="tool-button primary-tool" data-action="new-item">＋ Create</button>`)}
    <div class="polarion-toolbar"><div class="query-select"><span>Query</span><select><option>All ${title}</option><option>My open items</option><option>Needs review</option></select></div><div class="table-search"><span>⌕</span><input id="item-search" value="${esc(state.filter)}" placeholder="Search work items"></div><select id="type-filter"><option value="">All types</option>${[...new Set(state.workspace.items.map(i => i.type))].map(type => `<option value="${esc(type)}" ${state.typeFilter === type ? "selected" : ""}>${esc(label(type))}</option>`).join("")}</select><select id="table-timepoint"><option value="">All time points</option>${timePoints.map(value => `<option value="${esc(value)}" ${state.tableTimePoint === value ? "selected" : ""}>${esc(value)}</option>`).join("")}</select>${columnPicker}<button class="icon-tool" data-action="refresh" title="Refresh">↻</button></div>
    <section class="polarion-panel table-panel"><div class="table-caption"><strong>${rows.length} items found</strong><span>${state.tableSortKey === "updated" ? "Last updated records first" : `Sorted by ${tableColumnLabels[state.tableSortKey]}`}</span></div><div class="workitem-table" style="--table-grid:${grid}"><div class="workitem-head">${visibleColumns.map(header).join("")}</div>${rows.map(i => `<button class="workitem-row ${state.selectedItem === i.id ? "selected" : ""}" style="--table-grid:${grid}" data-item="${esc(i.id)}">${visibleColumns.map(column => cell(i, column)).join("")}</button>`).join("") || `<div class="empty-state"><strong>No work items found</strong><span>Change the query, time point or create a new item.</span></div>`}</div></section>${state.selectedItem ? itemDetail(state.selectedItem) : ""}
  </div>`;
}

function itemDetail(id) {
  const i = itemById(id);
  if (!i) return "";
  const links = state.workspace.links.filter(l => l.from === id || l.to === id);
  const attachments = (state.workspace.attachments || []).filter(x => x.itemId === id);
  const history = (i.history || []).slice().reverse();
  let body = "";
  if (state.detailTab === "history") body = `<div class="drawer-history">${history.length ? history.map(h => `<div class="history-entry"><span>v${h.version}</span><div><strong>${esc(h.title)}</strong><small>${esc(h.status)} · ${dateText(h.changedAt)} · ${esc(h.changedBy)}</small></div></div>`).join("") : `<div class="drawer-empty">No revision history yet.</div>`}</div>`;
  else if (state.detailTab === "discussion") body = `<div class="drawer-empty"><span>◇</span><strong>No discussion entries</strong><p>Keep review comments with the work item so the decision trail remains auditable.</p></div>`;
  else body = `<div class="drawer-form"><div class="drawer-property-section"><div class="drawer-section-title">Core properties <span>8</span></div><label>Type<select data-edit="type">${["System Requirement", "Software Design", "Software Test Case", "System Test Case", "Problem Report", "Change Request"].map(v => `<option ${v === i.type ? "selected" : ""}>${v}</option>`).join("")}</select></label><label>Title<input data-edit="title" value="${esc(i.title)}"></label><label>Description<textarea data-edit="body">${esc(i.body)}</textarea></label><div class="form-two"><label>Process<select data-edit="process">${["SYS.2", "SWE.2", "SWE.4", "SYS.4", "SUP.9", "SUP.10"].map(v => `<option ${v === i.process ? "selected" : ""}>${v}</option>`).join("")}</select></label><label>Status<select data-edit="status">${(workItemConfiguration().workflow?.statuses || ["Draft", "In Review", "Approved", "Ready for Test", "Open", "Proposed", "Closed"]).map(v => `<option ${v === i.status ? "selected" : ""}>${v}</option>`).join("")}</select></label></div><div class="form-two"><label>Evidence role<select data-edit="evidenceRole">${["direct", "corroborating", "index-only"].map(v => `<option ${v === i.evidenceRole ? "selected" : ""}>${v}</option>`).join("")}</select></label><label>ASIL / Level<input data-edit="asil" value="${esc(i.asil)}"></label></div><div class="form-two"><label>Glossary term<input data-edit="glossaryTerm" value="${esc(i.glossaryTerm || "")}" placeholder="e.g. FTTI"></label><label>Owner<input data-edit="owner" value="${esc(i.owner)}"></label></div><label>Verification criteria<textarea data-edit="verification" placeholder="Method, conditions, measurable pass/fail rule">${esc(i.verification)}</textarea></label></div>${customFieldSections(i)}<div class="drawer-property-summary">${customFieldSummary(i)}</div><div class="drawer-actions"><button class="tool-button primary-tool" data-action="save-item">Save Work Item</button><button class="tool-button" data-action="new-link">＋ Link Work Item</button><button class="tool-button" data-action="upload-item">↥ Attach File</button></div></div>`;
  return `<div class="drawer-backdrop" data-action="close-detail"><aside class="item-drawer" data-stop><div class="drawer-header"><div><span class="drawer-eyebrow">${esc(i.id)} · VERSION ${i.version}</span><h2>${esc(i.title)}</h2><span>${esc(label(i.type))} · ${esc(i.process)}</span></div><button class="close-button" data-action="close-detail">×</button></div><div class="drawer-tabs"><button class="${state.detailTab === "properties" ? "active" : ""}" data-detail-tab="properties">Properties</button><button class="${state.detailTab === "history" ? "active" : ""}" data-detail-tab="history">History ${history.length ? `(${history.length})` : ""}</button><button class="${state.detailTab === "discussion" ? "active" : ""}" data-detail-tab="discussion">Discussion</button></div>${body}<div class="drawer-links"><div class="drawer-section-title">Attachments <span>${attachments.length}</span></div>${attachments.map(a => `<a class="attachment-row" href="${uploadUrl(a.id)}"><span>▧</span><strong>${esc(a.name)}</strong><small>${formatBytes(a.size)} · ${shortDate(a.uploadedAt)}</small></a>`).join("") || `<p class="drawer-note">No files attached. Add measurements, review records or source documents here.</p>`}</div><div class="drawer-links"><div class="drawer-section-title">Linked Work Items <span>${links.length}</span></div>${links.map(l => `<div class="linked-item"><span>${esc(l.role)}</span><button data-item="${esc(l.from === id ? l.to : l.from)}">${esc(l.from === id ? l.to : l.from)}</button><em class="status-label ${l.status === "valid" ? "approved" : "attention"}">${esc(linkStatusLabel(l.status))}</em>${linkReviewControls(l)}</div>`).join("") || `<p class="drawer-note">No links yet. A link is navigation evidence; it does not replace direct process evidence.</p>`}</div></aside></div>`;
}

function linkReviewControls(link) {
  if (!canMutate()) return `<small class="drawer-note">View only</small>`;
  return `<span class="link-review-actions"><button type="button" data-action="review-link" data-link-id="${esc(link.id)}" data-status="valid" title="Confirm assessor relationship">Confirm</button><button type="button" data-action="review-link" data-link-id="${esc(link.id)}" data-status="suspect" title="Require re-review">Suspect</button><button type="button" data-action="review-link" data-link-id="${esc(link.id)}" data-status="invalid" title="Reject relationship">Reject</button></span>`;
}

function documentsView() {
  const w = state.workspace;
  const d = w.documents.find(x => x.id === state.selectedDocument) || w.documents[0];
  const attachments = (w.attachments || []).filter(x => x.documentId === d?.id);
  const nodes = d ? documentNodes(d.id) : [];
  state.selectedDocument = d?.id;
  const root = d ? nodeIdForClient(d.id, "root") : "";
  const documentLock = state.collaboration.locks.find(lock => lock.resourceId === `document:${d?.id}`);
  const lockLabel = documentLock ? `Lock: ${documentLock.ownerId === currentUserId() ? "you" : documentLock.ownerName}` : "No structural lock";
  const renderedNodes = nodes.length ? nodes.map(node => `<div class="document-node document-node-${esc(node.nodeType)}" data-node-id="${esc(node.nodeId)}" data-node-revision="${esc(node.revision)}" contenteditable="true"><span class="document-node-meta">${esc(node.nodeType)} · r${esc(node.revision)}${node.sourceLocator ? ` · ${esc(typeof node.sourceLocator === "string" ? node.sourceLocator : JSON.stringify(node.sourceLocator))}` : ""}</span>${node.content?.html || ""}</div>`).join("") : (d?.body || "");
  const comments = state.collaboration.comments || [];
  const documentSearchControl = `<input id="document-search" value="${esc(state.documentFilter)}" placeholder="Filter pages" aria-label="Filter pages">`;
  const documents = w.documents.slice().sort((a, b) => `${a.space}/${a.title}`.localeCompare(`${b.space}/${b.title}`, undefined, { numeric: true, sensitivity: "base" }));
  const visibleDocuments = documents.filter(document => !state.documentFilter || `${document.id} ${document.title} ${document.space} ${document.process || ""}`.toLowerCase().includes(state.documentFilter.toLowerCase()));
  const childrenOf = parentId => visibleDocuments.filter(document => (document.parentId || null) === (parentId || null));
  const renderDocumentTree = (parentId = null, depth = 0) => childrenOf(parentId).map(document => `<div class="document-tree-entry" style="--tree-depth:${depth}"><button class="tree-node ${document.id === d?.id ? "active" : ""}" data-doc="${esc(document.id)}"><span class="tree-caret">${childrenOf(document.id).length ? "›" : "·"}</span><i>▤</i><div><strong>${esc(document.title)}</strong><small>${esc(document.space)} · ${esc(document.documentType || "LiveDoc")} · r${esc(document.revision || document.version)}</small></div></button>${renderDocumentTree(document.id, depth + 1)}</div>`).join("");
  return `<div class="page-frame">${breadcrumb("Design", "Documents & Pages")}${pageToolbar("Documents & Pages", "Structured LiveDoc editing with node-level revisions", `<button class="tool-button" data-action="new-doc">＋ New Page</button><button class="tool-button" data-action="stage-import">⇧ Stage ASPICE File</button><button class="tool-button" data-action="export-document-library">⇩ Export Library</button><button class="tool-button" data-action="import-document-library">⇧ Import Library</button><button class="tool-button" data-action="lock-document">▣ Structure Lock</button><button class="tool-button" data-action="new-comment">＋ Comment</button><button class="tool-button primary-tool" data-action="save-doc">Save Draft</button>`)}
    <div class="livedoc-layout"><aside class="document-tree polarion-panel"><div class="tree-title">Documents & Pages</div><div class="tree-filter">⌕ ${documentSearchControl}</div><div class="document-tree-list">${renderDocumentTree()}</div><button class="tree-add" data-action="new-doc">＋ Add Page</button></aside><section class="livedoc-editor polarion-panel"><div class="editor-top"><div class="editor-crumb">${esc(d?.space)} / ${esc(d?.title)}</div><div class="editor-actions"><button data-command="undo" title="Undo">↶</button><button data-command="redo" title="Redo">↷</button><i></i><button data-command="bold"><b>B</b></button><button data-command="italic"><i>I</i></button><select data-command="formatBlock"><option value="p">Normal</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option></select><button data-command="insertUnorderedList">☷</button><button data-action="insert-item">▣ Insert Work Item</button></div></div><div class="editor-status"><span><i class="online-dot"></i> Editing as ${esc(currentUserName())}</span><span id="editor-collaboration-status">${esc(state.collaboration.status)}</span><span>Revision ${esc(d?.revision || 1)} · ${esc(d?.status)}</span><span id="editor-participants">${state.collaboration.presence.length} active</span></div><article id="doc-editor" class="livedoc-content" data-document-id="${esc(d?.id)}" data-root-id="${esc(root)}">${renderedNodes}</article><div class="editor-footer"><span id="editor-lock-status">${esc(lockLabel)}</span><span>${d?.workItemIds?.length || 0} embedded work items · ${nodes.length} structured nodes</span></div></section><aside class="document-inspector polarion-panel"><div class="inspector-heading">Page Properties</div><label>Status<select id="doc-status">${["Draft", "In Review", "Approved", "Baselined"].map(v => `<option ${v === d?.status ? "selected" : ""}>${v}</option>`).join("")}</select></label><button class="tool-button inspector-upload" data-action="upload-document">↥ Attach File</button><div class="inspector-heading">Collaborators <span>${state.collaboration.presence.length}</span></div>${state.collaboration.presence.map(entry => `<div class="presence-row"><i>${esc(entry.displayName.slice(0, 2).toUpperCase())}</i><span>${esc(entry.displayName)}<small>${esc(entry.mode)}${entry.nodeId ? ` · ${esc(entry.nodeId)}` : ""}</small></span></div>`).join("") || `<div class="inspector-empty">No other active collaborators.</div>`}<div class="inspector-rule"></div><div class="inspector-heading">Discussion <span>${comments.filter(comment => comment.status !== "resolved").length}</span></div>${comments.slice(0, 8).map(comment => `<div class="comment-thread"><strong>${esc(comment.createdByName)}</strong><small>${shortDate(comment.createdAt)} · ${esc(comment.status)}</small><p>${esc(comment.body)}</p></div>`).join("") || `<div class="inspector-empty">No discussion threads.</div>`}<button class="tool-button" data-action="new-comment">＋ Add Comment</button><div class="inspector-rule"></div><div class="inspector-heading">Files on this Page <span>${attachments.length}</span></div>${attachments.map(a => `<a class="attachment-row" href="${routePath(`/uploads/${encodeURIComponent(a.id)}`)}"><span>▧</span><strong>${esc(a.name)}</strong><small>${formatBytes(a.size)}</small></a>`).join("") || `<div class="inspector-empty">No attachments on this page.</div>`}<div class="inspector-rule"></div><div class="inspector-heading">Work Items in this Page</div>${(d?.workItemIds || []).map(id => { const i = itemById(id); return i ? `<button class="embedded-wi" data-item="${esc(id)}"><i>${typeIcon(i.type)}</i><span><strong>${esc(id)}</strong><small>${esc(i.title)}</small></span><b>›</b></button>` : ""; }).join("") || `<div class="inspector-empty">Use Insert Work Item to embed controlled records.</div>`}</aside></div>
  </div>`;
}

const nodeIdForClient = (documentId, suffix) => `${documentId}:node:${suffix}`;

function glossaryView() {
  const terms = state.workspace.glossary || [];
  return `<div class="page-frame">${breadcrumb("Administration", "Glossary")}${pageToolbar("Glossary", "Controlled terminology for requirements, design and evidence", `<button class="tool-button primary-tool" data-action="new-glossary">＋ New Term</button>`)}<section class="polarion-panel glossary-panel"><div class="table-caption"><strong>${terms.length} terms</strong><span>Each change creates a revision record</span></div>${terms.map(t => `<div class="glossary-row"><div class="glossary-term"><strong>${esc(t.term)}</strong><small>${esc(t.id)} · v${t.version} · ${esc(t.status)}</small></div><textarea data-glossary-edit="definition" data-term-id="${esc(t.id)}">${esc(t.definition)}</textarea><input data-glossary-edit="owner" data-term-id="${esc(t.id)}" value="${esc(t.owner)}"><button class="icon-tool" data-action="save-glossary" data-term-id="${esc(t.id)}" title="Save glossary term">✓</button></div>`).join("") || `<div class="empty-state"><strong>No glossary terms</strong><span>Add controlled terminology used by the project.</span></div>`}</section></div>`;
}

function traceView() {
  const w = state.workspace;
  const valid = w.links.filter(l => l.status === "valid").length;
  const rows = w.links.filter(link => !state.traceFilter || `${link.id} ${link.role} ${link.status} ${link.from} ${link.to} ${itemById(link.from)?.process || ""} ${itemById(link.to)?.process || ""}`.toLowerCase().includes(state.traceFilter.toLowerCase()));
  return `<div class="page-frame">${breadcrumb("Traceability", "Traceability")}${pageToolbar("Traceability", "Bidirectional links between requirements, design and tests", `<button class="tool-button primary-tool" data-action="new-link">＋ Link Work Items</button>`)}<div class="trace-kpis"><div><small>ALL LINKS</small><strong>${w.links.length}</strong></div><div><small>VALID</small><strong class="good">${valid}</strong></div><div><small>ATTENTION</small><strong class="warn">${w.links.length - valid}</strong></div><div><small>COVERAGE</small><strong>${Math.round(valid / Math.max(w.links.length, 1) * 100)}%</strong></div></div><section class="polarion-panel trace-table"><div class="polarion-toolbar"><div class="table-search"><span>⌕</span><input id="trace-search" value="${esc(state.traceFilter)}" placeholder="Search item, process, relation or status"></div><span>${rows.length} relation(s)</span></div><div class="table-caption"><strong>Trace relation matrix</strong><span>Valid means assessor-confirmed at the current endpoint revisions</span></div><div class="trace-head"><span>Source</span><span>Link role</span><span>Target</span><span>Review</span></div>${rows.map(l => { const from = itemById(l.from), to = itemById(l.to); return `<div class="trace-line"><button data-item="${esc(l.from)}"><strong>${esc(l.from)}</strong><span>${esc(from?.title || "Unknown")}</span><small>${esc(from?.process || "Unclassified")} · ${esc(from?.evidenceRole || "index-only")}</small></button><div class="trace-arrow"><i></i><em>${esc(l.role)}</em><i></i></div><button data-item="${esc(l.to)}"><strong>${esc(l.to)}</strong><span>${esc(to?.title || "Unknown")}</span><small>${esc(to?.process || "Unclassified")} · ${esc(to?.evidenceRole || "index-only")}</small></button><div class="trace-review"><span class="status-label ${l.status === "valid" ? "approved" : "attention"}">${esc(linkStatusLabel(l.status))}<small>r${l.revision || 1} · ${shortDate(l.createdAt)}${l.locator ? ` · ${esc(l.locator)}` : ""}</small></span>${linkReviewControls(l)}</div></div>`; }).join("")}</section><div class="criteria-note"><strong>Evidence rule</strong><span>Trace links support navigation and consistency checks. Formal process ratings require direct evidence from the target process; corroborating or index-only records remain labeled and cannot replace it.</span></div></div>`;
}

function runsView() {
  const runs = state.workspace.testRuns || [];
  return `<div class="page-frame">${breadcrumb("Testing", "Test Runs")}${pageToolbar("Test Runs", "Execute linked test cases against a build and environment", `<button class="tool-button primary-tool" data-action="new-run">＋ New Test Run</button>`)}<div class="test-run-list">${runs.map(run => `<section class="polarion-panel test-run-card"><div class="test-run-header"><div><h2>${esc(run.title)}</h2><p>${esc(run.id)} · ${esc(run.build)} · ${esc(run.environment)}</p></div><em class="status-label ${run.status === "Passed" ? "approved" : run.status === "Failed" ? "failed" : "attention"}">${esc(run.status)}</em></div><div class="test-result-head"><span>Result</span><span>Test Case</span><span>Actual Result / Evidence</span><span>Status</span></div>${run.results.map(result => { const i = itemById(result.itemId); return `<div class="test-result-row"><i class="result-dot ${statusClass(result.status)}">${result.status === "Passed" ? "✓" : result.status === "Failed" ? "!" : "·"}</i><button data-item="${esc(result.itemId)}"><strong>${esc(result.itemId)}</strong><span>${esc(i?.title || "Unknown test case")}</span></button><span class="actual-result">${esc(result.actual || "No actual result recorded")}</span><select data-run="${esc(run.id)}" data-result="${esc(result.itemId)}">${["Not run", "Passed", "Failed", "Blocked"].map(v => `<option ${v === result.status ? "selected" : ""}>${v}</option>`).join("")}</select></div>`; }).join("")}</section>`).join("") || `<section class="polarion-panel empty-state"><strong>No test runs yet</strong><span>Create a run to record controlled execution evidence.</span><button class="tool-button primary-tool" data-action="new-run">Create Test Run</button></section>`}</div></div>`;
}

function baselinesView() {
  const rows = state.workspace.baselines || [];
  return `<div class="page-frame">${breadcrumb("Planning", "Baselines")}${pageToolbar("Baselines", "Freeze a reproducible set of document and work item versions", `<button class="tool-button primary-tool" data-action="new-baseline">＋ Create Baseline</button>`)}<section class="polarion-panel baseline-panel">${rows.length ? rows.map(b => `<div class="baseline-row"><i>◫</i><div><strong>${esc(b.title)}</strong><span>${esc(b.id)} · ${dateText(b.createdAt)} · ${esc(b.createdBy)}</span></div><em class="approved">${esc(b.status)}</em><small>${b.itemVersions.length} work items · ${b.documentVersions.length} documents</small></div>`).join("") : `<div class="empty-state"><strong>No baselines yet</strong><span>Create one before an assessment review to freeze the exact evidence set.</span><button class="tool-button primary-tool" data-action="new-baseline">Create First Baseline</button></div>`}</section></div>`;
}

function treeView() {
  const tree = filterTree(buildDocumentWorkItemTree(state.workspace.items), state.treeFilter);
  const nodes = flattenTree(tree, { maxDepth: state.treeDepth });
  const visibleIds = new Set(nodes.map(node => node.id));
  const depthOptions = [[Infinity, "All levels"], [0, "Roots only"], [1, "2 levels"], [2, "3 levels"], [3, "4 levels"]];
  return `<div class="page-frame">${breadcrumb("Work Items", "Tree View")}${pageToolbar("Tree View", "Document hierarchy with outline numbers, evidence roles and trace health", `<button class="tool-button" data-view="items">Table View</button><button class="tool-button" data-view="matrix">Matrix View</button>`)}
    <div class="polarion-toolbar tree-toolbar"><div class="table-search"><span>⌕</span><input id="tree-filter" value="${esc(state.treeFilter)}" placeholder="Search tree"></div><select id="tree-depth">${depthOptions.map(([value, text]) => `<option value="${value === Infinity ? "all" : value}" ${state.treeDepth === value ? "selected" : ""}>${text}</option>`).join("")}</select><span class="tree-result-count">${nodes.length} of ${state.workspace.items.length} work items</span></div>
    <section class="tree-workspace">${nodes.length ? nodes.map(node => { const item = node.item; const links = state.workspace.links.filter(link => link.from === item.id || link.to === item.id); const schedule = itemSchedule(item); return `<button class="tree-item ${state.selectedItem === item.id ? "selected" : ""} ${node.orphan ? "orphan" : ""}" data-item="${esc(item.id)}" style="--tree-depth:${node.depth}"><span class="tree-outline"><b>${esc(node.outlineNumber || "-")}</b><small>${esc(item.id)}</small></span><span class="tree-item-content"><strong>${esc(item.title)}</strong><small>${esc(item.type)} · ${esc(item.process || "Unassigned")} · ${esc(item.status)} · r${esc(item.revision || item.version || 1)}</small><small>${schedule.scheduled ? `Schedule: ${esc(schedule.group)}` : "No schedule data recorded"}</small></span><em class="tree-badges"><i class="${item.evidenceRole === "direct" ? "direct" : "candidate"}">${esc(item.evidenceRole || "index-only")}</i>${node.orphan ? `<i class="tree-warning">orphan</i>` : ""}${node.hasCycle ? `<i class="tree-warning">cycle</i>` : ""}<small>${links.length} links</small></em></button>`; }).join("") : `<div class="empty-state"><strong>No matching work items</strong><span>Clear the filter or create a new item.</span></div>`}</section>${visibleIds.size < state.workspace.items.length && state.treeFilter ? `<div class="criteria-note"><strong>Filtered tree</strong><span>Matching descendants retain their ancestor path so outline context stays visible.</span></div>` : ""}</div>`;
}

function roadmapView() {
  const buckets = roadmapBuckets(state.workspace.items, { timePoint: state.roadmapTimePoint });
  const timePoints = [...new Set(state.workspace.items.map(item => workItemField(item, "timePoint")).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  const rows = bucket => bucket.items.map(item => { const schedule = itemSchedule(item); return `<button class="roadmap-item" data-item="${esc(item.id)}"><span class="roadmap-id">${esc(item.id)}</span><span><strong>${esc(item.title)}</strong><small>${esc(item.process || "Unassigned")} · ${esc(item.status)}</small></span><span>${schedule.plannedStart ? esc(schedule.plannedStart) : "-"}</span><span>${schedule.plannedEnd ? esc(schedule.plannedEnd) : "-"}</span><span>${esc(Array.isArray(workItemField(item, "assignees")) ? workItemField(item, "assignees").join(", ") : workItemField(item, "assignees") || item.owner || "-" )}</span></button>`; }).join("");
  return `<div class="page-frame">${breadcrumb("Planning", "Road Map")}${pageToolbar("Road Map", "Planned work items grouped by recorded iteration or date", `<button class="tool-button" data-view="tree">Tree View</button><button class="tool-button" data-view="items">Table View</button>`)}
    <div class="polarion-toolbar roadmap-toolbar"><label class="roadmap-filter"><span>Time Point</span><select id="roadmap-timepoint"><option value="">All time points</option>${timePoints.map(value => `<option value="${esc(value)}" ${state.roadmapTimePoint === value ? "selected" : ""}>${esc(value)}</option>`).join("")}</select></label><span class="tree-result-count">${state.workspace.items.length} work items tracked</span></div>
    <section class="roadmap-workspace">${buckets.map(bucket => `<section class="roadmap-bucket ${bucket.scheduled ? "scheduled" : "unscheduled"}"><header><div><span class="release-kicker">${bucket.scheduled ? "SCHEDULED" : "NO SCHEDULE"}</span><h2>${esc(bucket.key)}</h2></div><strong>${bucket.items.length} items</strong></header><div class="roadmap-table"><div class="roadmap-head"><span>ID</span><span>Title</span><span>Start</span><span>End</span><span>Assignee(s)</span></div>${rows(bucket) || `<div class="empty-state"><strong>No work items in this group</strong></div>`}</div>${!bucket.scheduled ? `<p class="roadmap-note">No schedule data recorded. This group is intentionally unscheduled; FileAnalyst does not invent dates.</p>` : ""}</section>`).join("") || `<div class="empty-state"><strong>No roadmap records</strong><span>Record Planned in, Planned start, Planned end or Due date on a work item to place it here.</span></div>`}</section>${state.selectedItem ? itemDetail(state.selectedItem) : ""}</div>`;
}

function matrixView() {
  const items = state.workspace.items;
  const links = state.workspace.links;
  return `<div class="page-frame">${breadcrumb("Traceability", "Matrix View")}${pageToolbar("Traceability Matrix", "Rows and columns share the same versioned link data", `<button class="tool-button" data-view="tree">Tree View</button><button class="tool-button" data-view="trace">Relation List</button>`)}<section class="matrix-panel polarion-panel"><div class="matrix-scroll"><table class="trace-matrix"><thead><tr><th>Source / Target</th>${items.map(item => `<th title="${esc(item.title)}">${esc(item.id)}</th>`).join("")}</tr></thead><tbody>${items.map(source => `<tr><th><strong>${esc(source.id)}</strong><small>${esc(source.title)}</small></th>${items.map(target => { const link = links.find(candidate => candidate.from === source.id && candidate.to === target.id); return `<td class="${link ? link.status : "empty"}">${link ? `<button data-action="review-link-menu" data-link-id="${esc(link.id)}" title="${esc(link.role)}">${link.status === "valid" ? "✓" : link.status === "suspect" ? "!" : "C"}</button>` : "·"}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div><p class="matrix-note">Valid links are assessor-confirmed relationships. Candidate, unreviewed and suspect links remain visible for review and never change a formal rating.</p></section></div>`;
}

function adminView() {
  const user = state.workspace.identity || { name: "AuditFlow user", roles: ["AuditFlow session"] };
  const config = workItemConfiguration();
  const fields = (config.fields || []).map(field => `<div class="configuration-field-row"><label><input type="checkbox" data-config-visible="${esc(field.id)}" checked> <strong>${esc(field.label)}</strong></label><input data-config-label="${esc(field.id)}" value="${esc(field.label)}"><input data-config-options="${esc(field.id)}" value="${esc((field.options || []).join(", "))}" placeholder="Options, comma-separated"><span>${esc(field.group || "Custom")}</span></div>`).join("");
  const sections = (config.presentation || []).map(section => `<div class="configuration-section-row"><input data-config-section-label="${esc(section.id)}" value="${esc(section.label)}"><input data-config-section-fields="${esc(section.id)}" value="${esc((section.fields || []).join(", "))}" placeholder="field ids, comma-separated"></div>`).join("");
  const statuses = (config.workflow?.statuses || []).join(", ");
  const transitions = (config.workflow?.transitions || []).map(item => `${item.id}|${(item.from || []).join("+")}|${item.to}|${item.label}`).join("\n");
  const relations = (config.relationTypes || []).map(item => `${item.id}|${item.label}|${item.inverse}|${item.requiresEvidence ? "evidence" : "navigation"}`).join("\n");
  return `<div class="page-frame">${breadcrumb("Administration", "Administration")}${pageToolbar("Administration", "Polarion-style project, work item and workflow configuration", `<button class="tool-button" data-action="refresh">↻ Refresh</button>`)}<div class="admin-grid"><section class="polarion-panel"><div class="panel-title"><div><h2>Current session</h2><p>Permissions are enforced by the authenticated AuditFlow session.</p></div></div><div class="admin-user"><i class="user-avatar">${esc(currentUserInitials())}</i><div><strong>${esc(user.name)}</strong><span>${esc(user.id || "")}</span></div><em>${esc((user.roles || []).join(" · "))}</em></div></section><section class="polarion-panel"><div class="panel-title"><div><h2>Project configuration</h2><p>${esc(projectName())} · FileAnalyst ${esc(state.workspace.meta.version)}</p></div></div><div class="config-row"><span>Formal scope</span><strong>Project-defined ASPICE processes</strong></div><div class="config-row"><span>Storage</span><strong>${esc(state.workspace.storage || "Project workspace")} with versioned writes</strong></div><div class="config-row"><span>Review policy</span><strong>Human approval required for formal evidence</strong></div></section></div><section class="polarion-panel configuration-panel"><div class="panel-title"><div><span class="release-kicker">WORK ITEM ADMINISTRATION</span><h2>Properties and presentation</h2><p>Configure field labels, selectable values and the sections shown in every work item. Changes are versioned per project.</p></div><span class="status-label approved">r${Number(state.workspace.meta.workItemConfigurationRevision || 1)}</span></div><div class="configuration-table"><div class="configuration-header"><span>Enabled</span><span>Field label</span><span>Values</span><span>Group</span></div>${fields}</div><div class="configuration-subsection"><h3>Presentation sections</h3>${sections}</div><div class="configuration-two"><label><span>Workflow statuses</span><input id="config-statuses" value="${esc(statuses)}"></label><label><span>Relation types</span><textarea id="config-relations" rows="7">${esc(relations)}</textarea></label></div><label class="configuration-wide"><span>Workflow transitions</span><textarea id="config-transitions" rows="7" placeholder="id|from+from|to|label">${esc(transitions)}</textarea></label><div class="configuration-help">Transition format: <code>id|allowed-from+status|target-status|label</code>. Relation format: <code>id|label|inverse|evidence</code> or <code>navigation</code>.</div><div class="drawer-actions"><button class="tool-button primary-tool" data-action="save-work-item-configuration">Save Configuration</button></div></section></div>`;
}

function render() {
  if (!state.workspace) return;
  if (state.view === "library") { shell('<div id="requirements-root">Loading requirements…</div>'); mountRequirements(document.querySelector("#requirements-root"), api); return; }
  const view = state.view;
  const content = view === "home" ? homeView() : view === "dashboard" ? dashboardView() : ["items", "requirements", "development", "maintenance", "risks"].includes(view) ? itemsView() : view === "tree" ? treeView() : view === "roadmap" || view === "planning" ? roadmapView() : view === "matrix" ? matrixView() : view === "design" ? documentsView() : view === "glossary" ? glossaryView() : view === "trace" ? traceView() : view === "runs" ? runsView() : view === "baselines" ? baselinesView() : adminView();
  shell(content);
  if (view === "design" && state.selectedDocument && state.collaboration.documentId !== state.selectedDocument) {
    void loadDocumentCollaboration(state.selectedDocument);
  }
}

function bind() {
  document.querySelectorAll("[data-view]").forEach(el => { el.onclick = event => { event.preventDefault(); navigate(el.dataset.view); }; });
  document.querySelectorAll("[data-item]").forEach(el => { el.onclick = event => { event.preventDefault(); event.stopPropagation(); state.selectedItem = el.dataset.item; state.view = "items"; render(); }; });
  document.querySelectorAll("[data-doc]").forEach(el => { el.onclick = event => { event.preventDefault(); state.selectedDocument = el.dataset.doc; state.view = "design"; render(); }; });
  document.querySelectorAll("[data-detail-tab]").forEach(el => { el.onclick = event => { event.preventDefault(); event.stopPropagation(); state.detailTab = el.dataset.detailTab; render(); }; });
  document.querySelectorAll("[data-stop]").forEach(el => { el.onclick = event => event.stopPropagation(); });
  document.querySelectorAll("[data-run]").forEach(el => { el.onchange = () => updateRunResult(el.dataset.run, el.dataset.result, el.value); });
  document.querySelectorAll("[data-action]").forEach(el => { el.onclick = event => action(el.dataset.action, event); });
  document.querySelectorAll("[data-term-id]").forEach(el => { if (el.dataset.action !== "save-glossary") el.oninput = () => { el.dataset.changed = "true"; }; });
  const projectSwitcher = document.querySelector("#project-switcher");
  if (projectSwitcher) projectSwitcher.onchange = async event => {
    try {
      await loadWorkspaceForProject(event.target.value);
      state.view = "home";
      state.selectedItem = null;
      state.selectedDocument = null;
      render();
      notify("Project context changed");
    } catch (error) {
      state.projectError = displayError(error);
      render();
    }
  };
  const search = document.querySelector("#item-search");
  if (search) search.oninput = event => { state.filter = event.target.value; render(); const next = document.querySelector("#item-search"); next?.focus(); next?.setSelectionRange(next.value.length, next.value.length); };
  const globalSearch = document.querySelector("#global-search");
  if (globalSearch) globalSearch.onchange = event => { state.filter = event.target.value; state.view = "items"; render(); };
  const typeFilter = document.querySelector("#type-filter");
  if (typeFilter) typeFilter.onchange = event => { state.typeFilter = event.target.value; render(); };
  const documentSearch = document.querySelector("#document-search");
  if (documentSearch) documentSearch.oninput = event => { state.documentFilter = event.target.value; render(); };
  const traceSearch = document.querySelector("#trace-search");
  if (traceSearch) traceSearch.oninput = event => { state.traceFilter = event.target.value; render(); };
  const treeFilter = document.querySelector("#tree-filter");
  if (treeFilter) treeFilter.oninput = event => { state.treeFilter = event.target.value; render(); const next = document.querySelector("#tree-filter"); next?.focus(); next?.setSelectionRange(next.value.length, next.value.length); };
  const treeDepth = document.querySelector("#tree-depth");
  if (treeDepth) treeDepth.onchange = event => { state.treeDepth = event.target.value === "all" ? Infinity : Number(event.target.value); render(); };
  const tableTimePoint = document.querySelector("#table-timepoint");
  if (tableTimePoint) tableTimePoint.onchange = event => { state.tableTimePoint = event.target.value; render(); };
  const roadmapTimePoint = document.querySelector("#roadmap-timepoint");
  if (roadmapTimePoint) roadmapTimePoint.onchange = event => { state.roadmapTimePoint = event.target.value; render(); };
  document.querySelectorAll("[data-sort-key]").forEach(el => {
    el.onclick = event => {
      event.preventDefault();
      const key = el.dataset.sortKey;
      state.tableSortDirection = state.tableSortKey === key && state.tableSortDirection === "asc" ? "desc" : "asc";
      state.tableSortKey = key;
      render();
    };
  });
  document.querySelectorAll("[data-column-toggle]").forEach(el => {
    el.onchange = event => {
      const key = event.target.dataset.columnToggle;
      const next = new Set(state.tableColumns);
      if (event.target.checked) next.add(key); else if (next.size > 1) next.delete(key); else event.target.checked = true;
      state.tableColumns = Object.keys(tableColumnLabels).filter(column => next.has(column));
      render();
    };
  });
  const docStatus = document.querySelector("#doc-status");
  if (docStatus) docStatus.onchange = event => saveDoc({ status: event.target.value });
  document.querySelectorAll("[data-command]").forEach(el => { el.onclick = () => { document.execCommand(el.dataset.command, false, el.dataset.value || null); document.querySelector("#doc-editor")?.focus(); }; });
  document.querySelectorAll(".document-node").forEach(el => {
    el.addEventListener("focus", () => {
      const resourceId = `document:${state.selectedDocument}`;
      void api("/api/collaboration/presence", { method: "POST", body: JSON.stringify({ resourceId, clientId: state.collaboration.clientId, nodeId: el.dataset.nodeId, mode: "edit" }) }).catch(() => {});
    });
    el.addEventListener("input", () => {
      el.dataset.dirty = "true";
      state.collaboration.status = "draft";
      updateCollaborationChrome();
    });
  });
}

async function action(type, event) {
  try {
    if (type === "back-auditflow") {
      const projectId = state.returnProjectId
        || auditFlowProjectId(requestedProjectId())
        || auditFlowProjectId(state.projectId || state.workspace?.meta?.projectId || "");
      const message = { type: "auditflow-desktop-command", command: "open-auditflow", projectId };
      if (window.parent !== window) {
        window.parent.postMessage(message, "*");
      } else if (window.opener && !window.opener.closed) {
        window.opener.postMessage(message, "*");
      } else {
        location.href = auditFlowUrl(`/standard/${encodeURIComponent(projectId)}`);
      }
      return;
    }
    if (type === "close-detail") { state.selectedItem = null; state.detailTab = "properties"; render(); return; }
    if (type === "refresh") { state.workspace = await api("/api/workspace"); render(); return; }
    if (type === "global-search") { document.querySelector("#global-search")?.focus(); return; }
    if (type === "expand-tools") { notify("The tool panel remains available on the current project page"); return; }
    if (type === "new-item") { const title = await requestText({ title: "Create work item", label: "Work item title", placeholder: "System requirement" }); if (!title) return; const created = await api("/api/items", { method: "POST", body: JSON.stringify({ title, type: "System Requirement", process: "SYS.2", owner: "System Administrator", body: "Complete the controlled requirement description.", verification: "Define method, conditions, measurable pass/fail rule and evidence reference." }) }); state.workspace = await api("/api/workspace"); state.view = "items"; state.selectedItem = created.id; notify("Work item created"); return; }
    if (type === "new-doc") { const title = await requestText({ title: "Create document page", label: "Page title", placeholder: "Design document" }); if (!title) return; const created = await api("/api/documents", { method: "POST", body: JSON.stringify({ title, space: "Design" }) }); state.workspace = await api("/api/workspace"); state.view = "design"; state.selectedDocument = created.id; notify("Page created"); return; }
    if (type === "stage-import") {
      const input = document.createElement("input"); input.type = "file"; input.accept = ".docx,.pdf,.xlsx,.xls,.csv,.json,.html,.htm,.txt,.md,.yaml,.yml";
      input.onchange = async () => {
        const file = input.files?.[0]; if (!file || file.size > 10 * 1024 * 1024) return notify("Select an ASPICE source smaller than 10 MB");
        const data = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); });
        try {
          const staged = await api("/api/import-staging", { method: "POST", body: JSON.stringify({ name: file.name, mime: file.type, data, documentId: state.selectedDocument || undefined, originalLanguage: document.documentElement.lang || "en" }) });
          const commit = await requestConfirmation(`Stage ${staged.name} for review? No existing document will be overwritten.`);
          if (commit) {
            const result = await api(`/api/import-staging/${encodeURIComponent(staged.id)}/commit`, { method: "POST", body: JSON.stringify({ parentId: state.selectedDocument || undefined, reason: "Assessor-approved staged source import" }) });
            state.workspace = await api("/api/workspace"); state.selectedDocument = result.document.id; state.view = "design"; render(); notify(`Imported ${staged.name} as a new controlled document`);
          } else notify(`${staged.name} is staged and remains pending review`);
        } catch (error) { notify(`Import staging failed: ${error.message}`); }
      }; input.click(); return;
    }
    if (type === "export-document-library") {
      const bundle = await api("/api/documents/export");
      const name = `FileAnalyst-${state.workspace.meta.projectId || "project"}-document-library-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify(`Exported ${bundle.documents.length} documents and ${bundle.nodes.length} nodes`);
      return;
    }
    if (type === "import-document-library") {
      const input = document.createElement("input"); input.type = "file"; input.accept = ".json,application/json";
      input.onchange = async () => {
        const file = input.files?.[0]; if (!file || file.size > 20 * 1024 * 1024) return notify("Select a document library bundle smaller than 20 MB");
        try {
          const bundle = JSON.parse(await file.text());
          if (!bundle || bundle.schema !== "fileanalyst.document-library/v1") throw new Error("Unsupported FileAnalyst document bundle");
          const proceed = await requestConfirmation(`Import ${bundle.documents?.length || 0} documents and ${bundle.nodes?.length || 0} structured nodes? Existing IDs will remain unchanged.`);
          if (!proceed) return;
          const result = await api("/api/documents/import", { method: "POST", body: JSON.stringify({ bundle, reason: "Polarion-style document library import" }) });
          state.workspace = await api("/api/workspace"); state.selectedDocument = result.documents ? state.workspace.documents[0]?.id : state.selectedDocument; render(); notify(`Imported ${result.documents} documents, ${result.nodes} nodes and ${result.items} work items`);
        } catch (error) { notify(`Import failed: ${error.message}`); }
      }; input.click(); return;
    }
    if (type === "lock-document") {
      const documentId = state.selectedDocument;
      if (!documentId) return;
      const resourceId = `document:${documentId}`;
      const current = state.collaboration.locks.find(lock => lock.resourceId === resourceId);
      if (current?.ownerId === currentUserId() && current.clientId === state.collaboration.clientId) {
        await api(`/api/collaboration/locks/${collaborationResource(resourceId)}`, { method: "DELETE", body: JSON.stringify({}) });
        notify("Structure lock released");
      } else {
        await api("/api/collaboration/locks", { method: "POST", body: JSON.stringify({ resourceId, clientId: state.collaboration.clientId, kind: "document-structure", reason: "LiveDoc structural editing" }) });
        notify("Structure lock acquired for 90 seconds");
      }
      await refreshDocumentCollaboration();
      render();
      return;
    }
    if (type === "new-comment") {
      const documentId = state.selectedDocument;
      if (!documentId) return;
      const commentText = await requestText({ title: "Add discussion comment", label: "Comment", placeholder: "Record a review question or discussion point.", multiline: true, submitLabel: "Add comment" });
      if (!commentText) return;
      const focusedNode = document.activeElement?.closest?.(".document-node");
      await api("/api/collaboration/comments", { method: "POST", body: JSON.stringify({ resourceId: `document:${documentId}`, nodeId: focusedNode?.dataset.nodeId || null, body: commentText, anchor: focusedNode ? { nodeId: focusedNode.dataset.nodeId } : null }) });
      await refreshDocumentCollaboration();
      render();
      notify("Comment thread added");
      return;
    }
    if (type === "new-glossary") { const term = await requestText({ title: "Add glossary term", label: "Term", placeholder: "Controlled project term" }); if (!term) return; const definition = await requestText({ title: "Define glossary term", label: "Definition", value: "Controlled project terminology.", multiline: true }); if (definition === null) return; await api("/api/glossary", { method: "POST", body: JSON.stringify({ term, definition, owner: "System Administrator" }) }); state.workspace = await api("/api/workspace"); notify("Glossary term created"); return; }
    if (type === "save-glossary") { const term = (state.workspace.glossary || []).find(x => x.id === event.currentTarget.dataset.termId); if (!term) return; const payload = { baseVersion: term.version }; document.querySelectorAll(`[data-term-id="${CSS.escape(term.id)}"]`).forEach(el => { if (el.dataset.glossaryEdit) payload[el.dataset.glossaryEdit] = el.value; }); await api(`/api/glossary/${encodeURIComponent(term.id)}`, { method: "PUT", body: JSON.stringify(payload) }); state.workspace = await api("/api/workspace"); notify("Glossary term saved; revision recorded"); return; }
    if (type === "upload-item" || type === "upload-document") { const input = document.createElement("input"); input.type = "file"; input.onchange = async () => { const file = input.files?.[0]; if (!file || file.size > 10 * 1024 * 1024) return notify("Select a file smaller than 10 MB"); const data = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); }); await api("/api/uploads", { method: "POST", body: JSON.stringify({ name: file.name, mime: file.type, size: file.size, data, itemId: type === "upload-item" ? state.selectedItem : undefined, documentId: type === "upload-document" ? state.selectedDocument : undefined }) }); state.workspace = await api("/api/workspace"); render(); notify("File attached"); }; input.click(); return; }
    if (type === "save-item") {
      const current = itemById(state.selectedItem);
      if (!current) return;
      const payload = { baseVersion: current.version, customFields: {} };
      document.querySelectorAll("[data-edit]").forEach(el => { payload[el.dataset.edit] = el.value; });
      document.querySelectorAll("[data-custom-edit]").forEach(el => {
        const field = workItemConfiguration().fields.find(item => item.id === el.dataset.customEdit);
        payload.customFields[el.dataset.customEdit] = ["tags", "links"].includes(field?.type)
          ? String(el.value || "").split(/[,;\n]/).map(value => value.trim()).filter(Boolean)
          : el.value;
      });
      await api(`/api/items/${encodeURIComponent(current.id)}`, { method: "PUT", body: JSON.stringify(payload) });
      state.workspace = await api("/api/workspace");
      notify("Work item saved; revision recorded");
      return;
    }
    if (type === "save-work-item-configuration") {
      const current = workItemConfiguration();
      const fields = (current.fields || []).map(field => ({
        ...field,
        label: document.querySelector(`[data-config-label="${CSS.escape(field.id)}"]`)?.value || field.label,
        options: String(document.querySelector(`[data-config-options="${CSS.escape(field.id)}"]`)?.value || "").split(",").map(value => value.trim()).filter(Boolean)
      }));
      const presentation = (current.presentation || []).map(section => ({
        ...section,
        label: document.querySelector(`[data-config-section-label="${CSS.escape(section.id)}"]`)?.value || section.label,
        fields: String(document.querySelector(`[data-config-section-fields="${CSS.escape(section.id)}"]`)?.value || "").split(",").map(value => value.trim()).filter(Boolean)
      }));
      const statuses = String(document.querySelector("#config-statuses")?.value || "").split(",").map(value => value.trim()).filter(Boolean);
      const transitions = String(document.querySelector("#config-transitions")?.value || "").split(/\n/).map(line => line.trim()).filter(Boolean).map(line => {
        const [idValue, fromValue, to, labelValue] = line.split("|");
        return { id: idValue?.trim(), from: String(fromValue || "").split("+").map(value => value.trim()).filter(Boolean), to: to?.trim(), label: labelValue?.trim() || to?.trim() };
      });
      const relationTypes = String(document.querySelector("#config-relations")?.value || "").split(/\n/).map(line => line.trim()).filter(Boolean).map(line => {
        const [idValue, labelValue, inverse, evidenceMode] = line.split("|");
        return { id: idValue?.trim(), label: labelValue?.trim(), inverse: inverse?.trim() || labelValue?.trim(), requiresEvidence: evidenceMode?.trim() === "evidence" };
      });
      const result = await api("/api/work-item-configuration", {
        method: "PUT",
        body: JSON.stringify({
          baseRevision: Number(state.workspace.meta.workItemConfigurationRevision || 1),
          configuration: { ...current, fields, presentation, workflow: { ...current.workflow, statuses, transitions }, relationTypes },
          reason: "Updated Polarion-style work item configuration"
        })
      });
      state.workspace.workItemConfiguration = result.configuration;
      state.workspace.meta.workItemConfigurationRevision = result.revision;
      notify("Work item configuration saved");
      render();
      return;
    }
    if (type === "save-doc") { await saveDoc(); notify("Page saved as a new version"); return; }
    if (type === "insert-item") {
      const itemId = await requestText({ title: "Insert work item", label: `Work item ID (${state.workspace.items.map(i => i.id).join(", ")})`, placeholder: "Enter an existing work item ID" });
      if (!itemId || !itemById(itemId)) return;
      const d = state.workspace.documents.find(x => x.id === state.selectedDocument);
      const rootId = nodeIdForClient(d.id, "root");
      const current = state.collaboration.locks.find(lock => lock.resourceId === `document:${d.id}`);
      if (!current || current.ownerId !== currentUserId() || current.clientId !== state.collaboration.clientId) {
        await api("/api/collaboration/locks", { method: "POST", body: JSON.stringify({ resourceId: `document:${d.id}`, clientId: state.collaboration.clientId, kind: "document-structure", reason: "Insert work item embedding" }) });
      }
      await submitDocumentOperation(d.id, "insertNode", null, { parentId: rootId, nodeType: "item-embedding", itemId, html: `<p data-work-item-id="${esc(itemId)}">${esc(itemId)}</p>`, text: itemId }, currentRevision(d), "Insert work item embedding");
      state.workspace = await api("/api/workspace");
      await refreshDocumentCollaboration();
      render();
      notify("Work item embedded as a controlled node");
      return;
    }
    if (type === "new-link") { const from = await requestText({ title: "Create trace link", label: `Source work item ID (${state.workspace.items.map(i => i.id).join(", ")})` }); if (!from) return; const to = await requestText({ title: "Create trace link", label: "Target work item ID" }); if (!to) return; const role = await requestText({ title: "Create trace link", label: "Link role", value: "verified by" }); if (role === null) return; await api("/api/links", { method: "POST", body: JSON.stringify({ from, to, role: role || "relates to" }) }); state.workspace = await api("/api/workspace"); state.view = "trace"; notify("Trace link created"); return; }
    if (type === "review-link" || type === "review-link-menu") {
      const link = state.workspace.links.find(candidate => candidate.id === event.currentTarget.dataset.linkId);
      if (!link) return;
      if (!canMutate()) return notify("This project is read-only");
      const requestedStatus = type === "review-link" ? event.currentTarget.dataset.status : await requestText({ title: `Review ${link.id}`, label: "Status", value: link.status, placeholder: "valid, suspect, invalid, candidate or unreviewed" });
      if (!["valid", "suspect", "invalid", "candidate", "unreviewed"].includes(requestedStatus)) return;
      const reason = await requestText({ title: `Review ${link.id}`, label: "Review reason", value: link.review?.reason || link.reviewRequiredReason || "", multiline: true });
      if (reason === null) return;
      let evidenceLocator = link.locator || "";
      if (requestedStatus === "valid" && !evidenceLocator) {
        evidenceLocator = await requestText({ title: "Confirm trace link", label: "Stable locator or review basis", placeholder: "Document or work-item locator" }) || "";
      }
      const source = itemById(link.from);
      const target = itemById(link.to);
      await api(`/api/links/${encodeURIComponent(link.id)}/status`, {
        method: "PUT",
        body: JSON.stringify({
          status: requestedStatus,
          baseRevision: Number(link.revision || 1),
          sourceRevision: currentRevision(source),
          targetRevision: currentRevision(target),
          reason,
          evidenceLocator
        })
      });
      state.workspace = await api("/api/workspace");
      render();
      notify(`Link ${link.id} marked ${linkStatusLabel(requestedStatus)}`);
      return;
    }
    if (type === "new-baseline") { const title = await requestText({ title: "Create baseline", label: "Baseline name", value: "Assessment Readiness Baseline" }); if (!title) return; await api("/api/baselines", { method: "POST", body: JSON.stringify({ title, createdBy: currentUserName() }) }); state.workspace = await api("/api/workspace"); state.view = "baselines"; notify("Baseline frozen"); return; }
    if (type === "new-run") { const title = await requestText({ title: "Create test run", label: "Test run name", value: "Integration verification run" }); if (!title) return; const build = await requestText({ title: "Create test run", label: "Build identifier", value: "Display-INT-0.4" }); if (build === null) return; const environment = await requestText({ title: "Create test run", label: "Environment", value: "HIL bench / CANoe" }); if (environment === null) return; await api("/api/test-runs", { method: "POST", body: JSON.stringify({ title, build: build || "", environment: environment || "" }) }); state.workspace = await api("/api/workspace"); state.view = "runs"; notify("Test run created"); }
  } catch (error) {
    if (error.status === 409 || error.data?.code === "revision-conflict") {
      state.collaboration.status = "conflict";
      updateCollaborationChrome();
      notify("Conflict detected. Your draft remains open; reload the latest revision before retrying.");
    } else if (error.status === 423 || error.data?.code === "resource-locked") {
      state.collaboration.status = "locked";
      updateCollaborationChrome();
      notify("Another collaborator holds the structural lock.");
    } else if (error.message.includes("changed since")) { state.workspace = await api("/api/workspace"); notify("The record changed elsewhere. Reload the latest version before saving."); }
    else notify(`Operation failed: ${error.message}`);
  }
}

async function saveDoc(extra = {}) {
  const d = state.workspace.documents.find(x => x.id === state.selectedDocument);
  if (!d) return;
  const nodes = document.querySelectorAll(".document-node[data-node-id]");
  for (const element of nodes) {
    if (element.dataset.dirty !== "true") continue;
    const node = (state.workspace.documentNodes || []).find(candidate => candidate.nodeId === element.dataset.nodeId);
    if (!node) continue;
    const result = await submitDocumentOperation(d.id, "updateText", { nodeId: node.nodeId }, { html: element.innerHTML, text: element.textContent || "" }, Number(node.revision || 1), "Save document node draft");
    node.content = result.record.content;
    node.revision = result.record.revision;
    element.dataset.dirty = "false";
  }
  if (Object.keys(extra).length) {
    const latest = state.workspace.documents.find(x => x.id === d.id) || d;
    await api(`/api/documents/${encodeURIComponent(d.id)}`, { method: "PUT", body: JSON.stringify({ baseVersion: latest.version, ...extra }) });
  }
  state.workspace = await api("/api/workspace");
  await refreshDocumentCollaboration();
  render();
}

async function updateRunResult(runId, itemId, status) {
  try {
    const actual = status === "Passed" ? await requestText({ title: "Record test result", label: "Actual result or evidence ID" }) || "" : status === "Failed" ? await requestText({ title: "Record test result", label: "Failure observation or problem report", multiline: true }) || "" : "";
    await api(`/api/test-runs/${encodeURIComponent(runId)}/results/${encodeURIComponent(itemId)}`, { method: "PUT", body: JSON.stringify({ status, actual }) });
    state.workspace = await api("/api/workspace");
    notify("Test result saved");
  } catch (error) { notify(`Operation failed: ${error.message}`); }
}

try { await bootWorkspace(); if (state.workspace) render(); else projectChooserView(); }
catch (error) {
  const el = document.querySelector("#app");
  if (el) {
    const message = displayError(error, "FileAnalyst could not connect.");
    state.projectError = message;
    el.innerHTML = `<div style="background:#2d1b1b;border:1px solid #5c2626;border-radius:10px;padding:28px 24px;margin:40px auto;max-width:520px;font-family:'Segoe UI',system-ui,sans-serif">
      <h2 style="margin:0 0 10px;font-size:16px;color:#f87171">\u26A0 FileAnalyst cannot connect</h2>
      <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#fca5a5">${esc(message)}</p>
      <p style="margin:0 0 16px;font-size:12px;color:#9ca3af">${translateUi("Sign in to JEAuditFlow and reopen FileAnalyst. If the problem persists, check")} <code style="background:#374151;padding:1px 5px;border-radius:3px;color:#e5e7eb">%LOCALAPPDATA%\\JEAuditFlow\\Logs\\desktop-*.log</code></p>
      <a href="${esc(auditFlowUrl("/dashboard"))}" style="display:inline-block;padding:9px 14px;border-radius:6px;background:#2563eb;color:#fff;text-decoration:none;font-size:12px;font-weight:600">Return to JEAuditFlow sign in</a>
    </div>`;
  }
}
