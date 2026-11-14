#!/usr/bin/env node

import { cp, mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { releaseProfile, stampExtensionBackendOrigin } from "./package-release-profiles.mjs";
import { sanitizePublicReleaseData } from "./package-public-data.mjs";
import { externalizeInlineScripts } from "./lib/externalize-inline-scripts.mjs";
import {
  refreshAndValidateChecklistCatalog,
  validateChecklistCatalogArchive,
  validateChecklistCatalogCopies
} from "./lib/checklist-catalog-build.mjs";
import {
  assertCandidateOutputPath,
  assertCandidateRoot,
  assertNoTestFixturePaths,
  removeTestFixturePayloads,
  stampDesktopShellVersion,
  writeCandidateFile
} from "./package-7.3-release-helpers.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = path.join(projectRoot, "src", "AuditFlowDesktop", "WebApp");
const version = process.env.AUDITFLOW_RELEASE_VERSION || "6.9.0";
const runtimeVersion = version;
const runtimeCompatibility = `${version.split(".").slice(0, 2).join(".")}.x`;
const apiContractVersion = process.env.AUDITFLOW_API_CONTRACT_VERSION || "1.0.0";
const capabilityVersion = "12.3.0";
const packageName = `JEAuditFlow-${version}-Browser-Extension`;
let candidateRoot = path.resolve(
  process.env.AUDITFLOW_CANDIDATE_ROOT ||
  path.join(projectRoot, "artifacts", "candidates", `${version}-candidate`)
);
const stagingRoot = path.join(candidateRoot, "extension-staging", packageName);
const unpackedRoot = path.join(candidateRoot, packageName);
const archivePath = path.join(candidateRoot, `${packageName}.zip`);
const promoExportRoot = path.join(projectRoot, "artifacts", "jeauditflow", "out");
const generatedManualRoot = process.env.AUDITFLOW_MANUAL_OUTPUT_DIR
  ? path.resolve(process.env.AUDITFLOW_MANUAL_OUTPUT_DIR)
  : null;
const promoVideo = "assets/marketing/JEAuditFlow-6.9-promo.mp4";
const previewVideo = "assets/Breakable-Silver-Wildebeest-1080p.mp4";
const promoStaticDirectory = "next-static";
const promoPageName = "landing-promo.html";
const promoFavicon = "favicon.svg";

const topLevelFiles = [
  "index.html", "workbench-routing.js", "workbench-bootstrap.js", "workbench-nav-menu.js", "workbench-fileanalyst-link.js", "workbench-jiraflow-link.js", "workbench-lessonlearn-link.js", "landing.html", "landing-host.html", "landing-host.js", "landing.css", "landing.js", "manifest.json", "background.js", "popup.html", "popup.css", "popup.js",
  "engine.mjs",
  "copilot-direct-line.mjs",
  "helix-export-model.mjs", "assessment-tasks.mjs",
  "helix-bridge.ps1", "start-helix-bridge.cmd",
  "aspice-audit-master-2.3.1.html", "aspice-audit-master-2.3.1-en.html",
  "app.js", "backend-client.js", "local-extension-mode.js", "document-review-checklist-model.mjs", "tuv-issue-ledger-guard.js", "tuv-aspice-issue-reference.js", "sqe-ppap-reference.js", "sup-qa-checklist-catalog.js", "qa-checklist-workflow.js",
  "auth-gate.js", "auth-gate.css", "web-auth.js", "i18n.js", "theme-init.js", "issues-module.js", "issues-v61.css",
  "ai-harness.css", "ai-harness-ui.js",
  "feedback-modal.js", "feedback-modal.css", "upload-routing.mjs", "bridge-workbench.js", "bridge-workbench.css",
  "fileanalyst-config.js", "process-canvases.js", "process-canvases.css",
  "record-consolidation-v48.css", "report-templates.js", "report-templates.css", "evidence-catalog.js", "workbench-release-v75.css", "nc-jiraflow-model.js",
  "tmm-assessment-data.js", "external-assessment-data.js", "cep-xp-assessment-data.js", "mbeal-targeted-issues.js",
  "aspice-v40-model.js", "aspice-training-reference.js", "codex-assistant.js",
  "codex-assistant.css", "qa-checklist-v6.css", "ux-enhance.js", "v6-enhancements.js", "v6-enhancements.css",
  "v23-enhancements.js", "v23-enhancements.css", "styles.css", "styles-v2.css",
  "workbench-v10.css", "jeauditflow-v20.css", "jira-v68.css", "trace-v73.css", "trace-v75.css",
  "trace-v76.css", "trace-v77.css", "trace-v78.css", "trace-v79.css", "trace-v80.css",
  "trace-v81.css", "trace-v82.css", "trace-v83.css", "trace-v84.css", "trace-v85.css",
  "trace-v86.css", "jira-v68.css", "help-manual.html", "help-manual.js", "project-data-gateway.js",
  "codex-project-session.js", "codex-project-session.css", "telemetry-client.js",
  "ops-dashboard.js", "portal.html", "portal.js", "ops.html", "ops-ui.css",
  "desktop.html", "desktop-shell.js", "backend-config.json", "RELEASE_NOTES_v6.0.md", "RELEASE_NOTES_v6.1.md", "RELEASE_NOTES_v6.2.md", "RELEASE_NOTES_v6.3.md", "RELEASE_NOTES_v6.7.md", "RELEASE_NOTES_v6.8.md", "RELEASE_NOTES_v7.0.md", `RELEASE_NOTES_v${version.replace(/\.0$/, "")}.md`,
  `downloads/JEAuditFlow-Operation-Manual-${version}-EN.pdf`, `downloads/JEAuditFlow-Operation-Manual-${version}-ZH.pdf`
];
const assetDirectories = ["icons", "vendor", "templates", "assets", "reference-models", "downloads", "fileanalyst", "lessonlearn"];

async function rewriteRuntimeVersion(root) {
  const files = [path.join(root, "app.js"), path.join(root, "index.html"), path.join(root, "landing.html"), path.join(root, "desktop.html"), path.join(root, "help-manual.html"), path.join(root, "README.md"), path.join(root, "INSTALL.md")];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const source = await readFile(file, "utf8");
    const rewritten = source
      .replace(/const APP_VERSION = "\d+\.\d+\.\d+";/, `const APP_VERSION = "${version}";`)
      .replace(/const DESKTOP_VERSION_RANGE = "\d+\.\d+\.x";/, `const DESKTOP_VERSION_RANGE = "${runtimeCompatibility}";`)
      .replace(/JEAuditFlow \d+\.\d+\.\d+/g, `JEAuditFlow ${version}`)
      .replace(/JEAUDITFLOW \d+\.\d+/g, `JEAUDITFLOW ${version.replace(/\.0$/, "")}`);
    if (rewritten !== source) await writeCandidateFile(candidateRoot, file, rewritten);
  }
  await stampDesktopShellVersion(root, version);
  if (["7.5.0", "7.6.0", "7.7.0"].includes(version)) {
    const endpointFile = path.join(root, "local-extension-mode.js");
    await writeCandidateFile(candidateRoot, endpointFile,
      stampExtensionBackendOrigin(await readFile(endpointFile, "utf8"), releaseProfile(version)));
  }
}

