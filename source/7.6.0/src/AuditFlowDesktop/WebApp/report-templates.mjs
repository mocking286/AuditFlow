import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultDirectory = fileURLToPath(new URL("../client/templates/", import.meta.url));
const files = Object.freeze({
  "mbeal-assessment-findings": ["mbeal-assessment-findings.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  "trace-presentation": ["trace-presentation.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  "km-presentation": ["km-presentation.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  "trace-word": ["trace-word.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  "trace-excel": ["trace-excel.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  "tuv-aspice-issue-ledger": ["TUV-ASPICE-Audit-Issue-Ledger-2026.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  "tuv-audit-issue-record": ["mbeal-assessment-findings.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
});

const exportMetadata = Object.freeze({
  schema: "auditflow.report-export/v1",
  reportModel: "auditflow.report/v10",
  generation: "browser-local",
  compatibility: {
    responseFields: ["version", "generation", "pdf", "templates"],
    changePolicy: "Additive fields only; template IDs and file routes remain stable"
  },
  assessorAuthority: "AI candidates are advisory; formal ratings and evidence confirmation remain assessor-controlled",
  currentContent: {
    assessments: ["indicator", "pa", "humanRating", "reviewStatus", "rationale", "evidenceReferencesAndRoles", "assessorNote"],
    evidenceRegister: ["id", "name", "versionOrBaseline", "primaryProcess", "role", "locatorOrSource", "confirmation"],
    findings: ["id", "type", "indicator", "description", "minimumClosureEvidence", "owner", "due", "reviewStatus", "closure", "explicitFindingEvidenceLinks"]
  },
  traceExtensions: {
    findingEvidenceChain: {
      status: "exported-only-when-explicitly-linked-to-finding",
      fields: ["findingId", "evidenceId", "evidenceRole", "locator", "linkConfirmation", "evidenceConfirmation"],
      boundary: "Assessment-level evidence and unassociated trace links are never copied into a finding evidence chain"
    },
    milestoneChecks: {
      status: "exported-only-from-explicit-project-milestone-check-records",
      dimensions: ["area", "milestone", "questionOrCheck"],
      evidenceFields: ["evidenceId", "evidenceRole", "locator", "reviewStatus"],
      boundary: "Checkpoint records do not produce or imply ASPICE ratings"
    }
  }
});

export async function getReportTemplates({ templateDirectory = defaultDirectory } = {}) {
  const manifest = JSON.parse(await readFile(path.join(templateDirectory, "manifest.json"), "utf8"));
  return {
    version: "12.3.0",
    generation: "browser-local",
    exportMetadata,
    pdf: { mode: "browser-print", label: "Print / Save as PDF" },
    templates: Object.entries(files).map(([id, [file, mime]]) => ({
      id, file, mime,
      sha256: manifest.templates.find(item => item.id === id)?.sha256 || null,
      url: `/api/report-templates/${id}/file`
    }))
  };
}

export async function readReportTemplate(id, { templateDirectory = defaultDirectory } = {}) {
  if (!Object.hasOwn(files, id)) {
    const error = new Error("Unknown report template");
    error.status = 404;
    throw error;
  }
  const [filename, mime] = files[id];
  return { filename, mime, data: await readFile(path.join(templateDirectory, filename)) };
}

/** Mount after the parent's authentication / authorization checks.
 * Returns false for unrelated paths. This route never receives project data.
 */
export async function handleReportTemplateRequest(request, response, options = {}) {
  const pathname = options.pathname || new URL(request.url, "http://localhost").pathname;
  if (pathname !== "/api/report-templates" && !pathname.startsWith("/api/report-templates/")) return false;
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "private, no-store");
  function json(status, body) {
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(request.method === "HEAD" ? undefined : JSON.stringify(body));
  }
  if (!["GET", "HEAD"].includes(request.method)) {
    response.setHeader("Allow", "GET, HEAD");
    json(405, { error: "Templates are read-only. Report data is processed in the browser." });
    return true;
  }
  try {
    if (pathname === "/api/report-templates") json(200, await getReportTemplates(options));
    else {
      const match = /^\/api\/report-templates\/([a-z0-9-]+)\/file$/.exec(pathname);
      if (!match) json(404, { error: "Report template route not found" });
      else {
        const output = await readReportTemplate(match[1], options);
        response.statusCode = 200;
        response.setHeader("Content-Type", output.mime);
        response.setHeader("Content-Length", output.data.byteLength);
        response.setHeader("Content-Disposition", `attachment; filename="${output.filename}"`);
        response.end(request.method === "HEAD" ? undefined : output.data);
      }
    }
  } catch (error) {
    json(error.status === 404 ? 404 : 500, { error: error.status === 404 ? "Unknown report template" : "Report template is unavailable" });
  }
  return true;
}
