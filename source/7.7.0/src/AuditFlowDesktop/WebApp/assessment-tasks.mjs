export const TASK_NOTIFICATION_AUTHORITY = Symbol("AuditFlow task notification transport");
export const ASSESSMENT_TASK_STATUSES = Object.freeze(["open", "in-progress", "submitted", "completed", "cancelled"]);
const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const text = (value, max = 240) => String(value ?? "").trim().slice(0, max);
const list = value => Array.isArray(value) ? value : [];
const indicator = row => row.indicator || (String(row.code || "").startsWith(`${row.process}.`) ? row.code : `${row.process}.${row.code || ""}`);
const managing = (entry, identity, member) => entry.ownerId === identity.userId || ["Lead Assessor", "Administrator"].includes(member.role);
const permits = (member, processes) => member.permissions?.use && member.permissions?.forms
  && (member.processScopes?.includes("*") || processes.every(process => member.processScopes?.includes(process)));
const formalProcesses = entry => [...new Set(list(entry.snapshot?.processes).map(process => text(process, 40)).filter(Boolean))];

function memberRequired(member, identity) {
  if (!identity?.userId || !member || member.userId !== identity.userId || !member.permissions?.view) {
    throw fail("An authorized project member is required", 403);
  }
}

function resolveTargets(entry, incoming, isManager) {
  if (!Array.isArray(incoming) || !incoming.length || incoming.length > 100) throw fail("Select 1-100 existing audit targets");
  const snapshot = entry.snapshot || {};
  const scope = formalProcesses(entry);
  const assessments = list(snapshot.assessments);
  const resolveProcesses = row => [...new Set([
    ...list(row.processes),
    row.process || row.processId || row.primaryProcess,
    ...list(row.indicators || row.targetIndicators).map(key => assessments.find(item => indicator(item) === key)?.process || /^([A-Z]+\.\d+)\./.exec(String(key))?.[1])
  ].filter(process => scope.includes(process)))];
  const seen = new Set();
  return incoming.map(target => {
    if (!target || typeof target !== "object") throw fail("Invalid task target");
    const id = text(target.id, 160);
    const type = text(target.type, 40);
    let row, processes, label;
    if (type === "process") {
      if (!isManager) throw fail("Only a lead assessor can assign a whole process", 403);
      if (!scope.includes(id)) throw fail("The process is outside the formal assessment scope", 403);
      processes = [id]; label = id;
    } else if (type === "indicator") {
      row = assessments.find(item => item.id === id || indicator(item) === id);
      if (!row) throw fail("Assessment indicator not found in this project", 404);
      processes = resolveProcesses(row); label = `${indicator(row)} · ${text(row.title, 240)}`;
    } else if (type === "record") {
      row = list(snapshot.records).find(item => item.id === id);
      if (!row) throw fail("Assessor record not found in this project", 404);
      processes = resolveProcesses(row); label = `${id} · ${text(row.text || row.description, 240)}`;
    } else if (type === "issue") {
      if (!isManager) throw fail("Only a lead assessor can assign issues", 403);
      row = [
        ...list(snapshot.actionPlanIssues), ...list(snapshot.uploadIssueCandidates),
        ...list(snapshot.supportIssues), ...list(snapshot.sourceIssues), ...list(snapshot.ncRecords),
        ...list(snapshot.records).filter(item => item.type === "weakness")
      ].find(item => String(item.id || item.key || item.issueKey) === id);
      if (!row) throw fail("Issue not found in this project", 404);
      processes = resolveProcesses(row); label = `${id} · ${text(row.title || row.summary || row.text || row.description, 240)}`;
    } else throw fail("Unsupported audit task target");
    if (!processes.length) throw fail("The target has no indicator in the formal assessment scope", 400);
    const resolvedId = String(row?.id || id);
    const key = `${type}:${resolvedId}`;
    if (seen.has(key)) throw fail("Duplicate task target");
    seen.add(key);
    return { type, id: resolvedId, label, processes };
  });
}

