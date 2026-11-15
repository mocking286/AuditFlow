import { createHash, createHmac } from "node:crypto";

const EPHEMERAL_TABLES = new Set(["auditflow_sessions", "auditflow_project_locks", "auditflow_project_presence"]);
export const isEphemeralTable = name => EPHEMERAL_TABLES.has(name);
const PUBLIC_TABLE_NAMES = new Set([
  "auditflow_accounts", "auditflow_users", "auditflow_projects", "auditflow_project_members",
  "auditflow_project_events", "auditflow_evidence_items", "auditflow_assessor_records",
  "auditflow_feedback", "auditflow_sessions", "auditflow_project_locks", "auditflow_project_presence",
  "auditflow_fileanalyst_attachments", "auditflow_jira_issues", "auditflow_shared_glossary",
  "auditflow_shared_translations", "auditflow_shared_findings", "auditflow_shared_finding_links",
  "content_objects", "content_revisions", "release_content", "sync_outbox", "sync_conflicts", "jiraflow_state",
]);
const fail = code => Object.assign(new Error(code), { code });
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const versionParts = value => /^\d+\.\d+\.\d+$/.test(String(value)) ? String(value).split(".").map(Number) : null;
function compareVersions(left, right) {
  const a = versionParts(left), b = versionParts(right);
  if (!a || !b) throw fail("INVALID_VERSION_IDENTITY");
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

export function canonicalData(value) {
  function normalize(item) {
    if (typeof item === "bigint") return { $bigint: String(item) };
    if (Buffer.isBuffer(item) || item instanceof Uint8Array) return { $bytes: Buffer.from(item).toString("base64") };
    if (item instanceof Date) return { $date: item.toISOString() };
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") return Object.fromEntries(
      Object.keys(item).sort(compare).map(key => [key, normalize(item[key])])
    );
    if (item === undefined) return { $undefined: true };
    return item;
  }
  return JSON.stringify(normalize(value));
}

function normalizedRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (typeof value === "string" && (key.endsWith("_json") || key === "snapshot")) {
      try { return [key, JSON.parse(value)]; } catch { return [key, value]; }
    }
    return [key, value];
  }));
}

function planChecksum(plan) {
  const { checksum: _, ...payload } = plan;
  return `sha256:${createHash("sha256").update(canonicalData(payload)).digest("hex")}`;
}

export function assertFreshUpgradePlan(previous, current) {
  if (!previous || previous.checksum !== planChecksum(previous)
    || !current || current.checksum !== planChecksum(current)) throw fail("INVALID_PLAN_CHECKSUM");
  if (previous.formatVersion !== current.formatVersion
    || previous.inventoryFingerprint !== current.inventoryFingerprint
    || canonicalData(previous.target) !== canonicalData(current.target)) throw fail("STALE_UPGRADE_PLAN");
  return true;
}

