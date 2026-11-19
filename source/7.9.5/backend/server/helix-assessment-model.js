(() => {
  "use strict";

  function text(value) {
    return String(value == null ? "" : value).normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function normalizeExternalId(value) {
    const id = text(value).toUpperCase();
    return /^(?:[A-Z][A-Z0-9]*[-_. ]+)?\d+[A-Z]?$|^[A-Z]+\d+[A-Z]?$/.test(id)
      ? id.replace(/[-_. ]/g, "")
      : "";
  }

  function sourceRecordId(link = {}) {
    const direct = text(link.recordId || link.sourceRecordId || link.helixRecordId);
    if (direct) return direct;
    const match = text(link.url).match(/[?&]recordid=([^&#]+)/i);
    if (!match) return "";
    try { return text(decodeURIComponent(match[1].replace(/\+/g, " "))); }
    catch (_) { return text(match[1]); }
  }

  function sourceNamespace(value) {
    const url = text(value);
    return /^ttstudio:\/\//i.test(url) ? url.split(/[?#]/, 1)[0].replace(/\/+$/, "").toLowerCase() : "";
  }

  function traceColumnProcesses(value) {
    const label = text(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (/^(?:CUS|CUSTOMER|SYS1)/.test(label)) return ["SYS.1"];
    if (/^(?:SYSA|SYSTEMARCHITECTURE|SYS3)/.test(label)) return ["SYS.3"];
    if (/^(?:SYSREQ|SYSTEMREQ|SYS2)|^SYS$/.test(label)) return ["SYS.2"];
    if (/^(?:SWDDHWDD)/.test(label)) return ["SWE.3", "HWE.2"];
    if (/^(?:SWDD|SWDETAILEDDESIGN|SOFTWAREDETAILEDDESIGN|SWE3)/.test(label)) return ["SWE.3"];
    if (/^SWAHWA/.test(label)) return ["SWE.2", "HWE.2"];
    if (/^(?:SWA|SOFTWAREARCHITECTURE|SWE2)/.test(label)) return ["SWE.2"];
    if (/^SWHWMEC/.test(label)) return ["SWE.1", "HWE.1"];
    if (/^(?:SWREQ|SOFTWAREREQ|SWE1|SWEREQ)|^SW$/.test(label)) return ["SWE.1"];
    if (/^(?:HWE1|HWREQ|HARDWAREREQ)/.test(label)) return ["HWE.1"];
    if (/^(?:HWE2|HWA|HWDD|HARDWAREARCHITECTURE)/.test(label)) return ["HWE.2"];
    if (/^(?:SYSTEST|SYSTEMTEST)/.test(label)) return ["SYS.5"];
    if (/^(?:SWTEST|SOFTWARETEST)/.test(label)) return ["SWE.6"];
    return [];
  }

  function buildTraceGraph({ columns = [], rows = [], sourceFile = "" } = {}) {
    const graph = {
      schema: "auditflow.trace-evidence.v2",
      sourceFile: text(sourceFile),
      columns: columns.map(text),
      nodes: [],
      links: [],
      resolutionSummary: { matched: 0, ambiguous: 0, unmatched: 0 }
    };
    if (!graph.columns.length) return graph;

    const spans = new Map();
    rows.forEach((row, index) => {
      const rowNumber = Number(row.rowNumber) || index + 2;
      const activeNodes = Array.from({ length: graph.columns.length }, () => []);
      const occupied = new Set(spans.keys());
      for (const [column, span] of spans) {
        activeNodes[column] = span.nodes;
        if (span.until === rowNumber) spans.delete(column);
      }

      let column = 0;
      for (const cell of row.cells || []) {
        while (column < graph.columns.length && occupied.has(column)) column += 1;
        if (column >= graph.columns.length) break;

        const cellText = text(cell.text);
        const cellNodes = [];
        (cell.links || []).forEach((link, linkIndex) => {
          const linkText = text(link.text);
          const externalId = normalizeExternalId(linkText);
          if (!externalId) return;
          const node = {
            key: `${column}:${rowNumber}:${linkIndex + 1}`,
            externalId,
            column: graph.columns[column] || `Column ${column + 1}`,
            columnIndex: column,
            rowNumber,
            linkText,
            url: text(link.url),
            recordId: sourceRecordId(link),
            locator: `Traceability Matrix · Row ${rowNumber} · Column ${column + 1}`,
            excerpt: cellText.slice(0, 220),
            matchStatus: "unmatched",
            matches: [],
            match: null
          };
          graph.nodes.push(node);
          cellNodes.push(node);
        });

        activeNodes[column] = cellNodes;
        const rowSpan = Math.max(1, Number(cell.rowSpan) || 1);
        if (rowSpan > 1) spans.set(column, { nodes: cellNodes, until: rowNumber + rowSpan - 1 });
        column += Math.max(1, Number(cell.colSpan) || 1);
      }

      for (let toColumn = 1; toColumn < activeNodes.length; toColumn += 1) {
        const fromNodes = activeNodes[toColumn - 1];
        const toNodes = activeNodes[toColumn];
        if (!fromNodes.length || !toNodes.length) continue;
        for (const from of fromNodes) {
          for (const to of toNodes) {
            graph.links.push({
              from: from.key,
              to: to.key,
              locator: `Traceability Matrix · Row ${rowNumber} · Columns ${toColumn}–${toColumn + 1}`,
              rowNumber,
              fromColumn: from.column,
              toColumn: to.column,
              status: "candidate",
              matchStatus: "unresolved",
              evidenceRole: "corroborating",
              basis: "adjacent-export-columns"
            });
          }
        }
      }
    });
    return graph;
  }

  const TRACE_COMPACT_SCHEMA = "auditflow.trace-evidence.compact.v1";
  const MATCH_STATUS_CODES = { unmatched: 0, matched: 1, ambiguous: 2 };
  const MATCH_STATUS_VALUES = ["unmatched", "matched", "ambiguous"];

  function packTraceGraph(graph) {
    if (!graph || typeof graph !== "object") return graph;
    if (graph.schema === TRACE_COMPACT_SCHEMA) return graph;
    const interned = [];
    const stringIds = new Map();
    const intern = value => {
      const normalized = value == null ? "" : typeof value === "string" ? value : String(value);
      if (stringIds.has(normalized)) return stringIds.get(normalized);
      const index = interned.length;
      interned.push(normalized);
      stringIds.set(normalized, index);
      return index;
    };
    const extra = (value, allowed) => {
      const fields = {};
      for (const [key, item] of Object.entries(value || {})) {
        if (allowed.has(key)) continue;
        fields[key] = item;
      }
      return Object.keys(fields).length ? intern(JSON.stringify(fields)) : -1;
    };
    const packMatch = match => {
      const allowed = new Set(["evidenceId", "itemId", "sourceFile", "locator", "title", "process", "evidenceRole", "excerpt", "matchKind", "linkDefinition"]);
      return [
        intern(match.evidenceId), intern(match.itemId), intern(match.sourceFile), intern(match.locator),
        intern(match.title), intern(match.process), intern(match.evidenceRole), intern(match.excerpt),
        intern(match.matchKind), intern(match.linkDefinition), extra(match, allowed)
      ];
    };
    const nodeColumns = new Map((graph.columns || []).map((column, index) => [String(column), index]));
    const nodes = (graph.nodes || []).map(node => {
      const allowed = new Set(["key", "externalId", "column", "columnIndex", "rowNumber", "linkText", "url", "recordId", "locator", "excerpt", "matchStatus", "matchCount", "matches", "match", "evidenceRole"]);
      const matches = Array.isArray(node.matches) ? node.matches : node.match && typeof node.match === "object" ? [node.match] : [];
      return [
        intern(node.key), intern(node.externalId), Number.isInteger(Number(node.columnIndex)) ? Number(node.columnIndex) : nodeColumns.get(String(node.column || "")) ?? -1,
        Number.isFinite(Number(node.rowNumber)) ? Number(node.rowNumber) : -1,
        intern(node.linkText), intern(node.url), intern(node.recordId), intern(node.locator), intern(node.excerpt),
        MATCH_STATUS_CODES[node.matchStatus] ?? 0, Math.max(0, Math.min(100, Number(node.matchCount) || matches.length)),
        matches.slice(0, 8).map(packMatch), extra(node, allowed)
      ];
    });
    const links = (graph.links || []).map(link => {
      const allowed = new Set(["from", "to", "rowNumber", "fromColumn", "toColumn", "locator", "status", "matchStatus", "evidenceRole", "basis", "fromMatch", "toMatch"]);
      return [
        intern(link.from), intern(link.to), Number.isFinite(Number(link.rowNumber)) ? Number(link.rowNumber) : -1,
        intern(link.fromColumn), intern(link.toColumn), intern(link.locator), intern(link.status),
        MATCH_STATUS_CODES[link.matchStatus] ?? 0, intern(link.basis), extra(link, allowed)
      ];
    });
    const metadata = {};
    for (const [key, value] of Object.entries(graph)) {
      if (["schema", "nodes", "links", "sourceFile", "columns", "resolutionSummary"].includes(key)) continue;
      metadata[key] = value;
    }
    return {
      schema: TRACE_COMPACT_SCHEMA,
      sourceFile: text(graph.sourceFile),
      columns: (graph.columns || []).map(text),
      resolutionSummary: graph.resolutionSummary && typeof graph.resolutionSummary === "object" ? { ...graph.resolutionSummary } : { matched: 0, ambiguous: 0, unmatched: 0 },
      strings: interned,
      nodes,
      links,
      ...(Object.keys(metadata).length ? { metadata } : {})
    };
  }

  function unpackTraceGraph(graph) {
    if (!graph || typeof graph !== "object" || graph.schema !== TRACE_COMPACT_SCHEMA) return graph;
    const strings = Array.isArray(graph.strings) ? graph.strings : [];
    const get = index => Number.isInteger(index) && index >= 0 ? strings[index] || "" : "";
    const unpackExtra = index => {
      if (!Number.isInteger(index) || index < 0) return {};
      try {
        const parsed = JSON.parse(get(index));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch (_) { return {}; }
    };
    const unpackMatch = row => ({
      ...unpackExtra(row[10]),
      evidenceId: get(row[0]), itemId: get(row[1]), sourceFile: get(row[2]), locator: get(row[3]), title: get(row[4]),
      process: get(row[5]), evidenceRole: get(row[6]) || "corroborating", excerpt: get(row[7]),
      ...(get(row[8]) ? { matchKind: get(row[8]) } : {}), ...(get(row[9]) ? { linkDefinition: get(row[9]) } : {})
    });
    const nodes = (graph.nodes || []).map(row => {
      const column = graph.columns?.[row[2]] || "";
      const matches = (row[11] || []).map(unpackMatch);
      const node = {
        ...unpackExtra(row[12]),
        key: get(row[0]), externalId: get(row[1]), column, columnIndex: row[2], rowNumber: row[3],
        linkText: get(row[4]), url: get(row[5]), recordId: get(row[6]), locator: get(row[7]), excerpt: get(row[8]),
        matchStatus: MATCH_STATUS_VALUES[row[9]] || "unmatched", matchCount: row[10], matches,
        match: MATCH_STATUS_VALUES[row[9]] === "matched" && matches.length === 1 ? matches[0] : null,
        evidenceRole: "corroborating"
      };
      return node;
    });
    const nodeByKey = new Map(nodes.map(node => [node.key, node]));
    const links = (graph.links || []).map(row => {
      const from = get(row[0]);
      const to = get(row[1]);
      const fromNode = nodeByKey.get(from);
      const toNode = nodeByKey.get(to);
      const link = {
        ...unpackExtra(row[9]),
        from, to, rowNumber: row[2], fromColumn: get(row[3]), toColumn: get(row[4]), locator: get(row[5]),
        status: get(row[6]), matchStatus: MATCH_STATUS_VALUES[row[7]] || "unmatched", basis: get(row[8]),
        evidenceRole: "corroborating",
        fromMatch: fromNode?.match || null,
        toMatch: toNode?.match || null
      };
      return link;
    });
    return {
      ...(graph.metadata && typeof graph.metadata === "object" ? graph.metadata : {}),
      schema: "auditflow.trace-evidence.v2",
      sourceFile: graph.sourceFile || "",
      columns: (graph.columns || []).slice(),
      resolutionSummary: graph.resolutionSummary && typeof graph.resolutionSummary === "object" ? { ...graph.resolutionSummary } : { matched: 0, ambiguous: 0, unmatched: 0 },
      nodes,
      links
    };
  }

  function resolveTraceGraph(graph, sources = []) {
    graph = unpackTraceGraph(graph);
    const index = new Map();
    const recordIndex = new Map();
    const recordIndexById = new Map();
    const addIndexEntry = (externalId, recordId, url, entry) => {
      const identity = { ...entry, namespace: sourceNamespace(url), recordId: text(recordId) };
      const normalized = normalizeExternalId(externalId);
      if (normalized) {
        const entries = index.get(normalized) || [];
        entries.push(identity);
        index.set(normalized, entries);
      }
      const normalizedRecordId = text(recordId);
      if (normalizedRecordId) {
        const all = recordIndexById.get(normalizedRecordId) || [];
        all.push(identity);
        recordIndexById.set(normalizedRecordId, all);
      }
      if (normalizedRecordId && identity.namespace) {
        const entries = recordIndex.get(normalizedRecordId) || [];
        entries.push(identity);
        recordIndex.set(normalizedRecordId, entries);
      }
    };
    for (const source of sources) {
      const evidenceId = text(source.evidenceId);
      if (!evidenceId) continue;
      for (const item of source.items || []) {
        const externalId = normalizeExternalId(item.externalId || item.number || item.id);
        const url = item.sourceUrl || item.url;
        const itemRecordId = sourceRecordId({ ...item, url });
        const locator = text(item.locator || item.sourceLocator);
        if ((!externalId && !itemRecordId) || !locator) continue;
        const processes = [...new Set([
          item.process, item.primaryProcess, ...(item.primaryProcesses || []), ...(source.primaryProcesses || [])
        ].filter(value => /^[A-Z]+\.\d+$/.test(value || "")))];
        const entry = {
          evidenceId,
          evidenceCode: text(source.evidenceCode),
          itemId: text(item.itemId || item.id),
          sourceFile: text(item.sourceFile || source.sourceFile),
          version: text(item.sourceVersion || item.fields?.version || item.fields?.revision || source.version),
          locator,
          title: text(item.title || item.summary || item.name),
          process: processes.length === 1 ? processes[0] : "",
          processes,
          evidenceRole: "corroborating",
          excerpt: text(item.excerpt || item.text || item.description).slice(0, 360)
        };
        addIndexEntry(externalId, itemRecordId, url, entry);
        const testCase = item.testCase || item;
        for (const requirement of testCase.traceability?.requirementLinks || testCase.requirementLinks || []) {
          const requirementId = text(requirement.externalId || requirement.number || requirement.id);
          const requirementRecordId = text(requirement.sourceRecordId || requirement.recordId || sourceRecordId({ url: requirement.url }));
          if (!requirementId && !requirementRecordId) continue;
          addIndexEntry(requirementId, requirementRecordId, requirement.url, {
            ...entry,
            matchKind: "test-case-requirement-link",
            linkDefinition: text(requirement.linkDefinition || requirement.relation),
            title: text(requirement.title || requirement.summary || entry.title),
            locator: text(requirement.locator || entry.locator),
            processes: traceColumnProcesses(requirement.type)
          });
        }
      }
    }

    const nodes = (graph?.nodes || []).map(node => {
      const externalId = normalizeExternalId(node.externalId);
      const namespace = sourceNamespace(node.url);
      const columnProcesses = traceColumnProcesses(node.column);
      const recordCandidates = recordIndexById.get(text(node.recordId)) || [];
      const recordMatches = namespace
        ? (recordIndex.get(text(node.recordId)) || []).filter(entry => entry.namespace === namespace)
        : recordCandidates.filter(entry => !entry.namespace);
      if (namespace && recordMatches.length === 0) {
        const unscoped = recordCandidates.filter(entry => !entry.namespace);
        if (unscoped.length === 1 && recordCandidates.filter(entry => entry.namespace).length === 0) recordMatches.push(unscoped[0]);
      }
      const externalMatches = (index.get(externalId) || []).filter(entry => {
        if (namespace && entry.namespace && namespace !== entry.namespace) return false;
        if (node.recordId && entry.recordId && node.recordId !== entry.recordId) return false;
        if (!/^\d/.test(externalId)) return true;
        return columnProcesses.length > 0 && entry.processes.length > 0 && entry.processes.some(process => columnProcesses.includes(process));
      });
      const direct = recordMatches.filter(entry => !entry.matchKind);
      const distinct = entries => [...new Map(entries.map(({ namespace, recordId, processes, ...entry }) => [`${entry.evidenceId}|${entry.itemId}|${entry.locator}`, entry])).values()];
      const matches = distinct(direct.length ? direct : externalMatches.filter(entry => !entry.matchKind));
      const references = distinct([...recordMatches, ...externalMatches].filter(entry => entry.matchKind));
      const matchStatus = matches.length === 1 ? "matched" : matches.length ? "ambiguous" : "unmatched";
      return {
        ...node,
        matchStatus,
        matchCount: matches.length,
        matches: matches.slice(0, 8),
        match: matches.length === 1 ? matches[0] : null,
        ...(references.length ? { testReferences: references.slice(0, 8), testReferenceCount: references.length } : {})
      };
    });
    const nodeByKey = new Map(nodes.map(node => [node.key, node]));
    const links = (graph?.links || []).map(link => {
      const from = nodeByKey.get(link.from);
      const to = nodeByKey.get(link.to);
      const endpoints = [from, to].filter(Boolean);
      const matchStatus = endpoints.length !== 2 || endpoints.some(node => node.matchStatus === "unmatched")
        ? "unmatched"
        : endpoints.some(node => node.matchStatus === "ambiguous")
          ? "ambiguous"
          : "matched";
      return {
        ...link,
        status: matchStatus === "matched" ? "matched-corroborating" : matchStatus,
        matchStatus,
        evidenceRole: "corroborating",
        fromMatch: from?.match || null,
        toMatch: to?.match || null
      };
    });

    return {
      ...graph,
      schema: "auditflow.trace-evidence.v2",
      nodes,
      links,
      resolutionSummary: nodes.reduce((summary, node) => {
        summary[node.matchStatus] = (summary[node.matchStatus] || 0) + 1;
        return summary;
      }, { matched: 0, ambiguous: 0, unmatched: 0 })
    };
  }

  function buildTraceGraphAiContext(value, { targetProcesses = [], targetExternalIds = [], targetItems = [], maxNodes = 72, maxLinks = 96 } = {}) {
    const graph = unpackTraceGraph(value);
    if (!graph?.nodes?.length) return null;
    const processes = new Set(targetProcesses.filter(process => /^[A-Z]+\.\d+$/.test(process)));
    const externalIds = new Set(targetExternalIds.map(normalizeExternalId).filter(id => id && !/^\d/.test(id)));
    const itemKeys = new Set(targetItems.filter(item => item.evidenceId && item.itemId).map(item => `${item.evidenceId}|${item.itemId}`));
    const recordKeys = new Set(targetItems.filter(item => item.sourceRecordId && sourceNamespace(item.sourceUrl))
      .map(item => `${sourceNamespace(item.sourceUrl)}|${item.sourceRecordId}`));
    if (!processes.size && !externalIds.size && !itemKeys.size && !recordKeys.size) return null;
    const nodeLimit = Math.max(2, Math.min(80, Number(maxNodes) || 72));
    const linkLimit = Math.max(1, Math.min(120, Number(maxLinks) || 96));
    const nodeByKey = new Map(graph.nodes.map(node => [node.key, node]));
    const neighborKeys = new Map();
    for (const link of graph.links || []) {
      if (!nodeByKey.has(link.from) || !nodeByKey.has(link.to)) continue;
      if (!neighborKeys.has(link.from)) neighborKeys.set(link.from, new Set());
      if (!neighborKeys.has(link.to)) neighborKeys.set(link.to, new Set());
      neighborKeys.get(link.from).add(link.to);
      neighborKeys.get(link.to).add(link.from);
    }
    const priority = node => {
      if ([...(node.matches || (node.match ? [node.match] : [])), ...(node.testReferences || [])].some(match => itemKeys.has(`${match.evidenceId}|${match.itemId}`))) return 4;
      if (node.recordId && recordKeys.has(`${sourceNamespace(node.url)}|${node.recordId}`)) return 4;
      if (externalIds.has(normalizeExternalId(node.externalId))) return 3;
      if ([node.process, node.match?.process, ...traceColumnProcesses(node.column)].some(process => processes.has(process))) return node.matchStatus === "matched" ? 2 : 1;
      return 0;
    };
    const seedsByPriority = [[], [], [], [], []];
    for (const node of graph.nodes) {
      const rank = priority(node);
      if (rank) seedsByPriority[rank].push(node.key);
    }
    const seeds = seedsByPriority.reverse().flat();
    if (!seeds.length) return null;
    const selected = new Set(seeds.slice(0, Math.max(1, Math.floor(nodeLimit / 3))));
    const queue = [...selected];
    for (let index = 0; index < queue.length && selected.size < nodeLimit; index += 1) {
      for (const neighbor of neighborKeys.get(queue[index]) || []) {
        if (selected.has(neighbor)) continue;
        selected.add(neighbor);
        queue.push(neighbor);
        if (selected.size === nodeLimit) break;
      }
    }
    for (const key of seeds) {
      if (selected.size === nodeLimit) break;
      selected.add(key);
    }
    const clip = (value, size) => text(value).slice(0, size);
    const reduceMatch = match => ({
      evidenceId: clip(match.evidenceId, 96), evidenceCode: clip(match.evidenceCode, 64), itemId: clip(match.itemId, 96),
      sourceFile: clip(match.sourceFile, 180), locator: clip(match.locator, 180), version: clip(match.version, 80),
      ...(match.linkDefinition ? { linkDefinition: clip(match.linkDefinition, 100) } : {}),
      evidenceRole: "corroborating"
    });
    const nodes = [...selected].map(key => {
      const node = nodeByKey.get(key);
      const candidateProcesses = traceColumnProcesses(node.column);
      const match = node.match;
      const process = candidateProcesses.length === 1 ? candidateProcesses[0] : candidateProcesses.includes(match?.process) ? match.process : "";
      return {
        key, externalId: clip(node.externalId || node.linkText, 96), column: clip(node.column, 100),
        process, rowNumber: node.rowNumber, locator: clip(node.locator, 180), excerpt: clip(node.excerpt, 220),
        matchStatus: node.matchStatus || "unmatched", matchCount: Number(node.matchCount) || (node.matches || []).length || Number(!!match),
        ...(match ? { match: reduceMatch(match) } : {}),
        ...(node.matchStatus === "ambiguous" ? { matches: (node.matches || []).slice(0, 4).map(reduceMatch) } : {}),
        ...(node.testReferences?.length ? { testReferences: node.testReferences.slice(0, 4).map(reduceMatch) } : {}),
        evidenceRole: "corroborating"
      };
    });
    const linked = new Map(nodes.map(node => [node.key, node]));
    const links = [];
    let omittedLinks = false;
    for (const link of graph.links || []) {
      const from = linked.get(link.from);
      const to = linked.get(link.to);
      if (!from || !to) { if (from || to) omittedLinks = true; continue; }
      if (links.length >= linkLimit) { omittedLinks = true; continue; }
      links.push({
        from: from.key, to: to.key, fromExternalId: from.externalId, toExternalId: to.externalId,
        fromColumn: from.column, toColumn: to.column, fromProcess: from.process, toProcess: to.process,
        rowNumber: link.rowNumber, locator: clip(link.locator || from.locator || to.locator, 180),
        status: link.status || "candidate",
        matchStatus: ["matched", "ambiguous", "unmatched"].includes(link.matchStatus)
          ? link.matchStatus
          : link.status === "matched-corroborating" ? "matched" : link.status === "ambiguous" ? "ambiguous" : "unmatched",
        evidenceRole: "corroborating"
      });
    }
    return {
      schema: "auditflow.trace-evidence.v2", sourceFile: clip(graph.sourceFile, 180),
      columns: graph.columns.slice(0, 24).map(column => clip(column, 100)),
      resolutionSummary: graph.resolutionSummary, targetProcesses: [...processes],
      totalNodes: graph.nodes.length, totalLinks: graph.links.length,
      nodes, links, truncated: omittedLinks || seeds.some(key => !selected.has(key)), evidenceRole: "corroborating"
    };
  }

  function normalizeTestCaseRecord(record = {}) {
    const fields = record.fields && typeof record.fields === "object" ? record.fields : {};
    const relatedItems = Array.isArray(record.relatedItems) ? record.relatedItems : [];
    const steps = Array.isArray(record.steps) ? record.steps : [];
    const conditions = Object.fromEntries(Object.entries(record.conditions || {}).map(([key, value]) => [
      key,
      typeof value === "object" && value !== null
        ? { label: text(value.label || key), value: text(value.value) }
        : { label: text(key), value: text(value) }
    ]));
    const requirementLinks = relatedItems.filter(item =>
      /requirement|tested by|verifies|verification of/i.test(`${item.linkDefinition || ""} ${item.relation || ""} ${item.type || ""}`)
    );
    const has = value => Boolean(text(value));
    const stepsWithExpectedResult = steps.filter(step => has(step.expectedResult)).length;
    const missingStepResults = steps.length - stepsWithExpectedResult;
    const hasAnyExpectedResult = stepsWithExpectedResult > 0 || has(fields.expectedResults);
    const hasExpectedResult = steps.length
      ? missingStepResults === 0
      : has(fields.expectedResults) || has(fields.verificationCriteria);
    const checklist = [
      ["identity", "Test case identity", Boolean(record.externalId || record.id)],
      ["requirement-link", "Requirement traceability", requirementLinks.length > 0 || has(fields.relatedRequirements)],
      ["coverage", "Requirement coverage", null],
      ["conditions", "Test conditions", Object.keys(conditions).length > 0],
      ["setup", "Test setup or environment", has(fields.setup) || has(fields.testEnvironment) || has(conditions.dut?.value)],
      ["method", "Test method", has(fields.methods || fields.testMethods)],
      ["steps", "Executable test steps", steps.some(step => has(step.action))],
      ["expected-results", "Expected results or pass criteria", hasExpectedResult],
      ["boundary-coverage", "Boundary coverage", null],
      ["workflow-review", "Workflow review state", (record.workflow || []).length > 0],
      ["execution", "Execution result evidence", Boolean(record.execution)]
    ].map(([id, label, present]) => ({
      id,
      label,
      state: id === "execution" && !present ? "not-included"
        : present === null ? "needs-review"
        : id === "expected-results" && missingStepResults > 0 && hasAnyExpectedResult ? "partial"
          : present ? "present" : "missing",
      interpretation: id === "execution" && !present
        ? "A specification or workflow history does not prove test execution."
        : id === "coverage"
          ? "Coverage must be compared with the linked requirement and its approved verification criteria."
          : id === "boundary-coverage"
            ? "Boundary coverage must be verified against requirement limits and the project test strategy."
            : ""
    }));

    const identity = {
      id: text(record.externalId || record.id),
      recordId: text(record.sourceRecordId || record.recordId),
      sourceUrl: text(record.sourceUrl || record.url),
      number: text(record.number),
      title: text(record.title || fields.title),
      revision: text(fields.revision || fields.version || fields.baseline)
    };
    const content = {
      purpose: text(fields.purpose || fields.objective || ""),
      scope: text(fields.scope),
      verificationCriteria: text(fields.verificationCriteria || fields.passFailCriteria || fields.expectedResults),
      methods: text(fields.methods || fields.testMethods),
      configuration: {
        type: text(fields.type || fields.testType),
        priority: text(fields.priority),
        estimatedRunTime: text(fields.estimatedRunTime),
        software: conditions.software?.value || "",
        reuse: text(fields.reuse),
        automated: text(fields.automated)
      },
      environment: {
        setup: text(fields.setup),
        testEnvironment: text(fields.testEnvironment),
        equipment: text(fields.equipment || fields.instrumentation),
        conditions
      },
      steps: steps.map(step => ({
        number: text(step.number),
        action: text(step.action),
        testData: text(step.testData),
        expectedResult: text(step.expectedResult),
        locator: text(step.locator)
      })),
      expectedResults: text(fields.expectedResults)
    };
    const traceability = {
      relatedItems: relatedItems.map(item => ({ ...item })),
      requirementLinks: requirementLinks.map(item => ({ ...item })),
      linkDefinitions: (record.linkDefinitions || []).map(definition => ({ ...definition }))
    };
    const workflow = {
      status: text(fields.status),
      owner: text(fields.owner || fields.assignedTo || fields.team),
      reviewer: text(fields.reviewer),
      version: text(fields.version || fields.revision),
      team: text(fields.team),
      assignment: {
        assignee: text(record.assignment?.assignee || fields.assignedTo || fields.assignee || fields.assignTo),
        assigner: text(record.assignment?.assigner || fields.assignedBy || fields.assigner || fields.assignBy),
        team: text(record.assignment?.team || fields.team),
        updatedAt: text(record.assignment?.updatedAt)
      },
      history: (record.workflow || []).map(item => ({ ...item }))
    };
    const execution = record.execution || null;

    return {
      ...record,
      title: text(record.title || fields.title || record.externalId || record.id),
      schema: "auditflow.test-case.v2",
      reviewDiscipline: "verification",
      evidenceRole: "corroborating",
      testCase: {
        identity,
        content,
        traceability,
        workflow,
        execution,
        purpose: content.purpose,
        scope: content.scope,
        verificationCriteria: content.verificationCriteria,
        configuration: content.configuration,
        environment: content.environment,
        steps: content.steps,
        expectedResults: content.expectedResults,
        relatedItems: traceability.relatedItems,
        requirementLinks: traceability.requirementLinks,
        governance: { ...workflow, workflow: workflow.history }
      },
      reviewChecklist: checklist
    };
  }

  function normalizeRequirementRecord(record = {}) {
    const fields = record.fields && typeof record.fields === "object" ? record.fields : {};
    const links = Array.isArray(record.links) ? record.links : Array.isArray(record.relatedItems) ? record.relatedItems : [];
    const history = Array.isArray(record.workflow) ? record.workflow : [];
    const content = {
      statement: text(fields.statement || fields.requirement || fields.requirementText || fields.description || record.description),
      rationale: text(fields.rationale),
      preconditions: text(fields.preconditions || fields.precondition),
      conditions: text(fields.conditions || fields.condition),
      constraints: text(fields.constraints || fields.constraint),
      verificationMethod: text(fields.verificationMethod),
      verificationCriteria: text(fields.verificationCriteria || fields.passFailCriteria),
      source: text(fields.source || fields.origin),
      category: text(fields.category || fields.requirementType || fields.type)
    };
    const traceability = { links: links.map(item => ({ ...item })) };
    const governance = {
      status: text(fields.status),
      owner: text(fields.owner || fields.assignedTo || fields.team),
      approver: text(fields.approver || fields.approvedBy),
      version: text(fields.version || fields.revision),
      baseline: text(fields.baseline),
      history: history.map(item => ({ ...item }))
    };
    const has = value => Boolean(text(value));
    const checklist = [
      ["identity", "Requirement identity", Boolean(record.externalId || record.id)],
      ["statement", "Requirement statement", has(content.statement)],
      ["verifiability", "Verification criteria", has(content.verificationCriteria)],
      ["conditions", "Conditions and constraints", has(content.preconditions || content.conditions || content.constraints)],
      ["traceability", "Related-item traceability", traceability.links.length > 0],
      ["governance", "Status and version", has(governance.status) && has(governance.version || governance.baseline)]
    ].map(([id, label, present]) => ({ id, label, state: present ? "present" : "missing" }));
    return {
      ...record,
      schema: "auditflow.requirement.v1",
      reviewDiscipline: "requirement",
      evidenceRole: "corroborating",
      requirement: {
        identity: {
          id: text(record.externalId || record.id),
          sourceRecordId: text(record.sourceRecordId || record.recordId),
          sourceUrl: text(record.sourceUrl || record.url),
          title: text(record.title || fields.title),
          revision: text(fields.version || fields.revision)
        },
        content,
        traceability,
        governance
      },
      reviewChecklist: checklist
    };
  }

  function helixHtmlFieldKey(label) {
    return text(label).toLowerCase().replace(/&/g, " and ")
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function helixHtmlCellField(cell) {
    if (!cell) return null;
    const dataNode = cell.querySelector(".ReportDetailRowDataClass");
    if (dataNode) {
      const clone = cell.cloneNode(true);
      clone.querySelectorAll(".ReportDetailRowDataClass").forEach(node => node.remove());
      const label = text(clone.textContent).replace(/[:：]\s*$/, "");
      const value = text(dataNode.textContent);
      return label ? { label, value } : null;
    }
    const raw = text(cell.textContent);
    const separator = raw.search(/[:：]/);
    if (separator < 0) return raw ? { label: raw, value: "" } : null;
    return { label: text(raw.slice(0, separator)), value: text(raw.slice(separator + 1)) };
  }

  function parseHelixTestCaseHtml(doc) {
    const aliases = {
      summary: "title", scope: "scope", verification_criteria: "verificationCriteria",
      test_conditions: "conditions", test_setup: "setup", test_methods: "methods", methods: "methods",
      expected_results: "expectedResults", status: "status", type: "type", priority: "priority",
      estimated_run_time: "estimatedRunTime", team: "team", assign_to: "assignedTo", assigned_to: "assignedTo",
      assign_by: "assignedBy", assigned_by: "assignedBy", re_use: "reuse", automated_test: "automated",
      test_case_revision: "revision", version: "version", baseline: "baseline", link_definition: "linkDefinition",
      equipment: "equipment", instrumentation: "instrumentation", test_environment: "testEnvironment",
      purpose: "purpose", objective: "objective", feature_lists: "features", view_mode: "viewMode", date_modified: "modifiedAt"
    };
    const conditionKeys = {
      supply_voltages_v: "supplyVoltage", temperature_c: "temperature", speed_rpm: "speed",
      load_cnm: "load", range: "range", dut: "dut", nr_of_dut: "dutCount", software: "software", other: "other"
    };
    const records = [];
    const clean = node => text(node?.textContent);
    let record = null;
    let section = "";
    let event = null;
    let linkDefinition = "";
    [...doc.querySelectorAll("tr")].forEach((row, index) => {
      const cells = [...row.cells];
      if (!cells.length) return;
      const nested = cells.some(cell => cell.querySelector("table"));
      if (nested && !row.classList.contains("ReportDetailRowTitleClass")) return;
      const values = cells.map(clean);
      const start = cells[0].classList.contains("ReportHeaderRowClass") && values[0].match(/^Test Case Number:\s*(\S+)/i);
      if (start) {
        const externalId = /^TC[-_]/i.test(start[1]) ? start[1] : `TC-${start[1]}`;
        const headerLink = cells[0].querySelector("a[href]");
        const sourceUrl = headerLink?.getAttribute("href") || "";
        record = {
          id: `${externalId}-${index + 1}`, externalId, number: start[1], sourceRecordId: sourceRecordId({ url: sourceUrl }), sourceUrl,
          locator: `Helix HTML · Row ${index + 1} · ${externalId}`, fields: {}, conditions: {}, steps: [],
          relatedItems: [], linkDefinitions: [], workflow: [], execution: null
        };
        record.assignment = { assignee: "", assigner: "", team: "", updatedAt: "" };
        records.push(record);
        section = "";
        event = null;
        linkDefinition = "";
        return;
      }
      if (!record) return;
      const locator = `Helix HTML · Row ${index + 1} · ${record.externalId}`;
      if (/^step\s*#/i.test(values[0]) && /expected result/i.test(values[2] || "")) { section = "steps"; return; }
      if (/^related items$/i.test(values[0].replace(/:\s*$/, "")) && values.includes("Number")) { section = "related"; return; }
      if (/^links:?$/i.test(values[0])) { section = "links"; return; }
      if (/^workflow events:\s*$/i.test(values[0])) { section = "workflow"; return; }
      if (row.classList.contains("ReportDetailRowHeaderClass")) { section = ""; return; }
      const definition = cells[0].classList.contains("ReportDetailRowTitleClass") && helixHtmlCellField(cells[0]);
      if (/^link definition$/i.test(definition?.label || "")) {
        linkDefinition = definition.value || "";
        section = "links";
        if (linkDefinition) record.linkDefinitions.push({ type: linkDefinition, locator });
        return;
      }
      if (section === "steps" && row.classList.contains("ReportDetailRowDataClass") && /^\d+$/.test(values[0]) && cells.length >= 3) {
        record.steps.push({ number: values[0], action: values[1], expectedResult: values[2], locator });
        return;
      }
      if (section === "related" && row.classList.contains("ReportDetailRowDataClass") && values[1] && values[2] && cells.length >= 6) {
        const itemLink = cells[2]?.querySelector("a[href]") || cells[4]?.querySelector("a[href]");
        const url = itemLink?.getAttribute("href") || "";
        record.relatedItems.push({ relation: values[1], linkDefinition, externalId: values[2], number: values[2], type: values[3], title: values[4], status: values[5], sourceRecordId: sourceRecordId({ url }), url, locator });
        return;
      }
      if (row.classList.contains("ReportDetailRowTitleClass") && /^test conditions:\s*$/i.test(values[0])) {
        for (const condition of cells[1]?.querySelectorAll("tr") || []) {
          const [label, value] = [...condition.cells].map(clean);
          const field = helixHtmlFieldKey(label);
          if (field && value) record.conditions[conditionKeys[field] || field] = { label, value };
        }
      }
      if (nested) return;
      if (section === "workflow") {
        const pairs = cells.map(helixHtmlCellField);
        const assigner = pairs.find(pair => /^assign by$/i.test(pair?.label || ""));
        const assignee = pairs.find(pair => /^assign to$/i.test(pair?.label || ""));
        if (assigner || assignee) {
          if (assigner?.value) record.assignment.assigner = assigner.value;
          if (assignee?.value) record.assignment.assignee = assignee.value;
          record.assignment.updatedAt = pairs.find(pair => /^date$/i.test(pair?.label || ""))?.value || record.assignment.updatedAt;
          if (assigner?.value || assignee?.value) record.workflow.push({ event: "Assignment", actor: assigner?.value || "", assigner: assigner?.value || "", assignee: assignee?.value || "", date: record.assignment.updatedAt, notes: "", locator });
          return;
        }
        const actor = pairs.find(pair => /\bby$/i.test(pair?.label || ""));
        if (actor) {
          event = { event: actor.label.replace(/\s+by$/i, ""), actor: actor.value, assignee: pairs.find(pair => /^assign to$/i.test(pair?.label || ""))?.value || "", date: pairs.find(pair => /^date$/i.test(pair?.label || ""))?.value || "", notes: "", locator };
          record.workflow.push(event);
        } else if (event && /^(notes|reason):\s*$/i.test(values[0])) event.notes = values[1] || "";
        return;
      }
      cells.forEach((cell, column) => {
        if (!cell.classList.contains("ReportDetailRowTitleClass") && !row.classList.contains("ReportDetailRowTitleClass")) return;
        const field = helixHtmlCellField(cell);
        const key = aliases[helixHtmlFieldKey(field?.label || values[column].replace(/:\s*$/, ""))];
        const next = cells[column + 1];
        const value = field?.value || (next?.classList.contains("ReportDetailRowDataClass") ? values[column + 1] : "");
        if (key && value) record.fields[key] ||= value;
      });
    });
    return records.map(record => normalizeTestCaseRecord({
      ...record,
      title: record.fields.title || record.externalId,
      status: record.fields.status || "candidate",
      description: [record.fields.scope, record.fields.verificationCriteria, record.fields.expectedResults].filter(Boolean).join(" · ")
    }));
  }

  function parseHelixRequirementHtml(doc, fileName) {
    const aliases = {
      summary: "title", title: "title", description: "statement", requirement: "statement",
      requirement_text: "statement", statement: "statement", rationale: "rationale", justification: "rationale",
      precondition: "preconditions", preconditions: "preconditions", conditions: "conditions", constraints: "constraints",
      verification_criteria: "verificationCriteria", verification_method: "verificationMethod", source: "source",
      category: "category", type: "category", status: "status", state: "status", owner: "owner",
      assigned_to: "assignedTo", approved_by: "approver", approver: "approver", version: "version", revision: "revision", baseline: "baseline"
    };
    const records = [];
    let current = null;
    let section = "fields";
    const flush = () => {
      if (!current) return;
      const fields = current.fields;
      const externalId = current.externalId || fields.requirementTag || fields.requirementId || fields.requirementNumber || "";
      records.push(normalizeRequirementRecord({
        ...current,
        id: externalId || `REQ-HTML-${String(records.length + 1).padStart(4, "0")}`,
        externalId,
        title: fields.title || externalId,
        description: fields.statement || "",
        sourceFile: fileName
      }));
      current = null;
      section = "fields";
    };
    [...doc.querySelectorAll("tr")].forEach((row, index) => {
      const cells = [...row.cells];
      if (!cells.length) return;
      if (cells.some(cell => cell.querySelector("table")) && !row.classList.contains("ReportDetailRowTitleClass")) return;
      const values = cells.map(cell => text(cell.textContent));
      const startCell = cells.find(cell => cell.classList.contains("ReportHeaderRowClass"));
      const start = startCell ? text(startCell.textContent).match(/^(?:Requirement|Requirement Tag|Requirement Number|Requirement ID|Req(?:uirement)?\s*(?:Number|No\.?|Tag|ID))\s*:\s*(\S+)/i) : null;
      if (start) {
        flush();
        const anchor = cells.flatMap(cell => [...(cell.querySelectorAll?.("a[href]") || [])]).find(Boolean);
        const url = anchor?.getAttribute("href") || "";
        current = {
          id: `REQ-${start[1]}-${index + 1}`, externalId: start[1], sourceRecordId: sourceRecordId({ url }), sourceUrl: url,
          locator: `Helix Requirement HTML · Row ${index + 1}`, fields: {}, links: [], workflow: []
        };
        current.fields.requirementNumber = start[1];
        return;
      }
      if (!current) return;
      const first = values[0].replace(/[:：\s]+$/, "");
      if (/^related items?$/i.test(first) && values.some(value => /^number$/i.test(value))) { section = "links"; return; }
      if (/^workflow events?:?$/i.test(first)) { section = "workflow"; return; }
      if (row.classList.contains("ReportDetailRowHeaderClass")) { if (section !== "links" && section !== "workflow") section = "fields"; return; }
      const locator = `Helix Requirement HTML · Row ${index + 1} · ${current.externalId}`;
      if (section === "links" && row.classList.contains("ReportDetailRowDataClass") && cells.length >= 4) {
        const anchor = cells.flatMap(cell => [...(cell.querySelectorAll?.("a[href]") || [])]).find(Boolean);
        const url = anchor?.getAttribute("href") || "";
        current.links.push({
          relation: values[1] || "Related item", linkDefinition: values[1] || "", externalId: values[2] || text(anchor?.textContent),
          type: values[3] || "", title: values[4] || "", status: values[5] || "", sourceRecordId: sourceRecordId({ url }), url, locator
        });
        return;
      }
      if (section === "workflow") {
        const pairs = cells.map(helixHtmlCellField);
        const actor = pairs.find(pair => /\bby$/i.test(pair?.label || ""));
        if (actor) current.workflow.push({ event: actor.label.replace(/\s+by$/i, ""), actor: actor.value, date: pairs.find(pair => /^date$/i.test(pair?.label || ""))?.value || "", locator });
        return;
      }
      cells.forEach((cell, column) => {
        if (!cell.classList.contains("ReportDetailRowTitleClass") && !row.classList.contains("ReportDetailRowTitleClass")) return;
        const pair = helixHtmlCellField(cell);
        const key = aliases[helixHtmlFieldKey(pair?.label || "")];
        const value = pair?.value || (cells[column + 1]?.classList.contains("ReportDetailRowDataClass") ? values[column + 1] : "");
        if (key && value) current.fields[key] ||= value;
      });
    });
    flush();
    return records;
  }

  function buildHelixTraceGraphFromTable(matrix, fileName) {
    const rows = [...(matrix?.rows || [])];
    const headerIndex = rows.findIndex(row => [...row.cells].filter(cell => cell.classList.contains("columnHeading") || cell.tagName === "TH").length >= 2);
    const columns = headerIndex < 0 ? [] : [...rows[headerIndex].cells].map(cell => text(cell.textContent));
    if (!columns.length) return { schema: "auditflow.trace-evidence.v2", sourceFile: fileName, columns, nodes: [], links: [], resolutionSummary: { matched: 0, ambiguous: 0, unmatched: 0 } };
    return buildTraceGraph({
      sourceFile: fileName, columns,
      rows: rows.slice(headerIndex + 1).map((row, index) => ({
        rowNumber: index + headerIndex + 2,
        cells: [...row.cells].map(cell => ({
          text: text(cell.textContent),
          rowSpan: Number(cell.getAttribute?.("rowspan") || cell.rowSpan || 1),
          colSpan: Number(cell.getAttribute?.("colspan") || cell.colSpan || 1),
          links: [...(cell.querySelectorAll?.("a[href]") || [])].map(anchor => ({ text: text(anchor.textContent), url: anchor.getAttribute("href") || "" }))
        }))
      }))
    });
  }

  globalThis.AuditFlowHelixAssessmentModel = Object.freeze({
    buildTraceGraph,
    buildTraceGraphAiContext,
    buildHelixTraceGraphFromTable,
    normalizeExternalId,
    packTraceGraph,
    unpackTraceGraph,
    normalizeRequirementRecord,
    normalizeTestCaseRecord,
    parseHelixRequirementHtml,
    parseHelixTestCaseHtml,
    resolveTraceGraph
  });
})();
