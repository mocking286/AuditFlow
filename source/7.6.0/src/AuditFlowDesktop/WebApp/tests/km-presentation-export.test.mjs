import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import path from "node:path";
import { test } from "node:test";

/* ---------------------------------------------------------------------------
 * Minimal DOM. Node exposes neither DOMParser nor XMLSerializer and the WebApp
 * has no node_modules, so report-templates.js is exercised against the same
 * namespace-aware surface the browser provides.
 * ------------------------------------------------------------------------ */
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";

class MiniAttr {
  constructor(qualifiedName, value, namespaceURI) {
    this.qualifiedName = qualifiedName;
    this.name = qualifiedName;
    this.value = value == null ? "" : String(value);
    this.namespaceURI = namespaceURI || null;
    const split = qualifiedName.indexOf(":");
    this.prefix = split > 0 ? qualifiedName.slice(0, split) : "";
    this.localName = split > 0 ? qualifiedName.slice(split + 1) : qualifiedName;
  }
}

class MiniNode {
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.childNodes = [];
    this.parentNode = null;
    this.ownerDocument = null;
  }
  get children() { return this.childNodes.filter(child => child.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, reference) {
    if (child.parentNode) child.parentNode.removeChild(child);
    if (reference) {
      const index = this.childNodes.indexOf(reference);
      if (index < 0) throw new Error("insertBefore: reference node is not a child");
      this.childNodes.splice(index, 0, child);
    } else this.childNodes.push(child);
    child.parentNode = this;
    const document = this.ownerDocument || this;
    const adopt = node => { node.ownerDocument = document; node.childNodes.forEach(adopt); };
    adopt(child);
    return child;
  }
  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) { this.childNodes.splice(index, 1); child.parentNode = null; }
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get textContent() { return this.childNodes.map(child => child.textContent).join(""); }
  set textContent(value) {
    this.childNodes.slice().forEach(child => this.removeChild(child));
    const text = value == null ? "" : String(value);
    if (text) this.appendChild((this.ownerDocument || this).createTextNode(text));
  }
  *descendants() {
    for (const child of this.childNodes) { yield child; yield* child.descendants(); }
  }
  matchesNamespace(namespaceURI, localName) {
    return this.nodeType === 1 && this.namespaceURI === namespaceURI && this.localName === localName;
  }
  getElementsByTagNameNS(namespaceURI, localName) {
    return [...this.descendants()].filter(node => node.matchesNamespace(namespaceURI, localName));
  }
  getElementsByTagName(name) {
    return [...this.descendants()].filter(node => node.nodeType === 1 && (node.qualifiedName === name || node.localName === name));
  }
}

class MiniText extends MiniNode {
  constructor(data) { super(3); this.data = data == null ? "" : String(data); this.nodeName = "#text"; }
  get textContent() { return this.data; }
  set textContent(value) { this.data = value == null ? "" : String(value); }
  cloneNode() { const copy = new MiniText(this.data); copy.ownerDocument = this.ownerDocument; return copy; }
}

class MiniElement extends MiniNode {
  constructor(namespaceURI, qualifiedName) {
    super(1);
    this.namespaceURI = namespaceURI || null;
    this.qualifiedName = qualifiedName;
    this.tagName = qualifiedName;
    this.nodeName = qualifiedName;
    const split = qualifiedName.indexOf(":");
    this.prefix = split > 0 ? qualifiedName.slice(0, split) : "";
    this.localName = split > 0 ? qualifiedName.slice(split + 1) : qualifiedName;
    this.attributes = [];
  }
  getAttribute(name) { const found = this.attributes.find(attr => attr.name === name); return found ? found.value : null; }
  hasAttribute(name) { return this.attributes.some(attr => attr.name === name); }
  setAttribute(name, value) { this.setAttributeNS(null, name, value); }
  setAttributeNS(namespaceURI, name, value) {
    const found = this.attributes.find(attr => attr.name === name);
    if (found) { found.value = value == null ? "" : String(value); if (namespaceURI) found.namespaceURI = namespaceURI; return; }
    this.attributes.push(new MiniAttr(name, value, namespaceURI));
  }
  removeAttribute(name) {
    const index = this.attributes.findIndex(attr => attr.name === name);
    if (index >= 0) this.attributes.splice(index, 1);
  }
  cloneNode(deep) {
    const copy = new MiniElement(this.namespaceURI, this.qualifiedName);
    copy.ownerDocument = this.ownerDocument;
    this.attributes.forEach(attr => copy.attributes.push(new MiniAttr(attr.name, attr.value, attr.namespaceURI)));
    if (deep) this.childNodes.forEach(child => copy.appendChild(child.cloneNode(true)));
    return copy;
  }
}

class MiniDocument extends MiniNode {
  constructor() { super(9); this.nodeName = "#document"; this.ownerDocument = this; }
  get documentElement() { return this.childNodes.find(child => child.nodeType === 1) || null; }
  createElementNS(namespaceURI, qualifiedName) {
    const element = new MiniElement(namespaceURI, qualifiedName);
    element.ownerDocument = this;
    return element;
  }
  createTextNode(data) { const text = new MiniText(data); text.ownerDocument = this; return text; }
  cloneNode(deep) {
    const copy = new MiniDocument();
    if (deep) this.childNodes.forEach(child => copy.appendChild(child.cloneNode(true)));
    return copy;
  }
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeEntities(value) {
  return String(value).replace(/&(?:#x([0-9a-fA-F]+)|#([0-9]+)|([a-zA-Z][a-zA-Z0-9]*));/g, (match, hex, decimal, name) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (decimal) return String.fromCodePoint(Number(decimal));
    return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : match;
  });
}
function escapeText(value) { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escapeAttribute(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/\t/g, "&#9;").replace(/\n/g, "&#10;").replace(/\r/g, "&#13;");
}
function findTagEnd(source, start) {
  let quote = "";
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (quote) { if (char === quote) quote = ""; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === ">") return index;
  }
  return -1;
}
const ATTRIBUTE_PATTERN = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
function parseAttributes(source) {
  const found = [];
  ATTRIBUTE_PATTERN.lastIndex = 0;
  let match = ATTRIBUTE_PATTERN.exec(source);
  while (match) { found.push([match[1], match[2] !== undefined ? match[2] : match[3]]); match = ATTRIBUTE_PATTERN.exec(source); }
  return found;
}
function writeNode(node, scope, out) {
  if (node.nodeType === 3) { out.push(escapeText(node.data)); return; }
  if (node.nodeType !== 1) return;
  const prefix = node.prefix || "";
  const needed = new Map();
  const declare = (key, uri) => { if (key === "xml" || !uri) return; if (scope.get(key) === uri) return; needed.set(key, uri); };
  if (node.namespaceURI) declare(prefix, node.namespaceURI);
  else if (!prefix && scope.has("") && scope.get("")) needed.set("", "");
  node.attributes.forEach(attr => { if (attr.prefix && attr.namespaceURI) declare(attr.prefix, attr.namespaceURI); });
  const childScope = new Map(scope);
  needed.forEach((uri, key) => childScope.set(key, uri));
  out.push("<" + node.qualifiedName);
  needed.forEach((uri, key) => out.push(` ${key ? "xmlns:" + key : "xmlns"}="${escapeAttribute(uri)}"`));
  node.attributes.forEach(attr => out.push(` ${attr.name}="${escapeAttribute(attr.value)}"`));
  if (!node.childNodes.length) { out.push("/>"); return; }
  out.push(">");
  node.childNodes.forEach(child => writeNode(child, childScope, out));
  out.push("</" + node.qualifiedName + ">");
}

