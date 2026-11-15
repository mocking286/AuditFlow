#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalData, buildUpgradePlan, isEphemeralTable } from "./data-upgrade-plan.mjs";
import { discoverDataSources, inventoryDataSources, loadReferenceKey, saveRedactedPlan } from "./data-upgrade-inventory.mjs";

const KNOWN_TABLES = new Set([
  "auditflow_accounts", "auditflow_users", "auditflow_projects", "auditflow_project_members",
  "auditflow_project_events", "auditflow_evidence_items", "auditflow_assessor_records", "auditflow_feedback",
  "auditflow_fileanalyst_attachments", "auditflow_jira_issues", "auditflow_shared_glossary", "auditflow_shared_translations",
  "auditflow_shared_findings", "auditflow_shared_finding_links", "content_objects", "content_revisions",
  "release_content", "sync_outbox", "sync_conflicts", "jiraflow_state",
]);
const KNOWN_COLUMNS = new Set([
  "id", "user_id", "email", "display_name", "password_hash", "password_salt", "disabled", "created_at", "updated_at",
  "data_dir", "project_id", "user_name", "role", "process_scopes_json", "avatar_data", "permissions_json", "permission_version",
  "record_id", "record_type", "indicators_json", "evidence_ids_json", "evidence_references", "record_json", "revision",
  "change_summary", "processes_json", "change_json", "workspace_id", "snapshot_json", "owner_id", "updated_by", "updated_by_name",
  "object_id", "object_kind", "object_key", "locale", "mime_type", "content_hash", "content_json", "content_data", "source_version",
  "is_static", "snapshot", "format_version", "state_json", "state_data", "version",
]);
const TIMES = new Set(["updated_at", "created_at"]);
const KNOWN_JSON_PROPERTIES = new Set([
  "id", "type", "title", "description", "text", "comment", "date", "createdAt", "updatedAt", "created_at", "updated_at",
  "projectId", "process", "indicator", "indicators", "code", "rating", "status", "reason", "source", "author", "user",
  "evidence", "evidenceIds", "evidenceReferences", "evidenceRole", "reviewed", "reviewerNote", "createdBy", "updatedBy",
  "metadata", "extension", "name", "assessments", "records", "runs", "logs", "revision", "ownerId", "participants",
  "baselines", "processes", "workflowModelVersion", "qualityModelVersion", "assessmentState", "instances", "workspaces",
  "traceLinks", "notepads", "guidelines", "attributes", "activeWorkspaceId", "activeInstanceId", "snapshotPolicy",
  "snapshotVersion", "workspaceFormatVersion", "payload", "defaults", "confirmations",
]);
const publicColumn = name => KNOWN_COLUMNS.has(name) ? name : "other-columns";
const publicTable = name => KNOWN_TABLES.has(name) ? name : "other-table";
function normalize(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (typeof value === "string" && (key.endsWith("_json") || key === "snapshot")) {
      try { return [key, JSON.parse(value)]; } catch { /* Preserve invalid original for comparison. */ }
    }
    return [key, value];
  }));
}
const rowKey = (row, primaryKey) => canonicalData(primaryKey.map(key => row[key]));
const without = (row, omitted) => Object.fromEntries(Object.entries(row).filter(([key]) => !omitted.has(key)));

