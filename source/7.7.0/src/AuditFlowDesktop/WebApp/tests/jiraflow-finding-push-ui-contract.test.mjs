import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSource = await readFile(path.join(root, "app.js"), "utf8");

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing ${signature}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  assert.fail(`Unclosed function ${signature}`);
}

test("reviewed finding actions are restricted to authorized leads and preserve the original record identity", () => {
  const eligibility = functionBody(appSource, "function canPushAssessmentFindingToJiraFlow(");
  const findingControl = functionBody(appSource, "function assessmentFindingJiraFlowControl(");
  const sourceIdentity = functionBody(appSource, "function assessmentFindingSourceId(");
  const recordCard = functionBody(appSource, "function renderRecordCard(");
  const ncWorkbench = functionBody(appSource, "function renderNcFollowupWorkbench(");

  assert.match(eligibility, /collaborationRole\(project\)/);
  assert.match(eligibility, /Lead Assessor/);
  assert.match(eligibility, /reviewed|confirmed/);
  assert.match(findingControl, /data-action="preview-assessment-finding-jiraflow"/);
  assert.match(sourceIdentity, /sourceRecordId/);
  assert.match(recordCard, /assessmentFindingJiraFlowControl/);
  assert.match(ncWorkbench, /assessmentFindingJiraFlowControl\(project,\s*record,\s*\{\s*isNc:\s*true\s*\}\)/);
  assert.match(findingControl, /assessmentFindingSourceId\(project,\s*row\)/);
});

test("finding submission eligibility requires an in-scope reviewed weakness and a clean shared project", () => {
  const context = {
    db: { settings: { collaborationSyncEnabled: true } },
    cloudCollaborationMode: () => true,
    collaborationRole: () => context.role,
    hasPendingProjectChanges: () => context.pending,
    indicatorKey: item => String(item.indicator || `${item.process}.${item.code}`).toUpperCase(),
    role: "Lead Assessor",
    pending: false
  };
  vm.createContext(context);
  vm.runInContext(`
    globalThis.assessmentFindingSourceId = function assessmentFindingSourceId(project, row) {
      ${functionBody(appSource, "function assessmentFindingSourceId(")}
    };
    globalThis.canPush = function canPushAssessmentFindingToJiraFlow(project, row, isNc = false, provider = "jiraflow") {
      ${functionBody(appSource, "function canPushAssessmentFindingToJiraFlow(")}
    };
  `, context);

  const project = {
    processes: ["SYS.2"],
    assessments: [{ id: "A1", process: "SYS.2", code: "BP1", reviewed: true }],
    records: [{ id: "F1", type: "weakness", reviewed: true, indicators: ["SYS.2.BP1"] }],
    ncRecords: []
  };
  assert.equal(context.canPush(project, project.records[0]), true);
  context.role = "Assessor";
  assert.equal(context.canPush(project, project.records[0]), false);
  context.role = "Lead Assessor";
  context.pending = true;
  assert.equal(context.canPush(project, project.records[0]), false);
  context.pending = false;
  project.processes = ["SYS.3"];
  assert.equal(context.canPush(project, project.records[0]), false);
  project.processes = ["SYS.2"];
  project.assessments[0].reviewed = false;
  project.records[0].reviewed = false;
  assert.equal(context.canPush(project, project.records[0]), false);
  project.records[0].confirmed = true;
  assert.equal(context.canPush(project, project.records[0]), true);
  project.records[0].jiraFlowKey = "AF-1";
  assert.equal(context.canPush(project, project.records[0]), false);
});

test("finding preview is read-only, and explicit JiraFlow creation refreshes evidence without changing ratings or closure", () => {
  const preview = functionBody(appSource, "async function previewAssessmentFindingJiraFlow(");
  const submit = functionBody(appSource, "async function submitAssessmentFindingJiraFlow(");
  const request = functionBody(appSource, "async function assessmentFindingJiraFlowRequest(");

  assert.match(request, /\/assessment-findings\//);
  assert.match(request, /credentials:\s*"include"/);
  assert.match(request, /AuditFlowBackend\.authHeaders/);
  assert.match(preview, /\/preview/);
  assert.match(preview, /esc\(.*description/s);
  assert.match(preview, /data-action="confirm-assessment-finding-jiraflow"/);
  assert.doesNotMatch(preview, /\/issue["'`]/);
  assert.match(submit, /confirmed:\s*true/);
  assert.match(submit, /expectedRevision/);
  assert.match(submit, /pullProjectCloud/);
  assert.doesNotMatch(submit, /\.rating\s*=/);
  assert.doesNotMatch(submit, /\.closureState\s*=/);
  assert.match(appSource, /action==="confirm-assessment-finding-jiraflow"/);
});
