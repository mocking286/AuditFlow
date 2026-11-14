/* JEAuditFlow 5.6 project data gateway.
 *
 * JEAuditFlow 5.6 remains local-first, but persistence is no longer hard-wired
 * to localStorage. A cloud adapter can be configured in memory after the host
 * completes authentication; access tokens are never persisted here.
 */
(function () {
  "use strict";

  const CLOUD_CONTRACT = "jeauditflow.project-api/1";
  const DEFAULT_REMOTE_TIMEOUT_MS = 30000;

  function normalizeBaseUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function attachmentManifest(project) {
    const evidenceAssets = (project?.evidence || []).flatMap(evidence =>
      (evidence.visualAssets || []).map(asset => ({
        id: String(asset.id || ""),
        name: String(asset.name || ""),
        type: String(asset.mime || asset.type || "application/octet-stream"),
        size: Number(asset.size) || 0,
        evidenceId: String(evidence.id || "")
      }))
    );
    const recordAttachments = (project?.records || []).flatMap(record =>
      (record.attachments || []).map(attachment => ({
        id: String(attachment.id || ""),
        name: String(attachment.name || ""),
        type: String(attachment.type || "application/octet-stream"),
        size: Number(attachment.size) || 0,
        recordId: String(record.id || "")
      }))
    );
    return [...evidenceAssets, ...recordAttachments].filter(item => item.id && item.name);
  }

  function cloudProjectSnapshot(project) {
    const helper = globalThis.AuditFlowCloudSnapshot;
    let snapshot;
    if (helper?.serialized) {
      try { snapshot = JSON.parse(helper.serialized(project || {})); } catch (_) {}
    }
    if (!snapshot && helper?.projectMetadata) snapshot = helper.projectMetadata(project || {});
    if (!snapshot) snapshot = { snapshotVersion: 2, snapshotPolicy: "metadata-only", id: String(project?.id || ""), name: String(project?.name || "") };
    snapshot.attachments = attachmentManifest(project);
    return snapshot;
  }

  async function parseResponse(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error || payload?.message || `Cloud API returned ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  const remote = {
    baseUrl: "",
    tokenProvider: null,
    workspaceId: "AUDITFLOW-LOCAL",

    configure({ baseUrl, tokenProvider, workspaceId } = {}) {
      this.baseUrl = normalizeBaseUrl(baseUrl);
      this.tokenProvider = typeof tokenProvider === "function" ? tokenProvider : null;
      this.workspaceId = String(workspaceId || "AUDITFLOW-LOCAL").trim() || "AUDITFLOW-LOCAL";
      return this;
    },

    ready() {
      return !!this.baseUrl && typeof this.tokenProvider === "function";
    },

    async request(path, options = {}, timeoutMs = DEFAULT_REMOTE_TIMEOUT_MS) {
      if (!this.baseUrl) throw new Error("Cloud API endpoint is not configured");
      const token = this.tokenProvider ? await this.tokenProvider() : "";
      if (!token) throw new Error("Cloud API authentication is not ready");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers = { ...(options.headers || {}), authorization: `Bearer ${token}` };
        return await parseResponse(await fetch(`${this.baseUrl}${path}`, { ...options, headers, signal: controller.signal }));
      } catch (error) {
        if (error.name === "AbortError") throw new Error("Cloud API request timed out");
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },

    status() {
      return this.request("/api/collaboration/status", { method: "GET" }, 8000);
    },

    compatibility() {
      return this.request("/api/collaboration/compatibility", { method: "GET" }, 8000);
    },

    listProjects() {
      return this.request("/api/projects", { method: "GET" });
    },

    loadProject(projectId) {
      return this.request(`/api/projects/${encodeURIComponent(projectId)}`, { method: "GET" });
    },

    pushProject(project, expectedRevision = 0, changeSummary = "Project updated") {
      if (!project?.id) throw new Error("A project id is required for cloud synchronization");
      return this.request(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contract: CLOUD_CONTRACT,
          workspaceId: this.workspaceId,
          snapshot: cloudProjectSnapshot(project),
          expectedRevision: Number(expectedRevision) || 0,
          changeSummary: String(changeSummary || "Project updated").slice(0, 500)
        })
      });
    },

    events(projectId, afterRevision = 0) {
      return this.request(`/api/projects/${encodeURIComponent(projectId)}/events?afterRevision=${Number(afterRevision) || 0}`, { method: "GET" });
    },

    codexChat(requestBody) {
      return this.request("/api/v1/codex/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody || {})
      }, 120000);
    }
  };

  const AuditFlowDataGateway = {
    contract: CLOUD_CONTRACT,
    remote,

    loadLocalWorkspace(key) {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    },

    saveLocalWorkspace(key, database) {
      localStorage.setItem(key, JSON.stringify(database));
      return true;
    },

    projectEnvelope(project, databaseVersion) {
      return {
        contract: CLOUD_CONTRACT,
        exportedAt: new Date().toISOString(),
        databaseVersion: Number(databaseVersion) || 0,
        project
      };
    },

    cloudProjectSnapshot
  };

  window.AuditFlowDataGateway = AuditFlowDataGateway;
})();
