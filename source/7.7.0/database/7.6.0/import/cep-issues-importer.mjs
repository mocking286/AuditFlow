#!/usr/bin/env node

/*
 * Import the TUV issue workbook into the JiraFlow-owned issue stream.
 *
 * The backend release intentionally has no XLSX dependency.  This parser
 * reads the small OOXML subset needed by audit issue ledgers through the
 * system `unzip` command, preserving sheet/row/cell provenance and Excel
 * dates.  It is also usable as a standalone CLI for the database package.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_PROJECT_KEY = "CEP";
const SOURCE_KIND = "jira-issue-import";
const OWNED_BY = "jiraflow";

function asText(value) {
  return String(value ?? "").trim();
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, number) => String.fromCodePoint(Number(number)));
}

function xmlAttribute(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? decodeXml(match[1]) : "";
}

function columnNumber(cellRef) {
  const letters = String(cellRef).match(/^([A-Z]+)/i)?.[1]?.toUpperCase() || "A";
  let number = 0;
  for (const letter of letters) number = number * 26 + letter.charCodeAt(0) - 64;
  return number;
}

function columnName(number) {
  let result = "";
  let value = Number(number) || 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

async function unzipEntry(inputPath, entry) {
  try {
    const result = await execFileAsync("unzip", ["-p", inputPath, entry], {
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true
    });
    return String(result.stdout || "");
  } catch (error) {
    const detail = String(error?.stderr || error?.message || "").trim();
    throw new Error(`Unable to read XLSX entry ${entry}: ${detail}`);
  }
}

function parseSharedStrings(xml) {
  const strings = [];
  const siPattern = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match;
  while ((match = siPattern.exec(xml))) {
    const text = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map(item => decodeXml(item[1]))
      .join("");
    strings.push(text);
  }
  return strings;
}

function parseDateStyles(xml) {
  const customDateIds = new Set();
  for (const match of xml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"[^>]*\/>/g)) {
    const formatCode = decodeXml(match[2]);
    if (/[yd]/i.test(formatCode)) {
      customDateIds.add(Number(match[1]));
    }
  }
  const cellXfs = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] || "";
  const styleDate = [];
  // Number formats are attributes on the opening xf tag.  Matching only the
  // opening tag avoids a self-closing xf greedily consuming the next style.
  const xfPattern = /<xf\b[^>]*(?:\/>|>)/g;
  let index = 0;
  let match;
  while ((match = xfPattern.exec(cellXfs))) {
    const numFmtId = Number(xmlAttribute(match[0], "numFmtId"));
    styleDate[index++] = customDateIds.has(numFmtId) || [14, 15, 16, 17, 22].includes(numFmtId);
  }
  return styleDate;
}

function excelSerialDate(serial) {
  const value = Number(serial);
  if (!Number.isFinite(value)) return "";
  // Excel's 1900 date system includes the historical 1900-02-29 bug.
  const epoch = Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.round(value * 86400000));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function parseCellValue(cellXml, sharedStrings, dateStyles) {
  const type = xmlAttribute(cellXml, "t");
  const style = Number(xmlAttribute(cellXml, "s"));
  const value = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
  if (type === "inlineStr") {
    return [...cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(item => decodeXml(item[1])).join("");
  }
  if (value == null) return "";
  const decoded = decodeXml(value);
  if (type === "s") return sharedStrings[Number(decoded)] ?? "";
  if (dateStyles[style] && /^-?\d+(?:\.\d+)?$/.test(decoded)) return excelSerialDate(decoded);
  return decoded;
}

function parseSheetRows(xml, sharedStrings, dateStyles) {
  const rows = [];
  const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(xml))) {
    const rowTag = rowMatch[0].slice(0, rowMatch[0].indexOf(">") + 1);
    const rowNumber = Number(xmlAttribute(rowTag, "r")) || rows.length + 1;
    const values = {};
    const cells = {};
    for (const cellMatch of rowMatch[1].matchAll(/<c\b[^>]*>([\s\S]*?)<\/c>|<c\b[^>]*/g)) {
      const raw = cellMatch[0];
      const cellRef = xmlAttribute(raw.slice(0, raw.indexOf(">") + 1), "r") || `${columnName(Object.keys(values).length + 1)}${rowNumber}`;
      const key = cellRef.replace(/\d+$/, "").toUpperCase();
      values[key] = parseCellValue(raw, sharedStrings, dateStyles);
      cells[key] = cellRef;
    }
    rows.push({ rowNumber, values, cells });
  }
  return rows;
}

