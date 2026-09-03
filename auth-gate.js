(function () {
  "use strict";

  // Authentication is intentionally local-only in the single-user extension.
  // The email is a local visibility key; it is never posted to a service.
  const gate = document.getElementById("authGate");
  const shell = document.querySelector(".app-shell");
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

  window.AuditFlowAuth = { authenticated: false, user: null, logout: null, endpoint: "local", sessionToken: "" };
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
      return { ...profile, email: String(profile.email).trim().toLowerCase(), isAdmin: true, localOnly: true, defaultRole: "Administrator" };
    } catch (_) { return null; }
  }

  function render() {
    const copy = authCopy();
    gate.hidden = false;
    gate.innerHTML = `<main class="auth-panel" aria-labelledby="authTitle"><button type="button" class="auth-language-toggle" data-auth-language aria-label="${copy.switchLanguage}">${state.language === "en" ? "中文" : "English"}</button>
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
    gate.querySelector("input[name=email]")?.focus();
  }

  function reveal(user) {
    const profile = { ...user, email: String(user?.email || "").trim().toLowerCase(), isAdmin: true, localOnly: true, defaultRole: "Administrator" };
    window.AuditFlowAuth.authenticated = true;
    window.AuditFlowAuth.user = profile;
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
    window.AuditFlowAuth.logout = logout;
    window.dispatchEvent(new CustomEvent("auditflow-authenticated", { detail: profile }));
  }

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

  function logout(showLogin = false) {
    localStorage.removeItem(LOCAL_PROFILE_KEY);
    window.AuditFlowAuth.authenticated = false;
    window.AuditFlowAuth.user = null;
    document.getElementById("authAccountMenu")?.remove();
    const account = document.getElementById("authAccountButton");
    if (account) { account.hidden = false; account.textContent = state.language === "en" ? "Sign in" : "登录"; account.title = state.language === "en" ? "Open AuditFlow" : "打开 AuditFlow"; }
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
    const profile = { id: `local-${email.replace(/[^a-z0-9]+/gi, "-")}`, name, email, isAdmin: true, localOnly: true, defaultRole: "Administrator", status: "active" };
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
  if (existing) reveal(existing);
  else render();
}());
