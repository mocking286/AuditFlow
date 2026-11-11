(function () {
  "use strict";
  const copy = { en: { ai: "AI service", helix: "Helix Bridge", ready: "Ready", workspace: "WORKSPACE", activeProjects: "Active projects", noProjects: "No active projects", openHome: "Open home", settings: "Settings", local: "Local collaboration status" }, zh: { ai: "AI 服务", helix: "Helix Bridge", ready: "就绪", workspace: "工作区", activeProjects: "当前项目", noProjects: "暂无活动项目", openHome: "打开主页", settings: "设置", local: "本机协作状态" } };
  let language = "en";
  const projectList = document.getElementById("projectList");
  const emptyProjects = document.getElementById("emptyProjects");
  const lastRefresh = document.getElementById("lastRefresh");
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const open = path => { chrome.tabs.create({ url: chrome.runtime.getURL(path) }); window.close(); };
  function readProjects() { try { const stored = JSON.parse(localStorage.getItem("auditflow-ai-workspace-v1") || "null"); return [...(stored?.standardProjects || []), ...(stored?.customAudits || [])].slice(0, 6); } catch (_) { return []; } }
  function renderProjects() { const projects = readProjects(); projectList.replaceChildren(); emptyProjects.hidden = projects.length > 0; projects.forEach(project => { const row = document.createElement("button"); row.type = "button"; row.className = "project-row"; row.innerHTML = `<span class="project-dot"></span><span class="project-copy"><strong>${escapeHtml(project.name || project.id || "Project")}</strong><small>${escapeHtml(project.id || "")}${project.processes?.length ? ` · ${project.processes.slice(0, 3).join(", ")}` : ""}</small></span><span class="project-arrow">›</span>`; row.addEventListener("click", () => open(`index.html?fromLanding=1#/standard/${encodeURIComponent(project.id || "")}`)); projectList.append(row); }); }
  function translate() { document.documentElement.lang = language; document.querySelectorAll("[data-i18n]").forEach(node => { node.textContent = copy[language][node.dataset.i18n] || node.textContent; }); document.querySelector("[data-action=toggle-language]").textContent = language === "en" ? "ZH" : "EN"; renderProjects(); }
  document.querySelectorAll("[data-open]").forEach(button => button.addEventListener("click", () => open(button.dataset.open)));
  document.querySelector("[data-action=refresh]")?.addEventListener("click", () => { renderProjects(); lastRefresh.textContent = `${copy[language].local} · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`; });
  document.querySelector("[data-action=toggle-language]")?.addEventListener("click", () => { language = language === "en" ? "zh" : "en"; translate(); });
  renderProjects();
}());
