import { lstat, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCandidateOutputPath,
  assertCandidateRoot,
  writeCandidateFile
} from "./package-7.3-release-helpers.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mappingStart = "/* ASPICE V4 external assessment mapping start */";
const mappingEnd = "/* END ASPICE V4 external assessment mapping */";
const assessmentStub = Object.freeze({
  schemaVersion: 2, importId: "", sourceFile: "", sourcePath: "", sourceType: "",
  reportVersion: "", assessmentPeriod: "", progress: 0, status: "disabled",
  project: null, processes: [], records: [], plans: [], sessions: [], notes: [],
  planSourceFile: "", actionPlanSourceFile: "", reportGuidanceFile: "",
  actionPlanIssues: [], assessmentOpinion: "", governancePlan: {},
  importStats: {
    assessedProcesses: 0, practiceEntries: 0, ratedPractices: 0, evidenceEntries: 0,
    weaknessEntries: 0, assessorComments: 0, planEntries: 0, sessionEntries: 0,
    actionPlanIssues: 0, actionPlanMappedAssessments: 0, majorIssues: 0,
    minorIssues: 0, unratedSeverityIssues: 0, openIssues: 0, missingOwners: 0,
    missingDueDates: 0, ownersProposed: 0, dueDatesProposed: 0, candidateIndicatorMappings: 0
  }
});
const referenceStub = Object.freeze({
  schemaVersion: "auditflow.tuv-aspice-issue-reference/1",
  datasetId: "tuv-aspice-audit-issue-ledger-2026",
  title: "ASPICE issue ledger reference", sourceFile: "",
  sourceDeck: { slideCount: 0, issueCount: 0, sourceWorkbook: "", scope: "" },
  usagePolicy: { candidateOnly: true, trainingOnly: true, formalRating: false, allowedUses: [], forbiddenUses: [] },
  summary: { processCounts: {}, severityCounts: {}, statusCounts: {}, sourceKindCounts: {} },
  issues: []
});
export const PUBLIC_CUSTOMER_DATA_MODULES = Object.freeze([
  "cep-xp-assessment-data.js", "external-assessment-data.js", "tmm-assessment-data.js",
  "mbeal-targeted-issues.js", "tuv-aspice-issue-reference.js"
]);
const moduleNames = new Set(PUBLIC_CUSTOMER_DATA_MODULES);
const rawFixture = /(?:^|\/)(?:fixtures|__fixtures__)\/(?:mbeal-assessment|mbeal-targeted-issues|cep-issues)\.json$/i;
const reportTemplateNames = new Set([
  "TUV-ASPICE-Audit-Issue-Ledger-2026.pptx", "mbeal-assessment-findings.xlsx",
  "km-presentation.pptx", "trace-word.docx", "trace-excel.xlsx", "trace-presentation.pptx"
]);
const comment = "/* Public release: controlled assessment datasets are omitted. */\n";
const assign = (name, value) => `${comment}window.${name} = ${JSON.stringify(value)};\n`;

function emptyDatasetModule(name, original) {
  if (name === "cep-xp-assessment-data.js") return assign("AUDITFLOW_CEP_XP_ASSESSMENT", assessmentStub);
  if (name === "tmm-assessment-data.js") return assign("AUDITFLOW_TMM_ASSESSMENT", assessmentStub);
  if (name === "mbeal-targeted-issues.js") return assign("AUDITFLOW_MBEAL_TARGETED_ISSUES", []);
  if (name === "tuv-aspice-issue-reference.js") return assign("AUDITFLOW_TUV_ISSUE_REFERENCE", referenceStub);
  const start = original.indexOf(mappingStart);
  const end = original.indexOf(mappingEnd, Math.max(0, start));
  // Only this explicit generic adapter survives; neither the dataset prefix
  // nor an appended source-data trailer is copied into the public module.
  const adapter = start >= 0 && end > start
    ? original.slice(start, end + mappingEnd.length)
    : `${mappingStart}\nwindow.AUDITFLOW_EXTERNAL_ASSESSMENT_MAPPING = Object.freeze({schemaVersion:1, standardBasis:"Automotive SPICE 4.0", fields:{}, map:()=>({}), attach:(existing)=>({...existing})});\n${mappingEnd}`;
  return `${assign("AUDITFLOW_EXTERNAL_ASSESSMENTS", [])}${adapter}\n`;
}

