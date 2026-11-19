/* Shared candidate-only rules for the browser workbench and local backend. */
(function registerQaChecklistWorkflow(root) {
  "use strict";

  const PROCESS_LINKS = Object.freeze({
    "SUP.1": ["SUP.9"],
    "SUP.8": ["MAN.3", "SPL.2"],
    "SUP.9": ["SUP.10", "SUP.8"],
    "SUP.10": ["SUP.8"],
    "MAN.3": ["SUP.1", "SUP.8", "SUP.9", "SUP.10"],
    "SPL.2": ["SUP.8", "SUP.10"]
  });

  const CLOSURE_BY_PROCESS = Object.freeze({
    "SUP.1": ["QA finding and sample locator", "SUP.9 problem link or documented screening rationale", "independent closure verification and quality report"],
    "SUP.8": ["CI identity and version/status", "approved baseline or snapshot", "integrity/status-accounting evidence"],
    "SUP.9": ["problem record and root-cause analysis", "owner, due date and affected work products", "fix verification, closure approval and trend/reopen state"],
    "SUP.10": ["CR record and cross-process impact analysis", "approval before implementation", "verification, notification and updated SUP.8 baseline"],
    "MAN.3": ["approved plan, scope, schedule and resource baseline", "status/deviation and corrective-action records", "closure report and lessons learned"],
    "SPL.2": ["release content and entry criteria", "approved configured release package and release note", "delivery record and known restrictions"],
    "ORG": ["unique lesson-learned record and root cause", "action owner, due date and affected work products", "effectiveness check and controlled reuse record"]
  });

  const CHECKLIST_SAMPLING_BASIS = "projectId|checklistId|sourceDocument|sourceSheet|sourceRow";
  const INDICATOR_PATTERN = /\b([A-Z]{2,8}\.\d+)\.(BP\d+|GP\s?\d+\.\d+\.\d+)\b/gi;
  const REVIEW_STATE_ALIASES = Object.freeze({
    "": "pending",
    pending: "pending",
    queued: "pending",
    candidate: "pending",
    "not started": "pending",
    "in-review": "in-review",
    reviewing: "in-review",
    running: "in-review",
    processing: "in-review",
    complete: "complete",
    completed: "complete",
    reviewed: "complete",
    done: "complete",
    "needs-assessor-confirmation": "needs-assessor-confirmation",
    "assessor-confirmation-required": "needs-assessor-confirmation",
    "awaiting assessor confirmation": "needs-assessor-confirmation",
    confirmed: "confirmed",
    accepted: "confirmed",
    rejected: "rejected",
    dismissed: "rejected",
    failed: "failed",
    error: "failed"
  });

  function normalizeDisposition(value) {
    const normalized = String(value || "").trim().toUpperCase();
    if (["NOK", "N", "FAILED", "FAIL", "不符合", "未满足"].includes(normalized)) return "NOK";
    if (["NA", "N/A", "NOT APPLICABLE", "不适用"].includes(normalized)) return "NA";
    if (["OK", "Y", "PASS", "符合", "满足"].includes(normalized)) return "OK";
    return "UNASSESSED";
  }

  function normalizeProcess(value) {
    return String(value || "").trim().toUpperCase();
  }

  function stableChecklistHash(value) {
    let hash = 2166136261;
    for (const character of String(value || "")) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  function checklistSamplingKey(entry = {}, projectId = "") {
    const fields = [
      projectId,
      entry.checklistId || entry.id,
      entry.sourceDocument || entry.sourceFile,
      entry.sourceSheet || entry.sheet,
      entry.sourceRow ?? entry.row
    ];
    return fields.map(value => String(value ?? "").trim()).join("|");
  }

  function selectChecklistEntries({ projectId = "", entries = [], processScope = [], largeThreshold = 100, sampleRate = 0.1 } = {}) {
    const scopeValues = Array.isArray(processScope) ? processScope : [processScope];
    const scope = new Set(scopeValues.map(normalizeProcess).filter(Boolean));
    const scopedEntries = (Array.isArray(entries) ? entries : []).filter(entry => {
      const process = normalizeProcess(entry?.process || entry?.primaryProcess);
      return !scope.size || scope.has(process);
    });
    const keyed = scopedEntries.map((entry, index) => ({
      entry,
      index,
      key: checklistSamplingKey(entry, projectId),
      hash: stableChecklistHash(checklistSamplingKey(entry, projectId))
    }));
    const totalCount = keyed.length;
    const numericThreshold = Number.isFinite(Number(largeThreshold)) ? Math.max(0, Number(largeThreshold)) : 100;
    const numericRate = Number.isFinite(Number(sampleRate)) ? Math.min(1, Math.max(0, Number(sampleRate))) : 0.1;
    const sampled = totalCount > numericThreshold;
    const selectedCount = totalCount === 0
      ? 0
      : sampled
        ? Math.min(totalCount, Math.max(1, Math.ceil(totalCount * numericRate)))
        : totalCount;
    const ranked = sampled
      ? [...keyed].sort((left, right) => left.hash.localeCompare(right.hash) || left.key.localeCompare(right.key) || left.index - right.index)
      : keyed;
    const selected = ranked.slice(0, selectedCount).sort((left, right) => left.index - right.index);
    const selectedEntries = selected.map(item => item.entry);
    const selectedKeys = selected.map(item => item.key);
    const allKeys = keyed.map(item => item.key).sort();
    const samplingHash = stableChecklistHash([String(projectId || "").trim(), ...allKeys, ...selectedKeys.slice().sort()].join("\n"));
    const selectedIds = [...new Set(selectedEntries.map(entry => String(entry?.checklistId || entry?.id || "").trim()).filter(Boolean))];
    return {
      entries: selectedEntries,
      selectedEntries,
      scopedEntries: scopedEntries.slice(),
      selectedIds,
      selectedKeys,
      totalCount,
      selectedCount,
      samplingMode: totalCount === 0 ? "none" : sampled ? "deterministic-10-percent" : "full",
      samplingBasis: CHECKLIST_SAMPLING_BASIS,
      samplingHash,
      processScope: [...scope],
      largeThreshold: numericThreshold,
      sampleRate: numericRate
    };
  }

  function normalizeChecklistReviewState(value = "", candidate = {}) {
    if (candidate?.formalRecordId || candidate?.assessorConfirmed) return "confirmed";
    if (String(candidate?.candidateState || "").trim().toLowerCase() === "rejected") return "rejected";
    const raw = String(value || candidate?.reviewState || candidate?.candidateState || candidate?.status || "")
      .trim().toLowerCase().replace(/_/g, "-");
    if (raw) return REVIEW_STATE_ALIASES[raw] || "pending";
    const disposition = normalizeDisposition(candidate?.disposition || candidate?.checklistDisposition);
    return disposition === "NOK" || disposition === "NA" ? "needs-assessor-confirmation" : "pending";
  }

  function checklistReviewStateRecord(candidate = {}, value = "") {
    const state = normalizeChecklistReviewState(value, candidate);
    const candidateState = state === "confirmed" ? "confirmed" : state === "rejected" ? "rejected" : "pending";
    return {
      reviewState: state,
      candidateState,
      candidateOnly: true,
      reviewComplete: ["complete", "needs-assessor-confirmation", "confirmed", "rejected"].includes(state),
      assessorConfirmationRequired: !candidate?.assessorConfirmed && !candidate?.formalRecordId && candidateState !== "rejected",
      disposition: normalizeDisposition(candidate?.disposition || candidate?.checklistDisposition)
    };
  }

  function indicatorValues(value) {
    if (Array.isArray(value)) return value.flatMap(indicatorValues);
    if (value === null || value === undefined) return [];
    return [String(value)];
  }

  function normalizeIndicatorCode(value) {
    const match = String(value || "").trim().toUpperCase().match(/^([A-Z]{2,8}\.\d+)\.(BP\d+|GP\s?\d+\.\d+\.\d+)$/);
    if (!match) return "";
    const suffix = match[2].startsWith("GP") ? match[2].replace(/^GP\s*/, "GP ") : match[2];
    return `${match[1]}.${suffix}`;
  }

  function checklistProcessLinks(issue = {}, catalogEntry = null) {
    const primaryProcess = normalizeProcess(issue.primaryProcess || issue.selectedProcess || issue.process || catalogEntry?.process);
    const requestedRelated = [
      ...indicatorValues(issue.relatedProcesses),
      ...indicatorValues(issue.processLinks),
      ...indicatorValues(catalogEntry?.relatedProcesses)
    ].map(normalizeProcess).filter(Boolean);
    const relatedProcesses = [...new Set([...(PROCESS_LINKS[primaryProcess] || []), ...requestedRelated])]
      .filter(process => process && process !== primaryProcess);
    const rawIndicators = [
      issue.candidateIndicators,
      issue.indicatorCodes,
      issue.indicators,
      issue.bpGpReference,
      issue.bpGp,
      issue.indicator,
      issue.practice
    ].flatMap(indicatorValues);
    const indicators = [];
    for (const raw of rawIndicators) {
      const matches = raw.match(INDICATOR_PATTERN);
      if (matches?.length) {
        for (const match of matches) {
          const normalized = normalizeIndicatorCode(match);
          if (normalized) indicators.push(normalized);
        }
      } else {
        const normalized = normalizeIndicatorCode(raw);
        if (normalized) indicators.push(normalized);
      }
    }
    const allIndicators = [...new Set(indicators)];
    const allowedProcesses = new Set([primaryProcess, ...relatedProcesses].filter(Boolean));
    const processIndicators = {};
    for (const indicator of allIndicators) {
      const process = indicator.split(".").slice(0, 2).join(".");
      if (allowedProcesses.has(process)) (processIndicators[process] ||= []).push(indicator);
    }
    const candidateIndicators = [...(processIndicators[primaryProcess] || [])];
    const relatedIndicators = relatedProcesses.flatMap(process => processIndicators[process] || []);
    return {
      primaryProcess,
      relatedProcesses,
      candidateIndicators,
      relatedIndicators,
      allIndicators,
      processIndicators,
      candidateOnly: true
    };
  }

  function candidateKey(issue = {}) {
    return [issue.projectId, issue.checklistId, issue.sourceEvidenceId || issue.sourceEvidenceCode, issue.locator, issue.issue]
      .map(value => String(value || "").trim().toLowerCase()).join("|");
  }

  function analyzeCandidate(issue = {}, catalogEntry = null) {
    const process = String(issue.selectedProcess || issue.process || catalogEntry?.process || "").toUpperCase();
    const disposition = normalizeDisposition(issue.checklistDisposition || issue.answer || issue.status);
    const applicabilityRationale = String(issue.applicabilityRationale || "").trim();
    const evidenceLocator = String(issue.locator || issue.sourceCell || "").trim();
    const evidenceText = String(issue.evidenceExcerpt || issue.answersEvidence || "").trim();
    const explicitFinding = String(issue.originalProblem || issue.finding || issue.auditExplanation || "").trim();
    const hasEvidence = !!(issue.sourceEvidenceId || issue.sourceEvidenceCode || evidenceLocator || evidenceText);
    const isCandidateFinding = disposition === "NOK" || (disposition === "NA" && !applicabilityRationale);
    const candidateType = disposition === "NOK" ? "candidate-finding" : disposition === "NA" ? "applicability-review" : disposition === "OK" ? (hasEvidence ? "evidence-review" : "evidence-request") : "review-required";
    const title = String(issue.title || catalogEntry?.question || "Checklist review item").trim();
    const sourceQuestion = String(issue.checklistQuestion || catalogEntry?.question || title).trim();
    const processLinkData = checklistProcessLinks({ ...issue, primaryProcess: process }, catalogEntry);
    const linkProcesses = processLinkData.relatedProcesses;
    const closureEvidence = Array.isArray(issue.closureEvidence) && issue.closureEvidence.length
      ? issue.closureEvidence.map(value => String(value).trim()).filter(Boolean)
      : [...(catalogEntry?.closureEvidence || CLOSURE_BY_PROCESS[process] || CLOSURE_BY_PROCESS.ORG)];

    let opinion;
    if (disposition === "NOK") {
      opinion = explicitFinding
        ? "Candidate finding: the checklist records a nonconforming response. Verify the cited project execution evidence, impact, root cause and closure before confirmation."
        : "Candidate finding requires assessor review: the checklist records NOK but has no specific observed condition. Capture the objective deviation and source locator before confirmation.";
    } else if (disposition === "NA") {
      opinion = applicabilityRationale
        ? "Applicability rationale supplied; assessor must verify scope, trigger conditions and approval. No finding or rating is created by this response alone."
        : "Applicability challenge: NA has no rationale. Do not exclude the item; request the applicability basis and assessor approval.";
    } else if (disposition === "OK" && !hasEvidence) {
      opinion = "Evidence request only: OK is a self-reported response without a locatable source. Do not treat it as implementation evidence or a formal finding.";
    } else if (disposition === "OK") {
      opinion = "Evidence review only: verify that the cited source is current, controlled, representative and directly supports the target-process claim.";
    } else {
      opinion = "Review required: no checklist disposition is recorded. Do not infer conformity, nonconformity or not-applicable status.";
    }

    return {
      id: String(issue.id || issue.issue || catalogEntry?.id || ""),
      candidateKey: candidateKey({ ...issue, selectedProcess: process, checklistId: issue.checklistId || catalogEntry?.id }),
      primaryProcess: process,
      relatedProcesses: linkProcesses,
      candidateIndicators: processLinkData.candidateIndicators,
      relatedIndicators: processLinkData.relatedIndicators,
      processIndicators: processLinkData.processIndicators,
      checklistId: String(issue.checklistId || catalogEntry?.id || ""),
      checklistQuestion: sourceQuestion,
      disposition,
      candidateType,
      findingCandidate: isCandidateFinding ? {
        title,
        statement: explicitFinding || `Checklist item ${sourceQuestion} was marked NOK; the observed deviation must be captured and independently verified.`,
        rootCauseHypotheses: issue.rootCause ? [String(issue.rootCause)] : [],
        affectedWorkProducts: Array.isArray(issue.affectedWorkProducts) ? issue.affectedWorkProducts : [],
        requiresEvidenceLocator: true
      } : null,
      opinion,
      evidence: {
        present: hasEvidence,
        role: String(issue.evidenceRole || "corroborating"),
        locator: evidenceLocator,
        excerpt: evidenceText,
        directEvidenceRequired: true
      },
      risk: String(issue.risk || "Verify impact and affected work products; no risk level is assigned without project evidence."),
      solutionSteps: Array.isArray(issue.solutionSteps) && issue.solutionSteps.length
        ? issue.solutionSteps.map(value => String(value).trim()).filter(Boolean)
        : ["Confirm the observed condition and source locator.", "Assess impact and root cause with the responsible process owner.", "Link a SUP.9 problem and SUP.10 change when required.", "Verify updated work products and SUP.8 baseline before closure."],
      closureEvidence,
      closedLoop: {
        requiredProcesses: [process, ...linkProcesses],
        problemId: "",
        changeRequestId: "",
        affectedWorkProducts: Array.isArray(issue.affectedWorkProducts) ? issue.affectedWorkProducts : [],
        verification: "",
        baselineId: "",
        closureApproval: ""
      },
      candidateOnly: true,
      status: "Candidate",
      formalRating: null,
      needsAssessorConfirmation: true,
      noAutomaticNA: disposition === "NA",
      sourceDocument: String(issue.sourceDocument || catalogEntry?.sourceDocument || "").split(/[\\/]/).pop()
    };
  }

  function mergeModelCandidate(fallback, model = {}) {
    const modelIndicators = Array.isArray(model.candidateIndicators) ? model.candidateIndicators : [];
    const fallbackIndicators = Array.isArray(fallback.candidateIndicators) ? fallback.candidateIndicators : [];
    const safeIndicators = [...new Set([...fallbackIndicators, ...modelIndicators]
      .map(value => normalizeIndicatorCode(value))
      .filter(value => value && (!fallback.primaryProcess || value.startsWith(`${fallback.primaryProcess}.`))))].slice(0, 8);
    const merged = { ...fallback, ...model };
    merged.id = fallback.id;
    merged.primaryProcess = fallback.primaryProcess || (/^[A-Z]{2,6}\.\d+$/.test(String(model.primaryProcess || "").toUpperCase()) ? String(model.primaryProcess).toUpperCase() : "");
    merged.disposition = fallback.disposition;
    merged.candidateType = fallback.candidateType;
    merged.findingCandidate = fallback.findingCandidate ? { ...fallback.findingCandidate, ...(model.findingCandidate || {}) } : null;
    merged.candidateIndicators = safeIndicators;
    merged.candidateOnly = true;
    merged.status = "Candidate";
    merged.formalRating = null;
    merged.closedLoop = fallback.closedLoop;
    merged.evidence = fallback.evidence;
    merged.sourceDocument = fallback.sourceDocument;
    delete merged.rating;
    delete merged.aiCandidateRating;
    delete merged.achievementPercent;
    merged.needsAssessorConfirmation = true;
    merged.closureEvidence = Array.isArray(model.closureEvidence) && model.closureEvidence.length
      ? model.closureEvidence.map(value => String(value).trim()).filter(Boolean).slice(0, 12)
      : fallback.closureEvidence;
    return merged;
  }

  function upsertCandidate(items = [], candidate = {}) {
    const key = candidate.candidateKey || candidateKey(candidate);
    const index = items.findIndex(item => (item.candidateKey || candidateKey(item)) === key);
    if (index < 0) return { items: [...items, { ...candidate, candidateKey: key }], inserted: true };
    const existing = items[index];
    if (existing.formalRecordId || existing.candidateState === "rejected") return { items, inserted: false, preserved: true };
    const updated = [...items];
    updated[index] = { ...existing, ...candidate, candidateKey: key, assessorDisposition: existing.assessorDisposition, candidateState: existing.candidateState || candidate.candidateState };
    return { items: updated, inserted: false, preserved: false };
  }

  function confirmedDraftRecord({ issue, recordId, userName, indicatorCodes, evidenceIds = [], now = new Date().toISOString() } = {}) {
    if (!issue || issue.candidateState === "rejected" || issue.disposition !== "NOK") return { ok: false, reason: "Only an active NOK candidate can become a draft finding." };
    if (!issue.assessorConfirmed) return { ok: false, reason: "Assessor confirmation is required." };
    const process = String(issue.selectedProcess || issue.process || issue.primaryProcess || "").toUpperCase();
    const indicators = [...new Set((indicatorCodes || []).map(value => String(value).trim()).filter(value => value && process && value.startsWith(`${process}.`)))];
    if (!indicators.length) return { ok: false, reason: "Select at least one indicator in the confirmed process scope." };
    const locator = String(issue.confirmedLocator || issue.locator || issue.sourceCell || "").trim();
    if (!locator) return { ok: false, reason: "Add a locatable source reference before creating a draft finding." };
    const findingText = String(issue.confirmedFindingText || "").trim();
    if (findingText.length < 12 || /^Checklist item .* was marked NOK; the observed deviation must be captured and independently verified\.$/i.test(findingText)) {
      return { ok: false, reason: "Record the observed condition in the assessor-confirmed finding text." };
    }
    return {
      ok: true,
      record: {
        id: String(recordId || `QA-FINDING-${Date.now()}`),
        type: "weakness",
        text: findingText,
        indicators,
        evidenceIds: [...new Set(evidenceIds.map(value => String(value).trim()).filter(Boolean))],
        evidenceReferences: locator,
        creator: String(userName || "Assessor"),
        created: now,
        status: "Draft",
        closureState: "待处理",
        aiCandidate: false,
        assessorConfirmed: true,
        assessorConfirmedAt: now,
        sourceQaIssueId: String(issue.id || ""),
        sourceChecklistId: String(issue.checklistId || ""),
        closureChain: { problemId: "", rootCause: "", action: "", crId: "", crApproval: "", updatedWorkProducts: "", verification: "", regression: "", baselineId: "", closureApproval: "" },
        attachments: []
      }
    };
  }

  function connectorPreview() {
    return [
      { local: "issue", jira: "Issue Key", feishu: "问题编号", meego: "Issue ID" },
      { local: "process", jira: "Component / Label", feishu: "过程域", meego: "Process" },
      { local: "title", jira: "Summary", feishu: "问题主题", meego: "Summary" },
      { local: "originalProblem", jira: "Description", feishu: "原始问题", meego: "Description" },
      { local: "risk", jira: "Priority / Risk", feishu: "风险", meego: "Risk" },
      { local: "owner", jira: "Assignee", feishu: "责任人", meego: "Owner" },
      { local: "dueDate", jira: "Due Date", feishu: "截止日期", meego: "Due Date" },
      { local: "sourceEvidenceCode + locator", jira: "Evidence Link", feishu: "证据定位", meego: "Evidence Reference" },
      { local: "crId + affectedWorkProducts", jira: "Linked Issue / Affects", feishu: "关联变更 / 受影响工作产品", meego: "CR / Affected Work Products" },
      { local: "verification + baselineId", jira: "Resolution / Fix Version", feishu: "验证 / 基线", meego: "Verification / Baseline" }
    ];
  }

  root.AuditFlowQaChecklistWorkflow = Object.freeze({
    PROCESS_LINKS,
    CLOSURE_BY_PROCESS,
    CHECKLIST_SAMPLING_BASIS,
    normalizeDisposition,
    normalizeProcess,
    stableChecklistHash,
    checklistSamplingKey,
    selectChecklistEntries,
    normalizeChecklistReviewState,
    checklistReviewStateRecord,
    checklistProcessLinks,
    candidateKey,
    analyzeCandidate,
    mergeModelCandidate,
    upsertCandidate,
    confirmedDraftRecord,
    connectorPreview
  });
})(globalThis);
