import test from "node:test";
import assert from "node:assert/strict";
import { buildUpgradePlan, assertFreshUpgradePlan, canonicalData } from "./data-upgrade-plan.mjs";

const referenceKey = Buffer.alloc(32, 23);
const account = (changes = {}) => ({
  user_id: "synthetic-user", email: "private-user@example.invalid", display_name: "Synthetic User",
  password_hash: "synthetic-password-digest", password_salt: "synthetic-password-salt",
  disabled: 0, ...changes,
});
const project = (changes = {}) => ({
  id: "PRIVATE-PROJECT", revision: 7, owner_id: "synthetic-user",
  snapshot_json: JSON.stringify({ id: "PRIVATE-PROJECT", name: "Private Project Text", records: [],
    extension: { preserved: true } }), ...changes,
});
function snapshot(version, changes = {}) {
  return {
    version, database: `jeauditflow_${version.replaceAll(".", "")}`, port: version === "7.7.0" ? 43324 : 43318,
    status: "available", declaredSchemaVersion: 29,
    tables: {
      auditflow_accounts: { primaryKey: ["user_id"], rows: [account()] },
      auditflow_projects: { primaryKey: ["id"], rows: [project()] },
      auditflow_project_members: { primaryKey: ["project_id", "user_id"], rows: [] },
      auditflow_sessions: { primaryKey: ["token_hash"], rows: [{ token_hash: "private-session-token", user_id: "synthetic-user" }] },
      auditflow_project_locks: { primaryKey: ["id"], rows: [] },
      auditflow_project_presence: { primaryKey: ["project_id", "user_id"], rows: [] },
    }, ...changes,
  };
}
function plan(snapshots, options = {}) {
  return buildUpgradePlan({ snapshots, targetVersion: "7.7.0", referenceKey, ...options });
}

test("identical accounts and projects produce a non-writing no-change plan with opaque output", () => {
  const result = plan([snapshot("7.1.0"), snapshot("7.7.0")]);
  assert.equal(result.status, "no-change");
  assert.equal(result.writerImplemented, false);
  assert.equal(result.canWrite, false);
  assert.equal(result.target.protectedFromOverwrite, true);
  assert.equal(result.sources[0].comparison.accounts.identical, 1);
  assert.equal(result.sources[0].comparison.projects.identical, 1);
  const serialized = JSON.stringify(result);
  for (const secret of ["synthetic-user", "private-user@", "Synthetic User", "password-digest", "password-salt",
    "PRIVATE-PROJECT", "Private Project Text", "private-session-token"]) assert.ok(!serialized.includes(secret));
  assert.equal(result.policy.sessions, "exclude-and-reauthenticate");
});

test("missing legacy records are proposed as additions without modifying populated target or inputs", () => {
  const source = snapshot("7.1.0");
  source.tables.auditflow_accounts.rows.push(account({ user_id: "legacy-only", email: "legacy@example.invalid" }));
  source.tables.auditflow_projects.rows.push(project({ id: "LEGACY-ONLY", revision: 3 }));
  const target = snapshot("7.7.0");
  target.tables.auditflow_projects.rows.push(project({ id: "NEW-IN-770", revision: 12 }));
  const before = canonicalData([source, target]);
  const result = plan([source, target]);
  assert.equal(result.status, "review-required");
  assert.equal(result.sources[0].comparison.accounts.missingFromTarget, 1);
  assert.equal(result.sources[0].comparison.projects.missingFromTarget, 1);
  assert.equal(result.sources[0].comparison.projects.targetOnly, 1);
  assert.equal(result.canWrite, false);
  assert.equal(canonicalData([source, target]), before);
});

test("same email with different identity blocks a merge and emits only stable opaque references", () => {
  const source = snapshot("7.1.0");
  source.tables.auditflow_accounts.rows[0].user_id = "different-old-user";
  const result = plan([source, snapshot("7.7.0")]);
  assert.equal(result.status, "blocked");
  assert.ok(result.conflicts.some(c => c.code === "email-identity-collision"));
  assert.ok(result.conflicts.every(c => c.ref.startsWith("ref-")));
  assert.ok(!JSON.stringify(result).includes("different-old-user"));
});

test("same user identity with different email blocks rather than guessing an account mapping", () => {
  const source = snapshot("7.1.0");
  source.tables.auditflow_accounts.rows[0].email = "changed@example.invalid";
  const result = plan([source, snapshot("7.7.0")]);
  assert.ok(result.conflicts.some(c => c.code === "user-identity-collision"));
  assert.equal(result.status, "blocked");
});

