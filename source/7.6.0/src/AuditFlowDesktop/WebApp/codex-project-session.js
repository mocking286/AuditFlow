/* JEAuditFlow 2.2 Codex project sessions.
 * Session history is part of the project snapshot so local and future cloud
 * persistence use the same schema. Provider credentials stay behind the API.
 */
(function () {
  "use strict";

  const SESSION_SCHEMA = "jeauditflow.codex-session/1";
  const MAX_SESSIONS = 12;
  const MAX_MESSAGES = 40;
  const MAX_MESSAGE_CHARS = 24000;

  function makeId(prefix) {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeMessage(message) {
    const role = message?.role === "assistant" ? "assistant" : "user";
    return {
      id: String(message?.id || makeId("MSG")),
      role,
      content: String(message?.content || "").slice(0, MAX_MESSAGE_CHARS),
      createdAt: String(message?.createdAt || new Date().toISOString()),
      ...(message?.snapshotId ? { snapshotId: String(message.snapshotId) } : {}),
      ...(message?.transport ? { transport: String(message.transport) } : {}),
      ...(message?.error ? { error: true } : {})
    };
  }

  function normalizeSession(session, projectId) {
    const messages = Array.isArray(session?.messages) ? session.messages.map(normalizeMessage).slice(-MAX_MESSAGES) : [];
    return {
      schema: SESSION_SCHEMA,
      id: String(session?.id || makeId("CODEX")),
      projectId: String(projectId || session?.projectId || ""),
      title: String(session?.title || messages.find(item => item.role === "user")?.content || "New session").slice(0, 80),
      createdAt: String(session?.createdAt || new Date().toISOString()),
      updatedAt: String(session?.updatedAt || session?.createdAt || new Date().toISOString()),
      createdBy: String(session?.createdBy || "AuditFlow user").slice(0, 160),
      messages,
      ...(session?.lastSnapshotId ? { lastSnapshotId: String(session.lastSnapshotId) } : {}),
      ...(session?.lastTransport ? { lastTransport: String(session.lastTransport) } : {})
    };
  }

  function createSession(project, actor = "AuditFlow user") {
    const now = new Date().toISOString();
    const session = normalizeSession({ createdAt: now, updatedAt: now, createdBy: actor }, project?.id);
    if (project) {
      project.codexSessions = Array.isArray(project.codexSessions) ? project.codexSessions : [];
      project.codexSessions.unshift(session);
      project.codexSessions = project.codexSessions.slice(0, MAX_SESSIONS);
      project.codexActiveSessionId = session.id;
    }
    return session;
  }

  function ensureProject(project, actor = "AuditFlow user") {
    if (!project) throw new Error("Project is required");
    project.codexSessions = Array.isArray(project.codexSessions)
      ? project.codexSessions.map(session => normalizeSession(session, project.id)).slice(0, MAX_SESSIONS)
      : [];
    if (!project.codexSessions.length) project.codexSessions.push(createSession(null, actor));
    project.codexSessions.forEach(session => { session.projectId = String(project.id || ""); });
    if (!project.codexSessions.some(session => session.id === project.codexActiveSessionId)) {
      project.codexActiveSessionId = project.codexSessions[0].id;
    }
    return project.codexSessions;
  }

  function activeSession(project, actor = "AuditFlow user") {
    ensureProject(project, actor);
    return project.codexSessions.find(session => session.id === project.codexActiveSessionId) || project.codexSessions[0];
  }

  function addMessage(session, message) {
    const normalized = normalizeMessage(message);
    session.messages = [...(session.messages || []), normalized].slice(-MAX_MESSAGES);
    if (session.title === "New session" && normalized.role === "user") session.title = normalized.content.slice(0, 80) || "New session";
    session.updatedAt = normalized.createdAt;
    if (normalized.snapshotId) session.lastSnapshotId = normalized.snapshotId;
    if (normalized.transport) session.lastTransport = normalized.transport;
    return normalized;
  }

  function clearMessages(session) {
    session.messages = [];
    session.title = "New session";
    session.updatedAt = new Date().toISOString();
    delete session.lastSnapshotId;
    delete session.lastTransport;
  }

  async function ask({ projectId, session, question, databaseSnapshot, includeEvidenceText = false }) {
    const requestBody = {
      schema: SESSION_SCHEMA,
      projectId,
      sessionId: session.id,
      question,
      includeEvidenceText: !!includeEvidenceText,
      messages: (session.messages || []).slice(0, -1).slice(-16).map(({ role, content }) => ({ role, content })),
      databaseSnapshot
    };
    if (window.AuditFlowDataGateway?.remote?.ready()) return window.AuditFlowDataGateway.remote.codexChat(requestBody);
    if (!window.AuditFlowBackend?.codexChat) throw new Error("Codex project session API is unavailable");
    return window.AuditFlowBackend.codexChat(requestBody);
  }

  window.AuditFlowCodexSessions = {
    schema: SESSION_SCHEMA,
    ensureProject,
    createSession,
    activeSession,
    addMessage,
    clearMessages,
    ask
  };
})();