class MiniDOMParser {
  parseFromString(source) {
    const text = String(source);
    const document = new MiniDocument();
    const failure = message => {
      const broken = new MiniDocument();
      const element = broken.createElementNS(null, "parsererror");
      element.textContent = message;
      broken.appendChild(element);
      return broken;
    };
    const stack = [];
    let scope = new Map([["xml", XML_NAMESPACE]]);
    let parent = document;
    let index = 0;
    try {
      while (index < text.length) {
        const open = text.indexOf("<", index);
        if (open < 0) { appendText(text.slice(index)); break; }
        if (open > index) appendText(text.slice(index, open));
        if (text.startsWith("<!--", open)) {
          const end = text.indexOf("-->", open);
          if (end < 0) throw new Error("Unterminated comment");
          index = end + 3;
        } else if (text.startsWith("<?", open)) {
          const end = text.indexOf("?>", open);
          if (end < 0) throw new Error("Unterminated processing instruction");
          index = end + 2;
        } else if (text.startsWith("<!", open)) {
          const end = text.indexOf(">", open);
          if (end < 0) throw new Error("Unterminated declaration");
          index = end + 1;
        } else if (text.startsWith("</", open)) {
          const end = text.indexOf(">", open);
          if (end < 0) throw new Error("Unterminated end tag");
          const name = text.slice(open + 2, end).trim();
          const frame = stack.pop();
          if (!frame || frame.element.qualifiedName !== name) throw new Error(`Mismatched end tag: ${name}`);
          parent = frame.parent;
          scope = frame.scope;
          index = end + 1;
        } else {
          const end = findTagEnd(text, open);
          if (end < 0) throw new Error("Unterminated start tag");
          const inner = text.slice(open + 1, end);
          const selfClosing = inner.endsWith("/");
          const body = (selfClosing ? inner.slice(0, -1) : inner).trim();
          const named = /^([^\s/>]+)/.exec(body);
          if (!named) throw new Error("Malformed start tag");
          const qualifiedName = named[1];
          const declarations = new Map();
          const pending = [];
          parseAttributes(body.slice(qualifiedName.length)).forEach(([name, value]) => {
            if (name === "xmlns") declarations.set("", value);
            else if (name.startsWith("xmlns:")) declarations.set(name.slice(6), value);
            else pending.push([name, value]);
          });
          const local = new Map(scope);
          declarations.forEach((uri, key) => local.set(key, uri));
          const split = qualifiedName.indexOf(":");
          const prefix = split > 0 ? qualifiedName.slice(0, split) : "";
          const element = document.createElementNS(local.has(prefix) ? local.get(prefix) : null, qualifiedName);
          pending.forEach(([name, value]) => {
            const attrSplit = name.indexOf(":");
            const attrPrefix = attrSplit > 0 ? name.slice(0, attrSplit) : "";
            element.setAttributeNS(attrPrefix && local.has(attrPrefix) ? local.get(attrPrefix) : null, name, decodeEntities(value));
          });
          parent.appendChild(element);
          index = end + 1;
          if (!selfClosing) { stack.push({ element, parent, scope }); parent = element; scope = local; }
        }
      }
      if (stack.length) throw new Error("Unbalanced markup");
    } catch (error) { return failure(error.message); }
    return document;
    function appendText(raw) { const value = decodeEntities(raw); if (value) parent.appendChild(document.createTextNode(value)); }
  }
}

class MiniXMLSerializer {
  serializeToString(node) {
    const out = [];
    if (node.nodeType === 9) node.childNodes.forEach(child => writeNode(child, new Map(), out));
    else writeNode(node, new Map(), out);
    return out.join("");
  }
}

/* ---------------------------------------------------------------------------
 * Browser surface required by report-templates.js.
 * ------------------------------------------------------------------------ */
const require = createRequire(import.meta.url);
// The vendored UMD bundle ships no ESM exports; because the WebApp package is
// `type: module` the bundle takes its browser branch and installs itself on the
// global object, which is exactly how index.html exposes it to the app.
const required = require("../vendor/jszip.min.js");
const JSZip = typeof required?.loadAsync === "function" ? required : globalThis.JSZip;
assert.equal(typeof JSZip?.loadAsync, "function", "vendor/jszip.min.js must expose JSZip");
const webApp = new URL("../", import.meta.url);
const templateFile = fileURLToPath(new URL("templates/km-presentation.pptx", webApp));
const templateBytes = readFileSync(templateFile);

