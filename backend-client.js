/* AuditFlow v8.7 collaboration client and loopback bridge adapter.
 * The browser extension ONLY performs UI/DOM element operations through this
 * client. All LLM evaluation/opinion calls and visual report generation are
 * executed by the optional local AI service.  When it is unavailable, the
 * browser keeps the audit workflow responsive with its local rule fallback.
 */
(function () {
  "use strict";

  const DEFAULT_BASE_URL = "http://127.0.0.1:4173";
  // A cold local Codex session can take longer than the old one-minute limit.
  // Keep the browser and the bundled loopback bridge aligned.
  const CODEX_OPINION_TIMEOUT_MS = 300000;

  function loopbackBase(value) {
    try {
      const url = new URL(String(value || DEFAULT_BASE_URL));
      if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)) throw new Error("not loopback");
      return url.origin;
    } catch (_) {
      return DEFAULT_BASE_URL;
    }
  }

  async function request(url, options = {}, timeoutMs = 120000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, credentials: "include", signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.conflict ? `Project revision conflict: remote r${payload.revision || "?"}` : payload?.error || payload?.message || `后端返回 ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error.name === "AbortError") {
        const timeoutError = new Error("后端请求超时");
        timeoutError.code = "request-timeout";
        timeoutError.timeoutMs = timeoutMs;
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  const AuditFlowBackend = {
    baseUrl: DEFAULT_BASE_URL,
    assistantBaseUrl: DEFAULT_BASE_URL,
    isOnline: false,
    healthInfo: null,
    lastCheckedAt: 0,
    collaborationIdentity: { userId: "", userName: "" },

    setBaseUrl(value) {
      this.baseUrl = String(value || DEFAULT_BASE_URL).replace(/\/+$/, "") || DEFAULT_BASE_URL;
    },

    setAssistantBaseUrl(value) {
      this.assistantBaseUrl = loopbackBase(value);
    },

    setCollaborationIdentity(user = {}) {
      this.collaborationIdentity = {
        userId: String(user.id || user.userId || "").trim(),
        userName: String(user.name || user.userName || "").trim()
      };
    },

    async health(timeoutMs = 2500) {
      const payload = await request(`${this.baseUrl}/api/health`, { method: "GET" }, timeoutMs);
      this.isOnline = payload?.status === "ok";
      this.healthInfo = payload;
      this.lastCheckedAt = Date.now();
      return payload;
    },

    authToken() {
      return window.MicrosoftAuth?.accessToken || "";
    },

    authHeaders(extra = {}) {
      const token = this.authToken();
      const sessionToken = window.AuditFlowAuth?.sessionToken || "";
      const identity = this.collaborationIdentity || {};
      return {
        ...extra,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(sessionToken ? { "x-auditflow-session": sessionToken } : {}),
        ...(identity.userId ? { "x-auditflow-user-id": identity.userId, "x-auditflow-user-name": encodeURIComponent(identity.userName || identity.userId) } : {})
      };
    },

    async collaborationStatus(timeoutMs = 5000) {
      return request(`${this.baseUrl}/api/collaboration/status`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async signInMicrosoft(settings = {}) {
      const session = await window.MicrosoftAuth.signIn(settings);
      this.isOnline = false;
      return session;
    },

    signOutMicrosoft() {
      window.MicrosoftAuth?.clear();
    },

    async currentUser(timeoutMs = 8000) {
      return request(`${this.baseUrl}/api/me`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async pullProject(projectId, timeoutMs = 15000) {
      const payload = await request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
      this.isOnline = true;
      return payload.project || payload;
    },

    async pushProject(projectId, body, timeoutMs = 30000) {
      const payload = await request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}`, { method: "POST", headers: this.authHeaders({ "content-type": "application/json" }), body: JSON.stringify(body || {}) }, timeoutMs);
      this.isOnline = true;
      return payload;
    },

    async projectEvents(projectId, afterRevision = 0, timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/events?afterRevision=${encodeURIComponent(afterRevision)}`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async projectMembers(projectId, timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/members`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async setProjectMember(projectId, userId, role, processScopes = [], name = "", avatarData = "", timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/members`, { method: "POST", headers: this.authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ userId, role, processScopes, name, avatarData }) }, timeoutMs);
    },

    async projectLocks(projectId, timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/locks`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async projectPresence(projectId, timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/presence`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async setProjectPresence(projectId, presence, timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/presence`, { method: "POST", headers: this.authHeaders({ "content-type": "application/json" }), body: JSON.stringify(presence || {}) }, timeoutMs);
    },

    async acquireProjectLock(projectId, lock, timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/locks/acquire`, { method: "POST", headers: this.authHeaders({ "content-type": "application/json" }), body: JSON.stringify(lock || {}) }, timeoutMs);
    },

    async heartbeatProjectLock(projectId, lockId, timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/locks/heartbeat`, { method: "POST", headers: this.authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ lockId }) }, timeoutMs);
    },

    async releaseProjectLock(projectId, lockId, timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/locks/release`, { method: "POST", headers: this.authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ lockId }) }, timeoutMs);
    },

    async applyProjectChange(projectId, lockId, change, timeoutMs = 15000) {
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/changes`, { method: "POST", headers: this.authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ lockId, change }) }, timeoutMs);
    },

    async codexStatus() {
      // Keep the initial local script probe tolerant of a cold-starting Codex session.
      return request(`${loopbackBase(this.assistantBaseUrl)}/api/codex/status`, { method: "GET" }, 15000);
    },

    async configureCodexVirtualKey(settings) {
      const payload = await request(`${loopbackBase(this.assistantBaseUrl)}/api/codex/virtual-key`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings || {})
      }, 15000);
      return payload;
    },

    async clearCodexVirtualKey() {
      const payload = await request(`${loopbackBase(this.assistantBaseUrl)}/api/codex/clear-virtual-key`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }, 10000);
      return payload;
    },

    async opinion(prompt, options = {}) {
      const payload = await request(`${loopbackBase(this.assistantBaseUrl)}/api/ai/opinion`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, ...(options || {}), timeoutMs: CODEX_OPINION_TIMEOUT_MS })
      }, CODEX_OPINION_TIMEOUT_MS);
      return payload;
    },

    async downloadFromUrl(url, fallbackName = "auditflow-download") {
      const response = await fetch(new URL(url, this.baseUrl).toString());
      if (!response.ok) throw new Error(`下载失败：${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fallbackName || "auditflow-download";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    },

    async ensureOnline() {
      if (this.isOnline && Date.now() - this.lastCheckedAt < 30000) return true;
      try {
        await this.health();
        return this.isOnline;
      } catch (_) {
        this.isOnline = false;
        return false;
      }
    }
  };

  // Read a previously saved backend URL (if any) before the app initializes.
  try {
    const stored = JSON.parse(localStorage.getItem("auditflow-ai-workspace-v1") || "null");
    if (stored?.settings?.backendUrl) AuditFlowBackend.setBaseUrl(stored.settings.backendUrl);
    AuditFlowBackend.setAssistantBaseUrl(stored?.settings?.codexBridgeUrl || "http://127.0.0.1:4173");
  } catch (_) { /* keep default */ }

  window.AuditFlowBackend = AuditFlowBackend;
})();
