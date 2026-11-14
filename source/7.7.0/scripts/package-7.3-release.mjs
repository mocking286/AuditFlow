#!/usr/bin/env node

import { chmod, cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { releaseProfile, rewriteDatabaseReleaseText } from "./package-release-profiles.mjs";
import { sanitizePublicReleaseData } from "./package-public-data.mjs";
import {
  assertCandidateRoot,
  assertCandidateOutputPath,
  assertNoTestFixturePaths,
  applyJiraFlowReleaseOverlay,
  copyBuiltPromoAssets,
  createChecksumManifest,
  createPortableTarArchive,
  jiraFlowManifest,
  jiraFlowSourceSha256,
  prepareReleaseManualAssets,
  requireJiraFlowJar,
  removeTestFixturePayloads,
  stampClientVersion,
  validateClientModuleResources,
  validateLocalHtmlResources,
  writeCandidateFile
} from "./package-7.3-release-helpers.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = process.env.AUDITFLOW_RELEASE_VERSION || "7.3.0";
const profile = releaseProfile(version);
let candidateRoot = path.resolve(process.env.AUDITFLOW_CANDIDATE_ROOT || path.join(projectRoot, "artifacts", "candidates", `${version}-candidate`));
const webRoot = path.join(projectRoot, "src", "AuditFlowDesktop", "WebApp");
const databaseSource = existsSync(path.join(projectRoot, "database", profile.databaseSourceVersion))
  ? path.join(projectRoot, "database", profile.databaseSourceVersion)
  : path.join(projectRoot, "local-deploy", "runtime", "database", profile.databaseSourceVersion);
const extensionBuilder = path.join(projectRoot, "scripts", "build-candidate-extension-67-20261024.mjs");
const serverRuntimeFiles = [
  "server.mjs", "trusted-proxy-origin.mjs", "engine.mjs", "collaboration-store.mjs", "collaboration-model.mjs",
  "mysql-collaboration-store.mjs", "bootstrap.mjs", "core-project-bootstrap.mjs",
  "report-templates.mjs", "ops-service.mjs", "local-content-contract.mjs",
  "local-content-store.mjs", "harness-run-ledger.mjs", "unlimited-ocr-mcp.mjs", "bridge-session.mjs",
  "document-visual-ocr.mjs", "copilot-direct-line.mjs", "copilot-source.mjs",
  "assessment-tasks.mjs", "microsoft-oidc.mjs", "microsoft-graph-mail.mjs",
  "assessment-mail.mjs", "outlook-desktop-mail.mjs", "jira-rest-channel.mjs", "jira-finding-integration.mjs",
  "auth-gate.mjs", "aspice-training-reference.js", "sup-qa-checklist-catalog.js",
  "qa-checklist-workflow.js", "cep-xp-assessment-data.js", "external-assessment-data.js",
  "aspice-audit-master-2.3.1.html", "aspice-audit-master-2.3.1-en.html",
  "backend-config.json", "package.json", "package-lock.json",
  "aspice-audit-master-2.3.1.html", "aspice-audit-master-2.3.1-en.html"
];
const webClientFiles = [
  "index.html", "app.js", "backend-client.js", "local-extension-mode.js", "auth-gate.js",
  "auth-gate.css", "web-auth.js", "i18n.js", "theme-init.js", "issues-module.js",
  "ai-harness.css", "ai-harness-ui.js", "helix-export-model.mjs",
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
  "workbench-jiraflow-link.js", "project-data-gateway.js", "codex-project-session.js",
  "codex-project-session.css", "telemetry-client.js", "help-manual.html", "help-manual.js",
  "sup-qa-checklist-catalog.js", "qa-checklist-workflow.js", "document-review-checklist-model.mjs",
  "aspice-audit-master-2.3.1.html", "aspice-audit-master-2.3.1-en.html", "portal.html", "portal.js",
  "document-review-checklist-model.mjs", "aspice-audit-master-2.3.1.html", "aspice-audit-master-2.3.1-en.html",
  "desktop.html", "desktop-shell.js", "manifest.json", "evidence-catalog.js", "workbench-release-v75.css", "nc-jiraflow-model.js",
  "feedback-modal.js", "feedback-modal.css", "upload-routing.mjs", "bridge-workbench.js", "bridge-workbench.css",
  "assessment-tasks.mjs"
];
const clientDirectories = ["icons", "vendor", "templates", "reference-models", "downloads", "lessonlearn"];
const ignoredNames = new Set([".git", "node_modules", "output", "logs", ".runs", ".idea", ".env", ".DS_Store", "__MACOSX", ".jiraflow-data", "store.bin"]);

function assertExists(file, label = file) {
  if (!existsSync(file)) throw new Error(`Missing ${label}: ${file}`);
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function copyTree(source, destination) {
  assertExists(source);
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (ignoredNames.has(entry.name) || entry.name.endsWith(".tmp")) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else await cp(from, to, { force: true });
  }
}

async function copyFiles(source, destination, names) {
  await mkdir(destination, { recursive: true });
  for (const name of names) {
    const from = path.join(source, name);
    if (existsSync(from)) await cp(from, path.join(destination, name), { force: true, recursive: true });
  }
}

async function copyFileAnalystClient(destination) {
  const source = path.join(webRoot, "fileanalyst", "client");
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name === "tests" || entry.name.endsWith(".test.mjs")) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else await cp(from, to, { force: true });
  }
  const bootstrap = path.join(webRoot, "fileanalyst", "bootstrap.js");
  assertExists(bootstrap, "FileAnalyst browser bootstrap");
  await cp(bootstrap, path.join(destination, "bootstrap.js"), { force: true });
}