globalThis.DOMParser = MiniDOMParser;
globalThis.XMLSerializer = MiniXMLSerializer;
globalThis.JSZip = JSZip;
globalThis.location = { href: new URL("index.html", webApp).href };
let fetched = [];
globalThis.fetch = async input => {
  const url = new URL(String(input), globalThis.location.href);
  fetched.push(url.href);
  if (!["km-presentation.pptx", "TUV-ASPICE-Audit-Issue-Ledger-2026.pptx"].some(name => url.href.endsWith(`templates/${name}`))) return { ok: false, status: 404, url: url.href, arrayBuffer: async () => new ArrayBuffer(0) };
  const bytes = url.href.endsWith("templates/km-presentation.pptx") ? templateBytes : readFileSync(new URL("templates/TUV-ASPICE-Audit-Issue-Ledger-2026.pptx", webApp));
  return {
    ok: true, status: 200, url: url.href,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
};

vm.runInThisContext(readFileSync(fileURLToPath(new URL("report-templates.js", webApp)), "utf8"), { filename: "report-templates.js" });
const reportTemplates = globalThis.AuditFlowReportTemplates;

/* ---------------------------------------------------------------------------
 * Synthetic project fixture: two instances, two processes each, assessor
 * confirmed BP/GP ratings, strengths, weaknesses and an evidence register.
 * ------------------------------------------------------------------------ */
const RATING_ORDER = ["N", "P-", "P", "P+", "L-", "L", "L+", "F"];
const rankOf = rating => RATING_ORDER.includes(rating) ? RATING_ORDER.indexOf(rating) : -1;

function practice(process, code, pa, rating, extra = {}) {
  return {
    id: `${process}-${code}`, process, code, pa, rating, reviewed: true,
    kind: code.startsWith("GP") ? "GP" : "BP",
    reason: `${process} ${code} is implemented and evidenced as described in the assessment plan.`,
    reasonEn: `${process} ${code} is implemented and evidenced as described in the assessment plan.`,
    findings: [], ...extra
  };
}
function genericPractices(process, prefix, pa, ratings) {
  return ratings.map((rating, index) => practice(process, `${prefix}${index + 1}`, pa, rating));
}
function basePractices(process, count, ratings) {
  return Array.from({ length: count }, (_, index) => practice(process, `BP${index + 1}`, "PA 1.1", ratings[index] ?? "F"));
}
function levelPractices(process, ratings) {
  return [practice(process, "PA3.1", "PA 3.1", ratings[0]), practice(process, "PA3.2", "PA 3.2", ratings[1])];
}

const assessments = [
  ...basePractices("SWE.1", 6, ["F", "F", "L+", "F", "F", "F"]),
  practice("SWE.1", "BP1", "PA 1.1", "F", {
    findings: [
      { type: "O", text: "需求基线已建立并与系统需求双向可追溯。", textEn: "Software requirement baseline is established and bidirectionally traceable to system requirements." },
      { type: "S", text: "Automated traceability check runs on every build.", textEn: "Automated traceability check runs on every build." },
      { type: "W", text: "部分需求评审记录缺少参与者签署。", textEn: "Some requirement review records are missing participant signatures." }
    ],
    reviewerNoteEn: "Assessor confirmed the traceability sample during the onsite interview."
  }),
  ...genericPractices("SWE.1", "GP2.1.", "PA 2.1", ["L", "L", "L+", "L", "L", "F"]),
  ...genericPractices("SWE.1", "GP2.2.", "PA 2.2", ["L", "L+", "L", "L"]),
  ...levelPractices("SWE.1", ["F", "F"]),

  ...basePractices("SWE.2", 5, ["L-", "L", "F", "L-", "L"]),
  ...genericPractices("SWE.2", "GP2.1.", "PA 2.1", ["P+", "P+", "L-", "P", "P+", "P+"]),
  ...genericPractices("SWE.2", "GP2.2.", "PA 2.2", ["P", "P+", "P", "P"]),
  ...levelPractices("SWE.2", ["L-", "P+"]),
  practice("SWE.2", "BP3", "PA 1.1", "F", {
    findings: [{ type: "W", text: "Architecture decision records are not linked to the affected component list.", textEn: "Architecture decision records are not linked to the affected component list." }]
  }),

  ...basePractices("MAN.3", 10, ["F", "F", "F", "F", "F", "F", "F", "F", "F", "F"]),
  practice("MAN.3", "BP1", "PA 1.1", "F", {
    findings: [
      { type: "S", text: "项目计划与资源计划每季度更新并获批。", textEn: "Project plan and resource plan are updated and approved every quarter." },
      { type: "O", text: "Milestone reviews are minuted and actions are tracked to closure.", textEn: "Milestone reviews are minuted and actions are tracked to closure." }
    ]
  }),
  ...genericPractices("MAN.3", "GP2.1.", "PA 2.1", ["F", "F", "F", "F", "F", "F"]),
  ...genericPractices("MAN.3", "GP2.2.", "PA 2.2", ["F", "F", "F", "F"]),
  ...levelPractices("MAN.3", ["F", "L+"]),

  ...basePractices("SUP.8", 8, ["L", "L+", "L", "F", "L", "L+", "L", "L"]),
  practice("SUP.8", "BP3", "PA 1.1", "L", {
    findings: [{ type: "O", text: "Configuration items are baselined per release train.", textEn: "Configuration items are baselined per release train." }]
  }),
  practice("SWE.1", "BP9", "PA 1.1", "N", { reviewed: false, aiCandidateRating: "L", issueOnly: true, mappingCalibrated: false,
    reason: "AI candidate only, never exported as a rating.", reasonEn: "AI candidate only, never exported as a rating." })
];
// The unreviewed candidate above keeps SWE.1 out of the "every item confirmed"
// path, so the deck must fall back to the weakest assessor-confirmed rating.
const weakestPerProcess = new Map();
assessments.filter(item => item.reviewed === true && RATING_ORDER.includes(item.rating)).forEach(item => {
  const perProcess = weakestPerProcess.get(item.process) || {};
  const current = perProcess[item.pa];
  if (!current || rankOf(item.rating) < rankOf(current)) perProcess[item.pa] = item.rating;
  weakestPerProcess.set(item.process, perProcess);
});
const processSummary = ["SWE.1", "SWE.2", "MAN.3", "SUP.8"].map(process => {
  const items = assessments.filter(item => item.process === process);
  const reviewed = items.length > 0 && items.every(item => item.reviewed && RATING_ORDER.includes(item.rating));
  const ratings = reviewed ? weakestPerProcess.get(process) || {} : {};
  // No capability is supplied on purpose: the deck must derive it from the
  // assessor-confirmed PA ratings instead of trusting an unsupplied number.
  return { process, reviewed, ratings, capability: null };
});

const project = {
  id: "KM-FIXTURE-0001",
  name: "KM Narrative Fixture Project",
  organization: "JE Automotive Electronics",
  product: "Zone Controller ZC-200",
  reportNo: "TA-900",
  pam: "Automotive SPICE 4.0",
  targetLevel: "Level 2",
  assessmentStartDate: "2026-03-02",
  assessmentEndDate: "2026-03-13",
  leadAssessor: "Alex Assessor",
  organizationalUnit: "JE Murten",
  attributes: { purpose: "Internal capability confirmation", assessmentClass: "Class 2", independence: "Category B", asil: "ASIL B", disciplines: ["Embedded software", "System engineering"] },
  participants: [{ name: "Alex Assessor", role: "Lead Assessor" }, { name: "Bo Chen", role: "Assessor" }],
  sessions: [{ date: "2026-03-02", process: "SWE.1" }, { date: "2026-03-13", process: "SUP.8" }],
  processes: ["SWE.1", "SWE.2", "MAN.3", "SUP.8"],
  instances: [
    { id: "INS-1", name: "Zone Controller Firmware", short: "ZCF", processes: ["SWE.1", "SWE.2"] },
    { id: "INS-2", name: "Vehicle Integration Team", short: "VIT", processes: ["MAN.3", "SUP.8"] }
  ],
  assessments,
  records: [
    { id: "R-1", type: "weakness", text: "Change requests are not consistently linked to the affected baseline.", textEn: "Change requests are not consistently linked to the affected baseline.", indicators: ["SUP.8.BP3"], closureState: "措施实施中", owner: "Bo Chen" },
    { id: "R-2", type: "observation", text: "Project plan is reviewed monthly and decisions are recorded.", textEn: "Project plan is reviewed monthly and decisions are recorded.", indicators: ["MAN.3.BP1"], closureState: "不适用" },
    { id: "R-3", type: "strength", text: "Requirement status is reported to the steering committee each sprint.", textEn: "Requirement status is reported to the steering committee each sprint.", indicators: ["SWE.1.BP4"], closureState: "已关闭" },
    { id: "R-4", type: "recommendation", text: "Architecture review checklist should reference the interface control document.", textEn: "Architecture review checklist should reference the interface control document.", indicators: ["SWE.2.BP2"], closureState: "待处理" }
  ],
  evidence: [
    { id: "EV-1", code: "SWE.1.001", name: "Software requirement specification", version: "V1.3", primaryProcesses: ["SWE.1"] },
    { id: "EV-2", code: "SWE.1.002", name: "Requirement review minutes", version: "V1.0", primaryProcesses: ["SWE.1"] },
    { id: "EV-3", code: "SWE.2.001", name: "Software architecture design", version: "V0.9", primaryProcesses: ["SWE.2"] },
    { id: "EV-4", code: "MAN.3.001", name: "Project management plan", version: "Baseline 2026-02", primaryProcesses: ["MAN.3"] },
    { id: "EV-5", code: "SUP.8.001", name: "Configuration item list", version: "V2.0", primaryProcesses: ["SUP.8"] }
  ]
};

const options = {
  language: "en",
  generatedAt: "2026-09-22T08:00:00.000Z",
  gate: { gatePass: true, blockers: [] },
  processSummary,
  reportableAssessmentIds: assessments.filter(item => item.reviewed === true && RATING_ORDER.includes(item.rating)).map(item => item.id)
};

async function buildDeck() {
  fetched = [];
  const result = await reportTemplates.generate(project, "km-presentation", options);
  const zip = await JSZip.loadAsync(result.data);
  const paths = Object.keys(zip.files)
    .filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml$/)[1]) - Number(b.match(/slide(\d+)\.xml$/)[1]));
  const slides = [];
  for (const path of paths) {
    const source = await zip.file(path).async("string");
    const document = new MiniDOMParser().parseFromString(source);
    assert.equal(document.getElementsByTagName("parsererror").length, 0, `${path} must stay well-formed`);
    const texts = document.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/main", "t");
    slides.push({
      path, source, document,
      title: texts.length ? texts[0].textContent : "",
      lines: texts.map(node => node.textContent),
      text: texts.map(node => node.textContent).join("\n")
    });
  }
  return { result, zip, slides, all: slides.map(slide => slide.text).join("\n") };
}

