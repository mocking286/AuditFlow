#!/usr/bin/env node
import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertCandidateRoot, assertCandidateOutputPath, createChecksumManifest, writeCandidateFile } from "./package-7.3-release-helpers.mjs";
import { sanitizePublicReleaseData } from "./package-public-data.mjs";
import { releaseProfile } from "./package-release-profiles.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = process.env.AUDITFLOW_RELEASE_VERSION || "7.6.0";
const minorVersion = version.replace(/\.0$/, "");
const profile = releaseProfile(version);
const candidate = await assertCandidateRoot(process.env.AUDITFLOW_CANDIDATE_ROOT || path.join(project,
  version === "7.6.0" ? "artifacts/candidates/7.6.0-final-20261111" : `artifacts/candidates/${version}-candidate`),
path.join(project, "artifacts/candidates"));
const staging = await assertCandidateOutputPath(candidate, path.join(candidate, "source-staging"));
const root = path.join(staging, `JEAuditFlow-${version}-Source`);
await rm(staging, { recursive: true, force: true });
await mkdir(root, { recursive: true });
async function copy(source, destination) {
  await assertCandidateOutputPath(candidate, destination);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true, dereference: false });
}
const web = path.join(root, "src/AuditFlowDesktop/WebApp");
await copy(path.join(candidate, "web-client-staging"), web);
await copy(path.join(candidate, "backend-staging/server"), web);
const extension = path.join(candidate, `extension-staging/JEAuditFlow-${version}-Browser-Extension`);
for (const name of ["manifest.json", "background.js", "popup.html", "popup.css", "popup.js", "landing-host.html", "landing-host.js", "helix-bridge.ps1", "start-helix-bridge.cmd"]) {
  if (existsSync(path.join(extension, name))) await copy(path.join(extension, name), path.join(web, name));
}
await copy(path.join(candidate, "web-client-staging/fileanalyst"), path.join(web, "fileanalyst/client"));
await copy(path.join(candidate, "backend-staging/fileanalyst"), path.join(web, "fileanalyst"));
await copy(path.join(candidate, "build-inputs/jiraflow/source"), path.join(root, "src/JiraFlow"));
await copy(path.join(project, "local-deploy/runtime/database", profile.databaseSourceVersion),
  path.join(root, "database", profile.databaseSourceVersion));
await copy(path.join(project, "src/AuditFlowDesktop/WebApp/ai-harness.mjs"), path.join(web, "ai-harness.mjs"));

