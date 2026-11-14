(function (root) {
  "use strict";

  const PROCESS_PATTERN = /\b(SYS|SWE|HWE|MLE|MAN|SUP|ACQ|SPL|PIM|REU|INF)\s*[._-]?\s*(\d{1,2})(?!\d)/i;
  const PROCESS_FIELDS = ["id", "processId", "process", "primaryProcess", "code", "key", "value"];
  const UNCLASSIFIED = "UNCLASSIFIED";
  const WORK_PRODUCT_TYPES = Object.freeze([
    "system-requirement", "system-architecture", "software-requirement",
    "software-architecture", "software-detail-design", "test-plan",
    "test-case", "test-report", "issue-nc", "trace", "task", "process",
    "information", "heading", "unclassified"
  ]);

  function text(value) {
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
  }

  function normalizeProcessId(value, seen) {
    if (value && typeof value === "object") {
      const visited = seen || new Set();
      if (visited.has(value)) return "";
      visited.add(value);
      for (const field of PROCESS_FIELDS) {
        const process = normalizeProcessId(value[field], visited);
        if (process) return process;
      }
      return "";
    }
    const source = text(value).trim();
    if (/^unclassified$/i.test(source)) return UNCLASSIFIED;
    const match = source.match(PROCESS_PATTERN);
    return match ? `${match[1].toUpperCase()}.${Number(match[2])}` : "";
  }

  function normalizeProcessIds(values) {
    const output = [];
    const visited = new Set();
    const add = value => {
      if (Array.isArray(value)) {
        if (visited.has(value)) return;
        visited.add(value);
        value.forEach(add);
        return;
      }
      const process = normalizeProcessId(value);
      if (process && !output.includes(process)) output.push(process);
    };
    add(values);
    return output;
  }

  // Retention is deliberately independent of report and rating eligibility.
  function retainEvidenceItems(items) {
    return Array.isArray(items) ? items.slice() : [];
  }

  function sourceFile(evidence) {
    return text(evidence?.importSource?.sourceFile) || text(evidence?.sourceFile) || text(evidence?.fileName)
      || text(evidence?.file?.name) || text(evidence?.name) || "";
  }

  function normalizedType(value) {
    const type = text(value).trim().toLowerCase().replace(/[_\s]+/g, "-");
    return ({
      title: "heading",
      info: "information",
      "software-detailed-design": "software-detail-design",
      "detailed-design": "software-detail-design",
      "verification-plan": "test-plan",
      "verification-case": "test-case",
      "verification-report": "test-report",
      "test-result": "test-report",
      "test-results": "test-report",
      issue: "issue-nc",
      nc: "issue-nc",
      "traceability": "trace"
    })[type] || type;
  }

  function classifyWorkProduct(item = {}, evidence = {}, processId = "") {
    const assigned = normalizedType(item.userAssignedReviewType || item.userAssignedItemType);
    if (WORK_PRODUCT_TYPES.includes(assigned)) return assigned;
    const explicit = normalizedType(item.workProductType || item.reviewItemType || item.helixReviewType);
    if (WORK_PRODUCT_TYPES.includes(explicit)) return explicit;
    const itemType = normalizedType(item.itemType || item.type);
    if (WORK_PRODUCT_TYPES.includes(itemType) && !["information", "process", "unclassified"].includes(itemType)) return itemType;
    const context = [
      sourceFile(evidence), evidence.type, evidence.documentClass,
      item.chapter, item.title, item.documentClass
    ].map(text).join(" ");
    const rules = [
      [/test[\s_-]*(?:report|results?)|verification[\s_-]*(?:report|results?)|\u6d4b\u8bd5\u62a5\u544a|\u6d4b\u8bd5\u7ed3\u679c|\u9a8c\u8bc1\u62a5\u544a/i, "test-report"],
      [/test[\s_-]*(?:plan|strategy)|verification[\s_-]*(?:plan|strategy)|\u6d4b\u8bd5\u8ba1\u5212|\u6d4b\u8bd5\u7b56\u7565|\u9a8c\u8bc1\u8ba1\u5212/i, "test-plan"],
      [/test[\s_-]*case|verification[\s_-]*case|\u6d4b\u8bd5\u7528\u4f8b|\u9a8c\u8bc1\u7528\u4f8b/i, "test-case"],
      [/software[\s_-]*(?:detailed?|detail)[\s_-]*design|detailed[\s_-]*design|\u8f6f\u4ef6\u8be6\u7ec6\u8bbe\u8ba1|\u8be6\u7ec6\u8bbe\u8ba1/i, "software-detail-design"],
      [/software[\s_-]*architect|\u8f6f\u4ef6\u67b6\u6784/i, "software-architecture"],
      [/system[\s_-]*architect|\u7cfb\u7edf\u67b6\u6784/i, "system-architecture"],
      [/software[\s_-]*(?:requirements?|specification)|\u8f6f\u4ef6\u9700\u6c42|\u8f6f\u4ef6\u89c4\u683c/i, "software-requirement"],
      [/system[\s_-]*(?:requirements?|specification)|\u7cfb\u7edf\u9700\u6c42|\u7cfb\u7edf\u89c4\u683c/i, "system-requirement"],
      [/traceability|trace[\s_-]*matrix|\u8ffd\u6eaf\u77e9\u9635|\u8ffd\u6eaf\u62a5\u544a/i, "trace"]
    ];
    const contextType = rules.find(([pattern]) => pattern.test(context))?.[1];
    if (contextType) return contextType;
    const requirementTypes = { "SYS.2": "system-requirement", "SWE.1": "software-requirement" };
    if (itemType === "requirement") return requirementTypes[processId] || "unclassified";
    const processTypes = {
      "SYS.3": "system-architecture", "SWE.2": "software-architecture",
      "SWE.3": "software-detail-design"
    };
    if (processTypes[processId] && !["information", "process"].includes(itemType)) return processTypes[processId];
    return WORK_PRODUCT_TYPES.includes(itemType) ? itemType : "unclassified";
  }

  function summarizeEvidenceRetention(evidence = {}, items = evidence.atomicItems) {
    const retained = retainEvidenceItems(items);
    const excluded = Array.isArray(evidence.excludedItems) ? evidence.excludedItems : [];
    const metadataOnly = excluded.filter(item => !text(item?.text || item?.description || item?.body).trim());
    const missingSources = metadataOnly.filter(excludedItem => !retained.some(item => {
      if (!item || typeof item !== "object") return false;
      const excludedLocator = text(excludedItem.locator).trim();
      const retainedLocator = text(item.locator).trim();
      if (excludedLocator && retainedLocator) return excludedLocator === retainedLocator;
      return (text(excludedItem.id) && text(excludedItem.id) === text(item.id))
        || (text(excludedItem.externalId) && text(excludedItem.externalId) === text(item.externalId));
    }));
    const recoveryInputs = [];
    if (Array.isArray(evidence.paragraphRecords) && evidence.paragraphRecords.length) recoveryInputs.push("paragraphRecords");
    if (Array.isArray(evidence.tables) && evidence.tables.length) recoveryInputs.push("tables");
    if (text(evidence.content).trim()) recoveryInputs.push("content");
    const byType = {};
    retained.forEach(item => {
      const type = normalizedType(item?.itemType) || "unclassified";
      byType[type] = (byType[type] || 0) + 1;
    });
    return {
      policy: "retain-source-items-separate-formal-eligibility",
      retainedCount: retained.length,
      contextCount: (byType.information || 0) + (byType.heading || 0),
      byType,
      formalEligibilitySeparate: true,
      legacyExcludedCount: excluded.length,
      metadataOnlyExcludedCount: metadataOnly.length,
      missingSourceItemCount: missingSources.length,
      needsSourceReparse: missingSources.length > 0,
      recoveryInputs,
      requiresSourceFile: missingSources.length > 0 && recoveryInputs.length === 0
    };
  }

  function instanceValues(item, evidence, project) {
    const list = value => Array.isArray(value) ? value : value ? [value] : [];
    const ids = [item.instanceId, evidence.instanceId, ...list(item.instanceIds), ...list(evidence.instanceIds)]
      .map(value => text(value?.id) || text(value)).filter(Boolean);
    const uniqueIds = [...new Set(ids)];
    const names = uniqueIds.map(id => {
      const instance = (project.instances || []).find(entry => text(entry?.id) === id);
      return text(instance?.name) || text(instance?.short) || id;
    });
    return { instanceIds: uniqueIds, instanceNames: names };
  }

  function catalogDescriptors(project) {
    return (Array.isArray(project.evidence) ? project.evidence : []).flatMap(evidence => {
      if (!evidence || typeof evidence !== "object") return [];
      const atoms = Array.isArray(evidence.atomicItems) && evidence.atomicItems.length
        ? evidence.atomicItems
        : Array.isArray(evidence.traceabilityAtoms) ? evidence.traceabilityAtoms : [];
      const sources = atoms.length ? atoms : [null];
      return sources.map((sourceItem, index) => {
        const item = sourceItem && typeof sourceItem === "object" ? sourceItem : {};
        const inherited = normalizeProcessIds(evidence.primaryProcesses);
        const primary = normalizeProcessId(item.userAssignedProcess)
          || normalizeProcessId(item.primaryProcess || item.process)
          || inherited.find(process => process !== UNCLASSIFIED) || UNCLASSIFIED;
        const related = normalizeProcessIds([
          item.relatedProcesses, item.relatedProcess, evidence.relatedProcesses, inherited
        ]).filter(process => process !== primary && process !== UNCLASSIFIED);
        return { item, evidence, index, primary, related, sourceItem, target: sourceItem || evidence };
      });
    });
  }

  function parseCatalogCode(value) {
    const match = text(value).match(/^((?:[A-Z]{2,3}\.\d{1,2})|UNCLASSIFIED)\.(\d{3,})$/);
    return match ? { prefix: match[1], number: Number(match[2]) } : null;
  }

  function buildEvidenceCatalog(project = {}, options = {}) {
    const model = Array.isArray(project) ? { evidence: project } : (project || {});
    const descriptors = catalogDescriptors(model);
    const maximum = new Map();
    const used = new Set();
    descriptors.forEach(({ target }) => {
      const previous = parseCatalogCode(target.catalogCode);
      if (previous) maximum.set(previous.prefix, Math.max(maximum.get(previous.prefix) || 0, previous.number));
    });
    return descriptors.map(({ item, evidence, index, primary, related, sourceItem, target }) => {
      const previous = parseCatalogCode(target.catalogCode);
      let catalogCode = previous?.prefix === primary && !used.has(target.catalogCode) ? target.catalogCode : "";
      if (!catalogCode) {
        let number = (maximum.get(primary) || 0) + 1;
        while (used.has(`${primary}.${String(number).padStart(3, "0")}`)) number += 1;
        maximum.set(primary, number);
        catalogCode = `${primary}.${String(number).padStart(3, "0")}`;
      }
      used.add(catalogCode);
      if (options.assignNumbers === true && target.catalogCode !== catalogCode) target.catalogCode = catalogCode;
      const instances = instanceValues(item, evidence, model);
      const workProductType = classifyWorkProduct(item, evidence, primary);
      const file = sourceFile(evidence) || text(item.sourceFile);
      const id = text(item.id) || (sourceItem ? text(item.externalId) : text(evidence.id));
      return {
        ...item,
        id,
        catalogCode,
        primaryProcess: primary,
        process: primary,
        relatedProcesses: related,
        processCandidates: [primary, ...related],
        workProductType,
        itemId: sourceItem ? id : "",
        externalId: text(item.externalId),
        sourceEvidenceId: text(evidence.id) || text(item.sourceEvidenceId),
        evidenceId: text(evidence.id) || text(item.sourceEvidenceId),
        sourceEvidenceCode: text(evidence.code) || text(item.sourceEvidenceCode),
        sourceFile: file,
        source: file,
        title: text(item.title || item.summary || item.name || item.externalId)
          || text(evidence.name || evidence.title) || file,
        text: sourceItem ? text(item.text || item.description || item.body) : text(evidence.description || evidence.summary || evidence.content),
        locator: text(item.locator || item.sourceCell || item.sourceLocator)
          || text(evidence.locator) || (sourceItem ? `Item ${index + 1}` : "Document"),
        evidenceRole: text(item.evidenceRole || evidence.evidenceRole) || "index-only",
        reviewed: item.reviewed === true,
        ...instances,
        instanceId: instances.instanceIds[0] || "",
        instance: instances.instanceNames.join(" / "),
        isDocumentLevel: !sourceItem,
        evidence,
        sourceItem: sourceItem || null
      };
    });
  }

  function selectedValues(value) {
    return (Array.isArray(value) ? value : [value]).map(text).map(value => value.trim())
      .filter(value => value && !["all", "*"].includes(value.toLowerCase()));
  }

  function filterEvidenceCatalog(rows, filters = {}) {
    const source = Array.isArray(rows) ? rows : [];
    const query = text(filters.query || filters.q || filters.search).trim().toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    const processes = selectedValues(filters.processes || filters.process).map(value => normalizeProcessId(value) || value);
    const types = selectedValues(filters.workProductTypes || filters.workProductType || filters.types || filters.type).map(normalizedType);
    const roles = selectedValues(filters.roles || filters.role || filters.evidenceRole);
    const sources = selectedValues(filters.sources || filters.source || filters.sourceId);
    const instances = selectedValues(filters.instances || filters.instance || filters.instanceId);
    return source.filter(row => {
      if (processes.length && !processes.some(process => normalizeProcessIds([
        row.process, row.primaryProcess, row.relatedProcesses, row.processCandidates
      ]).includes(process))) return false;
      if (types.length && !types.includes(normalizedType(row.workProductType || row.itemType || row.type))) return false;
      if (roles.length && !roles.includes(text(row.evidenceRole))) return false;
      if (sources.length && !sources.some(value => [
        row.sourceEvidenceId, row.evidenceId, row.sourceEvidenceCode, row.sourceFile, row.source
      ].some(sourceValue => text(sourceValue) === value))) return false;
      if (instances.length && !instances.some(value => [
        row.instanceId, row.instance, ...(row.instanceIds || []), ...(row.instanceNames || [])
      ].some(instanceValue => text(instanceValue) === value))) return false;
      if (!terms.length) return true;
      const searchable = [
        row.catalogCode, row.sourceEvidenceId, row.evidenceId, row.sourceEvidenceCode,
        row.sourceFile, row.source, row.externalId, row.id, row.title, row.text,
        row.description, row.primaryProcess, row.process, ...(row.relatedProcesses || []),
        ...(row.processCandidates || []), row.locator, row.workProductType, row.itemType,
        row.type, row.evidenceRole, row.instanceId, row.instance,
        ...(row.instanceIds || []), ...(row.instanceNames || [])
      ].map(text).join(" ").toLowerCase();
      return terms.every(term => searchable.includes(term));
    });
  }

  function filterEvidenceRows(rows, filters = {}) {
    const attributes = Array.isArray(filters.attribute) ? filters.attribute : [filters.attribute];
    return filterEvidenceCatalog(rows, filters).filter(row => attributes.every(attribute => {
      if (!attribute || attribute === "all") return true;
      if (typeof attribute === "object") {
        const key = text(attribute.key);
        if (!key) return true;
        const value = row.attributes?.[key] ?? row.sourceItem?.attributes?.[key] ?? row[key];
        return text(value) === text(attribute.value);
      }
      const reviewed = row.reviewed === true;
      const locator = text(row.locator || row.sourceCell || row.sourceLocator).trim();
      if (attribute === "reviewed") return reviewed;
      if (attribute === "unreviewed") return !reviewed;
      if (attribute === "has-locator") return Boolean(locator);
      if (attribute === "missing-locator") return !locator;
      if (attribute === "visual") return Boolean(row.visualAssetIds?.length || row.visualAssetId || row.itemType === "image");
      return false;
    }));
  }

  root.AuditFlowEvidenceCatalog = Object.freeze({
    UNCLASSIFIED,
    WORK_PRODUCT_TYPES,
    normalizeProcessId,
    normalizeProcessIds,
    retainEvidenceItems,
    classifyWorkProduct,
    summarizeEvidenceRetention,
    buildEvidenceCatalog,
    filterEvidenceCatalog,
    filterEvidenceRows
  });
})(globalThis);
