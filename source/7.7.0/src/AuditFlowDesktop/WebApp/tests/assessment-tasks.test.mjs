import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAssessmentTaskChange,
  assessmentTaskAssignmentModalMarkup,
  assessmentTaskDashboardMarkup,
  readAssessmentTaskBoard,
  recordAssessmentTaskNotification,
  TASK_NOTIFICATION_AUTHORITY
} from "../assessment-tasks.mjs";
import { authorize, mutateProject, normalizePermissions } from "../collaboration-model.mjs";

const lead = { userId: "LEAD-1", userName: "Lead Assessor", account: { email: "lead@example.test" } };
const assessor = { userId: "ASSESSOR-1", userName: "Assessor One" };
const assessorTwo = { userId: "ASSESSOR-2", userName: "Assessor Two" };
const viewer = { userId: "VIEWER-1", userName: "Read Only" };

function entry() {
  return {
    projectId: "TASK-PROJECT",
    ownerId: lead.userId,
    workspaceId: "TEST",
    revision: 1,
    members: [
      { userId: lead.userId, name: lead.userName, role: "Lead Assessor", processScopes: ["*"], permissions: normalizePermissions("Lead Assessor") },
      { userId: assessor.userId, name: assessor.userName, role: "Assessor", processScopes: ["SYS.2"], permissions: normalizePermissions("Assessor") },
      { userId: assessorTwo.userId, name: assessorTwo.userName, role: "Assessor", processScopes: ["SYS.2"], permissions: normalizePermissions("Assessor") },
      { userId: viewer.userId, name: viewer.userName, role: "Viewer", processScopes: ["SYS.2"], permissions: normalizePermissions("Viewer") }
    ],
    locks: [],
    presence: [],
    events: [],
    snapshot: {
      id: "TASK-PROJECT",
      name: "Assessment fixture",
      processes: ["SYS.2"],
      assessments: [
        { id: "BP1", code: "BP1", process: "SYS.2", title: "Analyze stakeholder requirements", reviewed: false },
        { id: "BP2", code: "BP2", process: "SYS.2", title: "Structure stakeholder requirements", reviewed: false }
      ],
      records: [{ id: "NC-1", type: "weakness", text: "Traceability is not demonstrated", indicators: ["SYS.2.BP1"], closureState: "待处理" }],
      actionPlanIssues: [{ id: "ISSUE-1", process: "SYS.2", title: "Missing approval record" }]
    }
  };
}

function create(entryValue, actor = lead, body = {}) {
  const member = authorize(entryValue, actor);
  return applyAssessmentTaskChange(entryValue, { operation: "create", assigneeId: assessor.userId, targets: [{ type: "indicator", id: "BP1" }], remark: "Check the approved requirements baseline", ...body }, actor, { member });
}

test("task creation is project-bound, revisioned and cannot change formal assessment conclusions", () => {
  const project = entry();
  const before = structuredClone(project.snapshot.assessments);
  const result = create(project);
  assert.equal(result.task.processes[0], "SYS.2");
  assert.equal(result.task.assigneeId, assessor.userId);
  assert.equal(result.task.status, "open");
  assert.equal(result.notification.recipientId, assessor.userId);
  assert.equal(project.snapshot.assessmentTasks.length, 1);
  assert.equal(project.snapshot.assessments[0].reviewed, before[0].reviewed);
});

test("assessors can delegate indicator work only within their scope to a same-project assessor", () => {
  const project = entry();
  const result = create(project, assessor, { assigneeId: assessorTwo.userId });
  assert.equal(result.task.assignedBy, assessor.userId);
  assert.equal(result.task.assigneeId, assessorTwo.userId);
  assert.throws(() => create(project, assessor, { targets: [{ type: "indicator", id: "OUTSIDE" }] }), /not found/i);
  assert.throws(() => create(project, assessor, { targets: [{ type: "issue", id: "ISSUE-1" }] }), /lead assessor/i);
  assert.throws(() => create(project, assessor, { assigneeId: viewer.userId }), /assessor who belongs/i);
  assert.throws(() => create(project, assessor, { assigneeId: lead.userId }), /another project assessor/i);
});