for (const [name, processes, issues, slideCount] of [
  ["empty", ["SYS.2"], [], 5],
  ["single process", ["SYS.2"], [{ id: "NC-1", process: "SYS.2", description: "Requirement review is pending" }], 5],
  ["multiple processes", ["SYS.2", "SWE.1"], [{ id: "NC-1", process: "SYS.2", description: "System review is pending" }, { id: "NC-2", process: "SWE.1", description: "Software review is pending" }], 7]
]) {
  test(`TUV ${name} binary export is a valid PPTX with complete internal relationships`, async () => {
    const result = await reportTemplates.generate({ id: "TUV-76", name: "TUV Fixture", processes, evidence: [], records: [], assessments: [], ncRecords: issues }, "tuv-aspice-issue-ledger", { language: "en", generatedAt: "2026-11-11T00:00:00.000Z" });
    const archive = await JSZip.loadAsync(result.data, { checkCRC32: true });
    assert.match(result.filename, /^TUV-76-tuv-aspice-issue-ledger-2026-11-11[.]pptx$/);
    const slideFiles = Object.keys(archive.files).filter(file => /^ppt[/]slides[/]slide[0-9]+[.]xml$/.test(file));
    assert.equal(slideFiles.length, slideCount);
    assert.equal(Object.keys(archive.files).some(file => file.startsWith("ppt/notesSlides/")), false);
    const parser = new MiniDOMParser();
    for (const file of Object.keys(archive.files).filter(file => /[.](?:xml|rels)$/.test(file))) {
      const xml = await archive.file(file).async("string");
      const document = parser.parseFromString(xml);
      assert.equal(document.getElementsByTagName("parsererror").length, 0, `${file} is well-formed`);
      if (!file.endsWith(".rels")) continue;
      const directory = path.posix.dirname(file).replace(/(?:^|[/])_rels$/, "");
      for (const relationship of document.getElementsByTagNameNS("http://schemas.openxmlformats.org/package/2006/relationships", "Relationship")) {
        if (relationship.getAttribute("TargetMode") === "External") continue;
        const target = relationship.getAttribute("Target").split("#")[0];
        const resolved = target.startsWith("/") ? target.slice(1) : path.posix.normalize(path.posix.join(directory, target));
        assert.ok(archive.file(resolved), `${file} points to missing ${resolved}`);
      }
    }
    const contentTypes = parser.parseFromString(await archive.file("[Content_Types].xml").async("string"));
    for (const override of contentTypes.getElementsByTagNameNS("http://schemas.openxmlformats.org/package/2006/content-types", "Override")) assert.ok(archive.file(override.getAttribute("PartName").slice(1)), "Content type override points at an existing part");
    const presentation = parser.parseFromString(await archive.file("ppt/presentation.xml").async("string"));
    assert.equal(presentation.getElementsByTagNameNS("http://schemas.openxmlformats.org/presentationml/2006/main", "sldId").length, slideCount);
  });
}

/* Text grids are asserted through their column offsets: a monospace grid only
 * reads as a table when every row puts the same column at the same offset. */
function gridOffsets(header, labels) {
  const offsets = labels.map(label => header.indexOf(label));
  offsets.forEach((offset, index) => {
    assert.ok(offset > (index ? offsets[index - 1] : -1), `"${labels[index]}" must be its own column of: ${header}`);
  });
  return offsets;
}
const gridCells = (line, offsets) => offsets.map((offset, index) => line.slice(offset, offsets[index + 1]).trim());
const str = value => String(value == null ? "" : value);
const flat = line => str(line).replace(/\s+/g, " ").trim();

test("generate() loads the corporate template through fetch and returns a pptx", async () => {
  const { result } = await buildDeck();
  assert.equal(fetched.length, 1);
  assert.ok(fetched[0].endsWith("/templates/km-presentation.pptx"), fetched[0]);
  assert.equal(result.mime, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  assert.match(result.filename, /^KM-FIXTURE-0001-km-presentation-2026-09-22\.pptx$/);
  assert.ok(result.data.byteLength > 20000);
});

test("KM deck follows the reference narrative order", async () => {
  const { slides } = await buildDeck();
  const titles = slides.map(slide => slide.title);
  assert.equal(titles[0], "Automotive SPICE Assessment Results");
  assert.equal(titles[1], "Assessment Input · Assessment Plan");
  assert.equal(titles[2], "Assessment Input · Assessed Project and Assessment Scope");
  assert.equal(titles[3], "Ratings and Findings per Process for Instance: Zone Controller Firmware");
  assert.equal(titles[4], "SWE.1 – Software Requirements Analysis");
  assert.equal(titles[5], "SWE.2 – Software Architectural Design");
  assert.equal(titles[6], "Rating, Instance: Zone Controller Firmware");
  assert.equal(titles[7], "BP and GP Matrix, Instance: Zone Controller Firmware");
  assert.equal(titles[8], "Ratings and Findings per Process for Instance: Vehicle Integration Team");
  assert.equal(titles[9], "MAN.3 – Project Management");
  assert.equal(titles[10], "SUP.8 – Configuration Management");
  assert.equal(titles[11], "Rating, Instance: Vehicle Integration Team");
  assert.equal(titles[12], "BP and GP Matrix, Instance: Vehicle Integration Team");
  assert.equal(titles[13], "Considered Evidence (1 / 1)");
  assert.equal(titles[14], "Capability Levels (0-5) - Rating Scale");
  assert.equal(titles[15], "NPLF+- Rating Scale");
  assert.equal(titles[16], "Assessment Presentation");
  assert.equal(slides.length, 17);
});

test("every process gets exactly one findings page carrying Observation and Level", async () => {
  const { slides } = await buildDeck();
  const processPages = slides.filter(slide => slide.text.includes("Level: PA 1.1="));
  assert.equal(processPages.length, project.processes.length);
  const observationPages = processPages.filter(slide => slide.text.includes("Observation"));
  assert.equal(observationPages.length, processPages.length);
  assert.equal(processPages.some(slide => slide.title.includes("(continued)")), false, "this fixture must not need a continuation page");
  const swe1 = processPages.find(slide => slide.title === "SWE.1 – Software Requirements Analysis");
  // SWE.1 carries one unreviewed AI candidate, so the supplied summary is not
  // authoritative and the page falls back to the weakest confirmed rating.
  assert.ok(swe1.text.includes("Level: PA 1.1=L+ PA 2.1=L PA 2.2=L PA 3.1=F PA 3.2=F (CL 1)"), swe1.text);
  assert.ok(swe1.text.includes("BP: BP1=F BP2=F BP3=L+ BP4=F BP5=F BP6=F"), swe1.text);
  assert.ok(swe1.text.includes("GP: GP2.1.1=L GP2.1.2=L GP2.1.3=L+ GP2.1.4=L GP2.1.5=L GP2.1.6=F"), swe1.text);
  assert.ok(swe1.text.includes("Software requirement baseline is established"), swe1.text);
  assert.ok(swe1.text.includes("Weakness"), swe1.text);
  assert.ok(swe1.text.includes("Some requirement review records are missing participant signatures."), swe1.text);
  const swe2 = processPages.find(slide => slide.title === "SWE.2 – Software Architectural Design");
  assert.ok(swe2.text.includes("Level: PA 1.1=L- PA 2.1=P PA 2.2=P PA 3.1=L- PA 3.2=P+ (CL 0)"), swe2.text);
  const man3 = processPages.find(slide => slide.title === "MAN.3 – Project Management");
  assert.ok(man3.text.includes("Level: PA 1.1=F PA 2.1=F PA 2.2=F PA 3.1=F PA 3.2=L+ (CL 3)"), man3.text);
  assert.ok(man3.text.includes("Project plan and resource plan are updated and approved every quarter."), man3.text);
  assert.equal(man3.text.includes("Weakness"), false, "MAN.3 has no weakness, so no weakness block");
  const sup8 = processPages.find(slide => slide.title === "SUP.8 – Configuration Management");
  assert.ok(sup8.text.includes("(CL NR)"), sup8.text);
  assert.ok(sup8.text.includes("Change requests are not consistently linked to the affected baseline. (Actions in progress)"), sup8.text);
  // Rationales stay bounded: one boilerplate sentence per practice is the noise
  // the KM narrative removes.
  assert.ok(processPages.every(slide => slide.lines.filter(line => line.includes("is implemented and evidenced as described")).length <= 4), "gap rationales must stay bounded");
});

test("weakness pages only appear when a weakness was recorded", async () => {
  const { slides } = await buildDeck();
  const processPages = slides.filter(slide => slide.text.includes("Level: PA 1.1="));
  const withWeakness = processPages.filter(slide => slide.text.includes("Weakness")).map(slide => slide.title);
  assert.deepEqual(withWeakness.sort(), ["SWE.1 – Software Requirements Analysis", "SWE.2 – Software Architectural Design", "SUP.8 – Configuration Management"].sort());
});

test("the deck never leaks internal review state", async () => {
  const { all, slides } = await buildDeck();
  for (const banned of ["AI candidate", "aiCandidateRating", "Review boundary", "Cross-process method", "Aggregate not confirmed", "CONTROLLED DRAFT", "AI candidates"]) {
    assert.equal(all.includes(banned), false, `deck must not contain "${banned}"`);
  }
  assert.equal(slides.some(slide => slide.text.includes("AI candidate only")), false);
});

test("rating roll-up and BP/GP matrix pages render aligned text grids", async () => {
  const { slides } = await buildDeck();
  const rating = slides.find(slide => slide.title === "Rating, Instance: Zone Controller Firmware");
  const header = rating.lines.find(line => line.startsWith("ID"));
  assert.equal(flat(header), "ID Name PA 1.1 PA 2.1 PA 2.2 PA 3.1 PA 3.2 CL");
  const offsets = gridOffsets(header, ["PA 1.1", "PA 2.1", "PA 2.2", "PA 3.1", "PA 3.2", "CL"]);
  const rows = rating.lines.filter(line => /^SWE\.\d/.test(line));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => flat(row.slice(0, offsets[0]))), ["SWE.1 Software Requirements Analysis", "SWE.2 Software Architectural Design"]);
  assert.deepEqual(gridCells(rows[0], offsets), ["L+", "L", "L", "F", "F", "1"]);
  assert.deepEqual(gridCells(rows[1], offsets), ["L-", "P", "P", "L-", "P+", "0"]);
  const matrix = slides.find(slide => slide.title === "BP and GP Matrix, Instance: Zone Controller Firmware");
  assert.ok(matrix.text.includes("Base Practices"), matrix.text);
  assert.ok(matrix.text.includes("Generic Practices"), matrix.text);
  const bpHeader = matrix.lines.find(line => line.includes("BP1") && line.includes("BP6"));
  const gpHeader = matrix.lines.find(line => line.includes("GP2.1.1") && line.includes("GP2.2.4"));
  assert.equal(flat(bpHeader), "ID Name BP1 BP2 BP3 BP4 BP5 BP6 CL");
  assert.equal(flat(gpHeader), "ID Name GP2.1.1 GP2.1.2 GP2.1.3 GP2.1.4 GP2.1.5 GP2.1.6 GP2.2.1 GP2.2.2 GP2.2.3 GP2.2.4 CL");
  const bpIndex = matrix.lines.indexOf(bpHeader);
  const gpIndex = matrix.lines.indexOf(gpHeader);
  assert.ok(gpIndex > bpIndex, "base practices are rendered before generic practices");
  const bpOffsets = gridOffsets(bpHeader, ["BP1", "BP2", "BP3", "BP4", "BP5", "BP6", "CL"]);
  const bpRows = matrix.lines.slice(bpIndex + 1, gpIndex).filter(line => /^SWE\.\d/.test(line));
  assert.equal(bpRows.length, 2);
  assert.deepEqual(gridCells(bpRows[0], bpOffsets), ["F", "F", "L+", "F", "F", "F", "1"]);
  assert.deepEqual(gridCells(bpRows[1], bpOffsets), ["L-", "L", "F", "L-", "L", "-", "0"]);
  const gpOffsets = gridOffsets(gpHeader, ["GP2.1.1", "GP2.1.2", "GP2.1.3", "GP2.1.4", "GP2.1.5", "GP2.1.6", "GP2.2.1", "GP2.2.2", "GP2.2.3", "GP2.2.4", "CL"]);
  const gpRows = matrix.lines.slice(gpIndex + 1).filter(line => /^SWE\.\d/.test(line));
  assert.equal(gpRows.length, 2);
  assert.deepEqual(gridCells(gpRows[0], gpOffsets), ["L", "L", "L+", "L", "L", "F", "L", "L+", "L", "L", "1"]);
  assert.deepEqual(gridCells(gpRows[1], gpOffsets), ["P+", "P+", "L-", "P", "P+", "P+", "P", "P+", "P", "P", "0"]);
  const startsOnColumn = (row, columns) => columns.forEach(offset => assert.notEqual(row[offset], " ", `cell must start exactly on its column: ${row}`));
  rows.forEach(row => startsOnColumn(row, offsets));
  bpRows.forEach(row => startsOnColumn(row, bpOffsets));
  gpRows.forEach(row => startsOnColumn(row, gpOffsets));
});