function assertExists(target, label = target) {
  if (!existsSync(target)) throw new Error(`Missing ${label}: ${target}`);
}

function assertNoInlineScripts(root, pages) {
  for (const page of pages) {
    const file = path.join(root, page);
    assertExists(file, `CSP-safe page ${page}`);
    const source = readFileSync(file, "utf8");
    const inlineScripts = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
      .filter(([, attributes, body]) => !/\bsrc\s*=/i.test(attributes) && body.trim());
    if (inlineScripts.length) {
      throw new Error(`CSP-safe page ${page} contains ${inlineScripts.length} non-empty inline script(s)`);
    }
  }
}

async function copyIfPresent(source, destination) {
  if (!existsSync(source)) return;
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { force: true, recursive: true });
}

function rewriteChecklistReviewMarkup(source) {
  const legacyButton = /<button\b[^>]*data-action="run-ai-review"[^>]*>[\s\S]*?<\/button>/;
  const checklistButton = '<button class="btn primary sm" data-action="open-qa-checklist-library" data-project="${project.id}" title="${t("打开本地清单并在线生成候选审查意见；正式评级仍需评估师确认", "Open the local checklist and generate online candidate review opinions; formal ratings still require assessor confirmation")}" aria-label="${t("清单审查", "Checklist review")}">${icon("book")}${t("清单审查", "Checklist review")}</button>';
  if (!legacyButton.test(source)) {
    if (!/data-action="open-qa-checklist-library"/.test(source)) {
      throw new Error("AI Review template contains neither the legacy run-ai-review button nor the Checklist review action");
    }
    return source
      .replace("Codex 参考评审与版本", "清单审查运行与版本")
      .replace("Codex reference review and versions", "Checklist review runs and versions")
      .replace("参考评审历史", "清单审查历史")
      .replace("Reference-review history", "Checklist review history")
      .replace("尚未运行 Codex 参考评审。", "尚未运行清单审查。")
      .replace("No Codex reference review has been run.", "No checklist review has been run.");
  }
  return source
    .replace(legacyButton, checklistButton)
    .replace("Codex 参考评审与版本", "清单审查运行与版本")
    .replace("Codex reference review and versions", "Checklist review runs and versions")
    .replace("参考评审历史", "清单审查历史")
    .replace("Reference-review history", "Checklist review history")
    .replace("尚未运行 Codex 参考评审。", "尚未运行清单审查。")
    .replace("No Codex reference review has been run.", "No checklist review has been run.");
}

