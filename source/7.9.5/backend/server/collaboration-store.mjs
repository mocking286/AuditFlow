import { existsSync, mkdirSync, readFileSync, openSync, closeSync, unlinkSync, writeSync } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { MUTATIONS, mutateProject, normalizeEntry, memberFor, projectSummary, fault, isGlobalAdmin, isGlobalLeadAssessor, PERMISSION_SCHEMA_VERSION } from "./collaboration-model.mjs";

function publicAccount(account) {
  if (!account) return null;
  return {
    userId: account.userId,
    email: account.email,
    displayName: account.displayName,
    disabled: Boolean(account.disabled),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt || account.createdAt
  };
}

export function createCollaborationStore({ directory, ...options } = {}) {
  if (!directory) throw new Error("Collaboration store directory is required");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filePath = path.join(directory, "store.json");
  const guardPath = path.join(directory, "store.pid");
  // File mode has exactly one writer. Use MySQL for multi-process deployments.
  // The guard records the owner PID so an interrupted local process can be
  // recovered without deleting a lock that belongs to a live writer.
  let acquired = false;
  for (let attempt = 0; attempt < 2 && !acquired; attempt++) {
    try {
      const handle = openSync(guardPath, "wx", 0o600);
      writeSync(handle, `${process.pid}\n`);
      closeSync(handle);
      acquired = true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let ownerPid = 0;
      try { ownerPid = Number.parseInt(readFileSync(guardPath, "utf8").trim(), 10) || 0; } catch {}
      let ownerAlive = false;
      if (ownerPid > 0) {
        try { process.kill(ownerPid, 0); ownerAlive = true; }
        catch (probeError) { ownerAlive = probeError.code !== "ESRCH"; }
      }
      if (ownerAlive) {
        throw new Error(`File store already in use by process ${ownerPid}: ${guardPath}. Stop that process or open its existing port.`);
      }
      if (!ownerPid) {
        throw new Error(`File store guard has no owner PID: ${guardPath}. Verify that no AuditFlow server is running, then remove this stale guard and restart.`);
      }
      try { unlinkSync(guardPath); }
      catch (removeError) { throw new Error(`Unable to remove stale file store guard ${guardPath}: ${removeError.message}`); }
    }
  }
  if (!acquired) throw new Error("Unable to acquire file store guard: " + guardPath);
  let state;
  try {
    state = existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf8")) : { projects: {}, feedback: [], accounts: [], sessions: [] };
    if (!state?.projects || typeof state.projects !== "object" || Array.isArray(state.projects)) throw new Error("Invalid project store");
    state = { accounts: [], sessions: [], feedback: [], ...state, schemaVersion: 3 };
    if (![state.accounts, state.sessions, state.feedback].every(Array.isArray)) throw new Error("Invalid account/session store");
    state.accounts = state.accounts.map(account => ({
      ...account,
      email: String(account.email || "").trim().toLowerCase(),
      disabled: Boolean(account.disabled),
      updatedAt: account.updatedAt || account.createdAt
    }));
  } catch (error) { unlinkSync(guardPath); throw error; }
  let queue = Promise.resolve();
  let closed = false;
  const releaseGuard = () => { try { unlinkSync(guardPath); } catch {} };
  process.once("exit", releaseGuard);

  function transaction(action) {
    const pending = queue.then(async () => {
      if (closed) throw new Error("File store is closed");
      const draft = structuredClone(state);
      const result = action(draft);
      const temporary = filePath + "." + crypto.randomUUID() + ".tmp";
      let handle;
      try {
        handle = await open(temporary, "wx", 0o600);
        await handle.writeFile(JSON.stringify(draft));
        await handle.sync();
        await handle.close();
        handle = null;
        await rename(temporary, filePath);
        state = draft;
      } catch (error) {
        if (handle) await handle.close();
        await unlink(temporary).catch(() => {});
        throw error;
      }
      return structuredClone(result);
    });
    queue = pending.catch(() => {});
    return pending;
  }
  async function read(action) { await queue; return structuredClone(action(state)); }
  const project = projectId => read(s => normalizeEntry(Object.hasOwn(s.projects, projectId) ? structuredClone(s.projects[projectId]) : null));
  const methods = Object.fromEntries(MUTATIONS.map(operation => [operation, (projectId, body, identity) => transaction(draft => {
    const current = Object.hasOwn(draft.projects, projectId) ? draft.projects[projectId] : null;
    const { entry, result } = mutateProject(operation, current, projectId, body, identity, options);
    draft.projects[projectId] = entry;
    return result;
  })]));
  return {
    provider: "file", persistence: "Atomic file store with serialized commits", filePath, project, memberFor, ...methods,
    listProjects: identity => read(s => Object.values(s.projects).map(e => normalizeEntry(structuredClone(e))).filter(e => isGlobalAdmin(identity) || isGlobalLeadAssessor(identity) || memberFor(e, identity)?.permissions.view).map(e => projectSummary(e, identity))),
    adminOverview: identity => read(s => {
      if (!isGlobalAdmin(identity)) throw fault("Administrator access required", 403);
      return { database: "file", permissionSchemaVersion: PERMISSION_SCHEMA_VERSION, accounts: s.accounts.map(publicAccount), projects: Object.values(s.projects).map(e => ({ ...projectSummary(e, identity), members: normalizeEntry(structuredClone(e)).members, evidenceCount: e.snapshot?.evidence?.length || 0, assessmentCount: e.snapshot?.assessments?.length || 0, recordCount: e.snapshot?.records?.length || 0 })), feedbackCount: s.feedback.length };
    }),
    listAccounts: identity => read(s => {
      if (!isGlobalAdmin(identity)) throw fault("Administrator access required", 403);
      return s.accounts.map(publicAccount).sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
    }),
    // Used by the guarded first-run local administrator bootstrap. It does
    // not expose account records or require an authenticated identity.
    countAccounts: () => read(s => s.accounts.length),
    locks: async projectId => (await project(projectId))?.locks || [],
    presence: async projectId => (await project(projectId))?.presence || [],
    createAccount: account => transaction(draft => {
      const email = String(account?.email || "").trim().toLowerCase();
      const userId = String(account?.userId || "").trim();
      const displayName = String(account?.displayName || "").trim().slice(0, 160);
      if (!email || !userId || !displayName || !account?.passwordHash || !account?.passwordSalt) throw fault("Incomplete account record");
      if (draft.accounts.some(a => a.email === email || a.userId === userId)) throw fault("Email already registered", 409);
      const now = new Date().toISOString();
      const stored = { ...account, userId, email, displayName, disabled: Boolean(account.disabled), createdAt: now, updatedAt: now };
      draft.accounts.push(stored);
      return publicAccount(stored);
    }),
    accountByEmail: email => read(s => s.accounts.find(a => a.email === String(email).trim().toLowerCase()) || null),
    accountById: userId => read(s => s.accounts.find(a => a.userId === userId) || null),
    updateAccount: (userId, changes = {}) => transaction(draft => {
      const index = draft.accounts.findIndex(account => account.userId === userId);
      if (index < 0) throw fault("Account not found", 404);
      const current = draft.accounts[index];
      const next = { ...current };
      let changed = false;
      let emailChanged = false;
      if (Object.hasOwn(changes, "email")) {
        const email = String(changes.email || "").trim().toLowerCase();
        if (!email) throw fault("Email is required");
        if (draft.accounts.some(account => account.userId !== userId && account.email === email)) throw fault("Email already registered", 409);
        next.email = email;
        emailChanged = email !== current.email;
        changed = changed || emailChanged;
      }
      if (Object.hasOwn(changes, "displayName")) {
        const displayName = String(changes.displayName || "").trim().slice(0, 160);
        if (!displayName) throw fault("Display name is required");
        next.displayName = displayName;
        changed = changed || displayName !== current.displayName;
      }
      if (Object.hasOwn(changes, "disabled")) {
        if (typeof changes.disabled !== "boolean") throw fault("disabled must be a boolean");
        next.disabled = changes.disabled;
        changed = changed || next.disabled !== Boolean(current.disabled);
      }
      const passwordChanged = Object.hasOwn(changes, "passwordHash") || Object.hasOwn(changes, "passwordSalt");
      if (passwordChanged) {
        if (!changes.passwordHash || !changes.passwordSalt) throw fault("Password hash and salt must be provided together");
        next.passwordHash = String(changes.passwordHash);
        next.passwordSalt = String(changes.passwordSalt);
        changed = true;
      }
      if (!changed) return publicAccount(current);
      next.updatedAt = new Date().toISOString();
      draft.accounts[index] = next;
      if (passwordChanged || emailChanged || next.disabled) draft.sessions = draft.sessions.filter(session => session.userId !== userId);
      return publicAccount(next);
    }),
    deleteAccount: userId => transaction(draft => {
      const account = draft.accounts.find(row => row.userId === userId);
      if (!account) throw fault("Account not found", 404);
      const projectIds = Object.values(draft.projects).filter(entry => entry.ownerId === userId || entry.members?.some(member => member.userId === userId)).map(entry => entry.projectId).filter(Boolean);
      if (projectIds.length) throw fault("Remove the account from every project before deleting it", 409, { projectIds });
      draft.accounts = draft.accounts.filter(row => row.userId !== userId);
      draft.sessions = draft.sessions.filter(session => session.userId !== userId);
      return publicAccount(account);
    }),
    createSession: session => transaction(draft => {
      draft.sessions = draft.sessions.filter(s => Date.parse(s.expiresAt) > Date.now());
      draft.sessions.push({ ...session, expiresAt: new Date(session.expiresAt).toISOString() });
      return true;
    }),
    sessionByTokenHash: hash => read(s => {
      const session = s.sessions.find(row => row.tokenHash === hash && Date.parse(row.expiresAt) > Date.now());
      const account = session && s.accounts.find(a => a.userId === session.userId && !a.disabled);
      return account ? { ...session, email: account.email, displayName: account.displayName, disabled: Boolean(account.disabled) } : null;
    }),
    deleteSession: hash => transaction(draft => { const count = draft.sessions.length; draft.sessions = draft.sessions.filter(s => s.tokenHash !== hash); return count !== draft.sessions.length; }),
    createFeedback: (identity, body) => transaction(draft => {
      if (!body.feature || !body.content) throw fault("Feedback feature and content are required");
      const attachment = body.attachment || {};
      if (Number(attachment.size || 0) > 5 * 1024 * 1024 || String(attachment.data || "").length > 7_500_000) throw fault("Feedback attachment is too large");
      const item = { id: "FB-" + crypto.randomUUID(), userId: identity.userId, userName: identity.userName, feature: String(body.feature).slice(0, 240), content: String(body.content).slice(0, 50000), attachmentName: String(attachment.name || "").slice(0, 180), attachmentData: String(attachment.data || ""), createdAt: new Date().toISOString() };
      draft.feedback = [item, ...draft.feedback].slice(0, 500);
      const { attachmentData, ...metadata } = item;
      return metadata;
    }),
    listFeedback: ({ all = false, userId = "" } = {}) => read(s => s.feedback.filter(f => all || f.userId === userId).map(({ attachmentData, ...metadata }) => metadata)),
    close: async () => { await queue; closed = true; releaseGuard(); process.removeListener("exit", releaseGuard); }
  };
}