test("considered evidence is grouped by process prefix and paginated", async () => {
  const { slides } = await buildDeck();
  const evidence = slides.filter(slide => /^Considered Evidence \(\d+ \/ \d+\)$/.test(slide.title));
  assert.equal(evidence.length, 1);
  assert.ok(evidence[0].title.includes("(1 / 1)"), evidence[0].title);
  const lines = evidence[0].lines;
  const header = lines.find(line => line.startsWith("Id"));
  assert.equal(flat(header), "Id Name Version");
  const offsets = gridOffsets(header, ["Id", "Name", "Version"]);
  assert.deepEqual(gridCells(lines.find(line => line.startsWith("SWE.1.001")), offsets), ["SWE.1.001", "Software requirement specification", "V1.3"]);
  assert.deepEqual(gridCells(lines.find(line => line.startsWith("MAN.3.001")), offsets), ["MAN.3.001", "Project management plan", "Baseline 2026-02"]);
  assert.deepEqual(gridCells(lines.find(line => line.startsWith("SUP.8.001")), offsets), ["SUP.8.001", "Configuration item list", "V2.0"]);
  for (const group of ["Process SWE.1", "Process SWE.2", "Process MAN.3", "Process SUP.8"]) assert.ok(lines.includes(group), `${group} missing`);
  assert.ok(lines.indexOf("Process SWE.1") < lines.indexOf("Process MAN.3"), "evidence must follow the scope order");
  assert.ok(evidence[0].source.includes('typeface="Consolas"'), "evidence grid must be rendered in a monospace face");
});

test("rating scale pages reproduce the KM reference scales", async () => {
  const { slides } = await buildDeck();
  const capability = slides.find(slide => slide.title.includes("Capability Levels"));
  assert.ok(capability.title.includes("Capability Levels (0-5)"), capability.title);
  for (const row of ["Incomplete process", "Performed process", "Managed process", "Established process", "Predictable process", "Innovating process"]) {
    assert.ok(capability.text.includes(row), `${row} missing`);
  }
  assert.ok(capability.text.includes("The implemented process achieves its process purpose."), capability.text);
  assert.ok(capability.text.includes("Code") && capability.text.includes("Level of Achievement"), capability.text);
  const nplf = slides.find(slide => slide.title.includes("NPLF"));
  assert.ok(nplf.text.includes("NPLF+-"), nplf.title);
  for (const row of ["Not implemented", "0% - 15% achievement", ">15% - 32.5% achievement", ">32.5% - 50% achievement", ">50% - 67.5% achievement", ">67.5% - 85% achievement", ">85% - 100% achievement"]) {
    assert.ok(nplf.text.includes(row), `${row} missing`);
  }
});

