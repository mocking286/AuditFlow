(function (root) {
  "use strict";
  const isLocal = () => ["127.0.0.1", "localhost", "[::1]"].includes(root.location?.hostname);
  const text = (zh, en) => /^zh/i.test(root.document?.documentElement?.lang || "zh") ? zh : en;
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function validateConnection({ remoteOrigin, sessionId, connectorToken } = {}) {
    let url;
    try { url = new URL(String(remoteOrigin || "").trim()); } catch { throw new Error(text("请输入有效的服务地址", "Enter a valid service origin")); }
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))) throw new Error(text("使用 HTTPS 源地址；本机测试可用 HTTP", "Use an HTTPS origin; loopback HTTP is allowed for local testing"));
    if (!/^[A-Za-z0-9_-]{1,96}$/.test(String(sessionId || "").trim())) throw new Error(text("会话编号无效", "Invalid session ID"));
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(String(connectorToken || "").trim())) throw new Error(text("连接令牌无效", "Invalid connector token"));
    return { remoteOrigin: url.origin, sessionId: String(sessionId).trim(), connectorToken: String(connectorToken).trim() };
  }
  let dialog, trigger, timer, secret = null;
  const backend = () => { if (!root.AuditFlowBackend?.listBridgeSessions) throw new Error(text("桥接服务尚未就绪", "Bridge service is unavailable")); return root.AuditFlowBackend; };
  const statusLabel = value => ({ connected: text("已连接", "Connected"), connecting: text("等待本机连接", "Waiting for Mac"), stopped: text("已停止", "Stopped"), disconnected: text("连接中断", "Disconnected"), expired: text("已过期", "Expired"), revoked: text("已撤销", "Revoked") }[value] || value);
  function message(value, failed = false) { const node = dialog?.querySelector("[data-bridge-message]"); if (node) { node.textContent = value; node.dataset.error = String(failed); } }
  async function action(button, callback) { button.disabled = true; try { await callback(); } catch (error) { message(error.message, true); } finally { button.disabled = false; } }
  async function refresh() {
    const view = dialog;
    if (!view?.open) return;
    try {
      const api = backend();
      const payload = await api.listBridgeSessions();
      if (dialog !== view || !view.open) return;
      const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
      dialog.querySelector("[data-bridge-sessions]").innerHTML = sessions.length ? sessions.map(session => {
        const id = String(session.sessionId);
        return `<li><div><strong>${escape(id)}</strong><span>${escape(statusLabel(session.status))}</span><small>${escape(text("有效至", "Expires"))} ${escape(new Date(session.expiresAt).toLocaleTimeString())}</small></div><nav>${(session.routes || []).filter(route => ["jira", "confluence"].includes(route)).map(route => session.status === "connected" ? `<a class="btn secondary sm" href="${escape(api.bridgeServiceUrl(id, route))}" target="_blank" rel="noopener noreferrer">${route === "jira" ? "Jira" : "Confluence"}</a>` : `<span>${route === "jira" ? "Jira" : "Confluence"}</span>`).join("")}<button class="btn secondary sm" type="button" data-bridge-revoke="${escape(id)}">${text("撤销会话", "Revoke")}</button></nav></li>`;
      }).join("") : `<li class="bridge-empty">${text("暂无有效会话", "No active sessions")}</li>`;
      if (isLocal()) {
        const local = await api.localBridgeStatus();
        if (dialog !== view || !view.open) return;
        dialog.querySelector("[data-bridge-local-status]").textContent = [statusLabel(local.status), local.remoteOrigin, local.error].filter(Boolean).join(" · ");
        trigger.dataset.connected = String(local.status === "connected");
      } else trigger.dataset.connected = String(sessions.some(session => session.status === "connected"));
    } catch (error) { message(error.message, true); }
  }
  function addConnectionPaste(view) {
    const connectorForm = view.querySelector("form");
    if (connectorForm) {
      const pasteField = root.document.createElement("label");
      pasteField.className = "bridge-paste";
      pasteField.innerHTML = `${text("一次性连接信息", "One-Time Connection Details")}<textarea name="connectionDetails" rows="2" autocomplete="off" aria-label="${text("粘贴一次性连接信息", "Paste one-time connection details")}"></textarea>`;
      connectorForm.prepend(pasteField);
      pasteField.querySelector("textarea").addEventListener("input", event => {
        try {
          const connection = validateConnection(JSON.parse(event.target.value));
          for (const [key, value] of Object.entries(connection)) connectorForm.elements[key].value = value;
          event.target.value = "";
          message(text("连接信息已填入", "Connection details entered"));
        } catch (_) { /* Partial paste stays editable until it is valid JSON. */ }
      });
    }
  }
  function close() { clearInterval(timer); secret = null; if (dialog) { dialog.remove(); dialog = null; } trigger?.setAttribute("aria-expanded", "false"); trigger?.focus(); }
  function open() {
    if (dialog?.open) return;
    dialog = root.document.createElement("dialog");
    dialog.className = "bridge-workbench"; dialog.setAttribute("aria-labelledby", "bridgeWorkbenchTitle");
    dialog.innerHTML = `<header><h2 id="bridgeWorkbenchTitle">${text("本机服务桥接", "Mac Service Bridge")}</h2><button type="button" class="icon-btn" data-bridge-close aria-label="${text("关闭", "Close")}" title="${text("关闭", "Close")}">&times;</button></header><div class="bridge-content"><section><div class="bridge-section-title"><h3>${text("访问会话", "Access Sessions")}</h3><div><button type="button" class="btn secondary sm" data-bridge-refresh>${text("刷新", "Refresh")}</button><button type="button" class="btn primary sm" data-bridge-create>${text("新建会话", "New Session")}</button></div></div><ul data-bridge-sessions></ul><div data-bridge-secret hidden><label>${text("一次性连接信息", "One-Time Connection Details")}<textarea readonly rows="3" data-bridge-details></textarea></label><button type="button" class="btn secondary sm" data-bridge-copy>${text("复制连接信息", "Copy Connection Details")}</button></div></section>${isLocal() ? `<section><h3>${text("本机连接器", "Mac Connector")}</h3><p data-bridge-local-status role="status"></p><form id="bridgeConnectorForm"><label>${text("公网 JEAuditFlow 地址", "Public JEAuditFlow Origin")}<input name="remoteOrigin" type="url" required placeholder="https://auditflow.example.com" autocomplete="off"></label><label>${text("会话编号", "Session ID")}<input name="sessionId" required autocomplete="off"></label><label>${text("一次性连接令牌", "One-Time Connector Token")}<input name="connectorToken" type="password" required autocomplete="off"></label><div class="bridge-form-actions"><button class="btn primary" type="submit">${text("连接本机服务", "Connect Mac Services")}</button><button class="btn secondary" type="button" data-bridge-stop>${text("停止连接", "Stop Connector")}</button></div></form><p class="bridge-boundary">Jira · 127.0.0.1:8080<br>Confluence · 127.0.0.1:8090</p></section>` : `<p class="bridge-boundary">${text("仅会话所属账户可访问。本机连接器上线后可打开 Jira 和 Confluence。", "Access is restricted to the session owner. Jira and Confluence become available when the Mac connector is online.")}</p>`}<p data-bridge-message role="status" aria-live="polite"></p></div>`;
    const view = dialog;
    addConnectionPaste(view);
    root.document.body.append(dialog); dialog.showModal(); trigger?.setAttribute("aria-expanded", "true");
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    dialog.addEventListener("click", event => {
      const button = event.target.closest("button"); if (!button) return;
      if (button.hasAttribute("data-bridge-close")) return close();
      if (button.hasAttribute("data-bridge-refresh")) return action(button, refresh);
      if (button.hasAttribute("data-bridge-create")) return action(button, async () => {
        const created = await backend().createBridgeSession();
        if (dialog !== view || !view.open) { await backend().revokeBridgeSession(created.session.sessionId).catch(() => {}); return; }
        secret = created;
        const details = { remoteOrigin: new URL(backend().baseUrl, root.location.href).origin, sessionId: secret.session.sessionId, connectorToken: secret.connectorToken };
        dialog.querySelector("[data-bridge-secret]").hidden = false; dialog.querySelector("[data-bridge-details]").value = JSON.stringify(details);
        const form = dialog.querySelector("form"); if (form) for (const [key, value] of Object.entries(details)) form.elements[key].value = value;
        message(text("会话已创建。连接信息仅保留在此窗口。", "Session created. Connection details remain in this window only.")); await refresh();
      });
      if (button.hasAttribute("data-bridge-copy")) return action(button, async () => { await root.navigator.clipboard.writeText(dialog.querySelector("[data-bridge-details]").value); message(text("已复制连接信息", "Connection details copied")); });
      if (button.hasAttribute("data-bridge-stop")) return action(button, async () => { await backend().stopLocalBridge(); message(text("本机连接器已停止", "Mac connector stopped")); await refresh(); });
      if (button.hasAttribute("data-bridge-revoke")) return action(button, async () => { await backend().revokeBridgeSession(button.dataset.bridgeRevoke); message(text("会话已撤销", "Session revoked")); await refresh(); });
    });
    dialog.querySelector("form")?.addEventListener("submit", event => {
      event.preventDefault(); const form = event.currentTarget;
      action(form.querySelector("[type=submit]"), async () => {
        const connection = validateConnection(Object.fromEntries(new FormData(form))); await backend().startLocalBridge(connection);
        form.elements.connectorToken.value = ""; message(text("连接器已启动，正在等待远端确认", "Connector started; awaiting remote confirmation")); await refresh();
      });
    });
    refresh(); timer = root.setInterval(refresh, 10_000);
  }
  function mount() { trigger = root.document?.getElementById("bridgeWorkbenchButton"); if (!trigger) return; trigger.addEventListener("click", open); root.addEventListener("pagehide", close); root.addEventListener("auditflow-logged-out", close); }
  root.AuditFlowBridgeWorkbench = Object.freeze({ validateConnection, open, close, mount });
  if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", mount, { once: true }); else mount();
})(typeof window !== "undefined" ? window : globalThis);
