import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertCandidateOutputPath, assertCandidateRoot, writeCandidateFile } from "./package-7.3-release-helpers.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidatesRoot = path.join(projectRoot, "artifacts/candidates");
const require = createRequire(import.meta.url);
const imported = require("../src/AuditFlowDesktop/WebApp/vendor/jszip.min.js");
const JSZip = typeof imported?.loadAsync === "function" ? imported : globalThis.JSZip;
const templateIds = Object.freeze({
  "TUV-ASPICE-Audit-Issue-Ledger-2026.pptx": ["tuv-aspice-issue-ledger"],
  "mbeal-assessment-findings.xlsx": ["mbeal-assessment-findings", "tuv-audit-issue-record"],
  "km-presentation.pptx": ["km-presentation"],
  "trace-word.docx": ["trace-word"],
  "trace-excel.xlsx": ["trace-excel"],
  "trace-presentation.pptx": ["trace-presentation"]
});
const neutralPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const fixedDate = new Date("2000-01-01T00:00:00.000Z");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

// This build-time transform uses defusedxml.minidom to preserve OOXML namespace
// prefixes. Templates are parsed as data; no Office macros or links execute.
const xmlTransform = String.raw`
import json, posixpath, re, sys
from defusedxml.minidom import parseString
data=json.load(sys.stdin)
parts=data["parts"]
removed=set(data["removed"])
existing_parts=set(parts)|set(data["media"])
filename=data["filename"]
A="http://schemas.openxmlformats.org/drawingml/2006/main"
P="http://schemas.openxmlformats.org/presentationml/2006/main"
S="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL="http://schemas.openxmlformats.org/package/2006/relationships"
CT="http://schemas.openxmlformats.org/package/2006/content-types"
docs={name:parseString(source) for name,source in parts.items()}
def elements(doc,namespace,local):
 return list(doc.getElementsByTagNameNS(namespace,local))
def text(node):
 return "".join(child.data for child in node.childNodes if child.nodeType in (3,4))
def put(node,value):
 for child in list(node.childNodes): node.removeChild(child)
 node.appendChild(node.ownerDocument.createTextNode(str(value)))
def drop(node):
 if node.parentNode: node.parentNode.removeChild(node)
def scrub_comments(node):
 for child in list(node.childNodes):
  if child.nodeType in (7,8): drop(child)
  else: scrub_comments(child)
def remove_empty_text(node):
 for child in list(node.childNodes):
  if child.nodeType in (3,4) and child.data=="": drop(child)
  else: remove_empty_text(child)
def slide_role(name,doc):
 number=int(re.search(r"slide(\d+)\.xml$",name).group(1))
 original=" ".join(text(node) for node in elements(doc,A,"t"))
 if number==1: return "cover"
 if number==2: return "overview"
 if number==92 or "TRACKING & CLOSURE" in original: return "closure"
 if "PROCESS AREA" in original: return "section"
 return "issue"
tuv={
 "cover":{3:"AUTOMOTIVE SPICE - TUV AUDIT",4:"ASPICE Issue Ledger",5:"Project Findings",6:"Public neutral template",8:"0 issues",10:"Unconfirmed 0",12:"Formal process scope",13:"Project Issue Ledger"},
 "overview":{1:"FINDINGS OVERVIEW",2:"Project issue overview",3:"0",4:"Project Findings",6:"0",7:"Project issue records",9:"0",10:"Assessment review gaps",12:"0",13:"Major",15:"0",16:"Medium",18:"0",19:"Minor",20:"No project status recorded",22:"Findings Distribution by Process Area",23:"Formal process scope",54:"Public neutral template",55:"Template"},
 "section":{2:"PROCESS AREA",3:"Process",4:"Process name",6:"0",7:"Project Findings",8:"PURPOSE",9:"Process purpose",11:"OUTCOMES",12:"Process outcomes",13:"Public neutral template",14:"Template"},
 "issue":{1:"Issue",3:"Process",4:"/",5:"Project issue",7:"Severity: Unconfirmed",9:"Status: Unconfirmed",12:"Issue ID: Not recorded | Date: Not recorded | Owner: Not recorded | Due date: Not recorded",14:"ISSUE DESCRIPTION",15:"No project issue recorded.",17:"INTERNAL COMMENT - SOURCE",18:"No project source recorded.",20:"IMPROVEMENT MEASURES",21:"No project action recorded.",22:"Public neutral template",23:"Template"},
 "closure":{2:"TRACKING & CLOSURE",3:"Project closure tracking",5:"No project records are included.",7:"Formal process scope",9:"No project status recorded",10:"Public neutral template"}
}
for name,doc in docs.items():
 scrub_comments(doc)
 # Raw customer content is never retained based on a name blacklist.
 if name.startswith("ppt/slides/") and re.search(r"/slide\d+\.xml$",name):
  shapes=elements(doc,P,"sp")
  if filename.startswith("TUV-"):
   values=tuv[slide_role(name,doc)]
  else:
   values={}
   text_shapes=[index for index,shape in enumerate(shapes) if elements(shape,P,"txBody")]
   if text_shapes: values[text_shapes[0]]="Assessment Results"
   if len(text_shapes)>1: values[text_shapes[1]]="Public neutral template"
  for node in elements(doc,A,"t"): put(node,"")
  for index,shape in enumerate(shapes):
   nodes=elements(shape,A,"t")
   for offset,node in enumerate(nodes): put(node,values.get(index,"") if offset==0 else "")
 else:
  for node in list(doc.getElementsByTagName("*")):
   keep_vml=name.endswith(".vml") and node.localName in ("Row","Column","Anchor","AutoFill","Locked","PrintObject","Visible","TextHAlign","TextVAlign","AutoPict")
   keep_property=name=="docProps/app.xml" and node.localName in ("Application","DocSecurity","ScaleCrop","LinksUpToDate","SharedDoc","HyperlinksChanged","AppVersion","i4","bool")
   keep_geometry=node.localName in ("posOffset","col","colOff","row","rowOff","x","y","cx","cy","align") and node.namespaceURI in ("http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing","http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing")
   if not keep_vml and not keep_property and not keep_geometry:
    for child in list(node.childNodes):
     if child.nodeType in (3,4): child.data=""
   if name=="docProps/core.xml" and node.localName in ("creator","lastModifiedBy"): put(node,"JEAuditFlow")
   if name=="docProps/core.xml" and node.localName=="title": put(node,"Public neutral template")
   if name=="docProps/core.xml" and node.localName=="revision": put(node,"1")
   if name=="docProps/app.xml" and node.localName in ("Pages","Words","Characters","CharactersWithSpaces","Lines","Paragraphs","TotalTime","Slides","Notes","HiddenSlides","MMClips"): put(node,"0")
   if "/charts/" in name and node.localName=="v": put(node,"0")
 if name.startswith("xl/worksheets/") and name.endswith(".xml"):
  for cell in elements(doc,S,"c"):
   for child in list(cell.childNodes):
    if child.nodeType==1 and child.localName in ("f","v","is","extLst"): drop(child)
   if cell.hasAttribute("t"): cell.removeAttribute("t")
  # Empty styled cells, row dimensions, merges, views and page geometry survive.
  for local in ("dataValidations","conditionalFormatting","headerFooter","extLst"):
   for node in elements(doc,S,local): drop(node)
 if name=="xl/workbook.xml":
  for local in ("definedNames","externalReferences","extLst","AlternateContent"):
   for node in list(doc.getElementsByTagName("*")):
    if node.localName==local: drop(node)
  for index,sheet in enumerate(elements(doc,S,"sheet")):
   old=sheet.getAttribute("name")
   if not re.fullmatch(r"(?:SYS|SWE|SUP|MAN|ACQ|SPL|HWE|MLE)\.\d+|Readme|Overview|Summary|Assessment Plan|Results Summary|Detailed Ratings|Work Products|Findings and Actions|Final Remark",old):
    sheet.setAttribute("name","Template "+str(index+1))
 if name.startswith("xl/tables/"):
  for index,node in enumerate(elements(doc,S,"tableColumn")): node.setAttribute("name","Field "+str(index+1))
 for node in list(doc.getElementsByTagName("*")):
  if node.localName in ("hlinkClick","hlinkMouseOver","docVars","docVar","attachedTemplate","mailMerge","recipientData","connection","connections","externalReference","definedNames","calcChain","custShowLst"):
   drop(node); continue
  if node.localName in ("created","modified","lastPrinted"): put(node,"2000-01-01T00:00:00Z")
  if node.localName=="cNvPr":
   node.setAttribute("name","Shape "+node.getAttribute("id"))
  for attribute in list(node.attributes.values()) if node.hasAttributes() else []:
   key=attribute.localName
   if any(character in attribute.value for character in "\r\n\t"):
    node.setAttribute(attribute.name,attribute.value.replace("\r"," ").replace("\n"," ").replace("\t"," "))
   if key in ("descr","title","tooltip","string","macro","url","author","personId","userId","codeName","location","instr","initials","displayName","email","login","userName"):
    node.setAttribute(attribute.name,"")
   if key in ("date","dateTime","dt","created","modified"): node.setAttribute(attribute.name,"2000-01-01T00:00:00Z")
   if node.localName in ("cmAuthor","person","author") and key=="name": node.setAttribute(attribute.name,"JEAuditFlow")
   if key=="formatCode": node.setAttribute(attribute.name,"General")
   if node.localName in ("docPr","cNvPr") and key=="name": node.setAttribute(attribute.name,"Shape "+node.getAttribute("id"))
 # Clear all comments, notes and extended metadata, including non-text-field tags.
 if name.startswith(("ppt/notesSlides/","ppt/comments/","word/comments","xl/comments")):
  for node in doc.getElementsByTagName("*"):
   for child in list(node.childNodes):
    if child.nodeType in (3,4): child.data=""
 if name=="docProps/app.xml":
  for node in doc.getElementsByTagName("*"):
   if node.localName not in ("Application","DocSecurity","ScaleCrop","LinksUpToDate","SharedDoc","HyperlinksChanged","AppVersion","i4","bool"):
    for child in list(node.childNodes):
     if child.nodeType in (3,4): child.data=""
 if name.endswith(".rels"):
  base=posixpath.dirname(name)
  base=base[:-6] if base.endswith("/_rels") else "" if base=="_rels" else base
  for relation in elements(doc,REL,"Relationship"):
   target=relation.getAttribute("Target")
   resolved=target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(base,target.split("#")[0]))
   if relation.getAttribute("TargetMode")=="External" or resolved in removed or resolved not in existing_parts: drop(relation)
 if name=="[Content_Types].xml":
  for override in elements(doc,CT,"Override"):
   if override.getAttribute("PartName").lstrip("/") in removed or override.getAttribute("PartName").lstrip("/") not in existing_parts: drop(override)
  existing={node.getAttribute("PartName"):node for node in elements(doc,CT,"Override")}
  for media in data["media"]:
   node=existing.get("/"+media)
   if node is None:
    prefix=doc.documentElement.prefix
    node=doc.createElementNS(CT,(prefix+":" if prefix else "")+"Override");node.setAttribute("PartName","/"+media);doc.documentElement.appendChild(node)
   node.setAttribute("ContentType","image/svg+xml" if media.lower().endswith(".svg") else "image/png")
# Remove dangling Office relationship attributes after deleted external/source parts.
for name,doc in docs.items():
 if not name.endswith(".xml") or name=="[Content_Types].xml": continue
 relname=posixpath.join(posixpath.dirname(name),"_rels",posixpath.basename(name)+".rels")
 relations=docs.get(relname)
 if relations is None: continue
 ids={node.getAttribute("Id") for node in elements(relations,REL,"Relationship")}
 for node in doc.getElementsByTagName("*"):
  for attribute in list(node.attributes.values()) if node.hasAttributes() else []:
   if attribute.namespaceURI==R and attribute.localName in ("id","embed","link") and attribute.value not in ids:
    if node.localName in ("sldId","notesMasterId","sldMasterId","sldLayoutId","sheet","externalReference"): drop(node)
    else: node.removeAttributeNode(attribute)
for doc in docs.values(): remove_empty_text(doc)
print(json.dumps({name:doc.toxml() for name,doc in docs.items()},ensure_ascii=True))
`;