export function summarizeColumnDifferences(source, target, { semanticIgnoreColumns } = {}) {
  const primaryKey = source?.primaryKey || target?.primaryKey || [];
  if (source && target && canonicalData(source.primaryKey) !== canonicalData(target.primaryKey)) {
    return { status: "primary-key-shape-difference", sourceRows: source.rows.length, targetRows: target.rows.length };
  }
  const from = (source?.rows || []).map(normalize), to = (target?.rows || []).map(normalize);
  const fromKeys = new Set(from.map(row => rowKey(row, primaryKey)));
  const targetByKey = new Map(to.map(row => [rowKey(row, primaryKey), row]));
  let identicalRows = 0, timestampOnlyRows = 0, nonTimestampDifferenceRows = 0, missingFromTarget = 0;
  const columns = new Map(), combinations = new Map(), jsonColumns = new Map();
  for (const row of from) {
    const other = targetByKey.get(rowKey(row, primaryKey));
    if (!other) { missingFromTarget++; continue; }
    const changed = [...new Set([...Object.keys(row), ...Object.keys(other)])]
      .filter(key => canonicalData(row[key]) !== canonicalData(other[key]));
    if (!changed.length) { identicalRows++; continue; }
    if (changed.every(key => TIMES.has(key))) timestampOnlyRows++;
    else nonTimestampDifferenceRows++;
    const visible = [...new Set(changed.map(publicColumn))].sort();
    for (const key of visible) columns.set(key, (columns.get(key) || 0) + 1);
    for (const key of changed.filter(name => name.endsWith("_json") && KNOWN_COLUMNS.has(name))) {
      const left = row[key], right = other[key];
      if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) || Array.isArray(right)) continue;
      const entry = jsonColumns.get(key) || { rows: 0, properties: new Map() };
      entry.rows++;
      const properties = [...new Set([...Object.keys(left), ...Object.keys(right)])]
        .filter(property => canonicalData(left[property]) !== canonicalData(right[property]))
        .map(property => KNOWN_JSON_PROPERTIES.has(property) ? property : "other-properties");
      for (const property of new Set(properties)) entry.properties.set(property, (entry.properties.get(property) || 0) + 1);
      jsonColumns.set(key, entry);
    }
    const combination = JSON.stringify(visible);
    combinations.set(combination, (combinations.get(combination) || 0) + 1);
  }
  let semanticMatches;
  if (semanticIgnoreColumns) {
    const omitted = new Set(semanticIgnoreColumns);
    const semantics = new Map();
    for (const row of to) {
      const key = canonicalData(without(row, omitted));
      semantics.set(key, [...semantics.get(key) || [], rowKey(row, primaryKey)]);
    }
    let sourceRowsMatchingAnyTarget = 0, sourceRowsMatchingDifferentPrimaryKey = 0;
    for (const row of from) {
      const matches = semantics.get(canonicalData(without(row, omitted))) || [];
      if (matches.length) sourceRowsMatchingAnyTarget++;
      if (matches.some(key => key !== rowKey(row, primaryKey))) sourceRowsMatchingDifferentPrimaryKey++;
    }
    semanticMatches = { ignoredColumns: semanticIgnoreColumns.map(publicColumn), sourceRowsMatchingAnyTarget,
      sourceRowsMatchingDifferentPrimaryKey, automaticMappingAllowed: false };
  }
  return {
    sourceRows: from.length, targetRows: to.length, matchedRows: from.length - missingFromTarget,
    identicalRows, timestampOnlyRows, nonTimestampDifferenceRows, missingFromTarget,
    targetOnly: to.filter(row => !fromKeys.has(rowKey(row, primaryKey))).length,
    ignoredTimestampColumns: [...TIMES],
    differingColumns: [...columns].sort(([a], [b]) => a.localeCompare(b)).map(([column, rows]) => ({ column, rows })),
    differenceCombinations: [...combinations].sort(([a], [b]) => a.localeCompare(b)).map(([value, rows]) => ({ columns: JSON.parse(value), rows })),
    ...(jsonColumns.size ? { jsonColumnDifferences: [...jsonColumns].sort(([a], [b]) => a.localeCompare(b))
      .map(([column, entry]) => ({ column, rows: entry.rows, knownTopLevelProperties: [...entry.properties]
        .sort(([a], [b]) => a.localeCompare(b)).map(([property, rows]) => ({ property, rows })) })) } : {}),
    ...(semanticMatches ? { semanticMatches } : {}),
  };
}

