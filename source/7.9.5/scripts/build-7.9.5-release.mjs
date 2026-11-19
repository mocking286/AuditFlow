#!/usr/bin/env node
// Builds the JEAuditFlow 7.9.5 server-install release from this source tree.
//
//   node source/7.9.5/scripts/build-7.9.5-release.mjs \
//     --backend-zip <uploaded JEAuditFlow-7.9.5-Backend.zip> --out <directory>
//
// The uploaded 7.9.5 backend zip supplies only the two binary jars (JiraFlow
// and MySQL Connector/J), which the repository does not store. The web client
// is assembled from the 7.7.0 public client source because no 7.9.5 client
// source or Web-Client package was published.

import { cp, chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createChecksumManifest,
  removeTestFixturePayloads,
  stampClientVersion,
  validateClientModuleResources,
  validateLocalHtmlResources
} from "../../7.7.0/scripts/package-7.3-release-helpers.mjs";

const VERSION = "7.9.5";
const CLIENT_SOURCE_VERSION = "7.7.0";
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = path.resolve(sourceRoot, "../7.7.0/src/AuditFlowDesktop/WebApp");
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1]]);
  return pairs;
}, []));
if (!args["backend-zip"] || !args.out) {
  console.error("Usage: build-7.9.5-release.mjs --backend-zip <JEAuditFlow-7.9.5-Backend.zip> --out <directory>");
  process.exit(2);
}
const backendZip = path.resolve(args["backend-zip"]);
const outRoot = path.resolve(args.out);
const stageRoot = path.join(outRoot, ".staging");
const generatedAt = new Date().toISOString();

const sha256 = file => createHash("sha256").update(readFileSync(file)).digest("hex");
const run = (command, argv, cwd) => execFileSync(command, argv, { cwd, stdio: ["ignore", "inherit", "inherit"] });
const writeJson = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

const webClientFiles = [
  "index.html", "app.js", "backend-client.js", "local-extension-mode.js", "auth-gate.js",
  "auth-gate.css", "web-auth.js", "i18n.js", "theme-init.js", "issues-module.js",
  "ai-harness.css", "ai-harness-ui.js", "ai-harness.mjs", "helix-export-model.mjs",
  "issues-v61.css", "styles.css", "styles-v2.css", "workbench-v10.css",
  "jeauditflow-v20.css", "jira-v68.css", "trace-v73.css", "trace-v75.css",
  "trace-v76.css", "trace-v77.css", "trace-v78.css", "trace-v79.css", "trace-v80.css",
  "trace-v81.css", "trace-v82.css", "trace-v83.css", "trace-v84.css", "trace-v85.css",
  "trace-v86.css", "workbench-routing.js", "workbench-bootstrap.js",
  "workbench-fileanalyst-link.js", "workbench-jiraflow-link.js", "workbench-lessonlearn-link.js",
  "fileanalyst-config.js", "process-canvases.js", "process-canvases.css",
  "record-consolidation-v48.css", "report-templates.js", "report-templates.css",
  "tmm-assessment-data.js", "external-assessment-data.js", "cep-xp-assessment-data.js",
  "mbeal-targeted-issues.js", "aspice-v40-model.js", "aspice-training-reference.js",
  "sqe-ppap-reference.js", "tuv-aspice-issue-reference.js", "tuv-issue-ledger-guard.js",
  "workbench-nav-menu.js", "ops.html", "ops-ui.css", "ops-dashboard.js",
  "codex-assistant.js", "codex-assistant.css", "qa-checklist-v6.css", "ux-enhance.js",
  "v6-enhancements.js", "v6-enhancements.css", "v23-enhancements.js", "v23-enhancements.css",
  "project-data-gateway.js", "codex-project-session.js", "codex-project-session.css",
  "telemetry-client.js", "help-manual.html", "help-manual.js",
  "sup-qa-checklist-catalog.js", "qa-checklist-workflow.js", "document-review-checklist-model.mjs",
  "aspice-audit-master-2.3.1.html", "aspice-audit-master-2.3.1-en.html", "portal.html", "portal.js",
  "desktop.html", "desktop-shell.js", "evidence-catalog.js", "workbench-release-v75.css",
  "nc-jiraflow-model.js", "feedback-modal.js", "feedback-modal.css", "upload-routing.mjs",
  "bridge-workbench.js", "bridge-workbench.css", "assessment-tasks.mjs",
  // The API serves landing.html at "/"; the 7.x packager added these from the
  // extension build, which is not part of this release.
  "landing.html", "landing-host.html", "landing-host.js", "landing-promo.html", "favicon.svg"
];
const clientDirectories = [
  "icons", "vendor", "templates", "reference-models", "downloads", "lessonlearn",
  "assets", "next-static", "next-runtime"
];

