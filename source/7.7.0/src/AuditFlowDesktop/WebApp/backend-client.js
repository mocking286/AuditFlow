/* AuditFlow v12.3 collaboration client and loopback bridge adapter.
 * The browser extension ONLY performs UI/DOM element operations through this
 * client. All LLM evaluation/opinion calls and visual report generation are
 * executed by the optional local AI service.  When it is unavailable, the
 * browser keeps the audit workflow responsive with its local rule fallback.
 */
(function () {
  "use strict";

  // A deployed AuditFlow workspace and its collaboration API are served from
  // the same origin.  Pointing a browser at 127.0.0.1 here would send every
  // assessor to their own machine instead of the shared service.  The
  // loopback default remains for the packaged extension/offline preview.
  const DESKTOP_EMBEDDED = new URLSearchParams(window.location?.search || "").get("embedded") === "1";
  const WEB_ORIGIN = !DESKTOP_EMBEDDED && /^https?:$/.test(String(window.location?.protocol || ""))
    ? String(window.location.origin || "").replace(/\/+$/, "")
    : "";
  const LOOPBACK_WEB_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(WEB_ORIGIN) ? WEB_ORIGIN : "";
  const DEFAULT_BASE_URL = WEB_ORIGIN || "http://127.0.0.1:4173";
  // A browser-mounted web workspace must use its authenticated same-origin
  // proxy. Only extension/offline pages retain the loopback bridge default.
  const DEFAULT_ASSISTANT_BASE_URL = WEB_ORIGIN || LOOPBACK_WEB_ORIGIN || "http://127.0.0.1:46976";
  const CODEX_DISCOVERY_PORTS = [46976, 8787, 4173, 3000, 5173, 8080, 8000];
  // A cold local Codex session can take longer than the old one-minute limit.
  // Keep the browser and the bundled loopback bridge aligned.
  const CODEX_OPINION_TIMEOUT_MS = 300000;

  function loopbackBase(value) {
    try {
      const url = new URL(String(value || DEFAULT_BASE_URL));
      if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)) throw new Error("not loopback");
      return url.origin;
    } catch (_) {
      return DEFAULT_ASSISTANT_BASE_URL;
    }
  }

  // Keep the public bridge aliases used by the desktop shell and extension
  // probes. A loopback-hosted page may carry the per-instance port in its
  // origin; file/extension pages retain the stable local default.
  function currentLoopbackUrl() {
    try {
      const url = new URL(window.location.origin);
      if (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)) {
        return url.origin;
      }
    } catch (_) { /* file and extension pages have no loopback origin */ }
    return DEFAULT_ASSISTANT_BASE_URL;
  }

  function resolveLocalBridgeUrl(value) {
    if (WEB_ORIGIN) return WEB_ORIGIN;
    const configured = String(value || "").trim().replace(/\/+$/, "");
    if (!configured) return DEFAULT_ASSISTANT_BASE_URL;
    // The packaged desktop backend exposes the authenticated bridge on its
    // same-origin port. Older settings may still contain the historical
    // 46976 default; remap that default only for a loopback web instance.
    if (LOOPBACK_WEB_ORIGIN && (configured === "http://127.0.0.1:46976" || configured === "http://localhost:46976")) {
      return LOOPBACK_WEB_ORIGIN;
    }
    return loopbackBase(configured);
  }

  function collaborationBase(value) {
    // The web build authenticates with an HttpOnly same-origin session.  Do
    // not let a persisted browser setting redirect those credentialed calls.
    if (WEB_ORIGIN) return WEB_ORIGIN;
    return String(value || DEFAULT_BASE_URL).replace(/\/+$/, "") || DEFAULT_BASE_URL;
  }

  function copilotBase(backend, assistant) {
    // A deployed web workspace exposes the Copilot proxy on the authenticated
    // collaboration origin. Packaged/offline clients keep the loopback bridge
    // so Copilot tokens and Direct Line conversations never leave the user's
    // configured local service boundary.
    return WEB_ORIGIN ? collaborationBase(backend) : resolveLocalBridgeUrl(assistant);
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
    assistantBaseUrl: DEFAULT_ASSISTANT_BASE_URL,
    webMode: !!WEB_ORIGIN,
    isOnline: false,
    healthInfo: null,
    lastCheckedAt: 0,
    collaborationIdentity: { userId: "", userName: "" },
    codexDiscovery: { attemptedAt: 0, candidates: [], selected: "" },

    setBaseUrl(value) {
      this.baseUrl = collaborationBase(value);
    },

    setAssistantBaseUrl(value) {
      const configured = String(value || "").trim();
      this.assistantBaseUrl = resolveLocalBridgeUrl(configured ? configured : DEFAULT_ASSISTANT_BASE_URL);
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
      if (window.MicrosoftAuth?.accessToken) return window.MicrosoftAuth.accessToken;
      if (window.AuditFlowAuth?.sessionToken) return window.AuditFlowAuth.sessionToken;
      try { return sessionStorage.getItem("auditflow_session_token") || ""; } catch (_) { return ""; }
    },

    authHeaders(extra = {}) {
      const token = this.authToken();
      let sessionToken = window.AuditFlowAuth?.sessionToken || "";
      if (!sessionToken) {
        try { sessionToken = sessionStorage.getItem("auditflow_session_token") || ""; } catch (_) { /* storage may be disabled */ }
      }
      return {
        ...extra,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(sessionToken ? { "x-auditflow-session": sessionToken } : {})
      };
    },

    async bridgeCapabilities() {
      return request(`${this.baseUrl}/api/bridge/capabilities`, { method: "GET", headers: this.authHeaders() }, 10000);
    },

    async createBridgeSession({ routes = ["jira", "confluence"], connectorToken = "" } = {}) {
      if (!connectorToken) {
        const bytes = new Uint8Array(32);
        window.crypto.getRandomValues(bytes);
        connectorToken = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
      }
      const session = await request(`${this.baseUrl}/api/bridge/sessions`, { method: "POST", headers: this.authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ routes, connectorToken }) }, 10000);
      // Only the current UI receives this one-time connector secret. Never persist it in workspace settings.
      return { session, connectorToken };
    },

    async listBridgeSessions() {
      return request(`${this.baseUrl}/api/bridge/sessions`, { method: "GET", headers: this.authHeaders() }, 10000);
    },

    async bridgeSessionStatus(sessionId) {
      return request(`${this.baseUrl}/api/bridge/sessions/${encodeURIComponent(sessionId)}`, { method: "GET", headers: this.authHeaders() }, 10000);
    },

    async revokeBridgeSession(sessionId) {
      return request(`${this.baseUrl}/api/bridge/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE", headers: this.authHeaders() }, 10000);
    },

    bridgeServiceUrl(sessionId, route) {
      if (!["jira", "confluence", "polarion"].includes(route) || !/^[A-Za-z0-9_-]{1,96}$/.test(String(sessionId))) throw new Error("Invalid bridge session or service");
      return `${this.baseUrl}/bridge/sessions/${encodeURIComponent(sessionId)}/${route}/`;
    },

    async startLocalBridge({ remoteOrigin, sessionId, connectorToken, routes = ["jira", "confluence"] } = {}) {
      if (WEB_ORIGIN && !LOOPBACK_WEB_ORIGIN) {
        const error = new Error("Open the installed Mac-local AuditFlow workspace and enter the one-time public bridge connection details.");
        error.code = "local-workspace-required";
        throw error;
      }
      return request(`${this.assistantBaseUrl}/api/bridge/local/connect`, { method: "POST", headers: this.authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ remoteOrigin, sessionId, connectorToken, routes }) }, 10000);
    },

    async localBridgeStatus() {
      return request(`${this.assistantBaseUrl}/api/bridge/local/status`, { method: "GET", headers: this.authHeaders() }, 10000);
    },

    async stopLocalBridge() {
      return request(`${this.assistantBaseUrl}/api/bridge/local/disconnect`, { method: "POST", headers: this.authHeaders({ "content-type": "application/json" }), body: "{}" }, 10000);
    },

    async loginAccount(options = {}) {
      const credentials = options?.credentials || options;
      const base = collaborationBase(options?.baseUrl || options?.endpoint || this.baseUrl);
      const response = await request(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: String(credentials.email || "").trim(), password: String(credentials.password || "") })
      }, 15000);
      const token = String(response?.sessionToken || "").trim();
      if (token) {
        try { sessionStorage.setItem("auditflow_session_token", token); } catch (_) { /* memory-only fallback */ }
      }
      if (window.AuditFlowAuth?.acceptSession) window.AuditFlowAuth.acceptSession(response, base);
      return response;
    },

    async logoutAccount(options = {}) {
      const base = collaborationBase(typeof options === "string" ? options : (options?.baseUrl || options?.endpoint || this.baseUrl));
      try {
        return await request(`${base}/api/auth/logout`, { method: "POST", headers: this.authHeaders() }, 10000);
      } finally {
        try { sessionStorage.removeItem("auditflow_session_token"); } catch (_) { /* storage may be disabled */ }
        window.AuditFlowAuth?.clearSession?.();
      }
    },

    async collaborationStatus(timeoutMs = 5000) {
      return request(`${this.baseUrl}/api/collaboration/status`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    localContentBaseUrl() {
      const configured = new URL(this.baseUrl || DEFAULT_BASE_URL);
      if (this.webMode && WEB_ORIGIN && configured.origin === WEB_ORIGIN) return configured.origin;
      if (configured.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]", "::1"].includes(configured.hostname)) {
        throw new Error("The local content catalog is available only through the local desktop backend");
      }
      const authEndpoint = String(window.AuditFlowAuth?.endpoint || "").trim();
      if (!authEndpoint || new URL(authEndpoint).origin !== configured.origin) {
        throw new Error("Sign in to the local desktop backend before using its content catalog");
      }
      return configured.origin;
    },

    async localContentStatus(timeoutMs = 5000) {
      const base = this.localContentBaseUrl();
      return request(`${base}/api/local-content/status`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async queueLocalContentChanges(changes, timeoutMs = 15000) {
      const base = this.localContentBaseUrl();
      return request(`${base}/api/local-content/queue`, {
        method: "POST",
        headers: this.authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ changes })
      }, timeoutMs);
    },

    async collaborationCompatibility(timeoutMs = 8000) {
      return request(`${this.baseUrl}/api/collaboration/compatibility`, { method: "GET" }, timeoutMs);
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

    async adminOverview(timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/admin/overview`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async adminAccounts(timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/admin/accounts`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async createAdminAccount(account, timeoutMs = 15000) {
      return request(`${this.baseUrl}/api/admin/accounts`, { method: "POST", headers: this.authHeaders({ "content-type": "application/json" }), body: JSON.stringify(account || {}) }, timeoutMs);
    },

    async updateAdminAccount(userId, update, timeoutMs = 15000) {
      return request(`${this.baseUrl}/api/admin/accounts/${encodeURIComponent(userId)}`, { method: "PATCH", headers: this.authHeaders({ "content-type": "application/json" }), body: JSON.stringify(update || {}) }, timeoutMs);
    },

    async resetAdminPassword(userId, password, timeoutMs = 15000) {
      return request(`${this.baseUrl}/api/admin/accounts/${encodeURIComponent(userId)}/reset-password`, { method: "POST", headers: this.authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ password }) }, timeoutMs);
    },

    async deleteAdminAccount(userId, timeoutMs = 15000) {
      return request(`${this.baseUrl}/api/admin/accounts/${encodeURIComponent(userId)}`, { method: "DELETE", headers: this.authHeaders() }, timeoutMs);
    },

    async projects(timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/projects`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async listProjects(timeoutMs = 10000) {
      return this.projects(timeoutMs);
    },

    async jiraFlowProjects(timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/integrations/jiraflow/projects`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async syncJiraFlowProject(projectId, timeoutMs = 60000) {
      return request(`${this.baseUrl}/api/integrations/jiraflow/projects/${encodeURIComponent(projectId)}/sync`, {
        method: "POST",
        headers: this.authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({})
      }, timeoutMs);
    },

    async importJiraFlowIssues(projectId, timeoutMs = 60000) {
      return request(`${this.baseUrl}/api/integrations/jiraflow/projects/${encodeURIComponent(projectId)}/import-issues`, {
        method: "POST",
        headers: this.authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({})
      }, timeoutMs);
    },

    async submitUploadJiraCandidates(projectId, body, timeoutMs = 60000) {
      return request(`${this.baseUrl}/api/integrations/jiraflow/projects/${encodeURIComponent(projectId)}/upload-candidates`, {
        method: "POST",
        headers: this.authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify(body || {})
      }, timeoutMs);
    },

    async jiraFlowMappingOptions(projectId, timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/integrations/jiraflow/projects/${encodeURIComponent(projectId)}/mapping-options`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async mapJiraFlowProject(projectKey, auditflowProjectId, timeoutMs = 15000) {
      return request(`${this.baseUrl}/api/integrations/jiraflow/projects/${encodeURIComponent(projectKey)}/auditflow-mapping`, {
        method: "PUT",
        headers: this.authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ auditflowProjectId })
      }, timeoutMs);
    },

    async jiraFlowIssues(projectId, { startAt = 0, maxResults = 100 } = {}, timeoutMs = 15000) {
      const query = new URLSearchParams({ startAt: String(startAt), maxResults: String(maxResults) });
      return request(`${this.baseUrl}/api/integrations/jiraflow/projects/${encodeURIComponent(projectId)}/issues?${query}`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async jiraFlowIssue(projectId, issueKey, timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/integrations/jiraflow/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issueKey)}`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async jiraFlowEvents(projectId, afterRevision = 0, limit = 50, timeoutMs = 10000) {
      const query = new URLSearchParams({ afterRevision: String(afterRevision), limit: String(limit) });
      return request(`${this.baseUrl}/api/integrations/jiraflow/projects/${encodeURIComponent(projectId)}/events?${query}`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async jiraFlowWorkflow(projectId, timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/integrations/jiraflow/projects/${encodeURIComponent(projectId)}/workflow`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async transitionJiraFlowIssue(body, timeoutMs = 15000) {
      return request(`${this.baseUrl}/api/integrations/jiraflow/transitions`, {
        method: "POST",
        headers: this.authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify(body || {})
      }, timeoutMs);
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

    async assessmentTaskBoard(projectId, process = "", timeoutMs = 15000) {
      const query = process ? `?process=${encodeURIComponent(process)}` : "";
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/assessment-tasks${query}`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async applyAssessmentTaskChange(projectId, body, timeoutMs = 15000) {
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/assessment-tasks`, {
        method: "POST",
        headers: this.authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify(body || {})
      }, timeoutMs);
    },

    async projectEvents(projectId, afterRevision = 0, timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/events?afterRevision=${encodeURIComponent(afterRevision)}`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async projectMembers(projectId, timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/members`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async setProjectMember(projectId, userId, role, processScopes = [], name = "", avatarData = "", permissions = undefined, expectedRevision, email = "", timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/members`, { method: "POST", headers: this.authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ userId, email, role, processScopes, name, avatarData, permissions, expectedRevision }) }, timeoutMs);
    },

    async removeProjectMember(projectId, userId, expectedRevision, timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/members`, { method: "POST", headers: this.authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ userId, operation: "remove", expectedRevision }) }, timeoutMs);
    },

    async inviteProjectMember(projectId, member, timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/members`, { method: "POST", headers: this.authHeaders({ "content-type": "application/json" }), body: JSON.stringify(member || {}) }, timeoutMs);
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

    async applyProjectChange(projectId, lockId, change, timeoutMs = 15000, expectedRevision) {
      // Preserve the earlier compact call shape where the fourth argument was
      // the expected revision, while allowing callers to set a request timeout.
      if (expectedRevision === undefined && Number.isFinite(timeoutMs) && timeoutMs >= 0 && timeoutMs < 1000) {
        expectedRevision = timeoutMs;
        timeoutMs = 15000;
      }
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/changes`, { method: "POST", headers: this.authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ lockId, change, expectedRevision }) }, timeoutMs);
    },

    async findingTemplates(projectId, filters = {}, timeoutMs = 10000) {
      const query = new URLSearchParams(Object.entries(filters || {}).filter(([, value]) => String(value || "").trim()));
      const suffix = query.toString() ? `?${query.toString()}` : "";
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/finding-templates${suffix}`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async saveFindingTemplates(projectId, body = {}, timeoutMs = 15000) {
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/finding-templates`, {
        method: "POST",
        headers: this.authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify(body || {})
      }, timeoutMs);
    },

    async updateFindingTemplate(projectId, templateId, body = {}, timeoutMs = 15000) {
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/finding-templates/${encodeURIComponent(templateId)}`, {
        method: "PUT",
        headers: this.authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ ...(body || {}), id: templateId, expectedRevision: Number(body?.expectedRevision || 0) })
      }, timeoutMs);
    },

    async deleteFindingTemplate(projectId, templateId, expectedRevision, timeoutMs = 15000) {
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/finding-templates/${encodeURIComponent(templateId)}`, {
        method: "DELETE",
        headers: this.authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ id: templateId, expectedRevision })
      }, timeoutMs);
    },

    async exportFindingTemplates(projectId, timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/finding-templates/export`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async mcpMetadata(timeoutMs = 10000) {
      return request(`${this.baseUrl}/api/mcp/metadata`, { method: "GET" }, timeoutMs);
    },

    async mcpRemoteStatus(timeoutMs = 5000) {
      return request(`${this.baseUrl}/api/integrations/mcp/status`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async mcpRequest(body, apiKey, timeoutMs = 30000) {
      const headers = { "content-type": "application/json" };
      if (apiKey) headers["x-api-key"] = apiKey;
      return request(`${this.baseUrl}/mcp`, { method: "POST", headers, body: JSON.stringify(body || {}) }, timeoutMs);
    },

    async codexStatus() {
      // Keep the initial local script probe tolerant of a cold-starting Codex session.
      return request(`${resolveLocalBridgeUrl(this.assistantBaseUrl)}/api/codex/status`, { method: "GET" }, 15000);
    },

    async discoverCodexBridge(timeoutMs = 1400) {
      // An extension page cannot inspect OS processes. Probe only permitted
      // loopback origins and accept the first bridge exposing the controlled
      // Codex status endpoint.
      const configured = loopbackBase(this.assistantBaseUrl);
      const candidates = [configured, ...CODEX_DISCOVERY_PORTS.map(port => `http://127.0.0.1:${port}`), ...CODEX_DISCOVERY_PORTS.map(port => `http://localhost:${port}`)]
        .map(loopbackBase)
        .filter((value, index, all) => all.indexOf(value) === index);
      this.codexDiscovery = { attemptedAt: Date.now(), candidates, selected: "" };
      for (const base of candidates) {
        try {
          const payload = await request(`${base}/api/codex/status`, { method: "GET" }, timeoutMs);
          this.setAssistantBaseUrl(base);
          this.codexDiscovery.selected = base;
          return { ...payload, discoveredBaseUrl: base };
        } catch (_) {
          // Continue probing the next local endpoint.
        }
      }
      return null;
    },

    async configureCodexVirtualKey(settings) {
      const payload = await request(`${resolveLocalBridgeUrl(this.assistantBaseUrl)}/api/codex/virtual-key`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings || {})
      }, 30000);
      return payload;
    },

    async clearCodexVirtualKey() {
      const payload = await request(`${resolveLocalBridgeUrl(this.assistantBaseUrl)}/api/codex/clear-virtual-key`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }, 10000);
      return payload;
    },

    async copilotStatus(timeoutMs = 15000) {
      return request(`${copilotBase(this.baseUrl, this.assistantBaseUrl)}/api/codex/copilot/status`, { method: "GET", headers: this.authHeaders() }, timeoutMs);
    },

    async configureCopilot(settings, timeoutMs = 30000) {
      return request(`${copilotBase(this.baseUrl, this.assistantBaseUrl)}/api/codex/copilot/config`, {
        method: "POST",
        headers: this.authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify(settings || {})
      }, timeoutMs);
    },

    async clearCopilot(timeoutMs = 10000) {
      return request(`${copilotBase(this.baseUrl, this.assistantBaseUrl)}/api/codex/copilot/clear`, {
        method: "POST",
        headers: this.authHeaders({ "content-type": "application/json" }),
        body: "{}"
      }, timeoutMs);
    },

    async copilotChat(text, options = {}) {
      return request(`${copilotBase(this.baseUrl, this.assistantBaseUrl)}/api/codex/copilot-chat`, {
        method: "POST",
        headers: this.authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ text, ...(options || {}) })
      }, 125000);
    },

    async startEvaluationJob(body = {}, timeoutMs = 30000) {
      return request(`${this.baseUrl}/api/engine/evaluation-jobs`, {
        method: "POST",
        headers: this.authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify(body || {})
      }, timeoutMs);
    },

    async evaluationJob(jobId, timeoutMs = 15000) {
      const id = String(jobId || "").trim();
      if (!id) throw new Error("Assessment evaluation job id is required");
      return request(`${this.baseUrl}/api/engine/evaluation-jobs/${encodeURIComponent(id)}`, {
        method: "GET",
        headers: this.authHeaders()
      }, timeoutMs);
    },

    async opinion(prompt, options = {}) {
      const payload = await request(`${resolveLocalBridgeUrl(this.assistantBaseUrl)}/api/ai/opinion`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, ...(options || {}), timeoutMs: CODEX_OPINION_TIMEOUT_MS })
      }, CODEX_OPINION_TIMEOUT_MS);
      return payload;
    },

    async analyzeWorkbookIssues(issues, options = {}) {
      const rows = Array.isArray(issues) ? issues.slice(0, 200) : [];
      const workflow = window.AuditFlowQaChecklistWorkflow;
      const catalog = window.AUDITFLOW_SUP_QA_CHECKLIST_CATALOG?.entries || [];
      const localFallback = () => rows.map(issue => workflow?.analyzeCandidate(issue, catalog.find(entry => entry.id === issue.checklistId)) || {
        id: String(issue.id || issue.issue || ""), primaryProcess: issue.selectedProcess || issue.process || "", disposition: "UNASSESSED",
        candidateOnly: true, status: "Candidate", formalRating: null, needsAssessorConfirmation: true,
        opinion: "Local candidate analysis is unavailable; assessor review is required."
      });
      try {
        const payload = await request(`${resolveLocalBridgeUrl(this.assistantBaseUrl)}/api/ai/analyze-workbook-issues`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ issues: rows, ...(options || {}) })
        }, 120000);
        if (Array.isArray(payload.analyses)) return payload;
        return { analyses: localFallback(), transport: "local-rules", modelUnavailable: true, warning: "The service returned no analyses; local candidate rules were used." };
      } catch (error) {
        return { analyses: localFallback(), transport: "local-rules", modelUnavailable: true, warning: error.message };
      }
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

  window.resolveLocalBridgeUrl = resolveLocalBridgeUrl;
  window.currentLoopbackUrl = currentLoopbackUrl;

  // Read a previously saved backend URL (if any) before the app initializes.
  try {
    const stored = JSON.parse(localStorage.getItem("auditflow-ai-workspace-v1") || "null");
    if (!WEB_ORIGIN && stored?.settings?.backendUrl) AuditFlowBackend.setBaseUrl(stored.settings.backendUrl);
    AuditFlowBackend.setAssistantBaseUrl(stored?.settings?.codexBridgeUrl || "http://127.0.0.1:4173");
  } catch (_) { /* keep default */ }

  window.AuditFlowBackend = AuditFlowBackend;
})();