async function copyFileAnalystRuntime(destination) {
  const source = path.join(webRoot, "fileanalyst");
  const files = ["server.mjs", "requirements.mjs", "document-library.mjs", "view-models.mjs", "package.json", "package-lock.json", "migrate-attachments-to-mysql.mjs"];
  await copyFiles(source, destination, files);
}

async function walkFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else files.push(file);
    }
  }
  await visit(root);
  return files;
}

function run(command, args, cwd = projectRoot, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? "unknown"})`);
}

async function zipDirectory(root, archive) {
  await assertCandidateOutputPath(candidateRoot, archive);
  await rm(archive, { force: true });
  run("zip", ["-qr", "-X", archive, "."], root);
  run("unzip", ["-tqq", archive]);
  const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
    .split(/\r?\n/)
    .map(entry => entry.trim())
    .filter(Boolean);
  assertNoTestFixturePaths(entries, path.basename(archive));
}

async function createWebClient(manualRoot, extensionRoot, apiContractVersion) {
  const root = path.join(candidateRoot, "web-client-staging");
  await assertCandidateOutputPath(candidateRoot, root);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await copyFiles(webRoot, root, webClientFiles);
  if (["7.6.0", "7.7.0"].includes(version)) {
    for (const name of ["feedback-modal.js", "feedback-modal.css", "upload-routing.mjs", "bridge-workbench.js", "bridge-workbench.css"]) {
      assertExists(path.join(root, name), `${version} required client asset ${name}`);
    }
  }
  for (const name of clientDirectories) {
    const source = path.join(webRoot, name);
    if (existsSync(source)) await copyTree(source, path.join(root, name));
  }
  await copyFileAnalystClient(path.join(root, "fileanalyst"));
  await stampClientVersion(root, version);
  await prepareReleaseManualAssets(root, manualRoot, version);
  await copyBuiltPromoAssets(extensionRoot, root);
  await removeTestFixturePayloads(root);
  if (["7.6.0", "7.7.0"].includes(version)) await sanitizePublicReleaseData({ candidateRoot, stagingRoot: root });
  if (["7.5.0", "7.6.0", "7.7.0"].includes(version)) {
    for (const name of ["workbench-nav-menu.js", "evidence-catalog.js", "workbench-release-v75.css", "nc-jiraflow-model.js"]) {
      assertExists(path.join(root, name), `${version} web client asset ${name}`);
    }
  }
  await validateLocalHtmlResources(root);
  await validateClientModuleResources(root);
  const manifest = {
    product: "JEAuditFlow",
    version,
    packageType: "web-client",
    apiContractVersion,
    compatibleBackendRange: `${version.slice(0, 3)}.x`,
    runtimeConfiguration: "runtime-config.json",
    generatedAt: new Date().toISOString(),
    containsCredentials: false
  };
  await writeCandidateFile(root, path.join(root, "runtime-config.json"), `${JSON.stringify({ apiBaseUrl: ".", sameOrigin: true }, null, 2)}\n`);
  await writeCandidateFile(root, path.join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeCandidateFile(root, path.join(root, "SHA256SUMS.txt"), await createChecksumManifest(root));
  const archive = path.join(candidateRoot, `JEAuditFlow-${version}-Web-Client.zip`);
  await zipDirectory(root, archive);
  return { root, archive, manifest };
}

async function buildJiraFlow() {
  const publishedSource = path.join(projectRoot, "src", "JiraFlow");
  const baseSource = existsSync(publishedSource) ? publishedSource : path.join(projectRoot, "local-deploy", "runtime", "versions", "7.2.0", "jiraflow");
  const buildRoot = path.join(candidateRoot, "build-inputs", "jiraflow");
  const sourceRoot = path.join(buildRoot, "source");
  await assertCandidateOutputPath(candidateRoot, sourceRoot);
  await rm(sourceRoot, { recursive: true, force: true });
  for (const directory of ["src/main/java", "src/main/resources"]) {
    const source = path.join(baseSource, directory);
    if (existsSync(source)) await copyTree(source, path.join(sourceRoot, directory));
  }
  if (["7.5.0", "7.6.0", "7.7.0"].includes(version) && !existsSync(publishedSource)) {
    const overlayRoot = path.join(projectRoot, "src", "JiraFlow75");
    await applyJiraFlowReleaseOverlay({ candidateRoot, sourceRoot, overlayRoot, version: "7.5.0" });
  }
  const javaRoot = path.join(sourceRoot, "src", "main", "java");
  const resourcesRoot = path.join(sourceRoot, "src", "main", "resources");
  const classesRoot = path.join(buildRoot, "classes");
  const jarPath = path.join(buildRoot, "jiraflow.jar");
  assertExists(javaRoot, "JiraFlow Java source");
  const javaFiles = (await walkFiles(javaRoot)).filter(file => file.endsWith(".java")).sort();
  if (!javaFiles.length) throw new Error("JiraFlow Java source tree is empty");
  await assertCandidateOutputPath(candidateRoot, buildRoot);
  await assertCandidateOutputPath(candidateRoot, classesRoot);
  await assertCandidateOutputPath(candidateRoot, jarPath);
  await rm(classesRoot, { recursive: true, force: true });
  await mkdir(classesRoot, { recursive: true });
  run("javac", ["--release", "21", "-encoding", "UTF-8", "-d", classesRoot, ...javaFiles]);
  if (existsSync(resourcesRoot)) await copyTree(resourcesRoot, classesRoot);
  const sourceSha256 = await jiraFlowSourceSha256(sourceRoot);
  let jiraClassPath = "";
  if (version === "7.7.0") {
    const connectorRoot = path.join(projectRoot, "local-deploy", "runtime", "toolchains");
    const connector = path.join(connectorRoot, "mysql-connector-j-26.10.0.jar");
    assertExists(connector, "MySQL Connector/J 26.10.0 verified runtime");
    const libRoot = path.join(buildRoot, "lib");
    await assertCandidateOutputPath(candidateRoot, libRoot);
    await mkdir(libRoot, { recursive: true });
    await cp(connector, path.join(libRoot, path.basename(connector)), { force: true });
    jiraClassPath = `Class-Path: lib/${path.basename(connector)}`;
  }
  const manifestPath = path.join(buildRoot, "MANIFEST.MF");
  await writeCandidateFile(candidateRoot, manifestPath, [
    "Manifest-Version: 1.0",
    "Main-Class: com.jiraflow.JiraFlowServer",
    "JEAuditFlow-JiraFlow-Version: 2.1.0",
    `JEAuditFlow-Release-Version: ${version}`,
    `JEAuditFlow-Source-SHA256: ${sourceSha256}`,
    jiraClassPath,
    ""
  ].join("\n"));
  await rm(jarPath, { force: true });
  run("jar", ["--create", "--file", jarPath, "--manifest", manifestPath, "-C", classesRoot, "."]);
  const validatedJar = requireJiraFlowJar(jarPath, projectRoot, { releaseVersion: version, sourceSha256 });
  return {
    jarPath: validatedJar,
    sourceSha256,
    manifest: jiraFlowManifest(validatedJar, { releaseVersion: version, sourceSha256 })
  };
}

async function createBackend(clientManifest, jiraFlow) {
  const root = path.join(candidateRoot, "backend-staging");
  await assertCandidateOutputPath(candidateRoot, root);
  await rm(root, { recursive: true, force: true });
  const serverRoot = path.join(root, "server");
  await copyFiles(webRoot, serverRoot, serverRuntimeFiles);
  const pkgPath = path.join(serverRoot, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  pkg.name = `jeauditflow-${version}-api-server`;
  pkg.version = version;
  pkg.scripts = { ...pkg.scripts, start: "node server.mjs serve" };
  if (version === "7.7.0") pkg.engines = { ...pkg.engines, node: ">=26.13.1" };
  await writeCandidateFile(root, pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  const lockPath = path.join(serverRoot, "package-lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  lock.name = pkg.name;
  lock.version = version;
  if (lock.packages?.[""]) {
    lock.packages[""].name = pkg.name;
    lock.packages[""].version = version;
    if (version === "7.7.0") lock.packages[""].engines = pkg.engines;
  }
  await writeCandidateFile(root, lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  const configPath = path.join(serverRoot, "backend-config.json");
  const config = existsSync(configPath)
    ? JSON.parse(await readFile(configPath, "utf8"))
    : { outputDir: "output", ai: { enabled: false, provider: "deepseek", protocol: "chat-completions", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKey: "" } };
  config.port = profile.auditflowPort;
  await writeCandidateFile(root, configPath, `${JSON.stringify(config, null, 2)}\n`);
  const fileanalystSource = path.join(webRoot, "fileanalyst");
  if (existsSync(fileanalystSource)) await copyFileAnalystRuntime(path.join(root, "fileanalyst"));
  await mkdir(path.join(root, "jiraflow"), { recursive: true });
  await cp(jiraFlow.jarPath, path.join(root, "jiraflow", "jiraflow.jar"), { force: true });
  if (version === "7.7.0") {
    await cp(path.join(candidateRoot, "build-inputs/jiraflow/lib"), path.join(root, "jiraflow/lib"), { recursive: true });
  }
  await removeTestFixturePayloads(root);
  if (["7.6.0", "7.7.0"].includes(version)) await sanitizePublicReleaseData({ candidateRoot, stagingRoot: root });
  await validateClientModuleResources(serverRoot);
  assertExists(path.join(root, "server", "server.mjs"), "API entrypoint");
  assertExists(path.join(root, "server", "cep-xp-assessment-data.js"), "CEP bootstrap assessment data");
  assertExists(path.join(root, "server", "external-assessment-data.js"), "external bootstrap assessment data");
  assertExists(path.join(root, "fileanalyst", "server.mjs"), "FileAnalyst API");
  assertExists(path.join(root, "jiraflow", "jiraflow.jar"), "JiraFlow runtime");
  const manifest = {
    product: "JEAuditFlow",
    version,
    packageType: "backend-api",
    apiContractVersion: clientManifest.apiContractVersion,
    supportedClientRange: `${version.slice(0, 3)}.x`,
    modules: ["auditflow-api", "fileanalyst-api", "jiraflow"],
    directories: ["server", "fileanalyst", "jiraflow"],
    jiraFlow: { ...jiraFlow.manifest, jarSha256: sha256(path.join(root, "jiraflow", "jiraflow.jar")) },
    webClientPackage: `JEAuditFlow-${version}-Web-Client.zip`,
    databasePackage: `JEAuditFlow-${version}-Database.zip`,
    databaseWritesPerformed: false,
    containsCredentials: false,
    generatedAt: new Date().toISOString()
  };
  await writeCandidateFile(root, path.join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of await walkFiles(root)) {
    if (file.endsWith(".mjs")) run(process.execPath, ["--check", file]);
  }
  for (const file of (await walkFiles(root)).sort()) {
    if (/\.(?:mjs|js|json|html|css|md|txt|env|sql)$/i.test(file)) {
      const content = await readFile(file, "utf8");
      if (/\bsk-[A-Za-z0-9]{20,}\b/.test(content)) throw new Error(`Refusing to package a likely API key from ${file}`);
    }
  }
  await writeCandidateFile(root, path.join(root, "SHA256SUMS.txt"), await createChecksumManifest(root));
  const archive = path.join(candidateRoot, `JEAuditFlow-${version}-Backend.zip`);
  await zipDirectory(root, archive);
  return { root, archive, manifest };
}

async function createDatabase() {
  assertExists(path.join(databaseSource, "manifest.json"), `${version} database source manifest`);
  const root = path.join(candidateRoot, "database", `JEAuditFlow-${version}-Database`);
  await assertCandidateOutputPath(candidateRoot, root);
  await rm(root, { recursive: true, force: true });
  await copyTree(databaseSource, root);
  for (const file of await walkFiles(root)) {
    if (!/\.(?:env|example|md|yaml|yml|json|js|mjs|sh|sql|txt)$/i.test(file) || path.basename(file) === "SHA256SUMS.txt") continue;
    const source = await readFile(file, "utf8");
    await writeCandidateFile(root, file, rewriteDatabaseReleaseText(source, profile, path.relative(root, file)));
  }
  if (version === "7.7.0") {
    await cp(path.join(projectRoot, "local-deploy/templates/7.7.jiraflow-schema.sql"),
      path.join(root, "schema/jiraflow-schema.sql"));
    await cp(path.join(projectRoot, "local-deploy/templates/7.7.database-README.md"), path.join(root, "README.md"));
    for (const file of ["install-schema.sh", "migrate.sh", "healthcheck.sh"]) {
      await cp(path.join(projectRoot, "local-deploy/templates/7.7.native-database.sh"), path.join(root, file));
      await chmod(path.join(root, file), 0o755);
    }
    for (const file of ["compose.yaml", "lib/mysql-common.sh", "import/import-cep-issues.sh"]) {
      await rm(path.join(root, file), { force: true });
    }
  }
  const manifestPath = path.join(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = version;
  manifest.defaultDatabase = profile.databaseName;
  manifest.defaultPort = profile.databasePort;
  manifest.persistentVolume = profile.databaseVolume;
  manifest.localHarnessComposeProject = profile.composeProject;
  manifest.sourceSchemaVersion = profile.databaseSourceVersion;
  manifest.schemaVersion = version === "7.7.0" ? 29 : 28;
  manifest.ddlChanged = version === "7.7.0";
  if (version === "7.7.0") {
    manifest.database = "MySQL 26.10";
    manifest.deploymentMode = "native";
    manifest.storageEngine = "InnoDB";
    manifest.schemaFiles = [...new Set([...(manifest.schemaFiles || []), "schema/jiraflow-schema.sql"])];
    manifest.importers = (manifest.importers || []).filter(file => file !== "import/import-cep-issues.sh");
  }
  manifest.package = "database";
  manifest.containsUserData = false;
  manifest.containsCredentials = false;
  manifest.generatedAt = new Date().toISOString();
  await writeCandidateFile(root, manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await removeTestFixturePayloads(root);
  await writeCandidateFile(root, path.join(root, "SHA256SUMS.txt"), await createChecksumManifest(root));
  const zip = path.join(candidateRoot, `JEAuditFlow-${version}-Database.zip`);
  const tar = path.join(candidateRoot, `JEAuditFlow-${version}-Database.tar.gz`);
  await zipDirectory(root, zip);
  await assertCandidateOutputPath(candidateRoot, tar);
  await rm(tar, { force: true });
  createPortableTarArchive(root, tar);
  run("tar", ["-tzf", tar]);
  return { root, zip, tar, manifest };
}

async function writeCandidateNotes() {
  const notes = `# JEAuditFlow ${version} Candidate Release Notes