async function candidateTarget(filename) {
  const root = await realpath(candidatesRoot);
  const target = path.resolve(String(filename || ""));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || relative === "..") throw new Error("Public template sanitization is restricted to candidate staging files");
  const candidate = await assertCandidateRoot(path.join(root, relative.split(path.sep)[0]), root);
  await assertCandidateOutputPath(candidate, target);
  if (!(await lstat(target)).isFile()) throw new Error("Public template must be a regular staged file");
  if (!Object.hasOwn(templateIds, path.basename(target))) throw new Error("Unsupported public report template");
  return { candidate, target };
}

export async function sanitizePublicReportTemplate(filename) {
  const { candidate, target } = await candidateTarget(filename);
  const name = path.basename(target);
  const input = await readFile(target);
  if (input.length > 12 * 1024 * 1024) throw new Error("Public template archive exceeds the build-time size limit");
  const archive = await JSZip.loadAsync(input, { checkCRC32: true });
  const parts = {}, removed = [], media = [];
  let size = 0;
  for (const [entryName, entry] of Object.entries(archive.files)) {
    if (entry.dir) {
      if (/^(?:\[trash\]\/|customXml\/|_xmlsignatures\/)|\/(?:embeddings|activeX|externalLinks|pivotCache|pivotTables|printerSettings)\/$/i.test(entryName)) removed.push(entryName);
      continue;
    }
    if (entryName.startsWith("/") || entryName.split("/").some(segment => segment === "..")) throw new Error("Invalid template archive path");
    size += Number(entry._data?.uncompressedSize || 0);
    if (size > 48 * 1024 * 1024) throw new Error("Public template contents exceed the build-time size limit");
    if (/^(?:\[trash\]\/|customXml\/|_xmlsignatures\/)|^docProps\/(?:thumbnail|custom)|\/(?:embeddings|activeX|externalLinks|pivotCache|pivotTables|printerSettings)\/|^xl\/(?:vbaProject|calcChain[.]xml)|[.](?:bin|dat)$/i.test(entryName)) {
      removed.push(entryName);
    } else if (/\/media\//.test(entryName)) {
      media.push(entryName);
    } else if (/\.(?:xml|rels|vml|svg)$/.test(entryName)) {
      parts[entryName] = await entry.async("string");
    } else throw new Error(`Unsupported report template part: ${entryName}`);
  }
  let transformed;
  try {
    transformed = JSON.parse(execFileSync(process.env.AUDITFLOW_TEMPLATE_PYTHON || "python3", ["-c", xmlTransform], { input: JSON.stringify({ filename: name, parts, removed, media }), encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }));
  } catch (cause) {
    const diagnostic = String(cause.stderr || cause.code || "").trim().split("\n").at(-1).slice(0, 180);
    throw new Error(`Public report template ${name} XML sanitization failed: ${diagnostic || "Python 3 with defusedxml is required"}`);
  }
  for (const entryName of removed) archive.remove(entryName);
  for (const [entryName, source] of Object.entries(transformed)) archive.file(entryName, source, { date: fixedDate });
  for (const entryName of media) archive.file(entryName, entryName.toLowerCase().endsWith(".svg") ? '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' : neutralPng, { date: fixedDate });
  archive.comment = "";
  for (const entry of Object.values(archive.files)) { entry.comment = ""; entry.date = fixedDate; }
  const output = await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await writeCandidateFile(candidate, target, output);
  const sha256 = hash(output);
  const manifestPath = path.join(path.dirname(target), "manifest.json");
  await assertCandidateOutputPath(candidate, manifestPath);
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch (cause) { if (cause.code !== "ENOENT") throw cause; manifest = { version: "public-neutral/1", templates: [] }; }
  const entries = Array.isArray(manifest.templates) ? manifest.templates : [];
  const ids = new Set(templateIds[name]);
  manifest.templates = entries.filter(entry => entry.file !== name && !ids.has(entry.id));
  for (const id of ids) manifest.templates.push({ id, file: name, source: "Public neutral template", sha256, strategy: "No source assessment data; neutral text and media preserve the report generation structure." });
  manifest.publicNeutralTemplates = true;
  await writeCandidateFile(candidate, manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return { filename: name, format: path.extname(name).slice(1), sha256, changedParts: Object.keys(transformed).concat(media), removedParts: removed };
}
