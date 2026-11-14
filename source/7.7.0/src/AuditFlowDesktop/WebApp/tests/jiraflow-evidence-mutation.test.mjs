import assert from "node:assert/strict";
import { test } from "node:test";
import {
  JIRAFLOW_EVIDENCE_AUTHORITY,
  mutateProject,
  normalizePermissions
} from "../collaboration-model.mjs";

const lead = { userId: "finding-lead", userName: "Lead Assessor" };
const inScope = { userId: "finding-assessor", userName: "Process Assessor" };
const outOfScope = { userId: "finding-other", userName: "Other Process Assessor" };
const viewer = { userId: "finding-viewer", userName: "Read Only" };
const projectId = "JIRAFLOW-FINDING-LINK";

function fixture() {
  let entry = mutateProject("saveProject", null, projectId, {
    expectedRevision: 0,
    snapshot: {
      id: projectId,
      name: "JiraFlow finding link fixture",
      processes: ["SYS.2", "SWE.1"],
      assessmentState: "Open",
      assessments: [
        { id: "A1", process: "SYS.2", code: "BP1", rating: "P", reviewed: false },
        { id: "A2", process: "SWE.1", code: "BP1", rating: "L", reviewed: true }
      ],
      records: [{
        id: "NC-SYS2-1", type: "weakness", indicators: ["SYS.2.BP1"], status: "Draft",
        closureState: "待处理", rating: "P", reviewed: false, text: "Traceability evidence is incomplete",
        evidenceIds: ["EV-1"], evidenceAnalysis: []
      }],
      ncRecords: [],
      evidence: [{ id: "EV-1", code: "EV-1", name: "Baseline review", content: "Assessor evidence" }]
    }
  }, lead).entry;
  for (const [identity, process, role] of [[inScope, "SYS.2", "Assessor"], [outOfScope, "SWE.1", "Assessor"], [viewer, "SYS.2", "Viewer"]]) {
    entry = mutateProject("setMember", entry, projectId, {
      expectedRevision: entry.revision,
      userId: identity.userId,
      name: identity.userName,
      role,
      processScopes: [process],
      permissions: normalizePermissions(role)
    }, lead).entry;
  }
  return entry;
}

function request(entry, actor = lead, overrides = {}) {
  return {
    authority: JIRAFLOW_EVIDENCE_AUTHORITY,
    expectedRevision: entry.revision,
    jiraFlowProjectId: projectId,
    jiraFlowProjectKey: "AF-FINDING",
    issueKey: "AF-FINDING-41",
    issueSummary: "Reconcile approval trace",
    issueDescription: "The remediation ticket requires the missing approval trace and verification result.",
    issueStatus: "Open",
    issueUrl: "/jiraflow/",
    sourceIssueId: "NC-SYS2-1",
    targetRecordId: "NC-SYS2-1",
    process: "SYS.2",
    indicator: "SYS.2.BP1",
    ...overrides
  };
}

test("verified JiraFlow issue is linked as corroborating evidence without changing finding decisions", () => {
  const entry = fixture();
  const before = structuredClone(entry.snapshot.records[0]);
  const result = mutateProject("applyJiraFlowEvidence", entry, projectId, request(entry), lead);
  const finding = result.entry.snapshot.records[0];
  const evidence = result.entry.snapshot.evidence.find(item => item.issueKey === "AF-FINDING-41");
  assert.equal(result.entry.revision, entry.revision + 1);
  assert.ok(finding.evidenceIds.includes(evidence.id));
  assert.equal(evidence.findingRecordId, finding.id);
  assert.equal(evidence.sourceIssueId, finding.id);
  assert.equal(evidence.content, "The remediation ticket requires the missing approval trace and verification result.");
  assert.equal(evidence.status, "Open");
  assert.equal(evidence.issueUrl, "/jiraflow/?issueKey=AF-FINDING-41");
  assert.equal(evidence.evidenceRole, "corroborating");
  assert.equal(finding.evidenceAnalysis[0].strength, "corroborating");
  assert.equal(finding.rating, before.rating);
  assert.equal(finding.status, before.status);
  assert.equal(finding.closureState, before.closureState);
  assert.equal(finding.reviewed, before.reviewed);
  assert.equal(result.result.event.change.type, "jiraflow-evidence");
});

test("same issue creation retry is idempotent and cannot link an issue to another finding", () => {
  const entry = fixture();
  const first = mutateProject("applyJiraFlowEvidence", entry, projectId, request(entry), lead);
  const retry = mutateProject("applyJiraFlowEvidence", first.entry, projectId, request(first.entry), lead);
  assert.equal(retry.result.duplicate, true);
  assert.equal(retry.entry.revision, first.entry.revision);
  assert.equal(retry.entry.snapshot.evidence.filter(item => item.issueKey === "AF-FINDING-41").length, 1);
  assert.throws(
    () => mutateProject("applyJiraFlowEvidence", first.entry, projectId, request(first.entry, lead, { targetRecordId: "ANOTHER-FINDING" }), lead),
    { status: 404 }
  );
});