Status: local candidate build; not installed or deployed.

## Packages

- \`JEAuditFlow-${version}-Web-Client.zip\`: independently installable browser client.
- \`JEAuditFlow-${version}-Backend.zip\`: API, FileAnalyst service, and JiraFlow runtime.
- \`JEAuditFlow-${version}-Browser-Extension.zip\`: browser deployment adapter with API contract metadata.
- \`JEAuditFlow-${version}-Database.zip\` and \`JEAuditFlow-${version}-Database.tar.gz\`: fresh-install schema and migration tooling.
${version === "7.5.0" ? `
## 7.5 Workflow Changes

- NC / Finding records live in Record Form and synchronize with their corresponding JiraFlow project.
- JiraFlow issues can be imported into NC tracking with provenance and duplicate protection.
- Browser navigation includes its menu controller and initially hidden panels.
- Evidence selection retains implementation requirements, architecture/design objects and verification items for assessor tracing.
- Record Consolidation assigns evidence identifiers and supports process-based categories and filters.
` : ""}

## Data and Security Boundaries

- The database package targets only \`jeauditflow_${version.replaceAll(".", "")}\`, volume \`jeauditflow_${version.replaceAll(".", "")}_mysql_data\`, and its isolated loopback port.
- ${version === "7.7.0" ? "Schema version 29 adds the native InnoDB JiraFlow snapshot table. Building the package does not apply the schema or migrate user data." : "Schema version 28 is carried forward because this candidate contains no DDL change. No database container, schema migration, import, or user-data write was performed."}
- The existing source release directory and its checksummed packages remain unchanged.
- No provider API key, tenant token, or service credential is embedded in source or package files. Configure only a rotated provider credential through the protected runtime settings path.
- The remote MCP catalog is read-only and process-scoped. Local protocol tests do not establish Microsoft Entra tenant onboarding or Edge Copilot connectivity; an authorized Copilot Studio tool call remains an external acceptance gate.
- AI candidates and JiraFlow mirrored statuses do not finalize ASPICE ratings, confirm evidence, or close formal findings.

## Acceptance Limits

This candidate has not been installed, launched against a database, deployed to production, or tested against a clean machine. Performance improvement has not been claimed because a same-fixture 7.2.0 baseline comparison has not been run.
`;
  const readme = `# JEAuditFlow ${version} Candidate

This directory contains an isolated local ${version} candidate build for review. It is not a production release and has not been installed.

See \`RELEASE_NOTES_v${version.replace(/\.\d+$/, "")}.md\` and \`release-manifest.json\` for package versions, compatibility, checksums, and validation boundaries. This build does not migrate or write the source database.
`;
  await writeCandidateFile(candidateRoot, path.join(candidateRoot, `RELEASE_NOTES_v${version.replace(/\.\d+$/, "")}.md`), notes);
  await writeCandidateFile(candidateRoot, path.join(candidateRoot, "CANDIDATE-README.md"), readme);
}