function normalizeHeader(value) {
  return asText(value).toLowerCase().replace(/[\r\n]+/g, " ").replace(/[：:]/g, "").replace(/\s+/g, " ");
}

function headerField(value) {
  const header = normalizeHeader(value);
  if (/^no$|^number$/.test(header)) return "number";
  if (header.includes("issue id")) return "issueId";
  if (header === "date" || header.startsWith("audit date")) return "date";
  if (header.includes("severity")) return "severity";
  if (header.includes("catagory") || header.includes("category")) return "category";
  if (header.includes("issue description")) return "description";
  if (header.includes("internal comment")) return "internalComment";
  if (header.includes("root cause")) return "rootCause";
  if (header.includes("improvement measures")) return "improvementMeasures";
  if (header.includes("person responsible") || header === "owner") return "owner";
  if (header.includes("due date") || header === "due") return "dueDate";
  if (header === "status" || header.startsWith("status ")) return "status";
  if (header.includes("description in helix")) return "helixDescription";
  if (header.includes("reference example")) return "referenceExample";
  return "";
}

function sanitizeKeyPart(value) {
  return asText(value).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").toUpperCase();
}

function normalizeIssueId(value, fallback) {
  const normalized = asText(value).replace(/\s+/g, "-").replace(/[^\p{L}\p{N}._/-]+/gu, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function titleFromDescription(description, issueId) {
  const firstLine = asText(description).split(/\r?\n/).map(value => value.trim()).find(Boolean);
  return (firstLine || issueId || "CEP issue").slice(0, 500);
}

function normalizeDate(value) {
  const text = asText(value);
  if (!text) return "";
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(text)) {
    const [year, month, day] = text.split(/[/-]/).map(Number);
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10);
}

function processIssueRows(rows, { sourceFile, sourceSheet, projectKey }) {
  const headerIndex = rows.findIndex(row => Object.values(row.values).some(value => normalizeHeader(value).includes("issue id")) && Object.values(row.values).some(value => normalizeHeader(value).includes("issue description")));
  if (headerIndex < 0) return [];
  const header = {};
  for (const [column, value] of Object.entries(rows[headerIndex].values)) {
    const field = headerField(value);
    if (field) header[column] = field;
  }
  const sourceRows = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const raw = {};
    const sourceCells = {};
    for (const [column, field] of Object.entries(header)) {
      raw[field] = row.values[column] ?? "";
      if (row.cells[column]) sourceCells[field] = row.cells[column];
    }
    if (!asText(raw.issueId) || /^total$|^sum$|^subtotal$/i.test(asText(raw.issueId))) continue;
    const issueId = normalizeIssueId(raw.issueId, `${sourceSheet}-${row.rowNumber}`);
    sourceRows.push({ raw, sourceCells, issueId, sourceRow: row.rowNumber });
  }
  const counts = new Map();
  sourceRows.forEach(item => counts.set(item.issueId, (counts.get(item.issueId) || 0) + 1));
  const seen = new Map();
  return sourceRows.map(item => {
    const duplicate = (counts.get(item.issueId) || 0) > 1;
    const processPart = sanitizeKeyPart(sourceSheet) || "ISSUE";
    const baseKey = duplicate ? `${sanitizeKeyPart(projectKey)}-${processPart}-${sanitizeKeyPart(item.issueId)}` : `${sanitizeKeyPart(projectKey)}-${sanitizeKeyPart(item.issueId)}`;
    const ordinal = (seen.get(baseKey) || 0) + 1;
    seen.set(baseKey, ordinal);
    const issueKey = ordinal > 1 ? `${baseKey}-${ordinal}` : baseKey;
    const raw = item.raw;
    return {
      issueKey,
      issueId: item.issueId,
      projectKey,
      process: sourceSheet,
      severity: asText(raw.severity),
      category: asText(raw.category),
      title: titleFromDescription(raw.description, item.issueId),
      description: asText(raw.description),
      internalComment: asText(raw.internalComment),
      rootCause: asText(raw.rootCause),
      improvementMeasures: asText(raw.improvementMeasures),
      owner: asText(raw.owner),
      dueDate: normalizeDate(raw.dueDate),
      auditDate: normalizeDate(raw.date),
      status: asText(raw.status),
      helixDescription: asText(raw.helixDescription),
      referenceExample: asText(raw.referenceExample),
      sourceKind: SOURCE_KIND,
      ownedBy: OWNED_BY,
      sourceFile,
      sourceSheet,
      sourceRow: item.sourceRow,
      sourceCells: item.sourceCells,
      payload: { ...raw, issueId: item.issueId, issueKey, projectKey, process: sourceSheet }
    };
  });
}

