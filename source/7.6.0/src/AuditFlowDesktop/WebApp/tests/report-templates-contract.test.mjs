import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getReportTemplates, handleReportTemplateRequest, readReportTemplate } from "../report-templates.mjs";

const templateDirectory = fileURLToPath(new URL("../templates/", import.meta.url));

test("catalog keeps stable report routes and adds an explicit export contract", async () => {
  const catalog = await getReportTemplates({ templateDirectory });
  assert.equal(catalog.version, "12.3.0");
  assert.equal(catalog.generation, "browser-local");
  assert.deepEqual(Object.keys(catalog.pdf), ["mode", "label"]);
  assert.deepEqual(catalog.templates.map(template => template.id), [
    "mbeal-assessment-findings", "trace-presentation", "km-presentation", "trace-word", "trace-excel", "tuv-aspice-issue-ledger", "tuv-audit-issue-record"
  ]);
  assert.ok(catalog.templates.every(template => template.url === `/api/report-templates/${template.id}/file`));

  const contract = catalog.exportMetadata;
  assert.equal(contract.schema, "auditflow.report-export/v1");
  assert.equal(contract.reportModel, "auditflow.report/v10");
  assert.deepEqual(contract.compatibility.responseFields, ["version", "generation", "pdf", "templates"]);
  assert.match(contract.assessorAuthority, /AI candidates are advisory/);
  assert.ok(contract.currentContent.assessments.includes("evidenceReferencesAndRoles"));
  assert.ok(contract.currentContent.findings.includes("minimumClosureEvidence"));
  assert.ok(contract.currentContent.findings.includes("explicitFindingEvidenceLinks"));
  assert.equal(contract.traceExtensions.findingEvidenceChain.status, "exported-only-when-explicitly-linked-to-finding");
  assert.match(contract.traceExtensions.findingEvidenceChain.boundary, /never copied into a finding evidence chain/);
  assert.equal(contract.traceExtensions.milestoneChecks.status, "exported-only-from-explicit-project-milestone-check-records");
  assert.deepEqual(contract.traceExtensions.milestoneChecks.dimensions, ["area", "milestone", "questionOrCheck"]);
  assert.match(contract.traceExtensions.milestoneChecks.boundary, /do not produce or imply ASPICE ratings/);
});

test("template catalog checksum matches the packaged template bytes", async () => {
  const catalog = await getReportTemplates({ templateDirectory });
  const template = catalog.templates.find(item => item.id === "trace-word");
  const file = await readFile(path.join(templateDirectory, template.file));
  assert.equal(createHash("sha256").update(file).digest("hex"), template.sha256);
  const served = await readReportTemplate(template.id, { templateDirectory });
  assert.equal(served.filename, template.file);
  assert.deepEqual(served.data, file);
});

test("catalog and file routes remain read-only and preserve GET/HEAD behavior", async () => {
  async function request(method, url) {
    const headers = {};
    const response = {
      headers,
      setHeader(name, value) { headers[name] = value; },
      end(body) { this.body = body; }
    };
    const handled = await handleReportTemplateRequest({ method, url }, response, { templateDirectory });
    return { handled, ...response };
  }

  const catalog = await request("GET", "/api/report-templates");
  assert.equal(catalog.handled, true);
  assert.equal(catalog.statusCode, 200);
  assert.match(catalog.headers["Content-Type"], /application\/json/);
  assert.equal(JSON.parse(catalog.body).exportMetadata.schema, "auditflow.report-export/v1");

  const file = await request("GET", "/api/report-templates/trace-word/file");
  assert.equal(file.statusCode, 200);
  assert.equal(file.headers["Content-Type"], "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.ok(Buffer.isBuffer(file.body));

  const head = await request("HEAD", "/api/report-templates/trace-word/file");
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, undefined);

  const write = await request("POST", "/api/report-templates");
  assert.equal(write.statusCode, 405);
  assert.equal(write.headers.Allow, "GET, HEAD");
  assert.match(write.body, /read-only/i);
});
