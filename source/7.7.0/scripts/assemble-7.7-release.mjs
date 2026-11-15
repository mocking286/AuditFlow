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
const names = [
  `JEAuditFlow-${version}-Backend.zip`, `JEAuditFlow-${version}-Web-Client.zip`,
  `JEAuditFlow-${version}-Browser-Extension.zip`, `JEAuditFlow-${version}-Browser-Extension.manifest.json`,
  `JEAuditFlow-${version}-Database.zip`, `JEAuditFlow-${version}-Database.tar.gz`,
  `JEAuditFlow-${version}-Deployment-Support.zip`, `JEAuditFlow-${version}-Deployment-Support.manifest.json`,
  `JEAuditFlow-${version}-macOS-Launcher.app.zip`, `JEAuditFlow-${version}-macOS-Launcher.manifest.json`,
  `JEAuditFlow-${version}-Source.zip`
];
const documentation = [
  ["JEAuditFlow-7.7.0-Local-Installation-ZH.md", "INSTALL-7.7-ZH.md"],
  ["JEAuditFlow-7.7.0-Release-Notes-ZH.md", "RELEASE-NOTES-7.7-ZH.md"],
  ["JEAuditFlow-7.7.0-Verification.md", "VERIFICATION-7.7.0.md"],
  ["7.7-report-field-mapping.md", "REPORT-FIELD-MAPPING-7.7.md"],
  ["7.7-sso-mail-setup.md", "SSO-MAIL-SETUP-7.7.md"],
  ["7.7-jira-finding-channel.md", "JIRA-FINDING-CHANNEL-7.7.md"],
  ["JEAuditFlow-7.7.0-Data-Upgrade-ZH.md", "DATA-UPGRADE-7.7-ZH.md"],
  ["JEAuditFlow-7.7.0-Access-Recovery-ZH.md", "ACCESS-RECOVERY-7.7-ZH.md"]
];

async function record(directory, name, kind = "release-support") {
  const filename = path.join(directory, name);
  return { file: name, sizeBytes: (await stat(filename)).size,
    sha256: createHash("sha256").update(await readFile(filename)).digest("hex"), kind };
}

function sameArtifact(actual, expected) {
  return expected && Number.isSafeInteger(expected.sizeBytes) && expected.sizeBytes >= 0 &&
    /^[a-f\d]{64}$/i.test(expected.sha256 || "") &&
    actual.sizeBytes === expected.sizeBytes && actual.sha256 === expected.sha256.toLowerCase();
}

const built = JSON.parse(await readFile(path.join(candidate, "release-manifest.json"), "utf8"));
if (built.product !== "JEAuditFlow" || built.version !== version || !Array.isArray(built.artifacts) ||
  !Number.isFinite(Date.parse(built.generatedAt))) throw new Error("Expected the verified 7.7 candidate");
const declaredArtifacts = new Map();
for (const artifact of built.artifacts) {
  if (!artifact || typeof artifact.file !== "string" || declaredArtifacts.has(artifact.file)) {
    throw new Error("Candidate manifest has invalid or duplicate artifacts");
  }
  declaredArtifacts.set(artifact.file, artifact);
}
const candidateArtifacts = [];
for (const name of names) {
  const declared = declaredArtifacts.get(name);
  const item = await record(candidate, name, declared?.kind ||
    (name.endsWith("-Source.zip") ? "public-source" : "release-support"));
  if (declared && !sameArtifact(item, declared)) throw new Error(`Candidate changed before assembly: ${name}`);
  candidateArtifacts.push(item);
}