test("credential divergence blocks without exposing credential material or selecting an old password", () => {
  const source = snapshot("7.1.0");
  source.tables.auditflow_accounts.rows[0].password_hash = "older-credential-digest";
  const result = plan([source, snapshot("7.7.0")]);
  const credentialConflict = result.conflicts.find(c => c.code === "credential-divergence");
  assert.equal(credentialConflict.classification, "target-authoritative");
  assert.equal(credentialConflict.proposedResolution, "preserve-active-target-credentials");
  assert.equal(result.policy.credentials, "preserve-active-target-credentials-no-reset");
  assert.equal(result.sources[0].comparison.accounts.missingFromTarget, 0);
  assert.equal(result.status, "blocked");
  assert.ok(!JSON.stringify(result).includes("older-credential-digest"));
});

test("divergent legacy sources conflict even when the target lacks the identity", () => {
  const sourceA = snapshot("7.1.0");
  const sourceB = snapshot("7.6.0");
  sourceB.tables.auditflow_accounts.rows[0].disabled = 1;
  const target = snapshot("7.7.0");
  target.tables.auditflow_accounts.rows = [];
  const result = plan([sourceA, sourceB, target]);
  assert.ok(result.conflicts.some(c => c.code === "account-row-divergence"));
  assert.equal(result.status, "blocked");
});

test("a project updated in active 770 blocks automatic replacement of its revision or content", () => {
  const target = snapshot("7.7.0");
  target.tables.auditflow_projects.rows[0].revision = 8;
  target.tables.auditflow_projects.rows[0].snapshot_json = JSON.stringify({ name: "New target edits", records: [{ reviewed: true }] });
  const result = plan([snapshot("7.1.0"), target]);
  const projectConflict = result.conflicts.find(c => c.code === "project-revision-content-divergence");
  assert.equal(projectConflict.proposedResolution, "preserve-active-target");
  assert.equal(projectConflict.targetAhead, true);
  assert.equal(result.sources[0].comparison.projects.targetAhead, 1);
  assert.equal(result.sources[0].comparison.projects.missingFromTarget, 0);
  assert.equal(result.status, "blocked");
});

test("event, member and assessor additions compare actual keys rather than equal row totals", () => {
  const source = snapshot("7.1.0"), target = snapshot("7.7.0");
  for (const name of ["auditflow_project_events", "auditflow_project_members", "auditflow_assessor_records"]) {
    source.tables[name] = { primaryKey: ["id"], rows: [{ id: "legacy-only", payload: "private old row" }] };
    target.tables[name] = { primaryKey: ["id"], rows: [{ id: "target-only", payload: "private new row" }] };
  }
  const result = plan([source, target]);
  assert.equal(result.status, "review-required");
  for (const name of ["auditflow_project_events", "auditflow_project_members", "auditflow_assessor_records"]) {
    const comparison = result.sources[0].tables.find(table => table.name === name).comparison;
    assert.equal(comparison.missingFromTarget, 1);
    assert.equal(comparison.targetOnly, 1);
    assert.equal(comparison.divergent, 0);
  }
  assert.ok(!JSON.stringify(result).includes("private old row"));
});

test("canonical JSON comparison ignores object property order and preserves unknown fields", () => {
  const source = snapshot("7.1.0");
  const target = snapshot("7.7.0");
  source.tables.auditflow_projects.rows[0].snapshot_json = '{"name":"x","extension":{"b":2,"a":1}}';
  target.tables.auditflow_projects.rows[0].snapshot_json = '{"extension":{"a":1,"b":2},"name":"x"}';
  assert.equal(plan([source, target]).status, "no-change");
  target.tables.auditflow_projects.rows[0].snapshot_json = '{"extension":{"a":1,"b":3},"name":"x"}';
  assert.equal(plan([source, target]).status, "blocked");
});

test("unknown columns affect compatibility and stale fingerprints rather than being silently dropped", () => {
  const source = snapshot("7.1.0");
  const target = snapshot("7.7.0");
  source.tables.auditflow_accounts.rows[0].future_extension = { keep: "opaque user metadata" };
  const result = plan([source, target]);
  assert.ok(result.conflicts.some(c => c.code === "account-row-divergence"));
  assert.equal(result.policy.unknownFields, "preserve-raw-and-review");
  assert.ok(!JSON.stringify(result).includes("opaque user metadata"));
});

test("empty-table schema differences block and schema metadata participates in stale checks", () => {
  const source = snapshot("7.1.0"), target = snapshot("7.7.0");
  source.tables.auditflow_project_members.columns = [{ name: "project_id", columnType: "varchar(128)" }];
  target.tables.auditflow_project_members.columns = [{ name: "project_id", columnType: "varchar(255)" }];
  const result = plan([source, target]);
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.some(blocker => blocker.code === "table-schema-difference"));
  assert.equal(result.sources[0].tables.find(table => table.name === "auditflow_project_members").comparison.schemaDiffersFromTarget, true);
  const previous = plan([source, target]);
  target.tables.auditflow_project_members.columns[0].columnType = "varchar(512)";
  assert.throws(() => assertFreshUpgradePlan(previous, plan([source, target])), { code: "STALE_UPGRADE_PLAN" });
});

