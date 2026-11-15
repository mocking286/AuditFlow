import test from "node:test";
import assert from "node:assert/strict";
import { summarizeColumnDifferences, buildDiagnosticSummary } from "./data-upgrade-diagnostics.mjs";

const table = rows => ({ primaryKey: ["id"], rows });

test("column diagnostics distinguish timestamp-only changes from substantive rows without exposing values", () => {
  const source = table([
    { id: "private-key-1", role: "private-old-role", updated_at: "old" },
    { id: "private-key-2", role: "same", updated_at: "old" },
    { id: "private-key-3", role: "same", created_at: "same" },
    { id: "private-key-4", role: "source-only" },
  ]);
  const target = table([
    { id: "private-key-1", role: "private-new-role", updated_at: "new" },
    { id: "private-key-2", role: "same", updated_at: "new" },
    { id: "private-key-3", role: "same", created_at: "same" },
    { id: "private-key-5", role: "target-only" },
  ]);
  const result = summarizeColumnDifferences(source, target);
  assert.deepEqual({ matched: result.matchedRows, identical: result.identicalRows,
    time: result.timestampOnlyRows, other: result.nonTimestampDifferenceRows,
    missing: result.missingFromTarget, targetOnly: result.targetOnly },
  { matched: 3, identical: 1, time: 1, other: 1, missing: 1, targetOnly: 1 });
  assert.deepEqual(result.differingColumns, [{ column: "role", rows: 1 }, { column: "updated_at", rows: 2 }]);
  assert.ok(!JSON.stringify(result).includes("private-"));
});

test("JSON values compare canonically while unknown column names are redacted", () => {
  const result = summarizeColumnDifferences(
    table([{ id: "private", record_json: '{"a":1,"b":2}', private_customer_label: "old" }]),
    table([{ id: "private", record_json: '{"b":2,"a":1}', private_customer_label: "new" }]),
  );
  assert.equal(result.nonTimestampDifferenceRows, 1);
  assert.deepEqual(result.differingColumns, [{ column: "other-columns", rows: 1 }]);
  assert.ok(!JSON.stringify(result).includes("customer"));
});

test("JSON diagnostics report known changed properties without exposing values or arbitrary property names", () => {
  const result = summarizeColumnDifferences(
    table([{ id: "private", record_json: '{"comment":"private old","date":"old","private customer property":1}' }]),
    table([{ id: "private", record_json: '{"comment":"private new","date":"new","private customer property":2}' }]),
  );
  assert.deepEqual(result.jsonColumnDifferences, [{
    column: "record_json", rows: 1, knownTopLevelProperties: [
      { property: "comment", rows: 1 }, { property: "date", rows: 1 }, { property: "other-properties", rows: 1 },
    ],
  }]);
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("semantic event matches under other primary keys are counted without inventing a mapping", () => {
  const result = summarizeColumnDifferences(
    table([{ id: 1, project_id: "private-project", change_summary: "private event", created_at: "old" }]),
    table([{ id: 2, project_id: "private-project", change_summary: "private event", created_at: "new" }]),
    { semanticIgnoreColumns: ["id", "created_at", "updated_at"] },
  );
  assert.equal(result.missingFromTarget, 1);
  assert.equal(result.semanticMatches.sourceRowsMatchingAnyTarget, 1);
  assert.equal(result.semanticMatches.sourceRowsMatchingDifferentPrimaryKey, 1);
  assert.equal(result.semanticMatches.automaticMappingAllowed, false);
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("full diagnostic summary maps schema blockers by version and reports missing identities as counts", () => {
  const snapshot = (version, rows) => ({
    version, database: `jeauditflow_${version.replaceAll(".", "")}`, port: version === "7.7.0" ? 43324 : 43318,
    status: "available", declaredSchemaVersion: version === "7.7.0" ? 29 : null,
    tables: {
      auditflow_accounts: { primaryKey: ["user_id"], rows },
      auditflow_users: { primaryKey: ["user_id"], rows: rows.map(row => ({ user_id: row.user_id })) },
      auditflow_projects: { primaryKey: ["id"], rows: [] },
      auditflow_project_members: { primaryKey: ["project_id", "user_id"],
        rows: rows.map(row => ({ project_id: "private-project", user_id: row.user_id, role: "Lead Assessor" })) },
      content_objects: { primaryKey: ["object_id"], columns: [{ name: "source_version", defaultValue: version }], rows: [] },
    },
  });
  const source = snapshot("7.1.0", [{ user_id: "private-old-id", email: "private-old@example.invalid", disabled: 0 }]);
  const target = snapshot("7.7.0", []);
  const plan = { checksum: "sha256:synthetic", inventoryFingerprint: "hmac-sha256:synthetic",
    sources: [{ version: "7.1.0", ref: "synthetic-source" }, { version: "7.7.0", ref: "synthetic-target" }],
    blockers: [{ sourceRef: "synthetic-source", code: "declared-schema-version-unavailable" }], conflicts: [] };
  const result = buildDiagnosticSummary({ snapshots: [source, target], plan, priorPlan: plan });
  assert.equal(result.missingLegacyIdentitySummary[0].accountsMissingFromTarget, 1);
  assert.equal(result.missingLegacyIdentitySummary[0].activeAccountsMissingFromTarget, 1);
  assert.equal(result.missingLegacyIdentitySummary[0].leadAssessorMembershipsMissingFromTarget, 1);
  assert.equal(result.blockersByVersion[0].version, "7.1.0");
  assert.equal(result.schemaDifferences[0].table, "content_objects");
  assert.deepEqual(result.schemaDifferences[0].columns[0].changedProperties, ["defaultValue"]);
  assert.ok(!JSON.stringify(result).includes("private-"));
  assert.equal(result.databaseWritesPerformed, false);
});
