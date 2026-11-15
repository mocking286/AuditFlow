import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile, chmod, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  parseLocalConfig, discoverDataSources, collectReadOnlySnapshot, inventoryDataSources,
  loadReferenceKey, saveRedactedPlan,
} from "./data-upgrade-inventory.mjs";

const source = {
  version: "7.7.0", database: "jeauditflow_770", port: 43324,
  user: "private-user", password: "private-password", declaredSchemaVersion: 29,
};
async function temporary(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-upgrade-test-"));
  try { return await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
function fakeConnection({ overLimit = false, failRows = false, includeEphemeral = false } = {}) {
  const queries = [];
  const connection = {
    async query(query, values) {
      const sql = typeof query === "string" ? query : query.sql;
      queries.push({ sql, values });
      if (sql.includes("information_schema.tables")) return [[
        { name: "auditflow_accounts", engine: "InnoDB" }, { name: "auditflow_projects", engine: "InnoDB" },
        ...(includeEphemeral ? [{ name: "auditflow_sessions", engine: "InnoDB" },
          { name: "auditflow_project_locks", engine: "InnoDB" }, { name: "auditflow_project_presence", engine: "InnoDB" }] : []),
      ]];
      if (sql.includes("information_schema.columns")) return [[
        { name: "id", dataType: "varchar", columnType: "varchar(128)", nullable: "NO", defaultValue: null, extra: "", ordinal: 1 },
      ]];
      if (sql.includes("information_schema.key_column_usage")) return [[{ name: "id" }]];
      if (sql.startsWith("SELECT COUNT(*)")) return [[{ count: overLimit ? 3 : 1 }]];
      if (sql.startsWith("SELECT *")) {
        if (failRows) throw Object.assign(new Error("private-password leaked by server"), { code: "ER_SYNTHETIC_FAILURE" });
        return [[{ id: "opaque-id", password_hash: "private-digest" }]];
      }
      return [[]];
    },
    async rollback() { queries.push({ sql: "ROLLBACK" }); },
    async end() { queries.push({ sql: "END" }); },
  };
  return { connection, queries };
}

test("config parsing never evaluates shell text and rejects invalid identity or remote hosts", () => {
  const config = parseLocalConfig("MYSQL_DATABASE=jeauditflow_770\nDB_PORT=43324\nMYSQL_USER=user\nMYSQL_PASSWORD=$(touch /tmp/not-executed)\n", "7.7.0");
  assert.equal(config.password, "$(touch /tmp/not-executed)");
  assert.equal(config.database, "jeauditflow_770");
  for (const text of [
    "MYSQL_DATABASE=jeauditflow_760\nDB_PORT=43324\nMYSQL_USER=user",
    "MYSQL_DATABASE=jeauditflow_770\nDB_PORT=43324\nMYSQL_USER=user\nDB_HOST=evil.invalid",
    "MYSQL_DATABASE=jeauditflow_770\nDB_PORT=NaN\nMYSQL_USER=user",
    "MYSQL_DATABASE=jeauditflow_770\nDB_PORT=43324\nDB_PORT=43325\nMYSQL_USER=user",
  ]) assert.throws(() => parseLocalConfig(text, "7.7.0"), { code: "INVALID_LOCAL_CONFIG" });
});

test("source discovery prefers exact config over minor config and reads declared manifest version", async () => {
  await temporary(async root => {
    await mkdir(path.join(root, "local-deploy/config"), { recursive: true });
    await mkdir(path.join(root, "local-deploy/runtime/database/7.7.0"), { recursive: true });
    const config = port => `MYSQL_DATABASE=jeauditflow_770\nDB_PORT=${port}\nMYSQL_USER=local\nMYSQL_PASSWORD=secret\n`;
    await writeFile(path.join(root, "local-deploy/config/7.7.local.env"), config(43323));
    await writeFile(path.join(root, "local-deploy/config/7.7.0.local.env"), config(43324));
    await writeFile(path.join(root, "local-deploy/runtime/database/7.7.0/manifest.json"), '{"schemaVersion":29}');
    const sources = await discoverDataSources(root, { versions: ["7.7.0"] });
    assert.equal(sources.length, 1);
    assert.equal(sources[0].port, 43324);
    assert.equal(sources[0].declaredSchemaVersion, 29);
  });
});

test("requested missing source remains visible as unavailable and target is always included", async () => {
  await temporary(async root => {
    const sources = await discoverDataSources(root, { versions: ["7.1.0"], targetVersion: "7.7.0" });
    assert.deepEqual(sources.map(item => item.version), ["7.1.0", "7.7.0"]);
    assert.ok(sources.every(item => item.status === "unavailable" && item.errorCode === "CONFIG_NOT_FOUND"));
  });
});

test("collector uses only read-only transaction metadata and selects then rolls back and closes", async () => {
  const { connection, queries } = fakeConnection();
  let options;
  const result = await collectReadOnlySnapshot(source, { createConnection: async value => { options = value; return connection; } });
  assert.equal(result.status, "available");
  assert.equal(result.tables.auditflow_projects.rows.length, 1);
  assert.equal(options.host, "127.0.0.1");
  assert.equal(options.multipleStatements, false);
  assert.ok(queries.some(item => item.sql === "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY"));
  assert.deepEqual(queries.slice(-2).map(item => item.sql), ["ROLLBACK", "END"]);
  assert.ok(queries.every(item => /^(SET |START TRANSACTION|SELECT |ROLLBACK$|END$)/.test(item.sql)));
  assert.ok(queries.every(item => !/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|COMMIT)\b/.test(item.sql)));
});

test("collector aborts on row limit without reading a truncated table and always cleans up", async () => {
  const { connection, queries } = fakeConnection({ overLimit: true });
  await assert.rejects(collectReadOnlySnapshot(source, { createConnection: async () => connection, maxRowsPerTable: 2 }),
    { code: "ROW_LIMIT_EXCEEDED" });
  assert.ok(!queries.some(item => item.sql.startsWith("SELECT *")));
  assert.deepEqual(queries.slice(-2).map(item => item.sql), ["ROLLBACK", "END"]);
});

test("collector closes and rolls back after a select fails", async () => {
  const { connection, queries } = fakeConnection({ failRows: true });
  await assert.rejects(collectReadOnlySnapshot(source, { createConnection: async () => connection }), { code: "ER_SYNTHETIC_FAILURE" });
  assert.deepEqual(queries.slice(-2).map(item => item.sql), ["ROLLBACK", "END"]);
});

test("excluded session, presence and lock tables are counted without loading any row fields", async () => {
  const { connection, queries } = fakeConnection({ includeEphemeral: true });
  const result = await collectReadOnlySnapshot(source, { createConnection: async () => connection });
  for (const name of ["auditflow_sessions", "auditflow_project_locks", "auditflow_project_presence"]) {
    assert.equal(result.tables[name].sourceRows, 1);
    assert.deepEqual(result.tables[name].rows, []);
    assert.ok(!queries.some(item => item.sql.startsWith(`SELECT * FROM \`${name}\``)));
  }
});
test("inventory sanitizes database errors and never emits source credentials", async () => {
  const snapshots = await inventoryDataSources([source], {
    createConnection: async () => { throw Object.assign(new Error("password=private-password"), { code: "ECONNREFUSED" }); },
  });
  assert.equal(snapshots[0].status, "unavailable");
  assert.equal(snapshots[0].errorCode, "ECONNREFUSED");
  assert.ok(!JSON.stringify(snapshots).includes("private-password"));
  assert.ok(!JSON.stringify(snapshots).includes("private-user"));
});

test("private reference key is stable and rejects unsafe existing permissions or symlink", async () => {
  await temporary(async root => {
    const file = path.join(root, "private/reference.key");
    const first = await loadReferenceKey(file), second = await loadReferenceKey(file);
    assert.equal(first.length, 32);
    assert.deepEqual(first, second);
    await chmod(file, 0o644);
    await assert.rejects(loadReferenceKey(file), { code: "UNSAFE_REFERENCE_KEY" });
    const link = path.join(root, "key-link");
    await symlink(file, link);
    await assert.rejects(loadReferenceKey(link), { code: "UNSAFE_REFERENCE_KEY" });
  });
});

test("redacted output refuses overwrite and contains only explicit plan data", async () => {
  await temporary(async root => {
    const file = path.join(root, "plan.json");
    await saveRedactedPlan(file, { status: "blocked", databaseWritesPerformed: false });
    assert.equal(JSON.parse(await readFile(file, "utf8")).status, "blocked");
    await assert.rejects(saveRedactedPlan(file, { status: "other" }), { code: "EEXIST" });
  });
});

test("CLI help is available without connecting to a database or creating a private key", () => {
  const run = spawnSync(process.execPath, [new URL("./data-upgrade-inventory.mjs", import.meta.url).pathname, "--help"], { encoding: "utf8" });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /--verify-plan/);
  assert.match(run.stdout, /Read-only/);
  assert.equal(run.stderr, "");
});
