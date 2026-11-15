#!/usr/bin/env node
import { readFile, writeFile, readdir, mkdir, lstat, open } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildUpgradePlan, assertFreshUpgradePlan, isEphemeralTable } from "./data-upgrade-plan.mjs";

const fail = code => Object.assign(new Error(code), { code });
const validVersion = value => /^\d+\.\d+\.\d+$/.test(String(value));
const identifier = value => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_]+$/.test(value)) throw fail("INVALID_SQL_IDENTIFIER");
  return `\`${value}\``;
};
const safeError = error => /^[A-Z0-9_]{1,80}$/.test(error?.code || "") ? error.code : "READ_FAILED";
const technicalIdentity = source => ({
  version: source.version, database: source.database, port: source.port,
  declaredSchemaVersion: source.declaredSchemaVersion ?? null,
});

export function parseLocalConfig(text, version) {
  if (!validVersion(version)) throw fail("INVALID_LOCAL_CONFIG");
  const values = {};
  const wanted = new Set(["MYSQL_DATABASE", "DB_PORT", "MYSQL_USER", "MYSQL_PASSWORD", "DB_HOST", "MYSQL_HOST"]);
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_]+)=(.*)$/);
    if (!match || !wanted.has(match[1])) continue;
    if (Object.hasOwn(values, match[1])) throw fail("INVALID_LOCAL_CONFIG");
    let value = match[2].trim();
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('\"') && value.endsWith('\"'))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  const port = Number(values.DB_PORT);
  if (values.MYSQL_DATABASE !== `jeauditflow_${version.replaceAll(".", "")}`
    || !Number.isInteger(port) || port < 1 || port > 65535 || !values.MYSQL_USER
    || [values.DB_HOST, values.MYSQL_HOST].some(host => host && !["127.0.0.1", "localhost", "::1"].includes(host))) {
    throw fail("INVALID_LOCAL_CONFIG");
  }
  return { version, database: values.MYSQL_DATABASE, port, user: values.MYSQL_USER, password: values.MYSQL_PASSWORD ?? "" };
}

export async function discoverDataSources(projectRoot, { versions, targetVersion = "7.7.0" } = {}) {
  if (!validVersion(targetVersion) || versions?.some(version => !validVersion(version))) throw fail("INVALID_VERSION_IDENTITY");
  const deploy = path.join(projectRoot, "local-deploy");
  const configRoot = path.join(deploy, "config");
  const names = await readdir(configRoot).catch(error => { if (error.code === "ENOENT") return []; throw error; });
  const discovered = names.map(name => name.match(/^(\d+\.\d+)(\.\d+)?\.local\.env$/))
    .filter(Boolean).map(match => `${match[1]}${match[2] || ".0"}`);
  const selected = [...new Set([...(versions || discovered), targetVersion])].sort((a, b) =>
    a.split(".").map(Number).reduce((result, value, index) => result || value - Number(b.split(".")[index]), 0));
  const sources = [];
  for (const version of selected) {
    const identity = { version, database: `jeauditflow_${version.replaceAll(".", "")}`, port: null };
    try {
      const exact = `${version}.local.env`, minor = `${version.split(".").slice(0, 2).join(".")}.local.env`;
      const configName = names.includes(exact) ? exact : names.includes(minor) && version.endsWith(".0") ? minor : null;
      if (!configName) throw fail("CONFIG_NOT_FOUND");
      const source = parseLocalConfig(await readFile(path.join(configRoot, configName), "utf8"), version);
      Object.assign(identity, technicalIdentity(source));
      const manifest = await readFile(path.join(deploy, "runtime/database", version, "manifest.json"), "utf8")
        .catch(error => { if (error.code === "ENOENT") return null; throw error; });
      let declaredSchemaVersion = null;
      if (manifest !== null) {
        let parsed;
        try { parsed = JSON.parse(manifest); } catch { throw fail("INVALID_SCHEMA_MANIFEST"); }
        declaredSchemaVersion = parsed.schemaVersion ?? null;
        if (declaredSchemaVersion !== null && (!Number.isSafeInteger(declaredSchemaVersion) || declaredSchemaVersion < 0)) throw fail("INVALID_SCHEMA_MANIFEST");
      }
      sources.push({ ...source, declaredSchemaVersion });
    } catch (error) {
      sources.push({ ...identity, status: "unavailable", errorCode: safeError(error), tables: {} });
    }
  }
  return sources;
}