test("future app, database or workspace schema versions block the plan", () => {
  const futureApp = snapshot("7.8.0");
  const futureDatabase = snapshot("7.6.0", { declaredSchemaVersion: 30 });
  const futureWorkspace = snapshot("7.1.0");
  futureWorkspace.tables.auditflow_projects.rows[0].snapshot_json = '{"workspaceFormatVersion":62}';
  const futureMetadata = snapshot("7.1.0");
  futureMetadata.tables.auditflow_projects.rows[0].snapshot_json = '{"snapshotPolicy":"metadata-only","snapshotVersion":3}';
  for (const source of [futureApp, futureDatabase, futureWorkspace, futureMetadata]) {
    const result = plan([source, snapshot("7.7.0")]);
    assert.equal(result.status, "blocked");
    assert.ok(result.blockers.some(b => b.code === "unsupported-future-version"));
  }
});

test("business ordinals and unrelated extension versions do not trigger future-format rejection", () => {
  const source = snapshot("7.1.0"), target = snapshot("7.7.0");
  const json = JSON.stringify({ version: 77, revision: 100, schemaVersion: "custom/v900",
    snapshotVersion: 999, databaseVersion: 999, workspaceVersion: 999, dataSchemaVersion: 999 });
  source.tables.auditflow_projects.rows[0].snapshot_json = json;
  target.tables.auditflow_projects.rows[0].snapshot_json = json;
  assert.equal(plan([source, target]).status, "no-change");
});

test("missing or unreadable source and absent active target fail closed", () => {
  const unreadable = snapshot("7.1.0", { status: "unavailable", errorCode: "ECONNREFUSED", tables: {} });
  assert.equal(plan([unreadable, snapshot("7.7.0")]).status, "blocked");
  assert.throws(() => plan([snapshot("7.1.0")]), { code: "TARGET_NOT_FOUND" });
});

test("sessions, locks and presence are excluded from change decisions but remain counted", () => {
  const source = snapshot("7.1.0");
  source.tables.auditflow_sessions.rows.push({ token_hash: "different-private-token", user_id: "synthetic-user" });
  source.tables.auditflow_project_locks.rows.push({ id: "old-lock", acquired_at: "2026-01-01" });
  const result = plan([source, snapshot("7.7.0")]);
  assert.equal(result.status, "no-change");
  assert.equal(result.sources[0].tables.find(t => t.name === "auditflow_sessions").excludedFromMigration, true);
  assert.equal(result.sources[0].counts.ephemeralRows, 3);
});

test("count-only ephemeral snapshots preserve aggregate counts without requiring token rows", () => {
  const source = snapshot("7.1.0");
  source.tables.auditflow_sessions = { primaryKey: ["token_hash"], rows: [], sourceRows: 19 };
  const result = plan([source, snapshot("7.7.0")]);
  assert.equal(result.status, "no-change");
  assert.equal(result.sources[0].counts.ephemeralRows, 19);
  assert.equal(result.sources[0].tables.find(table => table.name === "auditflow_sessions").rows, 19);
});

test("repeat scans and input ordering yield identical plan checksum and opaque references", () => {
  const source = snapshot("7.1.0");
  source.tables.auditflow_accounts.rows.push(account({ user_id: "two", email: "two@example.invalid" }));
  const target = snapshot("7.7.0");
  const first = plan([source, target]);
  source.tables.auditflow_accounts.rows.reverse();
  const second = plan([target, source]);
  assert.equal(first.checksum, second.checksum);
  assert.deepEqual(first, second);
});

test("stale fingerprint or edited plan is rejected before any future writer could be called", () => {
  const snapshots = [snapshot("7.1.0"), snapshot("7.7.0")];
  const first = plan(snapshots);
  assert.doesNotThrow(() => assertFreshUpgradePlan(first, plan(snapshots)));
  snapshots[1].tables.auditflow_projects.rows[0].revision = 9;
  assert.throws(() => assertFreshUpgradePlan(first, plan(snapshots)), { code: "STALE_UPGRADE_PLAN" });
  const tampered = structuredClone(first);
  tampered.target.port = 43399;
  assert.throws(() => assertFreshUpgradePlan(tampered, first), { code: "INVALID_PLAN_CHECKSUM" });
});

test("rows without usable keys and duplicate source primary keys block instead of losing records", () => {
  const source = snapshot("7.1.0");
  source.tables.custom_opaque_table = { primaryKey: [], rows: [{ value: "private custom value" }] };
  source.tables.auditflow_projects.rows.push(project());
  const result = plan([source, snapshot("7.7.0")]);
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.some(b => b.code === "missing-primary-key"));
  assert.ok(result.blockers.some(b => b.code === "duplicate-primary-key"));
  assert.ok(!JSON.stringify(result).includes("private custom value"));
});