let acceptanceText;
try {
  acceptanceText = await readFile(path.join(candidate, "local-acceptance.json"), "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
let localAcceptance = null;
if (acceptanceText !== undefined) {
  localAcceptance = JSON.parse(acceptanceText);
  const binding = localAcceptance?.packageBinding;
  if (localAcceptance?.version !== version || binding?.candidateGeneratedAt !== built.generatedAt ||
    !Array.isArray(binding.artifacts) || binding.artifacts.length !== names.length ||
    !Number.isFinite(Date.parse(localAcceptance.checkedAt)) ||
    Date.parse(localAcceptance.checkedAt) < Date.parse(built.generatedAt)) {
    throw new Error("Local acceptance is stale or missing the exact candidate package binding");
  }
  const acceptedArtifacts = new Map();
  for (const artifact of binding.artifacts) {
    if (!artifact || !names.includes(artifact.file) || acceptedArtifacts.has(artifact.file)) {
      throw new Error("Local acceptance has unexpected or duplicate package binding entries");
    }
    acceptedArtifacts.set(artifact.file, artifact);
  }
  for (const artifact of candidateArtifacts) {
    if (!sameArtifact(artifact, acceptedArtifacts.get(artifact.file))) {
      throw new Error(`Local acceptance does not match the current package: ${artifact.file}`);
    }
  }
  const services = ["auditflow", "fileAnalyst", "jiraFlow", "aiBridge"];
  if (
    localAcceptance.sourceHashesUnchanged !== true ||
    localAcceptance.installedLauncher?.version !== version ||
    localAcceptance.installedLauncher?.matchesPackagedBundle !== true ||
    Object.keys(localAcceptance.health || {}).length !== services.length ||
    services.some(name => localAcceptance.health?.[name]?.httpStatus !== 200 ||
      localAcceptance.health?.[name]?.status !== "ok")) {
    throw new Error("Local installation evidence is incomplete or failed");
  }
}
// Historical native-migration evidence does not establish a general data upgrade.
const dataUpgrade = localAcceptance?.dataUpgrade ?? { status: "not-evidenced" };
if (!["not-evidenced", "not-run", "not-required", "blocked", "verified"].includes(dataUpgrade.status)) {
  throw new Error("Local acceptance has an invalid general data-upgrade status");
}
const preflightArtifacts = [...candidateArtifacts];
for (const [source, destination] of documentation) {
  preflightArtifacts.push({ ...await record(path.join(project, "docs"), source), file: destination });
}
if (localAcceptance) {
  preflightArtifacts.push({ file: "LOCAL-ACCEPTANCE-7.7.json", sizeBytes: Buffer.byteLength(acceptanceText),
    sha256: createHash("sha256").update(acceptanceText).digest("hex"), kind: "release-support" });
}

// Do not create or modify the release until all candidate and acceptance checks pass.
await mkdir(release, { recursive: true });
for (const name of names) await cp(path.join(candidate, name), path.join(release, name));
for (const [source, destination] of documentation) {
  await cp(path.join(project, "docs", source), path.join(release, destination));
  names.push(destination);
}
if (localAcceptance) {
  await writeFile(path.join(release, "LOCAL-ACCEPTANCE-7.7.json"), acceptanceText);
  names.push("LOCAL-ACCEPTANCE-7.7.json");
} else {
  await rm(path.join(release, "LOCAL-ACCEPTANCE-7.7.json"), { force: true });
}
const artifacts = [];
for (const expected of preflightArtifacts) {
  const item = await record(release, expected.file, expected.kind);
  if (!sameArtifact(item, expected)) throw new Error(`Candidate changed during assembly: ${item.file}`);
  artifacts.push(item);
}
const manifest = {
  ...built, candidate: false, generatedAt: new Date().toISOString(), artifacts,
  productRuntimeDeployed: Boolean(localAcceptance),
  publicServerDeployed: false,
  deploymentBoundary: localAcceptance ? "verified local installation only" : "packages only",
  dataUpgrade,
  localInstallation: localAcceptance ? {
    verifiedAt: localAcceptance.checkedAt, evidence: "LOCAL-ACCEPTANCE-7.7.json",
    packageBinding: localAcceptance.packageBinding,
    sourceHashesUnchanged: localAcceptance.sourceHashesUnchanged,
    installedLauncherMatchesPackage: localAcceptance.installedLauncher.matchesPackagedBundle
  } : null,
  buildBoundary: { databaseWritesPerformed: false, credentialsIncluded: false, controlledCustomerDatasetsIncluded: false },
  verification: "VERIFICATION-7.7.0.md",
  source: { file: `JEAuditFlow-${version}-Source.zip`, layout: "src/AuditFlowDesktop/WebApp; src/JiraFlow; local-deploy; database; tools/AtlassianServiceLauncher",
    controlledDatasets: "omitted", tests: "focused synthetic suites", privateWindowsScreenshots: "omitted" },
  notes: ["INSTALL-7.7-ZH.md", "RELEASE-NOTES-7.7-ZH.md", "DATA-UPGRADE-7.7-ZH.md", "ACCESS-RECOVERY-7.7-ZH.md"]
};
await writeFile(path.join(release, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
names.push("release-manifest.json");
const checksums = [];
for (const name of names) {
  const item = await record(release, name);
  checksums.push(`${item.sha256}  ${name}`);
}
await writeFile(path.join(release, "SHA256SUMS.txt"), `${checksums.join("\n")}\n`);
const complete = `JEAuditFlow-${version}-Complete-Install.zip`;
await rm(path.join(release, complete), { force: true });
execFileSync("zip", ["-q", "-X", path.join(release, complete), ...names, "SHA256SUMS.txt"], { cwd: release });
execFileSync("unzip", ["-tqq", path.join(release, complete)]);
const completeRecord = await record(release, complete, "complete-install");
await writeFile(path.join(release, "SHA256SUMS.txt"), `${checksums.join("\n")}\n${completeRecord.sha256}  ${complete}\n`);
execFileSync("shasum", ["-a", "256", "-c", "SHA256SUMS.txt"], { cwd: release, stdio: "inherit" });
console.log(JSON.stringify({ release, artifacts: [...artifacts, completeRecord], files: names.length + 2 }, null, 2));
