#!/usr/bin/env node
// Database helper for the JEAuditFlow 7.9.5 macOS launcher.
//
//   tableplus             TablePlus Connections.plist as XML on stdin -> local MySQL candidates (TSV)
//   ping                  exit 0 when DB_USER can log in, 3 when the server is unreachable, 4 when access is denied
//   inspect               print database=, schema= and admin= flags for DB_NAME / ADMIN_EMAIL
//   create-database       create DB_NAME (utf8mb4) if it does not exist
//   apply-schema <dir>    run <dir>/*.sql against DB_NAME; refuses statements that drop or change data
//   provision             launcher-owned MySQL only: create DB_NAME, APP_USER and set a root password
//   urls                  print mysql= and jdbc= connection URLs for the services
//
// Connection settings and secrets are read from the environment (DB_HOST,
// DB_PORT, DB_USER, DB_PASSWORD, DB_NAME), never from argv, so they do not
// appear in the process list. mysql2 is loaded from the installed API server.

import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION_DATABASE = "jeauditflow_795";
export const DEDICATED_PORT = 43327;
const IDENTIFIER = /^[A-Za-z0-9_]{1,64}$/;
const LOOPBACK_HOSTS = new Set(["", "localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const UNREACHABLE = new Set(["ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH", "ENOTFOUND", "ECONNRESET", "PROTOCOL_CONNECTION_LOST"]);
const DENIED = new Set(["ER_ACCESS_DENIED_ERROR", "ER_DBACCESS_DENIED_ERROR", "ER_TABLEACCESS_DENIED_ERROR", "ER_SPECIFIC_ACCESS_DENIED_ERROR", "ER_NOT_SUPPORTED_AUTH_MODE"]);
const DESTRUCTIVE_SQL = /\b(drop|truncate|rename\s+table|delete\s+from|alter\s+table|update\s+`?\w+`?\s+set|replace\s+into)\b/i;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

const asText = value => typeof value === "string" ? value : value == null ? "" : String(value);
const truthy = value => value === true || value === 1 || /^(1|true|yes)$/i.test(asText(value).trim());
const decodeEntities = text => text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity) => {
  if (entity[0] !== "#") return ENTITIES[entity] ?? match;
  return String.fromCodePoint(entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10));
});

// Minimal reader for the XML produced by `plutil -convert xml1`.
export function parsePlistXml(xml) {
  const tokens = String(xml)
    .replace(/<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<!--[\s\S]*?-->/g, "")
    .match(/<[^>]+>|[^<]+/g) || [];
  let index = 0;
  const peek = () => {
    while (index < tokens.length && !tokens[index].startsWith("<") && !tokens[index].trim()) index++;
    return tokens[index];
  };
  const take = () => {
    const token = peek();
    index++;
    return token;
  };
  const textUntil = closing => {
    let text = "";
    while (index < tokens.length && tokens[index] !== closing) text += tokens[index++];
    if (tokens[index++] !== closing) throw new Error(`Malformed plist: missing ${closing}`);
    return decodeEntities(text);
  };
  const value = () => {
    const tag = take();
    if (tag === undefined) throw new Error("Malformed plist: unexpected end");
    const empty = /^<(\w+)\s*\/>$/.exec(tag);
    if (empty) return { true: true, false: false, string: "", data: "", date: "", dict: {}, array: [] }[empty[1]] ?? null;
    const open = /^<(\w+)(?:\s[^>]*)?>$/.exec(tag);
    if (!open) throw new Error(`Malformed plist near ${tag.slice(0, 40)}`);
    const name = open[1];
    if (name === "plist") {
      const result = peek() === "</plist>" ? null : value();
      if (take() !== "</plist>") throw new Error("Malformed plist: missing </plist>");
      return result;
    }
    if (name === "dict") {
      const result = {};
      while (peek() !== "</dict>") {
        if (take() !== "<key>") throw new Error("Malformed plist: expected <key>");
        const key = textUntil("</key>");
        result[key] = value();
      }
      take();
      return result;
    }
    if (name === "array") {
      const result = [];
      while (peek() !== "</array>") result.push(value());
      take();
      return result;
    }
    const raw = textUntil(`</${name}>`);
    if (name === "integer" || name === "real") return Number(raw.trim());
    if (name === "true" || name === "false") return name === "true";
    return raw;
  };
  return value();
}