test("cover, plan, scope and back cover carry the assessment metadata", async () => {
  const { slides } = await buildDeck();
  const cover = slides[0].text;
  assert.ok(cover.includes("JE Automotive Electronics"), cover);
  assert.ok(cover.includes("Project: KM Narrative Fixture Project"), cover);
  assert.ok(cover.includes("Assessment Team: Alex Assessor, Bo Chen"), cover);
  assert.ok(cover.includes("Assessment Period: 2026-03-02 to 2026-03-13"), cover);
  const plan = slides[1].text;
  assert.ok(plan.includes("Process Assessment Model: Automotive SPICE 4.0"), plan);
  assert.ok(plan.includes("Assessment Standard: ISO/IEC 33002"), plan);
  assert.ok(plan.includes("Lead Assessor: Alex Assessor"), plan);
  const scope = slides[2].text;
  assert.ok(scope.includes("Product: Zone Controller ZC-200"), scope);
  assert.ok(scope.includes("Organizational Unit / Location: JE Murten"), scope);
  assert.ok(scope.includes("ASIL Level: ASIL B"), scope);
  assert.ok(scope.includes("SWE.1(1), SWE.2(1), MAN.3(1), SUP.8(1)"), scope);
  assert.ok(scope.includes("Target Capability Level: Level 2"), scope);
  const back = slides[slides.length - 1].text;
  assert.ok(back.includes("Assessment Id: TA-900"), back);
  assert.ok(back.includes("Report Generated At: 2026-09-22T08:00:00.000Z"), back);
  assert.ok(back.includes("Template Version: km-presentation v1.3"), back);
});

test("each body line becomes its own single-run paragraph with autofit and geometry", async () => {
  const { slides } = await buildDeck();
  const drawingml = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const presentationml = "http://schemas.openxmlformats.org/presentationml/2006/main";
  // Cover, back cover and instance separators use the centred band layout, whose
  // body box is deliberately shorter than the full-height body of a content page.
  const banded = new Set([
    slides[0].title, slides[slides.length - 1].title,
    ...slides.filter(slide => slide.title.startsWith("Ratings and Findings per Process for Instance")).map(slide => slide.title)
  ]);
  for (const slide of slides) {
    const shapes = slide.document.getElementsByTagNameNS(presentationml, "sp")
      .filter(shape => shape.getElementsByTagNameNS(presentationml, "txBody").length);
    assert.ok(shapes.length >= 2, `${slide.path} must keep two text shapes`);
    for (const shape of shapes) {
      const bodies = shape.getElementsByTagNameNS(presentationml, "txBody");
      const paragraphs = bodies[0].children.filter(child => child.matchesNamespace(drawingml, "p"));
      assert.ok(paragraphs.length >= 1, `${slide.path} txBody must keep a paragraph`);
      for (const paragraph of paragraphs) {
        const runs = paragraph.children.filter(child => child.matchesNamespace(drawingml, "r"));
        assert.equal(runs.length, 1, `${slide.path} paragraph must carry exactly one run`);
        assert.equal(runs[0].getElementsByTagNameNS(drawingml, "t").length, 1);
      }
    }
    const bodyShape = shapes[1];
    const bodyPr = bodyShape.getElementsByTagNameNS(drawingml, "bodyPr")[0];
    assert.ok(bodyPr, `${slide.path} must keep bodyPr`);
    assert.equal(bodyPr.getElementsByTagNameNS(drawingml, "normAutofit").length, 1, `${slide.path} body must request normAutofit`);
    assert.equal(bodyPr.getElementsByTagNameNS(drawingml, "noAutofit").length, 0, `${slide.path} must not keep noAutofit`);
    const box = shape => {
      const xfrm = shape.getElementsByTagNameNS(drawingml, "xfrm")[0];
      assert.ok(xfrm, `${slide.path} shape must carry explicit geometry`);
      const read = tag => {
        const found = xfrm.getElementsByTagNameNS(drawingml, tag)[0];
        return { x: Number(found.getAttribute("x")), y: Number(found.getAttribute("y")), cx: Number(found.getAttribute("cx")), cy: Number(found.getAttribute("cy")) };
      };
      return { off: read("off"), ext: read("ext") };
    };
    const title = box(shapes[0]);
    const body = box(bodyShape);
    assert.ok(body.ext.cx > 9000000, `${slide.path} body must span the slide width, got ${body.ext.cx}`);
    assert.ok(banded.has(slide.title) ? body.ext.cy > 1500000 : body.ext.cy > 5000000, `${slide.path} body height ${body.ext.cy}`);
    assert.ok(title.off.y + title.ext.cy <= body.off.y, `${slide.path} title box must not overlap the body`);
    assert.ok(body.off.y + body.ext.cy <= 6858000, `${slide.path} body must stay inside the slide`);
    assert.equal(title.ext.cx, body.ext.cx, `${slide.path} title and body must share the text column`);
  }
  const processSlide = slides.find(slide => slide.title === "MAN.3 – Project Management");
  const paragraphs = processSlide.document.getElementsByTagNameNS(drawingml, "p");
  assert.ok(paragraphs.length >= processSlide.lines.length, "one paragraph per rendered line");
  assert.equal(processSlide.source.includes("Controlled draft"), false, "prototype text must not survive");
  assert.equal(processSlide.source.includes("AuditFlow Assessment Results"), false, "prototype text must not survive");
});

test("monospace grids shrink instead of wrapping", async () => {
  const { slides } = await buildDeck();
  const drawingml = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const presentationml = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const bodySize = slide => {
    const shapes = slide.document.getElementsByTagNameNS(presentationml, "sp")
      .filter(shape => shape.getElementsByTagNameNS(presentationml, "txBody").length);
    return Number(shapes[1].getElementsByTagNameNS(drawingml, "rPr")[0].getAttribute("sz"));
  };
  const matrix = slides.find(slide => slide.title.startsWith("BP and GP Matrix, Instance: Zone"));
  const evidence = slides.find(slide => slide.title.startsWith("Considered Evidence"));
  const scale = slides.find(slide => slide.title.includes("Capability Levels"));
  // Ten GP columns plus a 30 character name column cannot stay on one line at
  // body size, so the wide grid must drop below the narrow evidence grid.
  assert.ok(bodySize(matrix) < bodySize(evidence), `matrix ${bodySize(matrix)} must shrink below evidence ${bodySize(evidence)}`);
  assert.ok(bodySize(matrix) >= 900, `grid text must stay readable, got ${bodySize(matrix)}`);
  assert.ok(bodySize(scale) < bodySize(evidence), "the capability scale descriptions must shrink too");
  assert.equal(bodySize(evidence), 1800, "narrow grids keep the regular body size");
});

test("kmFitSize honours the caller ceiling when a mono grid row passes the 800 floor", async () => {
  // 214 weighted characters (CJK counts as 2) is the crossover where kmMonoSize
  // computes a body size below the 800 floor and clamps toward 500. kmFitSize
  // must respect that caller-supplied ceiling (Math.min(max, 800)) instead of
  // snapping back to 800, which would overflow the limit the mono sizing set.
  const wideName = "Wide considered evidence register row that must never wrap ".repeat(5).trim();
  const weightedChars = text => Array.from(String(text)).reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
  assert.ok(weightedChars(wideName) >= 214, "fixture row must reach the 214 weighted-character crossover");
  const wide = {
    ...project,
    evidence: [{ id: "EV-WIDE", code: "SWE.1.WIDE", name: wideName, version: "V1.0", primaryProcesses: ["SWE.1"] }]
  };
  fetched = [];
  const result = await reportTemplates.generate(wide, "km-presentation", options);
  const zip = await JSZip.loadAsync(result.data);
  const drawingml = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const presentationml = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const paths = Object.keys(zip.files)
    .filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml$/)[1]) - Number(b.match(/slide(\d+)\.xml$/)[1]));
  let evidence = null;
  for (const path of paths) {
    const document = new MiniDOMParser().parseFromString(await zip.file(path).async("string"));
    assert.equal(document.getElementsByTagName("parsererror").length, 0, `${path} must stay well-formed`);
    const texts = document.getElementsByTagNameNS(drawingml, "t").map(node => node.textContent);
    if (texts.some(text => text.includes("Considered Evidence"))) { evidence = { path, document, texts }; break; }
  }
  assert.ok(evidence, "the wide considered-evidence grid page must be rendered");
  const shapes = evidence.document.getElementsByTagNameNS(presentationml, "sp")
    .filter(shape => shape.getElementsByTagNameNS(presentationml, "txBody").length);
  const runs = shapes[1].getElementsByTagNameNS(drawingml, "r");
  const sizes = runs.map(run => Number(run.getElementsByTagNameNS(drawingml, "rPr")[0].getAttribute("sz")));
  const bodySize = sizes[0];
  assert.ok(bodySize <= 800, `body font ${bodySize} must never exceed the 800 ceiling`);
  assert.ok(bodySize < 800, `a row past the 214-character crossover must shrink below 800, got ${bodySize}`);
  assert.ok(sizes.every(size => size === bodySize), "every body run shares the fitted size");
  // The wide row survives as exactly one single-run paragraph: no wrap, no split.
  const wideRuns = runs.filter(run => run.getElementsByTagNameNS(drawingml, "t")[0].textContent.includes(wideName));
  assert.equal(wideRuns.length, 1, "the wide grid row stays a single run on one line");
});