test("JiraFlow readback status updates linked evidence without changing finding decisions or regressing revisions", () => {
  const entry = fixture();
  const first = mutateProject("applyJiraFlowEvidence", entry, projectId, request(entry, lead, { issueRevision: 1 }), lead);
  const before = structuredClone(first.entry.snapshot.records[0]);
  const updated = mutateProject("applyJiraFlowEvidence", first.entry, projectId, request(first.entry, lead, {
    issueRevision: 2,
    issueSummary: "Approval trace remediation",
    issueDescription: "Owner added the missing approval trace.",
    issueStatus: "In Progress"
  }), lead);
  const finding = updated.entry.snapshot.records[0];
  const evidence = updated.entry.snapshot.evidence.find(item => item.issueKey === "AF-FINDING-41");
  assert.equal(updated.entry.revision, first.entry.revision + 1);
  assert.equal(evidence.status, "In Progress");
  assert.equal(evidence.summary, "Approval trace remediation");
  assert.equal(evidence.content, "Owner added the missing approval trace.");
  assert.equal(finding.jiraFlow.status, "In Progress");
  assert.equal(finding.evidenceAnalysis.at(-1).status, "In Progress");
  assert.equal(finding.rating, before.rating);
  assert.equal(finding.status, before.status);
  assert.equal(finding.closureState, before.closureState);

  const stale = mutateProject("applyJiraFlowEvidence", updated.entry, projectId, request(updated.entry, lead, {
    issueRevision: 1,
    issueSummary: "Reconcile approval trace",
    issueDescription: "The remediation ticket requires the missing approval trace and verification result.",
    issueStatus: "Open"
  }), lead);
  assert.equal(stale.entry.revision, updated.entry.revision);
  assert.equal(stale.entry.snapshot.evidence.find(item => item.issueKey === "AF-FINDING-41").status, "In Progress");
});

test("mutation requires a server token, valid mapping and JiraFlow issue key belonging to that project", () => {
  const entry = fixture();
  assert.throws(
    () => mutateProject("applyJiraFlowEvidence", entry, projectId, { ...request(entry), authority: undefined }, lead),
    { status: 403 }
  );
  for (const fields of [
    { jiraFlowProjectId: "OTHER-PROJECT" },
    { jiraFlowProjectKey: "INVALID PROJECT" },
    { issueKey: "OTHER-41" },
    { issueUrl: "https://attacker.example/issue/AF-FINDING-41" },
    { issueUrl: "//attacker.example/jiraflow/" }
  ]) {
    assert.throws(
      () => mutateProject("applyJiraFlowEvidence", entry, projectId, request(entry, lead, fields), lead),
      error => error.status === 400 || error.status === 403
    );
  }
});

test("only members with use permission for the target process may attach issue evidence", () => {
  const entry = fixture();
  assert.throws(
    () => mutateProject("applyJiraFlowEvidence", entry, projectId, request(entry, viewer), viewer),
    { status: 403 }
  );
  assert.throws(
    () => mutateProject("applyJiraFlowEvidence", entry, projectId, request(entry, outOfScope), outOfScope),
    { status: 403 }
  );
  const allowed = mutateProject("applyJiraFlowEvidence", entry, projectId, request(entry, inScope, {
    issueKey: "AF-FINDING-42"
  }), inScope);
  assert.equal(allowed.entry.snapshot.evidence.at(-1).evidenceRole, "corroborating");
});

test("stale project save preserves verified JiraFlow evidence and restores its finding link", () => {
  const entry = fixture();
  const linked = mutateProject("applyJiraFlowEvidence", entry, projectId, request(entry), lead);
  const staleView = structuredClone(linked.entry.snapshot);
  staleView.evidence = staleView.evidence.filter(item => item.sourceKind !== "jiraflow-assessment-finding");
  staleView.records[0].evidenceIds = ["EV-1"];
  staleView.records[0].evidenceAnalysis = [];
  staleView.evidence.push({
    id: "JIRAFLOW-FAKE-1",
    issueKey: "AF-FINDING-41",
    sourceKind: "jiraflow-assessment-finding",
    evidenceRole: "direct",
    findingRecordId: "NC-SYS2-1"
  });
  const saved = mutateProject("saveProject", linked.entry, projectId, {
    expectedRevision: linked.entry.revision,
    snapshot: staleView,
    changeSummary: "Snapshot sync"
  }, lead);
  const evidence = saved.entry.snapshot.evidence.filter(item => item.sourceKind === "jiraflow-assessment-finding");
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].issueKey, "AF-FINDING-41");
  assert.equal(evidence[0].evidenceRole, "corroborating");
  assert.ok(saved.entry.snapshot.records[0].evidenceIds.includes(evidence[0].id));
  assert.equal(saved.entry.snapshot.records[0].status, "Draft");
  assert.equal(saved.entry.snapshot.records[0].closureState, "待处理");
});

test("deleting the linked weakness drops its JiraFlow evidence", () => {
  const entry = fixture();
  const linked = mutateProject("applyJiraFlowEvidence", entry, projectId, request(entry), lead);
  const snapshot = structuredClone(linked.entry.snapshot);
  snapshot.records = snapshot.records.filter(record => record.id !== "NC-SYS2-1");

  const saved = mutateProject("saveProject", linked.entry, projectId, {
    expectedRevision: linked.entry.revision,
    snapshot,
    changeSummary: "Delete weakness finding"
  }, lead);

  assert.equal(saved.entry.snapshot.records.some(record => record.id === "NC-SYS2-1"), false);
  assert.equal(saved.entry.snapshot.evidence.some(item => item.sourceKind === "jiraflow-assessment-finding"), false);
});