export function buildUpgradePlan({
  snapshots, targetVersion = "7.7.0", referenceKey,
  maxDatabaseSchemaVersion = 29, maxWorkspaceSchemaVersion = 61, maxMetadataSnapshotVersion = 2,
} = {}) {
  if (!Buffer.isBuffer(referenceKey) || referenceKey.length < 32) throw fail("REFERENCE_KEY_REQUIRED");
  if (!Array.isArray(snapshots) || snapshots.length === 0) throw fail("SOURCE_INVENTORY_REQUIRED");
  const ref = (...parts) => `ref-${createHmac("sha256", referenceKey).update(canonicalData(parts)).digest("hex").slice(0, 24)}`;
  const fingerprint = value => `hmac-sha256:${createHmac("sha256", referenceKey).update(canonicalData(value)).digest("hex")}`;
  const tableName = name => PUBLIC_TABLE_NAMES.has(name) ? name : ref("table", name);
  const ordered = [...snapshots].sort((a, b) => compareVersions(a.version, b.version)
    || compare(a.database, b.database) || Number(a.port) - Number(b.port));
  const seenSources = new Set();
  for (const source of ordered) {
    if (!versionParts(source.version) || source.database !== `jeauditflow_${source.version.replaceAll(".", "")}`
      || (!(source.status === "unavailable" && source.port === null)
        && (!Number.isInteger(source.port) || source.port < 1 || source.port > 65535))) throw fail("INVALID_SOURCE_IDENTITY");
    const identity = `${source.database}:${source.port}`;
    if (seenSources.has(identity)) throw fail("DUPLICATE_SOURCE_IDENTITY");
    seenSources.add(identity);
  }
  const target = ordered.find(source => source.version === targetVersion);
  if (!target) throw fail("TARGET_NOT_FOUND");
  if (ordered.filter(source => source.version === targetVersion).length !== 1) throw fail("AMBIGUOUS_TARGET");
  const sourceRef = source => ref("source", source.version, source.database, source.port);
  const conflicts = new Map();
  const blockers = new Map();
  function blocker(code, source, entity = "") {
    const item = { code, sourceRef: sourceRef(source), ...(entity ? { ref: entity } : {}) };
    blockers.set(canonicalData(item), item);
  }
  function conflict(code, entity, rows, details = {}) {
    const involvesTarget = rows.some(item => item.source === target);
    const item = { code, ref: ref("conflict", entity),
      sourceRefs: [...new Set(rows.map(item => sourceRef(item.source)))].sort(compare),
      classification: involvesTarget && code === "credential-divergence" ? "target-authoritative" : "needs-review",
      proposedResolution: involvesTarget
        ? code === "credential-divergence" ? "preserve-active-target-credentials" : "preserve-active-target"
        : "explicit-legacy-conflict-resolution",
      ...details };
    conflicts.set(canonicalData(item), item);
  }
  const indexed = new Map();
  for (const source of ordered) {
    if (source.status !== "available") blocker("source-unavailable", source);
    if (source.status === "available" && !Number.isSafeInteger(source.declaredSchemaVersion)) blocker("declared-schema-version-unavailable", source);
    if (compareVersions(source.version, targetVersion) > 0
      || Number(source.declaredSchemaVersion) > maxDatabaseSchemaVersion
      || Number(source.workspaceSchemaVersion) > maxWorkspaceSchemaVersion) blocker("unsupported-future-version", source);
    const tables = new Map();
    for (const [name, table] of Object.entries(source.tables || {}).sort(([a], [b]) => compare(a, b))) {
      const rows = table.rows || [];
      const primaryKey = table.primaryKey || [];
      const byKey = new Map();
      if (!EPHEMERAL_TABLES.has(name) && rows.length && primaryKey.length === 0) blocker("missing-primary-key", source, ref("table", name));
      for (const original of rows) {
        const row = normalizedRow(original);
        const rawKey = primaryKey.map(key => row[key]);
        if (!EPHEMERAL_TABLES.has(name) && primaryKey.length
          && rawKey.some(value => value === undefined || value === null)) blocker("missing-primary-key-value", source, ref("row", name, rawKey));
        const key = canonicalData(rawKey);
        if (!EPHEMERAL_TABLES.has(name) && byKey.has(key)) blocker("duplicate-primary-key", source, ref("row", name, rawKey));
        byKey.set(key, row);
        if (name === "auditflow_projects") {
          const snapshot = row.snapshot_json;
          if (typeof original.snapshot_json === "string" && typeof snapshot === "string") blocker("invalid-project-json", source, ref("project", row.id));
          const versions = [[snapshot?.workspaceFormatVersion, maxWorkspaceSchemaVersion]];
          if (snapshot?.snapshotPolicy === "metadata-only") versions.push([snapshot?.snapshotVersion, maxMetadataSnapshotVersion]);
          for (const [value, maximum] of versions) if (value !== undefined) {
            if (!Number.isInteger(value) || value < 0) blocker("invalid-project-format-version", source, ref("project", row.id));
            else if (value > maximum) blocker("unsupported-future-version", source, ref("project", row.id));
          }
        }
      }
      const sourceRows = EPHEMERAL_TABLES.has(name) ? table.sourceRows ?? rows.length : rows.length;
      if (!Number.isSafeInteger(sourceRows) || sourceRows < 0) blocker("invalid-row-count", source, ref("table", name));
      tables.set(name, { primaryKey, columns: table.columns, rows: [...byKey.values()], byKey, sourceRows });
    }
    for (const required of ["auditflow_accounts", "auditflow_projects"]) {
      if (source.status === "available" && !tables.has(required)) blocker("required-table-missing", source, ref("table", required));
    }
    indexed.set(source, tables);
  }

  const accounts = new Map();
  const accountEmails = new Map();
  for (const source of ordered) {
    for (const original of indexed.get(source).get("auditflow_accounts")?.rows || []) {
      const row = { ...original, email: String(original.email || "").trim().toLowerCase(),
        disabled: Boolean(original.disabled) };
      if (!row.user_id || !row.email || !row.password_hash || !row.password_salt) blocker("incomplete-account", source, ref("account", row.user_id));
      const item = { source, row };
      accounts.set(String(row.user_id), [...accounts.get(String(row.user_id)) || [], item]);
      accountEmails.set(row.email, [...accountEmails.get(row.email) || [], item]);
    }
  }
  for (const [userId, entries] of accounts) {
    if (new Set(entries.map(item => item.row.email)).size > 1) conflict("user-identity-collision", ["account", userId], entries);
    if (new Set(entries.map(item => canonicalData([item.row.password_hash, item.row.password_salt]))).size > 1) {
      conflict("credential-divergence", ["account", userId], entries);
    }
    if (new Set(entries.map(item => {
      const { password_hash: _, password_salt: __, ...metadata } = item.row;
      return canonicalData(metadata);
    })).size > 1) {
      conflict("account-row-divergence", ["account", userId], entries);
    }
  }
  for (const [email, entries] of accountEmails) {
    if (new Set(entries.map(item => item.row.user_id)).size > 1) conflict("email-identity-collision", ["email", email], entries);
  }
  const allTables = [...new Set(ordered.flatMap(source => [...indexed.get(source).keys()]))].sort(compare);
  for (const name of allTables.filter(name => name !== "auditflow_accounts" && !EPHEMERAL_TABLES.has(name))) {
    const keys = new Map();
    for (const source of ordered) {
      const table = indexed.get(source).get(name);
      if (!table) continue;
      for (const [key, row] of table.byKey) keys.set(key, [...keys.get(key) || [], { source, row }]);
    }
    for (const [key, entries] of keys) {
      if (new Set(entries.map(item => canonicalData(item.row))).size > 1) {
        const current = entries.find(item => item.source === target);
        const targetAhead = name === "auditflow_projects" && current && entries.some(item =>
          item.source !== target && Number.isSafeInteger(Number(item.row.revision))
          && Number.isSafeInteger(Number(current.row.revision)) && Number(current.row.revision) > Number(item.row.revision));
        conflict(name === "auditflow_projects" ? "project-revision-content-divergence" : "related-row-divergence",
          [name, key], entries, name === "auditflow_projects" ? { targetAhead: Boolean(targetAhead) } : {});
      }
    }
    const keyShapes = new Set(ordered.map(source => indexed.get(source).get(name))
      .filter(Boolean).map(table => canonicalData(table.primaryKey)));
    if (keyShapes.size > 1) for (const source of ordered.filter(source => indexed.get(source).has(name))) {
      blocker("primary-key-shape-difference", source, ref("table", name));
    }
  }
  for (const source of ordered.filter(source => source !== target)) {
    for (const [name, table] of indexed.get(source)) {
      const targetColumns = indexed.get(target).get(name)?.columns;
      if (!EPHEMERAL_TABLES.has(name) && table.columns && targetColumns
        && canonicalData(table.columns) !== canonicalData(targetColumns)) blocker("table-schema-difference", source, ref("table", name));
    }
  }
  function comparison(source, name) {
    const from = indexed.get(source).get(name);
    const to = indexed.get(target).get(name);
    let identical = 0, divergent = 0, missingFromTarget = 0, targetAhead = 0;
    for (const [key, row] of from?.byKey || []) {
      if (!to?.byKey.has(key)) missingFromTarget++;
      else if (canonicalData(row) === canonicalData(to.byKey.get(key))) identical++;
      else {
        divergent++;
        if (name === "auditflow_projects" && Number.isSafeInteger(Number(row.revision))
          && Number.isSafeInteger(Number(to.byKey.get(key).revision))
          && Number(to.byKey.get(key).revision) > Number(row.revision)) targetAhead++;
      }
    }
    return { sourceRows: from?.sourceRows || 0, targetRows: to?.sourceRows || 0, identical,
      missingFromTarget, divergent, targetOnly: [...to?.byKey.keys() || []].filter(key => !from?.byKey.has(key)).length,
      ...(from?.columns && to?.columns ? { schemaDiffersFromTarget: canonicalData(from.columns) !== canonicalData(to.columns) } : {}),
      ...(name === "auditflow_projects" ? { targetAhead } : {}) };
  }
  const sources = ordered.map(source => {
    const tables = [...indexed.get(source)].map(([name, table]) => ({
      name: tableName(name), rows: table.sourceRows, excludedFromMigration: EPHEMERAL_TABLES.has(name),
      ...(EPHEMERAL_TABLES.has(name) ? {} : { comparison: comparison(source, name) }),
    }));
    return {
      ref: sourceRef(source), version: source.version, database: source.database, port: source.port,
      status: source.status, isTarget: source === target,
      declaredSchemaVersion: source.declaredSchemaVersion ?? null, actualSchemaLedgerVerified: false,
      ...(source.status !== "available" ? { errorCode: /^[A-Z0-9_]{1,80}$/.test(source.errorCode || "") ? source.errorCode : "READ_FAILED" } : {}),
      counts: { tables: tables.length, persistentRows: tables.filter(t => !t.excludedFromMigration).reduce((n, t) => n + t.rows, 0),
        ephemeralRows: tables.filter(t => t.excludedFromMigration).reduce((n, t) => n + t.rows, 0) },
      comparison: { accounts: comparison(source, "auditflow_accounts"), projects: comparison(source, "auditflow_projects") },
      tables,
    };
  });
  const inventoryFingerprint = fingerprint(ordered.map(source => ({
    version: source.version, database: source.database, port: source.port, status: source.status,
    declaredSchemaVersion: source.declaredSchemaVersion, workspaceSchemaVersion: source.workspaceSchemaVersion,
    tables: [...indexed.get(source)].filter(([name]) => !EPHEMERAL_TABLES.has(name))
      .map(([name, table]) => ({ name, primaryKey: table.primaryKey, columns: table.columns,
        rows: table.rows.map(canonicalData).sort(compare) })),
  })));
  const hasAdditions = sources.some(source => !source.isTarget && source.tables
    .some(table => table.comparison?.missingFromTarget > 0));
  const plan = {
    format: "JEAuditFlow data upgrade preflight", formatVersion: 1, mode: "plan-and-dry-run-only",
    status: blockers.size || conflicts.size ? "blocked" : hasAdditions ? "review-required" : "no-change",
    writerImplemented: false, canWrite: false, databaseWritesPerformed: false,
    inventoryFingerprint,
    target: { ref: sourceRef(target), version: target.version, database: target.database, port: target.port,
      populated: sources.find(source => source.isTarget).counts.persistentRows > 0, protectedFromOverwrite: true },
    policy: {
      targetWrites: "never-overwrite-active-target", merge: "explicit-conflict-resolution-and-isolated-staging-required",
      credentials: "preserve-active-target-credentials-no-reset", sessions: "exclude-and-reauthenticate",
      locksAndPresence: "exclude-transient-state", unknownFields: "preserve-raw-and-review",
      formalAssessment: "preserve-scope-evidence-roles-ratings-human-review-and-closed-baselines",
      futureVersions: "reject", stalePlan: "reject-and-rescan",
    },
    supportedVersions: { targetApplication: targetVersion, maxDeclaredDatabaseSchema: maxDatabaseSchemaVersion,
      maxWorkspaceSchema: maxWorkspaceSchemaVersion, maxMetadataSnapshotVersion, orderedSchemaMigrationEngine: "not-implemented" },
    sources, conflicts: [...conflicts.values()].sort((a, b) => compare(canonicalData(a), canonicalData(b))),
    blockers: [...blockers.values()].sort((a, b) => compare(canonicalData(a), canonicalData(b))),
    phases: [
      { phase: "inventory", state: "implemented-read-only" },
      { phase: "plan-and-conflict-preview", state: "implemented-read-only" },
      { phase: "backup-and-restore-rehearsal", state: "required-not-executed" },
      { phase: "freeze-source-and-target-writes", state: "required-not-executed" },
      { phase: "stage-schema-data-and-files", state: "writer-not-implemented" },
      { phase: "verify-identity-content-relationships-files-and-login", state: "required-not-executed" },
      { phase: "switch-active-data-source", state: "not-implemented" },
      { phase: "observe-and-rollback", state: "not-implemented" },
    ],
    rollback: { beforeNewWrites: "restore-verified-prior-database-and-files-and-switch-back",
      afterNewWrites: "freeze-and-preserve-new-delta-before-a-reviewed-restore-or-forward-repair",
      automaticReverseMigration: false },
  };
  return { ...plan, checksum: planChecksum(plan) };
}
