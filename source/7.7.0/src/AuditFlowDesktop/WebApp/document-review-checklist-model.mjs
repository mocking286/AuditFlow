const DOCUMENT_REVIEW_PROCESSES = Object.freeze(["SYS.2", "SYS.3", "SWE.1", "SWE.2"]);
const PROCESS_NAME_PATTERNS = Object.freeze([
  [/\bsys(?:tem)?[-\s_.]*(?:requirements?|specification)\b|系统(?:需求|规格)/i, "SYS.2"],
  [/\bsys(?:tem)?[-\s_.]*architecture\b|系统架构/i, "SYS.3"],
  [/\b(?:swe|sw|software)[-\s_.]*(?:requirements?|specification)\b|软件需求/i, "SWE.1"],
  [/\b(?:swe|sw|software)[-\s_.]*architecture\b|软件架构/i, "SWE.2"]
]);

function textOfEvidence(evidence = {}) {
  return [
    evidence.name,
    evidence.source,
    evidence.type,
    evidence.scope,
    evidence.structure,
    evidence.content,
    ...(Array.isArray(evidence.primaryProcesses) ? evidence.primaryProcesses : [])
  ].filter(Boolean).join(" ");
}

export function evidenceProcessIds(evidence = {}) {
  const text = textOfEvidence(evidence);
  const ids = new Set();
  for (const match of text.matchAll(/\b(SYS|SWE)\s*[\s._-]?\s*(\d{1,2})\b/gi)) {
    const process = `${match[1].toUpperCase()}.${Number(match[2])}`;
    if (DOCUMENT_REVIEW_PROCESSES.includes(process)) ids.add(process);
  }
  for (const [pattern, process] of PROCESS_NAME_PATTERNS) {
    if (pattern.test(text)) ids.add(process);
  }
  return [...ids];
}

export function isUploadedAspiceEvidence(evidence = {}) {
  if (!evidence || evidence.bundledCepEvidence === true) return false;
  return Boolean(
    evidence.uploadedAt
    || evidence.uploaded === true
    || evidence.userUploaded === true
    || evidence.importedAt
    || evidence.helixImport
    || evidence.helix?.source === "rest"
  );
}

export function uploadedAspiceProcessIds(project = {}) {
  const ids = new Set();
  for (const evidence of Array.isArray(project.evidence) ? project.evidence : []) {
    if (!isUploadedAspiceEvidence(evidence)) continue;
    for (const process of evidenceProcessIds(evidence)) ids.add(process);
  }
  return DOCUMENT_REVIEW_PROCESSES.filter(process => ids.has(process));
}

export function hasUploadedAspiceProcessEvidence(project = {}) {
  return uploadedAspiceProcessIds(project).length > 0;
}

export function selectDocumentReviewEntries(entries = [], processIds = [], limit = 12) {
  const allowed = new Set(processIds.filter(process => DOCUMENT_REVIEW_PROCESSES.includes(process)));
  if (!allowed.size) return [];
  const processOrder = new Map(DOCUMENT_REVIEW_PROCESSES.map((process, index) => [process, index]));
  const candidates = entries
    .filter(entry => allowed.has(entry?.process) && String(entry?.recordType || "checklist") !== "strategy")
    .sort((left, right) => (
      (processOrder.get(left.process) ?? 99) - (processOrder.get(right.process) ?? 99)
      || String(left.sourceDocument || "").localeCompare(String(right.sourceDocument || ""))
      || Number(left.sourceRow || 0) - Number(right.sourceRow || 0)
      || String(left.id || "").localeCompare(String(right.id || ""))
    ));
  if (candidates.length <= limit) return candidates;
  const selected = [];
  const perProcess = Math.max(1, Math.floor(limit / allowed.size));
  for (const process of DOCUMENT_REVIEW_PROCESSES) {
    if (!allowed.has(process)) continue;
    selected.push(...candidates.filter(entry => entry.process === process).slice(0, perProcess));
  }
  for (const entry of candidates) {
    if (selected.length >= limit) break;
    if (!selected.includes(entry)) selected.push(entry);
  }
  return selected.slice(0, limit);
}

export { DOCUMENT_REVIEW_PROCESSES };