export function targetDatabase(name, fallback = VERSION_DATABASE) {
  return IDENTIFIER.test(name) && /795/.test(name) ? name : fallback;
}

function overSsh(entry) {
  if (truthy(entry.isOverSSH) || truthy(entry.isUseSSH) || truthy(entry.OverSSH)) return true;
  const sshHost = asText(entry.ServerAddress).trim().toLowerCase();
  return Boolean(asText(entry.ServerUser).trim()) && !LOOPBACK_HOSTS.has(sshHost);
}

// Local (loopback, non-SSH) MySQL/MariaDB connections, best match first.
export function tablePlusCandidates(connections, { database = VERSION_DATABASE, port = DEDICATED_PORT } = {}) {
  if (!Array.isArray(connections)) return [];
  return connections.flatMap(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const candidate = {
      id: asText(entry.ID).trim(),
      name: asText(entry.ConnectionName).trim(),
      host: asText(entry.DatabaseHost).trim(),
      port: Number.parseInt(asText(entry.DatabasePort), 10) || 3306,
      user: asText(entry.DatabaseUser).trim(),
      database: asText(entry.DatabaseName).trim()
    };
    if (!/mysql|maria/i.test(asText(entry.Driver)) || overSsh(entry)) return [];
    if (!LOOPBACK_HOSTS.has(candidate.host.toLowerCase())) return [];
    if (!candidate.id || !candidate.user || candidate.port < 1 || candidate.port > 65535) return [];
    const label = `${candidate.name} ${candidate.database}`;
    let score = 1;
    if (candidate.database === database) score += 100;
    if (/7\.?9\.?5/.test(label)) score += 30;
    if (candidate.port === port) score += 20;
    if (/audit\s*flow/i.test(label)) score += 10;
    return [{ ...candidate, targetDatabase: targetDatabase(candidate.database, database), score }];
  }).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
}

export function normalizeHost(host) {
  const value = asText(host).trim().toLowerCase();
  return LOOPBACK_HOSTS.has(value) ? "127.0.0.1" : value;
}

export function connectionUrls({ host, port, user, password, database }) {
  if (!IDENTIFIER.test(database)) throw new Error(`Invalid database name: ${database}`);
  const hostname = normalizeHost(host);
  return {
    mysql: `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${hostname}:${Number(port)}/${database}`,
    jdbc: `jdbc:mysql://${hostname}:${Number(port)}/${database}?sslMode=DISABLED&allowPublicKeyRetrieval=true`
  };
}