const testNames = [
  "bridge-session", "bridge-http", "bridge-workbench", "feedback-modal", "auth-login-first",
  "process-reference-localization", "evidence-filter-routing", "evidence-catalog",
  "evidence-filter-regressions", "evidence-retention-recovery", "ai-harness", "ai-harness-ui",
  "ai-harness-evidence-history", "ai-harness-http", "harness-run-ledger", "tuv-issue-ledger-export",
  "report-templates-contract", "report-template-routing", "browser-report-template-eligibility",
  "km-presentation-export", "overlay-keyboard-shortcuts", "upload-jiraflow-candidates", "feedback-content-retention", "public-empty-bootstrap"
];
if (version === "7.7.0") testNames.push(
  "assessment-tasks", "assessment-task-mail-delivery", "microsoft-sso-mail", "outlook-desktop-mail",
  "trace-assessment-excel-data", "jiraflow-finding-push-http", "jiraflow-finding-push-ui-contract",
  "jiraflow-sync-contract", "jiraflow-evidence-mutation", "jira-rest-channel", "jira-finding-integration-http"
);
for (const testName of testNames) {
  const source = path.join(project, `src/AuditFlowDesktop/WebApp/tests/${testName}.test.mjs`);
  if (existsSync(source)) await copy(source, path.join(web, `tests/${testName}.test.mjs`));
}
await copy(path.join(project, "src/AuditFlowDesktop/WebApp/tests/helpers/start-server.mjs"), path.join(web, "tests/helpers/start-server.mjs"));
const scriptNames = [
  "package-7.6-release.mjs", "package-7.6-deployment-support.mjs", "package-7.6-launcher.mjs",
  "package-7.6-source.mjs", "package-7.3-release.mjs", "package-7.3-release-helpers.mjs",
  "package-release-profiles.mjs", "build-candidate-extension-67-20261024.mjs",
  "package-7.4-deployment-support.mjs", "package-7.5-launcher.mjs",
  "package-public-data.mjs", "public-report-template.mjs", "generate-7.0-manual-pdfs.mjs",
  "generate-sup-qa-checklist-catalog.py", "lib/externalize-inline-scripts.mjs", "lib/checklist-catalog-build.mjs"
];
if (version === "7.7.0") scriptNames.push(
  "package-7.7-source.mjs", "package-7.7-release.mjs", "package-7.7-deployment-support.mjs",
  "package-7.7-launcher.mjs", "assemble-7.7-release.mjs"
);
for (const name of scriptNames) await copy(path.join(project, "scripts", name), path.join(root, "scripts", name));
for (const name of ["DEPLOYMENT-SUPPORT-7.6.md", "scripts/jeauditflow-local.sh", "docker/compose.yaml", "templates/7.6.local-settings.env.example", "launcher/Package.swift", "launcher/Sources/JEAuditFlowLauncher/main.swift", "launcher/script/build_and_run.sh", "launcher/Resources/JEAuditFlowLauncher-icon-source.png"]) {
  await copy(path.join(project, "local-deploy", name), path.join(root, "local-deploy", name));
}
if (version === "7.7.0") {
  for (const name of ["DEPLOYMENT-SUPPORT-7.7.md", "scripts/native-mysql.sh", "scripts/native-migration-files.mjs",
    "scripts/migrate-7.6-to-native-7.7.mjs", "scripts/prepare-7.7-runtimes.mjs",
    "templates/7.7.local-settings.env.example", "templates/7.7.jiraflow-schema.sql",
    "templates/7.7.native-database.sh", "templates/7.7.database-README.md"]) {
    await copy(path.join(project, "local-deploy", name), path.join(root, "local-deploy", name));
  }
  const atlassianLauncher = path.resolve(project, "../../tools/AtlassianServiceLauncher");
  for (const name of [
    "Package.swift",
    "Sources/AtlassianServiceLauncher/main.swift",
    "Tests/AtlassianServiceLauncherTests/StartupFailureDiagnosticsTests.swift",
    "Resources/AtlassianLogo.jpg",
    "script/build_and_run.sh"
  ]) {
    await copy(path.join(atlassianLauncher, name), path.join(root, "tools/AtlassianServiceLauncher", name));
  }
}
await copy(path.join(project, "artifacts/jeauditflow/out"), path.join(root, "artifacts/jeauditflow/out"));
await mkdir(path.join(root, "artifacts/candidates"), { recursive: true });
await sanitizePublicReleaseData({ candidateRoot: candidate, stagingRoot: root });
async function removeBuildChecksums(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await removeBuildChecksums(file);
    else if (entry.name === "SHA256SUMS.txt" && directory !== root) await rm(file);
  }
}
await removeBuildChecksums(root);
await writeCandidateFile(candidate, path.join(root, "README-SOURCE.md"), `# JEAuditFlow ${version} Source

This snapshot contains the exact public client/API source from this release, FileAnalyst source, merged JiraFlow Java source, JEAuditFlow launcher source, schema tooling and focused synthetic regression tests. The 7.7 source also includes the separate macOS Atlassian bridge launcher and its tests. Controlled customer audit datasets, account databases, credentials, uploads, logs and private fixtures are omitted. Public dataset adapters intentionally contain empty collections.

The source is assembled from verified release staging directories so it does not sweep unrelated changes from the development checkout into this archive. Build stamps and neutral dataset adapters are part of the public snapshot.

## API and Tests

${version === "7.7.0" ? "Node.js 26.13.1 is the tested runtime:" : "Node.js 20 or newer:"}

\`\`\`sh
cd src/AuditFlowDesktop/WebApp
npm ci
npm run check
npm test
AUDITFLOW_LOCAL_TEST=1 AUDITFLOW_SERVER_ROLE=desktop AUDITFLOW_PORT=4173 AUDITFLOW_CLIENT_ROOT="$PWD" node server.mjs serve
\`\`\`

The included test suite uses synthetic local providers and HTTP upstreams. It does not call a paid model. Proprietary fixture-based development suites are not included.

## Rebuild Packages

Requires ${version === "7.7.0" ? "OpenJDK 27.0.1 and Node.js 26.13.1" : "Java 21 and Node.js"}, zip/unzip, Python 3 with defusedxml, and Chromium for printing the operation manuals. The promotion export is included as a prebuilt public asset. ${version === "7.7.0" ? "JiraFlow keeps Java 21 bytecode compatibility while the release launcher executes it with the pinned JDK 27 runtime." : ""}

\`\`\`sh
AUDITFLOW_USE_BUNDLED_CHECKLIST_CATALOG=1 node scripts/package-${minorVersion}-release.mjs
\`\`\`

The bundled checklist switch validates the checked-in generic catalog rather than requiring the original checklist documents. JiraFlow builds from src/JiraFlow and the database package reads database/${profile.databaseSourceVersion}. These contain source and fresh-install schema only. ${version === "7.7.0" ? "The 7.7 packager adds the managed InnoDB JiraFlow table and native MySQL wrappers; the older source schema directory is an input to that build, not the 7.7 deployment default." : ""}

## macOS Launcher

\`\`\`sh
bash local-deploy/launcher/script/build_and_run.sh --build-only
\`\`\`

The JEAuditFlow launcher is locally signed and is not Apple-notarized. For 7.7, the independent Atlassian bridge launcher is under tools/AtlassianServiceLauncher and can be tested with \`swift test\`; it requires an active local Jira/Confluence service and an explicitly configured Polarion URL. The public reverse bridge requires installation on a public HTTPS server plus an active Mac connector; source availability alone does not establish deployment.
`);
const packageJson = JSON.parse(await readFile(path.join(web, "package.json"), "utf8"));
packageJson.scripts.check = "node --check server.mjs && node --check engine.mjs && node --check bridge-session.mjs && node --check app.js && node --check feedback-modal.js && node --check upload-routing.mjs";
await writeCandidateFile(candidate, path.join(web, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
await writeCandidateFile(candidate, path.join(root, "SHA256SUMS.txt"), await createChecksumManifest(root));
const archive = path.join(candidate, `JEAuditFlow-${version}-Source.zip`);
await assertCandidateOutputPath(candidate, archive);
await rm(archive, { force: true });
execFileSync("zip", ["-qr", "-X", archive, path.basename(root)], { cwd: staging });
execFileSync("unzip", ["-tqq", archive]);
console.log(JSON.stringify({ version, archive, root, syntheticTestFiles: testNames.length, containsCustomerDatasets: false }));