test("leads may assign existing issues, but targets outside formal scope or another project are rejected", () => {
  const project = entry();
  const result = create(project, lead, { targets: [{ type: "issue", id: "ISSUE-1" }] });
  assert.match(result.task.title, /ISSUE-1/);
  assert.throws(() => create(project, lead, { targets: [{ type: "issue", id: "OTHER-PROJECT-ISSUE" }] }), /not found/i);
  assert.throws(() => create(project, lead, { targets: [{ type: "process", id: "SWE.1" }] }), /outside the formal assessment scope/i);
  assert.throws(() => create(project, lead, { dueDate: "2026-02-30" }), /valid YYYY-MM-DD/i);
});

test("task status transitions require the assignee and creator/lead acceptance", () => {
  const project = entry();
  const { task } = create(project);
  const assigneeMember = authorize(project, assessor);
  const creatorMember = authorize(project, lead);
  const started = applyAssessmentTaskChange(project, { operation: "status", taskId: task.id, expectedRevision: 2, status: "in-progress" }, assessor, { member: assigneeMember });
  assert.equal(started.task.status, "in-progress");
  const submitted = applyAssessmentTaskChange(project, { operation: "status", taskId: task.id, status: "submitted" }, assessor, { member: assigneeMember });
  assert.equal(submitted.task.status, "submitted");
  assert.throws(() => applyAssessmentTaskChange(project, { operation: "status", taskId: task.id, status: "completed" }, assessor, { member: assigneeMember }), /must accept/i);
  const completed = applyAssessmentTaskChange(project, { operation: "status", taskId: task.id, status: "completed" }, lead, { member: creatorMember });
  assert.equal(completed.task.status, "completed");
});

test("task boards enforce process scoping and include per-process progress and real recent events", () => {
  const project = entry();
  create(project);
  project.events = [{ revision: 2, userId: lead.userId, userName: lead.userName, processes: ["SYS.2"], changeSummary: "Audit task assigned", createdAt: "2026-01-01T10:00:00.000Z" }];
  const board = readAssessmentTaskBoard(project, assessor, { member: authorize(project, assessor) });
  assert.equal(board.processes[0].indicators, 2);
  assert.equal(board.processes[0].openTasks, 1);
  assert.equal(board.events[0].changeSummary, "Audit task assigned");
  const readOnly = readAssessmentTaskBoard(project, viewer, { member: authorize(project, viewer) });
  assert.equal(readOnly.canAssign, false);
  const readOnlyMarkup = assessmentTaskDashboardMarkup({ project, board: readOnly, enabled: true });
  assert.match(readOnlyMarkup, /data-process="SYS\.2"[^]*?data-action="open-assessment-task-assignment"[^]*?disabled/);
});

test("mail delivery receipt is server-only and ordinary snapshot saves cannot forge or erase task/outbox state", () => {
  const initial = entry();
  const created = create(initial);
  const rejected = { ...created.notification, status: "sent", recipientId: "ATTACKER" };
  const save = mutateProject("saveProject", initial, initial.projectId, {
    expectedRevision: initial.revision,
    snapshot: { ...initial.snapshot, assessmentTasks: [{ id: "forged-task" }], assessmentTaskNotifications: [rejected] }
  }, lead);
  assert.equal(save.entry.snapshot.assessmentTasks[0].id, created.task.id);
  assert.equal(save.entry.snapshot.assessmentTaskNotifications[0].status, "pending");
  assert.throws(() => recordAssessmentTaskNotification(save.entry, { notificationId: created.notification.id, status: "sent" }), /server-only/i);
  const sent = recordAssessmentTaskNotification(save.entry, {
    authority: TASK_NOTIFICATION_AUTHORITY,
    notificationId: created.notification.id,
    status: "accepted",
    transport: "test"
  });
  assert.equal(sent.notification.status, "accepted");
  assert.equal(sent.notification.recipientId, assessor.userId);
});

test("task dashboard and assignment form render scoped project data without injecting source text as markup", () => {
  const project = entry();
  const created = create(project);
  const board = readAssessmentTaskBoard(project, lead, { member: authorize(project, lead) });
  assert.match(assessmentTaskDashboardMarkup({ project, board, enabled: true }), /assessment-process-dashboard/);
  assert.match(assessmentTaskDashboardMarkup({ project, board, enabled: true, language: "en" }), /Assigned to me/);
  const view = structuredClone(project.snapshot);
  view.assessments[0].title = '<img src=x onerror=alert(1)>';
  const modal = assessmentTaskAssignmentModalMarkup({ project: view, board, language: "en" });
  assert.match(modal, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(modal, /<img src=x/);
  assert.match(modal, /assessmentTaskForm/);
  assert.equal(created.task.targets[0].type, "indicator");
});