async function copyPromoExport(destinationRoot) {
  const exportedPage = path.join(promoExportRoot, "index.html");
  assertExists(exportedPage, "built Next.js promotional page");
  const sourcePage = readFileSync(exportedPage, "utf8").replaceAll("/_next/", `/${promoStaticDirectory}/`);
  const page = await externalizeInlineScripts(destinationRoot, sourcePage);
  await writeCandidateFile(candidateRoot, path.join(destinationRoot, promoPageName), page);

  const nextSource = path.join(promoExportRoot, "_next");
  assertExists(nextSource, "Next.js promotional static assets");
  const nextDestination = path.join(destinationRoot, promoStaticDirectory);
  await cp(nextSource, nextDestination, { force: true, recursive: true });
  for (const file of await filesUnder(nextDestination)) {
    if (!/\.(?:css|html|js|json|txt)$/i.test(file)) continue;
    const source = readFileSync(file, "utf8");
    const rewritten = source.replaceAll("/_next/", `/${promoStaticDirectory}/`);
    if (rewritten !== source) await writeCandidateFile(candidateRoot, file, rewritten);
  }
  await renameUnderscorePrefixedPaths(nextDestination);

  const assetsSource = path.join(promoExportRoot, "assets");
  assertExists(assetsSource, "Next.js promotional assets");
  await cp(assetsSource, path.join(destinationRoot, "assets"), { force: true, recursive: true });
  // Keep the release package aligned with the current product film. Older
  // source assets may remain in the local public directory for historical
  // inspection, but must not ship as active release resources.
  await rm(path.join(destinationRoot, "assets", "marketing", "JEAuditFlow-6.1-promo.mp4"), { force: true });
  await rm(path.join(destinationRoot, "assets", "marketing", "JEAuditFlow-6.4-promo.mp4"), { force: true });
  await rm(path.join(destinationRoot, "assets", "marketing", "JEAuditFlow-6.8-promo.mp4"), { force: true });
  await rm(path.join(destinationRoot, "downloads", "JEAuditFlow-Operation-Manual-4.8.0-EN.pdf"), { force: true });
  await rm(path.join(destinationRoot, "downloads", "JEAuditFlow-Operation-Manual-4.8.0-ZH.pdf"), { force: true });
  await rm(path.join(destinationRoot, "downloads", "JEAuditFlow-Operation-Manual-6.8.0-EN.pdf"), { force: true });
  await rm(path.join(destinationRoot, "downloads", "JEAuditFlow-Operation-Manual-6.8.0-ZH.pdf"), { force: true });
  for (const language of ["EN", "ZH"]) {
    const manual = path.join(destinationRoot, "downloads", `JEAuditFlow-Operation-Manual-${version}-${language}.pdf`);
    assertExists(manual, `${version} ${language} operation manual`);
    const manualText = execFileSync("pdftotext", [manual, "-"], { encoding: "utf8" });
    if (!manualText.includes(`JEAuditFlow ${version}`)) {
      throw new Error(`${version} ${language} operation manual does not contain the release version`);
    }
  }
  const faviconSource = path.join(promoExportRoot, promoFavicon);
  assertExists(faviconSource, "Next.js promotional favicon");
  await cp(faviconSource, path.join(destinationRoot, promoFavicon), { force: true });
  assertExists(path.join(destinationRoot, promoVideo), "promotional product video");
  assertExists(path.join(destinationRoot, previewVideo), "6.3.1 product preview video");
  if (!page.includes(`/${promoStaticDirectory}/static/`) || page.includes("/_next/") || page.includes("promoVideoElement")) {
    throw new Error("Packaged promo page is not the built Next.js promotion export");
  }
  // The extension entry must be the static Next page itself. Embedding the
  // sandbox page from landing-host.html makes Edge block the iframe with
  // ERR_BLOCKED_BY_CLIENT. The desktop shell still uses landing-host.html
  // only when its own source explicitly requests that legacy wrapper.
  await writeCandidateFile(candidateRoot, path.join(destinationRoot, "landing.html"), page);
}

