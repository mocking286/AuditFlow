import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import { appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import { MUTATIONS, mutateProject, normalizeEntry, memberFor, projectSummary, isGlobalAdmin, isGlobalLeadAssessor, PERMISSION_SCHEMA_VERSION } from "./collaboration-model.mjs";

const DEFAULT_LOCK_TTL_MS = 90_000;
function cleanText(value, fallback = "", max = 240) {
  return String(value ?? fallback).trim().slice(0, max);
}

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

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "")); } catch (_) { return fallback; }
}

function mysqlDateTime(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  const iso = date.toISOString();
  return `${iso.slice(0, 19).replace("T", " ")}.${iso.slice(20, 23)}`;
}

function statusError(message, status, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

function folderNameForUser(userId) {
  const text = cleanText(userId, "unknown", 160);
  const slug = text.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "user";
  const digest = crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
  return `${slug}-${digest}`;
}

const SCHEMA_STATEMENTS = [
  `create table if not exists auditflow_accounts (
    user_id varchar(191) primary key,
    email varchar(320) not null unique,
    display_name varchar(160) not null,
    password_hash varchar(255) not null,
    password_salt varchar(64) not null,
    disabled tinyint(1) not null default 0,
    created_at datetime(3) not null default current_timestamp(3),
    updated_at datetime(3) not null default current_timestamp(3) on update current_timestamp(3)
  ) engine=InnoDB default charset=utf8mb4`,
  `create table if not exists auditflow_sessions (
    token_hash char(64) primary key,
    user_id varchar(191) not null,
    expires_at datetime(3) not null,
    created_at datetime(3) not null default current_timestamp(3),
    last_seen datetime(3) not null default current_timestamp(3),
    user_agent varchar(500) not null default '',
    index auditflow_sessions_user_idx (user_id),
    index auditflow_sessions_expiry_idx (expires_at)
  ) engine=InnoDB default charset=utf8mb4`,
  `create table if not exists auditflow_users (
    user_id varchar(191) primary key,
    display_name varchar(160) not null default '',
    data_dir varchar(512) not null,
    created_at datetime(3) not null default current_timestamp(3),
    updated_at datetime(3) not null default current_timestamp(3) on update current_timestamp(3)
  ) engine=InnoDB default charset=utf8mb4`,
  `create table if not exists auditflow_projects (
    id varchar(191) primary key,
    workspace_id varchar(191) not null,
    snapshot_json longtext not null,
    revision bigint not null default 0,
    owner_id varchar(191) not null,
    updated_by varchar(191) not null,
    updated_by_name varchar(160) not null default '',
    updated_at datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
    index auditflow_projects_workspace_idx (workspace_id),
    index auditflow_projects_owner_idx (owner_id)
  ) engine=InnoDB default charset=utf8mb4`,
  `create table if not exists auditflow_project_members (
    project_id varchar(191) not null,
    user_id varchar(191) not null,
    user_name varchar(160) not null default '',
    role varchar(80) not null default 'Viewer',
    process_scopes_json text not null,
    avatar_data longtext not null,
    permissions_json text null,
    permission_version smallint unsigned not null default 1,
    created_at datetime(3) not null default current_timestamp(3),
    updated_at datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
    primary key (project_id, user_id),
    index auditflow_members_user_idx (user_id),
    index auditflow_members_role_idx (project_id, role)
  ) engine=InnoDB default charset=utf8mb4`,
  `create table if not exists auditflow_project_locks (
    id varchar(96) primary key,
    project_id varchar(191) not null,
    resource_id varchar(300) not null,
    kind varchar(80) not null,
    label varchar(240) not null,
    process varchar(40) not null default '',
    affected_processes_json text not null,
    user_id varchar(191) not null,
    user_name varchar(160) not null default '',
    acquired_at datetime(3) not null,
    expires_at datetime(3) not null,
    index auditflow_locks_project_expiry_idx (project_id, expires_at),
    index auditflow_locks_project_resource_idx (project_id, resource_id)
  ) engine=InnoDB default charset=utf8mb4`,
  `create table if not exists auditflow_project_presence (
    project_id varchar(191) not null,
    user_id varchar(191) not null,
    user_name varchar(160) not null default '',
    project_name varchar(240) not null default '',
    phase varchar(80) not null default 'overview',
    status varchar(40) not null default 'editing',
    last_seen datetime(3) not null,
    expires_at datetime(3) not null,
    primary key (project_id, user_id),
    index auditflow_presence_expiry_idx (project_id, expires_at)
  ) engine=InnoDB default charset=utf8mb4`,
  `create table if not exists auditflow_project_events (
    id bigint unsigned not null auto_increment primary key,
    project_id varchar(191) not null,
    revision bigint not null,
    user_id varchar(191) not null,
    user_name varchar(160) not null default '',
    change_summary varchar(500) not null default '',
    processes_json text not null,
    change_json longtext not null,
    created_at datetime(3) not null default current_timestamp(3),
    index auditflow_events_cursor_idx (project_id, revision)
  ) engine=InnoDB default charset=utf8mb4`,
  `create table if not exists auditflow_evidence_items (
    project_id varchar(191) not null,
    evidence_id varchar(191) not null,
    item_id varchar(191) not null,
    process_code varchar(80) not null default '',
    evidence_role varchar(40) not null default 'direct',
    item_json longtext not null,
    updated_at datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
    primary key (project_id, evidence_id, item_id),
    index auditflow_evidence_items_process_idx (project_id, process_code)
  ) engine=InnoDB default charset=utf8mb4`,
  `create table if not exists auditflow_assessor_records (
    project_id varchar(191) not null,
    record_id varchar(191) not null,
    record_type varchar(40) not null default 'comment',
    indicators_json text not null,
    evidence_ids_json text not null,
    evidence_references text not null,
    record_json longtext not null,
    updated_at datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
    primary key (project_id, record_id),
    index auditflow_records_type_idx (project_id, record_type)
  ) engine=InnoDB default charset=utf8mb4`,
  `create table if not exists auditflow_feedback (
    id varchar(96) primary key,
    user_id varchar(191) not null,
    user_name varchar(160) not null default '',
    feature varchar(240) not null,
    content text not null,
    attachment_name varchar(255) not null default '',
    attachment_type varchar(160) not null default '',
    attachment_size bigint not null default 0,
    attachment_data longtext not null,
    created_at datetime(3) not null default current_timestamp(3),
    index auditflow_feedback_user_idx (user_id),
    index auditflow_feedback_created_idx (created_at)
  ) engine=InnoDB default charset=utf8mb4`
];

export function createMysqlCollaborationStore({ url, userDataRoot, lockTtlMs = DEFAULT_LOCK_TTL_MS, maxActiveEditors = 15 } = {}) {
  if (!url) throw new Error("MySQL connection URL is required");
  const root = path.resolve(userDataRoot || path.join(process.cwd(), "output", "users"));
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const parsedUrl = new URL(url);
  const pool = mysql.createPool({
    host: parsedUrl.hostname,
    port: parsedUrl.port ? Number(parsedUrl.port) : 3306,
    user: decodeURIComponent(parsedUrl.username),
    password: decodeURIComponent(parsedUrl.password),
    database: decodeURIComponent(parsedUrl.pathname.replace(/^\//, "")),
    ssl: parsedUrl.protocol === "mysqls:" ? { rejectUnauthorized: true } : undefined,
    timezone: "Z",
    connectionLimit: Math.max(32, maxActiveEditors + 8),
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  });
  let schemaPromise;

  async function ensureSchema() {
    if (!schemaPromise) {
      schemaPromise = (async () => {
        const connection = await pool.getConnection();
        try {
          for (const statement of SCHEMA_STATEMENTS) await connection.query(statement);
          const [columns] = await connection.query("show columns from auditflow_project_members where field in ('permissions_json','permission_version')");
          const columnNames = new Set(columns.map(column => column.Field));
          if (!columnNames.has("permissions_json")) {
            try { await connection.query("alter table auditflow_project_members add column permissions_json text null after avatar_data"); }
            catch (error) { if (error.code !== "ER_DUP_FIELDNAME") throw error; }
          }
          if (!columnNames.has("permission_version")) {
            try { await connection.query(`alter table auditflow_project_members add column permission_version smallint unsigned not null default ${PERMISSION_SCHEMA_VERSION} after permissions_json`); }
            catch (error) { if (error.code !== "ER_DUP_FIELDNAME") throw error; }
          }
          try { await connection.query("alter table auditflow_project_members add index auditflow_members_role_idx (project_id, role)"); }
          catch (error) { if (error.code !== "ER_DUP_KEYNAME") throw error; }
          const [accountColumns] = await connection.query("show columns from auditflow_accounts like 'disabled'");
          if (!accountColumns.length) {
            try { await connection.query("alter table auditflow_accounts add column disabled tinyint(1) not null default 0 after password_salt"); }
            catch (error) { if (error.code !== "ER_DUP_FIELDNAME") throw error; }
          }
        } finally {
          connection.release();
        }
      })();
    }
    try {
      await schemaPromise;
    } catch (error) {
      schemaPromise = null;
      throw error;
    }
  }

  async function ensureUser(identity) {
    const userId = cleanText(identity?.userId, "", 160);
    const userName = cleanText(identity?.userName, userId || "AuditFlow User", 160);
    if (!userId) throw statusError("Missing AuditFlow collaboration user identity", 401);
    const directory = path.join(root, folderNameForUser(userId));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    await pool.execute(
      `insert into auditflow_users(user_id, display_name, data_dir) values (?, ?, ?)
       on duplicate key update display_name=values(display_name), data_dir=values(data_dir)`,
      [userId, userName, directory]
    );
    const profilePath = path.join(directory, "profile.json");
    await writeFile(profilePath, JSON.stringify({ userId, displayName: userName, dataDir: directory }, null, 2), { encoding: "utf8", mode: 0o600 });
    return { userId, userName, directory };
  }

  async function createAccount({ userId, email, displayName, passwordHash, passwordSalt, disabled = false }) {
    await ensureSchema();
    const identity = {
      userId: cleanText(userId, "", 160),
      userName: cleanText(displayName, "", 160)
    };
    const normalizedEmail = cleanText(email, "", 320).toLowerCase();
    if (!identity.userId || !identity.userName || !normalizedEmail || !passwordHash || !passwordSalt) {
      throw statusError("Incomplete account record", 400);
    }
    try {
      await pool.execute(
        "insert into auditflow_accounts(user_id, email, display_name, password_hash, password_salt, disabled) values (?, ?, ?, ?, ?, ?)",
        [identity.userId, normalizedEmail, identity.userName, String(passwordHash), String(passwordSalt), disabled ? 1 : 0]
      );
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") throw statusError("该邮箱已经注册", 409);
      throw error;
    }
    await ensureUser(identity);
    return publicAccount({ userId: identity.userId, email: normalizedEmail, displayName: identity.userName, disabled, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }

  async function accountByEmail(email) {
    await ensureSchema();
    const normalizedEmail = cleanText(email, "", 320).toLowerCase();
    const [rows] = await pool.execute(
      "select user_id, email, display_name, password_hash, password_salt, disabled, created_at, updated_at from auditflow_accounts where email=? limit 1",
      [normalizedEmail]
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      passwordHash: row.password_hash,
      passwordSalt: row.password_salt,
      disabled: Boolean(row.disabled),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    };
  }

  async function createSession({ tokenHash, userId, expiresAt, userAgent = "" }) {
    await ensureSchema();
    await pool.execute(
      "insert into auditflow_sessions(token_hash, user_id, expires_at, user_agent) values (?, ?, ?, ?)",
      [cleanText(tokenHash, "", 64), cleanText(userId, "", 160), expiresAt, cleanText(userAgent, "", 500)]
    );
  }

  async function sessionByTokenHash(tokenHash) {
    await ensureSchema();
    const hash = cleanText(tokenHash, "", 64);
    if (!hash) return null;
    await pool.execute("delete from auditflow_sessions where expires_at<=utc_timestamp(3)");
    const [rows] = await pool.execute(
      `select s.token_hash, s.user_id, s.expires_at, a.email, a.display_name
       from auditflow_sessions s
       join auditflow_accounts a on a.user_id=s.user_id
       where s.token_hash=? and s.expires_at>utc_timestamp(3) and a.disabled=0
       limit 1`,
      [hash]
    );
    if (!rows.length) return null;
    await pool.execute("update auditflow_sessions set last_seen=utc_timestamp(3) where token_hash=?", [hash]);
    const row = rows[0];
    return {
      tokenHash: row.token_hash,
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      expiresAt: new Date(row.expires_at).toISOString()
    };
  }

  async function deleteSession(tokenHash) {
    await ensureSchema();
    const [result] = await pool.execute("delete from auditflow_sessions where token_hash=?", [cleanText(tokenHash, "", 64)]);
    return result.affectedRows > 0;
  }

  async function logUserEvent(identity, event) {
    try {
      const user = await ensureUser(identity);
      await appendFile(path.join(user.directory, "events.ndjson"), `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
    } catch (_) {
      // The database remains authoritative; a per-user filesystem audit copy is best effort.
    }
  }

  async function loadEntry(db, projectId, forUpdate = false) {
    const suffix = forUpdate ? " for update" : "";
    const [projectRows] = await db.query(`select id, workspace_id, snapshot_json, revision, owner_id, updated_by, updated_by_name, updated_at from auditflow_projects where id=?${suffix}`, [projectId]);
    if (!projectRows.length) return null;
    const [memberRows] = await db.query("select user_id, user_name, role, process_scopes_json, avatar_data, permissions_json, permission_version from auditflow_project_members where project_id=? order by created_at", [projectId]);
    const [lockRows] = await db.query("select id, resource_id, kind, label, process, affected_processes_json, user_id, user_name, acquired_at, expires_at from auditflow_project_locks where project_id=? order by acquired_at", [projectId]);
    const [presenceRows] = await db.query("select user_id, user_name, project_name, phase, status, last_seen, expires_at from auditflow_project_presence where project_id=? order by last_seen desc", [projectId]);
    const [eventRows] = await db.query("select revision, user_id, user_name, change_summary, processes_json, change_json, created_at from auditflow_project_events where project_id=? order by revision desc, id desc limit 500", [projectId]);
    eventRows.reverse();
    const project = projectRows[0];
    return {
      projectId: project.id,
      ownerId: project.owner_id,
      workspaceId: project.workspace_id,
      revision: Number(project.revision),
      snapshot: parseJson(project.snapshot_json, {}),
      members: memberRows.map(row => ({ userId: row.user_id, name: row.user_name, role: row.role, processScopes: parseJson(row.process_scopes_json, []), permissions: parseJson(row.permissions_json, null), permissionVersion: Number(row.permission_version) || PERMISSION_SCHEMA_VERSION, avatarData: row.avatar_data || "" })),
      locks: lockRows.map(row => ({ id: row.id, resourceId: row.resource_id, kind: row.kind, label: row.label, process: row.process, affectedProcesses: parseJson(row.affected_processes_json, []), userId: row.user_id, userName: row.user_name, acquiredAt: new Date(row.acquired_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString() })),
      presence: presenceRows.map(row => ({ userId: row.user_id, userName: row.user_name, projectId, projectName: row.project_name, phase: row.phase, status: row.status, lastSeen: new Date(row.last_seen).toISOString(), expiresAt: new Date(row.expires_at).toISOString() })),
      updatedBy: project.updated_by,
      updatedByName: project.updated_by_name,
      updatedAt: new Date(project.updated_at).toISOString(),
      events: eventRows.map(row => ({ revision: Number(row.revision), userId: row.user_id, userName: row.user_name, changeSummary: row.change_summary, processes: parseJson(row.processes_json, []), change: parseJson(row.change_json, undefined), createdAt: new Date(row.created_at).toISOString() }))
    };
  }

  async function project(projectId) {
    await ensureSchema();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const entry = normalizeEntry(await loadEntry(connection, projectId));
      await connection.commit();
      return entry;
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }

  async function accountById(userId) {
    await ensureSchema();
    const [rows] = await pool.execute("select email from auditflow_accounts where user_id=?", [userId]);
    return rows.length ? accountByEmail(rows[0].email) : null;
  }

  async function listAccounts(identity) {
    if (!isGlobalAdmin(identity)) throw statusError("Administrator access required", 403);
    await ensureSchema();
    const [rows] = await pool.execute("select user_id, email, display_name, disabled, created_at, updated_at from auditflow_accounts order by created_at desc");
    return rows.map(row => publicAccount({
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      disabled: Boolean(row.disabled),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    }));
  }

  // Kept intentionally separate from listAccounts so anonymous bootstrap
  // checks can determine whether initialization is still allowed without
  // exposing account records.
  async function countAccounts() {
    await ensureSchema();
    const [rows] = await pool.execute("select count(*) as count from auditflow_accounts");
    return Number(rows[0]?.count || 0);
  }

  async function updateAccount(userId, changes = {}) {
    await ensureSchema();
    const id = cleanText(userId, "", 160);
    const current = await accountById(id);
    if (!current) throw statusError("Account not found", 404);
    const fields = [];
    const values = [];
    let passwordChanged = false;
    let emailChanged = false;
    let disabled = current.disabled;
    if (Object.hasOwn(changes, "email")) {
      const email = cleanText(changes.email, "", 320).toLowerCase();
      if (!email) throw statusError("Email is required", 400);
      fields.push("email=?");
      values.push(email);
      emailChanged = email !== current.email;
    }
    if (Object.hasOwn(changes, "displayName")) {
      const displayName = cleanText(changes.displayName, "", 160);
      if (!displayName) throw statusError("Display name is required", 400);
      fields.push("display_name=?");
      values.push(displayName);
    }
    if (Object.hasOwn(changes, "disabled")) {
      if (typeof changes.disabled !== "boolean") throw statusError("disabled must be a boolean", 400);
      disabled = changes.disabled;
      fields.push("disabled=?");
      values.push(disabled ? 1 : 0);
    }
    if (Object.hasOwn(changes, "passwordHash") || Object.hasOwn(changes, "passwordSalt")) {
      if (!changes.passwordHash || !changes.passwordSalt) throw statusError("Password hash and salt must be provided together", 400);
      fields.push("password_hash=?", "password_salt=?");
      values.push(String(changes.passwordHash), String(changes.passwordSalt));
      passwordChanged = true;
    }
    if (!fields.length) return publicAccount(current);
    try {
      await pool.execute(`update auditflow_accounts set ${fields.join(", ")} where user_id=?`, [...values, id]);
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") throw statusError("Email already registered", 409);
      throw error;
    }
    if (passwordChanged || emailChanged || disabled) await pool.execute("delete from auditflow_sessions where user_id=?", [id]);
    const updated = await accountById(id);
    return publicAccount(updated);
  }

  async function deleteAccount(userId) {
    await ensureSchema();
    const id = cleanText(userId, "", 160);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [accounts] = await connection.execute("select user_id, email, display_name, disabled, created_at, updated_at from auditflow_accounts where user_id=? for update", [id]);
      if (!accounts.length) throw statusError("Account not found", 404);
      const [memberships] = await connection.execute("select project_id from auditflow_project_members where user_id=?", [id]);
      const [ownership] = await connection.execute("select id from auditflow_projects where owner_id=?", [id]);
      const projectIds = [...new Set([...memberships.map(row => row.project_id), ...ownership.map(row => row.id)])];
      if (projectIds.length) throw statusError("Remove the account from every project before deleting it", 409, { projectIds });
      await connection.execute("delete from auditflow_sessions where user_id=?", [id]);
      await connection.execute("delete from auditflow_project_locks where user_id=?", [id]);
      await connection.execute("delete from auditflow_project_presence where user_id=?", [id]);
      await connection.execute("delete from auditflow_accounts where user_id=?", [id]);
      await connection.commit();
      const account = accounts[0];
      return publicAccount({
        userId: account.user_id,
        email: account.email,
        displayName: account.display_name,
        disabled: Boolean(account.disabled),
        createdAt: new Date(account.created_at).toISOString(),
        updatedAt: new Date(account.updated_at).toISOString()
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function listProjects(identity) {
    await ensureSchema();
    const [rows] = isGlobalAdmin(identity) || isGlobalLeadAssessor(identity) ? await pool.execute("select id as project_id from auditflow_projects") : await pool.execute("select project_id from auditflow_project_members where user_id=?", [identity.userId]);
    const entries = await Promise.all(rows.map(row => project(row.project_id)));
    return entries.filter(e => e && (isGlobalAdmin(identity) || isGlobalLeadAssessor(identity) || memberFor(e, identity)?.permissions.view)).map(e => projectSummary(e, identity));
  }

  async function adminOverview(identity) {
    if (!isGlobalAdmin(identity)) throw statusError("Administrator access required", 403);
    await ensureSchema();
    const accounts = await listAccounts(identity);
    const summaries = await listProjects(identity);
    const projects = await Promise.all(summaries.map(async summary => {
      const entry = await project(summary.projectId);
      return { ...summary, members: entry.members, evidenceCount: entry.snapshot?.evidence?.length || 0, assessmentCount: entry.snapshot?.assessments?.length || 0, recordCount: entry.snapshot?.records?.length || 0 };
    }));
    const [feedback] = await pool.execute("select count(*) as count from auditflow_feedback");
    return { database: "mysql", permissionSchemaVersion: PERMISSION_SCHEMA_VERSION, accounts, projects, feedbackCount: Number(feedback[0].count) };
  }

  async function persistEntry(db, entry, previousRevision) {
    await db.execute(
      "insert into auditflow_projects(id,workspace_id,snapshot_json,revision,owner_id,updated_by,updated_by_name,updated_at) values(?,?,?,?,?,?,?,?) on duplicate key update snapshot_json=values(snapshot_json),revision=values(revision),updated_by=values(updated_by),updated_by_name=values(updated_by_name),updated_at=values(updated_at)",
      [entry.projectId, entry.workspaceId, JSON.stringify(entry.snapshot), entry.revision, entry.ownerId, entry.updatedBy, entry.updatedByName, mysqlDateTime(entry.updatedAt)]
    );
    // These small collections are written under the project row lock as one transaction.
    for (const table of ["auditflow_project_members", "auditflow_project_locks", "auditflow_project_presence"]) {
      await db.execute("delete from " + table + " where project_id=?", [entry.projectId]);
    }
    for (const m of entry.members) await db.execute(
      "insert into auditflow_project_members(project_id,user_id,user_name,role,process_scopes_json,avatar_data,permissions_json,permission_version) values(?,?,?,?,?,?,?,?)",
      [entry.projectId, m.userId, m.name, m.role, JSON.stringify(m.processScopes), m.avatarData || "", JSON.stringify(m.permissions), Number(m.permissionVersion) || PERMISSION_SCHEMA_VERSION]
    );
    for (const l of entry.locks) await db.execute(
      "insert into auditflow_project_locks(id,project_id,resource_id,kind,label,process,affected_processes_json,user_id,user_name,acquired_at,expires_at) values(?,?,?,?,?,?,?,?,?,?,?)",
      [l.id,entry.projectId,l.resourceId,l.kind,l.label,l.process,JSON.stringify(l.affectedProcesses),l.userId,l.userName,mysqlDateTime(l.acquiredAt),mysqlDateTime(l.expiresAt)]
    );
    for (const p of entry.presence) await db.execute(
      "insert into auditflow_project_presence(project_id,user_id,user_name,project_name,phase,status,last_seen,expires_at) values(?,?,?,?,?,?,?,?)",
      [entry.projectId,p.userId,p.userName,p.projectName,p.phase,p.status,mysqlDateTime(p.lastSeen),mysqlDateTime(p.expiresAt)]
    );
    await db.execute("delete from auditflow_evidence_items where project_id=?", [entry.projectId]);
    for (const evidence of entry.snapshot.evidence || []) for (const item of evidence.items || []) await db.execute(
      "insert into auditflow_evidence_items(project_id,evidence_id,item_id,process_code,evidence_role,item_json) values(?,?,?,?,?,?)",
      [entry.projectId, evidence.id || "", item.id || "", item.primaryProcess || "", item.evidenceRole || "direct", JSON.stringify(item)]
    );
    await db.execute("delete from auditflow_assessor_records where project_id=?", [entry.projectId]);
    for (const record of entry.snapshot.records || []) await db.execute(
      "insert into auditflow_assessor_records(project_id,record_id,record_type,indicators_json,evidence_ids_json,evidence_references,record_json) values(?,?,?,?,?,?,?)",
      [entry.projectId, record.id || "", record.type || "comment", JSON.stringify(record.indicators || []), JSON.stringify(record.evidenceIds || []), String(record.evidenceReferences || ""), JSON.stringify(record)]
    );
    for (const e of entry.events.filter(e => e.revision > previousRevision)) await db.execute(
      "insert into auditflow_project_events(project_id,revision,user_id,user_name,change_summary,processes_json,change_json,created_at) values(?,?,?,?,?,?,?,?)",
      [entry.projectId,e.revision,e.userId,e.userName,e.changeSummary,JSON.stringify(e.processes || []),JSON.stringify(e.change || {}),mysqlDateTime(e.createdAt)]
    );
  }

  async function mutate(operation, projectId, body, identity) {
    await ensureSchema();
    const connection = await pool.getConnection();
    try {
      // Deadlocks during simultaneous first publication are retried against the winning row.
      for (let attempt = 0; ; attempt++) {
        try {
          await connection.beginTransaction();
          const current = await loadEntry(connection, projectId, true);
          const { entry, result } = mutateProject(operation, current, projectId, body, identity, { lockTtlMs, maxActiveEditors });
          await persistEntry(connection, entry, current?.revision || 0);
          await connection.commit();
          if (entry.revision !== (current?.revision || 0)) await logUserEvent(identity, { type: operation, projectId, ...entry.events.at(-1) });
          return result;
        } catch (error) {
          await connection.rollback();
          if (attempt < 3 && ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT", "ER_DUP_ENTRY"].includes(error.code)) continue;
          throw error;
        }
      }
    } finally { connection.release(); }
  }

  async function createFeedback(identity, body = {}) {
    await ensureSchema();
    await ensureUser(identity);
    const feature = cleanText(body.feature, "", 240);
    const content = cleanText(body.content, "", 50_000);
    if (!feature || !content) throw statusError("Feedback feature and content are required", 400);
    const attachment = body.attachment && typeof body.attachment === "object" ? body.attachment : {};
    const data = String(attachment.data || "");
    if (data.length > 7_000_000 || (attachment.name && !/^[^\\/\\\\]{1,255}$/.test(String(attachment.name)))) {
      throw statusError("Feedback attachment is too large or has an invalid name", 400);
    }
    const id = `FB-${crypto.randomUUID()}`;
    await pool.execute(
      "insert into auditflow_feedback(id, user_id, user_name, feature, content, attachment_name, attachment_type, attachment_size, attachment_data) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, identity.userId, identity.userName, feature, content, cleanText(attachment.name, "", 255), cleanText(attachment.type, "", 160), Number(attachment.size) || 0, data]
    );
    return { id, userId: identity.userId, userName: identity.userName, feature, content, attachmentName: cleanText(attachment.name, "", 255), attachmentType: cleanText(attachment.type, "", 160), attachmentSize: Number(attachment.size) || 0, createdAt: new Date().toISOString() };
  }

  async function listFeedback({ userId = "", all = false } = {}) {
    await ensureSchema();
    const [rows] = all
      ? await pool.execute("select id, user_id, user_name, feature, content, attachment_name, attachment_type, attachment_size, created_at from auditflow_feedback order by created_at desc limit 500")
      : await pool.execute("select id, user_id, user_name, feature, content, attachment_name, attachment_type, attachment_size, created_at from auditflow_feedback where user_id=? order by created_at desc limit 100", [userId]);
    return rows.map(row => ({ id: row.id, userId: row.user_id, userName: row.user_name, feature: row.feature, content: row.content, attachmentName: row.attachment_name, attachmentType: row.attachment_type, attachmentSize: Number(row.attachment_size || 0), createdAt: new Date(row.created_at).toISOString() }));
  }


  return {
    provider: "MySQL", persistence: "MySQL InnoDB", filePath: root, userDataRoot: root,
    ensureSchema, createAccount, accountByEmail, accountById, listAccounts, countAccounts, updateAccount, deleteAccount, createSession, sessionByTokenHash, deleteSession,
    project, listProjects, memberFor, createFeedback, listFeedback, adminOverview,
    ...Object.fromEntries(MUTATIONS.map(operation => [operation, (projectId, body, identity) => mutate(operation, projectId, body, identity)])),
    locks: async projectId => (await project(projectId))?.locks || [],
    presence: async projectId => (await project(projectId))?.presence || [],
    close: () => pool.end()
  };
}