async function copyListed(from, to, names) {
  await mkdir(to, { recursive: true });
  for (const name of names) {
    const source = path.join(from, name);
    if (!existsSync(source)) throw new Error(`Missing client source ${source}`);
    await cp(source, path.join(to, name), { recursive: true, force: true });
  }
}

async function zipDirectory(root, archive) {
  await rm(archive, { force: true });
  run("zip", ["-qr", "-X", archive, "."], root);
  run("unzip", ["-tqq", archive]);
}

async function normalizeModes(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) { await chmod(file, 0o755); await normalizeModes(file); }
    else await chmod(file, /\.sh$/.test(entry.name) ? 0o755 : 0o644);
  }
}

// stampClientVersion only rewrites <title> and app.js constants. The landing
// page, portal and their Next.js payloads also print the product version. The
// help manual and manual PDFs stay 7.7.0 because their content is the 7.7 manual.
async function stampBranding(root) {
  const files = ["landing.html", "landing-promo.html", "portal.html"].map(name => path.join(root, name));
  for (const directory of ["next-runtime", "next-static"]) {
    const visit = async dir => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await visit(file);
        else if (/\.(?:m?js|html)$/.test(entry.name)) files.push(file);
      }
    };
    await visit(path.join(root, directory));
  }
  const from = CLIENT_SOURCE_VERSION.replaceAll(".", "\\.");
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const updated = source
      .replace(new RegExp(`JEAuditFlow ${from}`, "g"), `JEAuditFlow ${VERSION}`)
      .replace(new RegExp(`\\bv${from}\\b`, "g"), `v${VERSION}`);
    if (updated !== source) await writeFile(file, updated);
  }
}

async function buildWebClient() {
  const root = path.join(stageRoot, "web-client");
  await copyListed(webRoot, root, [...webClientFiles, ...clientDirectories]);
  const fileanalyst = path.join(root, "fileanalyst");
  await cp(path.join(webRoot, "fileanalyst", "client"), fileanalyst, { recursive: true });
  await cp(path.join(webRoot, "fileanalyst", "bootstrap.js"), path.join(fileanalyst, "bootstrap.js"));
  await removeTestFixturePayloads(root);
  await stampClientVersion(root, VERSION);
  await stampBranding(root);
  await validateLocalHtmlResources(root);
  await validateClientModuleResources(root);
  await writeJson(path.join(root, "runtime-config.json"), { apiBaseUrl: ".", sameOrigin: true });
  await writeJson(path.join(root, "manifest.json"), {
    product: "JEAuditFlow",
    version: VERSION,
    packageType: "web-client",
    apiContractVersion: "1.0.0",
    compatibleBackendRange: "7.9.x",
    clientSourceVersion: CLIENT_SOURCE_VERSION,
    clientSourceNote: "Assembled from the published 7.7.0 client source; the 7.9.5 client package was not available.",
    runtimeConfiguration: "runtime-config.json",
    generatedAt,
    containsCredentials: false
  });
  await normalizeModes(root);
  await writeFile(path.join(root, "SHA256SUMS.txt"), await createChecksumManifest(root));
  const archive = path.join(outRoot, `JEAuditFlow-${VERSION}-Web-Client.zip`);
  await zipDirectory(root, archive);
  return archive;
}

async function buildBackend() {
  const root = path.join(stageRoot, "backend");
  await mkdir(root, { recursive: true });
  for (const name of ["server", "fileanalyst"]) await cp(path.join(sourceRoot, "backend", name), path.join(root, name), { recursive: true });
  const jarRoot = path.join(stageRoot, "backend-zip");
  run("unzip", ["-q", "-o", backendZip, "jiraflow/*", "-d", jarRoot]);
  await cp(path.join(jarRoot, "jiraflow"), path.join(root, "jiraflow"), { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, "backend", "manifest.json"), "utf8"));
  const jar = path.join(root, "jiraflow", "jiraflow.jar");
  if (sha256(jar) !== manifest.jiraFlow.jarSha256) throw new Error("jiraflow.jar does not match manifest.jiraFlow.jarSha256");
  if (!existsSync(path.join(root, "jiraflow", "lib", "mysql-connector-j-26.10.0.jar"))) throw new Error("MySQL Connector/J jar is missing");
  for (const name of ["server", "fileanalyst"]) {
    run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], path.join(root, name));
    run("npm", ["run", "check", "--silent"], path.join(root, name));
  }
  manifest.webClientPackage = `JEAuditFlow-${VERSION}-Web-Client.zip`;
  manifest.webClientSourceVersion = CLIENT_SOURCE_VERSION;
  manifest.databasePackage = `JEAuditFlow-${VERSION}-Database.zip`;
  manifest.bundledNodeModules = true;
  manifest.runtime = { node: ">=26.13.1", java: ">=21", mysql: ">=8.0" };
  manifest.generatedAt = generatedAt;
  await writeJson(path.join(root, "manifest.json"), manifest);
  await normalizeModes(root);
  await writeFile(path.join(root, "SHA256SUMS.txt"), await createChecksumManifest(root));
  const archive = path.join(outRoot, `JEAuditFlow-${VERSION}-Backend.zip`);
  await zipDirectory(root, archive);
  return archive;
}

