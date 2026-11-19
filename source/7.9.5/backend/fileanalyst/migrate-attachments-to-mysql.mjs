#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceDirectory = path.resolve(process.env.FILEANALYST_MIGRATION_SOURCE || path.join(here, "..", "cep-evidence"));
const mysqlUrl = String(process.env.FILEANALYST_MYSQL_URL || process.env.AUDITFLOW_MYSQL_URL || process.env.MYSQL_URL || "").trim();
const projectId = String(process.env.FILEANALYST_PROJECT_ID || "ASP-CEP-XP-2026").trim();
const uploadedBy = String(process.env.FILEANALYST_MIGRATION_ACTOR || "release-migration").trim();

if (!mysqlUrl) throw new Error("Set FILEANALYST_MYSQL_URL, AUDITFLOW_MYSQL_URL or MYSQL_URL before migrating attachments.");

function connectionOptions(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\/+/, "")),
    waitForConnections: true,
    connectionLimit: 3
  };
}

function mimeFor(file) {
  const extension = path.extname(file).toLowerCase();
  return {
    ".doc": "application/msword",
    ".docm": "application/vnd.ms-word.document.macroEnabled.12",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pdf": "application/pdf",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }[extension] || "application/octet-stream";
}

function attachmentId(name, content) {
  return `ATT-MIG-${createHash("sha256").update(name).update(content).digest("hex").slice(0, 48)}`;
}

const pool = mysql.createPool(connectionOptions(mysqlUrl));
await pool.query(`
  create table if not exists auditflow_fileanalyst_attachments (
    attachment_id varchar(80) primary key,
    project_id varchar(191) not null,
    item_id varchar(80) null,
    document_id varchar(80) null,
    file_name varchar(255) not null,
    mime_type varchar(160) not null,
    file_size bigint unsigned not null default 0,
    file_data longblob not null,
    sha256 char(64) null,
    parser_version varchar(80) null,
    parse_status varchar(40) not null default 'unparsed',
    uploaded_by varchar(191) not null,
    uploaded_by_name varchar(255) not null,
    uploaded_at datetime(6) not null default current_timestamp(6),
    key idx_fileanalyst_project_item (project_id, item_id),
    key idx_fileanalyst_project_document (project_id, document_id),
    key idx_fileanalyst_project_time (project_id, uploaded_at)
  ) engine=InnoDB default character set=utf8mb4 collate=utf8mb4_unicode_ci
`);

const names = (await readdir(sourceDirectory, { withFileTypes: true }))
  .filter(entry => entry.isFile())
  .map(entry => entry.name)
  .sort((left, right) => left.localeCompare(right));
let migrated = 0;
for (const name of names) {
  const content = await readFile(path.join(sourceDirectory, name));
  const id = attachmentId(name, content);
  await pool.execute(
    `insert into auditflow_fileanalyst_attachments
      (attachment_id, project_id, file_name, mime_type, file_size, file_data, sha256, parser_version, parse_status, uploaded_by, uploaded_by_name, uploaded_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on duplicate key update file_name=values(file_name), mime_type=values(mime_type), file_size=values(file_size), file_data=values(file_data), sha256=values(sha256), parser_version=values(parser_version), parse_status=values(parse_status)`,
    [id, projectId, name, mimeFor(name), content.length, content, createHash("sha256").update(content).digest("hex"), "fileanalyst-6.1", "unparsed", uploadedBy, uploadedBy, new Date()]
  );
  migrated += 1;
}
await pool.end();
console.log(JSON.stringify({ status: "ok", sourceDirectory, projectId, migrated }, null, 2));
