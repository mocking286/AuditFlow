(function (root) {
  "use strict";

  const text = value => String(value ?? "").trim();
  const issueKey = issue => text(issue?.key || issue?.id);
  const sourceFields = issue => ({
    title: text(issue.summary || issue.title),
    description: text(issue.description),
    owner: text(typeof issue.assignee === "object" ? issue.assignee?.displayName || issue.assignee?.name : issue.assignee),
    dueDate: text(issue.dueDate || issue.duedate),
    process: text(issue.processArea || issue.process)
  });

  function mergeIssues(project, issues, { now = new Date().toISOString(), actor = "JiraFlow" } = {}) {
    project.ncRecords = Array.isArray(project.ncRecords) ? project.ncRecords : [];
    let created = 0;
    let updated = 0;
    for (const issue of issues || []) {
      const key = issueKey(issue);
      if (!key) continue;
      const localOrigin = text(issue.sourceSystem).toLowerCase() === "jeauditflow";
      const sourceNcId = text(issue.sourceNcId || issue.sourceIssueId);
      const record = project.ncRecords.find(item =>
        text(item.jiraFlowKey) === key ||
        text(item.externalTicket) === key ||
        (localOrigin && sourceNcId && text(item.id) === sourceNcId)
      );
      const metadata = {
        key,
        revision: issue.revision ?? null,
        status: text(issue.status),
        projectKey: text(issue.projectKey),
        sourceSystem: text(issue.sourceSystem) || "JiraFlow",
        updated: text(issue.updated || issue.updatedAt)
      };
      if (record) {
        const before = JSON.stringify(record);
        // An upstream echo can acknowledge a local finding, but it cannot
        // replace its assessor-owned content or its formal closure decision.
        if (!localOrigin && record.sourceKind === "jiraflow") {
          const nextSource = sourceFields(issue);
          const previous = record.jiraFlowSource || {};
          for (const [field, value] of Object.entries(nextSource)) {
            if (record[field] === previous[field] || !text(record[field])) record[field] = value;
          }
          record.jiraFlowSource = nextSource;
        }
        record.jiraFlowKey = key;
        record.externalTicket ||= key;
        record.jiraFlow = metadata;
        if (JSON.stringify(record) !== before) {
          record.updatedAt = now;
          record.updatedBy = actor;
          updated += 1;
        }
        continue;
      }
      // A local-origin ticket whose source NC is unavailable must not be
      // reimported as a second NC through a project or process permission gap.
      if (localOrigin) continue;
      const fields = sourceFields(issue);
      project.ncRecords.push({
        id: `NC-JF-${key}`,
        ...fields,
        title: fields.title || key,
        status: "open",
        severity: text(issue.severity || issue.priority) || "Minor",
        sourceKind: "jiraflow",
        sourceSystem: "JiraFlow",
        sourceIssueId: key,
        jiraFlowKey: key,
        externalTicket: key,
        jiraFlow: metadata,
        jiraFlowSource: fields,
        reviewed: false,
        evidenceIds: [],
        indicators: [],
        originAssessmentId: project.id,
        originAssessmentLabel: project.name || project.id,
        instanceId: project.activeInstanceId || "",
        workspaceId: project.activeWorkspaceId || "",
        history: [{ from: "jiraflow-import", to: "open", at: now, by: actor }],
        createdAt: now,
        createdBy: actor
      });
      created += 1;
    }
    return { created, updated, changed: created + updated > 0 };
  }

  root.AuditFlowNcJiraModel = Object.freeze({ mergeIssues });
})(globalThis);