export async function sanitizePublicReleaseData({ candidateRoot, stagingRoot } = {}) {
  if (!candidateRoot || !stagingRoot) throw new Error("A candidateRoot and stagingRoot are required");
  const candidate = await assertCandidateRoot(candidateRoot, path.join(projectRoot, "artifacts/candidates"));
  const root = await assertCandidateOutputPath(candidate, stagingRoot);
  if (!(await lstat(root)).isDirectory()) throw new Error("Public data sanitization requires a staging directory");
  const files = [];
  const evidenceDirectories = [];
  async function discover(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Public release staging contains a symbolic link: ${path.relative(root, filename)}`);
      if (entry.isDirectory()) {
        const relative = path.relative(root, filename).split(path.sep).join("/");
        if (entry.name === "cep-evidence" || /(?:^|\/)fileanalyst\/(?:client\/)?data$/.test(relative)) evidenceDirectories.push(filename);
        await discover(filename);
      } else if (entry.isFile()) files.push(filename);
      else throw new Error(`Public release staging requires regular files: ${path.relative(root, filename)}`);
    }
  }
  await discover(root);
  const changed = [];
  const evidenceRoots = evidenceDirectories.map(directory => `${directory}${path.sep}`);
  for (const filename of files.sort()) {
    if (evidenceRoots.some(directory => filename.startsWith(directory))) continue;
    const relative = path.relative(root, filename).split(path.sep).join("/");
    const name = path.basename(filename);
    if (moduleNames.has(name)) {
      const source = await readFile(filename, "utf8");
      await writeCandidateFile(candidate, filename, emptyDatasetModule(name, source));
    } else if (name === "tuv-aspice-issue-ledger-2026.json") {
      await writeCandidateFile(candidate, filename, `${JSON.stringify(referenceStub, null, 2)}\n`);
    } else if (name === "app.js") {
      const source = await readFile(filename, "utf8");
      const neutral = source
        .replaceAll("Intacs-Agile-SPICE-2021-04.pptx", "km-presentation.pptx")
        .replace(/aiOpinion: `TMM 评估活动和报告导入已完成。[^`]*`/, 'aiOpinion: "Imported assessment content requires source verification and assessor review."')
        .replace(/^  const CEP_ALLOWED_EMAILS = new Set\(\[\s*(?:"[^"\r\n]+"\s*,?\s*){1,10}\]\);/m, "  const CEP_ALLOWED_EMAILS = new Set([]);")
        .replace("条 Action Plan 问题 · 35 Major · 22 Minor · 1 待定", "条 Action Plan 问题 · 严重度待评估师确认")
        .replace(/<details class="training-reference">[\s\S]*?<\/details>/g, block =>
          block.includes('src="./assets/aspice-training/sup8-flow-reference.jpg"') && block.includes('src="./assets/aspice-training/sup8-flow-training-60.png"') ? "" : block);
      if (source === neutral) continue;
      await writeCandidateFile(candidate, filename, neutral);
    } else if (rawFixture.test(relative) || name === "Intacs-Agile-SPICE-2021-04.pptx") {
      await assertCandidateOutputPath(candidate, filename);
      await rm(filename);
    } else if (reportTemplateNames.has(name)) {
      const templates = await import("./public-report-template.mjs");
      await templates.sanitizePublicReportTemplate(filename);
    } else continue;
    changed.push(relative);
  }
  for (const directory of evidenceDirectories.sort((left, right) => right.length - left.length)) {
    await assertCandidateOutputPath(candidate, directory);
    await rm(directory, { recursive: true, force: true });
    changed.push(path.relative(root, directory).split(path.sep).join("/"));
  }
  return changed.sort();
}
