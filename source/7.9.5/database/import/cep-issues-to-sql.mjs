#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { importCepIssues } from "./cep-issues-importer.mjs";

function sqlText(value) {
  return `CONVERT(X'${Buffer.from(String(value ?? ""), "utf8").toString("hex")}' USING utf8mb4)`;
}

function sqlNullableDate(value) {
  return value ? sqlText(value) : "NULL";
}

const argv = process.argv.slice(2);
const inputIndex = argv.indexOf("--input");
const outputIndex = argv.indexOf("--output");
const projectIndex = argv.indexOf("--project");
const input = inputIndex >= 0 ? argv[inputIndex + 1] : "";
const output = outputIndex >= 0 ? argv[outputIndex + 1] : "";
const projectKey = projectIndex >= 0 ? argv[projectIndex + 1] || "CEP" : "CEP";
if (!input || !output) throw new Error("Usage: node import/cep-issues-to-sql.mjs --input ledger.xlsx --output cep-issues.sql [--project CEP]");

const imported = await importCepIssues(input, { projectKey });
const statements = [
  "START TRANSACTION;",
  "SET NAMES utf8mb4;"
];
const values = imported.issues.map(issue => [
  sqlText(issue.projectKey), sqlText(issue.issueKey), sqlText(issue.issueId), sqlText(issue.process), sqlText(issue.severity), sqlText(issue.category),
  sqlText(issue.title), sqlText(issue.description), sqlText(issue.internalComment), sqlText(issue.rootCause), sqlText(issue.improvementMeasures), sqlText(issue.owner),
  sqlNullableDate(issue.auditDate), sqlNullableDate(issue.dueDate), sqlText(issue.status), sqlText(issue.helixDescription), sqlText(issue.referenceExample),
  sqlText(issue.sourceKind), sqlText(issue.ownedBy), sqlText(issue.sourceFile), sqlText(issue.sourceSheet), issue.sourceRow == null ? "NULL" : String(Number(issue.sourceRow)),
  sqlText(JSON.stringify(issue.sourceCells || {})), sqlText(JSON.stringify(issue.payload || {}))
].join(", ")).map(value => `(${value})`);
if (values.length) {
  statements.push("INSERT INTO auditflow_jira_issues (project_key, issue_key, issue_id, process_area, severity, category, title, description, internal_comment, root_cause, improvement_measures, owner, audit_date, due_date, status, helix_description, reference_example, source_kind, owned_by, source_file, source_sheet, source_row, source_cells_json, payload_json) VALUES");
  statements.push(values.join(",\n") + "\nON DUPLICATE KEY UPDATE issue_id=VALUES(issue_id), process_area=VALUES(process_area), severity=VALUES(severity), category=VALUES(category), title=VALUES(title), description=VALUES(description), internal_comment=VALUES(internal_comment), root_cause=VALUES(root_cause), improvement_measures=VALUES(improvement_measures), owner=VALUES(owner), audit_date=VALUES(audit_date), due_date=VALUES(due_date), status=VALUES(status), helix_description=VALUES(helix_description), reference_example=VALUES(reference_example), source_kind=VALUES(source_kind), owned_by=VALUES(owned_by), source_file=VALUES(source_file), source_sheet=VALUES(source_sheet), source_row=VALUES(source_row), source_cells_json=VALUES(source_cells_json), payload_json=VALUES(payload_json), revision=revision+1, updated_at=current_timestamp(3);");
}
statements.push("COMMIT;", `-- Imported ${imported.count} JiraFlow-owned CEP issues from ${imported.sheets.filter(sheet => sheet.imported).length} process sheets.`);
await writeFile(output, statements.join("\n") + "\n", "utf8");
process.stdout.write(JSON.stringify({ output, projectKey, count: imported.count }, null, 2) + "\n");