async function filesUnder(root) {
  const output = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const current = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(current);
      else output.push(current);
    }
  }
  await visit(root);
  return output;
}

async function renameUnderscorePrefixedPaths(root) {
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      let currentPath = path.join(directory, entry.name);
      if (entry.name.startsWith("_")) {
        const normalizedName = entry.name.replace(/^_+/, "");
        if (!normalizedName) throw new Error(`Cannot normalize reserved promotional path: ${currentPath}`);
        const normalizedPath = path.join(directory, normalizedName);
        if (existsSync(normalizedPath)) {
          throw new Error(`Promotional path normalization collision: ${currentPath} -> ${normalizedPath}`);
        }
        await rename(currentPath, normalizedPath);
        currentPath = normalizedPath;
      }
      if (entry.isDirectory()) await visit(currentPath);
    }
  }
  await visit(root);
}

async function assertChromeCompatibleNames(root) {
  const reservedPaths = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const currentPath = path.join(directory, entry.name);
      if (entry.name.startsWith("_")) reservedPaths.push(path.relative(root, currentPath));
      if (entry.isDirectory()) await visit(currentPath);
    }
  }
  await visit(root);
  if (reservedPaths.length) {
    throw new Error(`Chrome extension package contains reserved underscore-prefixed paths: ${reservedPaths.join(", ")}`);
  }
}

