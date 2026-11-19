/* Public release: controlled assessment datasets are omitted. */
window.AUDITFLOW_EXTERNAL_ASSESSMENTS = [];
/* ASPICE V4 external assessment mapping start */
(function registerExternalAssessmentMapping(root) {
  "use strict";

  const fields = Object.freeze({
    "判定规则": Object.freeze({ key: "judgmentRules", target: "criterion", authority: "reference-only", aliases: ["判定规则", "judgmentRule", "judgementRule", "decisionRule", "criterion"] }),
    "评分规则": Object.freeze({ key: "ratingRules", target: "ratingGuidance", authority: "reference-only", aliases: ["评分规则", "ratingRule", "scoringRule"] }),
    "审核问题": Object.freeze({ key: "auditQuestions", target: "interviewQuestions", authority: "assessor-prompt", aliases: ["审核问题", "auditQuestions", "interviewQuestions", "questions"] }),
    "常见不符合项": Object.freeze({ key: "commonNonconformities", target: "commonNonconformities", authority: "reference-only", aliases: ["常见不符合项", "commonNonconformities", "commonNonconformityExamples"] }),
    "证据要求": Object.freeze({ key: "evidenceRequirements", target: "requiredEvidence", authority: "request-only", aliases: ["证据要求", "evidenceRequirements", "requiredEvidence", "closureEvidence"] }),
    "判定理由": Object.freeze({ key: "decisionRationale", target: "reason", authority: "candidate-only", aliases: ["判定理由", "decisionRationale", "assessmentRationale", "auditExplanation", "reason"] }),
    "审核发现": Object.freeze({ key: "auditFindings", target: "findings", authority: "candidate-only", aliases: ["审核发现", "auditFindings", "findings", "weakness"] }),
    "AI指向证据": Object.freeze({ key: "aiEvidencePointers", target: "evidenceAnalysis", authority: "candidate-reference-only", aliases: ["AI指向证据", "aiEvidencePointers", "aiEvidenceReferences", "evidenceAnalysis"] })
  });

  function asObject(input) {
    if (typeof input === "string") {
      try {
        input = JSON.parse(input);
      } catch {
        throw new TypeError("External assessment must be a JSON object or object value.");
      }
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("External assessment must be a JSON object or object value.");
    }
    return input;
  }

  function firstPresent(source, aliases) {
    for (const alias of aliases) {
      if (Object.prototype.hasOwnProperty.call(source, alias) && source[alias] !== null && source[alias] !== undefined && source[alias] !== "") {
        return { alias, value: source[alias] };
      }
    }
    return { alias: "", value: null };
  }

  function textList(value) {
    const values = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
    return values.map(item => {
      if (typeof item === "string" || typeof item === "number") return String(item).trim();
      if (!item || typeof item !== "object") return "";
      return String(item.text ?? item.question ?? item.requirement ?? item.title ?? item.label ?? "").trim();
    }).filter(Boolean);
  }

  function pointerList(value) {
    const values = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
    return values.map(item => {
      if (typeof item === "string" || typeof item === "number") {
        const reference = String(item).trim();
        return reference ? { reference } : null;
      }
      if (!item || typeof item !== "object") return null;
      const pointer = {};
      for (const key of ["evidenceId", "evidenceCode", "id", "code", "locator", "sourceFile", "sourceCell"]) {
        if (typeof item[key] === "string" && item[key].trim()) pointer[key] = item[key].trim();
      }
      return Object.keys(pointer).length ? pointer : null;
    }).filter(Boolean);
  }

  function mapExternalAssessmentSemantics(input) {
    const source = asObject(input);
    const mapped = {};
    for (const [label, descriptor] of Object.entries(fields)) {
      const found = firstPresent(source, descriptor.aliases);
      const value = descriptor.key === "aiEvidencePointers"
        ? pointerList(found.value)
        : ["auditQuestions", "commonNonconformities", "evidenceRequirements", "auditFindings"].includes(descriptor.key)
          ? textList(found.value)
          : found.value == null ? "" : String(found.value).trim();
      mapped[descriptor.key] = {
        label,
        target: descriptor.target,
        authority: descriptor.authority,
        sourceAlias: found.alias || null,
        value,
        status: value && (!Array.isArray(value) || value.length) ? "imported-unreviewed" : "not-provided"
      };
    }

    mapped.sourceDecision = {
      rating: source.rating ?? source.assessorRating ?? null,
      score: source.score ?? null,
      origin: source.rating || source.assessorRating || source.score != null ? "external-assessment" : null,
      status: source.rating || source.assessorRating || source.score != null ? "unconfirmed-import" : "not-provided"
    };
    mapped.aiCandidateRating = {
      value: source.aiCandidateRating ?? source.aiRating ?? null,
      status: source.aiCandidateRating != null || source.aiRating != null ? "candidate" : "not-provided"
    };
    mapped.standardBasis = "Automotive SPICE 4.0";
    mapped.schemaVersion = 1;
    return mapped;
  }

  function attachExternalAssessmentSemantics(existingAssessment, sourceRecord) {
    const existing = existingAssessment && typeof existingAssessment === "object" && !Array.isArray(existingAssessment)
      ? existingAssessment
      : {};
    return {
      ...existing,
      externalAssessmentSemantics: mapExternalAssessmentSemantics(sourceRecord)
    };
  }

  root.AUDITFLOW_EXTERNAL_ASSESSMENT_MAPPING = Object.freeze({
    schemaVersion: 1,
    standardBasis: "Automotive SPICE 4.0",
    fields,
    map: mapExternalAssessmentSemantics,
    attach: attachExternalAssessmentSemantics
  });
})(window);
/* END ASPICE V4 external assessment mapping */
