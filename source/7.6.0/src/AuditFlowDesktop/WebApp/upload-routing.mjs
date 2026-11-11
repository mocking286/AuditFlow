const text = value => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
const normalized = value => text(value).toLowerCase().replace(/[_./:#-]+/g, " ").replace(/\s+/g, " ").trim();
const issueFields = Object.freeze({
  issueNo: /^(?:issue|defect|problem|nc|finding)(?: (?:id|no|number|key))?$|^(?:问题|缺陷|不符合|发现)(?:编号|序号|id)?$/i,
  description: /^(?:description|issue description|problem description|finding description|summary|问题描述|问题内容|描述|发现描述)$/,
  title: /^(?:title|issue title|标题|问题标题)$/,
  status: /^(?:status|state|issue status|状态|问题状态)$/,
  owner: /^(?:owner|assignee|responsible|responsible person|责任人|负责人)$/,
  dueDate: /^(?:due|due date|target date|deadline|截止日期|计划完成日期|到期日期)$/,
  severity: /^(?:severity|priority|严重度|优先级)$/,
  process: /^(?:process|process area|process code|过程|过程域|过程编号)$/,
  action: /^(?:action|corrective action|措施|纠正措施|整改措施)$/
});

function parsedTables(parsed = {}) {
  const sheets = Array.isArray(parsed.sheetRows) ? parsed.sheetRows : [];
  if (sheets.length) return sheets.map((sheet, index) => ({ name: text(sheet.name) || `Sheet ${index + 1}`, rows: Array.isArray(sheet.rows) ? sheet.rows : [], rowOffset: 0 }));
  return (Array.isArray(parsed.tables) ? parsed.tables : []).map((table, index) => ({
    name: text(table.source || table.name) || `Table ${index + 1}`,
    rows: [...(Array.isArray(table.headers) ? [table.headers] : []), ...(Array.isArray(table.rows) ? table.rows : [])],
    rowOffset: 0
  }));
}

function issueTables(name, parsed) {
  return parsedTables(parsed).flatMap((table, tableIndex) => {
    for (let headerIndex = 0; headerIndex < Math.min(table.rows.length, 30); headerIndex += 1) {
      const headers = Array.isArray(table.rows[headerIndex]) ? table.rows[headerIndex] : [];
      const columns = Object.fromEntries(Object.entries(issueFields).map(([key, pattern]) => [key, headers.findIndex(value => pattern.test(normalized(value)))]));
      const issueContext = /(?:\b(?:issues?|defects?|findings?|opl)\b|问题|缺陷|不符合)/i.test(`${name} ${table.name}`);
      const description = columns.description >= 0 || columns.title >= 0;
      const genericId = headers.findIndex(value => /^(?:id|key|no|number|编号|序号)$/.test(normalized(value)));
      if (!description || !(columns.issueNo >= 0 || (issueContext && genericId >= 0 && columns.status >= 0))) continue;
      if (columns.issueNo < 0) columns.issueNo = genericId;
      const rows = table.rows.slice(headerIndex + 1).map((row, offset) => ({
        values: Array.isArray(row) ? row : [], rowNumber: headerIndex + offset + 2
      })).filter(row => row.values.some(value => text(value)));
      if (rows.length) return [{ ...table, tableIndex, headers, columns, rows }];
    }
    return [];
  });
}

function engineeringTable(table) {
  const context = `${table.name} ${(table.rows || []).slice(0, 5).flat().map(text).join(" ")}`;
  return /requirement(?:s| id| number)?|test (?:case|id|result)|verification|需求|测试用例|验证结果/i.test(context);
}

export function classifyUploadedFile({ name = "", mime = "", parsed = {} } = {}) {
  const result = (kind, reason) => ({ kind, reason, candidateOnly: true, reviewed: false });
  if (/failed|unsupported|error/i.test(text(parsed.parseStatus))) return result("unclassified", "parse-failed");
  const tables = parsedTables(parsed);
  const issues = issueTables(name, parsed);
  if (issues.length) {
    const issueNames = new Set(issues.map(table => table.name));
    if (tables.some(table => !issueNames.has(table.name) && engineeringTable(table))) return result("unclassified", "mixed-issue-and-engineering-content");
    return result("issue", "structured-issue-table");
  }
  const atoms = Array.isArray(parsed.atomicItems) ? parsed.atomicItems : [];
  const body = [text(parsed.content).slice(0, 16000), ...tables.map(table => `${table.name} ${table.rows.slice(0, 8).flat().map(text).join(" ")}`), ...atoms.slice(0, 30).map(item => `${text(item.itemType)} ${text(item.workProductType)} ${text(item.title)}`)].join(" ");
  if (!body.trim() && !(parsed.visualAssets || []).length) return result("unclassified", "no-parsed-content");
  if (/test[\s_-]*(?:case|plan|report|result|specification)|verification[\s_-]*(?:plan|report|result)|测试|验证报告/i.test(name)) return result("test", "test-work-product");
  if (/requirement|需求|规格/i.test(name)) return result("requirement", "requirement-work-product");
  const context = `${name} ${body}`;
  if (/test[\s_-]*(?:case|plan|report|result|specification)|verification|validation|测试|验证/i.test(context)) return result("test", "test-work-product");
  if (/requirement|specification|\bshall\b|需求|规格/i.test(context)) return result("requirement", "requirement-work-product");
  if (/project[\s_-]*(?:overview|information|plan|organization|profile)|organization|contact list|governance|process[\s_-]*(?:description|plan)|architecture|design|baseline|configuration|项目|组织|概况|计划|架构|设计|配置|基线/i.test(context)) return result("project-information", "project-work-product");
  if (/^image\//i.test(mime) || /\.(?:png|jpe?g|gif|webp)$/i.test(name)) return result("project-information", "visual-source-requires-review");
  return result("unclassified", "classification-needs-review");
}

export function routeUploadClassification(classification = {}) {
  if (classification.kind === "issue") return "issue-candidate";
  return ["requirement", "test", "project-information"].includes(classification.kind) ? "evidence-candidate" : "review-required";
}

export function extractIssueCandidates({ name, parsed, jobId, attachmentId } = {}) {
  return issueTables(name, parsed).flatMap(table => table.rows.map(({ values, rowNumber }) => {
    const value = key => table.columns[key] >= 0 ? text(values[table.columns[key]]) : "";
    const processRaw = value("process");
    const processCandidates = [...new Set((processRaw.match(/\b(?:SYS|SWE|HWE|MLE|MAN|SUP|ACQ|SPL|PIM|REU|INF)[._ -]?\d{1,2}\b/gi) || []).map(process => process.toUpperCase().replace(/[ _-]/g, ".")))];
    return {
      id: `UPLOAD-${text(jobId)}-${table.tableIndex}-${rowNumber}`,
      issueNo: value("issueNo"),
      title: value("title") || value("description").slice(0, 160) || value("issueNo"),
      description: value("description") || value("title"),
      action: value("action"), owner: value("owner"), dueDate: value("dueDate"), severity: value("severity") || "Unprioritized",
      status: "open", sourceStatus: value("status"),
      sourceFile: text(name), sourceSheet: table.name, sourceCell: `${table.name}!row ${rowNumber}`,
      locator: `${table.name}!row ${rowNumber}`, sourceAttachmentId: text(attachmentId), uploadJobId: text(jobId),
      sourceHeaders: table.headers.map(text), sourceValues: values.map(text),
      processRaw, processCandidates, selectedProcess: "",
      mappingStatus: "assessor-confirmation-required", evidenceRole: "corroborating",
      candidateOnly: true, reviewed: false, assessorConfirmed: false, jiraFlowSyncState: "not-submitted",
      origin: "classified-upload"
    };
  }));
}

export function createUploadJob({ jobId, projectId, targetType = "standard", files = [], options = {} } = {}) {
  const createdAt = new Date().toISOString();
  return {
    jobId: text(jobId), projectId: text(projectId), targetType, createdAt, updatedAt: createdAt,
    stage: "queued", status: "queued", completed: 0, total: files.length, cancelRequested: false,
    options: { source: text(options.source), replaceExistingByName: options.replaceExistingByName === true, bundledCepEvidence: options.bundledCepEvidence === true },
    files: files.map((file, index) => ({ index, name: text(file.name), mime: text(file.type), size: Number(file.size) || 0, lastModified: Number(file.lastModified) || 0, attachmentId: `${text(jobId)}-source-${index}`, status: "queued", route: "", error: "" }))
  };
}

export function updateUploadJob(job, { stage, status = "running", fileIndex, fileStatus, ...metadata } = {}) {
  if (stage) job.stage = stage;
  job.status = status;
  job.updatedAt = new Date().toISOString();
  if (Number.isInteger(fileIndex) && job.files[fileIndex]) {
    if (fileStatus) job.files[fileIndex].status = fileStatus;
    for (const field of ["route", "error", "kind", "reason", "evidenceId", "candidateCount"]) {
      if (metadata[field] !== undefined) job.files[fileIndex][field] = metadata[field];
    }
  }
  job.completed = job.files.filter(file => file.status === "complete").length;
  return uploadProgressEvent(job);
}

export function uploadProgressEvent(job) {
  return { jobId: job.jobId, stage: job.stage, completed: job.completed, total: job.total, status: job.status };
}

export function recoverUploadJobs(jobs = []) {
  return (Array.isArray(jobs) ? jobs : []).filter(job => job && Array.isArray(job.files)).map(job => {
    const restored = { ...job, files: job.files.map(file => ({ ...file })), cancelRequested: false };
    if (["queued", "running", "cancelling"].includes(restored.status)) {
      restored.status = "interrupted";
      restored.stage = "interrupted";
      restored.files.forEach(file => { if (["running", "parsing"].includes(file.status)) file.status = "interrupted"; });
    }
    restored.completed = restored.files.filter(file => file.status === "complete").length;
    return restored;
  });
}

export function retryUploadFileIndexes(job) {
  return (job.files || []).flatMap((file, index) => ["complete", "review-required"].includes(file.status) ? [] : [index]);
}

export function createUploadScheduler() {
  const active = new Map();
  return (projectId, operation) => {
    const previous = active.get(projectId) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    active.set(projectId, next);
    const clear = () => { if (active.get(projectId) === next) active.delete(projectId); };
    next.then(clear, clear);
    return next;
  };
}

export async function runUploadJob(job, { parse, route, onProgress = () => {} } = {}) {
  job.cancelRequested = false;
  const progress = async patch => { const event = updateUploadJob(job, patch); await onProgress(event, job); };
  await progress({ stage: "queued" });
  for (const index of retryUploadFileIndexes(job)) {
    if (job.cancelRequested) break;
    const file = job.files[index];
    try {
      await progress({ stage: "parsing", fileIndex: index, fileStatus: "parsing", error: "" });
      const parsed = await parse(file, index);
      if (job.cancelRequested) { file.status = "cancelled"; break; }
      await progress({ stage: "classifying", fileIndex: index });
      if (job.cancelRequested) { file.status = "cancelled"; break; }
      const outcome = await route(parsed, index, file) || {};
      await progress({ stage: "routing", fileIndex: index, fileStatus: outcome.route === "review-required" ? "review-required" : "complete", ...outcome });
    } catch (error) {
      await progress({ stage: "error", fileIndex: index, fileStatus: "error", error: text(error?.message) || "Upload failed" });
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const status = job.cancelRequested ? "cancelled" : job.files.some(file => file.status === "error") ? "error" : job.files.some(file => file.status === "review-required") ? "review-required" : "complete";
  await progress({ stage: status, status });
  return job;
}