function schemaDifferences(source, target) {
  const result = [];
  for (const [name, table] of Object.entries(source.tables || {})) {
    const other = target.tables?.[name];
    if (!table.columns || !other?.columns || isEphemeralTable(name)) continue;
    const targetColumns = new Map(other.columns.map(column => [column.name, column]));
    const columns = [];
    for (const column of table.columns) {
      const current = targetColumns.get(column.name);
      if (!current) { columns.push({ column: publicColumn(column.name), sourceOnly: true }); continue; }
      const changedProperties = ["dataType", "columnType", "nullable", "defaultValue", "extra", "ordinal"]
        .filter(key => canonicalData(column[key]) !== canonicalData(current[key]));
      if (changedProperties.length) columns.push({ column: publicColumn(column.name), changedProperties });
    }
    for (const column of other.columns) if (!table.columns.some(item => item.name === column.name)) {
      columns.push({ column: publicColumn(column.name), targetOnly: true });
    }
    if (columns.length) result.push({ version: source.version, table: publicTable(name),
      sourceRows: table.rows.length, targetRows: other.rows.length, columns });
  }
  return result;
}

export function buildDiagnosticSummary({ snapshots, plan, priorPlan, targetVersion = "7.7.0" }) {
  const target = snapshots.find(source => source.version === targetVersion);
  if (!target || snapshots.some(source => source.status !== "available")) throw Object.assign(new Error("INCOMPLETE_DIAGNOSTIC_INVENTORY"), { code: "INCOMPLETE_DIAGNOSTIC_INVENTORY" });
  const legacy = snapshots.filter(source => source !== target);
  const comparisons = legacy.map(source => ({
    version: source.version, tables: Object.entries(source.tables)
      .filter(([name, table]) => !isEphemeralTable(name) && (table.rows.length || target.tables[name]?.rows.length)).map(([name, table]) => ({
      table: publicTable(name), ...summarizeColumnDifferences(table, target.tables[name],
        name === "auditflow_project_events" ? { semanticIgnoreColumns: ["id", "created_at", "updated_at"] } : {}),
    })),
  }));
  const targetAccounts = target.tables.auditflow_accounts?.rows || [];
  const targetAccountIds = new Set(targetAccounts.map(row => row.user_id));
  const targetEmails = new Set(targetAccounts.map(row => String(row.email).trim().toLowerCase()));
  const targetMemberKeys = new Set((target.tables.auditflow_project_members?.rows || []).map(row =>
    canonicalData([row.project_id, row.user_id])));
  const missingLegacyIdentitySummary = legacy.map(source => {
    const missing = (source.tables.auditflow_accounts?.rows || []).filter(row => !targetAccountIds.has(row.user_id));
    const missingIds = new Set(missing.map(row => row.user_id));
    const missingMembers = (source.tables.auditflow_project_members?.rows || [])
      .filter(row => !targetMemberKeys.has(canonicalData([row.project_id, row.user_id])));
    return {
      version: source.version, accountsMissingFromTarget: missing.length,
      activeAccountsMissingFromTarget: missing.filter(row => !Number(row.disabled)).length,
      missingAccountsWithEmailCollision: missing.filter(row => targetEmails.has(String(row.email).trim().toLowerCase())).length,
      userProfilesMissingFromTarget: (source.tables.auditflow_users?.rows || [])
        .filter(row => !(target.tables.auditflow_users?.rows || []).some(current => current.user_id === row.user_id)).length,
      membershipsMissingFromTarget: missingMembers.length,
      missingMembershipsForMissingAccounts: missingMembers.filter(row => missingIds.has(row.user_id)).length,
      leadAssessorMembershipsMissingFromTarget: missingMembers.filter(row =>
        String(row.role).replace(/[\s_-]/g, "").toLowerCase() === "leadassessor").length,
      automaticImportAllowed: false,
    };
  });
  const sourceVersion = new Map(plan.sources.map(source => [source.ref, source.version]));
  const blockersByVersion = plan.blockers.map(blocker => ({ version: sourceVersion.get(blocker.sourceRef), code: blocker.code }));
  return {
    product: "JEAuditFlow", applicationVersion: targetVersion, formatVersion: 1,
    mode: "read-only-diagnostic-summary", generatedAt: new Date().toISOString(),
    databaseWritesPerformed: false, migrationPerformed: false, writerImplemented: false,
    redaction: "counts-and-known-technical-names-only-no-row-values-identities-emails-or-credentials",
    matchesPriorPersistentInventory: priorPlan ? priorPlan.inventoryFingerprint === plan.inventoryFingerprint : null,
    inventoryFingerprint: plan.inventoryFingerprint, planChecksum: plan.checksum,
    priorPlanChecksum: priorPlan?.checksum ?? null,
    targetPolicy: "preserve-active-target-credentials-project-revisions-business-records-and-new-events",
    snapshots: snapshots.map(source => ({ version: source.version, tables: Object.keys(source.tables).length,
      declaredSchemaVersion: source.declaredSchemaVersion,
      accounts: source.tables.auditflow_accounts?.rows.length || 0, projects: source.tables.auditflow_projects?.rows.length || 0,
      members: source.tables.auditflow_project_members?.rows.length || 0, assessorRecords: source.tables.auditflow_assessor_records?.rows.length || 0,
      events: source.tables.auditflow_project_events?.rows.length || 0 })),
    blockersByVersion, schemaDifferences: legacy.flatMap(source => schemaDifferences(source, target)),
    missingLegacyIdentitySummary, comparisons,
    interpretation: {
      timestampOnly: "top-level-created_at-and-updated_at-only-canonical-JSON-compared",
      semanticEventMatches: "diagnostic-only-not-an-identity-or-migration-mapping",
      nonTimestampDifferences: "require-preserving-active-target-and-reviewed-source-archives-or-explicit-resolution",
      schemaVersionDeclaration: "package-manifest-not-verified-schema-migration-ledger",
      crossDatabaseSnapshot: "independent-consistent-read-only-snapshots-not-global-atomic-freeze",
    },
  };
}