test("presentation parts stay consistent: slide ids, relationships and content types", async () => {
  const { result, slides } = await buildDeck();
  const zip = await JSZip.loadAsync(result.data);
  const presentation = new MiniDOMParser().parseFromString(await zip.file("ppt/presentation.xml").async("string"));
  const relationships = new MiniDOMParser().parseFromString(await zip.file("ppt/_rels/presentation.xml.rels").async("string"));
  const contentTypes = new MiniDOMParser().parseFromString(await zip.file("[Content_Types].xml").async("string"));
  const presentationml = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const packageRels = "http://schemas.openxmlformats.org/package/2006/relationships";
  const contentNs = "http://schemas.openxmlformats.org/package/2006/content-types";
  const ids = presentation.getElementsByTagNameNS(presentationml, "sldId");
  const slideRelationships = relationships.getElementsByTagNameNS(packageRels, "Relationship").filter(node => node.getAttribute("Type").endsWith("/slide"));
  const overrides = contentTypes.getElementsByTagNameNS(contentNs, "Override").filter(node => node.getAttribute("PartName").startsWith("/ppt/slides/"));
  assert.equal(ids.length, slides.length);
  assert.equal(slideRelationships.length, slides.length);
  assert.equal(overrides.length, slides.length);
  assert.deepEqual(ids.map(node => node.getAttribute("r:id")), slideRelationships.map(node => node.getAttribute("Id")));
  assert.deepEqual(overrides.map(node => node.getAttribute("PartName")), slides.map(slide => `/${slide.path}`));
  slides.forEach(slide => {
    const relsPath = `ppt/slides/_rels/${slide.path.split("/").pop()}.rels`;
    assert.ok(zip.file(relsPath), `${relsPath} must exist`);
  });
  for (const slide of slides) {
    const relsPath = `ppt/slides/_rels/${slide.path.split("/").pop()}.rels`;
    const relsSource = await zip.file(relsPath).async("string");
    assert.equal(/notesSlide/.test(relsSource), false, `${relsPath} must not keep a dangling notesSlide relationship`);
  }
  assert.equal(Object.keys(zip.files).filter(path => path.startsWith("ppt/notesSlides/")).length, 0, "orphaned notes slides must be dropped");
});

test("the model keeps legacy sections and excludes pending candidates by default", async () => {
  const { result } = await buildDeck();
  const model = result.model;
  assert.equal(model.schema, "auditflow.report/v10");
  assert.equal(model.sections.length, 6);
  assert.equal(model.sections[2].tables.some(entry => entry.title.includes("AI candidates / not approved")), false, "final report sections exclude pending candidates by default");
  const candidateModel = reportTemplates.buildReportModel(project, { ...options, includeCandidates: true });
  const candidateTable = candidateModel.sections[2].tables.find(entry => entry.title.includes("AI candidates / not approved"));
  assert.ok(candidateTable, "candidate appendix is available only when explicitly requested");
  assert.deepEqual(candidateTable.rows.map(row => row[0]), ["SWE.1.BP9"], "candidate appendix contains pending candidates only");
  assert.equal(model.presentation.schema, "auditflow.report.presentation/v1");
  assert.equal(model.presentation.instances.length, 2);
  assert.equal(model.presentation.instances[0].processes.length, 2);
  const pages = reportTemplates.presentationPages(model, "km-presentation");
  assert.ok(pages.every(page => typeof page.title === "string" && Array.isArray(page.lines) && page.lines.every(line => typeof line === "string")));
  const legacy = reportTemplates.presentationPages({ ...model, presentation: null }, "trace-presentation");
  assert.equal(legacy.every(page => page.kind !== "km"), true);
  assert.ok(legacy.length > pages.length, "legacy dump still produces its own pages");
});

test("finding evidence export requires an explicit link to that finding", () => {
  const specimen = structuredClone(project);
  const assessment = specimen.assessments.find(item => item.process === "SWE.1" && item.code === "BP1" && item.findings.length);
  assessment.reviewed = true;
  assessment.evidenceAnalysis = [{ evidenceId: "EV-5", evidenceCode: "SUP.8.001", evidenceRole: "direct", locator: "assessment-level-only" }];
  assessment.findings[0].id = "F-100";
  assessment.findings[0].evidenceIds = ["EV-2"];
  assessment.findings[1].id = "F-101";
  assessment.findings[2].id = "F-102";
  specimen.evidence = specimen.evidence.map(item => ({
    ...item,
    ...(item.id === "EV-1" ? { confirmed: true, evidenceRole: "Direct", locator: "reviews/meeting-minutes.pdf#page=4" } : {}),
    ...(item.id === "EV-2" ? { evidenceRole: "Corroborating", locator: "requirements/review-log.xlsx#R12" } : {})
  }));
  specimen.traceLinks = [
    { id: "TL-1", findingId: "F-100", assessmentId: assessment.id, evidenceId: "EV-1", evidenceRole: "Direct", locator: "reviews/meeting-minutes.pdf#page=4", confirmed: false },
    { id: "TL-2", findingIds: ["F-102"], assessmentId: assessment.id, evidenceId: "EV-3", evidenceRole: "Direct", locator: "architecture/design.pdf#page=8", confirmed: true },
    { id: "TL-3", assessmentId: assessment.id, evidenceId: "EV-4", evidenceRole: "Direct", locator: "plan/plan.docx", confirmed: true }
  ];
  specimen.assessments.push({
    ...structuredClone(assessment),
    id: "SWE.1-BP-PENDING",
    code: "BP-PENDING",
    reviewed: false,
    aiCandidateRating: "L",
    findings: [{ id: "F-PENDING", type: "W", text: "Pending candidate must stay out of the formal report." }]
  });

  const model = reportTemplates.buildReportModel(specimen, options);
  const section = model.sections[4];
  const findingEvidence = section.tables.find(item => item.title === "Finding-specific evidence links");
  assert.ok(findingEvidence);
  assert.equal(findingEvidence.rows.length, 3);
  const byEvidence = new Map(findingEvidence.rows.map(row => [row[3], row]));
  assert.deepEqual(byEvidence.get("SWE.1.002").slice(0, 8), ["F-100", "SWE.1", "SWE.1.BP1", "SWE.1.002", "Corroborating", "requirements/review-log.xlsx#R12", "Not recorded", "Not recorded"]);
  assert.deepEqual(byEvidence.get("SWE.1.001").slice(4, 8), ["Direct", "reviews/meeting-minutes.pdf#page=4", "Not confirmed", "Confirmed"]);
  assert.equal(byEvidence.get("SWE.2.001")[0], "F-102");
  assert.equal(findingEvidence.rows.some(row => row.includes("SUP.8.001") || row.includes("EV-4")), false, "assessment-only and unmatched links stay out of finding evidence");
  const finding = section.tables.find(item => item.title === "Assessment findings").rows.find(row => row[0] === "F-100");
  assert.equal(finding[7], "Assessor reviewed", "formal finding rows are limited to assessor-confirmed assessments");
  assert.equal(section.tables.find(item => item.title === "Assessment findings").rows.some(row => row[0] === "F-PENDING"), false, "pending findings stay out of the formal report");
});

