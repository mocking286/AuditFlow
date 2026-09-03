(function () {
  "use strict";

  const DB_KEY = "auditflow-ai-workspace-v1";
  const DEFAULT_BACKEND = "http://127.0.0.1:4173";
  const DEFAULT_HELIX = "http://127.0.0.1:8787";
  const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
  let workspace = null;
  let language = "zh-CN";

  const copy = {
    "zh-CN": {
      subtitle: "ASPICE 工作区", aiLabel: "AI 服务", helixLabel: "Helix Bridge", checking: "检查中", ready: "就绪", local: "本地规则", notReady: "未就绪",
      eyebrow: "工作区", projects: "进行中的项目", refresh: "刷新", home: "进入首页", settings: "设置", empty: "当前没有进行中的项目", open: "打开项目",
      states: { running: "评估中", ready: "待评估", review: "待复核", draft: "草稿", complete: "已完成", archived: "已归档" }
    },
    en: {
      subtitle: "ASPICE workspace", aiLabel: "AI service", helixLabel: "Helix Bridge", checking: "Checking", ready: "Ready", local: "Local rules", notReady: "Not ready",
      eyebrow: "WORKSPACE", projects: "Active projects", refresh: "Refresh", home: "Open home", settings: "Settings", empty: "No audit is currently running", open: "Open project",
      states: { running: "Running", ready: "Ready", review: "Review", draft: "Draft", complete: "Completed", archived: "Archived" }
    }
  };

  function t() { return copy[language]; }
  function readWorkspace() {
    try { return JSON.parse(localStorage.getItem(DB_KEY) || "null") || { settings: {}, standardProjects: [], customAudits: [] }; }
    catch (_) { return { settings: {}, standardProjects: [], customAudits: [] }; }
  }
  function hasChinese(value) { return CJK.test(String(value || "")); }
  function projectTitle(project) {
    if (language !== "en") return project.name || project.id;
    if (!hasChinese(project.name)) return project.name || (hasChinese(project.id) ? "Audit project" : project.id);
    const rawScope = Array.isArray(project.processes) && project.processes.length ? project.processes.join(", ") : "ASPICE";
    const scope = hasChinese(rawScope) ? "ASPICE" : rawScope;
    return `${scope} assessment`;
  }
  function projectMeta(project) {
    const id = language === "en" && hasChinese(project.id) ? "Audit project" : (project.id || "Audit project");
    const rawScope = Array.isArray(project.processes) && project.processes.length ? project.processes.join(", ") : "Custom";
    const scope = language === "en" && hasChinese(rawScope) ? "Custom" : rawScope;
    return `${id} · ${scope}`;
  }
 function activeProjects() {
    const standard = (workspace.standardProjects || []).map(project => ({ ...project, kind: "standard" }));
    const custom = (workspace.customAudits || []).map(project => ({ ...project, kind: "custom" }));
    const order = { running: 0, ready: 1, review: 2, draft: 3, complete: 4, archived: 5 };
    return [...standard, ...custom].filter(project => !["archived", "complete"].includes(project.status)).sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }
  function renderProjects() {
    const root = document.getElementById("projectList");
    const projects = activeProjects();
    if (!projects.length) { root.innerHTML = `<div class="empty-state">${t().empty}</div>`; return; }
    root.innerHTML = projects.slice(0, 7).map(project => `<button class="project-item" type="button" data-kind="${project.kind}" data-id="${encodeURIComponent(project.id)}" aria-label="${t().open}"><span class="status-dot ${project.status === "running" ? "ready" : "local"}"></span><span class="project-copy"><span class="project-name">${escapeHtml(projectTitle(project))}</span><span class="project-meta">${escapeHtml(projectMeta(project))}</span></span><span class="project-state">${t().states[project.status] || t().states.ready}</span></button>`).join("");
  }
  function escapeHtml(value) { return String(value || "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
  function renderText() {
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
    document.documentElement.dataset.theme = localStorage.getItem("auditflow-theme") === "dark" ? "dark" : "light";
    document.getElementById("subtitle").textContent = t().subtitle;
    document.getElementById("aiLabel").textContent = t().aiLabel;
    document.getElementById("helixLabel").textContent = t().helixLabel;
    document.getElementById("projectEyebrow").textContent = t().eyebrow;
    document.getElementById("projectHeading").textContent = t().projects;
    document.getElementById("refreshButton").textContent = t().refresh;
    document.getElementById("homeButton").textContent = t().home;
    document.getElementById("settingsButton").textContent = t().settings;
    document.getElementById("languageButton").textContent = language === "en" ? "ZH" : "EN";
    document.getElementById("languageButton").setAttribute("aria-pressed", String(language === "en"));
    document.getElementById("languageButton").setAttribute("aria-label", language === "en" ? "Switch language" : "切换语言");
    document.getElementById("languageButton").title = language === "en" ? "Switch to Chinese" : "切换到英语";
  }
  function setStatus(id, ready, fallback) {
    const value = document.getElementById(`${id}Status`);
    const dot = document.getElementById(`${id}StatusDot`);
    value.textContent = ready ? t().ready : fallback ? t().local : t().notReady;
    dot.className = `status-dot ${ready ? "ready" : fallback ? "local" : ""}`;
  }
  async function checkJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);
    try { const response = await fetch(url, { signal: controller.signal }); return response.ok ? response.json() : null; }
    catch (_) { return null; }
    finally { clearTimeout(timer); }
  }
  async function refreshStatus() {
    const backendUrl = String(workspace.settings?.backendUrl || DEFAULT_BACKEND).replace(/\/+$/, "");
    const [backend, helix] = await Promise.all([checkJson(`${backendUrl}/api/health`), checkJson(`${DEFAULT_HELIX}/health`)]);
    setStatus("ai", backend?.status === "ok" && backend?.ai?.enabled === true && backend?.ai?.transport !== "unavailable", true);
    setStatus("helix", helix?.ok === true, false);
  }
  function openTarget(hash) {
    chrome.tabs.create({ url: chrome.runtime.getURL(`index.html${hash}`) });
    window.close();
  }
  function initialize() {
    workspace = readWorkspace();
    language = workspace.settings?.language === "en" ? "en" : "zh-CN";
    renderText();
    renderProjects();
    refreshStatus();
    document.getElementById("projectList").addEventListener("click", event => {
      const item = event.target.closest("[data-id]");
      if (!item) return;
      const id = decodeURIComponent(item.dataset.id || "");
      openTarget(item.dataset.kind === "custom" ? `#/custom/audit/${encodeURIComponent(id)}` : `#/standard/${encodeURIComponent(id)}`);
    });
    document.getElementById("homeButton").addEventListener("click", () => openTarget("#/dashboard"));
    document.getElementById("settingsButton").addEventListener("click", () => openTarget("#/settings"));
    document.getElementById("refreshButton").addEventListener("click", () => { workspace = readWorkspace(); renderText(); renderProjects(); refreshStatus(); });
    document.getElementById("languageButton").addEventListener("click", () => {
      language = language === "en" ? "zh-CN" : "en";
      workspace.settings ||= {};
      workspace.settings.language = language;
      localStorage.setItem(DB_KEY, JSON.stringify(workspace));
      renderText(); renderProjects(); refreshStatus();
    });
  }
  document.addEventListener("DOMContentLoaded", initialize);
}());
