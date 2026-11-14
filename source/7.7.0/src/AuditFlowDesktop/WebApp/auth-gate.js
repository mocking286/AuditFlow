(function () {
  "use strict";
  function decorateEntry(gate) {
    const panel = gate?.querySelector(".auth-panel");
    if (!panel || panel.closest(".auth-entry")) return;
    const chinese = panel.lang === "zh-CN";
    const entry = document.createElement("div"); entry.className = "auth-entry"; entry.lang = chinese ? "zh-CN" : "en"; entry.setAttribute("data-i18n-skip", "");
    const guidance = document.createElement("aside"); guidance.className = "auth-guidance";
    guidance.innerHTML = `<div class="auth-guidance-brand"><img src="./icons/icon-32.png" alt=""><strong>JEAuditFlow</strong></div><span class="auth-guidance-kicker">AUTOMOTIVE SPICE 4.0</span><h2>${chinese ? "ASPICE 审核工作台" : "ASPICE Audit Workbench"}</h2><p>${chinese ? "将范围、客观证据、评估结论和改进闭环放在同一工作区。" : "Bring scope, objective evidence, assessment decisions and improvement actions into one workspace."}</p><ul><li>${chinese ? "按过程、BP 和 GP 定位审核上下文" : "Navigate assessments by process, BP and GP"}</li><li>${chinese ? "保留证据来源与评估追溯" : "Keep evidence sources and assessment traceability"}</li><li>${chinese ? "AI 提供建议，评估师确认结论" : "Use AI advice with assessor-owned conclusions"}</li></ul><a href="./help-manual.html" target="_blank" rel="noopener">${chinese ? "操作手册" : "User manual"}</a>`;
    const links = document.createElement("footer"); links.className = "auth-entry-links";
    links.innerHTML = `<button type="button" data-auth-feedback>${chinese ? "问题反馈" : "Report a problem"}</button><a href="./landing.html">${chinese ? "宣传页" : "Product overview"}</a>`;
    links.querySelector("[data-auth-feedback]").addEventListener("click", () => window.AuditFlowFeedback?.open({ source: "login" }));
    panel.before(entry); entry.append(guidance, panel, links);
  }
  const entryGate = document.getElementById("authGate");
  if (entryGate && typeof MutationObserver === "function") new MutationObserver(() => decorateEntry(entryGate)).observe(entryGate, { childList: true });
  decorateEntry(entryGate);
  if (window.AuditFlowAuth?.web) return;

  // Authentication is intentionally local-only in the single-user extension.
  // The email is a local visibility key; it is never posted to a service.
  const gate = document.getElementById("authGate");
  const shell = document.querySelector(".app-shell");
  const embeddedDesktop = new URL(location.href).searchParams.get("embedded") === "1";
  const LOCAL_PROFILE_KEY = "auditflow-local-profile-v1";
  const state = { language: "en", busy: false };
  const authCopy = () => state.language === "zh-CN" ? {
    title: "在本机打开 AuditFlow",
    description: "使用本机账号进入可编辑的 ASPICE 工作台。",
    name: "姓名",
    email: "工作邮箱",
    namePlaceholder: "审核员姓名",
    submit: "进入本机工作台",
    validating: "正在打开…",
    note: "单机模式：邮箱只用于本机项目可见性，不会发送到远端服务。",
    switchLanguage: "切换为英文",
    account: "账户",
    signOut: "退出当前账号",
    switchAccount: "切换账号",
    invalid: "请输入有效的工作邮箱。"
  } : {
    title: "Open AuditFlow locally",
    description: "Use a local profile to enter the fully editable ASPICE workspace.",
    name: "Name",
    email: "Work email",
    namePlaceholder: "Assessor name",
    submit: "Open local workspace",
    validating: "Opening…",
    note: "Single-user mode: your email is used only for local project visibility and is never sent to a remote service.",
    switchLanguage: "Switch to Chinese",
    account: "Account",
    signOut: "Sign out",
    switchAccount: "Switch account",
    invalid: "Enter a valid work email."
  };

  function readSessionToken() {
    try { return String(sessionStorage.getItem("auditflow_session_token") || "").trim(); } catch (_) { return ""; }
  }

  function readSessionEndpoint() {
    try { return String(sessionStorage.getItem("auditflow_session_endpoint") || "").trim(); } catch (_) { return ""; }
  }

  function storeSession(token, endpoint = "") {
    const value = String(token || "").trim();
    try {
      if (value) sessionStorage.setItem("auditflow_session_token", value);
      else sessionStorage.removeItem("auditflow_session_token");
      if (endpoint) sessionStorage.setItem("auditflow_session_endpoint", String(endpoint).replace(/\/+$/, ""));
      else sessionStorage.removeItem("auditflow_session_endpoint");
    } catch (_) { /* session storage can be unavailable in restricted WebViews */ }
    window.AuditFlowAuth.sessionToken = value;
    if (endpoint) window.AuditFlowAuth.endpoint = String(endpoint).replace(/\/+$/, "");
  }

  window.AuditFlowAuth = {
    authenticated: false,
    user: null,
    logout: null,
    endpoint: readSessionEndpoint() || "local",
    sessionToken: readSessionToken(),
    remoteSession: Boolean(readSessionToken()),
    acceptSession: null,
    clearSession: null,
    loginAccount: null,
    logoutAccount: null
  };
  if (!gate || !shell) return;
  shell.inert = true;
  shell.setAttribute("aria-hidden", "true");

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>\"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character]));
  }

  function initials(user) {
    return String(user?.name || user?.email || "AF").split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "AF";
  }

  function profileFromStorage() {
    try {
      const profile = JSON.parse(localStorage.getItem(LOCAL_PROFILE_KEY) || "null");
      if (!profile || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(profile.email || ""))) return null;
      const email = String(profile.email).trim().toLowerCase();
      const isAdmin = email === "yumeng.li@johnsonelectric.com";
      return { ...profile, email, isAdmin, localOnly: true, defaultRole: isAdmin ? "Administrator" : "Lead Assessor" };
    } catch (_) { return null; }
  }

  function configuredEndpoint() {
    const current = String(window.AuditFlowAuth.endpoint || "").trim();
    if (current && current !== "local") return current.replace(/\/+$/, "");
    try {
      const stored = JSON.parse(localStorage.getItem("auditflow-ai-workspace-v1") || "null");
      const configured = String(stored?.settings?.collaborationSyncUrl || stored?.settings?.backendUrl || "").trim();
      if (configured) return configured.replace(/\/+$/, "");
    } catch (_) { /* use the bridge default */ }
    return String(window.AuditFlowBackend?.baseUrl || "").replace(/\/+$/, "");
  }

  async function restoreRemoteSession() {
    const token = readSessionToken();
    const endpoint = readSessionEndpoint() || configuredEndpoint();
    if (!token || !endpoint || endpoint === "local") return false;
    try {
      const response = await fetch(`${endpoint}/api/auth/me`, {
        method: "GET",
        credentials: "include",
        headers: { "x-auditflow-session": token },
        signal: AbortSignal.timeout(10000)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.authenticated !== true || !payload?.user) throw new Error("remote session unavailable");
      acceptSession({ ...payload, sessionToken: token }, endpoint);
      return true;
    } catch (_) {
      clearSession();
      return false;
    }
  }

  function render() {
    const copy = authCopy();
    gate.hidden = false;
    gate.innerHTML = `<main class="auth-panel" lang="${state.language}" aria-labelledby="authTitle"><button type="button" class="auth-language-toggle" data-auth-language aria-label="${copy.switchLanguage}">${state.language === "en" ? "Chinese" : "English"}</button>
      <div class="auth-brand"><span class="auth-mark" aria-hidden="true"><img src="./icons/icon-32.png" alt=""></span><div><strong>AuditFlow</strong><small>ASPICE WORKSPACE</small></div></div>
      <div class="auth-heading"><span class="overline">LOCAL ASSESSMENT ACCESS</span><h1 id="authTitle">${copy.title}</h1><p>${copy.description}</p></div>
      <form id="authForm" class="auth-form">
        <label>${copy.name}<input name="displayName" autocomplete="name" minlength="2" maxlength="160" placeholder="${copy.namePlaceholder}"></label>
        <label>${copy.email}<input name="email" type="email" autocomplete="email" maxlength="320" required placeholder="name@company.com"></label>
        <p class="auth-error" id="authError" role="alert" hidden></p>
        <button class="auth-submit" type="submit" ${state.busy ? "disabled" : ""}>${state.busy ? copy.validating : copy.submit}</button>
      </form>
      <p class="auth-note">${copy.note}</p>
    </main>`;
    gate.querySelector("[data-auth-language]")?.addEventListener("click", () => { state.language = state.language === "en" ? "zh-CN" : "en"; render(); });
    gate.querySelector("#authForm")?.addEventListener("submit", submit);
    decorateEntry(gate);
    gate.querySelector("input[name=email]")?.focus();
  }

  function reveal(user, { remote = false } = {}) {
    const profile = {
      ...user,
      email: String(user?.email || "").trim().toLowerCase(),
      isAdmin: user?.isAdmin === true,
      localOnly: !remote,
      defaultRole: String(user?.defaultRole || (user?.isAdmin ? "Administrator" : "Lead Assessor"))
    };
    window.AuditFlowAuth.authenticated = true;
    window.AuditFlowAuth.user = profile;
    window.AuditFlowAuth.remoteSession = remote || Boolean(window.AuditFlowAuth.sessionToken);
    shell.inert = false;
    shell.removeAttribute("aria-hidden");
    gate.hidden = true;
    gate.innerHTML = "";
    document.documentElement.classList.remove("auth-pending");
    const avatar = document.querySelector(".profile-link .avatar");
    if (avatar) avatar.textContent = initials(profile);
    const account = document.getElementById("authAccountButton");
    if (account) {
      account.hidden = false;
      account.textContent = profile.email || profile.name || "Account";
      account.title = state.language === "en" ? "Open account menu" : "打开账号菜单";
      account.setAttribute("aria-label", `${state.language === "en" ? "Current account" : "当前账号"} ${profile.email || profile.name || "Account"}`);
    }
    const admin = document.getElementById("adminConsoleButton");
    if (admin) { admin.hidden = profile.isAdmin !== true; admin.textContent = state.language === "en" ? "Admin" : "后台"; }
    window.AuditFlowAuth.logout = logout;
    window.dispatchEvent(new CustomEvent("auditflow-authenticated", { detail: profile }));
  }

  function acceptSession(payload, endpoint = "") {
    const token = String(payload?.sessionToken || window.AuditFlowAuth.sessionToken || "").trim();
    storeSession(token, endpoint || window.AuditFlowAuth.endpoint);
    window.AuditFlowAuth.remoteSession = true;
    if (payload?.user) reveal(payload.user, { remote: true });
    return payload;
  }

  function clearSession() {
    storeSession("", "");
    window.AuditFlowAuth.remoteSession = false;
  }

  async function loginAccount(options = {}) {
    if (!window.AuditFlowBackend?.loginAccount) throw new Error("远端协作服务尚未加载");
    const payload = await window.AuditFlowBackend.loginAccount(options);
    return acceptSession(payload, options?.baseUrl || options?.endpoint || window.AuditFlowAuth.endpoint);
  }

  async function logoutAccount(options = {}) {
    try {
      if (window.AuditFlowBackend?.logoutAccount) return await window.AuditFlowBackend.logoutAccount(options);
      return { authenticated: false };
    } finally {
      clearSession();
    }
  }

  window.AuditFlowAuth.acceptSession = acceptSession;
  window.AuditFlowAuth.clearSession = clearSession;
  window.AuditFlowAuth.loginAccount = loginAccount;
  window.AuditFlowAuth.logoutAccount = logoutAccount;

  function accountMenu() {
    let menu = document.getElementById("authAccountMenu");
    if (menu) { menu.remove(); return; }
    const account = document.getElementById("authAccountButton");
    if (!account) return;
    const copy = authCopy();
    menu = document.createElement("div");
    menu.id = "authAccountMenu";
    menu.className = "auth-account-menu";
    menu.innerHTML = `<strong>${escapeHtml(window.AuditFlowAuth.user?.email || copy.account)}</strong><button type="button" data-auth-menu-action="logout">${copy.signOut}</button><button type="button" data-auth-menu-action="switch">${copy.switchAccount}</button>`;
    account.parentElement?.appendChild(menu);
    menu.querySelectorAll("[data-auth-menu-action]").forEach(button => button.addEventListener("click", () => logout(button.dataset.authMenuAction === "switch")));
  }

  async function logout(showLogin = false) {
    const remote = window.AuditFlowAuth.remoteSession && !window.AuditFlowAuth.user?.localOnly;
    if (remote) await logoutAccount({ baseUrl: window.AuditFlowAuth.endpoint }).catch(() => {});
    else clearSession();
    localStorage.removeItem(LOCAL_PROFILE_KEY);
    window.AuditFlowAuth.authenticated = false;
    window.AuditFlowAuth.user = null;
    document.getElementById("authAccountMenu")?.remove();
    const account = document.getElementById("authAccountButton");
    if (account) { account.hidden = false; account.textContent = state.language === "en" ? "Sign in" : "登录"; account.title = state.language === "en" ? "Open AuditFlow" : "打开 AuditFlow"; }
    const admin = document.getElementById("adminConsoleButton");
    if (admin) admin.hidden = true;
    window.dispatchEvent(new CustomEvent("auditflow-logged-out"));
    shell.inert = true;
    shell.setAttribute("aria-hidden", "true");
    if (showLogin) render();
  }

  function submit(event) {
    event.preventDefault();
    if (state.busy) return;
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const email = String(data.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      const error = form.querySelector("#authError");
      if (error) { error.hidden = false; error.textContent = authCopy().invalid; }
      return;
    }
    state.busy = true;
    render();
    const name = String(data.displayName || "").trim() || email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, character => character.toUpperCase());
    const isAdmin = email === "yumeng.li@johnsonelectric.com";
    const profile = { id: `local-${email.replace(/[^a-z0-9]+/gi, "-")}`, name, email, isAdmin, localOnly: true, defaultRole: isAdmin ? "Administrator" : "Lead Assessor", status: "active" };
    localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(profile));
    state.busy = false;
    reveal(profile);
  }

  document.addEventListener("click", event => {
    const account = event.target.closest?.("#authAccountButton");
    if (account) { event.preventDefault(); if (!window.AuditFlowAuth.authenticated) render(); else accountMenu(); return; }
    if (!event.target.closest?.("#authAccountMenu")) document.getElementById("authAccountMenu")?.remove();
  });

  const existing = profileFromStorage();
  let sessionRestore = Promise.resolve(false);
  if (readSessionToken()) {
    sessionRestore = restoreRemoteSession();
    sessionRestore.then(restored => {
      if (restored) return;
      if (existing) reveal(existing);
      else render();
    });
  } else if (existing) reveal(existing);
  else render();
  if (embeddedDesktop) {
    window.addEventListener("message", async event => {
      if (event.source !== window.parent || event.origin !== location.origin) return;
      if (event.data?.type !== "auditflow-desktop-context" || !event.data.user || (!event.data.localMode && !event.data.user.email)) return;
      await sessionRestore;
      if (window.AuditFlowAuth.authenticated && window.AuditFlowAuth.remoteSession && !window.AuditFlowAuth.user?.localOnly) return;
      const contextUser = event.data.user;
      const remote = event.data.remoteSession;
      const email = String(contextUser.email || "").trim().toLowerCase();
      const stableId = String(contextUser.userId || contextUser.id || (event.data.localMode ? "desktop-local" : email)).trim();
      if (remote?.sessionToken && remote?.endpoint) storeSession(remote.sessionToken, remote.endpoint);
      reveal({
        id: stableId,
        userId: stableId,
        name: String(contextUser.name || contextUser.displayName || (event.data.localMode ? "Local user" : email.split("@")[0])).trim(),
        displayName: String(contextUser.displayName || contextUser.name || (event.data.localMode ? "Local user" : email)).trim(),
        email,
        isAdmin: contextUser.isAdmin === true || String(contextUser.role || "").toLowerCase() === "admin",
        localOnly: !(remote?.sessionToken && remote?.endpoint),
        defaultRole: String(contextUser.role || (contextUser.isAdmin ? "Administrator" : "Lead Assessor"))
      }, { remote: Boolean(remote?.sessionToken && remote?.endpoint) });
    });
  }
}());