test("milestone checks export only explicit project records and never infer ratings", () => {
  const withoutChecks = reportTemplates.buildReportModel(project, options);
  assert.equal(withoutChecks.sections[4].tables.some(item => item.title === "Milestone checks"), false);

  const specimen = structuredClone(project);
  specimen.milestoneChecks = [{
    id: "MC-42",
    area: "Software integration",
    milestone: "M2",
    questionOrCheck: "Were interface tests completed before integration exit?",
    result: "Evidence requested",
    evidenceIds: ["EV-3"],
    reviewed: false,
    rating: "F"
  }];
  const model = reportTemplates.buildReportModel(specimen, options);
  const checks = model.sections[4].tables.find(item => item.title === "Milestone checks");
  assert.ok(checks);
  assert.equal(checks.rows.length, 1);
  assert.deepEqual(checks.rows[0], [
    "MC-42", "Software integration", "M2", "Were interface tests completed before integration exit?", "Evidence requested",
    "SWE.2.001", "Not recorded", "Not recorded", "Not recorded", "Review pending", "Checkpoint record only; no ASPICE rating inferred"
  ]);
  assert.equal(checks.headers.includes("Rating"), false);
});

test("a project without instances degrades to a single instance deck", async () => {
  const bare = { ...project, instances: undefined, evidence: [], records: [] };
  const result = await reportTemplates.generate(bare, "km-presentation", { ...options, processSummary: [] });
  const model = result.model;
  assert.equal(model.presentation.instances.length, 1);
  assert.equal(model.presentation.instances[0].name, "Zone Controller ZC-200");
  assert.deepEqual(model.presentation.instances[0].processes.map(entry => entry.processId), ["SWE.1", "SWE.2", "MAN.3", "SUP.8"]);
  const pages = reportTemplates.presentationPages(model, "km-presentation");
  assert.equal(pages.filter(page => page.text === undefined && page.lines.some(line => line.startsWith("Level: PA 1.1="))).length, 4);
  assert.equal(pages.some(page => page.title.startsWith("Considered Evidence")), false);
  const zip = await JSZip.loadAsync(result.data);
  const slide = await zip.file("ppt/slides/slide4.xml").async("string");
  assert.ok(slide.includes("Ratings and Findings per Process for Instance"), slide.slice(0, 200));
});

test("other templates keep their existing page sequence", async () => {
  const model = reportTemplates.buildReportModel(project, options);
  const pages = reportTemplates.presentationPages(model, "trace-presentation");
  assert.equal(pages[0].title, "Automotive SPICE Assessment Results");
  assert.equal(pages[0].kind, "cover");
  assert.ok(pages.some(page => page.kind === "input"));
  assert.ok(pages.some(page => page.kind === "detail" || page.kind === "overview" || page.kind === undefined));
  assert.ok(pages.every(page => Array.isArray(page.lines) && page.lines.every(line => line.length <= 76)), "legacy pages stay hard-wrapped");
  const html = reportTemplates.printDocument(model, { templateId: "km-presentation" });
  assert.ok(html.includes("Ratings and Findings per Process for Instance"));
  assert.equal(html.includes("AI candidate"), false);
  assert.ok(pathToFileURL(templateFile).href.startsWith("file://"));
});

test("report model exposes explicit GP availability without inferring a rating", () => {
  const specimen = structuredClone(project);
  specimen.assessments = specimen.assessments.filter(item => item.kind !== "GP" && !String(item.code || "").startsWith("GP"));
  specimen.gpAvailability = [{
    id: "GP-REC-1",
    process: "SWE.1",
    gpCode: "GP2.1.1",
    status: "available",
    sourceRecordId: "PAM-GP-12",
    evidenceCodes: ["EV-1"],
    reviewed: false,
    rating: "F"
  }];
  const model = reportTemplates.buildReportModel(specimen, options);
  assert.equal(model.gpAvailability.schema, "auditflow.gp-availability/v1");
  assert.equal(model.gpAvailability.status, "recorded");
  assert.equal(model.gpAvailability.rows.length, 1);
  assert.deepEqual(model.gpAvailability.rows[0], {
    process: "SWE.1",
    code: "SWE.1.GP2.1.1",
    status: "available",
    provenance: "PAM-GP-12 (GP-REC-1)",
    evidenceCodes: ["EV-1"],
    reviewState: "Review pending",
    boundary: "Status/availability only; no ASPICE rating inferred"
  });
  assert.equal(Object.hasOwn(model.gpAvailability.rows[0], "rating"), false);
  const table = model.sections[1].tables.find(item => item.title === "GP availability and status");
  assert.ok(table);
  assert.equal(table.rows[0][2], "available");
  assert.equal(table.rows[0][5], "Review pending");
  assert.equal(table.rows[0][6], "Status/availability only; no ASPICE rating inferred");
});

test("missing GP records remain unknown and are not rendered as absent or achieved", () => {
  const specimen = structuredClone(project);
  specimen.assessments = specimen.assessments.filter(item => item.kind !== "GP" && !String(item.code || "").startsWith("GP"));
  delete specimen.gpAvailability;
  delete specimen.genericPracticeAvailability;
  delete specimen.gpStatuses;
  delete specimen.gpRecords;
  const model = reportTemplates.buildReportModel(specimen, options);
  assert.equal(model.gpAvailability.status, "not-recorded");
  const table = model.sections[1].tables.find(item => item.title === "GP availability and status");
  assert.ok(table);
  assert.equal(table.rows.length, 1);
  assert.equal(table.rows[0][2], "Unknown / status not recorded");
  assert.equal(table.rows[0].some(value => /achieved|absent/i.test(String(value))), false);
});

test("cross-process BP/GP coverage preserves explicit evidence and provenance", () => {
  const specimen = structuredClone(project);
  specimen.crossProcessObservations = [{
    id: "REL-1",
    sourceProcess: "SWE.1",
    targetProcess: "SWE.2",
    relationType: "downstream",
    scopeStatus: "in-scope",
    indicatorCodes: ["SWE.1.BP1"],
    evidenceCodes: ["EV-1"],
    sourceRecordId: "TRACE-REL-1",
    reviewed: true
  }];
  const model = reportTemplates.buildReportModel(specimen, options);
  assert.equal(model.coverageHeatmap.schema, "auditflow.cross-process-bp-gp-coverage/v1");
  assert.equal(model.coverageHeatmap.status, "recorded");
  assert.deepEqual(model.coverageHeatmap.indicatorCodes, ["SWE.1.BP1"]);
  assert.equal(model.coverageHeatmap.rows[0].cells["SWE.1.BP1"], "Evidence referenced (1)");
  assert.match(model.coverageHeatmap.rows[0].provenance, /TRACE-REL-1/);
  const detail = model.sections[4].tables.find(item => item.title === "Cross-process BP/GP coverage details");
  assert.ok(detail);
  assert.equal(detail.rows[0][4], "SWE.1.BP1");
  assert.equal(detail.rows[0][5], "Evidence referenced");
  assert.match(detail.rows[0][7], /TRACE-REL-1/);
  assert.equal(detail.rows[0].includes("F"), false);
  assert.equal(detail.rows[0].some(value => /achieved/i.test(String(value))), false);
});

test("missing cross-process relations stay not-recorded without a completeness claim", () => {
  const model = reportTemplates.buildReportModel(project, options);
  assert.equal(model.coverageHeatmap.status, "not-recorded");
  const table = model.sections[1].tables.find(item => item.title === "Cross-process BP/GP coverage heatmap");
  assert.ok(table);
  assert.equal(table.rows[0][0], "Not recorded");
  assert.equal(table.rows[0][4], "No explicit cross-process BP/GP relation record supplied");
  assert.equal(table.rows[0].some(value => /missing implementation|achieved coverage/i.test(String(value))), false);
});

