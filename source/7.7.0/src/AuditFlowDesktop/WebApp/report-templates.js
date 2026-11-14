/* AuditFlow v12.3 report templates. Project data never leaves this browser. */
(function (root) {
  "use strict";
  const NS = {
    w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    a: "http://schemas.openxmlformats.org/drawingml/2006/main",
    p: "http://schemas.openxmlformats.org/presentationml/2006/main",
    s: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    rel: "http://schemas.openxmlformats.org/package/2006/relationships",
    ct: "http://schemas.openxmlformats.org/package/2006/content-types"
  };
  const MIME = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  };
  const templates = Object.freeze([
    { id: "km-presentation", name: "KM Assessment Result Presentation Sorted", version: "1.3", format: "pptx", file: "km-presentation.pptx" },
    { id: "trace-presentation", name: "Trace Assessment Presentation", version: "3.0", format: "pptx", file: "trace-presentation.pptx" },
    { id: "trace-word", name: "Trace Assessment Report", version: "4.0", format: "docx", file: "trace-word.docx" },
    { id: "sqe-ppap-report", name: "SQE / PPAP Supplier Review", version: "1.0", format: "docx", file: "trace-word.docx", baseId: "trace-word" },
    { id: "trace-excel", name: "Trace Assessment Excel Report", version: "7.7", format: "xlsx", file: "trace-excel.xlsx" },
    { id: "tuv-audit-issue-record", name: "TUV Audit Issue Record Form", version: "1.0", format: "xlsx", file: "mbeal-assessment-findings.xlsx" }
    ,{ id: "mbeal-assessment-findings", name: "MBEAL Assessment Findings", version: "2026-09 Ver00", format: "xlsx", file: "mbeal-assessment-findings.xlsx" }
    ,{ id: "tuv-aspice-issue-ledger", name: "TUV ASPICE Audit Issue Ledger 2026", version: "2.0", format: "pptx", file: "TUV-ASPICE-Audit-Issue-Ledger-2026.pptx" }
  ].map(Object.freeze));
  const validRating = /^(N|P-|P|P\+|L-|L|L\+|F)$/;
  const arr = value => Array.isArray(value) ? value : [];
  const str = value => value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  const join = value => arr(value).map(str).filter(Boolean).join("; ");
  const esc = value => str(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const englishFallback = { "本机工作区": "Local workspace", "可编辑项目": "Editable project", "本机默认 ASPICE 评估项目": "Local default ASPICE assessment", "李勇丽": "Yumeng Li", "评估师": "Assessor", "未记录": "Not recorded", "不适用": "Not applicable" };
  const REPORT_CJK = /[\u3400-\u9fff]/u;
  const en = value => { const raw = str(value); if (!raw) return ""; if (!REPORT_CJK.test(raw)) return raw; if (englishFallback[raw]) return englishFallback[raw]; const translated = root.AuditFlowI18n?.translateUi ? root.AuditFlowI18n.translateUi(raw) : root.AuditFlowI18n?.translate?.(raw); return translated && translated !== "Untranslated interface text" && !REPORT_CJK.test(String(translated)) ? String(translated) : "Source-language content requires assessor translation."; };
  const pick = (value, field, language) => str(language === "en" ? en(value[field + "En"] || value[field]) : value[field]);
  const trainingSourceFields = new Set(["sourceFile", "sourceLabel", "processPages", "referencePages", "sourcePages", "pages"]);
  function cleanTrainingText(value) {
    return str(value)
      .replace(/ASPICE Introduction Training(?:\s*\(Rev1\))?\.pptx?/gi, "")
      .replace(/课件参考（[^）]*）/g, "ASPICE 领域规则提示")
      .replace(/课件派生领域参考|培训课件参考|课件参考|课件示例/gi, "ASPICE 领域规则")
      .replace(/training-derived domain reference|training deck|training reference/gi, "ASPICE domain guidance")
      .replace(/(?:第\s*)\d+(?:[-–]\d+)?\s*(?:页|pages?|slides?)/gi, "");
  }
  function cleanHistoricalTrainingData(value, parentKey = "") {
    if (Array.isArray(value)) return value.map(item => cleanHistoricalTrainingData(item, parentKey));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !(parentKey === "trainingReference" && trainingSourceFields.has(key)))
        .map(([key, item]) => [key, cleanHistoricalTrainingData(item, key)]));
    }
    return typeof value === "string" ? cleanTrainingText(value) : value;
  }
  const clean = value => str(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "");
  const excelDateEpoch = Date.UTC(1899, 11, 30);
  function excelDateCell(value) {
    const raw = str(value).trim();
    if (!raw) return "";
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    const dateTime = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/.exec(raw);
    if (!dateOnly && !dateTime) return raw;
    const parts = dateOnly || dateTime;
    const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
    const hours = dateOnly ? 0 : Number(parts[4]), minutes = dateOnly ? 0 : Number(parts[5]);
    const seconds = dateOnly || !parts[6] ? 0 : Number(parts[6]);
    const fraction = dateOnly ? "" : parts[7] || "";
    if (month < 1 || month > 12 || day < 1 || day > 31 || hours > 23 || minutes > 59 || seconds > 59) return raw;
    const wallClock = Date.UTC(year, month - 1, day, hours, minutes, seconds, Number((fraction + "00").slice(0, 3)));
    const check = new Date(wallClock);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return raw;
    let timestamp = wallClock;
    const zone = dateOnly ? "" : parts[8] || "";
    if (zone && zone !== "Z") {
      const offset = /^([+-])(\d{2}):(\d{2})$/.exec(zone);
      if (!offset || Number(offset[2]) > 23 || Number(offset[3]) > 59) return raw;
      const offsetMinutes = (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === "+" ? 1 : -1);
      timestamp -= offsetMinutes * 60_000;
    }
    return {
      __auditFlowExcelDate: true,
      serial: (timestamp - excelDateEpoch) / 86_400_000,
      format: dateOnly ? "date" : fraction ? "dateTimeMs" : "dateTime"
    };
  }
  const sourceValue = (value, field, language) => clean(language === "en" ? value?.[field + "En"] || value?.[field] : value?.[field]);
  const evidenceUnavailable = "Content unavailable; reopen or re-upload the source and select the evidence item.";
  function retainedEvidenceText(value) {
    const text = clean(value).trim();
    if (!text || text === "Source-language content requires assessor translation.") return "";
    if (/^(?:EV[.-]\d+\s*[·|:]\s*)?[^:\n]*\.(?:pdf|pptx?|docx?|xlsx?|xlsm|csv|html?|txt)(?:\s*[·|].*)?$/i.test(text)) return "";
    if (/^(?:EV[.-]\d+|[A-Z]+-\d+)(?:\s*[;,\n]\s*(?:EV[.-]\d+|[A-Z]+-\d+))*$/i.test(text)) return "";
    return text;
  }
  function sourceEvidenceDetail(project, reference, language, targetProcess = "") {
    const link = reference && typeof reference === "object" ? reference : { evidenceId: str(reference) };
    const keys = [link.evidenceId, link.evidenceCode, link.evidenceRef, link.code, link.id].map(str).filter(Boolean);
    const evidence = arr(project.evidence).find(item => keys.includes(str(item.id)) || keys.includes(str(item.code)));
    const itemId = str(link.itemId || link.atomicItemId || link.evidenceItemId);
    const atoms = arr(evidence?.atomicItems);
    const locator = str(link.locator || link.sourceCell || link.sourcePage);
    const item = itemId
      ? atoms.find(atom => [atom.id, atom.externalId, atom.catalogCode].map(str).includes(itemId))
      : atoms.find(atom => locator && str(atom.locator) === locator) || (atoms.length === 1 ? atoms[0] : null);
    const unresolvedItem = !!itemId && !item;
    const itemLocator = str(item?.locator || locator || evidence?.locator);
    const retainedLocator = arr(evidence?.locators).find(entry => itemLocator && entry.locator === itemLocator);
    const text = unresolvedItem ? "" : [
      sourceValue(item, "text", language), sourceValue(item, "description", language),
      sourceValue(link, "excerpt", language), sourceValue(retainedLocator, "excerpt", language),
      !itemId && !item ? sourceValue(evidence, "content", language) : ""
    ].map(retainedEvidenceText).find(Boolean) || "";
    const declaredRole = str(link.strength || link.evidenceRole || link.role || item?.evidenceRole || evidence?.evidenceRole || evidence?.role).toLowerCase();
    const itemRole = str(item?.evidenceRole).toLowerCase();
    const primaryProcess = str(item?.userAssignedProcess || item?.primaryProcess || evidence?.primaryProcess || (arr(evidence?.primaryProcesses).length === 1 ? evidence.primaryProcesses[0] : "") || evidence?.scope);
    const confirmed = link.confirmed === true && !/\b(?:ai|inferred|candidate|provider|model)\b/i.test(str(link.source));
    const role = !text || !itemLocator || unresolvedItem || (!item && atoms.length > 1) || declaredRole === "index-only" || itemRole === "index-only"
      ? "index-only"
      : declaredRole === "direct" && !!targetProcess && primaryProcess === targetProcess && confirmed ? "direct" : "corroborating";
    return {
      evidenceId: str(evidence?.code || link.evidenceCode || evidence?.id || link.evidenceId || link.evidenceRef || link.code),
      itemId: str(item?.id || itemId), text: text || evidenceUnavailable,
      locator: itemLocator || "Locator not recorded", role,
      title: sourceValue(item, "title", language) || sourceValue(evidence, "name", language),
      sourceFile: str(item?.sourceFile || evidence?.filename || evidence?.name),
      primaryProcess,
      contentAvailable: !!text,
      confirmation: confirmed ? "Assessor-confirmed link" : "Link confirmation pending"
    };
  }
  function reportEvidenceReferences(project, record, indicator = "") {
    const references = [
      ...arr(record?.evidenceAnalysis), ...arr(record?.evidenceRefs), ...arr(record?.evidenceReferences),
      ...arr(record?.evidence), ...arr(record?.evidenceIds).map(evidenceId => ({ evidenceId })),
      ...arr(project.traceLinks).filter(link =>
        (record?.id && (link.recordId === record.id || link.findingId === record.id || arr(link.findingIds).includes(record.id))) ||
        (indicator && !link.findingId && !link.recordId && (link.indicator === indicator || link.assessmentId === record?.id))
      )
    ];
    const unique = new Map();
    for (const ref of references) {
      const value = ref && typeof ref === "object" ? ref : { evidenceId: str(ref) };
      const key = [value.evidenceId || value.evidenceCode || value.evidenceRef || value.code || value.id, value.itemId || value.atomicItemId || value.evidenceItemId || "", value.locator || ""].join("|");
      if (!unique.has(key)) unique.set(key, value);
    }
    const values = [...unique.values()];
    return values.filter(value => value.itemId || value.atomicItemId || value.evidenceItemId || value.locator || !values.some(other =>
      other !== value && (other.itemId || other.atomicItemId || other.evidenceItemId || other.locator) &&
      str(other.evidenceId || other.evidenceCode || other.evidenceRef || other.code || other.id) === str(value.evidenceId || value.evidenceCode || value.evidenceRef || value.code || value.id)
    ));
  }
  function reportEvidenceNarrative(project, record, language, indicator = "", targetProcess = "") {
    const details = reportEvidenceReferences(project, record, indicator).map(ref => sourceEvidenceDetail(project, ref, language, targetProcess));
    const actual = details.filter(detail => detail.contentAvailable);
    const imported = [
      ...arr(record?.sourceAssessment?.evidenceEntries).map(entry => sourceValue(entry, "text", language)),
      sourceValue(record?.sourceAssessment, "evidence", language)
    ].map(retainedEvidenceText).filter(Boolean);
    const texts = [...new Set([...actual.map(detail => detail.text), ...imported])];
    return {
      text: texts.join("\n\n") || evidenceUnavailable,
      details,
      locators: [...new Set(details.map(detail => detail.locator))].join("\n"),
      roles: [...new Set(details.map(detail => detail.role))].join("; ") || (imported.length ? "corroborating" : "index-only")
    };
  }
  function buildTraceWorkbook(project, context) {
    const { language, scope, indicator, reportableAssessment, includeCandidates, name, status } = context;
    const assessments = arr(project.assessments);
    const workspaceName = id => {
      const item = arr(project.workspaces).find(value => value.id === id);
      return item?.shortname || item?.shortName || item?.name || id || "";
    };
    const instanceName = id => arr(project.instances).find(value => value.id === id)?.name || id || project.product || name;
    const recordTypes = { observation: "Observation", o: "Observation", weakness: "Weakness", w: "Weakness", strength: "Strength", s: "Strength", recommendation: "Recommendation", r: "Recommendation", question: "Question", q: "Question", comment: "Comment", c: "Comment", nc: "NC", nonconformance: "NC" };
    const records = arr(project.records).map(record => ({ ...record }));
    const known = new Set(records.map(record => str(record.id)));
    for (const assessment of assessments) {
      if (!reportableAssessment(assessment) && !includeCandidates) continue;
      arr(assessment.findings).forEach((finding, index) => {
        const id = str(finding.id || `${assessment.id}-F${index + 1}`);
        if (known.has(id) || records.some(record => record.sourceAssessmentId === assessment.id && sourceValue(record, "text", language) === sourceValue(finding, "text", language))) return;
        known.add(id);
        records.push({ ...finding, id, indicators: [indicator(assessment)], sourceAssessmentId: assessment.id, candidate: !reportableAssessment(assessment) });
      });
    }
    const expanded = [];
    for (const record of records) {
      const linkedIndicators = [...new Set([...arr(record.indicators), ...arr(record.targetIndicators), record.primaryIndicator].map(str).filter(Boolean))];
      if (!linkedIndicators.length && record.sourceAssessmentId) {
        const assessment = assessments.find(item => item.id === record.sourceAssessmentId);
        if (assessment) linkedIndicators.push(indicator(assessment));
      }
      for (const code of linkedIndicators.length ? linkedIndicators : [""]) {
        const assessment = assessments.find(item => indicator(item) === code || item.id === record.sourceAssessmentId && !code);
        const process = str(assessment?.process || code.match(/^[A-Z]+\.\d+/)?.[0] || record.process);
        const inScope = scope.includes(process);
        const formalRating = assessment && inScope && reportableAssessment(assessment) ? assessment.rating : "NR";
        const narrative = reportEvidenceNarrative(project, record, language, "", process);
        // A finding's evidence chain contains only its own explicit links.
        const source = record.sourceAssessment || assessment?.sourceAssessment || {};
        const reviewStatus = record.candidate ? "AI candidate / assessor review pending" : !inScope ? "Related observation / not rated" : /final|confirmed|reviewed/i.test(str(record.status)) || record.reviewed === true ? "Assessor record" : "Draft / assessor review pending";
        const description = sourceValue(record, "text", language) || sourceValue(record, "description", language) || sourceValue(record, "title", language) || "Description not recorded";
        const general = record.general ?? record.generalName;
        const generalFlag = general === true || /^(?:yes|true|1)$/i.test(str(general));
        const url = str(record.url || record.traceUrl || record.recordUrl);
        const row = [
          Number.isFinite(Number(record.sortId ?? record.sortOrder)) ? Number(record.sortId ?? record.sortOrder) : expanded.length + 1,
          str(record.id), code, sourceValue(assessment, "title", language) || sourceValue(record, "indicatorName", language),
          recordTypes[str(record.type).toLowerCase()] || str(record.type || "Observation"),
          generalFlag ? "Yes" : "No", description,
          instanceName(record.instanceId || project.activeInstanceId), formalRating, workspaceName(record.workspaceId || project.activeWorkspaceId),
          str(record.createdBy || record.creator), excelDateCell(record.created || record.createdAt),
          str(record.modifiedBy || record.updatedBy), excelDateCell(record.modified || record.updatedAt),
          narrative.text, narrative.locators, narrative.roles,
          str(record.owner || record.governance?.owner || assessment?.governance?.owner),
          str(record.dueDate || record.due || record.governance?.due || assessment?.governance?.due),
          reviewStatus, name, url, str(record.jiraKey || record.jiraIssueKey || record.jira?.key || record.jiraFlow?.key),
          str(record.status || "Draft"), str(source.originalRating || source.nplf || assessment?.displayRating),
          (Array.isArray(record.closureEvidence) ? join(record.closureEvidence) : sourceValue(record, "closureEvidence", language)) || join(assessment?.closureEvidence)
        ];
        expanded.push({ row, record, assessment, process, code, narrative, type: row[4], formalRating });
      }
    }
    const evidenceRows = arr(project.evidence).flatMap(evidence => {
      const atoms = arr(evidence.atomicItems);
      return (atoms.length ? atoms : [null]).map(item => {
        const detail = sourceEvidenceDetail(project, { evidenceId: evidence.id, ...(item ? { itemId: item.id, evidenceRole: item.evidenceRole || evidence.evidenceRole } : {}) }, language);
        const links = arr(project.traceLinks).filter(link => link.evidenceId === evidence.id && (!item || !link.itemId || link.itemId === item.id));
        return [
          instanceName(evidence.instanceId || project.activeInstanceId), str(evidence.prefix || evidence.code?.split(".")[0]),
          str(item?.catalogCode || item?.externalId || evidence.code || evidence.id),
          detail.title, str(item?.itemType || evidence.type), str(item?.version || evidence.version || evidence.fileVersion || evidence.baseline),
          sourceValue(item || evidence, "comment", language), str(item?.url || evidence.url),
          str(item?.externalId || evidence.externalDocId), detail.text, detail.locator, detail.primaryProcess,
          detail.role, evidence.confirmed === true ? "Assessor confirmed" : "Confirmation pending",
          [...new Set(links.map(link => link.indicator).filter(Boolean))].join("; "), detail.sourceFile, detail.itemId, detail.evidenceId
        ];
      });
    });
    const jiraRows = [];
    const seenJira = new Set();
    for (const entry of expanded) {
      if (!["Weakness", "Recommendation", "NC"].includes(entry.type)) continue;
      const key = str(entry.record.id);
      if (seenJira.has(key)) continue;
      seenJira.add(key);
      const siblings = expanded.filter(item => str(item.record.id) === key);
      const codes = [...new Set(siblings.map(item => item.code).filter(Boolean))];
      const description = [entry.row[6], `Assessment: ${name}`, `Finding: ${key}`, `BP/GP: ${codes.join("; ")}`,
        `Evidence content:\n${entry.narrative.text}`, `Evidence locator:\n${entry.narrative.locators || "Not recorded"}`,
        `Review status: ${entry.row[19]}`, entry.row[21] ? `Trace record: ${entry.row[21]}` : "",
        entry.row[25] ? `Minimum closure evidence:\n${entry.row[25]}` : ""].filter(Boolean).join("\n\n");
      jiraRows.push(["Problem", entry.row[6].replace(/\s+/g, " ").slice(0, 240), description,
        str(entry.record.priority || entry.record.severity || ""), [...new Set(siblings.map(item => item.process).filter(Boolean))].join("; "),
        key, `TRACE:${project.id}:${key}`, entry.row[17], entry.row[18],
        entry.narrative.locators, name, entry.row[21], entry.row[22], entry.row[19]]);
    }
    const sections = [
      { sheetName: "Records", tabular: true, title: "Assessment records", notes: [], tables: [table("Records", [
        "SortID", "ID", "Indicator", "Indicator Name", "Type", "General", "Description", "Instance", "Rating", "WS tag",
        "Created by", "Created date", "Modified by", "Modified date", "Evidence content", "Evidence locator", "Evidence role",
        "Owner", "Due date", "Review status", "Assessment", "Trace record URL", "Jira issue", "Record status", "Source rating", "Minimum closure evidence"
      ], expanded.map(entry => entry.row))] },
      { sheetName: "Evidence", tabular: true, title: "Evidence items", notes: [], tables: [table("Evidence", [
        "Instance", "Prefix", "DisplayId", "Name", "Evidence Type", "Version", "Comment", "URL", "External Doc ID",
        "Content", "Source locator", "Primary process", "Evidence role", "Confirmation", "Linked indicators", "Source file", "Item ID", "Evidence ID"
      ], evidenceRows)] },
      { sheetName: "JiraImport", tabular: true, title: "Corrective action work items", notes: [], tables: [table("JiraImport", [
        "Issue Type", "Summary", "Description", "Severity / Priority", "Process ID", "Finding ID", "TRACE ID", "Owner", "Due Date", "Evidence links",
        "Assessment", "Trace record URL", "Jira issue", "Review status"
      ], jiraRows)] },
      { sheetName: "Info", title: "Assessment information", notes: [], tables: [table("Info", ["Field", "Value"], [
        ["Assessment", name], ["Assessment ID", project.id], ["Organization", project.organization || project.customer || ""],
        ["Formal scope", scope.join("; ")], ["Report status", status], ["PAM", project.pam || ""],
        ["Record count", new Set(expanded.map(entry => str(entry.record.id))).size], ["Expanded record rows", expanded.length],
        ["Evidence item rows", evidenceRows.length], ["Rating authority", "Only eligible assessor-confirmed in-scope ratings appear in Rating. Source rating is historical context."],
        ["Evidence boundary", "Related evidence cannot substitute for target-process direct evidence. AI output is a candidate conclusion requiring assessor review."],
        ["Jira work items", "Exported work items do not create, approve or close Jira issues."],
        ["Unavailable content", evidenceUnavailable], ["Source language", "Original source text is retained when a translation is unavailable."]
      ])] }
    ];
    return { schema: "auditflow.trace-workbook/v1", sections };
  }
  function xml(source) {
    const doc = new root.DOMParser().parseFromString(source, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("Invalid template XML");
    return doc;
  }
  const elements = (parent, ns, tag) => Array.from(parent.getElementsByTagNameNS(NS[ns], tag));
  const first = (parent, ns, tag) => elements(parent, ns, tag)[0];
  const serialize = doc => new root.XMLSerializer().serializeToString(doc);
  function node(doc, ns, tag, attrs = {}, value) {
    const n = doc.createElementNS(NS[ns], ns + ":" + tag);
    Object.entries(attrs).forEach(([key, v]) => key.includes(":") ? n.setAttributeNS(NS[key.split(":")[0]], key, str(v)) : n.setAttribute(key, str(v)));
    if (value !== undefined) n.textContent = clean(value);
    return n;
  }
  const clear = n => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
  function requireTemplate(id) {
    const template = templates.find(t => t.id === id);
    if (!template) throw new Error("Unknown report template: " + id);
    return template;
  }
  async function downloadStaticTemplate(template, options = {}) {
    const response = await fetch(new URL(template.file, new URL(options.templateBaseUrl || "./templates/", root.location.href)), { cache: "no-store" });
    if (!response.ok) throw new Error(`Template unavailable (${response.status})`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = root.document.createElement("a");
    anchor.href = url;
    anchor.download = template.file;
    root.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return { mode: "static-download", templateId: template.id, filename: template.file, blob, mime: blob.type || MIME[template.format] };
  }
  function table(title, headers, rows) { return { title, headers, rows: rows.length ? rows : [headers.map(() => "")] }; }

  // --- KM Assessment Result Presentation narrative ---------------------------
  // The KM corporate deck is an English, story-ordered deck: cover, assessment
  // plan, scope, per-instance process findings, rating roll-ups, the considered
  // evidence register, the two rating scales and a back cover. Internal review
  // state (AI candidates, review boundaries, method legends, disclaimers) is
  // deliberately never rendered here.
  const PA_COLUMNS = Object.freeze(["PA 1.1", "PA 2.1", "PA 2.2", "PA 3.1", "PA 3.2"]);
  const RATING_RANK = Object.freeze({ N: 0, "P-": 1, P: 2, "P+": 3, "L-": 4, L: 5, "L+": 6, F: 7 });
  // Local copy of the application process catalogue. app.js does not export it,
  // and a missing entry degrades to the bare process id instead of failing.
  const PROCESS_TITLES = Object.freeze({
    "ACQ.4": ["供应商监控", "Supplier Monitoring"],
    "SPL.2": ["产品发布", "Product Release"],
    "SYS.1": ["需求挖掘", "Requirements Elicitation"],
    "SYS.2": ["系统需求分析", "System Requirements Analysis"],
    "SYS.3": ["系统架构设计", "System Architectural Design"],
    "SYS.4": ["系统集成与集成验证", "System Integration and Integration Verification"],
    "SYS.5": ["系统验证", "System Verification"],
    "SWE.1": ["软件需求分析", "Software Requirements Analysis"],
    "SWE.2": ["软件架构设计", "Software Architectural Design"],
    "SWE.3": ["软件详细设计与单元构建", "Software Detailed Design and Unit Construction"],
    "SWE.4": ["软件单元验证", "Software Unit Verification"],
    "SWE.5": ["软件组件验证与集成验证", "Software Component Verification and Integration Verification"],
    "SWE.6": ["软件验证", "Software Verification"],
    "HWE.1": ["硬件需求分析", "Hardware Requirements Analysis"],
    "HWE.2": ["硬件设计", "Hardware Design"],
    "HWE.3": ["硬件设计验证", "Verification against Hardware Design"],
    "HWE.4": ["硬件需求验证", "Verification against Hardware Requirements"],
    "MLE.1": ["机器学习需求分析", "Machine Learning Requirements Analysis"],
    "MLE.2": ["机器学习架构", "Machine Learning Architecture"],
    "MLE.3": ["机器学习训练", "Machine Learning Training"],
    "MLE.4": ["机器学习模型测试", "Machine Learning Model Testing"],
    "SUP.1": ["质量保证", "Quality Assurance"],
    "SUP.2": ["验证", "Verification"],
    "SUP.4": ["联合评审", "Joint Review"],
    "SUP.7": ["文档编制", "Documentation"],
    "SUP.8": ["配置管理", "Configuration Management"],
    "SUP.9": ["问题解决管理", "Problem Resolution Management"],
    "SUP.10": ["变更请求管理", "Change Request Management"],
    "MAN.3": ["项目管理", "Project Management"],
    "MAN.5": ["风险管理", "Risk Management"],
    "MAN.6": ["度量", "Measurement"],
    "REU.2": ["复用产品管理", "Reuse Product Management"],
    "PIM.3": ["过程改进", "Process Improvement"]
  });
  const TUV_PROCESS_PURPOSES = Object.freeze({
    "SYS.2": ["To transform customer and internal needs into a set of analysed, classified and bidirectionally traceable system requirements.", "系统需求分析应将客户及内部需求转化为经过分析、分类并可双向追溯的系统需求集。"],
    "SYS.3": ["To define the system architecture, identify system elements and interfaces, and allocate system requirements to architectural elements.", "系统架构设计应定义系统架构、系统元素与接口，并将系统需求分配到架构元素。"],
    "SYS.4": ["To integrate the system elements and verify the integrated system against the defined system requirements.", "系统集成与集成验证应集成系统元素，并依据已定义的系统需求验证集成系统。"],
    "SYS.5": ["To verify the system against the system requirements and provide evidence that the integrated system fulfils its intended purpose.", "系统验证应依据系统需求验证系统，并提供集成系统满足预期用途的证据。"],
    "SWE.1": ["To transform system requirements into a set of analysed and traceable software requirements.", "软件需求分析应将系统需求转化为经过分析且可追溯的软件需求集。"],
    "SWE.2": ["To establish a software architecture that identifies software elements, interfaces and allocation of software requirements.", "软件架构设计应建立软件架构，识别软件元素、接口并分配软件需求。"],
    "SWE.3": ["To define the detailed design of software units and implement the software units consistently with that design.", "软件详细设计与单元构建应定义软件单元详细设计，并依据设计一致地构建单元。"],
    "SWE.4": ["To verify software units against the software detailed design and the defined verification criteria.", "软件单元验证应依据软件详细设计和已定义的验证准则验证软件单元。"],
    "SWE.5": ["To integrate software components and verify the integrated software components against the software architecture.", "软件组件验证与集成验证应集成软件组件，并依据软件架构验证集成结果。"],
    "SWE.6": ["To verify the complete software against its software requirements and record objective results.", "软件验证应依据软件需求验证完整软件，并记录客观结果。"]
  });
  const CLOSURE_STATE_EN = Object.freeze({
    "不适用": "Not applicable", "待处理": "Pending", "措施实施中": "Actions in progress", "验证中": "In verification", "已关闭": "Closed",
    "not applicable": "Not applicable", "pending": "Pending", "actions in progress": "Actions in progress", "in verification": "In verification", "closed": "Closed"
  });
  // Wording follows the corporate KM reference deck (ISO/IEC 33020 levels).
  const CAPABILITY_SCALE = Object.freeze([
    ["0", "Incomplete process", "The process is not implemented or fails to achieve its process purpose."],
    ["1", "Performed process", "The implemented process achieves its process purpose."],
    ["2", "Managed process", "Performed process implemented in a managed fashion: planned, monitored and adjusted; work products are established, controlled and maintained."],
    ["3", "Established process", "Managed process implemented using a defined process that is capable of achieving its process outcomes."],
    ["4", "Predictable process", "Established process operating predictively within defined limits; assignable causes of variation are identified and corrected."],
    ["5", "Innovating process", "Predictable process continually improved to respond to organizational change."]
  ]);
  // P and L are the RATING_RANK midpoints between the -/+ sub-bands (P sits
  // between P- and P+, L between L- and L+); their achievement value is the
  // boundary point the sibling RATING_SCORE table assigns (P=32.5, L=67.5).
  const NPLF_SCALE = Object.freeze([
    ["N", "Not implemented", "0% - 15% achievement"],
    ["P-", "Partially implemented", ">15% - 32.5% achievement"],
    ["P", "Partially implemented", "32.5% achievement"],
    ["P+", "Partially implemented", ">32.5% - 50% achievement"],
    ["L-", "Largely implemented", ">50% - 67.5% achievement"],
    ["L", "Largely implemented", "67.5% achievement"],
    ["L+", "Largely implemented", ">67.5% - 85% achievement"],
    ["F", "Fully implemented", ">85% - 100% achievement"]
  ]);
  const KM_OBSERVATION_LIMIT = 20;
  const KM_OBSERVATION_PAGE = 12;
  const KM_WEAKNESS_LIMIT = 8;
  const KM_EVIDENCE_PER_PAGE = 12;
  // A practice rationale only reaches a slide when the confirmed rating is below
  // "largely implemented". Otherwise the deck would repeat one boilerplate
  // sentence per practice, which is exactly the noise the KM narrative removes.
  const KM_GAP_RATING = /^(N|P-|P|P\+)$/;
  const KM_GAP_RATIONALE_LIMIT = 4;
  const normalizeCode = value => str(value).trim().replace(/\s+/g, "");
  const byId = (a, b) => str(a).localeCompare(str(b), undefined, { numeric: true, sensitivity: "base" });
  const codeRank = code => {
    const match = /^(BP|GP)(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(normalizeCode(code));
    if (!match) return 999999;
    return (match[1] === "BP" ? 0 : 100000) + Number(match[2]) * 1000 + Number(match[3] || 0) * 100 + Number(match[4] || 0);
  };
  const byCode = (a, b) => codeRank(a) - codeRank(b) || byId(a, b);
  function shortCode(processId, code) {
    const raw = normalizeCode(code);
    if (!raw) return "";
    const key = normalizeCode(processId);
    const body = key && raw.startsWith(key + ".") ? raw.slice(key.length + 1) : raw;
    return body.replace(/^(bp|gp|ap)/i, match => match.toUpperCase());
  }
  const fieldLines = pairs => arr(pairs).filter(pair => str(pair[1]).trim()).map(pair => `${str(pair[0])}: ${str(pair[1]).trim()}`);

  // Trace-style report extensions remain additive and record-based. These
  // helpers deliberately inspect only explicit indicator/status fields; an
  // absent GP or relation is never treated as achieved coverage.
  function explicitIndicatorCodes(record, processHint = "") {
    if (!record || typeof record !== "object") return [];
    const values = [
      record.indicator, record.indicatorCode, record.bpGpReference, record.bpGp,
      record.bpCode, record.gpCode, record.bpGpCode,
      record.sourceIndicator, record.targetIndicator, record.sourceBpGp,
      record.targetBpGp, ...arr(record.indicators), ...arr(record.indicatorCodes),
      ...arr(record.bpGpReferences), ...arr(record.sourceIndicators), ...arr(record.targetIndicators)
    ];
    const out = [];
    for (const value of values) {
      const raw = typeof value === "object" ? value.code || value.id || value.indicator : value;
      const code = normalizeCode(raw);
      if (!/^(?:(?:[A-Z0-9][A-Z0-9_-]*\.){1,3})?(?:BP|GP)\d/.test(code)) continue;
      const full = /^(?:BP|GP)\d/.test(code) && processHint ? `${normalizeCode(processHint)}.${code}` : code;
      if (!out.includes(full)) out.push(full);
    }
    return out;
  }

  function explicitEvidenceCodes(record) {
    if (!record || typeof record !== "object") return [];
    const values = [
      ...arr(record.evidenceCodes), ...arr(record.evidenceRefs), ...arr(record.evidenceIds),
      ...arr(record.evidence).map(value => typeof value === "object" ? value.evidenceCode || value.code || value.id : value)
    ];
    return [...new Set(values.map(value => str(value).trim()).filter(Boolean))];
  }

  function recordProvenance(record, fallback = "Explicit project record") {
    if (!record || typeof record !== "object") return fallback;
    const source = record.sourceRecordId || record.recordId || record.sourceId || record.sourceFile || record.sourceCell || record.locator || record.source;
    const id = record.id || record.assessmentId;
    if (source && id && str(source) !== str(id)) return `${str(source)} (${str(id)})`;
    if (source) return str(source);
    if (id) return `${fallback} ${str(id)}`;
    return fallback;
  }

  function reviewState(record) {
    if (!record || typeof record !== "object") return "Review status not recorded";
    if (record.reviewed === true || record.assessorConfirmed === true || record.confirmed === true) return "Assessor reviewed";
    if (record.reviewed === false || record.assessorConfirmed === false || record.confirmed === false) return "Review pending";
    return str(record.reviewStatus || record.confirmationStatus || "Review status not recorded");
  }

  function explicitGpStatus(record, assessment) {
    const raw = record && typeof record === "object" ? (record.availability ?? record.status ?? record.state ?? record.result ?? record.outcome) : "";
    if (str(raw).trim()) return str(raw).trim();
    if (assessment) return assessment.reviewed === true ? "Record present / assessor reviewed" : "Record present / review pending";
    return "Unknown / status not recorded";
  }
  function bulletText(value, limit = 240) {
    const raw = str(value).replace(/\s+/g, " ").trim();
    if (!raw) return "";
    const chars = Array.from(raw);
    if (chars.length <= limit) return raw;
    const head = chars.slice(0, limit).join("");
    const cut = Math.max(head.lastIndexOf(". "), head.lastIndexOf("; "), head.lastIndexOf("。"));
    return (cut > limit * 0.4 ? head.slice(0, cut + 1) : head).trim() + "…";
  }
  function uniqueText(values, limit) {
    const seen = new Set(); const out = [];
    let extra = 0;
    for (const value of arr(values)) {
      const text = str(value).trim();
      if (!text) continue;
      const key = text.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, " ").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      // Past the limit keep counting the suppressed uniques so the deck can
      // disclose that the narrative was truncated instead of silently dropping
      // observations and weaknesses.
      if (limit && out.length >= limit) { extra += 1; continue; }
      out.push(text);
    }
    if (limit && extra > 0) out.push(`+${extra} more (see full report)`);
    return out;
  }
  const closureStateEn = value => {
    const raw = str(value).trim();
    if (!raw) return "";
    if (CLOSURE_STATE_EN[raw]) return CLOSURE_STATE_EN[raw];
    const key = raw.toLowerCase();
    if (CLOSURE_STATE_EN[key]) return CLOSURE_STATE_EN[key];
    return REPORT_CJK.test(raw) ? "Not applicable" : raw;
  };
  const findingBucket = type => {
    const key = str(type).trim().toLowerCase();
    if (key === "w" || key === "weakness") return "weakness";
    if (key === "q" || key === "question") return "question";
    return "observation";
  };
  function padCell(value, width) {
    const text = str(value); const gap = width - weightedLength(text);
    return gap > 0 ? text + " ".repeat(gap) : text;
  }
  // Monospace text grid: keeps rating matrices and evidence registers readable
  // without shipping a real pptx table into the corporate prototype slide.
  function alignGrid(rows, gap = "   ") {
    const list = arr(rows).map(row => arr(row).map(cell => str(cell)));
    if (!list.length) return [];
    const columns = Math.max(1, ...list.map(row => row.length));
    const widths = Array.from({ length: columns }, (_, index) => Math.max(0, ...list.map(row => weightedLength(row[index] || ""))));
    return list.map(row => row.map((cell, index) => index === row.length - 1 ? cell : padCell(cell, widths[index])).join(gap).replace(/\s+$/, ""));
  }
  function assessmentPeriod(project) {
    const imported = project.importSource?.assessmentPeriod || {};
    const start = str(project.assessmentStartDate || project.startDate || project.onsiteStartDate || imported.start || "").trim();
    const end = str(project.assessmentEndDate || project.endDate || project.onsiteEndDate || imported.end || "").trim();
    if (start && end) return `${start} to ${end}`;
    const dates = arr(project.sessions).map(session => str(session.date).trim()).filter(Boolean).sort();
    if (dates.length) return dates.length > 1 ? `${dates[0]} to ${dates[dates.length - 1]}` : dates[0];
    return start || end || str(project.date || "").trim();
  }

  // Presentation-only view. The docx/xlsx sections stay exactly as they were;
  // this adds a KM narrative projection that never invents a rating.
  function buildPresentationView(project, options = {}, meta = {}) {
    const scope = arr(meta.scope).map(str).filter(Boolean);
    const all = arr(project.assessments);
    const human = typeof meta.human === "function" ? meta.human : () => false;
    const team = arr(meta.assessmentTeam);
    const template = requireTemplate("km-presentation");
    const generatedAt = str(meta.generatedAt || new Date().toISOString());
    const normal = value => normalizeCode(value);
    const scopeKey = new Map(scope.map(id => [normal(id), id]));
    const customNames = { ...(project.processNames || {}), ...(options.processNames || {}) };
    const processName = id => {
      const key = normal(id);
      const custom = str(customNames[id] || customNames[key]).trim();
      if (custom) return en(custom);
      if (PROCESS_TITLES[key]) return PROCESS_TITLES[key][1];
      const source = all.find(a => normal(a.process) === key && (a.processNameEn || a.processName));
      if (source) return en(source.processNameEn || source.processName);
      return "";
    };
    const paKey = value => normal(value).replace(/^PA/i, "PA");
    const weakest = ratings => arr(ratings).map(str).filter(rating => validRating.test(rating))
      .reduce((low, rating) => (RATING_RANK[rating] ?? 99) < (RATING_RANK[low] ?? 99) ? rating : low, null);
    const meets = (rating, target) => (RATING_RANK[str(rating)] ?? -1) >= (RATING_RANK[target] ?? 99);
    const capabilityFrom = ratings => {
      if (!meets(ratings["PA 1.1"], "L")) return 0;
      for (let level = 5; level >= 2; level -= 1) {
        const current = [`PA ${level}.1`, `PA ${level}.2`].every(pa => meets(ratings[pa], "L"));
        const lower = PA_COLUMNS.filter(pa => Number(str(pa).match(/\d+/)[0]) < level).every(pa => meets(ratings[pa], "F"));
        if (current && lower) return level;
      }
      return 1;
    };
    const matchesInstance = (item, instance) => {
      const key = normal(item.instanceId || item.instance || "");
      if (!key || !instance || !instance.id) return true;
      return key === normal(instance.id) || key === normal(instance.name);
    };
    const recordTouches = (record, processId, instance) => {
      if (!matchesInstance(record, instance)) return false;
      const key = normal(processId);
      if (normal(record.process) === key) return true;
      if (arr(record.processes).some(value => normal(value) === key)) return true;
      return arr(record.indicators).some(value => { const code = normal(value); return code === key || code.startsWith(key + "."); });
    };
    const processView = (processId, instance) => {
      const key = normal(processId);
      const items = all.filter(a => normal(a.process) === key && matchesInstance(a, instance));
      const reviewed = items.filter(human);
      const supplied = arr(options.processSummary).find(row => str(row.process) === processId);
      const approved = items.length > 0 && items.every(human) && items.every(a => a.capabilityClaim !== false);
      const allowed = approved && supplied?.reviewed === true;
      const paRatings = {};
      PA_COLUMNS.forEach(pa => {
        const suppliedRating = allowed ? str(supplied?.ratings?.[pa]) : "";
        paRatings[pa] = validRating.test(suppliedRating) ? suppliedRating :
          (weakest(reviewed.filter(a => paKey(a.pa) === paKey(pa)).map(a => a.rating)) || "NR");
      });
      let capability = "NR";
      if (allowed && Number.isInteger(supplied.capability) && supplied.capability >= 0 && supplied.capability <= 5) capability = supplied.capability;
      else if (PA_COLUMNS.every(pa => validRating.test(paRatings[pa]))) capability = capabilityFrom(paRatings);
      const bpGp = {};
      reviewed.forEach(a => {
        const code = shortCode(processId, a.code);
        const rating = str(a.rating);
        if (!/^(BP|GP)\d/.test(code) || !validRating.test(rating)) return;
        if (!bpGp[code] || (RATING_RANK[rating] ?? 99) < (RATING_RANK[bpGp[code]] ?? 99)) bpGp[code] = rating;
      });
      const findingPool = []; const notePool = []; const rationalePool = [];
      const findingWeaknesses = []; const recordObservations = []; const recordWeaknesses = [];
      reviewed.forEach(a => {
        const findings = arr(a.findings);
        findings.forEach(finding => {
          const text = bulletText(en(finding.textEn || finding.text));
          if (text) (findingBucket(finding.type) === "weakness" ? findingWeaknesses : findingPool).push(text);
        });
        const note = bulletText(en(a.reviewerNoteEn || a.reviewerNote));
        if (note) notePool.push(note);
        if (!findings.length && KM_GAP_RATING.test(str(a.rating))) {
          const rationale = bulletText(en(a.reasonEn || a.reason));
          if (rationale) rationalePool.push(rationale);
        }
      });
      arr(project.records).filter(record => recordTouches(record, processId, instance)).forEach(record => {
        const text = bulletText(en(record.textEn || record.text));
        if (!text) return;
        const bucket = findingBucket(record.type);
        if (bucket === "question") return;
        if (bucket === "weakness") {
          const closure = closureStateEn(record.closureState);
          recordWeaknesses.push(closure ? `${text} (${closure})` : text);
        } else recordObservations.push(text);
      });
      const observationPool = [...findingPool, ...notePool, ...recordObservations, ...rationalePool.slice(0, KM_GAP_RATIONALE_LIMIT)];
      const weaknessPool = [...findingWeaknesses, ...recordWeaknesses];
      const codes = Object.keys(bpGp).sort(byCode);
      const label = processName(processId);
      return {
        processId: str(processId), name: label, title: label ? `${processId} – ${label}` : str(processId),
        observations: uniqueText(observationPool, KM_OBSERVATION_LIMIT),
        weaknesses: uniqueText(weaknessPool, KM_WEAKNESS_LIMIT),
        paRatings, capability, bpGp,
        levelLine: `Level: ${PA_COLUMNS.map(pa => `${pa}=${paRatings[pa] || "NR"}`).join(" ")} (CL ${capability})`,
        bpLine: codes.filter(code => code.startsWith("BP")).map(code => `${code}=${bpGp[code]}`).join(" "),
        gpLine: codes.filter(code => code.startsWith("GP")).map(code => `${code}=${bpGp[code]}`).join(" ")
      };
    };
    const fallbackGroup = () => [{ id: "", name: en(project.nameEn || project.product || project.name) || "Assessed project", processes: scope.slice() }];
    const declared = arr(project.instances).filter(item => item && (str(item.id).trim() || str(item.name).trim()));
    let groups;
    if (!declared.length) groups = fallbackGroup();
    else {
      groups = declared.map(item => {
        const listed = uniqueText(arr(item.processes).map(value => scopeKey.get(normal(value)) || str(value).trim()).filter(Boolean), 0);
        const inScope = listed.filter(id => scope.includes(id));
        return {
          id: en(str(item.id).trim()),
          name: en(str(item.nameEn || item.name || item.short || item.id).trim()) || "Instance",
          processes: inScope.length ? inScope : listed
        };
      }).filter(group => group.processes.length);
      const covered = new Set(groups.flatMap(group => group.processes));
      const leftover = scope.filter(id => !covered.has(id));
      if (leftover.length) groups.push({ id: "", name: "Processes without an assigned instance", processes: leftover });
      if (!groups.length) groups = fallbackGroup();
    }
    const instances = groups.map(group => {
      const views = group.processes.map(id => processView(id, group));
      const matrixRow = codes => views.map(view => [view.processId, view.name || "-", ...codes.map(code => view.bpGp[code] || "-"), str(view.capability)]);
      const bpCodes = uniqueText(views.flatMap(view => Object.keys(view.bpGp).filter(code => code.startsWith("BP"))), 0).sort(byCode);
      const gpCodes = uniqueText(views.flatMap(view => Object.keys(view.bpGp).filter(code => code.startsWith("GP"))), 0).sort(byCode);
      return {
        id: group.id, name: group.name, processes: views,
        summary: { header: ["ID", "Name", ...PA_COLUMNS, "CL"], rows: views.map(view => [view.processId, view.name || "-", ...PA_COLUMNS.map(pa => view.paRatings[pa] || "NR"), str(view.capability)]) },
        matrix: { bpCodes, gpCodes, bpHeader: ["ID", "Name", ...bpCodes, "CL"], bpRows: matrixRow(bpCodes), gpHeader: ["ID", "Name", ...gpCodes, "CL"], gpRows: matrixRow(gpCodes) }
      };
    });
    const evidenceProcess = item => {
      const declaredKeys = [...arr(item.primaryProcesses), item.primaryProcess, item.scope, item.process].map(value => normal(value)).filter(Boolean);
      const direct = declaredKeys.map(value => scopeKey.get(value)).filter(Boolean);
      if (direct.length) return direct[0];
      const source = normal(item.code || item.id);
      let best = "";
      scope.forEach(id => { const key = normal(id); if (key && source.startsWith(key) && key.length > normal(best).length) best = id; });
      return best;
    };
    const evidenceItems = arr(project.evidence).map(item => ({
      id: str(item.code || item.id || "").trim(),
      name: en(item.nameEn || item.name) || "Not recorded",
      version: str(item.version || item.baseline || item.revision || "").trim() || "Not recorded",
      process: evidenceProcess(item)
    })).filter(item => item.id || item.name !== "Not recorded");
    const evidenceRank = item => item.process && scope.includes(item.process) ? scope.indexOf(item.process) : scope.length + (item.process ? 0 : 1);
    evidenceItems.sort((a, b) => evidenceRank(a) - evidenceRank(b) || byId(a.id || a.name, b.id || b.name));
    const organization = en(project.organizationEn || project.organization);
    const product = en(project.productEn || project.product);
    const unit = en(project.organizationalUnit || project.attributes?.organizationalUnit || project.location || project.attributes?.location);
    const projectName = en(project.nameEn || project.name) || str(project.id);
    const assessmentName = en(project.assessmentNameEn || project.assessmentName || project.nameEn || project.name);
    const teamNames = team.map(member => typeof member === "string" ? en(member) : en(member.name || member.displayName || member.userName || member.email || member.userId)).filter(Boolean);
    const leadAssessor = en(project.leadAssessor || project.leadAssessorName || project.attributes?.leadAssessor);
    const period = assessmentPeriod(project);
    const purpose = en(project.attributes?.purpose || project.purpose || project.assessmentPurpose);
    const targetLevel = str(project.targetLevel ?? project.attributes?.targetLevel ?? "").trim();
    const instanceCounts = declared.length ? scope.map(id => `${id}(${groups.filter(group => group.processes.includes(id)).length})`).join(", ") : "";
    const titles = Object.freeze({
      cover: "Automotive SPICE Assessment Results",
      plan: "Assessment Input · Assessment Plan",
      scope: "Assessment Input · Assessed Project and Assessment Scope",
      separator: "Ratings and Findings per Process for Instance",
      rating: "Rating, Instance",
      matrix: "BP and GP Matrix, Instance",
      evidence: "Considered Evidence",
      capability: "Capability Levels (0-5) - Rating Scale",
      nplf: "NPLF+- Rating Scale",
      back: "Assessment Presentation"
    });
    return {
      schema: "auditflow.report.presentation/v1",
      titles,
      labels: Object.freeze({ observation: "Observation", weakness: "Weakness" }),
      cover: { lines: [organization, ...fieldLines([
        ["Project", projectName],
        ["Assessment", assessmentName && assessmentName !== projectName ? assessmentName : ""],
        ["Product", product],
        ["Assessment Team", teamNames.join(", ") || leadAssessor],
        ["Assessment Period", period]
      ])].filter(value => str(value).trim()) },
      plan: { groups: [
        { heading: "Assessment Roles", rows: fieldLines([
          ["Sponsor / Position", en(project.sponsor || project.attributes?.sponsor)],
          ["Local Coordinator", en(project.localCoordinator || project.attributes?.localCoordinator)],
          ["Lead Assessor", leadAssessor],
          ["Assessor Team", teamNames.join(", ")],
          ["Company", organization]
        ]) },
        { heading: "Standards and Classifications", rows: fieldLines([
          ["Process Assessment Model", en(project.pam || "Automotive SPICE")],
          ["Assessment Standard", "ISO/IEC 33002"],
          ["Assessment Purpose", purpose],
          ["Assessment Class", en(project.attributes?.assessmentClass)],
          ["Independence Category", en(project.attributes?.independence)],
          ["Guidelines", en(project.attributes?.guidelines)]
        ]) }
      ] },
      scope: { groups: [
        { heading: "Project and Product", rows: fieldLines([
          ["Company", organization],
          ["Organizational Unit / Location", unit],
          ["Project", projectName],
          ["Product", product],
          ["ASIL Level", en(project.attributes?.asil || project.asil)],
          ["Application Domain", arr(project.attributes?.disciplines).map(value => en(value)).filter(Boolean).join(", ")],
          ["Assessment Period", period]
        ]) },
        { heading: "Assessment Scope", rows: fieldLines([
          ["Assessment Purpose", purpose],
          ["Process Instances", groups.map(group => [group.name, group.id].filter(Boolean).join(" ")).join("; ")],
          ["Process Instances and Locations", instanceCounts],
          ["Assessed Processes", scope.join(", ")],
          ["Target Capability Level", targetLevel]
        ]) }
      ] },
      instances,
      evidence: { header: ["Id", "Name", "Version"], items: evidenceItems },
      scales: {
        capability: { header: ["Code", "Rating", "Level of Achievement"], rows: CAPABILITY_SCALE.map(row => [...row]) },
        nplf: { header: ["Code", "Rating", "Level of Achievement"], rows: NPLF_SCALE.map(row => [...row]) }
      },
      back: { lines: fieldLines([
        ["Assessment Presentation", template.name],
        ["Organization", organization],
        ["Onsite Date of Assessment", period],
        ["Assessment Name", assessmentName || projectName],
        ["Assessment Id", str(project.reportNo || project.id)],
        ["Report Generated At", generatedAt],
        ["Project UUID", str(project.id)],
        ["Template Version", `${template.id} v${template.version}`]
      ]) }
    };
  }

  function buildCustomReportModel(project, options = {}) {
    const language = options.language === "zh" ? "zh" : "en";
    const title = (enTitle, zhTitle) => language === "zh" ? zhTitle : enTitle;
    const generatedAt = options.generatedAt || new Date().toISOString();
    const sqe = project.domain === "sqe" || project.sqeMeta;
    const meta = project.sqeMeta || {};
    const assessments = arr(project.assessments);
    const records = arr(project.ncRecords || project.records);
    const openNc = arr(project.ncRecords).filter(item => !["Closed", "已关闭"].includes(str(item.status))).length;
    const reviewed = assessments.filter(item => item.reviewed === true).length;
    const status = project.assessmentState === "Closed" && !openNc ? "CONTROLLED FINAL / HUMAN APPROVED" : "CONTROLLED DRAFT";
    const rows = assessments.map(item => [
      item.ppapNumber || item.code || item.questionId || "",
      language === "en" ? en(item.ppapNameEn || item.title || "") : str(item.ppapName || item.title || ""),
      item.ppapClause || item.reference || "",
      item.evidenceStatus || "pending",
      item.reviewed ? str(item.rating || "Assessor confirmed") : "Review pending",
      arr(item.ncrIds).join(", ") || "—",
      item.reason || ""
    ]);
    const ncRows = arr(project.ncRecords).map(item => [
      item.id || "",
      item.severity || "",
      item.status || "Open",
      item.questionId || item.itemId || "",
      item.owner || "Unassigned",
      item.dueDate || "Not set",
      item.rootCause || "Assessor analysis required",
      item.containment || "",
      item.correctiveAction || "",
      item.verification || ""
    ]);
    const evidenceRows = arr(project.evidence).map(item => [
      item.code || item.id || "",
      item.name || item.filename || "",
      item.version || item.baseline || "Not recorded",
      item.uploadedBy || item.owner || item.source || "Not recorded",
      item.uploadedAt || item.date || "Not recorded",
      item.locator || item.source || "Not recorded",
      item.evidenceRole || item.role || "Not recorded",
      item.parseStatus || "Not recorded"
    ]);
    const sections = [
      { title: title("1 SQE / PPAP submission profile", "1 SQE / PPAP 提交信息"), notes: ["AI output is advisory. Evidence role, item result, NC severity, corrective action and release decision require SQE/assessor confirmation."], tables: [table("Submission metadata", ["Field", "Recorded value"], [
        ["Project", project.name || project.id], ["Project ID", project.id], ["Supplier", meta.supplier || project.organization || "Not recorded"], ["Part number", meta.partNumber || "Not recorded"], ["Submission level", meta.submissionLevel ? `Level ${meta.submissionLevel}` : "Level 3"], ["Submission reason", meta.reason || "Not recorded"], ["Standard", meta.standard || project.standard || "AIAG PPAP 4th Edition"], ["Assessor state", status], ["Required items", sqe ? `${assessments.length} selected` : "Not applicable"], ["Reviewed items", `${reviewed}/${assessments.length}`], ["Open NC", openNc], ["Generated at", generatedAt]
      ])] },
      { title: title("2 Submission checklist and assessor disposition", "2 提交清单与审核结论"), notes: ["Index-only filenames and unconfirmed references do not prove implementation. Direct evidence must retain a locator and assessor review state."], tables: [table("Checklist", ["#", "Item", "Clause", "Evidence status", "Assessor result", "NC", "Rationale"], rows.length ? rows : [["", "No checklist items have been analysed.", "", "", "", "", ""]])] },
      { title: title("3 NC / corrective-action follow-up", "3 NC / 纠正措施跟踪"), notes: ["An external ticket or supplier statement is a corroborating reference only. Closure requires containment, root cause, corrective action, verification evidence and an authorized closure decision."], tables: [table("NC disposition", ["NC", "Severity", "Status", "Item", "Owner", "Due", "Root cause", "Containment", "Corrective action", "Verification"], ncRows.length ? ncRows : [["", "No NC records", "", "", "", "", "", "", "", ""]])] },
      { title: title("4 Evidence register", "4 证据登记"), notes: [], tables: [table("Uploaded evidence", ["ID", "Name", "Version / baseline", "Uploader", "Uploaded at", "Locator", "Role", "Parse state"], evidenceRows.length ? evidenceRows : [["", "No evidence uploaded", "", "", "", "", "", ""]])] },
      { title: title("5 Release decision and limitations", "5 放行结论与限制"), notes: ["The report is a controlled project record, not a PPAP approval or product certification. Release authority remains with the authorized SQE/assessor and customer representative where required."], tables: [table("Decision", ["Field", "Recorded value"], [
        ["Current conclusion", project.conclusion || "Pending"], ["Open NC", openNc], ["Evidence sufficiency", assessments.filter(item => item.evidenceSufficiency?.status === "sufficient").length + "/" + assessments.length + " sufficient"], ["Human review", `${reviewed}/${assessments.length}`], ["Release approval", project.reportApproval?.status || "No approval recorded"], ["Approved by", project.reportApproval?.approvedBy || "Not recorded"], ["Approval date", project.reportApproval?.approvedAt || "Not recorded"], ["Final remark", project.finalRemark || "No assessor final remark recorded"]
      ])] }
    ];
    return { schema: "auditflow.custom-report/v1", projectId: str(project.id), name: language === "en" ? en(project.name || project.id) : str(project.name || project.id), language, generatedAt, status, scope: [], sections };
  }

  // A fresh, read-only snapshot. No outcome refresh, AI inference or rating writes.
  function buildReportModel(project, options = {}) {
    if (!project || !str(project.id).trim()) throw new Error("A current project with an ID is required");
    if (project.schemeId || project.domain === "sqe" || project.sqeMeta) return buildCustomReportModel(project, options);
    const language = options.language === "zh" ? "zh" : "en";
    const title = (en, zh) => language === "zh" ? zh : en;
    const scope = [...new Set(arr(project.processes).map(str).filter(Boolean))];
    const all = arr(project.assessments);
    const scoped = all.filter(a => scope.includes(a.process));
    const human = a => a.reviewed === true && validRating.test(str(a.rating)) &&
      a.scopeStatus !== "related-only" && (!a.issueOnly || a.mappingCalibrated === true);
    const reportableAssessmentIds = new Set(arr(options.reportableAssessmentIds).map(str));
    const reportableAssessment = a => human(a) && reportableAssessmentIds.has(str(a.id));
    const indicator = a => str(a.primaryIndicator || (str(a.code).startsWith(str(a.process) + ".") ? a.code : [a.process, a.code].filter(Boolean).join(".")));
    const name = pick(project, "name", language) || str(project.id);
    const generatedAt = options.generatedAt || new Date().toISOString();
    const gate = options.gate || {};
    const ready = gate.gatePass === true && scope.length > 0 && scoped.length > 0 && scoped.every(reportableAssessment);
    const closed = project.assessmentState === "Closed";
    const status = closed && ready ? "CLOSED ASSESSMENT / RELEASE APPROVAL REQUIRED" : "CONTROLLED DRAFT";
    const includeCandidates = options.includeCandidates === true;
    const assessmentTeam = Array.isArray(project.collaboration?.members) ? project.collaboration.members : project.participants || project.assessmentTeam || project.team;
    const isAiTraceLink = link => /\b(?:ai|inferred|candidate|provider|model)\b/i.test(str(link?.source));
    const isAssessorConfirmedTraceLink = link => link?.confirmed === true && !isAiTraceLink(link);
    const linksFor = a => {
      const links = new Map();
      const identity = e => `${e.evidenceId || e.evidenceCode || e.id}|${e.itemId || e.atomicItemId || ""}`;
      arr(a.evidenceAnalysis).forEach(e => links.set(identity(e), {
        ...e,
        confirmed: isAssessorConfirmedTraceLink(e)
      }));
      arr(project.traceLinks).filter(e => e.indicator === indicator(a) || e.assessmentId === a.id).forEach(e => {
        const evidence=arr(project.evidence).find(item=>item.id===e.evidenceId);
        const source=e.source||(e.confirmed===true?"Assessor confirmed":"Assessor trace link");
        links.set(identity(e),{...links.get(identity(e)),...e,evidenceCode:e.evidenceCode||evidence?.code||e.evidenceId,confirmed:isAssessorConfirmedTraceLink({...e,source}),source});
      });
      return [...links.values()];
    };
    const evidenceText = a => linksFor(a).map(e => [e.evidenceCode || e.evidenceId, e.strength || e.evidenceRole || "index-only", e.locator, e.claim, e.confirmed === true ? "assessor-confirmed link" : e.confirmed === false ? "link not confirmed" : "link confirmation not recorded"].filter(Boolean).join(" | ")).join("\n") || join(a.refs) || "";
    const projectEvidence = arr(project.evidence);
    const evidenceFor = reference => {
      const ref = reference && typeof reference === "object" ? reference : { evidenceId: str(reference) };
      const keys = [ref.evidenceId, ref.evidenceCode, ref.evidenceRef, ref.code, ref.id].map(value => str(value).trim()).filter(Boolean);
      return projectEvidence.find(item => keys.includes(str(item.id)) || keys.includes(str(item.code))) || null;
    };
    const explicitEvidenceRefs = record => [
      ...arr(record.evidenceAnalysis),
      ...arr(record.evidenceRefs),
      ...arr(record.evidenceReferences),
      ...arr(record.evidence).filter(value => value && typeof value === "object"),
      ...arr(record.evidenceIds).map(evidenceId => ({ evidenceId }))
    ];
    const evidenceDetails = reference => {
      const link = reference && typeof reference === "object" ? reference : { evidenceId: str(reference) };
      const evidence = evidenceFor(link);
      const evidenceId = link.evidenceCode || evidence?.code || link.evidenceId || link.evidenceRef || link.code || evidence?.id || "Unresolved reference";
      const linkConfirmation = link.confirmed === true ? "Confirmed" : link.confirmed === false ? "Not confirmed" : str(link.reviewStatus || link.confirmationStatus || "Not recorded");
      const evidenceConfirmation = evidence?.confirmed === true ? "Confirmed" : evidence?.confirmed === false ? "Not confirmed" : "Not recorded";
      return {
        evidenceId,
        role: link.evidenceRole || link.strength || link.role || evidence?.evidenceRole || evidence?.role || "Not recorded",
        locator: link.locator || link.source || evidence?.locator || evidence?.source || evidence?.filename || "Not recorded",
        linkConfirmation,
        evidenceConfirmation
      };
    };
    const blockerSummary = blockers => { const counts = new Map(); arr(blockers).forEach(item => { const label = en(typeof item === "string" ? item : item.title || item.message || item.label || item.code || "Unresolved blocker"); counts.set(label, (counts.get(label) || 0) + 1); }); return [...counts].map(([label, count]) => `${label}${count > 1 ? ` (${count})` : ""}`).join("; "); };
    const reportable = scoped.filter(reportableAssessment);
    const pendingCandidates = includeCandidates ? scoped.filter(assessment => !human(assessment)) : [];
    const reportableScope = scope.filter(process => reportable.some(assessment => assessment.process === process));
    const summary = reportableScope.map(process => {
      const items = reportable.filter(a => a.process === process);
      const approved = items.length > 0 && items.every(human) && items.every(a => a.capabilityClaim !== false);
      const supplied = arr(options.processSummary).find(row => row.process === process);
      const allowed = approved && supplied?.reviewed === true;
      return [process, ...["PA 1.1", "PA 2.1", "PA 2.2", "PA 3.1", "PA 3.2"].map(pa => allowed && validRating.test(str(supplied?.ratings?.[pa])) ? supplied.ratings[pa] : "NR"), allowed && Number.isInteger(supplied.capability) && supplied.capability >= 0 && supplied.capability <= 5 ? supplied.capability : "NR", allowed ? "Assessor-confirmed aggregate" : "Aggregate not confirmed"];
    });
    const related = [];
    reportable.filter(a => !scope.includes(a.process) || a.scopeStatus === "related-only").forEach(a => related.push([a.process || "Unclassified", indicator(a), pick(a, "reason", language) || pick(a, "title", language), evidenceText(a), "Related observation / not rated"]));
    const observations = [...arr(project.crossProcessObservations), ...arr(project.relatedObservations), ...reportable.flatMap(a => [...arr(a.crossProcessObservations), ...arr(a.crossProcessAnalysis)].map(o=>({...o,formalProcess:a.process})))];
    const relationRows=observations.map(o=>[o.sourceProcess||o.relatedProcess||o.process||"Unclassified",o.targetProcess||o.formalProcess||"Not recorded",o.relationType||"interface",scope.includes(o.relatedProcess||o.sourceProcess||o.process)?"in-scope context / not a rating":"related-only / not rated",join(o.evidenceCodes||o.evidenceRefs)||arr(o.evidence).map(e=>e.evidenceCode||e.code||e.id||str(e)).join("; ")||str(o.locator),pick(o,"supportedClaim",language)||pick(o,"observation",language)||pick(o,"text",language)||pick(o,"claim",language)||"Not recorded",pick(o,"gapOrRisk",language)||pick(o,"gap",language)||pick(o,"risk",language)||"Not recorded",pick(o,"followUp",language)||join(o.interviewQuestions)||join(o.closureEvidence)||"Not recorded",o.pass||o.analysisPass||join(o.analysisPasses||o.passes)||"Pass not recorded"]);
    observations.forEach((o,i)=>{if(!scope.includes(o.relatedProcess||o.sourceProcess||o.process))related.push([relationRows[i][0],relationRows[i][1],relationRows[i][5],relationRows[i][4],"Related observation / not rated"]);});
    const coverage=scope.map(process=>[process,...["upstream","downstream","MAN.3","SUP.1","SUP.8","SUP.9","SUP.10"].map(perspective=>{
      const relatedToProcess=o=>o.formalProcess===process||o.targetProcess===process||o.sourceProcess===process;
      const matches=observations.filter(o=>relatedToProcess(o)&&(o.relationType===perspective||[o.sourceProcess,o.relatedProcess].includes(perspective)));
      const links=reportable.filter(a=>a.process===process).flatMap(linksFor).filter(e=>e.relationType===perspective||[e.originProcess,e.sourceProcess,e.relatedProcess].includes(perspective));
      const refs=new Set([...matches.flatMap(o=>arr(o.evidenceCodes||o.evidenceRefs)),...links.map(e=>e.evidenceCode||e.evidenceId)].filter(Boolean));
      return matches.length||links.length?`${matches.length} observations; ${refs.size} evidence references; ${links.filter(e=>e.confirmed).length} confirmed links` : "Not evidenced / review required";
    })]);
    const records = arr(project.records).map(r => [r.id, r.type, join(r.indicators), pick(r,"text",language), join(r.evidenceIds), r.owner || r.governance?.owner || "Unassigned", r.dueDate || r.due || r.governance?.due || "Not set", r.status || "Draft", r.closureState || "Not recorded"]);
    const findingEvidenceRows = reportable.flatMap(a => arr(a.findings).flatMap((f,i) => {
      const findingId = str(f.id || `${indicator(a)}-${i+1}`);
      const explicitLinks = explicitEvidenceRefs(f);
      const traceLinks = f.id ? arr(project.traceLinks).filter(link =>
        (link.findingId === f.id || arr(link.findingIds).includes(f.id)) &&
        (!link.assessmentId || link.assessmentId === a.id) &&
        (!link.indicator || link.indicator === indicator(a))
      ) : [];
      const byEvidence = new Map();
      [...explicitLinks, ...traceLinks].forEach(reference => {
        const detail = evidenceDetails(reference);
        const key = `${findingId}|${detail.evidenceId}`;
        const existing = byEvidence.get(key);
        if (!existing) byEvidence.set(key, detail);
        else Object.keys(detail).forEach(field => {
          if ((!existing[field] || existing[field] === "Not recorded") && detail[field] && detail[field] !== "Not recorded") existing[field] = detail[field];
        });
      });
      return [...byEvidence.values()].map(detail => [findingId, a.process, indicator(a), detail.evidenceId, detail.role, detail.locator, detail.linkConfirmation, detail.evidenceConfirmation]);
    }));
    const findings = reportable.flatMap(a => arr(a.findings).map((f,i) => [f.id || `${indicator(a)}-${i+1}`, f.type, indicator(a), pick(f,"text",language), join(a.closureEvidence), a.governance?.owner || "Unassigned", a.governance?.due || "Not set", "Assessor reviewed", str(a.closureState || "Not recorded")]));
    const milestoneChecks = arr(project.milestoneChecks).flatMap((check,index) => {
      const checkId = str(check.id || `MC-${index+1}`);
      const refs = explicitEvidenceRefs(check);
      const details = refs.length ? refs.map(evidenceDetails) : [null];
      return details.map(detail => [
        checkId,
        pick(check,"area",language) || "Not recorded",
        pick(check,"milestone",language) || "Not recorded",
        pick(check,"questionOrCheck",language) || pick(check,"question",language) || pick(check,"check",language) || pick(check,"title",language) || "Not recorded",
        pick(check,"result",language) || pick(check,"outcome",language) || str(check.status || "Not recorded"),
        detail?.evidenceId || "",
        detail?.role || "",
        detail?.locator || "",
        detail?.linkConfirmation || "",
        check.reviewed === true ? "Assessor reviewed" : check.reviewed === false ? "Review pending" : str(check.reviewStatus || "Review status not recorded"),
        "Checkpoint record only; no ASPICE rating inferred"
      ]);
    });

    const gpRecords = [];
    const gpByCode = new Map();
    const addGpRecord = (record, sourceKind, assessment = null) => {
      const process = str(record?.process || record?.processId || assessment?.process || "Unclassified");
      const codes = explicitIndicatorCodes(record, process).filter(code => /\.GP\d/.test(code) || /^GP\d/.test(code));
      const fallbackCodes = assessment ? explicitIndicatorCodes(assessment, assessment.process).filter(code => /\.GP\d/.test(code) || /^GP\d/.test(code)) : [];
      [...new Set([...codes, ...fallbackCodes])].forEach(code => {
        const key = `${process}|${code}`;
        const evidence = explicitEvidenceCodes(record);
        if (assessment) evidence.push(...explicitEvidenceCodes(assessment));
        const provenance = [recordProvenance(record, sourceKind), assessment ? recordProvenance(assessment, "Assessment record") : ""].filter(Boolean).join("; ");
        const existing = gpByCode.get(key);
        if (existing) {
          existing.evidenceCodes = [...new Set([...existing.evidenceCodes, ...evidence])];
          existing.provenance = [...new Set(`${existing.provenance}; ${provenance}`.split(/;\s*/).filter(Boolean))].join("; ");
          if (existing.status === "Unknown / status not recorded" && record) existing.status = explicitGpStatus(record, assessment);
          if (existing.reviewState === "Review status not recorded") existing.reviewState = reviewState(record || assessment);
          return;
        }
        const entry = {
          process, code,
          status: explicitGpStatus(record, assessment),
          provenance: provenance || sourceKind,
          evidenceCodes: [...new Set(evidence)],
          reviewState: reviewState(record || assessment),
          boundary: "Status/availability only; no ASPICE rating inferred"
        };
        gpByCode.set(key, entry);
        gpRecords.push(entry);
      });
    };
    const explicitGpRecords = [
      ...arr(project.gpAvailability), ...arr(project.genericPracticeAvailability),
      ...arr(project.gpStatuses), ...arr(project.gpRecords)
    ];
    explicitGpRecords.forEach(record => addGpRecord(record, "Explicit GP availability/status record"));
    scoped.filter(assessment => explicitIndicatorCodes(assessment, assessment.process).some(code => /\.GP\d/.test(code) || /^GP\d/.test(code)))
      .forEach(assessment => addGpRecord(assessment, "Assessment GP record", assessment));
    gpRecords.sort((a, b) => byId(a.process, b.process) || byCode(a.code, b.code));
    const gpAvailability = {
      schema: "auditflow.gp-availability/v1",
      status: gpRecords.length ? "recorded" : "not-recorded",
      rows: gpRecords.map(entry => ({ ...entry, evidenceCodes: [...entry.evidenceCodes] })),
      boundary: "Only explicit GP records are listed. Missing records are unknown and do not imply absence, achievement or a rating."
    };
    const gpAvailabilityRows = gpRecords.length ? gpRecords.map(entry => [
      entry.process, entry.code, entry.status, entry.provenance,
      entry.evidenceCodes.join("; ") || "No evidence reference recorded", entry.reviewState, entry.boundary
    ]) : [["Not recorded", "Not recorded", "Unknown / status not recorded", "No explicit GP availability/status record supplied", "No evidence reference recorded", "Review required", gpAvailability.boundary]];

    const coverageRecords = [];
    const addCoverageRecord = (record, sourceKind) => {
      if (!record || typeof record !== "object") return;
      const sourceProcess = str(record.sourceProcess || record.formalProcess || record.process || record.relatedProcess || "").trim();
      const targetProcess = str(record.targetProcess || record.relatedProcess || record.formalProcess || record.process || "").trim();
      if (!sourceProcess && !targetProcess) return;
      const source = sourceProcess || "Unclassified";
      const target = targetProcess || "Unclassified";
      const relationType = str(record.relationType || record.relation || "interface").trim() || "interface";
      const indicators = explicitIndicatorCodes(record, sourceProcess || targetProcess);
      const evidenceCodes = explicitEvidenceCodes(record);
      coverageRecords.push({
        sourceProcess: source, targetProcess: target, relationType,
        scopeStatus: str(record.scopeStatus || record.scope || (scope.includes(source) && scope.includes(target) ? "in-scope context / not a rating" : "related-only / not rated")),
        indicators, evidenceCodes,
        state: evidenceCodes.length ? "Evidence referenced" : indicators.length ? "Observation only" : "Process relation only",
        provenance: recordProvenance(record, sourceKind),
        reviewState: reviewState(record),
        boundary: "Coverage record only; no ASPICE rating or completeness claim inferred"
      });
    };
    observations.forEach((record, index) => addCoverageRecord(record, `Cross-process observation ${index + 1}`));
    const coveragePairs = new Map();
    coverageRecords.forEach(record => {
      const key = `${record.sourceProcess}|${record.targetProcess}|${record.relationType}`;
      const existing = coveragePairs.get(key) || {
        sourceProcess: record.sourceProcess, targetProcess: record.targetProcess, relationType: record.relationType,
        scopeStatus: record.scopeStatus, records: [], indicators: new Map(), provenance: new Set()
      };
      existing.records.push(record);
      record.provenance.split(/;\s*/).filter(Boolean).forEach(value => existing.provenance.add(value));
      record.indicators.forEach(code => {
        const bucket = existing.indicators.get(code) || { states: new Set(), evidenceCodes: new Set(), records: new Set() };
        bucket.states.add(record.state);
        record.evidenceCodes.forEach(value => bucket.evidenceCodes.add(value));
        bucket.records.add(record.provenance);
        existing.indicators.set(code, bucket);
      });
      coveragePairs.set(key, existing);
    });
    const coverageIndicatorCodes = [...new Set(coverageRecords.flatMap(record => record.indicators))].sort(byCode);
    const coverageHeatmapRows = [...coveragePairs.values()].sort((a, b) => byId(a.sourceProcess, b.sourceProcess) || byId(a.targetProcess, b.targetProcess) || byId(a.relationType, b.relationType)).map(pair => [
      pair.sourceProcess, pair.targetProcess, pair.relationType, pair.scopeStatus,
      ...coverageIndicatorCodes.map(code => {
        const bucket = pair.indicators.get(code);
        if (!bucket) return "Not recorded";
        const refs = [...bucket.evidenceCodes];
        return refs.length ? `Evidence referenced (${refs.length})` : [...bucket.states].join(" / ");
      }),
      [...pair.provenance].join("; ") || "Explicit relation record"
    ]);
    const coverageHeatmap = {
      schema: "auditflow.cross-process-bp-gp-coverage/v1",
      status: coverageRecords.length ? "recorded" : "not-recorded",
      indicatorCodes: coverageIndicatorCodes,
      rows: coverageHeatmapRows.map(row => ({
        sourceProcess: row[0], targetProcess: row[1], relationType: row[2], scopeStatus: row[3],
        cells: Object.fromEntries(coverageIndicatorCodes.map((code, index) => [code, row[4 + index]])), provenance: row[4 + coverageIndicatorCodes.length]
      })),
      details: coverageRecords.map(record => ({ ...record, indicators: [...record.indicators], evidenceCodes: [...record.evidenceCodes] })),
      boundary: "Only explicit cross-process observations and links are represented. Empty cells are not recorded and do not imply missing implementation or achieved coverage."
    };
    const coverageHeatmapHeaders = ["Source process", "Target process", "Relation type", "Scope status", ...coverageIndicatorCodes, "Provenance"];
    const coverageHeatmapTableRows = coverageHeatmapRows.length ? coverageHeatmapRows : [["Not recorded", "Not recorded", "Not recorded", "Review required", ...coverageIndicatorCodes.map(() => "Not recorded"), "No explicit cross-process BP/GP relation record supplied"]];
    const coverageDetailRows = coverageRecords.length ? coverageRecords.map(record => [
      record.sourceProcess, record.targetProcess, record.relationType, record.scopeStatus,
      record.indicators.join("; ") || "BP/GP indicator not recorded", record.state,
      record.evidenceCodes.join("; ") || "No evidence reference recorded", record.provenance, record.reviewState, record.boundary
    ]) : [["Not recorded", "Not recorded", "Not recorded", "Review required", "BP/GP indicator not recorded", "Process relation not recorded", "No evidence reference recorded", "No explicit cross-process relation record supplied", "Review required", coverageHeatmap.boundary]];
    const sections = [
      { title: title("1 Assessment Plan", "1 评估计划"), notes: [], tables: [table("Project and scope", ["Field", "Current project value"], [
        ["Project ID", project.id], ["Project name", name], ["Organization", pick(project, "organization", language) || "Not recorded"], ["Product", pick(project, "product", language) || "Not recorded"],
        ["Report number", project.reportNo || project.id], ["PAM", project.pam || "Not recorded"], ["Assessment dates", project.assessmentStartDate || project.startDate || project.date || "Not recorded"], ["End date", project.assessmentEndDate || project.endDate || "Not recorded"],
        ["Purpose", pick(project, "purpose", language) || pick(project, "assessmentPurpose", language) || "Not recorded"], ["Formal scope", scope.join(", ") || "No formal processes selected"], ["Target capability", project.targetLevel ?? "Not recorded"],
        ["Assessment team", arr(assessmentTeam).map(p => typeof p === "string" ? en(p) : [en(p.name||p.displayName||p.email||p.userId),en(p.role||p.projectRole)].filter(Boolean).join(" / ")).join("; ") || en(project.leadAssessor || "Not recorded")],
        ["Instances", arr(project.instances).map(p => en(p.name || p.nameEn || p.id)).join("; ") || "Not recorded"], ["Generated at", generatedAt], ["Report state", status]
      ])] },
      { title: title("2 Summary of Assessment Results", "2 评估结果汇总"), notes: ["NR means no confirmed formal aggregate is available. No capability level is inferred from AI candidates."], tables: [table("Formal scope ratings", ["Process","PA 1.1","PA 2.1","PA 2.2","PA 3.1","PA 3.2","Capability","Authority"], summary), table("Review status",["Field","Value"],[["In-scope assessments",scoped.length],["Assessor-confirmed ratings with formal support",reportable.length],["Pending or unsupported assessments",scoped.length-reportable.length],["Closure gate",gate.gatePass === true ? "Passed" : "Not passed or not supplied"],["Blockers",blockerSummary(gate.blockers) || ""]])] },
      { title: title("3 Detailed Process Assessment Results", "3 过程评估明细"), notes: ["Formal ratings are limited to the selected scope and confirmed human decisions. An AI candidate never replaces a human rating."], tables: [table("BP GP PA assessment", ["Indicator","PA","Human rating","Review status","Rationale","Evidence references and roles","Assessor note"], reportable.filter(a => a.scopeStatus !== "related-only").map(a=>[indicator(a),a.pa||"",human(a)?a.rating:"NR",human(a)?"Assessor confirmed":"Review or mapping confirmation pending",pick(a,"reason",language),evidenceText(a),pick(a,"reviewerNote",language)])),...(includeCandidates?[table("AI candidates / not approved",["Indicator","Candidate rating","Candidate rationale","Review boundary"],pendingCandidates.filter(a=>a.scopeStatus !== "related-only").map(a=>[indicator(a),a.aiCandidateRating||a.rating||"NR",pick(a,"aiReason",language)||pick(a,"reason",language),"AI candidate only / human decision preserved"]))]:[])] },
      { title: title("4 Assessed Work Products", "4 已评估工作产品"), notes: ["Evidence roles and confirmation states are copied from current records. Related or index-only evidence cannot replace direct implementation evidence."], tables: [table("Evidence register",["ID","Name","Version or baseline","Primary process","Role","Locator or source","Confirmation"],arr(project.evidence).map(e=>[e.code||e.id,pick(e,"name",language),e.version||e.baseline||"Not recorded",join(e.primaryProcesses)||e.primaryProcess||e.scope||"Unclassified",e.evidenceRole||e.role||"Not recorded",e.locator||e.source||e.filename||"Not recorded",e.confirmed===true?"Confirmed":"Confirmation not recorded"]))] },
      { title: title("5 Findings and Improvement Roadmap", "5 发现与改进路线图"), notes: [], tables: [table("Assessor records",["ID","Type","Indicators","Description","Evidence","Owner","Due","Record status","Closure"],records),table("Assessment findings",["ID","Type","Indicator","Finding","Minimum closure evidence","Owner","Due","Review status","Closure"],findings),table("Related process observations",["Related process","Target or indicator","Observation","Evidence","Rating boundary"],related)] },
      { title: title("6 Final Remark", "6 最终说明"), notes: [
        "AI output is advisory and requires assessor review. This export does not approve, rate, baseline, close or certify an assessment.",
        "Only the current project's formal scope may carry formal ratings. Related processes remain non-rated observations. Human ratings, approvals and evidence confirmations are preserved.",
        "Release authority remains with the authorized lead assessor. A closed assessment and a passed internal gate do not constitute certification."
      ], tables: [table("Approval and limitations",["Field","Recorded value"],[["Assessment state",en(project.assessmentState||"Open")],["Export state",status],["Lead assessor",en(project.leadAssessor||"Not recorded")],["Approval",en(project.reportApproval?.status||"No report release approval recorded")],["Approved by",en(project.reportApproval?.approvedBy||"Not recorded")],["Approval date",project.reportApproval?.approvedAt||"Not recorded"],["Final remark",pick(project,"finalRemark",language)||"No assessor final remark recorded"]])] }
    ];
    sections[1].tables.push(table("Cross-process coverage",["Formal process","Upstream","Downstream","MAN.3","SUP.1","SUP.8","SUP.9","SUP.10"],coverage.filter(row => reportableScope.includes(row[0]))));
    sections[1].tables.push(table("GP availability and status",["Process","GP indicator","Availability / status","Data provenance","Evidence references","Review status","Rating boundary"],gpAvailabilityRows));
    sections[1].tables.push(table("Cross-process BP/GP coverage heatmap",coverageHeatmapHeaders,coverageHeatmapTableRows));
    sections[4].tables.push(table("Cross-process analysis details",["Source process","Target process","Relation type","Scope status","Evidence codes","Supported claim","Gap or risk","Follow-up evidence or question","Analysis pass"],relationRows));
    sections[4].tables.push(table("Cross-process BP/GP coverage details",["Source process","Target process","Relation type","Scope status","BP/GP indicators","Coverage state","Evidence references","Data provenance","Review status","Rating boundary"],coverageDetailRows));
    sections[1].tables.push(table("Cross-process method and relation legend",["Analysis pass","Review intent"],[
      ["qualified-flow","Qualified and approved inputs, transformation, outputs and hand-off"],
      ["agree-summarize","Agreed requirements and meaningful verification, plan, quality, problem and change summaries"],
      ["divide-control","Decomposition, delegation, integration and verification against design"],
      ["trace-consistency","Bidirectional traceability, semantic consistency, change impact and completeness"],
      ["Relation legend","upstream / downstream / governance MAN.3 / assurance SUP.1 / configuration SUP.8 / problem SUP.9 / change SUP.10 / interface"],
      ["Coverage boundary","Counts report existing observations and links, not achieved coverage or completed analysis. Missing checks require assessor review."]
    ]));
    if (findingEvidenceRows.length) sections[4].tables.push(table("Finding-specific evidence links",["Finding ID","Process","Indicator","Evidence ID / code","Evidence role","Locator / source","Link confirmation","Evidence confirmation"],findingEvidenceRows));
    if (milestoneChecks.length) sections[4].tables.push(table("Milestone checks",["Check ID","Area","Milestone","Question / check","Recorded result","Evidence ID / code","Evidence role","Locator / source","Link confirmation","Review status","Rating boundary"],milestoneChecks));
    if(language==="zh"){
      const labels={"Field":"字段","Value":"值","Current project value":"当前项目值","Project and scope":"项目与范围","Formal scope ratings":"正式范围评级","Review status":"复核状态","BP GP PA assessment":"BP GP PA 评估","AI candidates / not approved":"AI 候选 / 未批准","Evidence register":"证据清单","Assessor records":"评估师记录","Assessment findings":"评估发现","Finding-specific evidence links":"Finding 证据关联","Milestone checks":"里程碑检查","Related process observations":"关联过程观察","Approval and limitations":"批准与限制","Process":"过程","Capability":"能力等级","Authority":"结论来源","Indicator":"指标","Human rating":"人工评级","Rationale":"理由","Evidence references and roles":"证据引用与角色","Assessor note":"评估师备注","Candidate rating":"候选评级","Candidate rationale":"候选理由","Review boundary":"复核边界","Name":"名称","Version or baseline":"版本或基线","Primary process":"主过程","Role":"角色","Locator or source":"定位或来源","Confirmation":"确认状态","Type":"类型","Indicators":"指标","Description":"描述","Evidence":"证据","Owner":"责任人","Due":"到期日","Record status":"记录状态","Closure":"关闭状态","Finding":"发现","Minimum closure evidence":"最小关闭证据","Finding ID":"Finding ID","Evidence ID / code":"证据 ID / 编号","Evidence role":"证据角色","Locator / source":"定位 / 来源","Link confirmation":"关联确认","Evidence confirmation":"证据确认","Check ID":"检查 ID","Area":"领域","Milestone":"里程碑","Question / check":"问题 / 检查项","Recorded result":"记录结果","Review status":"复核状态","Rating boundary":"评级边界","Related process":"关联过程","Target or indicator":"目标或指标","Observation":"观察","Recorded value":"已记录值","Cross-process coverage":"跨过程覆盖矩阵","Formal process":"正式过程","Upstream":"上游","Downstream":"下游","Cross-process analysis details":"跨过程分析明细","Source process":"来源过程","Target process":"目标过程","Relation type":"关系类型","Scope status":"范围状态","Evidence codes":"证据编号","Supported claim":"支持的结论","Gap or risk":"缺口或风险","Follow-up evidence or question":"后续证据或访谈问题","Analysis pass":"分析遍次","Review intent":"审核意图","Cross-process method and relation legend":"跨过程方法与关系图例","GP availability and status":"GP 可用性与状态","Cross-process BP/GP coverage heatmap":"跨过程 BP/GP 覆盖热力矩阵","Cross-process BP/GP coverage details":"跨过程 BP/GP 覆盖明细","Availability / status":"可用性 / 状态","Data provenance":"数据来源","Evidence references":"证据引用","Coverage state":"覆盖状态","BP/GP indicators":"BP/GP 指标","Coverage boundary":"覆盖边界","Provenance":"来源","Status/availability only; no ASPICE rating inferred":"仅记录状态/可用性；不推导 ASPICE 评级","Coverage record only; no ASPICE rating or completeness claim inferred":"仅为覆盖记录；不推导 ASPICE 评级或完整性结论"};
      sections.forEach(s=>s.tables.forEach(t=>{if(labels[t.title])t.title=labels[t.title]+" / "+t.title;t.headers=t.headers.map(h=>labels[h]?labels[h]+" / "+h:h);}));
    }
    const englishize = (value, sourceLanguage = false) => {
      if (typeof value === "string") return sourceLanguage ? value : en(value);
      if (Array.isArray(value)) return value.map(entry => englishize(entry, sourceLanguage));
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, englishize(entry, sourceLanguage || ["text", "content", "evidence", "description"].includes(key))]));
      return value;
    };
    // The KM projection is additive. If it cannot be built the deck falls back
    // to the legacy section dump instead of breaking the docx/xlsx exports.
    let presentation = null;
    try { presentation = buildPresentationView(project, options, { name, language, generatedAt, status, scope, human, indicator, assessmentTeam }); }
    catch (error) { presentation = null; }
    const helixIssues = arr(project.helixReview?.items).filter(item => item.type === "issue-nc").map(item => ({
      issueNo: item.externalId || item.id,
      process: item.process || "UNCLASSIFIED",
      title: item.title || "",
      description: item.description || "",
      severity: item.severity || "",
      status: item.status || "",
      owner: item.owner || "",
      dueDate: item.dueDate || "",
      sourceFile: item.sourceFile || "",
      locator: item.locator || "",
      evidenceRole: item.evidenceRole || "index-only",
      assessorStatus: item.aiConfiguration?.status === "assessor-confirmed" ? "Assessor confirmed" : "Candidate / needs confirmation"
    }));
    const issueReferences = arr(root.AUDITFLOW_TUV_ISSUE_REFERENCE?.issues);
    const projectMatches = issue => scoped.filter(assessment => {
      if (assessment.process !== issue.process) return false;
      const text = `${assessment.title || ""} ${assessment.criterion || ""} ${arr(assessment.findings).map(finding => finding.text || "").join(" ")}`.toLowerCase();
      return issue.category && text.includes(str(issue.category).toLowerCase());
    }).map(assessment => assessment.code || assessment.id);
    const tuvReferences = issueReferences.filter(issue => !scope.length || scope.includes(issue.process)).map(issue => ({
      referenceId: issue.referenceId || issue.issueId || "",
      process: issue.process || "",
      severity: issue.severity || "",
      status: issue.status || "",
      description: language === "en" ? en(str(issue.description || "").split("【中文说明】")[0].trim()) : str(issue.description || ""),
      improvementMeasures: language === "en" ? en(str(issue.improvementMeasures || "").split("【中文说明】")[0].trim()) : str(issue.improvementMeasures || ""),
      projectMatches: projectMatches(issue).join(", ")
    }));
    const projectIssueRecords = buildProjectIssueRecords(project, scoped, issueReferences, {
      language, generatedAt, projectName: name, scope, helixIssues
    });
    return {
      schema: "auditflow.report/v10",
      projectId: str(project.id),
      name,
      language,
      generatedAt,
      status,
      scope,
      gpAvailability,
      coverageHeatmap,
      sections: language === "en" ? englishize(sections) : sections,
      presentation,
      helixIssues,
      tuvReferences,
      projectIssueRecords,
      traceWorkbook: buildTraceWorkbook(project, { language, scope, indicator, reportableAssessment, includeCandidates, name, status }),
      assessmentEvidence: Object.fromEntries(scoped.map(assessment => [assessment.id, reportEvidenceNarrative(project, assessment, language, indicator(assessment), assessment.process)])),
      _assessments: scoped
    };
  }

  function projectIssueText(value, language) {
    const raw = str(value || "").trim();
    if (!raw) return "";
    if (language === "en") return en(raw.split("【中文说明】")[0].trim());
    return raw;
  }

  function buildProjectIssueRecords(project, scoped, issueReferences, context) {
    const { language, generatedAt, projectName, scope, helixIssues } = context;
    const records = [];
    const add = (item, sourceKind, fallbackProcess = "UNCLASSIFIED") => {
      if (!item || typeof item !== "object") return;
      const process = str(item.process || item.selectedProcess || item.processRaw || fallbackProcess || "UNCLASSIFIED");
      if (scope.length && process !== "UNCLASSIFIED" && !scope.includes(process)) return;
      const evidence = arr(project.evidence).find(entry => entry.id === item.sourceEvidenceId || entry.code === item.sourceEvidenceCode);
      const evidenceCode = str(item.sourceEvidenceCode || evidence?.code || item.evidenceCode || "");
      const locator = str(item.locator || item.sourceCell || item.sourcePage || item.source || evidence?.locator || evidence?.source || "");
      const id = str(item.externalId || item.issueNo || item.issueId || item.id || `${project.id}-${process}-${records.length + 1}`);
      const status = str(item.status || item.closureState || "Open");
      const closureChain = item.closureChain || item.ncFollowup || {};
      const action = arr(item.solutionSteps).join("\n") || str(item.correctiveAction || item.action || item.actionItems || "");
      const description = projectIssueText(item.description || item.originalProblem || item.auditExplanation || item.text || item.title, language);
      const refs = issueReferences.filter(reference => reference.process === process).slice(0, 2).map(reference => reference.referenceId || reference.issueId);
      records.push({
        issueId: id,
        process,
        category: projectIssueText(item.category || item.title || item.type || "Project issue", language),
        severity: projectIssueText(item.severity || "Unconfirmed", language),
        status: projectIssueText(status, language),
        date: str(item.updatedAt || item.createdAt || item.date || generatedAt).slice(0, 10),
        owner: projectIssueText(item.owner || item.governance?.owner || "Not recorded", language),
        dueDate: projectIssueText(item.dueDate || item.due || item.governance?.due || "Not recorded", language),
        rootCause: projectIssueText(item.rootCause || item.details?.rootCause || closureChain.rootCause || "Not recorded; assessor analysis required.", language),
        description: description || (language === "en" ? "Project issue record has no description; assessor clarification is required." : "项目问题记录未提供问题描述，需评估师补充核实。"),
        sourceComment: [
          sourceKind,
          evidenceCode ? `Evidence ${evidenceCode}` : "",
          locator ? `Locator ${locator}` : "",
          item.assessorStatus || item.aiConfiguration?.status || "Assessor confirmation required"
        ].filter(Boolean).join(" · "),
        improvementMeasures: projectIssueText(action || item.closureEvidence || item.closureRule || "Define a corrective action, owner, due date, verification criterion, and closure approver.", language),
        closureChain: {
          problem: str(item.problemId || closureChain.problemId || item.id || ""),
          changeRequest: str(item.changeRequestId || closureChain.crId || ""),
          updatedWorkProducts: str(item.closureEvidence || closureChain.updatedWorkProducts || ""),
          verification: str(item.verification || closureChain.verification || ""),
          regression: str(item.regression || closureChain.regression || ""),
          baseline: str(item.baselineId || closureChain.baselineId || ""),
          approval: str(item.closureApproval || closureChain.closureApproval || "")
        },
        evidence: evidenceCode ? `${evidenceCode}${locator ? ` · ${locator}` : ""}` : "No locatable evidence reference recorded",
        sourceKind,
        referenceCandidates: refs,
        candidateOnly: item.aiConfiguration?.status !== "assessor-confirmed" && item.assessorStatus !== "Assessor confirmed",
        projectSpecific: true
      });
    };

    const explicit = [
      ...arr(project.helixReview?.items).filter(item => item.type === "issue-nc"),
      ...arr(project.ncRecords),
      ...arr(project.supportIssues),
      ...arr(project.wbsIssues),
      ...arr(project.records).filter(item => /issue|nc|weakness|problem|不符合/i.test(`${item.type || ""} ${item.title || ""} ${item.text || ""}`))
    ];
    explicit.forEach(item => add(item, "Project issue record", item.process || scope[0]));
    if (!records.length) {
      scoped.forEach(assessment => {
        const reviewPending = assessment.reviewed !== true || !arr(assessment.evidenceAnalysis).some(link => link.strength === "direct" || link.evidenceRole === "direct");
        if (!reviewPending && !arr(assessment.findings).length) return;
        const evidence = arr(project.evidence).find(entry => entry.id === assessment.evidenceIds?.[0]);
        const required = arr(assessment.closureEvidence).length ? assessment.closureEvidence : arr(assessment.requiredEvidence);
        const refs = issueReferences.filter(reference => reference.process === assessment.process).slice(0, 2).map(reference => reference.referenceId || reference.issueId);
        add({
          id: `${project.id}-${assessment.code || assessment.id}`,
          process: assessment.process,
          title: `${assessment.code || "Assessment"} · ${assessment.title || "Review gap"}`,
          category: "Assessment review gap",
          severity: "Unconfirmed",
          status: assessment.reviewed === true ? "Evidence gap" : "Review pending",
          date: generatedAt,
          owner: assessment.governance?.owner || project.leadAssessor || "Not recorded",
          dueDate: assessment.governance?.due || "Not recorded",
          description: `${assessment.code || assessment.id} ${assessment.title || ""} has no assessor-confirmed conclusion and no complete direct implementation evidence chain. Current project evidence: ${evidence?.code || "none"}.`,
          sourceEvidenceCode: evidence?.code,
          locator: evidence?.locator || evidence?.source || "",
          evidenceRole: evidence?.evidenceRole || "corroborating",
          closureEvidence: required.length ? required.join("\n") : "Target-process implementation sample, approval/version, verification result, and closure evidence.",
          solutionSteps: [
            `Collect a locatable direct implementation sample for ${assessment.code || assessment.id}.`,
            "Record owner, version/baseline, review decision, and assessor rationale.",
            "If a confirmed nonconformity remains, register the SUP.9 problem and decide whether SUP.10 change control applies.",
            "Verify the updated work product and retain the applicable baseline and closure approval."
          ].join("\n"),
          aiConfiguration: { status: "candidate" }
        }, "Assessment review gap", assessment.process);
        const last = records[records.length - 1];
        last.referenceCandidates = refs;
        last.sourceKind = "Assessment review gap";
        last.projectSpecific = true;
      });
    }
    if (!records.length) {
      records.push({
        issueId: `${project.id}-NO-ISSUES`,
        process: scope[0] || "UNCLASSIFIED",
        category: "No project issue records supplied",
        severity: "Not applicable",
        status: "No issue records",
        date: generatedAt.slice(0, 10),
        owner: project.leadAssessor || "Not recorded",
        dueDate: "Not recorded",
        rootCause: "No project issue or NC record was supplied for this export.",
        description: "The current project contains no explicit issue/NC record eligible for this ledger. This page is a controlled no-data notice, not a finding.",
        sourceComment: "Project snapshot · assessor confirmation required",
        improvementMeasures: "Continue assessment review and register each confirmed issue with a unique ID, objective evidence, owner, due date, corrective action, verification, and closure decision.",
        closureChain: { problem: "", changeRequest: "", updatedWorkProducts: "", verification: "", regression: "", baseline: "", approval: "" },
        evidence: "No project issue evidence supplied",
        sourceKind: "Project snapshot",
        referenceCandidates: [],
        candidateOnly: true,
        projectSpecific: true,
        emptyLedger: true
      });
    }
    return records.map((record, index) => ({ ...record, sequence: index + 1, projectName }));
  }

  async function documentExport(zip, model) {
    const doc = xml(await zip.file("word/document.xml").async("string"));
    const body = first(doc,"w","body");
    if (!body) throw new Error("DOCX template has no document body");
    const section = first(body,"w","sectPr")?.cloneNode(true) || node(doc,"w","sectPr");
    clear(body);
    function para(text, level = 0) {
      const p=node(doc,"w","p");
      if(level){const pPr=node(doc,"w","pPr");pPr.appendChild(node(doc,"w","pStyle",{"w:val":level===1?"Heading1":"Heading2"}));p.appendChild(pPr);}
      const r=node(doc,"w","r");
      str(text).split("\n").forEach((line,i)=>{if(i)r.appendChild(node(doc,"w","br"));const t=node(doc,"w","t",{},line);t.setAttributeNS("http://www.w3.org/XML/1998/namespace","xml:space","preserve");r.appendChild(t);});p.appendChild(r);return p;
    }
    function table(rows, header = false) {
      const tbl=node(doc,"w","tbl");
      const tblPr=node(doc,"w","tblPr");tblPr.appendChild(node(doc,"w","tblW",{"w:w":0,"w:type":"auto"}));tbl.appendChild(tblPr);
      const columnCount=Math.max(1,...rows.map(values=>values.length));const grid=node(doc,"w","tblGrid");for(let i=0;i<columnCount;i++)grid.appendChild(node(doc,"w","gridCol",{"w:w":Math.floor(9000/columnCount)}));tbl.appendChild(grid);
      rows.forEach((values,rowIndex)=>{const tr=node(doc,"w","tr");values.forEach(value=>{const cell=node(doc,"w","tc");const tcPr=node(doc,"w","tcPr");if(header&&rowIndex===0)tcPr.appendChild(node(doc,"w","shd",{"w:fill":"E9EDF1"}));cell.appendChild(tcPr);cell.appendChild(para(value));tr.appendChild(cell);});tbl.appendChild(tr);});return tbl;
    }
    body.appendChild(para(model.name,1));body.appendChild(para(model.status));body.appendChild(para(`${model.projectId} | ${model.generatedAt}`));
    for(const s of model.sections){
      body.appendChild(para(s.title,1));s.notes.forEach(n=>body.appendChild(para(n)));
      for(const t of s.tables){
        body.appendChild(para(t.title));
        // Wide registers are transposed into editable field/value records in Word.
        // This prevents eight-column evidence narratives from becoming unreadable.
        const rows=t.headers.length>4?t.rows.flatMap((row,i)=>[["Record",i+1],...t.headers.map((h,j)=>[h,row[j]])]):[t.headers,...t.rows];
        body.appendChild(table(rows,t.headers.length<=4));
      }
    }
    body.appendChild(section);zip.file("word/document.xml",serialize(doc));
  }
  function weightedLength(text) { return Array.from(str(text)).reduce((n,c)=>n+(c.charCodeAt(0)>255?2:1),0); }
  function wrap(text,limit=76) {
    const lines=[];for(const raw of str(text).split("\n")){let line="",weight=0;for(const c of Array.from(raw)){const w=c.charCodeAt(0)>255?2:1;if(weight+w>limit){lines.push(line);line="";weight=0;}line+=c;weight+=w;}lines.push(line);}return lines;
  }
  const kmEntry = (text, style) => ({ text: str(text), style: str(style || "") });
  function kmPage(title, entries, extra = {}) {
    const list = arr(entries).map(entry => entry && typeof entry === "object" ? kmEntry(entry.text, entry.style) : kmEntry(entry));
    return {
      title: str(title), kind: "km", layout: extra.layout || "body", mono: extra.mono === true,
      lines: list.map(entry => entry.text), styles: list.map(entry => entry.style)
    };
  }
  function kmGroupLines(groups) {
    const entries = [];
    arr(groups).forEach(group => {
      const rows = arr(group.rows).map(str).filter(Boolean);
      if (!rows.length) return;
      if (entries.length) entries.push(kmEntry(""));
      entries.push(kmEntry(group.heading, "heading"));
      rows.forEach(row => entries.push(kmEntry(row)));
    });
    return entries;
  }
  const kmGridLines = (header, rows) => alignGrid([arr(header).map(str), ...arr(rows).map(row => arr(row).map(str))])
    .map((line, index) => kmEntry(line, index === 0 ? "heading" : ""));
  function chunk(values, size) {
    const list = arr(values); const out = [];
    for (let start = 0; start < list.length; start += size) out.push(list.slice(start, start + size));
    return out.length ? out : [[]];
  }
  // KM narrative page order. Only assessor-confirmed material reaches a slide;
  // no candidate table, legend, boundary or disclaimer is emitted.
  function kmPresentationPages(model) {
    const view = model.presentation;
    const pages = [kmPage(view.titles.cover, view.cover.lines, { layout: "cover" })];
    pages.push(kmPage(view.titles.plan, kmGroupLines(view.plan.groups)));
    pages.push(kmPage(view.titles.scope, kmGroupLines(view.scope.groups)));
    arr(view.instances).forEach(instance => {
      const badge = str(instance.id).trim();
      pages.push(kmPage(`${view.titles.separator}: ${instance.name}`, badge ? [kmEntry(badge)] : [], { layout: "section" }));
      arr(instance.processes).forEach(process => {
        chunk(process.observations, KM_OBSERVATION_PAGE).forEach((batch, batchIndex) => {
          const entries = [];
          if (batch.length) {
            entries.push(kmEntry(batchIndex ? `${view.labels.observation} (continued)` : view.labels.observation, "heading"));
            batch.forEach(text => entries.push(kmEntry(`- ${text}`)));
          }
          if (!batchIndex) {
            if (arr(process.weaknesses).length) {
              if (entries.length) entries.push(kmEntry(""));
              entries.push(kmEntry(view.labels.weakness, "heading"));
              process.weaknesses.forEach(text => entries.push(kmEntry(`- ${text}`)));
            }
            if (entries.length) entries.push(kmEntry(""));
            entries.push(kmEntry(process.levelLine, "level"));
            if (process.bpLine) entries.push(kmEntry(`BP: ${process.bpLine}`, "level"));
            if (process.gpLine) entries.push(kmEntry(`GP: ${process.gpLine}`, "level"));
          }
          pages.push(kmPage(batchIndex ? `${process.title} (continued)` : process.title, entries));
        });
      });
      pages.push(kmPage(`${view.titles.rating}: ${instance.name}`, kmGridLines(instance.summary.header, instance.summary.rows), { mono: true }));
      const blocks = [];
      if (arr(instance.matrix.bpCodes).length) blocks.push(["Base Practices", instance.matrix.bpHeader, instance.matrix.bpRows]);
      if (arr(instance.matrix.gpCodes).length) blocks.push(["Generic Practices", instance.matrix.gpHeader, instance.matrix.gpRows]);
      if (blocks.length) {
        const entries = [];
        blocks.forEach(([heading, header, rows]) => {
          if (entries.length) entries.push(kmEntry(""));
          entries.push(kmEntry(heading, "heading"));
          kmGridLines(header, rows).forEach(entry => entries.push(entry));
        });
        pages.push(kmPage(`${view.titles.matrix}: ${instance.name}`, entries, { mono: true }));
      }
    });
    const items = arr(view.evidence.items);
    if (items.length) {
      const pageCount = Math.max(1, Math.ceil(items.length / KM_EVIDENCE_PER_PAGE));
      let previous = null;
      for (let page = 0; page < pageCount; page += 1) {
        const rows = [];
        items.slice(page * KM_EVIDENCE_PER_PAGE, (page + 1) * KM_EVIDENCE_PER_PAGE).forEach(item => {
          if (item.process && item.process !== previous) { rows.push({ cells: [`Process ${item.process}`], group: true }); previous = item.process; }
          else if (!item.process) previous = null;
          rows.push({ cells: [item.id, item.name, item.version], group: false });
        });
        const entries = alignGrid([view.evidence.header.map(str), ...rows.map(row => row.cells.map(str))])
          .map((line, index) => kmEntry(line, index === 0 || rows[index - 1]?.group ? "heading" : ""));
        pages.push(kmPage(`${view.titles.evidence} (${page + 1} / ${pageCount})`, entries, { mono: true }));
      }
    }
    pages.push(kmPage(view.titles.capability, kmGridLines(view.scales.capability.header, view.scales.capability.rows), { mono: true }));
    pages.push(kmPage(view.titles.nplf, kmGridLines(view.scales.nplf.header, view.scales.nplf.rows), { mono: true }));
    pages.push(kmPage(view.titles.back, view.back.lines, { layout: "cover" }));
    return pages;
  }
  function presentationPages(model, templateId) {
    if (templateId === "km-presentation" && model && model.presentation && arr(model.presentation.instances).length) return kmPresentationPages(model);
    if (templateId === "tuv-aspice-issue-ledger") {
      const issues = arr(model.projectIssueRecords);
      const processGroups = [];
      issues.forEach(issue => {
        const existing = processGroups.find(group => group.process === issue.process);
        if (existing) existing.issues.push(issue);
        else processGroups.push({ process: issue.process, issues: [issue] });
      });
      const severityCounts = issues.reduce((out, issue) => {
        const key = issue.severity || "Unconfirmed";
        out[key] = (out[key] || 0) + 1;
        return out;
      }, {});
      const sourceCounts = issues.reduce((out, issue) => {
        const key = issue.sourceKind || "Project";
        out[key] = (out[key] || 0) + 1;
        return out;
      }, {});
      const statusCounts = issues.reduce((out, issue) => {
        const key = issue.status || "Unconfirmed";
        out[key] = (out[key] || 0) + 1;
        return out;
      }, {});
      const pages = [{
        title: "TUV ASPICE Audit Issue Ledger 2026",
        kind: "cover",
        lines: [model.name, model.projectId, model.status, model.generatedAt, `${issues.length} project-specific issue analysis records`],
        project: model.name,
        projectId: model.projectId,
        status: model.status,
        generatedAt: model.generatedAt,
        issueCount: issues.length,
        processes: processGroups.map(group => group.process),
        severityCounts
      }, {
        title: "Project Issue Analysis Overview",
        kind: "overview",
        issueCount: issues.length,
        processGroups,
        severityCounts,
        sourceCounts,
        statusCounts,
        lines: [
          `${model.name} · ${model.projectId}`,
          `${issues.length} project-specific issue analysis records`,
          `Processes: ${processGroups.map(group => `${group.process} (${group.issues.length})`).join(", ")}`,
          `Severity: ${Object.entries(severityCounts).map(([key, value]) => `${key} ${value}`).join(" · ")}`,
          `Status: ${Object.entries(statusCounts).map(([key, value]) => `${key} ${value}`).join(" · ")}`,
          "Reference issue candidates are corroborating context only; they are never copied into the project ledger as confirmed findings."
        ]
      }];
      processGroups.forEach((group, index) => {
        const titles = PROCESS_TITLES[group.process] || [group.process, group.process];
        const purpose = TUV_PROCESS_PURPOSES[group.process] || [`Review ${group.process} execution and retained evidence.`, `核对 ${group.process} 的执行和留存证据。`];
        pages.push({
          title: `${group.process} · ${titles[0]}`,
          kind: "section",
          process: group.process,
          processName: titles[0],
          processNameEn: titles[1],
          purpose: model.language === "zh" ? purpose[1] : purpose[0],
          outcomes: model.language === "zh" ? `本项目登记 ${group.issues.length} 条问题分析记录；每条记录需由评估师确认事实、严重度、措施和关闭链。` : `This project contains ${group.issues.length} issue analysis record(s); the assessor must confirm facts, severity, actions, and the closure chain.`,
          issueCount: group.issues.length,
          index: index + 1,
          totalProcesses: processGroups.length,
          lines: [
            `${group.process} · ${titles[0]}`,
            `${group.issues.length} project-specific issue analysis record(s)`,
            model.language === "zh" ? purpose[1] : purpose[0],
            model.language === "zh" ? `每条问题必须追溯至项目证据、责任人、措施、验证和适用基线。` : "Each issue must trace to project evidence, owner, corrective action, verification, and an applicable baseline."
          ]
        });
      });
      issues.forEach(issue => pages.push({
        title: `${issue.issueId} · ${issue.process}`,
        kind: "issue",
        issue,
        lines: [
          `${issue.issueId} · ${issue.process} · ${issue.severity} · ${issue.status}`,
          issue.description,
          `Root cause: ${issue.rootCause}`,
          `Improvement measures: ${issue.improvementMeasures}`,
          `Evidence: ${issue.evidence}`,
          `Reference candidates: ${arr(issue.referenceCandidates).join(", ") || "none"}`,
          "Assessor confirmation is required before treating this record as a formal finding."
        ]
      }));
      pages.push({
        title: "Tracking & Closure",
        kind: "closure",
        issueCount: issues.length,
        processGroups,
        statusCounts,
        lines: [
          `${issues.length} project-specific issue analysis record(s) are archived for follow-up.`,
          "Each record retains issue ID, process, date, severity, category, objective description, source locator, root cause, corrective action, owner, due date, status, verification, and closure-chain fields.",
          `Status summary: ${Object.entries(statusCounts).map(([key, value]) => `${key} ${value}`).join(" · ")}`,
          "Closure remains blocked until the applicable SUP.9 problem path, SUP.10 change/no-change decision, updated work product, verification result, SUP.8 baseline, and closure approval are evidenced where applicable.",
          "Only assessor-confirmed decisions may be treated as formal assessment results."
        ]
      });
      return pages;
    }
    const pages=[{title:"Automotive SPICE Assessment Results",kind:"cover",lines:[...wrap(model.name),...wrap(model.projectId),...wrap(model.status),...wrap(model.generatedAt)] },{title:"Assessment Input · Assessment Plan",kind:"input",lines:[...wrap(model.name),...wrap(model.projectId),...wrap(model.status)]},{title:"Assessment Input · Assessed Project and Assessment Scope",kind:"input",lines:["Formal scope",...wrap(model.sections[0]?.tables?.[0]?.rows?.find(r=>r[0]==="Formal scope")?.[1]||"Not recorded"),"Target capability",...wrap(model.sections[0]?.tables?.[0]?.rows?.find(r=>r[0]==="Target capability")?.[1]||"Not recorded")] }];
    for(const section of model.sections){
      const lines=[...section.notes.flatMap(n=>wrap(n))];
      for(const t of section.tables){
        lines.push(t.title);
        const rows=templateId==="km-presentation"&&t.title.endsWith("Assessment findings")?[...t.rows].sort((a,b)=>str(a[2]).localeCompare(str(b[2]))):t.rows;
        for(const row of rows){if(t.title==="Formal scope ratings" && t.headers.includes("Process") && row.length>=7){lines.push(`${row[0]} | PA1.1 ${row[1]||"NR"} | PA2.1 ${row[2]||"NR"} | PA2.2 ${row[3]||"NR"} | PA3.1 ${row[4]||"NR"} | PA3.2 ${row[5]||"NR"} | CL ${row[6]||"NR"}`);} else {for(let i=0;i<t.headers.length;i++){if(str(row[i]))lines.push(...wrap(`${t.headers[i]}: ${str(row[i])}`));}}lines.push("");}
      }
      let page=[];
      for(const line of lines){if(page.length===14){pages.push({title:section.title,lines:page});page=[];}page.push(line);}
      if(page.length)pages.push({title:section.title,kind:section.title.startsWith("3 ")?"detail":"overview",lines:page});
    }
    return pages;
  }
  // --- PPTX shape writers ----------------------------------------------------
  function applyBox(doc, shape, box) {
    const spPr = first(shape, "p", "spPr");
    if (!spPr || !box) return;
    elements(spPr, "a", "xfrm").forEach(n => n.remove());
    const xfrm = doc.createElementNS(NS.a, "a:xfrm");
    const off = doc.createElementNS(NS.a, "a:off");
    off.setAttribute("x", String(Math.round(box.x))); off.setAttribute("y", String(Math.round(box.y)));
    const ext = doc.createElementNS(NS.a, "a:ext");
    ext.setAttribute("cx", String(Math.round(box.cx))); ext.setAttribute("cy", String(Math.round(box.cy)));
    xfrm.appendChild(off); xfrm.appendChild(ext);
    // a:xfrm is the first element of CT_ShapeProperties.
    spPr.insertBefore(xfrm, spPr.firstChild);
  }
  function applyAutofit(doc, shape) {
    const tx = first(shape, "p", "txBody");
    if (!tx) return;
    let bodyPr = first(tx, "a", "bodyPr");
    if (!bodyPr) { bodyPr = doc.createElementNS(NS.a, "a:bodyPr"); tx.insertBefore(bodyPr, tx.firstChild); }
    ["noAutofit", "spAutoFit", "normAutofit"].forEach(tag => elements(bodyPr, "a", tag).forEach(n => n.remove()));
    const fit = doc.createElementNS(NS.a, "a:normAutofit");
    const anchor = ["scene3d", "sp3d", "flatTx", "extLst"].map(tag => first(bodyPr, "a", tag)).find(Boolean);
    if (anchor) bodyPr.insertBefore(fit, anchor); else bodyPr.appendChild(fit);
  }
  function applyMono(doc, rPr) {
    ["latin", "ea", "cs"].forEach(tag => elements(rPr, "a", tag).forEach(n => n.remove()));
    const fonts = ["latin", "ea", "cs"].map(tag => { const n = doc.createElementNS(NS.a, "a:" + tag); n.setAttribute("typeface", "Consolas"); return n; });
    const anchor = [["a", "sym"], ["a", "hlinkClick"], ["a", "hlinkMouseOver"], ["a", "rtl"], ["a", "extLst"]].map(([ns, tag]) => first(rPr, ns, tag)).find(Boolean);
    fonts.forEach(font => anchor ? rPr.insertBefore(font, anchor) : rPr.appendChild(font));
  }
  function kmGeometry(presentation) {
    const size = first(presentation, "p", "sldSz");
    return { cx: Number(size?.getAttribute("cx")) || 12192000, cy: Number(size?.getAttribute("cy")) || 6858000 };
  }
  // The corporate placeholders inherit a quarter-height body box from the slide
  // layout, which cannot hold a KM process page. Every KM slide therefore gets
  // an explicit geometry derived from the real slide size.
  function kmBoxes(page, slide) {
    const marginX = slide.cx * 0.0375;
    const marginY = slide.cy * 0.04;
    const width = slide.cx - marginX * 2;
    if (page.layout === "cover" || page.layout === "section") {
      const band = slide.cy * 0.34;
      const top = slide.cy * 0.24;
      return [
        { x: marginX, y: top, cx: width, cy: band },
        { x: marginX, y: top + band + slide.cy * 0.03, cx: width, cy: slide.cy - top - band - slide.cy * 0.03 - marginY }
      ];
    }
    const titleHeight = slide.cy * 0.11;
    const gap = slide.cy * 0.02;
    return [
      { x: marginX, y: marginY, cx: width, cy: titleHeight },
      { x: marginX, y: marginY + titleHeight + gap, cx: width, cy: slide.cy - marginY * 2 - titleHeight - gap }
    ];
  }
  // Largest font size (hundredths of a point) whose wrapped line count still
  // fits the box. normAutofit stays as the runtime safety net.
  function kmFitSize(lines, box, max) {
    const list = arr(lines).map(line => str(line));
    if (!list.length || !box || !box.cy) return max;
    let size = max;
    while (size > 800) {
      const perLine = Math.max(8, Math.floor(box.cx / (0.52 * size * 127)));
      const wrapped = list.reduce((total, line) => total + Math.max(1, Math.ceil(weightedLength(line) / perLine)), 0);
      if (wrapped * 1.24 * size * 127 <= box.cy) return size;
      size -= 100;
    }
    // max can already sit below the 800 floor (kmMonoSize clamps wide grids to
    // as little as 500). Honour that caller ceiling instead of overflowing it.
    return Math.min(max, 800);
  }
  // A monospace grid stops reading as a table the moment a row wraps, and the
  // wrap points differ per row. Grid pages therefore shrink until the longest
  // row fits on one line instead of relying on the height estimate alone.
  function kmMonoSize(lines, box, max) {
    const longest = arr(lines).reduce((widest, line) => Math.max(widest, weightedLength(str(line))), 0);
    if (!longest || !box || !box.cx) return max;
    const size = Math.floor(box.cx / (0.52 * longest * 127) / 100) * 100;
    return Math.max(500, Math.min(max, size));
  }
  // One a:p per line, each carrying exactly one run. Rebuilding the paragraph
  // avoids both the multi-run leftovers and the missing-run crash of the old
  // "patch the first a:t" writer.
  function writeTextShape(doc, shape, entries, options = {}) {
    if (!shape) return;
    const tx = first(shape, "p", "txBody");
    if (!tx) return;
    if (options.box) applyBox(doc, shape, options.box);
    const list = arr(entries).map(entry => entry && typeof entry === "object" ? { text: str(entry.text), style: str(entry.style || "") } : { text: str(entry), style: "" });
    if (!list.length) list.push({ text: "", style: "" });
    const source = elements(tx, "a", "p");
    const model = source[0] || null;
    const pPrSource = model ? first(model, "a", "pPr") : null;
    const runSource = model ? first(model, "a", "r") : null;
    const rPrSource = runSource ? first(runSource, "a", "rPr") : (model ? first(model, "a", "endParaRPr") : null);
    source.forEach(paragraph => paragraph.remove());
    list.forEach(entry => {
      const paragraph = doc.createElementNS(NS.a, "a:p");
      const pPr = pPrSource ? pPrSource.cloneNode(true) : doc.createElementNS(NS.a, "a:pPr");
      if (options.align) pPr.setAttribute("algn", options.align);
      paragraph.appendChild(pPr);
      const run = doc.createElementNS(NS.a, "a:r");
      const rPr = doc.createElementNS(NS.a, "a:rPr");
      if (rPrSource) {
        Array.from(rPrSource.attributes || []).forEach(attribute => {
          if (attribute.namespaceURI) rPr.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
          else rPr.setAttribute(attribute.name, attribute.value);
        });
        Array.from(rPrSource.childNodes || []).forEach(child => { if (child.nodeType === 1) rPr.appendChild(child.cloneNode(true)); });
      }
      rPr.removeAttribute("dirty");
      if (!rPr.getAttribute("lang")) rPr.setAttribute("lang", "en-US");
      if (options.size) rPr.setAttribute("sz", String(options.size));
      if (entry.style === "heading" || entry.style === "level") rPr.setAttribute("b", "1");
      if (options.mono) applyMono(doc, rPr);
      run.appendChild(rPr);
      const text = doc.createElementNS(NS.a, "a:t");
      text.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
      text.textContent = clean(entry.text);
      run.appendChild(text);
      paragraph.appendChild(run);
      tx.appendChild(paragraph);
    });
  }
  // Cloned prototype rels may still reference a notesSlide part. Every notes
  // slide is dropped during export, so such a relationship would dangle. Strip
  // notesSlide relationships before the prototype rels are reused verbatim.
  function stripNotesSlideRels(relsSource) {
    const source = str(relsSource);
    if (!/notesSlide/.test(source)) return source;
    const doc = xml(source);
    elements(doc, "rel", "Relationship").filter(n => str(n.getAttribute("Type")).includes("notesSlide")).forEach(n => n.remove());
    return serialize(doc);
  }
  function tuvShapes(doc) {
    return elements(doc, "p", "sp");
  }
  function tuvWrite(doc, shapes, index, value, options = {}) {
    const shape = shapes[index];
    if (!shape || !first(shape, "p", "txBody")) return;
    writeTextShape(doc, shape, str(value).split("\n"), options);
    if (options.autofit !== false) applyAutofit(doc, shape);
  }
  function tuvPageNumber(total, index) {
    return `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  }
  function tuvSeveritySummary(counts) {
    return Object.entries(counts || {}).map(([key, value]) => `${key} ${value}`).join(" · ") || "Unconfirmed 0";
  }
  function tuvStatusSummary(counts) {
    return Object.entries(counts || {}).map(([key, value]) => `${key} ${value}`).join(" · ") || "No status recorded";
  }
  function tuvPopulateSlide(doc, page, index, total) {
    const shapes = tuvShapes(doc);
    if (page.kind === "cover") {
      tuvWrite(doc, shapes, 3, "AUTOMOTIVE SPICE · TUV AUDIT");
      tuvWrite(doc, shapes, 4, "TUV ASPICE\n项目审核问题分析台账");
      tuvWrite(doc, shapes, 5, `${page.issueCount} 条\nProject Findings\n项目问题分析与整改跟踪`);
      tuvWrite(doc, shapes, 6, `覆盖 ${arr(page.processes).join("、") || "未定义正式过程"}\n当前项目数据，不复制参考库结论`);
      tuvWrite(doc, shapes, 8, `${page.issueCount} 条问题`);
      tuvWrite(doc, shapes, 10, tuvSeveritySummary(page.severityCounts));
      tuvWrite(doc, shapes, 12, `${arr(page.processes).length} 个过程域`);
      tuvWrite(doc, shapes, 13, `Project Issue Ledger · ${String(page.generatedAt).slice(0, 4)}`);
      return;
    }
    if (page.kind === "overview") {
      tuvWrite(doc, shapes, 1, "FINDINGS OVERVIEW");
      tuvWrite(doc, shapes, 2, `统计总览 · ${page.issueCount} 条项目问题`);
      tuvWrite(doc, shapes, 3, String(page.issueCount));
      tuvWrite(doc, shapes, 4, "条 Project Findings\n每条记录来自当前项目快照");
      tuvWrite(doc, shapes, 6, String(page.sourceCounts?.["Project issue record"] || 0));
      tuvWrite(doc, shapes, 7, "Project issue records");
      tuvWrite(doc, shapes, 9, String(page.sourceCounts?.["Assessment review gap"] || 0));
      tuvWrite(doc, shapes, 10, "Assessment review gaps");
      tuvWrite(doc, shapes, 12, String(page.severityCounts?.Major || 0));
      tuvWrite(doc, shapes, 13, "Major / 严重");
      tuvWrite(doc, shapes, 15, String(page.severityCounts?.Medium || 0));
      tuvWrite(doc, shapes, 16, "Medium / 中等");
      tuvWrite(doc, shapes, 18, String(page.severityCounts?.Minor || 0));
      tuvWrite(doc, shapes, 19, "Minor / 轻微");
      tuvWrite(doc, shapes, 20, `状态：${tuvStatusSummary(page.statusCounts)}`);
      for (let i = 0; i < 10; i += 1) {
        const labelIndex = 24 + i * 3;
        const countIndex = labelIndex + 2;
        const group = page.processGroups?.[i];
        tuvWrite(doc, shapes, labelIndex, group?.process || "", { autofit: false });
        tuvWrite(doc, shapes, countIndex, group ? String(group.issues.length) : "", { autofit: false });
      }
      tuvWrite(doc, shapes, 54, "Project snapshot · formal findings require assessor confirmation");
      tuvWrite(doc, shapes, 55, tuvPageNumber(total, index), { autofit: false });
      return;
    }
    if (page.kind === "section") {
      tuvWrite(doc, shapes, 2, `PROCESS AREA ${String(page.index).padStart(2, "0")} / ${String(page.totalProcesses || 1).padStart(2, "0")}`, { autofit: false });
      tuvWrite(doc, shapes, 3, page.process, { autofit: false });
      tuvWrite(doc, shapes, 4, page.processName, { autofit: false });
      tuvWrite(doc, shapes, 6, String(page.issueCount), { autofit: false });
      tuvWrite(doc, shapes, 7, "条 Project Findings", { autofit: false });
      tuvWrite(doc, shapes, 9, page.purpose);
      tuvWrite(doc, shapes, 12, page.outcomes);
      tuvWrite(doc, shapes, 13, `Project snapshot · ${page.process}`, { autofit: false });
      tuvWrite(doc, shapes, 14, tuvPageNumber(total, index), { autofit: false });
      return;
    }
    if (page.kind === "issue") {
      const issue = page.issue || {};
      tuvWrite(doc, shapes, 1, `Issue ${String(issue.sequence || index).padStart(2, "0")}`, { autofit: false });
      tuvWrite(doc, shapes, 3, issue.process || "UNCLASSIFIED", { autofit: false });
      tuvWrite(doc, shapes, 5, `${issue.process || "UNCLASSIFIED"} / ${issue.category || "Project issue"}`, { autofit: false });
      tuvWrite(doc, shapes, 7, `Severity: ${issue.severity || "Unconfirmed"}`, { autofit: false });
      tuvWrite(doc, shapes, 9, `Status: ${issue.status || "Unconfirmed"}`, { autofit: false });
      tuvWrite(doc, shapes, 12, [
        `Issue ID: ${issue.issueId || "Not recorded"}`,
        `Date: ${issue.date || "Not recorded"}`,
        `Person Responsible: ${issue.owner || "Not recorded"}`,
        `Due Date: ${issue.dueDate || "Not recorded"}`,
        `Root Cause: ${issue.rootCause || "Not recorded"}`
      ].join("    |    "));
      tuvWrite(doc, shapes, 15, issue.description || "No project description recorded.");
      tuvWrite(doc, shapes, 18, [
        issue.sourceComment || "Project snapshot",
        `Evidence: ${issue.evidence || "No locatable evidence reference recorded"}`,
        arr(issue.referenceCandidates).length ? `Corroborating reference candidates: ${arr(issue.referenceCandidates).join(", ")}` : "No corroborating reference candidate was matched."
      ].join("\n"));
      tuvWrite(doc, shapes, 21, [
        issue.improvementMeasures || "Define corrective action and closure criteria.",
        `Closure chain: Problem ${issue.closureChain?.problem || "not recorded"}; CR/no-CR ${issue.closureChain?.changeRequest || "not recorded"}; updated work products ${issue.closureChain?.updatedWorkProducts || "not recorded"}; verification ${issue.closureChain?.verification || "not recorded"}; regression ${issue.closureChain?.regression || "not recorded"}; baseline ${issue.closureChain?.baseline || "not recorded"}; approval ${issue.closureChain?.approval || "not recorded"}.`,
        issue.candidateOnly ? "Candidate record only. Assessor confirmation is required." : "Assessor-confirmed project record."
      ].join("\n\n"));
      tuvWrite(doc, shapes, 22, `Project ${issue.projectName || ""} · ${issue.process || "UNCLASSIFIED"} · ${issue.evidence || "source not recorded"}`, { autofit: false });
      tuvWrite(doc, shapes, 23, tuvPageNumber(total, index), { autofit: false });
      return;
    }
    if (page.kind === "closure") {
      tuvWrite(doc, shapes, 2, "TRACKING & CLOSURE", { autofit: false });
      tuvWrite(doc, shapes, 3, `${page.issueCount} 条项目问题已归档，进入整改跟踪`);
      tuvWrite(doc, shapes, 5, [
        "每条问题均保留当前项目字段：编号、过程、日期、严重度、类别、客观描述、来源定位、根因、改进措施、责任人、截止日期、状态与关闭链。",
        `过程范围：${arr(page.processGroups).map(group => `${group.process} (${arr(group.issues).length})`).join(" · ")}`,
        `状态汇总：${tuvStatusSummary(page.statusCounts)}`,
        "后续请以 Issue ID 为线索逐条更新 Problem、CR/no-CR、工作产品、验证、回归、基线和关闭批准；缺失字段保持待核实，不得用状态标签替代证据。"
      ].join("\n\n"));
      tuvWrite(doc, shapes, 7, "Project snapshot · SUP.9 / SUP.10 / SUP.8 closure chain");
      tuvWrite(doc, shapes, 9, tuvStatusSummary(page.statusCounts), { autofit: false });
    }
  }
  async function presentationExport(zip, model, templateId) {
    // Supplied corporate decks do not necessarily number their first slide as
    // slide1.xml. Pick the first usable slide so exports retain the source
    // deck's background, theme and editable text geometry.
    const km = templateId === "km-presentation" && Boolean(model.presentation) && arr(model.presentation.instances).length > 0;
    const tuv = templateId === "tuv-aspice-issue-ledger";
    const slidePaths=Object.keys(zip.files)
      .filter(path=>/^ppt\/slides\/slide\d+\.xml$/.test(path))
      .sort((a,b)=>Number(a.match(/slide(\d+)\.xml$/)[1])-Number(b.match(/slide(\d+)\.xml$/)[1]));
    let proto=null;let protoPath="";let slideRels="";const prototypeDocs={};const prototypeRels={};const candidates=[];
    for(const path of slidePaths){
      const candidate=zip.file(path);if(!candidate)continue;
      const raw=await candidate.async("string");
      const candidateDoc=xml(raw);
      const textShapes=elements(candidateDoc,"p","sp").filter(shape=>first(shape,"p","txBody"));
      if(textShapes.length<2)continue;
      if(!protoPath){proto=candidateDoc;protoPath=path;}
      const relPath=`ppt/slides/_rels/${path.split("/").pop()}.rels`;
      const relFile=zip.file(relPath);
      const candidateRels=stripNotesSlideRels(relFile?await relFile.async("string"): `<Relationships xmlns="${NS.rel}"/>`);
      slideRels=candidateRels;
      const slideText=elements(candidateDoc,"a","t").map(n=>n.textContent||"").join(" ");
      const slideNumber = Number(path.match(/slide(\d+)\.xml$/)[1]);
      const kind=tuv
        ? (slideNumber === 1 ? "cover" : slideNumber === 2 ? "overview" : slideNumber === 92 || slideText.includes("TRACKING & CLOSURE") ? "closure" : slideText.includes("PROCESS AREA") ? "section" : slideText.includes("Issue ") ? "issue" : "overview")
        : slideText.includes("Assessment Input") ? "input" : slideText.includes("Rating") ? "detail" : slideText.includes("Observation") ? "detail" : slideText.includes("Assessment Results") ? "cover" : "overview";
      if(!prototypeDocs[kind]){prototypeDocs[kind]=candidateDoc;prototypeRels[kind]=candidateRels;}
      if(km)candidates.push({
        doc:candidateDoc,rels:candidateRels,shapes:textShapes.length,size:raw.length,
        // Tables, pictures and groups cannot carry the KM narrative, so the
        // cleanest two-shape slide wins and every KM page reuses it.
        noise:elements(candidateDoc,"p","graphicFrame").length*100+elements(candidateDoc,"p","pic").length*10+elements(candidateDoc,"p","grpSp").length*10
      });
    }
    if(!proto)throw new Error("PPTX template has no usable slide layout");
    const kmPrototype=km&&candidates.length?candidates.slice().sort((a,b)=>a.noise-b.noise||a.shapes-b.shapes||a.size-b.size)[0]:null;
    const presentation=xml(await zip.file("ppt/presentation.xml").async("string"));
    const rels=xml(await zip.file("ppt/_rels/presentation.xml.rels").async("string"));
    const cts=xml(await zip.file("[Content_Types].xml").async("string"));
    const slide=kmGeometry(presentation);
    const ids=clear(first(presentation,"p","sldIdLst"));
    elements(rels,"rel","Relationship").filter(n=>n.getAttribute("Type").endsWith("/slide")).forEach(n=>n.remove());
    elements(cts,"ct","Override").filter(n=>n.getAttribute("PartName").startsWith("/ppt/slides/")).forEach(n=>n.remove());
    Object.keys(zip.files).filter(path=>/^ppt\/slides\/slide\d+\.xml$/.test(path)||/^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(path)).forEach(path=>zip.remove(path));
    // Every notes slide points at a slide that is about to be renumbered, so
    // the orphaned parts are dropped instead of shipping dangling references.
    Object.keys(zip.files).filter(path=>/^ppt\/notesSlides\//.test(path)).forEach(path=>zip.remove(path));
    elements(cts,"ct","Override").filter(n=>n.getAttribute("PartName").startsWith("/ppt/notesSlides/")).forEach(n=>n.remove());
    const pages=presentationPages(model,templateId);
    pages.forEach((page,index)=>{
      const selected=tuv
        ? (prototypeDocs[page.kind] || prototypeDocs.issue || proto)
        : (kmPrototype ? kmPrototype.doc : (prototypeDocs[page.kind] || prototypeDocs.detail || proto));
      const doc=selected.cloneNode(true);const shapes=elements(doc,"p","sp").filter(shape=>first(shape,"p","txBody"));
      if(tuv){
        tuvPopulateSlide(doc, page, index, pages.length);
      } else if(kmPrototype){
        ["graphicFrame","pic","grpSp"].forEach(tag=>elements(doc,"p",tag).forEach(n=>n.remove()));
        const boxes=kmBoxes(page,slide);
        const centered=page.layout==="cover"||page.layout==="section";
        const mono=page.mono===true;
        const bodyMax=mono?kmMonoSize(page.lines,boxes[1],centered?2000:1800):(centered?2000:1800);
        writeTextShape(doc,shapes[0],[kmEntry(page.title,"heading")],{box:boxes[0],size:kmFitSize([page.title],boxes[0],centered?3200:2400),align:centered?"ctr":""});
        writeTextShape(doc,shapes[1],arr(page.lines).map((text,i)=>kmEntry(text,arr(page.styles)[i])),{box:boxes[1],size:kmFitSize(page.lines,boxes[1],bodyMax),align:centered?"ctr":"",mono});
        shapes.slice(2).forEach(shape=>writeTextShape(doc,shape,[""],{}));
        applyAutofit(doc,shapes[1]);
      }else{
        for(const [shape,lines] of [[shapes[0],[page.title]],[shapes[1],page.lines]]){
          writeTextShape(doc,shape,lines,{});
        }
        applyAutofit(doc,shapes[1]);
      }
      const n=index+1;const path=`ppt/slides/slide${n}.xml`;
      zip.file(path,serialize(doc));zip.file(`ppt/slides/_rels/slide${n}.xml.rels`,tuv?(prototypeRels[page.kind]||prototypeRels.issue||slideRels):(kmPrototype?kmPrototype.rels:(prototypeRels[page.kind]||slideRels)));
      ids.appendChild(node(presentation,"p","sldId",{id:256+index,"r:id":"s"+n}));
      rels.documentElement.appendChild(node(rels,"rel","Relationship",{Id:"s"+n,Type:NS.r+"/slide",Target:`slides/slide${n}.xml`}));
      cts.documentElement.appendChild(node(cts,"ct","Override",{PartName:"/"+path,ContentType:"application/vnd.openxmlformats-officedocument.presentationml.slide+xml"}));
    });
    zip.file("ppt/presentation.xml",serialize(presentation));zip.file("ppt/_rels/presentation.xml.rels",serialize(rels));zip.file("[Content_Types].xml",serialize(cts));
  }
  function column(n){let s="";for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
  function spreadsheetModel(model, templateId) {
    if (templateId === "trace-excel" && model.traceWorkbook) {
      model = { ...model, sections: model.traceWorkbook.sections };
    }
    if(templateId === "tuv-audit-issue-record") {
      const rows = arr(model.helixIssues).map(issue => [
        issue.issueNo, issue.process, issue.title, issue.description, issue.severity, issue.status,
        issue.owner, issue.dueDate, issue.sourceFile, issue.locator, issue.evidenceRole, issue.assessorStatus
      ].map(value => clean(value)));
      model = {...model, sections:[{
        title: "TUV Audit Issue Record Form",
        notes: ["Imported and AI-configured issue candidates remain subject to assessor confirmation. This export does not approve or close an issue."],
        tables: [table("Issue register", [
          "Issue No", "Process", "Title", "Issue description", "Severity", "Status",
          "Owner", "Due date", "Source file", "Source locator", "Evidence role", "Assessor status"
        ], rows)]
      }]};
    }
    if(templateId === "mbeal-assessment-findings") {
      const rows = arr(model.assessments || model._assessments).map(a => {
        const source=a.sourceAssessment||{};
        const sourceText=(key,...fallbacks)=>source[key+"En"]||source[key]||fallbacks.find(Boolean)||"";
        return [
          a.process||"",
          sourceText("attribute",a.pa),
          a.code||"",
          source.nplf||a.displayRating||a.rating||"NR",
          sourceText("practiceTitle",a.titleEn,a.title),
          sourceText("practice",a.criterionEn,a.criterion),
          model.assessmentEvidence?.[a.id]?.text || retainedEvidenceText(sourceText("evidence")) || evidenceUnavailable,
          sourceText("weakness",arr(a.findings).map(f=>f.textEn||f.text).join("; ")),
          sourceText("requiredActions",source.actionItemsEn,source.recommendationEn),
          sourceText("internalComment",source.assessorCommentEn,a.reviewerNoteEn,a.reviewerNote),
          model.assessmentEvidence?.[a.id]?.locators || ((source.sourceSheet || source.sheet) && (source.sourceCell || source.cellRange) ? `${source.sourceSheet || source.sheet}!${source.sourceCell || source.cellRange}` : ""),
          model.assessmentEvidence?.[a.id]?.roles || "index-only",
          a.reviewed === true ? "Assessor reviewed" : "Candidate / review pending"
        ].map(value => clean(value));
      });
      model = {...model, sections:[{sheetName:"Findings",title:"MBEAL Assessment Findings",notes:["Source workbook fields are preserved as corroborating context. Formal ratings require assessor confirmation."],tables:[table("BP / GP finding register",["Process","Attribute","Practice","NPLF (source)","Practice title","Practice","Evidence","Weakness","Required actions","Internal comment","Source locator","Evidence role","Review status"],rows)]}]};
    }
    return model;
  }
  async function spreadsheetExport(zip,model,templateId="trace-excel"){
    model = spreadsheetModel(model, templateId);
    const wb=xml(await zip.file("xl/workbook.xml").async("string"));const sheets=clear(first(wb,"s","sheets"));
    ["definedNames","pivotCaches","externalReferences"].forEach(tag=>elements(wb,"s",tag).forEach(n=>n.remove()));
    const rels=xml(await zip.file("xl/_rels/workbook.xml.rels").async("string"));elements(rels,"rel","Relationship").filter(n=>/\/(?:worksheet|calcChain|pivotCacheDefinition|externalLink)$/.test(n.getAttribute("Type"))).forEach(n=>n.remove());
    const cts=xml(await zip.file("[Content_Types].xml").async("string"));elements(cts,"ct","Override").filter(n=>/^\/xl\/(?:worksheets|tables|pivotTables|pivotCache|externalLinks)\//.test(n.getAttribute("PartName"))||n.getAttribute("PartName")==="/xl/calcChain.xml").forEach(n=>n.remove());
    Object.keys(zip.files).filter(path=>/^xl\/(?:worksheets|tables|pivotTables|pivotCache|externalLinks)\//.test(path)||path==="xl/calcChain.xml").forEach(path=>zip.remove(path));
    const styles=xml(await zip.file("xl/styles.xml").async("string"));const xfs=first(styles,"s","cellXfs");const style=elements(xfs,"s","xf")[0].cloneNode(true);style.setAttribute("applyAlignment","1");elements(style,"s","alignment").forEach(n=>n.remove());style.appendChild(node(styles,"s","alignment",{wrapText:1,vertical:"top"}));const bodyStyle=xfs.children.length;xfs.appendChild(style);
    let numFmts=first(styles,"s","numFmts");
    if(!numFmts){numFmts=node(styles,"s","numFmts",{count:0});styles.documentElement.insertBefore(numFmts,styles.documentElement.children[0]||null);}
    const usedNumFmtIds=new Set(elements(numFmts,"s","numFmt").map(item=>Number(item.getAttribute("numFmtId"))));
    let nextNumFmtId=Math.max(163,...usedNumFmtIds)+1;
    function dateStyle(formatCode){
      let numFmt=elements(numFmts,"s","numFmt").find(item=>item.getAttribute("formatCode")===formatCode);
      if(!numFmt){while(usedNumFmtIds.has(nextNumFmtId))nextNumFmtId++;const id=nextNumFmtId++;usedNumFmtIds.add(id);numFmt=node(styles,"s","numFmt",{numFmtId:id,formatCode});numFmts.appendChild(numFmt);numFmts.setAttribute("count",elements(numFmts,"s","numFmt").length);}
      const xf=style.cloneNode(true);xf.setAttribute("numFmtId",numFmt.getAttribute("numFmtId"));xf.setAttribute("applyNumberFormat","1");const index=xfs.children.length;xfs.appendChild(xf);return index;
    }
    const dateStyles={date:dateStyle("yyyy-mm-dd"),dateTime:dateStyle("yyyy-mm-dd hh:mm:ss"),dateTimeMs:dateStyle("yyyy-mm-dd hh:mm:ss.000")};
    xfs.setAttribute("count",xfs.children.length);zip.file("xl/styles.xml",serialize(styles));
    const names=["Assessment Plan","Results Summary","Detailed Ratings","Work Products","Findings and Actions","Final Remark"];
    let tableNumber=0;
    model.sections.forEach((s,index)=>{
      const doc=xml(`<worksheet xmlns="${NS.s}"/>`);const sheet=doc.documentElement;
      const views=node(doc,"s","sheetViews");const view=node(doc,"s","sheetView",{workbookViewId:0});view.appendChild(node(doc,"s","pane",{ySplit:3,topLeftCell:"A4",activePane:"bottomLeft",state:"frozen"}));views.appendChild(view);sheet.appendChild(views);
      const cols=node(doc,"s","cols");const width=Math.max(...s.tables.map(t=>t.headers.length));for(let i=0;i<width;i++)cols.appendChild(node(doc,"s","col",{min:i+1,max:i+1,width:i<2?28:38,customWidth:1}));sheet.appendChild(cols);
      const data=node(doc,"s","sheetData");sheet.appendChild(data);let rowNumber=0;
      function row(values){const n=++rowNumber;const height=Math.min(409,Math.max(22,...values.map((v,i)=>Math.ceil(weightedLength(v?.__auditFlowExcelDate?"yyyy-mm-dd hh:mm:ss":v)/(i<2?26:36))*16+8)));const r=node(doc,"s","row",{r:n,ht:height,customHeight:1});values.forEach((v,i)=>{const isExcelDate=!!v?.__auditFlowExcelDate;const numeric=isExcelDate||(typeof v==="number"&&Number.isFinite(v));const styleIndex=isExcelDate?dateStyles[v.format]||bodyStyle:bodyStyle;const c=node(doc,"s","c",{r:column(i)+n,s:styleIndex,...(numeric?{t:"n"}:{t:"inlineStr"})});if(numeric)c.appendChild(node(doc,"s","v",{},isExcelDate?v.serial:v));else{const inline=node(doc,"s","is");const t=node(doc,"s","t",{},v);t.setAttributeNS("http://www.w3.org/XML/1998/namespace","xml:space","preserve");inline.appendChild(t);c.appendChild(inline);}r.appendChild(c);});data.appendChild(r);}
      if (!s.tabular) { row([s.title]); row([model.name,model.projectId,model.status]); row([model.generatedAt]); s.notes.forEach(n=>row([n])); }
      const tableParts=node(doc,"s","tableParts",{count:s.tables.length});const sr=xml(`<Relationships xmlns="${NS.rel}"/>`);
      for(const t of s.tables){if(!s.tabular)row([t.title]);const start=rowNumber+1;row(t.headers);t.rows.forEach(row);const id=++tableNumber;const ref=`A${start}:${column(t.headers.length-1)}${rowNumber}`;const td=xml(`<table xmlns="${NS.s}"/>`);const tableNode=td.documentElement;Object.entries({id,name:"ReportTable"+id,displayName:"ReportTable"+id,ref,totalsRowShown:0}).forEach(([k,v])=>tableNode.setAttribute(k,str(v)));tableNode.appendChild(node(td,"s","autoFilter",{ref}));const columns=node(td,"s","tableColumns",{count:t.headers.length});t.headers.forEach((h,i)=>columns.appendChild(node(td,"s","tableColumn",{id:i+1,name:h})));tableNode.appendChild(columns);tableNode.appendChild(node(td,"s","tableStyleInfo",{name:"TableStyleMedium2",showFirstColumn:0,showLastColumn:0,showRowStripes:1,showColumnStripes:0}));zip.file(`xl/tables/table${id}.xml`,serialize(td));cts.documentElement.appendChild(node(cts,"ct","Override",{PartName:`/xl/tables/table${id}.xml`,ContentType:"application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"}));tableParts.appendChild(node(doc,"s","tablePart",{"r:id":"t"+id}));sr.documentElement.appendChild(node(sr,"rel","Relationship",{Id:"t"+id,Type:NS.r+"/table",Target:`../tables/table${id}.xml`}));row([]);}
      sheet.appendChild(node(doc,"s","pageMargins",{left:0.4,right:0.4,top:0.5,bottom:0.5,header:0.2,footer:0.2}));sheet.appendChild(node(doc,"s","pageSetup",{orientation:"landscape",paperSize:9,fitToWidth:1,fitToHeight:0}));if(tableParts.children.length)sheet.appendChild(tableParts);
      const n=index+1;sheets.appendChild(node(wb,"s","sheet",{name:s.sheetName||names[index]||`Report ${n}`,sheetId:n,"r:id":"s"+n}));rels.documentElement.appendChild(node(rels,"rel","Relationship",{Id:"s"+n,Type:NS.r+"/worksheet",Target:`worksheets/sheet${n}.xml`}));cts.documentElement.appendChild(node(cts,"ct","Override",{PartName:`/xl/worksheets/sheet${n}.xml`,ContentType:"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"}));zip.file(`xl/worksheets/sheet${n}.xml`,serialize(doc));zip.file(`xl/worksheets/_rels/sheet${n}.xml.rels`,serialize(sr));
    });
    zip.file("xl/workbook.xml",serialize(wb));zip.file("xl/_rels/workbook.xml.rels",serialize(rels));zip.file("[Content_Types].xml",serialize(cts));
  }
  async function generate(project,templateId,options={}){
    const template=requireTemplate(templateId);const model=buildReportModel(project,options);
    if(!root.JSZip)throw new Error("JSZip is not loaded");
    const response=options.templateBytes ? null : await fetch(new URL(template.file, new URL(options.templateBaseUrl||"./templates/",root.location.href)));
    if(response&&!response.ok)throw new Error(`Template unavailable (${response.status})`);
    const zip=await root.JSZip.loadAsync(options.templateBytes||await response.arrayBuffer());
    if(template.format==="docx")await documentExport(zip,model);
    else if(template.format==="pptx")await presentationExport(zip,model,templateId);
    else await spreadsheetExport(zip,model,templateId);
    const data=await zip.generateAsync({type:"uint8array",compression:"DEFLATE"});
    const filename=`${model.projectId.replace(/[^\p{L}\p{N}._-]/gu,"_")}-${template.id}-${model.generatedAt.slice(0,10)}.${template.format}`;
    return {data,blob:new Blob([data],{type:MIME[template.format]}),filename,mime:MIME[template.format],model};
  }
  async function download(project,id,options={}){
    const template=requireTemplate(id);
    const output=await generate(project,id,options);const url=URL.createObjectURL(output.blob);const a=document.createElement("a");a.href=url;a.download=output.filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);return output;
  }
  function preview(project,options={}){
    const model=buildReportModel(project,options);const popup=root.open("","_blank");if(!popup)throw new Error("Allow pop-ups to open the report preview");
    popup.document.open();popup.document.write(printDocument(model,options));popup.document.close();popup.focus();
    return {mode:"preview",templateId:options.templateId||"trace-word",model};
  }
  function printDocument(model,options={}){
    const template=requireTemplate(options.templateId||"trace-word");
    if(template.format==="pptx"){
      const pages=presentationPages(model,template.id);
      return `<!doctype html><html lang="${esc(model.language)}"><head><meta charset="utf-8"><title>${esc(model.name)} ${esc(template.name)}</title><style>@page{size:338.67mm 190.5mm;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Arial,"Microsoft YaHei",sans-serif;color:#20252a}.slide{width:338.67mm;height:190.5mm;padding:8mm 16mm;break-after:page;position:relative;overflow:hidden}.slide:last-child{break-after:auto}.slide h1{font-size:24pt;font-weight:normal;line-height:1.15;margin:0 0 14mm}.slide p{font-size:18pt;line-height:1.3;white-space:pre-wrap;margin:0;overflow-wrap:anywhere}.page-number{position:absolute;bottom:6mm;right:16mm;font-size:9pt;color:#657078}@media screen{body{background:#e5e8ea}.slide{background:white;margin:12px auto}}</style></head><body>${pages.map((p,i)=>`<article class="slide"><h1>${esc(p.title)}</h1><p>${esc(p.lines.join("\n"))}</p><span class="page-number">${i+1} / ${pages.length}</span></article>`).join("")}</body></html>`;
    }
    if(template.format==="xlsx"){
      model=spreadsheetModel(model,template.id);
      return `<!doctype html><html lang="${esc(model.language)}"><head><meta charset="utf-8"><title>${esc(model.name)} ${esc(template.name)}</title><style>@page{size:A3 landscape;margin:12mm}*{box-sizing:border-box}body{font:9pt Arial,"Microsoft YaHei",sans-serif;color:#20252a;margin:0;line-height:1.35}section{break-before:page}section:first-child{break-before:auto}h1{font-size:17pt}h2{font-size:11pt;break-after:avoid}p{white-space:pre-wrap;overflow-wrap:anywhere}table{width:100%;table-layout:fixed;border-collapse:collapse;margin:8pt 0 14pt;font-size:8pt}thead{display:table-header-group}th,td{border:1px solid #cdd3d8;padding:5pt;text-align:left;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}th{background:#e4eef7}tr:nth-child(even) td{background:#f4f7fa}</style></head><body>${model.sections.map(s=>`<section><h1>${esc(s.title)}</h1><p>${esc(model.name)} | ${esc(model.projectId)} | ${esc(model.status)}</p>${s.notes.map(n=>`<p>${esc(n)}</p>`).join("")}${s.tables.map(t=>`<h2>${esc(t.title)}</h2><table><thead><tr>${t.headers.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${t.rows.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`).join("")}</section>`).join("")}</body></html>`;
    }
    return `<!doctype html><html lang="${esc(model.language)}"><head><meta charset="utf-8"><title>${esc(model.name)} Assessment Report</title><style>@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font:11pt Arial,"Microsoft YaHei",sans-serif;color:#20252a;line-height:1.45;margin:0}h1{font-size:24pt}h2{font-size:17pt;break-after:avoid}h3{font-size:12pt;break-after:avoid}p,td{overflow-wrap:anywhere;white-space:pre-wrap}table{width:100%;border-collapse:collapse;margin:8pt 0 16pt;table-layout:fixed}th,td{border:1px solid #cdd3d8;text-align:left;padding:6pt;vertical-align:top}th{background:#e9edf1}thead{display:table-header-group}.record{margin:8pt 0 16pt;border-top:1px solid #cdd3d8}.record p{margin:4pt 0}.state{font-weight:bold}section{break-before:page}section:first-of-type{break-before:auto}</style></head><body><h1>${esc(model.name)}</h1><p>${esc(model.projectId)} | ${esc(model.generatedAt)}</p><p class="state">${esc(model.status)}</p>${model.sections.map(s=>`<section><h2>${esc(s.title)}</h2>${s.notes.map(n=>`<p>${esc(n)}</p>`).join("")}${s.tables.map(t=>`<h3>${esc(t.title)}</h3>${t.headers.length>4?t.rows.map(r=>`<div class="record">${t.headers.map((h,i)=>`<p><b>${esc(h)}:</b> ${esc(r[i])}</p>`).join("")}</div>`).join(""):`<table><thead><tr>${t.headers.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${t.rows.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`}`).join("")}</section>`).join("")}</body></html>`;
  }
  function printPdf(project,options={}){
    const model=buildReportModel(project,options);const popup=root.open("","_blank");if(!popup)throw new Error("Allow pop-ups to open the PDF print dialog");
    popup.document.open();popup.document.write(printDocument(model,options));popup.document.close();
    const show=()=>{popup.focus();popup.print();};
    if(popup.document.readyState==="complete")setTimeout(show,0);
    else popup.addEventListener("load",show,{once:true});
    return {mode:"browser-print",templateId:options.templateId||"trace-word",model};
  }
  const settings=new Map();
  function state(projectId,id,language="en"){const key=projectId+"/"+id;if(!settings.has(key))settings.set(key,{includeCandidates:true,language:language==="zh"?"zh":"en"});return settings.get(key);}
  function renderRows(project,options={}){
    const custom = arr(options.customTemplates).filter(t => t && t.id).map(t => ({ id: t.id, name: t.name || "Imported report template", version: t.version || "1.0", format: t.format || "docx", file: t.file || "trace-word.docx", baseId: t.baseId || "trace-word", imported: true }));
    const allTemplates = [...templates, ...custom];
    allTemplates.forEach(t=>state(project.id,t.id,options.language));
    const icon=options.icon||((name)=>`<span aria-hidden="true">${({chevron:"&#8250;",settings:"&#9881;",download:"&#8595;",print:"&#9113;",eye:"&#9673;"})[name]||""}</span>`);
    const label=(en,zh)=>options.language==="zh"?zh:en;
    return `<div class="report-template-list" data-report-templates data-project-id="${esc(project.id)}"><div class="report-template-list-head"><h3>${label("Report Templates","报告模板")}</h3><span>${label("Current project","当前项目")}: ${esc(project.name||project.id)}</span></div>${allTemplates.map((t,index)=>{const s=state(project.id,t.id);return `<article class="report-template-item" data-template-id="${t.id}" data-base-template="${t.baseId||t.id}"><div class="report-template-row"><input type="radio" name="report-template-${esc(project.id)}" value="${t.id}" aria-label="${esc(t.name)}" ${index===0?"checked":""}><button type="button" class="report-template-icon" data-rt-action="expand" aria-expanded="false" title="${label("Expand","展开")}" aria-label="${label("Expand","展开")}">${icon("chevron")}</button><span class="report-template-format ${t.format}">${t.format.toUpperCase()}</span><div class="report-template-name"><strong>${esc(t.name)}</strong><small>v${esc(t.version)}${t.imported?` · ${label("Imported","已导入")}`:""}</small></div><div class="report-template-actions"><button type="button" class="report-template-icon" data-rt-action="settings" aria-expanded="false" title="${label("Export settings","导出设置")}" aria-label="${label("Export settings","导出设置")}">${icon("settings")}</button><button type="button" class="report-template-icon" data-rt-action="preview" title="${label("Preview","预览")} ${t.format.toUpperCase()}" aria-label="${label("Preview","预览")} ${t.format.toUpperCase()}">${icon("eye")}</button><button type="button" class="report-template-icon" data-rt-action="download" title="${label("Download","下载")} ${t.format.toUpperCase()}" aria-label="${label("Download","下载")} ${t.format.toUpperCase()}">${icon("download")}</button></div></div><div class="report-template-details" hidden><ol>${buildReportModel(project,options).sections.map(section=>`<li>${esc(section.title.replace(/^\d+ /,""))}</li>`).join("")}</ol></div><div class="report-template-settings" hidden><label>${label("Language","语言")}<select data-rt-setting="language"><option value="en" ${s.language==="en"?"selected":""}>English</option><option value="zh" ${s.language==="zh"?"selected":""}>中文</option></select></label><label><input type="checkbox" data-rt-setting="includeCandidates" ${s.includeCandidates?"checked":""}>${label("AI candidates appendix","AI 候选记录")}</label></div></article>`;}).join("")}<div class="report-template-footer"><button type="button" class="btn secondary" data-rt-action="download-selected">${icon("download")}${label("Download selected","下载所选模板")}</button><button type="button" class="btn secondary" data-rt-action="preview-selected">${icon("eye")}${label("Preview selected","预览所选模板")}</button><button type="button" class="btn secondary" data-rt-action="pdf">${icon("print")}${label("PDF (print / Save as PDF)","PDF（打印 / 另存为 PDF）")}</button><output class="report-template-status" role="status" aria-live="polite"></output></div></div>`;
  }
  function bind(container,getProject,options={}){
    if(!container)throw new Error("Report template container is required");
    let busy=false;
    const change=event=>{const input=event.target.closest("[data-rt-setting]");if(!input)return;const panel=input.closest("[data-report-templates]");if(!panel||!container.contains(panel))return;const s=state(panel.dataset.projectId,input.closest("[data-template-id]").dataset.templateId);s[input.dataset.rtSetting]=input.type==="checkbox"?input.checked:input.value;};
    const click=async event=>{
      const button=event.target.closest("[data-rt-action]");if(!button||!container.contains(button))return;const panel=button.closest("[data-report-templates]");if(!panel)return;event.preventDefault();event.stopPropagation();
      const action=button.dataset.rtAction;const item=button.closest("[data-template-id]");
      if(action==="expand"||action==="settings"){const child=item.querySelector(action==="expand"?".report-template-details":".report-template-settings");child.hidden=!child.hidden;button.setAttribute("aria-expanded",str(!child.hidden));return;}
      if(busy)return;const output=panel.querySelector("output");const project=typeof getProject==="function"?getProject(panel.dataset.projectId):getProject;
      if(!project||str(project.id)!==panel.dataset.projectId){output.textContent="Current project is no longer available";return;}
      const id=item?.dataset.templateId||panel.querySelector('input[type="radio"]:checked')?.value;
      const exportId=item?.dataset.baseTemplate || id;
      const currentOptions=typeof options.getOptions==="function"?options.getOptions(project):options;
      const opts={...currentOptions,...state(project.id,id),templateId:id};
      try{busy=true;panel.setAttribute("aria-busy","true");panel.querySelectorAll('[data-rt-action^="download"], [data-rt-action^="preview"], [data-rt-action="pdf"]').forEach(b=>b.disabled=true);output.textContent=opts.language==="zh"?"正在生成...":"Generating...";
        opts.templateId=exportId;
        const selectedTemplate=requireTemplate(exportId);
        let result;
        if ((action==="preview"||action==="preview-selected") && typeof options.onPreview === "function") {
          const model=buildReportModel(project,opts);
          options.onPreview({ html: printDocument(model,opts), model, templateId: exportId });
          result={mode:"preview",templateId:exportId,model};
        } else result=action==="pdf"?printPdf(project,opts):action==="preview"||action==="preview-selected"?preview(project,opts):await download(project,exportId,opts);
        output.textContent=result.mode==="browser-print"?(opts.language==="zh"?"打印窗口已打开，选择另存为 PDF":"Print window opened. Select Save as PDF."):result.mode==="preview"?(opts.language==="zh"?"预览已在应用内打开":"Preview opened in the application"):result.filename;options.onComplete?.(result);
      }catch(error){output.textContent=error.message||str(error);options.onError?.(error);}finally{busy=false;panel.removeAttribute("aria-busy");panel.querySelectorAll('[data-rt-action^="download"], [data-rt-action^="preview"], [data-rt-action="pdf"]').forEach(b=>b.disabled=false);}
    };
    container.addEventListener("click",click);container.addEventListener("change",change);
    return ()=>{container.removeEventListener("click",click);container.removeEventListener("change",change);};
  }
  root.AuditFlowReportTemplates=Object.freeze({version:"12.3.0",templates,buildReportModel,generate,download,preview,printPdf,printDocument,renderRows,bind,presentationPages});
})(typeof window!=="undefined"?window:globalThis);