export async function collectReadOnlySnapshot(source, { createConnection, maxRowsPerTable = 100000, queryTimeout = 30000 } = {}) {
  if (!validVersion(source.version) || source.database !== `jeauditflow_${source.version.replaceAll(".", "")}`
    || !Number.isInteger(source.port) || source.port < 1 || source.port > 65535) throw fail("INVALID_SOURCE_IDENTITY");
  if (!Number.isSafeInteger(maxRowsPerTable) || maxRowsPerTable < 1 || !Number.isSafeInteger(queryTimeout) || queryTimeout < 1) throw fail("INVALID_READ_LIMIT");
  const connection = await createConnection({
    host: "127.0.0.1", port: source.port, user: source.user, password: source.password, database: source.database,
    connectTimeout: 5000, multipleStatements: false, dateStrings: true, supportBigNumbers: true,
    bigNumberStrings: true, jsonStrings: true,
  });
  const query = (sql, values = []) => connection.query({ sql, timeout: queryTimeout }, values);
  let transactionStarted = false;
  try {
    await query("SET SESSION time_zone = '+00:00'");
    await query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    transactionStarted = true;
    const [names] = await query("SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.tables WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME", [source.database]);
    const tables = Object.create(null);
    for (const entry of names) {
      const name = entry.name, tableIdentifier = identifier(name);
      if (entry.engine !== "InnoDB") throw fail("UNSUPPORTED_NONTRANSACTIONAL_TABLE");
      const [columns] = await query("SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, ORDINAL_POSITION AS ordinal FROM information_schema.columns WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION", [source.database, name]);
      const [keys] = await query("SELECT COLUMN_NAME AS name FROM information_schema.key_column_usage WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION", [source.database, name]);
      const primaryKey = keys.map(key => key.name);
      const [[total]] = await query(`SELECT COUNT(*) AS count FROM ${tableIdentifier}`);
      const count = Number(total.count);
      if (!Number.isSafeInteger(count) || count < 0) throw fail("INVALID_ROW_COUNT");
      if (isEphemeralTable(name)) {
        tables[name] = { primaryKey, columns, sourceRows: count, rows: [] };
        continue;
      }
      if (count > maxRowsPerTable) throw fail("ROW_LIMIT_EXCEEDED");
      const rows = [];
      const pageSize = Math.min(1000, maxRowsPerTable);
      const order = primaryKey.length ? ` ORDER BY ${primaryKey.map(identifier).join(",")}` : "";
      for (let offset = 0; offset < count; offset += pageSize) {
        const [page] = await query(`SELECT * FROM ${tableIdentifier}${order} LIMIT ? OFFSET ?`, [pageSize, offset]);
        rows.push(...page);
      }
      if (rows.length !== count) throw fail("INCONSISTENT_SNAPSHOT_ROWS");
      tables[name] = { primaryKey, columns, rows };
    }
    return { ...technicalIdentity(source), status: "available", tables };
  } finally {
    try {
      if (transactionStarted) await connection.rollback();
    } finally {
      await connection.end();
    }
  }
}

export async function inventoryDataSources(sources, options) {
  const snapshots = [];
  for (const source of sources) {
    if (source.status === "unavailable") {
      snapshots.push({ ...technicalIdentity(source), status: "unavailable", errorCode: safeError({ code: source.errorCode }), tables: {} });
      continue;
    }
    try {
      snapshots.push(await collectReadOnlySnapshot(source, options));
    } catch (error) {
      snapshots.push({ ...technicalIdentity(source), status: "unavailable", errorCode: safeError(error), tables: {} });
    }
  }
  return snapshots;
}