async function assertExtensionArchive(archive, checklistCatalog) {
  const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
    .split(/\r?\n/)
    .map(entry => entry.trim())
    .filter(Boolean);
  const requiredRootFiles = ["manifest.json", "index.html", "landing.html"];
  const missingRootFiles = requiredRootFiles.filter(file => !entries.includes(file));
  if (missingRootFiles.length) {
    throw new Error(`Extension ZIP is missing root files: ${missingRootFiles.join(", ")}`);
  }
  if (entries.some(entry => entry.startsWith(`${packageName}/`))) {
    throw new Error("Extension ZIP contains an outer package directory; manifest.json must be at archive root");
  }
  assertNoTestFixturePaths(entries, "Extension ZIP");
  const forbidden = entries.filter(entry =>
    entry.includes("/_next") ||
    entry.startsWith("_next") ||
    entry.includes("/.next") ||
    entry.startsWith(".next") ||
    entry.includes("node_modules/") ||
    entry.includes("__MACOSX/") ||
    entry.endsWith(".DS_Store")
  );
  if (forbidden.length) {
    throw new Error(`Extension ZIP contains forbidden entries: ${forbidden.join(", ")}`);
  }
  validateChecklistCatalogArchive(archive, ["sup-qa-checklist-catalog.js"], {
    version,
    ...checklistCatalog.expected,
    label: "Extension ZIP"
  });
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function main() {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`AUDITFLOW_RELEASE_VERSION must be semver (received ${version})`);
  }
  assertExists(webRoot, "JEAuditFlow WebApp");
  if (["7.3.0", "7.4.0", "7.5.0", "7.6.0", "7.7.0"].includes(version)) {
    candidateRoot = await assertCandidateRoot(candidateRoot, path.join(projectRoot, "artifacts", "candidates"));
  }
  await mkdir(candidateRoot, { recursive: true });
  const checklistOutputFile = path.join(candidateRoot, "build-inputs", "sup-qa-checklist-catalog.js");
  const releaseMetadataFile = path.join(candidateRoot, `${packageName}.manifest.json`);
  const extensionReleaseFile = path.join(stagingRoot, "extension-release.json");
  for (const outputPath of [
    stagingRoot,
    unpackedRoot,
    archivePath,
    checklistOutputFile,
    releaseMetadataFile,
    path.join(stagingRoot, "manifest.json"),
    extensionReleaseFile,
    path.join(stagingRoot, `README-JEAuditFlow-${version}-Extension.md`),
    path.join(stagingRoot, "app.js"),
    path.join(stagingRoot, "downloads", `JEAuditFlow-Operation-Manual-${version}-EN.pdf`),
    path.join(stagingRoot, "downloads", `JEAuditFlow-Operation-Manual-${version}-ZH.pdf`)
  ]) {
    await assertCandidateOutputPath(candidateRoot, outputPath);
  }
  if (generatedManualRoot) {
    await assertCandidateOutputPath(candidateRoot, generatedManualRoot);
  }
  const checklistCatalog = await refreshAndValidateChecklistCatalog({
    webRoot,
    version,
    outputFile: checklistOutputFile
  });
  await rm(stagingRoot, { recursive: true, force: true });
  await rm(archivePath, { force: true });
  await mkdir(stagingRoot, { recursive: true });

  for (const name of topLevelFiles) await copyIfPresent(path.join(webRoot, name), path.join(stagingRoot, name));
  const appPath = path.join(stagingRoot, "app.js");
  await writeCandidateFile(candidateRoot, appPath, rewriteChecklistReviewMarkup(readFileSync(appPath, "utf8")));
  for (const name of assetDirectories) await copyIfPresent(path.join(webRoot, name), path.join(stagingRoot, name));
  await cp(checklistCatalog.catalogFile, path.join(stagingRoot, "sup-qa-checklist-catalog.js"), { force: true });
  validateChecklistCatalogCopies([path.join(stagingRoot, "sup-qa-checklist-catalog.js")], {
    version,
    ...checklistCatalog.expected,
    label: "Extension staging"
  });
  await rewriteRuntimeVersion(stagingRoot);
  if (generatedManualRoot) {
    for (const language of ["EN", "ZH"]) {
      const manualName = `JEAuditFlow-Operation-Manual-${version}-${language}.pdf`;
      const sourceManual = path.join(generatedManualRoot, manualName);
      assertExists(sourceManual, `${version} ${language} operation manual`);
      await mkdir(path.join(stagingRoot, "downloads"), { recursive: true });
      const targetManual = path.join(stagingRoot, "downloads", manualName);
      await assertCandidateOutputPath(candidateRoot, targetManual);
      await cp(sourceManual, targetManual, { force: true });
    }
  }
  await copyPromoExport(stagingRoot);
  // Browser extensions execute the static FileAnalyst client only. Keep the
  // Node dependency tree in the backend archive where it can be loaded by
  // the FileAnalyst service.
  await rm(path.join(stagingRoot, "fileanalyst", "node_modules"), { recursive: true, force: true });
  await rm(path.join(stagingRoot, "fileanalyst", "tests"), { recursive: true, force: true });
  for (const legacyService of ["fileanalyst-v300.service", "fileanalyst-v330.service"]) {
    await rm(path.join(stagingRoot, "fileanalyst", legacyService), { force: true });
  }
  await removeTestFixturePayloads(stagingRoot);
  if (["7.6.0", "7.7.0"].includes(version)) await sanitizePublicReleaseData({ candidateRoot, stagingRoot });
  assertNoInlineScripts(stagingRoot, [
    "index.html",
    "landing.html",
    promoPageName,
    "fileanalyst/index.html",
    "fileanalyst/client/index.html"
  ]);
  await assertChromeCompatibleNames(stagingRoot);

  const manifestPath = path.join(stagingRoot, "manifest.json");
  const manifest = JSON.parse(await import("node:fs/promises").then(fs => fs.readFile(manifestPath, "utf8")));
  manifest.name = "JEAuditFlow";
  manifest.short_name = "JEAuditFlow";
  manifest.version = version;
  manifest.description = `JEAuditFlow ${version} browser workspace synchronized with AuditFlow capability ${capabilityVersion}.`;
  manifest.action = { ...(manifest.action || {}), default_title: `Open JEAuditFlow ${version}`, default_popup: "popup.html" };
  // Keep the extension landing page outside the sandbox. Edge blocks a
  // sandboxed page that navigates to another extension page, which turns the
  // local "Start an audit" action into ERR_BLOCKED_BY_CLIENT. The promo page
  // and legacy analysis pages still need sandbox isolation.
  manifest.sandbox = {
    ...(manifest.sandbox || {}),
    pages: [...new Set([
      ...(manifest.sandbox?.pages || []),
      promoPageName,
      "aspice-audit-master-2.3.1.html",
      "aspice-audit-master-2.3.1-en.html"
    ])].filter(page => page !== "landing.html")
  };
  await writeCandidateFile(candidateRoot, manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await writeCandidateFile(candidateRoot, extensionReleaseFile, `${JSON.stringify({
    schemaVersion: 1,
    product: "JEAuditFlow",
    version,
    runtimeVersion,
    runtimeCompatibility,
    apiContractVersion,
    supportedClientRange: runtimeCompatibility,
    capabilityVersion,
    packageType: "browser-extension",
    synchronizedClient: "src/AuditFlowDesktop/WebApp",
    backendSource: `JEAuditFlow-${version}-Backend release package with the checked-in ${version} client/service overlay`,
    features: [
      "ASPICE 4.0 formal-scope and assessor-controlled evidence workflow",
      "Tree View evidence grouping and trace-link synchronization",
      "Jira-inspired local issue workbench with horizontally scrollable status columns",
      "Trace-inspired SUP QA checklist catalog with candidate-only findings",
      "Local Jira / Feishu / Meego field-map export without external writes",
      "Revision-checked collaboration and lock-aware editing",
      "Visibility-aware monitoring and backend polling",
      "Local-first AI fallback with optional service bridge"
    ],
    checklistCatalog: checklistCatalog.metadata,
    generatedAt: new Date().toISOString()
  }, null, 2)}\n`);
  await writeCandidateFile(candidateRoot, path.join(stagingRoot, `README-JEAuditFlow-${version}-Extension.md`), `# JEAuditFlow ${version} browser extension

This package is built from the checked-in JEAuditFlow WebApp and its ${runtimeCompatibility}
service contract. The matching JEAuditFlow ${runtimeVersion} backend is
packaged separately; this browser archive contains the client/service overlay,
UI, phase gates and NC workflow for that release.

Load the unpacked directory in Chrome or Edge. The package contains no user
evidence, credentials, API keys, or server-side MySQL data.
`);

  const relativeFiles = (await filesUnder(stagingRoot)).map(file => path.relative(stagingRoot, file).split(path.sep).join("/"));
  if (!relativeFiles.includes("manifest.json") || !relativeFiles.includes("index.html")) {
    throw new Error("Extension package is missing manifest.json or index.html");
  }
  if (!["issues-module.js", "issues-v61.css"].every(file => relativeFiles.includes(file))) {
    throw new Error("Extension package is missing 6.2 Issues workbench assets");
  }
  if (!relativeFiles.includes("cep-xp-assessment-data.js")) {
    throw new Error("Extension package is missing CEP/XP assessment data");
  }
  const requiredAssets = [
    "workbench-nav-menu.js",
    "workbench-jiraflow-link.js",
    "workbench-lessonlearn-link.js",
    "aspice-audit-master-2.3.1.html",
    "aspice-audit-master-2.3.1-en.html",
    "document-review-checklist-model.mjs",
    "fileanalyst/index.html",
    "fileanalyst/app.js",
    "landing.html",
    promoPageName,
    "landing-host.js",
    `${promoStaticDirectory}/static`,
    promoVideo,
    previewVideo,
    "lessonlearn/index.html",
    "lessonlearn/app.mjs"
  ];
  if (version === "7.5.0") requiredAssets.push(
    "evidence-catalog.js",
    "workbench-release-v75.css",
    "nc-jiraflow-model.js",
    "ai-harness.css",
    "ai-harness-ui.js"
  );
  for (const asset of requiredAssets) assertExists(path.join(stagingRoot, asset), `extension asset ${asset}`);
  await assertCandidateOutputPath(candidateRoot, archivePath);
  execFileSync("zip", ["-qr", "-X", archivePath, "."], { cwd: stagingRoot, stdio: "inherit" });
  await assertExtensionArchive(archivePath, checklistCatalog);
  await rm(unpackedRoot, { recursive: true, force: true });
  await cp(stagingRoot, unpackedRoot, { recursive: true });
  await assertChromeCompatibleNames(unpackedRoot);
  const unpackedFiles = await filesUnder(unpackedRoot);
  if (unpackedFiles.some(file => path.relative(unpackedRoot, file).split(path.sep).includes("node_modules"))) {
    throw new Error("Unpacked browser extension contains node_modules");
  }
  const metadata = {
    product: "JEAuditFlow",
    version,
    runtimeVersion,
    runtimeCompatibility,
    apiContractVersion,
    supportedClientRange: runtimeCompatibility,
    capabilityVersion,
    packageType: "browser-extension",
    archive: path.basename(archivePath),
    sha256: sha256(archivePath),
    fileCount: relativeFiles.length,
    checklistCatalog: checklistCatalog.metadata,
    generatedAt: new Date().toISOString()
  };
  await writeCandidateFile(candidateRoot, releaseMetadataFile, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(JSON.stringify(metadata, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