function artifactRecord(file, kind) {
  return { file: path.basename(file), sizeBytes: readFileSync(file).byteLength, sha256: sha256(file), kind, integrity: "passed" };
}

async function main() {
  candidateRoot = await assertCandidateRoot(candidateRoot, path.join(projectRoot, "artifacts", "candidates"));
  await mkdir(candidateRoot, { recursive: true });
  const manualRoot = path.join(candidateRoot, "build-inputs", "manuals");
  await assertCandidateOutputPath(candidateRoot, manualRoot);
  await mkdir(manualRoot, { recursive: true });
  for (const language of ["EN", "ZH"]) {
    await assertCandidateOutputPath(candidateRoot, path.join(manualRoot, `JEAuditFlow-Operation-Manual-${version}-${language}.pdf`));
  }
  run(process.execPath, [path.join(projectRoot, "scripts", "generate-7.0-manual-pdfs.mjs")], projectRoot, {
    ...process.env,
    AUDITFLOW_RELEASE_VERSION: version,
    AUDITFLOW_MANUAL_OUTPUT_DIR: manualRoot
  });
  const sourcePackage = JSON.parse(await readFile(path.join(webRoot, "package.json"), "utf8"));
  const apiContractVersion = process.env.AUDITFLOW_API_CONTRACT_VERSION || sourcePackage.apiContractVersion || "1.0.0";
  run(process.execPath, [extensionBuilder], projectRoot, {
    ...process.env,
    AUDITFLOW_RELEASE_VERSION: version,
    AUDITFLOW_API_CONTRACT_VERSION: apiContractVersion,
    AUDITFLOW_CANDIDATE_ROOT: candidateRoot,
    AUDITFLOW_MANUAL_OUTPUT_DIR: manualRoot
  });
  const extension = path.join(candidateRoot, `JEAuditFlow-${version}-Browser-Extension.zip`);
  assertExists(extension, "browser extension package");
  const extensionRoot = path.join(candidateRoot, "extension-staging", `JEAuditFlow-${version}-Browser-Extension`);
  const extensionReleasePath = path.join(extensionRoot, "extension-release.json");
  const extensionRelease = JSON.parse(await readFile(extensionReleasePath, "utf8"));
  if (
    extensionRelease.version !== version ||
    extensionRelease.apiContractVersion !== apiContractVersion ||
    extensionRelease.supportedClientRange !== `${version.slice(0, 3)}.x`
  ) {
    throw new Error("Browser extension version/API compatibility metadata does not match the web client");
  }
  const webClient = await createWebClient(manualRoot, extensionRoot, apiContractVersion);
  const jiraFlow = await buildJiraFlow();
  const backend = await createBackend(webClient.manifest, jiraFlow);
  const database = await createDatabase();
  const artifacts = [
    artifactRecord(webClient.archive, "web-client"),
    artifactRecord(backend.archive, "backend-api"),
    artifactRecord(extension, "browser-extension"),
    artifactRecord(database.zip, "database-zip"),
    artifactRecord(database.tar, "database-tar-gz")
  ];
  await writeCandidateNotes();
  const releaseManifest = {
    product: "JEAuditFlow",
    version,
    candidate: true,
    productRuntimeDeployed: false,
    databaseWritesPerformed: false,
    generatedAt: new Date().toISOString(),
    notes: ["CANDIDATE-README.md", `RELEASE_NOTES_v${version.replace(/\.\d+$/, "")}.md`],
    clientCompatibility: { apiContractVersion: webClient.manifest.apiContractVersion, backendRange: `${version.slice(0, 3)}.x` },
    database: { name: profile.databaseName, volume: profile.databaseVolume, port: profile.databasePort,
      sourceSchemaVersion: profile.databaseSourceVersion, schemaVersion: version === "7.7.0" ? 29 : 28,
      ddlChanged: version === "7.7.0", deploymentMode: version === "7.7.0" ? "native" : "docker" },
    artifacts
  };
  await writeCandidateFile(candidateRoot, path.join(candidateRoot, "release-manifest.json"), `${JSON.stringify(releaseManifest, null, 2)}\n`);
  await writeCandidateFile(candidateRoot, path.join(candidateRoot, "SHA256SUMS.txt"), `${artifacts.map(item => `${item.sha256}  ${item.file}`).join("\n")}\n`);
  process.stdout.write(`${JSON.stringify(releaseManifest, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