export async function loadReferenceKey(filename) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  try {
    await writeFile(filename, randomBytes(32), { mode: 0o600, flag: "wx" });
  } catch (error) { if (error.code !== "EEXIST") throw error; }
  const metadata = await lstat(filename);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (metadata.mode & 0o077) || metadata.size < 32 || metadata.size > 4096) throw fail("UNSAFE_REFERENCE_KEY");
  const handle = await open(filename, "r");
  try {
    const current = await handle.stat();
    if (current.ino !== metadata.ino || current.dev !== metadata.dev) throw fail("UNSAFE_REFERENCE_KEY");
    return await handle.readFile();
  } finally { await handle.close(); }
}

export async function saveRedactedPlan(filename, plan) {
  await writeFile(filename, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600, flag: "wx" });
}

async function loadConnectionFactory(projectRoot, sources, targetVersion) {
  const versions = [...new Set([targetVersion, ...sources.map(source => source.version)])];
  for (const version of versions) {
    const modulePath = path.join(projectRoot, "local-deploy/runtime/versions", version, "server/node_modules/mysql2/promise.js");
    try {
      const mysql = (await import(pathToFileURL(modulePath).href)).default;
      return options => mysql.createConnection(options);
    } catch (error) { if (!["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"].includes(error.code)) throw fail("MYSQL_DRIVER_LOAD_FAILED"); }
  }
  throw fail("MYSQL_DRIVER_NOT_FOUND");
}

const HELP = `Read-only JEAuditFlow data upgrade inventory and plan. No migration writer exists.
Usage: node local-deploy/scripts/data-upgrade-inventory.mjs [options]
  --target VERSION       Active target application version (default 7.7.0)
  --versions V1,V2,V3     Explicit installed versions; target is always included
  --project-root PATH    Project directory containing local-deploy
  --output PATH          Write redacted JSON to a NEW file (never overwrite)
  --verify-plan PATH     Rescan and reject a stale or edited previous plan
  --key-file PATH        Private persistent HMAC key (auto-created mode 600)
  --max-rows NUMBER      Per-table hard limit (default 100000; never truncate)
  --help                 Print this help without opening the database
Exit 0: no change/review required; exit 2: blocked plan; exit 1: command error.
Default output is redacted JSON on stdout. Keep the private key for later comparisons.
`;

export async function main(argv = process.argv.slice(2)) {
  const values = {};
  const allowed = new Set(["--target", "--versions", "--project-root", "--output", "--verify-plan", "--key-file", "--max-rows"]);
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    if (option === "--help" && argv.length === 1) { process.stdout.write(HELP); return 0; }
    if (!allowed.has(option) || values[option] !== undefined || index + 1 >= argv.length || argv[index + 1].startsWith("--")) throw fail("INVALID_ARGUMENTS");
    values[option] = argv[++index];
  }
  const projectRoot = path.resolve(values["--project-root"] || path.join(path.dirname(fileURLToPath(import.meta.url)), "../.."));
  const targetVersion = values["--target"] || "7.7.0";
  const sources = await discoverDataSources(projectRoot, { targetVersion, versions: values["--versions"]?.split(",") });
  const referenceKey = await loadReferenceKey(path.resolve(values["--key-file"] || path.join(projectRoot, "local-deploy/runtime/data-upgrade/reference.key")));
  const createConnection = await loadConnectionFactory(projectRoot, sources, targetVersion);
  const snapshots = await inventoryDataSources(sources, { createConnection, maxRowsPerTable: Number(values["--max-rows"] || 100000) });
  const plan = buildUpgradePlan({ snapshots, targetVersion, referenceKey });
  if (values["--verify-plan"]) {
    let previous;
    try { previous = JSON.parse(await readFile(path.resolve(values["--verify-plan"]), "utf8")); } catch { throw fail("INVALID_PREVIOUS_PLAN"); }
    assertFreshUpgradePlan(previous, plan);
  }
  if (values["--output"]) {
    await saveRedactedPlan(path.resolve(values["--output"]), plan);
    process.stdout.write(`${JSON.stringify({ status: plan.status, databaseWritesPerformed: false, writerImplemented: false, checksum: plan.checksum, planVerified: Boolean(values["--verify-plan"]) })}\n`);
  } else process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  return plan.status === "blocked" ? 2 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`${JSON.stringify({ status: "error", code: safeError(error), databaseWritesPerformed: false })}\n`);
    process.exitCode = 1;
  });
}
