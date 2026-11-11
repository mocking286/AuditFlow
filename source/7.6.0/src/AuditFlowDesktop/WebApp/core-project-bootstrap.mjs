import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const DEFAULT_ADMIN_PERMISSIONS = Object.freeze({
  view: true,
  use: true,
  forms: true,
  remarks: true,
  traceability: true
});

function loadWindowValue(fileName, key) {
  const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), fileName);
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync(filePath, "utf8"), sandbox, { filename: filePath });
  return sandbox.window[key];
}

function stablePrefix(value) {
  return String(value || "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toUpperCase();
}

function deepCopy(value) {
  return value == null ? value : structuredClone(value);
}

function importedAssessmentSnapshot(source) {
  if (!source?.project?.id) return null;
  const project = source.project || {};
  const projectId = String(project.id || "").trim();
  const prefix = stablePrefix(projectId);
  const evidence = [];
  const assessments = [];
  const records = (source.records || []).map((record, index) => ({
    ...deepCopy(record),
    id: record.id || `${prefix}-IMPORT-REC-${String(index + 1).padStart(4, "0")}`,
    indicators: Array.isArray(record.indicators) ? record.indicators : (record.process && record.issue ? [`${record.process}.${record.issue}`] : []),
    evidenceIds: Array.isArray(record.evidenceIds) ? record.evidenceIds : [],
    created: record.created || `${source.assessmentPeriod || "2026"}-01-01T00:00:00.000Z`,
    status: record.status || "Draft",
    closureState: record.closureState || "待复审"
  }));

  for (const process of source.processes || []) {
    for (const practice of process.practices || []) {
      const evidenceText = [practice.evidence, practice.weakness, practice.assessorComment, practice.actionItems]
        .filter(Boolean)
        .join("\n");
      const evidenceId = `${prefix}-EV-${String(evidence.length + 1).padStart(4, "0")}`;
      if (evidenceText) {
        evidence.push({
          id: evidenceId,
          code: `${prefix}.EV.${String(evidence.length + 1).padStart(4, "0")}`,
          name: `${project.name || projectId} · ${process.id} ${practice.code || practice.practiceId}`,
          type: "Imported assessment observation / corroborating",
          source: source.sourceFile || source.planSourceFile || "",
          date: `${source.assessmentPeriod || "2026"}-01-01T00:00:00.000Z`,
          scope: process.id,
          primaryProcesses: [process.id],
          content: evidenceText,
          chars: evidenceText.length,
          size: Buffer.byteLength(evidenceText, "utf8"),
          locators: [{ locator: practice.sourceCell || `${process.id}.${practice.code || practice.practiceId}`, excerpt: evidenceText.slice(0, 1200) }],
          parseStatus: "parsed",
          evidenceRole: "corroborating",
          importSource: {
            importId: source.importId,
            sourceFile: source.sourceFile || source.planSourceFile || "",
            sheet: process.id,
            cellRange: practice.sourceCell || ""
          }
        });
      }

      const assessmentId = `${prefix}-ASMT-${process.id.replaceAll(".", "-")}-${String(assessments.length + 1).padStart(4, "0")}`;
      const rating = String(practice.rating || "N");
      const evidenceAnalysis = evidenceText ? [{
        evidenceId,
        evidenceCode: `${prefix}.EV.${String(evidence.length).padStart(4, "0")}`,
        source: source.sourceFile || source.planSourceFile || "",
        locator: practice.sourceCell || `${process.id}.${practice.code || practice.practiceId}`,
        excerpt: evidenceText.slice(0, 1200),
        claim: "Imported assessor material is corroborating evidence and does not replace direct implementation evidence.",
        strength: "corroborating",
        confirmed: false,
        scopeStatus: "in-scope"
      }] : [];
      const assessment = {
        id: assessmentId,
        group: `${process.id} · ${practice.pa || "PA 1.1"}`,
        process: process.id,
        processName: process.title || process.id,
        kind: String(practice.code || practice.practiceId || "").startsWith("GP") ? "GP" : "BP",
        pa: practice.pa || "PA 1.1",
        code: practice.code || practice.practiceId,
        title: practice.title || practice.practiceId,
        criterion: practice.criterion || "Imported assessment criterion",
        rating,
        displayRating: rating,
        aiCandidateRating: rating,
        achievementPercent: Number(practice.score) || 0,
        confidence: evidenceText ? 75 : 40,
        reviewed: false,
        evidenceAnalysis,
        evidenceSufficiency: {
          status: evidenceText ? "partial" : "insufficient",
          coverage: evidenceText ? 35 : 0,
          citedCount: evidenceText ? 1 : 0,
          directCount: 0,
          corroboratingCount: evidenceText ? 1 : 0,
          coveredTypes: evidenceText ? ["Assessment observation / corroborating"] : [],
          missingTypes: deepCopy(practice.closureEvidence || [])
        },
        findings: [
          ...(practice.weakness || practice.auditExplanation ? [{ type: "W", text: practice.weakness || practice.auditExplanation }] : []),
          ...(practice.actionItems || practice.assessorComment ? [{ type: "R", text: practice.actionItems || practice.assessorComment }] : [])
        ],
        reason: evidenceText
          ? `Imported ${source.importId} material is available at ${practice.sourceCell || "the source record"}; direct project implementation evidence and assessor confirmation remain required.`
          : "No locatable imported evidence was supplied for this practice.",
        refs: evidenceText ? [`${prefix}.EV.${String(evidence.length).padStart(4, "0")} · ${practice.sourceCell || ""}`] : [],
        requiredEvidence: deepCopy(practice.closureEvidence || []),
        sourceAssessment: {
          importId: source.importId,
          sourceFile: source.sourceFile || source.planSourceFile || "",
          sheet: process.id,
          cellRange: practice.sourceCell || "",
          practiceId: practice.practiceId || practice.code || "",
          originalScore: practice.score,
          originalRating: practice.rating || "",
          evidence: practice.evidence || "",
          weakness: practice.weakness || "",
          assessorComment: practice.assessorComment || "",
          actionItems: practice.actionItems || ""
        }
      };
      assessments.push(assessment);
      if (practice.weakness || practice.auditExplanation || practice.actionItems) {
        records.push({
          id: `${prefix}-W-${assessmentId}`,
          type: "weakness",
          text: practice.weakness || practice.auditExplanation || "",
          indicators: [`${process.id}.${practice.code || practice.practiceId}`],
          evidenceIds: evidenceText ? [evidenceId] : [],
          workspaceId: `WS-${prefix}-REVIEW`,
          instanceId: `INS-${prefix}`,
          creator: "Professional Assessor Team",
          status: "Draft",
          closureState: "待复审",
          sourceAssessmentId: assessmentId,
          created: `${source.assessmentPeriod || "2026"}-01-01T00:00:00.000Z`
        });
      }
    }
  }

  const processes = deepCopy(source.processes || []);
  const snapshot = {
    ...deepCopy(project),
    id: projectId,
    projectId,
    name: project.name || projectId,
    organization: project.organization || "",
    product: project.product || "",
    status: source.status || "review",
    statusLabel: "待复审",
    progress: Number(source.progress) || 0,
    achievedLevel: "Level 0",
    assessmentState: "Consolidation",
    processes,
    evidence,
    assessments,
    records,
    plans: deepCopy(source.plans || []),
    planCards: deepCopy(source.plans || []),
    sessions: deepCopy(source.sessions || []),
    workspaces: [{ id: `WS-${prefix}-REVIEW`, name: "Imported / 待复审", description: "Imported assessor working data", final: false }],
    instances: [{ id: `INS-${prefix}`, name: project.product || project.name || projectId, short: (project.organization || projectId).slice(0, 12), processes: processes.map(item => item.id) }],
    activeWorkspaceId: `WS-${prefix}-REVIEW`,
    activeInstanceId: `INS-${prefix}`,
    participants: [{ id: `P-${prefix}`, name: "Professional Assessor Team", short: "PAT", role: "Assessor Team", email: "" }],
    importSource: {
      schemaVersion: source.schemaVersion,
      importId: source.importId,
      sourceFile: source.sourceFile || "",
      planSourceFile: source.planSourceFile || "",
      actionPlanSourceFile: source.actionPlanSourceFile || "",
      assessmentPeriod: source.assessmentPeriod || "",
      importStats: deepCopy(source.importStats || {}),
      synchronizedAt: new Date().toISOString()
    },
    coreProjectBootstrap: {
      version: 1,
      importId: source.importId,
      synchronizedAt: new Date().toISOString()
    }
  };
  return snapshot;
}

export function buildCoreProjects() {
  const cep = loadWindowValue("cep-xp-assessment-data.js", "AUDITFLOW_CEP_XP_ASSESSMENT");
  const external = loadWindowValue("external-assessment-data.js", "AUDITFLOW_EXTERNAL_ASSESSMENTS") || [];
  const stellantis = external.find(item => item?.project?.id === "ASP-STELLANTIS-2025-12");
  return [
    { projectId: "ASP-CEP-XP-2026", workspaceId: "AUDITFLOW-WEB::shared", snapshot: importedAssessmentSnapshot(cep) },
    { projectId: "ASP-STELLANTIS-2025-12", workspaceId: "AUDITFLOW-WEB::shared", snapshot: importedAssessmentSnapshot(stellantis) }
  ].filter(item => item.snapshot);
}

export async function syncCoreAssessmentProjects({ store, administrator, addMember, extraProjects = [] }) {
  const projects = [...buildCoreProjects(), ...extraProjects];
  const created = [];
  const membersAdded = [];
  for (const item of projects) {
    let entry = await store.project(item.projectId);
    if (!entry) {
      try {
        await store.saveProject(item.projectId, {
          expectedRevision: 0,
          workspaceId: item.workspaceId,
          changeSummary: `Core assessment project synchronized from ${item.snapshot.importSource?.importId || item.snapshot.bootstrap?.key || item.projectId}`,
          snapshot: item.snapshot
        }, administrator);
        created.push(item.projectId);
      } catch (error) {
        if (error?.status !== 409 && error?.code !== "ER_DUP_ENTRY") throw error;
      }
      entry = await store.project(item.projectId);
    }
    if (entry && typeof addMember === "function" && await addMember(item.projectId, administrator)) membersAdded.push(item.projectId);
  }
  return { created, membersAdded };
}
