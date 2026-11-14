#!/usr/bin/env node
import { readFile, writeFile, mkdir, cp, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { migrationFileManifest, verifyMigrationFileCopy } from "./native-migration-files.mjs";

const deploy = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.env.JEAUDITFLOW_CONFIRM_MIGRATION !== "COPY jeauditflow_760 TO jeauditflow_770") {
  throw new Error("Explicit confirmation is required: COPY jeauditflow_760 TO jeauditflow_770");
}
function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)];
  }));
}
function rowsDigest(rows) {
  const normalized = rows.map(row => JSON.stringify(Object.keys(row).sort().map(key => [
    key, Buffer.isBuffer(row[key]) ? { binary: row[key].toString("base64") } : row[key]
  ]))).sort();
  return createHash("sha256").update(normalized.join("\n")).digest("hex");
}
const sourceConfig = parseEnv(await readFile(path.join(deploy, "config/7.6.local.env"), "utf8"));
const targetConfig = parseEnv(await readFile(path.join(deploy, "config/7.7.local.env"), "utf8"));
if (sourceConfig.MYSQL_DATABASE !== "jeauditflow_760" || targetConfig.MYSQL_DATABASE !== "jeauditflow_770" ||
    targetConfig.JEAUDITFLOW_DATABASE_MODE !== "native" || sourceConfig.DB_PORT === targetConfig.DB_PORT) {
  throw new Error("Expected distinct 7.6 Docker source and 7.7 native destination");
}
const originalData = path.join(deploy, "runtime/data/7.6.0");
const newData = path.join(deploy, "runtime/data/7.7.0");
await stat(originalData);
const mysql = (await import(pathToFileURL(path.join(deploy, "runtime/versions/7.6.0/server/node_modules/mysql2/promise.js")).href)).default;
const connection = config => mysql.createConnection({
  host: "127.0.0.1", port: Number(config.DB_PORT), user: config.MYSQL_USER,
  password: config.MYSQL_PASSWORD, database: config.MYSQL_DATABASE, dateStrings: true,
  supportBigNumbers: true, bigNumberStrings: true, jsonStrings: true
});
const source = await connection(sourceConfig);
const target = await connection(targetConfig);
const backupRoot = path.join(deploy, "runtime/backups/7.6-to-7.7");
await mkdir(backupRoot, { recursive: true, mode: 0o700 });
const receiptFile = path.join(backupRoot, "migration-receipt.json");
const migrationStateFile = path.join(backupRoot, "migration-state.json");
const runId = `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`;
const runBackupRoot = path.join(backupRoot, runId);
await mkdir(runBackupRoot, { mode: 0o700 });
try {
  const existing = JSON.parse(await readFile(receiptFile, "utf8"));
  if (existing.status === "verified") {
    for (const table of existing.tables) {
      if (!/^[A-Za-z0-9_]+$/.test(table.name)) throw new Error("Invalid migration receipt table");
      const [rows] = await target.query(`SELECT * FROM \`${table.name}\``);
      if (rows.length !== table.rows || rowsDigest(rows) !== table.contentSha256) {
        throw new Error(`Destination changed: ${table.name}; refusing reimport`);
      }
    }
    console.log(JSON.stringify({ status: "already-verified", receiptFile })); process.exit(0);
  }
} catch (error) { if (error.code !== "ENOENT") throw error; }
try {
  await stat(newData);
  throw new Error("7.7 data directory already exists; refusing overwrite");
} catch (error) { if (error.code !== "ENOENT") throw error; }
const quote = name => {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error("Unsafe table/column name");
  return `\`${name}\``;
};
const [[targetCount]] = await target.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE()");
if (Number(targetCount.n)) throw new Error("Destination is not empty; refusing destructive reimport");
const tables = [];
await writeFile(migrationStateFile, `${JSON.stringify({ status: "in-progress", runId })}\n`, { mode: 0o600 });
try {
  await migrationFileManifest(originalData);
  await source.query("SET time_zone='+00:00'");
  await target.query("SET time_zone='+00:00'");
  await source.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  await source.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
  const [names] = await source.query("SHOW FULL TABLES WHERE Table_type='BASE TABLE'");
  const sourceTables = [];
  for (const entry of names) {
    const name = Object.values(entry)[0];
    const [[definition]] = await source.query(`SHOW CREATE TABLE ${quote(name)}`);
    const [rows] = await source.query(`SELECT * FROM ${quote(name)}`);
    const backupRows = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [
      key, Buffer.isBuffer(value) ? { __jeauditflowBinary: value.toString("base64") } : value
    ])));
    const serialized = JSON.stringify({ name, ddl: definition["Create Table"], rows: backupRows });
    const backupFile = path.join(runBackupRoot, `${name}.json`);
    await writeFile(backupFile, serialized, { mode: 0o600, flag: "wx" });
    sourceTables.push({ name, ddl: definition["Create Table"], rows, serialized });
  }
  await target.query("SET FOREIGN_KEY_CHECKS=0");
  for (const table of sourceTables) await target.query(table.ddl);
  await target.beginTransaction();
  for (const { name, rows, serialized } of sourceTables) {
    for (const row of rows) {
      const columns = Object.keys(row);
      const values = columns.map(key => row[key]);
      await target.query(`INSERT INTO ${quote(name)} (${columns.map(quote).join(",")}) VALUES (${columns.map(() => "?").join(",")})`, values);
    }
    const [actual] = await target.query(`SELECT * FROM ${quote(name)}`);
    const contentSha256 = rowsDigest(rows);
    if (actual.length !== rows.length || rowsDigest(actual) !== contentSha256) {
      throw new Error(`Row content mismatch in ${name}`);
    }
    tables.push({ name, rows: rows.length, contentSha256,
      backupSha256: createHash("sha256").update(serialized).digest("hex") });
  }
  await target.query("SET FOREIGN_KEY_CHECKS=1");
  await target.commit();
  await source.commit();
  const stagingData = path.join(deploy, "runtime/data", `.7.7.0-migration-${runId}`);
  await cp(originalData, stagingData, { recursive: true, force: false, errorOnExist: true });
  await cp(stagingData, newData, { recursive: true, force: false, errorOnExist: true });
  await verifyMigrationFileCopy(originalData, stagingData);
  const verifiedCopy = await verifyMigrationFileCopy(stagingData, newData);
  const copyManifest = {
    runId,
    sourceFiles: verifiedCopy
  };
  const { rename } = await import("node:fs/promises");
  await rename(stagingData, path.join(deploy, "runtime/backups/7.6-to-7.7", `${runId}-source-files`));
  const receipt = {
    status: "verified", sourceVersion: "7.6.0", targetVersion: "7.7.0",
    sourceDatabase: "jeauditflow_760", destinationDatabase: "jeauditflow_770",
    checkedAt: new Date().toISOString(), tables, fileCopy: copyManifest.sourceFiles,
    fileBackup: `${runId}-source-files`,
    sourceModified: false, dockerVolumesRemoved: false
  };
  await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  await writeFile(migrationStateFile, `${JSON.stringify({ status: "verified", runId })}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ ...receipt, receiptFile }, null, 2));
} catch (error) {
  await source.rollback().catch(() => {});
  await target.rollback().catch(() => {});
  await writeFile(migrationStateFile, `${JSON.stringify({ status: "failed", runId })}\n`, { mode: 0o600 });
  throw error;
} finally {
  await source.end(); await target.end();
}
