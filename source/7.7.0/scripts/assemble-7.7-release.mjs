#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile, cp, mkdir, rm, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = "7.7.0";
const candidate = process.env.AUDITFLOW_CANDIDATE_ROOT || path.join(project, "artifacts/candidates/7.7.0-candidate");
const release = path.join(project, "artifacts/releases", version);
await mkdir(release, { recursive: true });
const names = [
  `JEAuditFlow-${version}-Backend.zip`, `JEAuditFlow-${version}-Web-Client.zip`,
  `JEAuditFlow-${version}-Browser-Extension.zip`, `JEAuditFlow-${version}-Browser-Extension.manifest.json`,
  `JEAuditFlow-${version}-Database.zip`, `JEAuditFlow-${version}-Database.tar.gz`,
  `JEAuditFlow-${version}-Deployment-Support.zip`, `JEAuditFlow-${version}-Deployment-Support.manifest.json`,
  `JEAuditFlow-${version}-macOS-Launcher.app.zip`, `JEAuditFlow-${version}-macOS-Launcher.manifest.json`,
  `JEAuditFlow-${version}-Source.zip`
];
for (const name of names) await cp(path.join(candidate, name), path.join(release, name));
const documentation = [
  ["JEAuditFlow-7.7.0-Local-Installation-ZH.md", "INSTALL-7.7-ZH.md"],
  ["JEAuditFlow-7.7.0-Release-Notes-ZH.md", "RELEASE-NOTES-7.7-ZH.md"],
  ["JEAuditFlow-7.7.0-Verification.md", "VERIFICATION-7.7.0.md"],
  ["7.7-report-field-mapping.md", "REPORT-FIELD-MAPPING-7.7.md"],
  ["7.7-sso-mail-setup.md", "SSO-MAIL-SETUP-7.7.md"],
  ["7.7-jira-finding-channel.md", "JIRA-FINDING-CHANNEL-7.7.md"]
];
for (const [source, destination] of documentation) {
  await cp(path.join(project, "docs", source), path.join(release, destination));
  names.push(destination);
}
let localAcceptance = null;
try {
  localAcceptance = JSON.parse(await readFile(path.join(candidate, "local-acceptance.json"), "utf8"));
  if (localAcceptance.version !== version || localAcceptance.migration?.status !== "verified" ||
    localAcceptance.sourceHashesUnchanged !== true ||
    localAcceptance.installedLauncher?.matchesPackagedBundle !== true ||
    Object.values(localAcceptance.health || {}).length !== 4 ||
    Object.values(localAcceptance.health).some(service => service.httpStatus !== 200 || service.status !== "ok")) {
    throw new Error("Local installation evidence is incomplete or failed");
  }
  await cp(path.join(candidate, "local-acceptance.json"), path.join(release, "LOCAL-ACCEPTANCE-7.7.json"));
  names.push("LOCAL-ACCEPTANCE-7.7.json");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
async function record(name, kind = "release-support") {
  const filename = path.join(release, name);
  return { file: name, sizeBytes: (await stat(filename)).size,
    sha256: createHash("sha256").update(await readFile(filename)).digest("hex"), kind };
}
const built = JSON.parse(await readFile(path.join(candidate, "release-manifest.json"), "utf8"));
if (built.product !== "JEAuditFlow" || built.version !== version) throw new Error("Expected the verified 7.7 candidate");
const artifacts = [];
for (const name of names) {
  const item = await record(name, built.artifacts.find(artifact => artifact.file === name)?.kind ||
    (name.endsWith("-Source.zip") ? "public-source" : "release-support"));
  const expected = built.artifacts.find(artifact => artifact.file === name)?.sha256;
  if (expected && item.sha256 !== expected) throw new Error(`Candidate changed before assembly: ${name}`);
  artifacts.push(item);
}
const manifest = {
  ...built, candidate: false, generatedAt: new Date().toISOString(), artifacts,
  productRuntimeDeployed: Boolean(localAcceptance),
  publicServerDeployed: false,
  deploymentBoundary: localAcceptance ? "verified local installation only" : "packages only",
  localInstallation: localAcceptance ? {
    verifiedAt: localAcceptance.checkedAt, evidence: "LOCAL-ACCEPTANCE-7.7.json",
    sourceHashesUnchanged: localAcceptance.sourceHashesUnchanged,
    installedLauncherMatchesPackage: localAcceptance.installedLauncher.matchesPackagedBundle
  } : null,
  buildBoundary: { databaseWritesPerformed: false, credentialsIncluded: false, controlledCustomerDatasetsIncluded: false },
  verification: "VERIFICATION-7.7.0.md",
  source: { file: `JEAuditFlow-${version}-Source.zip`, layout: "src/AuditFlowDesktop/WebApp; src/JiraFlow; local-deploy; database; tools/AtlassianServiceLauncher",
    controlledDatasets: "omitted", tests: "focused synthetic suites", privateWindowsScreenshots: "omitted" },
  notes: ["INSTALL-7.7-ZH.md", "RELEASE-NOTES-7.7-ZH.md"]
};
await writeFile(path.join(release, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
names.push("release-manifest.json");
const checksums = [];
for (const name of names) {
  const item = await record(name);
  checksums.push(`${item.sha256}  ${name}`);
}
await writeFile(path.join(release, "SHA256SUMS.txt"), `${checksums.join("\n")}\n`);
const complete = `JEAuditFlow-${version}-Complete-Install.zip`;
await rm(path.join(release, complete), { force: true });
execFileSync("zip", ["-q", "-X", path.join(release, complete), ...names, "SHA256SUMS.txt"], { cwd: release });
execFileSync("unzip", ["-tqq", path.join(release, complete)]);
const completeRecord = await record(complete, "complete-install");
await writeFile(path.join(release, "SHA256SUMS.txt"), `${checksums.join("\n")}\n${completeRecord.sha256}  ${complete}\n`);
execFileSync("shasum", ["-a", "256", "-c", "SHA256SUMS.txt"], { cwd: release, stdio: "inherit" });
console.log(JSON.stringify({ release, artifacts: [...artifacts, completeRecord], files: names.length + 2 }, null, 2));