const stripComments = sql => sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\n)\s*(--|#)[^\n]*/g, "$1");

export function schemaFiles(directory) {
  const files = readdirSync(directory).filter(name => name.endsWith(".sql")).sort();
  if (!files.includes("collaboration-schema.sql")) throw new Error(`No 7.9.5 schema in ${directory}`);
  return files.map(name => {
    const sql = readFileSync(path.join(directory, name), "utf8");
    const match = DESTRUCTIVE_SQL.exec(stripComments(sql));
    if (match) throw new Error(`${name} contains "${match[0]}"; the launcher only applies create-if-not-exists schema`);
    return { name, sql };
  });
}

function settings() {
  const env = process.env;
  const port = Number.parseInt(env.DB_PORT || "", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw usage("DB_PORT must be a TCP port");
  if (!env.DB_USER) throw usage("DB_USER is required");
  return {
    host: normalizeHost(env.DB_HOST),
    port,
    user: env.DB_USER,
    password: env.DB_PASSWORD || "",
    database: env.DB_NAME || VERSION_DATABASE
  };
}

function usage(message) {
  return Object.assign(new Error(message), { exitCode: 2 });
}

function loadMysql() {
  const serverDir = process.env.JEAUDITFLOW_SERVER_DIR;
  if (!serverDir) throw usage("JEAUDITFLOW_SERVER_DIR must point to the installed 7.9.5 server directory");
  return createRequire(path.join(serverDir, "package.json"))("mysql2/promise");
}

async function withConnection(options, work) {
  const mysql = loadMysql();
  const { host, port, user, password } = settings();
  const connection = await mysql.createConnection({ host, port, user, password, connectTimeout: 5000, charset: "utf8mb4", ...options });
  try {
    return await work(connection);
  } finally {
    await connection.end().catch(() => {});
  }
}

const count = async (connection, sql, values) => Number((await connection.query(sql, values))[0][0].c);

const commands = {
  async tableplus() {
    const connections = parsePlistXml(readFileSync(0, "utf8"));
    const clean = value => asText(value).replace(/[\t\r\n]+/g, " ");
    for (const candidate of tablePlusCandidates(connections)) {
      process.stdout.write(`${[candidate.score, candidate.id, candidate.host || "127.0.0.1", candidate.port, candidate.user, candidate.targetDatabase, candidate.name].map(clean).join("\t")}\n`);
    }
  },
  async ping() {
    await withConnection({}, connection => connection.query("select 1"));
    process.stdout.write("ok\n");
  },
  async inspect() {
    const { database } = settings();
    if (!IDENTIFIER.test(database)) throw usage(`Invalid database name: ${database}`);
    const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    await withConnection({}, async connection => {
      const exists = await count(connection, "select count(*) as c from information_schema.schemata where schema_name = ?", [database]);
      const schema = exists && await count(connection, "select count(*) as c from information_schema.tables where table_schema = ? and table_name = 'auditflow_accounts'", [database]);
      const admin = schema && email && await count(connection, `select count(*) as c from \`${database}\`.auditflow_accounts where lower(email) = ?`, [email]);
      process.stdout.write(`database=${exists ? 1 : 0}\nschema=${schema ? 1 : 0}\nadmin=${admin ? 1 : 0}\n`);
    });
  },
  async "create-database"() {
    const { database } = settings();
    if (!IDENTIFIER.test(database)) throw usage(`Invalid database name: ${database}`);
    await withConnection({}, connection => connection.query(`create database if not exists \`${database}\` character set utf8mb4 collate utf8mb4_unicode_ci`));
    process.stdout.write(`created ${database}\n`);
  },
  async "apply-schema"(directory) {
    if (!directory) throw usage("apply-schema needs the schema directory");
    const files = schemaFiles(directory);
    const { database } = settings();
    await withConnection({ database, multipleStatements: true }, async connection => {
      for (const file of files) await connection.query(file.sql);
    });
    process.stdout.write(`applied ${files.length} schema files to ${database}\n`);
  },
  async provision() {
    const { database } = settings();
    const appUser = process.env.APP_USER || "";
    const appPassword = process.env.APP_PASSWORD || "";
    const rootPassword = process.env.NEW_ROOT_PASSWORD || "";
    if (!IDENTIFIER.test(database) || !/^[A-Za-z0-9_]{1,32}$/.test(appUser)) throw usage("Invalid database or application user name");
    if (appPassword.length < 12 || rootPassword.length < 12) throw usage("APP_PASSWORD and NEW_ROOT_PASSWORD must be at least 12 characters");
    await withConnection({}, async connection => {
      await connection.query(`create database if not exists \`${database}\` character set utf8mb4 collate utf8mb4_unicode_ci`);
      for (const host of ["127.0.0.1", "localhost"]) {
        await connection.query("create user if not exists ?@? identified by ?", [appUser, host, appPassword]);
        await connection.query(`grant all privileges on \`${database}\`.* to ?@?`, [appUser, host]);
      }
      await connection.query("alter user 'root'@'localhost' identified by ?", [rootPassword]);
    });
    process.stdout.write(`provisioned ${database} for ${appUser}\n`);
  },
  async urls() {
    const urls = connectionUrls(settings());
    process.stdout.write(`mysql=${urls.mysql}\njdbc=${urls.jdbc}\n`);
  }
};

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const handler = commands[command];
  if (!handler) {
    process.stderr.write(`usage: db-tool.mjs ${Object.keys(commands).join("|")}\n`);
    return 2;
  }
  try {
    await handler(...rest);
    return 0;
  } catch (error) {
    const code = String(error?.code || "");
    process.stderr.write(`${code ? `${code}: ` : ""}${error?.message || error}\n`);
    if (error?.exitCode) return error.exitCode;
    if (UNREACHABLE.has(code)) return 3;
    if (DENIED.has(code)) return 4;
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
