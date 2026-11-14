(() => {
  "use strict";
  if (!/^https?:$/.test(location.protocol) || new URL(location.href).searchParams.get("embedded") === "1") return;
  const gate = document.getElementById("authGate"), shell = document.querySelector(".app-shell");
  let resolveReady, language = "en", registering = false, initializing = false, bootstrapStatus = null, ssoEnabled = false, ssoFailure = false;
  const auth = window.AuditFlowAuth = {web:true,authenticated:false,user:null,endpoint:location.origin,sessionToken:"",ready:new Promise(resolve=>{resolveReady=resolve;})};
  const esc = value => String(value || "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const t=(en,zh)=>language==="en"?en:zh;
  shell.inert=true;shell.setAttribute("aria-hidden","true");
  async function request(path,body) {
    const response=await fetch(path,{method:body?"POST":"GET",credentials:"same-origin",headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
    const data=await response.json();if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`);return data;
  }
  async function loadBootstrapStatus() {
    try { return await request("/api/auth/bootstrap-status"); }
    catch (_) { return null; }
  }
  function reveal(data) {
    auth.authenticated=true;auth.user={...data.user,localOnly:false};
    gate.hidden=true;gate.innerHTML="";shell.inert=false;shell.removeAttribute("aria-hidden");
    const account=document.getElementById("authAccountButton");account.hidden=false;account.textContent=auth.user.email;account.setAttribute("aria-label",`${t("Current account","当前账号")} ${auth.user.email}`);
    account.addEventListener("click",()=>{
      const old=document.getElementById("authAccountMenu");if(old){old.remove();return;}
      const menu=document.createElement("div");menu.id="authAccountMenu";menu.className="auth-account-menu";
      menu.innerHTML=`<strong>${esc(auth.user.email)}</strong><a href="#/settings">${t("Account and settings","账户与设置")}</a><button type="button">${t("Sign out","退出登录")}</button>`;
      account.parentElement.append(menu);menu.querySelector("button").addEventListener("click",auth.logout);
    });
    resolveReady(auth.user);window.dispatchEvent(new CustomEvent("auditflow-authenticated",{detail:auth.user}));
  }
  auth.logout=async()=>{try{await request("/api/auth/logout",{});}finally{location.reload();}};
  function render(error="") {
    gate.hidden=false;
    const setup = initializing;
    const title = setup ? t("Initialize administrator", "初始化管理员") : registering ? t("Create account","创建账号") : t("Sign in","登录");
    const description = setup
      ? t("Set the local administrator password before opening this desktop workspace.", "首次打开本机工作台，请先设置管理员密码。")
      : "";
    const defaultAdminEmail = String(bootstrapStatus?.email || bootstrapStatus?.defaultAdminEmail || "yumeng.li@johnsonelectric.com").trim().toLowerCase();
    const formFields = setup
      ? `<div class="auth-admin-identity"><span>${t("Administrator account","管理员账号")}</span><strong>${esc(defaultAdminEmail)}</strong></div><label>${t("Password","密码")}<input name="password" type="password" autocomplete="new-password" required minlength="10" maxlength="200"></label><label>${t("Confirm password","确认密码")}<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="10" maxlength="200"></label>`
      : `${registering?`<label>${t("Name","姓名")}<input name="displayName" autocomplete="name" required minlength="2" maxlength="160"></label>`:""}<label>${t("Work email","工作邮箱")}<input name="email" type="email" autocomplete="username" required maxlength="320"></label><label>${t("Password","密码")}<input name="password" type="password" autocomplete="${registering?"new-password":"current-password"}" required minlength="${registering?10:1}" maxlength="200"></label>`;
    const switchLabel = setup
      ? t("Use sign in", "使用登录")
      : bootstrapStatus?.available === true || bootstrapStatus?.canInitialize === true
        ? t("Initialize administrator", "初始化管理员")
        : registering ? t("Back to sign in","返回登录") : t("Create account","创建账号");
    gate.innerHTML=`<main class="auth-panel" lang="${language}" data-i18n-skip><button class="auth-language-toggle" type="button" data-language>${language==="en"?"Chinese":"English"}</button><div class="auth-brand"><span class="auth-mark"><img src="./icons/icon-32.png" alt=""></span><div><strong>AuditFlow</strong><small>ASPICE WORKSPACE</small></div></div><div class="auth-heading"><h1>${title}</h1>${description?`<p>${description}</p>`:""}</div>${setup?`<p class="auth-note auth-setup-note">${t("This account is reserved for local administration. The password is stored as a hash and is never included in the package or URL.","此账号仅用于本机管理。密码只以哈希形式保存，不会写入安装包或网址。")}</p>`:""}<form class="auth-form">${formFields}<p class="auth-error" role="alert" ${error?"":"hidden"}>${esc(error)}</p><button class="auth-submit" type="submit">${setup?t("Initialize and sign in","初始化并登录"):registering?t("Create account","创建账号"):t("Sign in","登录")}</button></form>${ssoFailure&&!setup&&!registering?`<p class="auth-error" role="status">${t("Microsoft sign-in was not completed. Try again or use your AuditFlow account.","Microsoft 登录未完成。请重试或使用 AuditFlow 账号登录。")}</p>`:""}${ssoEnabled&&!setup&&!registering?`<a class="auth-sso-button" href="/api/auth/sso/start">${t("Sign in with Microsoft","使用 Microsoft 登录")}</a>`:""}<button class="btn secondary" data-switch type="button">${switchLabel}</button></main>`;
    gate.querySelector("[data-language]").onclick=()=>{language=language==="en"?"zh-CN":"en";render();};
    gate.querySelector("[data-switch]").onclick=()=>{
      if (setup) { initializing=false; registering=false; }
      else if (bootstrapStatus?.available === true || bootstrapStatus?.canInitialize === true) initializing=true;
      else registering=!registering;
      render();
    };
    gate.querySelector("form").onsubmit=async event=>{
      event.preventDefault();const form=event.currentTarget,button=form.querySelector("button");button.disabled=true;
      const values=Object.fromEntries(new FormData(form));
      if (setup && values.password !== values.confirmPassword) {
        const alert=form.querySelector(".auth-error");alert.hidden=false;alert.textContent=t("Passwords do not match.","两次输入的密码不一致。");button.disabled=false;form.querySelector("[name=confirmPassword]")?.focus();return;
      }
      try {
        const payload = setup
          ? await request("/api/auth/bootstrap-admin",{password:values.password})
          : await request(`/api/auth/${registering?"register":"login"}`,values);
        reveal(payload);
      }
      catch(error){
        const alert=form.querySelector(".auth-error");alert.hidden=false;alert.textContent=t(String(error.message).replace("邮箱或密码不正确","Incorrect email or password"),error.message);button.disabled=false;
        if (setup) { form.querySelector("[name=password]").value="";form.querySelector("[name=confirmPassword]").value="";form.querySelector("[name=password]")?.focus(); }
      }
    };
  }
  const authUrl=new URL(location.href);
  ssoFailure=authUrl.searchParams.get("sso")==="failed";
  if(authUrl.searchParams.has("sso")){authUrl.searchParams.delete("sso");history.replaceState(history.state,"",authUrl.pathname+authUrl.search+authUrl.hash);}
  request("/api/auth/sso/config").then(config=>{
    ssoEnabled=config?.enabled===true;
    if(!auth.authenticated&&!gate.hidden)render();
  }).catch(()=>{});
  request("/api/auth/me").then(reveal).catch(async()=>{
    bootstrapStatus=await loadBootstrapStatus();
    initializing=bootstrapStatus?.available === true || bootstrapStatus?.canInitialize === true;
    render();
  });
})();