async function main() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const [priorFile, outputFile] = process.argv.slice(2);
  if (!priorFile || !outputFile || process.argv.length !== 4) throw Object.assign(new Error("USAGE_PRIOR_PLAN_OUTPUT"), { code: "USAGE_PRIOR_PLAN_OUTPUT" });
  const sources = await discoverDataSources(projectRoot, { versions: ["7.1.0", "7.6.0", "7.7.0"], targetVersion: "7.7.0" });
  const mysql = (await import(pathToFileURL(path.join(projectRoot, "local-deploy/runtime/versions/7.7.0/server/node_modules/mysql2/promise.js")).href)).default;
  const snapshots = await inventoryDataSources(sources, { createConnection: options => mysql.createConnection(options) });
  const referenceKey = await loadReferenceKey(path.join(projectRoot, "local-deploy/runtime/data-upgrade/reference.key"));
  const plan = buildUpgradePlan({ snapshots, referenceKey });
  const priorPlan = JSON.parse(await readFile(priorFile, "utf8"));
  const summary = buildDiagnosticSummary({ snapshots, plan, priorPlan });
  await saveRedactedPlan(outputFile, summary);
  process.stdout.write(`${JSON.stringify({ status: "diagnosed", databaseWritesPerformed: false,
    matchesPriorPersistentInventory: summary.matchesPriorPersistentInventory,
    snapshots: summary.snapshots, blockersByVersion: summary.blockersByVersion,
    schemaDifferences: summary.schemaDifferences, missingLegacyIdentitySummary: summary.missingLegacyIdentitySummary })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: "error", code: /^[A-Z0-9_]{1,80}$/.test(error?.code || "") ? error.code : "DIAGNOSTIC_FAILED", databaseWritesPerformed: false })}\n`);
    process.exitCode = 1;
  });
}