async function readWorkbook(inputPath) {
  const sourceFile = path.resolve(inputPath);
  const [workbookXml, relsXml, sharedStringsXml, stylesXml] = await Promise.all([
    unzipEntry(sourceFile, "xl/workbook.xml"),
    unzipEntry(sourceFile, "xl/_rels/workbook.xml.rels"),
    unzipEntry(sourceFile, "xl/sharedStrings.xml").catch(() => ""),
    unzipEntry(sourceFile, "xl/styles.xml").catch(() => "")
  ]);
  const relationships = new Map();
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    relationships.set(xmlAttribute(match[0], "Id"), xmlAttribute(match[0], "Target").replace(/^\//, ""));
  }
  const sheets = [];
  for (const match of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = xmlAttribute(match[0], "name");
    const relationship = relationships.get(xmlAttribute(match[0], "id"));
    if (!name || !relationship) continue;
    const entry = relationship.startsWith("xl/") ? relationship : `xl/${relationship}`;
    sheets.push({ name, entry });
  }
  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const dateStyles = parseDateStyles(stylesXml);
  const result = [];
  for (const sheet of sheets) {
    const xml = await unzipEntry(sourceFile, sheet.entry);
    result.push({ ...sheet, rows: parseSheetRows(xml, sharedStrings, dateStyles) });
  }
  return { sourceFile, sheets: result };
}

export async function importCepIssues(inputPath, { projectKey = DEFAULT_PROJECT_KEY } = {}) {
  const workbook = await readWorkbook(inputPath);
  const issues = workbook.sheets
    .filter(sheet => sheet.name.toLowerCase() !== "dashboard")
    .flatMap(sheet => processIssueRows(sheet.rows, { sourceFile: workbook.sourceFile, sourceSheet: sheet.name, projectKey }));
  return {
    projectKey,
    sourceKind: SOURCE_KIND,
    ownedBy: OWNED_BY,
    sourceFile: workbook.sourceFile,
    sheets: workbook.sheets.map(sheet => ({ name: sheet.name, rowCount: sheet.rows.length, imported: issues.filter(issue => issue.sourceSheet === sheet.name).length })),
    count: issues.length,
    issues
  };
}

export { DEFAULT_PROJECT_KEY, OWNED_BY, SOURCE_KIND, normalizeDate, parseSharedStrings, parseSheetRows };

async function main(argv) {
  const inputIndex = argv.indexOf("--input");
  const outputIndex = argv.indexOf("--output");
  const projectIndex = argv.indexOf("--project");
  const input = inputIndex >= 0 ? argv[inputIndex + 1] : "";
  const output = outputIndex >= 0 ? argv[outputIndex + 1] : "";
  const projectKey = projectIndex >= 0 ? argv[projectIndex + 1] || DEFAULT_PROJECT_KEY : DEFAULT_PROJECT_KEY;
  if (!input) throw new Error("Usage: node server/cep-issues-importer.mjs --input ledger.xlsx [--project CEP] [--output issues.json]");
  const imported = await importCepIssues(input, { projectKey });
  const json = JSON.stringify(imported, null, 2) + "\n";
  if (output) {
    await mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await writeFile(output, json, "utf8");
  } else {
    process.stdout.write(json);
  }
  process.stderr.write(`Imported ${imported.count} JiraFlow-owned issues from ${imported.sheets.filter(sheet => sheet.imported).length} process sheets.\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}