async function buildDatabase() {
  const name = `JEAuditFlow-${VERSION}-Database`;
  const root = path.join(stageRoot, name);
  await cp(path.join(sourceRoot, "database"), root, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  manifest.generatedAt = generatedAt;
  await writeJson(path.join(root, "manifest.json"), manifest);
  await normalizeModes(root);
  await writeFile(path.join(root, "SHA256SUMS.txt"), await createChecksumManifest(root));
  const zip = path.join(outRoot, `${name}.zip`);
  await zipDirectory(root, zip);
  const tar = path.join(outRoot, `${name}.tar.gz`);
  run("tar", ["--no-xattrs", "--owner=0", "--group=0", "--numeric-owner", "-czf", tar, "-C", stageRoot, name]);
  return [zip, tar];
}

async function buildServerInstall(backend, webClient, databaseZip) {
  const name = `JEAuditFlow-${VERSION}-Server-Install`;
  const root = path.join(stageRoot, name);
  await mkdir(root, { recursive: true });
  for (const file of [backend, webClient, databaseZip]) await cp(file, path.join(root, path.basename(file)));
  await cp(path.join(sourceRoot, "deploy"), path.join(root, "deploy"), { recursive: true });
  await cp(path.join(sourceRoot, "deploy", "install.sh"), path.join(root, "install.sh"));
  for (const doc of ["INSTALL-7.9.5-ZH.md", "FIXES-7.9.5-ZH.md"]) {
    const file = path.resolve(sourceRoot, "../../releases/7.9.5", doc);
    if (existsSync(file)) await cp(file, path.join(root, doc));
  }
  await normalizeModes(root);
  const archives = (await readdir(root)).filter(file => /\.zip$/.test(file)).sort();
  await writeFile(path.join(root, "SHA256SUMS.txt"), archives.map(file => `${sha256(path.join(root, file))}  ${file}`).join("\n") + "\n");
  const tar = path.join(outRoot, `${name}.tar.gz`);
  run("tar", ["--no-xattrs", "--owner=0", "--group=0", "--numeric-owner", "-czf", tar, "-C", stageRoot, name]);
  return tar;
}

await rm(stageRoot, { recursive: true, force: true });
await mkdir(stageRoot, { recursive: true });
const webClient = await buildWebClient();
const backend = await buildBackend();
const [databaseZip, databaseTar] = await buildDatabase();
const serverInstall = await buildServerInstall(backend, webClient, databaseZip);
const kinds = new Map([[serverInstall, "server-install-bundle"], [backend, "backend-api"], [webClient, "web-client"], [databaseZip, "database-zip"], [databaseTar, "database-tar-gz"]]);
const artifacts = [...kinds].map(([file, kind]) => ({ file: path.basename(file), sizeBytes: statSync(file).size, sha256: sha256(file), kind }));
await writeJson(path.join(outRoot, "release-manifest.json"), {
  product: "JEAuditFlow",
  version: VERSION,
  candidate: false,
  generatedAt,
  deployment: { target: "linux-server", mode: "bare-metal systemd + nginx", node: ">=26.13.1", java: ">=21", mysql: ">=8.0" },
  clientCompatibility: { apiContractVersion: "1.0.0", backendRange: "7.9.x", webClientSourceVersion: CLIENT_SOURCE_VERSION },
  database: { name: "jeauditflow_795", port: 43327, schemaVersion: 29, ddlChanged: false },
  notIncluded: [
    { file: `JEAuditFlow-${VERSION}-Browser-Extension.zip`, reason: "Not supplied with the 7.9.5 inputs and not rebuildable from published source." }
  ],
  artifacts
});
await writeFile(path.join(outRoot, "SHA256SUMS.txt"), artifacts.map(item => `${item.sha256}  ${item.file}`).join("\n") + "\n");
await rm(stageRoot, { recursive: true, force: true });
console.log(artifacts.map(item => `${item.sha256}  ${item.file}  ${item.sizeBytes}`).join("\n"));
