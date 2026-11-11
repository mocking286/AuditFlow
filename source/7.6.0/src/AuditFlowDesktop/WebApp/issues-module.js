/* JEAuditFlow 6.1 issue center model.
 * The module normalizes local issue sources before the UI applies filters or
 * renders cards. It deliberately keeps the source object attached so assessor
 * actions continue to update the authoritative project record.
 */
(() => {
  /**
   * @typedef {Object} AuditFlowIssue
   * @property {string} key Stable project/source key used by selection state.
   * @property {Object} project Authoritative project object.
   * @property {"nc"|"wbs"|"qa"} kind Local issue source.
   * @property {string} id Human-readable issue id.
   * @property {string} title Short issue summary.
   * @property {string} description Observed facts or source description.
   * @property {"open"|"in-progress"|"pending-verification"|"closed"|"reopened"|"escalated"} status
   * @property {string} severity
   * @property {string} owner
   * @property {string} dueDate
   * @property {string} process
   * @property {string[]} indicators
   * @property {string} locator
   * @property {string[]} evidenceIds
   * @property {Object} source Authoritative source record.
   * @property {string} sourceLabel
   * @property {Object[]} history
   * @property {string} recordId
   */

  const STATUS_ORDER = Object.freeze(["open", "in-progress", "pending-verification", "closed"]);
  const STATUS_LABELS = Object.freeze({
    open: { zh: "待处理", en: "Open" },
    "in-progress": { zh: "整改中", en: "In progress" },
    "pending-verification": { zh: "待验证", en: "Pending verification" },
    closed: { zh: "已关闭", en: "Closed" },
    reopened: { zh: "重新打开", en: "Reopened" },
    escalated: { zh: "已升级", en: "Escalated" }
  });
  const TYPE_LABELS = Object.freeze({
    nc: { zh: "NC / Finding", en: "NC / Finding" },
    wbs: { zh: "WBS 问题", en: "WBS issue" },
    qa: { zh: "QA 候选", en: "QA candidate" },
    jiraflow: { zh: "JiraFlow 问题", en: "JiraFlow issue" }
  });
  const STATUS_ALIASES = new Map([
    ["backlog", "open"], ["todo", "open"], ["new", "open"], ["opened", "open"], ["待处理", "open"], ["开放", "open"],
    ["doing", "in-progress"], ["in progress", "in-progress"], ["in_progress", "in-progress"], ["in-progress", "in-progress"],
    ["处理中", "in-progress"], ["进行中", "in-progress"], ["整改中", "in-progress"],
    ["review", "pending-verification"], ["pending", "pending-verification"], ["pending_verification", "pending-verification"],
    ["pending verification", "pending-verification"], ["待验证", "pending-verification"],
    ["done", "closed"], ["complete", "closed"], ["completed", "closed"], ["closed", "closed"], ["已关闭", "closed"],
    ["reopen", "reopened"], ["reopened", "reopened"], ["重新打开", "reopened"],
    ["escalated", "escalated"], ["升级", "escalated"], ["已升级", "escalated"]
  ]);

  const asText = value => String(value ?? "").trim();
  const asArray = value => (Array.isArray(value) ? value : [value]).filter(Boolean).map(asText);
  const firstText = (...values) => values.map(asText).find(Boolean) || "";

  function normalizeStatus(value, fallback = "open") {
    const text = asText(value).toLowerCase().replace(/\s+/g, " ");
    if (STATUS_ALIASES.has(text)) return STATUS_ALIASES.get(text);
    if (/cancel|取消/.test(text)) return "closed";
    if (/progress|ongoing|处理中|进行/.test(text)) return "in-progress";
    if (/verify|review|验证|复核/.test(text)) return "pending-verification";
    if (/close|done|complete|已关闭|完成/.test(text)) return "closed";
    return STATUS_ORDER.includes(text) || ["reopened", "escalated"].includes(text) ? text : fallback;
  }

  function normalizeIssue(project, kind, source, fields = {}) {
    const rawId = firstText(fields.id, source?.id, source?.issue, fields.fallbackId);
    const id = rawId || `${kind.toUpperCase()}-UNIDENTIFIED`;
    const rawStatus = fields.status ?? source?.status;
    const issue = {
      key: `${project?.id || "project"}:${kind}:${id}`,
      project,
      kind,
      id,
      title: firstText(fields.title, source?.title, source?.description, source?.text, id),
      description: firstText(fields.description, source?.description, source?.text, source?.title),
      status: normalizeStatus(rawStatus, "") || asText(rawStatus) || "open",
      severity: firstText(fields.severity, source?.severity, "Major"),
      owner: firstText(fields.owner, source?.owner),
      dueDate: firstText(fields.dueDate, source?.dueDate, source?.due),
      process: firstText(fields.process, source?.process, source?.selectedProcess, source?.primaryProcess),
      indicators: asArray(fields.indicators ?? source?.indicators ?? source?.indicator),
      locator: firstText(fields.locator, source?.locator, source?.sourceCell),
      evidenceIds: asArray(fields.evidenceIds ?? source?.evidenceIds ?? source?.sourceEvidenceId),
      source,
      sourceLabel: firstText(fields.sourceLabel, source?.originAssessmentLabel, source?.sourceEvidenceCode, source?.sourceFile, source?.checklistId, project?.name, project?.id),
      history: Array.isArray(fields.history ?? source?.history) ? [...(fields.history ?? source?.history)] : [],
      recordId: firstText(fields.recordId, source?.sourceRecordId, source?.key, source?.id, source?.issue, id),
      revision: Number(fields.revision ?? source?.revision ?? 0) || 0,
      external: Boolean(fields.external),
      candidateOnly: Boolean(fields.candidateOnly ?? source?.candidateOnly ?? source?.aiCandidate)
    };
    return Object.freeze(issue);
  }

  function normalizeJiraFlowIssue(project, source = {}) {
    const assignee = source.assignee && typeof source.assignee === "object"
      ? source.assignee.displayName || source.assignee.name || source.assignee.accountId
      : source.assignee;
    const status = source.status && typeof source.status === "object"
      ? source.status.name || source.status.statusCategory?.name
      : source.status;
    return normalizeIssue(project, "jiraflow", source, {
      id: source.key || source.id,
      title: source.summary || source.title || source.key,
      description: source.description || source.summary || "",
      status,
      severity: source.priority?.name || source.priority || "Unprioritized",
      owner: assignee,
      dueDate: source.dueDate || source.due,
      process: source.processArea || source.process || source.labels?.find(value => /^[A-Z]{2,5}\.\d/.test(String(value))) || "",
      indicators: source.indicators || source.indicator || [],
      locator: source.locator || "",
      evidenceIds: [],
      sourceLabel: "JiraFlow",
      recordId: source.key || source.id,
      revision: source.revision,
      external: true,
      candidateOnly: false
    });
  }

  function jiraStatusValue(value) {
    if (value && typeof value === "object") return firstText(value.name, value.statusCategory?.name);
    return asText(value);
  }

  function workflowStatusKey(value) {
    const text = jiraStatusValue(value);
    return normalizeStatus(text, "") || text.toLowerCase();
  }

  function jiraFlowTransitionsForIssue(issue, transitions = []) {
    const currentStatus = jiraStatusValue(issue?.source?.status) || jiraStatusValue(issue?.status);
    const currentKey = workflowStatusKey(currentStatus);
    if (!currentKey || !Array.isArray(transitions)) return [];
    const seenTargets = new Set();
    return transitions
      .filter(transition => transition && transition.enabled !== false
        && workflowStatusKey(transition.from) === currentKey)
      .map(transition => ({
        id: transition.id,
        name: firstText(transition.name, jiraStatusValue(transition.to)),
        targetStatus: jiraStatusValue(transition.to)
      }))
      .filter(transition => {
        const targetKey = workflowStatusKey(transition.targetStatus);
        if (!transition.targetStatus || !targetKey || targetKey === currentKey || seenTargets.has(targetKey)) return false;
        seenTargets.add(targetKey);
        return true;
      });
  }

  function isJiraFlowTransitionAcknowledged(outcome) {
    return outcome === "applied" || outcome === "duplicate";
  }

  function collect(projects, { ncRecordsForProject, jiraFlowIssuesForProject } = {}) {
    const result = [];
    (Array.isArray(projects) ? projects : []).forEach(project => {
      const ncRecords = typeof ncRecordsForProject === "function"
        ? ncRecordsForProject(project)
        : Array.isArray(project?.ncRecords) ? project.ncRecords : [];
      ncRecords.forEach(record => result.push(normalizeIssue(project, "nc", record)));
      (project?.actionPlanIssues || []).forEach((issue, index) => result.push(normalizeIssue(project, "wbs", issue, {
        id: issue.issue || issue.id || `WBS-${index + 1}`,
        fallbackId: `WBS-${index + 1}`,
        title: issue.title || issue.originalProblem || issue.auditExplanation || issue.description || issue.issue,
        description: issue.auditExplanation || issue.originalProblem || issue.description,
        status: issue.status === "closed" ? "closed" : issue.status,
        process: issue.selectedProcess || issue.process,
        indicators: issue.indicators,
        locator: issue.locator || issue.sourceCell,
        evidenceIds: issue.sourceEvidenceId ? [issue.sourceEvidenceId] : [],
        sourceLabel: issue.sourceEvidenceCode || issue.sourceFile,
        recordId: issue.id || issue.issue
      })));
      (project?.qaChecklistCandidates || [])
        .filter(candidate => !candidate.formalRecordId && candidate.candidateState !== "rejected")
        .forEach(candidate => result.push(normalizeIssue(project, "qa", candidate, {
          title: candidate.title || candidate.checklistQuestion || candidate.id,
          description: candidate.originalProblem || candidate.opinion || candidate.checklistQuestion,
          status: candidate.disposition === "NOK" ? "open" : "pending-verification",
          process: candidate.primaryProcess || candidate.process,
          locator: candidate.locator || candidate.sourceCell,
          evidenceIds: candidate.sourceEvidenceId ? [candidate.sourceEvidenceId] : [],
          sourceLabel: candidate.checklistId || candidate.sourceFile
        })));
      const jiraFlowIssues = typeof jiraFlowIssuesForProject === "function"
        ? jiraFlowIssuesForProject(project)
        : [];
      (Array.isArray(jiraFlowIssues) ? jiraFlowIssues : [])
        .forEach(issue => result.push(normalizeJiraFlowIssue(project, issue)));
    });
    return result;
  }

  function filter(issues, { projectId = "", status = "all", kind = "all", query = "" } = {}) {
    const normalizedQuery = asText(query).toLowerCase();
    return (Array.isArray(issues) ? issues : []).filter(issue => {
      if (projectId && issue.project?.id !== projectId) return false;
      if (status !== "all" && issue.status !== status) return false;
      if (kind !== "all" && issue.kind !== kind) return false;
      if (!normalizedQuery) return true;
      return [
        issue.id, issue.title, issue.description, issue.process, issue.owner,
        issue.sourceLabel, ...issue.indicators
      ].join(" ").toLowerCase().includes(normalizedQuery);
    });
  }

  function groupByStatus(issues) {
    const buckets = { todo: [], doing: [], review: [], done: [] };
    const custom = new Map();
    (Array.isArray(issues) ? issues : []).forEach(issue => {
      const status = asText(issue?.status);
      if (issue?.external && !STATUS_ORDER.includes(status)) {
        if (!custom.has(status)) custom.set(status, []);
        custom.get(status).push(issue);
        return;
      }
      const bucket = status === "closed"
        ? "done"
        : status === "pending-verification"
          ? "review"
          : status === "in-progress"
            ? "doing"
            : "todo";
      buckets[bucket].push(issue);
    });
    buckets.custom = [...custom.entries()]
      .sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: "base" }))
      .map(([status, grouped]) => ({ key: status, status, issues: grouped, count: grouped.length }));
    return buckets;
  }

  function groupBy(issues, dimension = "process") {
    const field = ["process", "kind", "owner"].includes(asText(dimension)) ? asText(dimension) : "process";
    const groups = new Map();
    (Array.isArray(issues) ? issues : []).forEach(issue => {
      const raw = asText(issue?.[field]);
      const key = raw || "__unassigned__";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(issue);
    });
    return [...groups.entries()]
      .sort(([leftKey, leftIssues], [rightKey, rightIssues]) => {
        if (leftKey === "__unassigned__") return 1;
        if (rightKey === "__unassigned__") return -1;
        return leftKey.localeCompare(rightKey, undefined, { sensitivity: "base" });
      })
      .map(([key, grouped]) => ({
        key,
        label: key === "__unassigned__" ? "Unassigned" : key,
        count: grouped.length,
        issues: grouped
      }));
  }

  function canDrag(issue, jiraFlowWorkflow = []) {
    if (issue?.kind === "nc" && !issue.candidateOnly) return true;
    return issue?.kind === "jiraflow" && jiraFlowTransitionsForIssue(issue, jiraFlowWorkflow).length > 0;
  }

  function summary(issues) {
    const list = Array.isArray(issues) ? issues : [];
    return {
      total: list.length,
      open: list.filter(issue => issue.status === "open").length,
      inProgress: list.filter(issue => issue.status === "in-progress").length,
      pendingVerification: list.filter(issue => issue.status === "pending-verification").length,
      closed: list.filter(issue => issue.status === "closed").length,
      missingOwner: list.filter(issue => !issue.owner).length,
      missingDueDate: list.filter(issue => !issue.dueDate).length,
      missingLocator: list.filter(issue => !issue.external && !issue.locator).length,
      missingTrace: list.filter(issue => !issue.external && (!issue.evidenceIds.length || !issue.process)).length,
      jiraFlow: list.filter(issue => issue.external).length
    };
  }

  function encodeViewState(state = {}) {
    return new URLSearchParams({
      project: asText(state.projectId),
      status: asText(state.status || "all"),
      type: asText(state.kind || "all"),
      q: asText(state.query)
    }).toString();
  }

  function decodeViewState(value = "") {
    const params = new URLSearchParams(asText(value).replace(/^#?\??/, ""));
    return {
      projectId: params.get("project") || "",
      status: params.get("status") || "all",
      kind: params.get("type") || "all",
      query: params.get("q") || ""
    };
  }

  globalThis.AuditFlowIssues = Object.freeze({
    STATUS_ORDER,
    STATUS_LABELS,
    TYPE_LABELS,
    normalizeStatus,
    normalizeIssue,
    normalizeJiraFlowIssue,
    jiraFlowTransitionsForIssue,
    isJiraFlowTransitionAcknowledged,
    collect,
    filter,
    groupByStatus,
    groupBy,
    canDrag,
    summary,
    encodeViewState,
    decodeViewState
  });
})();