function assigneeFor(entry, assigneeId, processes, isManager) {
  const member = list(entry.members).find(item => item.userId === text(assigneeId, 160));
  if (!member || !["Assessor", "Lead Assessor"].includes(member.role)) throw fail("Choose an assessor who belongs to this project", 403);
  if (!isManager && member.role !== "Assessor") throw fail("Assessors may delegate only to another project assessor", 403);
  if (!permits(member, processes)) throw fail("The assignee does not have form access to every selected process", 403);
  return member;
}

function dateOnly(value) {
  const date = text(value, 10);
  if (!date) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`))
    || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw fail("Due date must be a valid YYYY-MM-DD date");
  return date;
}

export function applyAssessmentTaskChange(entry, body, identity, { member } = {}) {
  memberRequired(member, identity);
  const isManager = managing(entry, identity, member);
  if (!isManager && member.role !== "Assessor") throw fail("Only an assessor can assign audit tasks", 403);
  if (entry.snapshot?.assessmentState === "Closed" || entry.snapshot?.status === "complete") throw fail("Reopen the assessment before changing its audit tasks", 409);
  const snapshot = entry.snapshot || (entry.snapshot = {});
  snapshot.assessmentTasks = list(snapshot.assessmentTasks);
  snapshot.assessmentTaskNotifications = list(snapshot.assessmentTaskNotifications);
  const now = new Date().toISOString();
  const operation = text(body.operation, 40);
  let task, recipientId = "", summary;
  if (operation === "create") {
    if (snapshot.assessmentTasks.length >= 5000) throw fail("The project audit task limit has been reached", 409);
    const targets = resolveTargets(entry, body.targets, isManager);
    const processes = [...new Set(targets.flatMap(target => target.processes))];
    if (!isManager && !permits(member, processes)) throw fail("Process form permission denied", 403);
    const assignee = assigneeFor(entry, body.assigneeId, processes, isManager);
    const title = text(body.title, 240) || targets.map(target => target.label).join("; ").slice(0, 240);
    const remark = text(body.remark, 4000);
    if (!remark) throw fail("Describe the audit work being assigned");
    task = {
      id: `TASK-${globalThis.crypto.randomUUID()}`, title, remark, targets, processes,
      assigneeId: assignee.userId, assigneeName: text(assignee.name || assignee.userId, 160),
      assignedBy: identity.userId, assignedByName: text(identity.userName || identity.userId, 160),
      assignedAt: now, createdAt: now, updatedAt: now, status: "open", dueDate: dateOnly(body.dueDate),
      history: []
    };
    snapshot.assessmentTasks.push(task);
    recipientId = task.assigneeId;
    summary = `Audit task assigned to ${task.assigneeName}: ${title}`;
  } else {
    task = snapshot.assessmentTasks.find(item => item.id === text(body.taskId, 160));
    if (!task) throw fail("Audit task not found in this project", 404);
    if (!isManager && !permits(member, task.processes)) throw fail("Process form permission denied", 403);
    if (operation === "reassign") {
      if (!isManager && task.assignedBy !== identity.userId) throw fail("Only the task creator or lead assessor can reassign it", 403);
      if (["completed", "cancelled"].includes(task.status)) throw fail("Reopen the task before reassigning it", 409);
      const assignee = assigneeFor(entry, body.assigneeId, task.processes, isManager);
      const before = task.assigneeId;
      task.assigneeId = assignee.userId;
      task.assigneeName = text(assignee.name || assignee.userId, 160);
      task.assignedAt = now;
      task.history.push({ action: "reassigned", from: before, to: task.assigneeId, remark: text(body.remark, 4000), at: now, by: identity.userId });
      recipientId = task.assigneeId;
      summary = `Audit task reassigned to ${task.assigneeName}: ${task.title}`;
    } else if (operation === "status") {
      const status = text(body.status, 40);
      if (!ASSESSMENT_TASK_STATUSES.includes(status)) throw fail("Unsupported audit task status");
      const owner = isManager || task.assignedBy === identity.userId;
      if (!owner && task.assigneeId !== identity.userId) throw fail("Only the assignee, task creator or lead assessor can update it", 403);
      if (["completed", "cancelled"].includes(status) && !owner) throw fail("The task creator or lead assessor must accept or cancel the work", 403);
      const transitions = { open: ["in-progress", "cancelled"], "in-progress": ["open", "submitted", "cancelled"], submitted: ["in-progress", "completed", "cancelled"], completed: ["open"], cancelled: ["open"] };
      if (!transitions[task.status]?.includes(status)) throw fail("The requested task status transition is not available", 409);
      if (["completed", "cancelled"].includes(task.status) && !owner) throw fail("Only the task creator or lead assessor can reopen it", 403);
      task.history.push({ action: "status", from: task.status, to: status, remark: text(body.remark, 4000), at: now, by: identity.userId });
      task.status = status;
      recipientId = status === "submitted" ? task.assignedBy : task.assigneeId;
      summary = `Audit task ${status}: ${task.title}`;
    } else throw fail("Unsupported audit task operation");
    task.updatedAt = now;
  }
  const notification = {
    id: `TASK-MAIL-${globalThis.crypto.randomUUID()}`, taskId: task.id, recipientId,
    subject: `${text(snapshot.name || entry.projectId, 120)} · ${task.title}`.slice(0, 240),
    text: `${summary}\n\nAssessment: ${text(snapshot.name || entry.projectId, 240)}\nProcesses: ${task.processes.join(", ")}\nDue: ${task.dueDate || "Not set"}\n\n${task.remark}\n\n${task.targets.map(target => target.label).join("\n")}`,
    status: "pending", attempts: 0, createdAt: now, updatedAt: now
  };
  snapshot.assessmentTaskNotifications.push(notification);
  return { task: structuredClone(task), notification: structuredClone(notification), summary, processes: task.processes };
}

export function recordAssessmentTaskNotification(entry, body) {
  if (body.authority !== TASK_NOTIFICATION_AUTHORITY) throw fail("Task notification delivery is server-only", 403);
  const notification = list(entry?.snapshot?.assessmentTaskNotifications).find(item => item.id === body.notificationId);
  if (!notification) throw fail("Task notification not found", 404);
  if (!["accepted", "failed"].includes(body.status)) throw fail("Invalid notification delivery result");
  if (notification.status === "accepted") return { notification: structuredClone(notification) };
  notification.status = body.status;
  notification.attempts = Number(notification.attempts || 0) + 1;
  notification.updatedAt = new Date().toISOString();
  notification.transport = text(body.transport, 80);
  notification.messageId = text(body.messageId, 160);
  notification.error = text(body.error, 500).replace(/\b(Bearer|password|token|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]");
  if (body.status === "accepted") notification.acceptedAt = notification.updatedAt;
  return { notification: structuredClone(notification) };
}

export function readAssessmentTaskBoard(entry, identity, { member, process = "" } = {}) {
  memberRequired(member, identity);
  const scope = formalProcesses(entry);
  if (process && !scope.includes(process)) throw fail("The process is outside this assessment", 403);
  const allowed = managing(entry, identity, member) || member.processScopes?.includes("*")
    ? scope : scope.filter(item => member.processScopes?.includes(item));
  if (process && !allowed.includes(process)) throw fail("Process permission denied", 403);
  const visible = task => task.processes?.every(item => allowed.includes(item)) && (!process || task.processes.includes(process));
  const tasks = list(entry.snapshot?.assessmentTasks).filter(visible);
  const rows = list(entry.snapshot?.assessments);
  const processes = (process ? [process] : allowed).map(code => {
    const items = rows.filter(item => item.process === code || item.processId === code);
    const processTasks = tasks.filter(task => task.processes.includes(code));
    return {
      process: code, indicators: items.length, reviewed: items.filter(item => item.reviewed === true).length,
      openTasks: processTasks.filter(task => !["completed", "cancelled"].includes(task.status)).length,
      completedTasks: processTasks.filter(task => task.status === "completed").length,
      assignees: [...new Set(processTasks.filter(task => !["completed", "cancelled"].includes(task.status)).map(task => task.assigneeName))]
    };
  });
  const events = list(entry.events).filter(event => !event.processes?.length || event.processes.some(code => allowed.includes(code) && (!process || code === process))).slice(-40).reverse();
  const notifications = list(entry.snapshot?.assessmentTaskNotifications).filter(item => tasks.some(task => task.id === item.taskId))
    .map(({ id, taskId, recipientId, status, attempts, createdAt, updatedAt, transport, acceptedAt }) => ({ id, taskId, recipientId, status, attempts, createdAt, updatedAt, transport, acceptedAt }));
  return {
    projectId: entry.projectId, revision: entry.revision, currentUserId: identity.userId,
    currentRole: managing(entry, identity, member) ? "Lead Assessor" : member.role,
    canAssign: managing(entry, identity, member) || member.role === "Assessor" && member.permissions?.use && member.permissions?.forms,
    canAssignIssues: managing(entry, identity, member), tasks, processes, events, notifications,
    members: list(entry.members).filter(item => ["Lead Assessor", "Assessor"].includes(item.role) && item.permissions?.use && item.permissions?.forms)
      .map(({ userId, name, role, processScopes }) => ({ userId, name, role, processScopes })),
    statuses: ASSESSMENT_TASK_STATUSES
  };
}

const html = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export function assessmentTaskDashboardMarkup({ project, board, enabled, loading = false, language = "zh", processLabels = {}, currentUserId = "" }) {
  const en = language === "en";
  const t = (zh, english) => en ? english : zh;
  const labelProcess = process => `${process}${processLabels[process] ? ` · ${processLabels[process]}` : ""}`;
  const actorId = board?.currentUserId || currentUserId;
  const visibleTasks = list(board?.tasks);
  const stateLabel = status => ({
    open: t("待办", "Open"), "in-progress": t("进行中", "In progress"),
    submitted: t("待确认", "Submitted"), completed: t("已完成", "Completed"),
    cancelled: t("已取消", "Cancelled")
  }[status] || status);
  const taskRows = (process, tasks) => tasks.map(task => {
    const isAssignee = task.assigneeId === actorId;
    const isManager = ["Lead Assessor", "Administrator"].includes(board?.currentRole);
    const isOwner = isManager || task.assignedBy === actorId;
    const next = task.status === "open" && isAssignee ? "in-progress"
      : task.status === "in-progress" && isAssignee ? "submitted"
        : task.status === "submitted" && isOwner ? "completed" : "";
    const action = next ? `<button type="button" class="btn ${next === "completed" ? "primary" : "secondary"} sm" data-action="assessment-task-status" data-project="${html(project.id)}" data-task="${html(task.id)}" data-status="${next}">${t(({ "in-progress": "开始", submitted: "提交", completed: "确认完成" })[next], ({ "in-progress": "Start", submitted: "Submit", completed: "Accept" })[next])}</button>` : "";
    const reassign = isOwner && !["completed", "cancelled"].includes(task.status)
      ? `<button type="button" class="action-icon" data-action="reassign-assessment-task" data-project="${html(project.id)}" data-task="${html(task.id)}" title="${t("重新分派", "Reassign")}">${t("↗", "↗")}</button>` : "";
    return `<article class="assessment-task-row"><div><strong>${html(task.title)}</strong><small>${html(task.targets.map(target => target.label).join(" · "))}</small><p>${html(task.remark)}</p><small>${t("分派给", "Assigned to")} ${html(task.assigneeName)} · ${t("创建者", "By")} ${html(task.assignedByName)} · ${task.dueDate ? `${t("截止", "Due")} ${html(task.dueDate)}` : t("未设截止日", "No due date")}</small></div><div class="assessment-task-actions"><span class="task-status ${html(task.status)}">${html(stateLabel(task.status))}</span>${reassign}${action}</div></article>`;
  }).join("");
  const processCards = list(board?.processes).map(row => {
    const tasks = visibleTasks.filter(task => task.processes.includes(row.process));
    const recent = list(board?.events).filter(event => event.processes?.includes(row.process)).slice(0, 3);
    return `<section class="assessment-process-dashboard" data-process="${html(row.process)}"><header><div><span class="code-tag">${html(row.process)}</span><h3>${html(labelProcess(row.process))}</h3></div><button type="button" class="btn secondary sm" data-action="open-assessment-task-assignment" data-project="${html(project.id)}" data-process="${html(row.process)}" ${enabled && board?.canAssign ? "" : "disabled"}>${t("分派任务", "Assign task")}</button></header><div class="assessment-process-kpis"><div><span>${t("BP/GP", "BP/GP")}</span><strong>${row.indicators}</strong></div><div><span>${t("人工已复核", "Reviewed")}</span><strong>${row.reviewed}/${row.indicators}</strong></div><div><span>${t("开放任务", "Open tasks")}</span><strong>${row.openTasks}</strong></div><div><span>${t("已完成", "Completed")}</span><strong>${row.completedTasks}</strong></div></div><div class="assessment-task-list">${taskRows(row.process, tasks) || `<div class="empty-mini">${t("该过程域暂无分派任务。", "No assigned tasks for this process.")}</div>`}</div><div class="assessment-task-activity"><strong>${t("最近动态", "Recent activity")}</strong>${recent.map(event => `<article><span>${html(event.userName)}</span><p>${html(event.changeSummary)}</p><time>${html(event.createdAt?.slice(0, 16).replace("T", " ") || "")}</time></article>`).join("") || `<small>${t("暂无活动记录。", "No activity yet.")}</small>`}</div></section>`;
  }).join("");
  const activity = list(board?.events).slice(0, 8).map(event => `<article class="assessment-recent-activity"><span>${html(event.userName)}</span><div><strong>${html(event.changeSummary)}</strong><small>${html(list(event.processes).join(", ") || project.name)}</small></div><time>${html(event.createdAt?.slice(0, 16).replace("T", " ") || "")}</time></article>`).join("");
  const heading = t("评审进度与任务", "Review progress and assignments");
  const notice = enabled
    ? board?.error || (loading && !board ? t("正在读取项目任务…", "Loading project tasks…") : "")
    : t("任务分派需要登录的共享协作项目。", "Task assignment requires an authenticated shared assessment.");
  return `<section class="assessment-task-dashboard"><header class="assessment-task-dashboard-head"><div><span class="overline">${t("评估师工作分派", "Assessor work allocation")}</span><h2>${heading}</h2><p>${t("各过程域独立展示评审覆盖、当前任务与审核活动。任务状态不改变正式评分或弱项关闭结论。", "Each process domain tracks review coverage, assigned work, and recent audit activity. Task status never changes formal ratings or finding closure.")}</p></div><div class="assessment-task-dashboard-tools"><button type="button" class="btn secondary sm" data-action="refresh-assessment-tasks" data-project="${html(project.id)}" ${enabled ? "" : "disabled"}>${t("刷新", "Refresh")}</button><button type="button" class="btn primary sm" data-action="open-assessment-task-assignment" data-project="${html(project.id)}" ${enabled && board?.canAssign ? "" : "disabled"}>${t("分派审核任务", "Assign audit work")}</button></div></header>${notice ? `<p class="assessment-task-notice">${notice}</p>` : ""}<div class="assessment-task-summary"><div><span>${t("我的待办", "Assigned to me")}</span><strong>${visibleTasks.filter(task => task.assigneeId === (currentUserId || board?.currentUserId) && !["completed", "cancelled"].includes(task.status)).length}</strong></div><div><span>${t("待确认", "Awaiting acceptance")}</span><strong>${visibleTasks.filter(task => task.status === "submitted").length}</strong></div><div><span>${t("未送达通知", "Notifications pending")}</span><strong>${list(board?.notifications).filter(item => ["pending", "failed"].includes(item.status)).length}</strong></div></div><div class="assessment-process-dashboard-grid">${processCards || `<div class="empty-mini">${t("没有可显示的过程域。", "No process domains to display.")}</div>`}</div><section class="assessment-recent-activity-panel"><header><h3>${t("最近动态", "Recent activity")}</h3><span>${list(board?.events).length}</span></header>${activity || `<div class="empty-mini">${t("暂无协作动态。", "No collaboration activity.")}</div>`}</section></section>`;
}

export function assessmentTaskAssignmentModalMarkup({ project, board, process = "", task = null, language = "zh" }) {
  const en = language === "en";
  const t = (zh, english) => en ? english : zh;
  const processes = list(board?.processes).filter(row => !process || row.process === process);
  const candidates = processes.flatMap(row => list(project.assessments).filter(item => item.process === row.process)
    .map(item => ({ type: "indicator", id: item.id, process: row.process, label: `${indicator(item)} · ${text(item.title, 200)}` })));
  const issues = [
    ...list(project.actionPlanIssues), ...list(project.uploadIssueCandidates),
    ...list(project.supportIssues), ...list(project.sourceIssues), ...list(project.ncRecords),
    ...list(project.records).filter(item => item.type === "weakness")
  ];
  for (const row of processes) {
    for (const issue of issues) {
      const id = String(issue.id || issue.key || issue.issueKey || "");
      const processId = issue.process || issue.processId || list(issue.processes)[0];
      if (id && processId === row.process && !candidates.some(item => item.type === "issue" && item.id === id)) {
        candidates.push({ type: "issue", id, process: row.process, label: `ISSUE · ${id} · ${text(issue.title || issue.summary || issue.text || issue.description, 180)}` });
      }
    }
  }
  const records = list(project.records).flatMap(item => list(item.indicators).map(key => {
    const processId = list(board?.processes).find(row => row.process === item.process || key.startsWith(`${row.process}.`))?.process;
    return processId && (!process || processId === process)
      ? { type: "record", id: item.id, process: processId, label: `${key} · ${text(item.text, 180)}` } : null;
  }).filter(Boolean));
  candidates.push(...records);
  if (board?.canAssignIssues) {
    candidates.push(...processes.map(row => ({ type: "process", id: row.process, process: row.process, label: `${row.process} · ${t("整个过程域", "Entire process domain")}` })));
  }
  const selectedTargetIds = new Set(list(task?.targets).map(target => `${target.type}:${target.id}`));
  const selectedProcesses = [...new Set(list(task?.processes).length ? task.processes : [process].filter(Boolean))];
  const processOptions = processes.map(row => `<option value="${html(row.process)}" ${selectedProcesses.includes(row.process) ? "selected" : ""}>${html(row.process)}</option>`).join("");
  const targetOptions = candidates.filter(target => target.type !== "issue" || board?.canAssignIssues)
    .map(target => `<option value="${html(target.type)}:${html(target.id)}" data-process="${html(target.process)}" ${selectedTargetIds.has(`${target.type}:${target.id}`) ? "selected" : ""}>${html(target.label)}</option>`).join("");
  const assigneeOptions = list(board?.members).filter(member => selectedProcesses.every(code => member.processScopes?.includes("*") || member.processScopes?.includes(code)))
    .map(member => `<option value="${html(member.userId)}" ${member.userId === task?.assigneeId ? "selected" : ""}>${html(member.name)} · ${html(member.role)}</option>`).join("");
  return `<form id="assessmentTaskForm" data-project="${html(project.id)}" data-task="${html(task?.id || "")}"><div class="form-grid"><label class="form-field full"><span>${t("审核任务目标", "Audit task targets")} *</span><select name="targets" multiple size="7" required>${targetOptions}</select><small>${t("按住 Ctrl/Command 可多选。只显示项目中真实存在且属于评估范围的 BP/GP、问题和审核记录。", "Use Ctrl/Command to select multiple items. Only existing in-scope indicators, issues, and assessor records are listed.")}</small></label><label class="form-field full"><span>${t("分派给评估师", "Assign to assessor")} *</span><select name="assigneeId" required>${assigneeOptions}</select></label><label class="form-field full"><span>${t("任务备注", "Assignment remark")} *</span><textarea name="remark" required maxlength="4000" rows="4" placeholder="${t("说明要核对的证据、所需输出或评审问题…", "Describe the evidence to check, required output, or review question…")}">${html(task?.remark || "")}</textarea></label><label class="form-field"><span>${t("截止日期", "Due date")}</span><input type="date" name="dueDate" value="${html(task?.dueDate || "")}"></label><label class="form-field"><span>${t("评估项目", "Assessment")}</span><input value="${html(project.name)}" readonly></label></div></form>`;
}

