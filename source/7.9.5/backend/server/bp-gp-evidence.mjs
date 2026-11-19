const TOKEN_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "shall", "should", "must", "have", "has", "into", "using",
  "requirement", "requirements", "evidence", "finding", "process", "review", "verify", "verification", "record"
]);

export function normalizeEvidenceId(value) {
  const id = String(value || "").normalize("NFKC").trim().toUpperCase();
  return /^(?:[A-Z][A-Z0-9]*[-_. ]+)?\d+[A-Z]?$|^[A-Z]+\d+[A-Z]?$/.test(id)
    ? id.replace(/[-_. ]/g, "")
    : "";
}

export function isFindingEvidenceReferenceSelected(record = {}, candidate = {}) {
  const itemId = String(candidate.itemId || candidate.sourceItemId || "");
  if (!itemId || !candidate.evidenceId) return false;
  return (record.evidenceReferences || []).some(reference =>
    String(reference.evidenceId || "") === String(candidate.evidenceId)
    && String(reference.itemId || reference.sourceItemId || "") === itemId
  );
}

function tokens(value) {
  return String(value || "").normalize("NFKC").toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter(token => token.length >= 3 && !TOKEN_STOPWORDS.has(token));
}

function similarityScore(queryTokens, candidate) {
  if (!queryTokens.length) return 0;
  const haystack = new Set(tokens(candidate));
  return [...new Set(queryTokens)].filter(token => haystack.has(token)).length;
}

export function suggestFindingEvidence(project = {}, assessment = {}, record = {}) {
  const sourceText = [record.title, record.text, record.problem, assessment.title, assessment.criterion].filter(Boolean).join(" ");
  const referenceIds = new Set([...sourceText.matchAll(/\b(?:[A-Za-z][A-Za-z0-9]*[-_.]\d+[A-Za-z]?|[A-Za-z]{2,}\d{2,}[A-Za-z]?)\b/g)]
    .map(match => normalizeEvidenceId(match[0])).filter(Boolean));
  const queryTokens = tokens(sourceText);
  const rawCode = String(assessment.code || "").trim();
  const indicator = rawCode.startsWith(`${assessment.process}.`) ? rawCode : [assessment.process, rawCode.replace(/\.$/, "")].filter(Boolean).join(".");
  const confirmedLinks = (project.traceLinks || []).filter(link =>
    link.indicator === indicator && link.confirmed === true && !/\b(?:ai|inferred|candidate|provider|model)\b/i.test(String(link.source || ""))
  );
  const linkedEvidenceIds = new Set((record.evidenceIds || []).map(String));
  const linkedItems = new Set((record.evidenceReferences || []).map(item => `${item.evidenceId}|${item.itemId || item.sourceItemId || ""}`));
  const candidates = [];

  for (const evidence of project.evidence || []) {
    if (evidence.traceabilityReport || evidence.helixImportKind === "traceability") continue;
    const evidenceLinks = confirmedLinks.filter(link => link.evidenceId === evidence.id);
    const atoms = (evidence.atomicItems || []).filter(item => String(item.locator || "").trim());
    const matches = atoms.map(atom => {
      const itemId = String(atom.id || atom.externalId || "");
      const externalId = normalizeEvidenceId(atom.externalId);
      const confirmed = evidenceLinks.find(link => String(link.itemId || link.atomicItemId || "") === itemId
        || String(link.itemExternalId || "") === String(atom.externalId || ""));
      const existingReference = linkedItems.has(`${evidence.id}|${itemId}`);
      const exactId = externalId && referenceIds.has(externalId);
      const semanticMatches = similarityScore(queryTokens, [atom.externalId, atom.title, atom.text, atom.description].join(" "));
      if (!confirmed && !exactId && semanticMatches < 2 && !existingReference) return null;

      const matchBasis = [];
      let score = 0;
      if (confirmed) { matchBasis.push("confirmed-item-trace"); score += 1000; }
      if (exactId) { matchBasis.push("exact-item-id"); score += 700; }
      if (semanticMatches >= 2) { matchBasis.push("item-text-match"); score += 100 + semanticMatches; }
      if (existingReference) { matchBasis.push("existing-item-citation"); score += 500; }
      const processMatch = atom.primaryProcess === assessment.process || (atom.relatedProcesses || []).includes(assessment.process);
      if (processMatch) score += 35;
      const isCandidate = atom.evidenceRole === "corroborating" || atom.evidenceRole === "index-only";
      return {
        evidenceId: evidence.id,
        itemId,
        sourceItemId: itemId,
        evidenceCode: evidence.code || "EV",
        code: evidence.code || "EV",
        name: evidence.name || "Evidence",
        sourceFile: evidence.name || "",
        externalId: String(atom.externalId || ""),
        locator: String(atom.locator),
        excerpt: String(atom.text || atom.description || atom.title || "").replace(/\s+/g, " ").slice(0, 360),
        claim: `Item-level candidate for ${indicator}; verify the cited source supports the Finding claim.`,
        matchBasis,
        score,
        semanticMatches,
        evidenceRole: atom.evidenceRole || "index-only",
        strength: atom.evidenceRole === "direct" ? "direct" : "corroborating",
        relationStatus: confirmed ? "assessor-confirmed" : exactId ? "exact-id-candidate" : "text-candidate",
        isCandidate,
        reason: confirmed ? "Confirmed trace for the same indicator and item"
          : exactId ? `Exact identifier match: ${atom.externalId}`
            : linkedEvidenceIds.has(String(evidence.id)) ? "Finding already references this evidence file"
              : `Item-level text match (${semanticMatches} terms)`
      };
    }).filter(Boolean);
    candidates.push(...matches);
  }

  const idCounts = new Map();
  for (const candidate of candidates) {
    const key = normalizeEvidenceId(candidate.externalId);
    if (key) idCounts.set(key, (idCounts.get(key) || 0) + 1);
  }
  for (const candidate of candidates) {
    const key = normalizeEvidenceId(candidate.externalId);
    candidate.ambiguous = !!key && idCounts.get(key) > 1 && candidate.matchBasis.includes("exact-item-id") && candidate.relationStatus !== "assessor-confirmed";
    candidate.confidence = candidate.ambiguous ? "low"
      : candidate.relationStatus === "assessor-confirmed" ? "high"
        : candidate.relationStatus === "exact-id-candidate" ? "medium" : "low";
  }

  return candidates.sort((left, right) => right.score - left.score
    || left.evidenceId.localeCompare(right.evidenceId)
    || left.itemId.localeCompare(right.itemId)).slice(0, 24);
}
