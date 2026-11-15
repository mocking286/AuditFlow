import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const version = "7.7.0";
const generatedAt = "2026-11-16T01:00:00.000Z";
const suffixes = [
  "Backend.zip", "Web-Client.zip", "Browser-Extension.zip", "Browser-Extension.manifest.json",
  "Database.zip", "Database.tar.gz", "Deployment-Support.zip", "Deployment-Support.manifest.json",
  "macOS-Launcher.app.zip", "macOS-Launcher.manifest.json", "Source.zip"
];
const coreSuffixes = new Set(["Backend.zip", "Web-Client.zip", "Browser-Extension.zip", "Database.zip", "Database.tar.gz"]);
const documents = [
  "JEAuditFlow-7.7.0-Local-Installation-ZH.md", "JEAuditFlow-7.7.0-Release-Notes-ZH.md",
  "JEAuditFlow-7.7.0-Verification.md", "7.7-report-field-mapping.md", "7.7-sso-mail-setup.md",
  "7.7-jira-finding-channel.md", "JEAuditFlow-7.7.0-Data-Upgrade-ZH.md",
  "JEAuditFlow-7.7.0-Access-Recovery-ZH.md"
];
const digest = value => createHash("sha256").update(value).digest("hex");

async function fixture(t, { existingRelease = false } = {}) {
  const project = await mkdtemp(path.join(os.tmpdir(), "auditflow-77-acceptance-test-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  const scripts = path.join(project, "scripts");
  const candidate = path.join(project, "artifacts/candidates/7.7.0-candidate");
  const release = path.join(project, "artifacts/releases/7.7.0");
  await mkdir(scripts, { recursive: true });
  await mkdir(candidate, { recursive: true });
  await mkdir(path.join(project, "docs"));
  await copyFile(new URL("./assemble-7.7-release.mjs", import.meta.url), path.join(scripts, "assemble-7.7-release.mjs"));
  const artifacts = [];
  for (const suffix of suffixes) {
    const file = `JEAuditFlow-${version}-${suffix}`;
    const content = `synthetic deliverable: ${suffix}\n`;
    await writeFile(path.join(candidate, file), content);
    artifacts.push({ file, sizeBytes: Buffer.byteLength(content), sha256: digest(content) });
  }
  for (const name of documents) await writeFile(path.join(project, "docs", name), `synthetic document: ${name}\n`);
  const manifest = {
    product: "JEAuditFlow", version, candidate: true, generatedAt,
    artifacts: artifacts.filter(item => coreSuffixes.has(item.file.slice(`JEAuditFlow-${version}-`.length)))
  };
  const saveManifest = () => writeFile(path.join(candidate, "release-manifest.json"), JSON.stringify(manifest));
  await saveManifest();
  if (existingRelease) {
    await mkdir(release, { recursive: true });
    await writeFile(path.join(release, "keep.txt"), "previous release must not change\n");
    await writeFile(path.join(release, "JEAuditFlow-7.7.0-Backend.zip"), "previous backend\n");
  }
  return { project, candidate, release, artifacts, manifest, saveManifest };
}

function acceptance(artifacts) {
  return {
    version, checkedAt: "2026-11-16T02:00:00.000Z",
    packageBinding: { candidateGeneratedAt: generatedAt, artifacts: structuredClone(artifacts) },
    sourceHashesUnchanged: true,
    installedLauncher: { version, matchesPackagedBundle: true },
    health: Object.fromEntries(["auditflow", "fileAnalyst", "jiraFlow", "aiBridge"].map(service =>
      [service, { httpStatus: 200, status: "ok" }])),
    migration: { status: "verified", sourceModified: false }
  };
}

function assemble(project) {
  const environment = { ...process.env };
  delete environment.AUDITFLOW_CANDIDATE_ROOT;
  return spawnSync(process.execPath, [path.join(project, "scripts/assemble-7.7-release.mjs")], {
    cwd: project, env: environment, encoding: "utf8", maxBuffer: 2 * 1024 * 1024
  });
}

async function saveAcceptance(candidate, evidence) {
  await writeFile(path.join(candidate, "local-acceptance.json"), JSON.stringify(evidence));
}

async function assertExistingReleaseUnchanged(release) {
  assert.deepEqual((await readdir(release)).sort(), ["JEAuditFlow-7.7.0-Backend.zip", "keep.txt"]);
  assert.equal(await readFile(path.join(release, "keep.txt"), "utf8"), "previous release must not change\n");
  assert.equal(await readFile(path.join(release, "JEAuditFlow-7.7.0-Backend.zip"), "utf8"), "previous backend\n");
}

test("absent local acceptance publishes packages only and standalone recovery documents", async t => {
  const { project, release } = await fixture(t);
  const result = assemble(project);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(await readFile(path.join(release, "release-manifest.json"), "utf8"));
  assert.equal(manifest.productRuntimeDeployed, false);
  assert.equal(manifest.deploymentBoundary, "packages only");
  assert.equal(manifest.localInstallation, null);
  assert.deepEqual(manifest.dataUpgrade, { status: "not-evidenced" });
  assert.ok(manifest.artifacts.some(item => item.file === "DATA-UPGRADE-7.7-ZH.md"));
  assert.ok(manifest.artifacts.some(item => item.file === "ACCESS-RECOVERY-7.7-ZH.md"));
});

test("legacy unbound acceptance cannot create a release or imply deployment", async t => {
  const { project, candidate, release, artifacts } = await fixture(t);
  const evidence = acceptance(artifacts);
  delete evidence.packageBinding;
  evidence.checkedAt = "2026-11-14T07:56:48.768Z";
  await saveAcceptance(candidate, evidence);
  const result = assemble(project);
  assert.notEqual(result.status, 0);
  await assert.rejects(readdir(release), { code: "ENOENT" });
});

test("packages-only reassembly cannot retain a previous local-acceptance file", async t => {
  const { project, release } = await fixture(t, { existingRelease: true });
  await writeFile(path.join(release, "LOCAL-ACCEPTANCE-7.7.json"), '{"historical":true}');
  const result = assemble(project);
  assert.equal(result.status, 0, result.stderr);
  await assert.rejects(readFile(path.join(release, "LOCAL-ACCEPTANCE-7.7.json")), { code: "ENOENT" });
});

test("bound runtime acceptance does not promote historical native migration into a general data upgrade", async t => {
  const { project, candidate, release, artifacts } = await fixture(t);
  await saveAcceptance(candidate, acceptance(artifacts));
  const result = assemble(project);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(await readFile(path.join(release, "release-manifest.json"), "utf8"));
  assert.equal(manifest.productRuntimeDeployed, true);
  assert.deepEqual(manifest.dataUpgrade, { status: "not-evidenced" });
  assert.equal(manifest.localInstallation.packageBinding.artifacts.length, 11);
  assert.equal(manifest.localInstallation.packageBinding.candidateGeneratedAt, generatedAt);
});

test("a blocked general data upgrade remains explicit and does not require a migration to assemble", async t => {
  const { project, candidate, release, artifacts } = await fixture(t);
  const evidence = acceptance(artifacts);
  delete evidence.migration;
  evidence.dataUpgrade = { status: "blocked", databaseWritesPerformed: false };
  await saveAcceptance(candidate, evidence);
  const result = assemble(project);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(await readFile(path.join(release, "release-manifest.json"), "utf8"));
  assert.deepEqual(manifest.dataUpgrade, { status: "blocked", databaseWritesPerformed: false });
});

for (const suffix of suffixes) {
  test(`a rebuilt ${suffix} invalidates acceptance before an existing release changes`, async t => {
    const { project, candidate, release, artifacts, manifest, saveManifest } = await fixture(t, { existingRelease: true });
    await saveAcceptance(candidate, acceptance(artifacts));
    const file = `JEAuditFlow-${version}-${suffix}`;
    const content = `corrupted deliverable: ${suffix}\n`;
    assert.equal(Buffer.byteLength(content), artifacts.find(item => item.file === file).sizeBytes);
    await writeFile(path.join(candidate, file), content);
    const declared = manifest.artifacts.find(item => item.file === file);
    if (declared) Object.assign(declared, { sizeBytes: Buffer.byteLength(content), sha256: digest(content) });
    await saveManifest();
    const result = assemble(project);
    assert.notEqual(result.status, 0);
    await assertExistingReleaseUnchanged(release);
  });
}

for (const [name, alter] of [
  ["missing binding entry", evidence => evidence.packageBinding.artifacts.pop()],
  ["duplicate binding entry", evidence => evidence.packageBinding.artifacts[10] = evidence.packageBinding.artifacts[0]],
  ["extra binding entry", evidence => evidence.packageBinding.artifacts.push({
    file: "unexpected.zip", sizeBytes: 1, sha256: "a".repeat(64)
  })],
  ["wrong bound size with matching hash", evidence => evidence.packageBinding.artifacts[10].sizeBytes++],
  ["invalid bound hash", evidence => evidence.packageBinding.artifacts[10].sha256 = "invalid"],
  ["different candidate generation", evidence => evidence.packageBinding.candidateGeneratedAt = "2026-11-15T01:00:00.000Z"],
  ["acceptance predating the candidate", evidence => evidence.checkedAt = "2026-11-14T01:00:00.000Z"],
  ["invalid acceptance timestamp", evidence => evidence.checkedAt = "not-a-timestamp"],
  ["missing named service", evidence => {
    evidence.health.otherService = evidence.health.aiBridge;
    delete evidence.health.aiBridge;
  }],
  ["wrong launcher version", evidence => evidence.installedLauncher.version = "7.6.0"],
  ["invalid general data-upgrade status", evidence => evidence.dataUpgrade = { status: "complete-maybe" }]
]) {
  test(`${name} rejects acceptance before release mutation`, async t => {
    const { project, candidate, release, artifacts } = await fixture(t, { existingRelease: true });
    const evidence = acceptance(artifacts);
    alter(evidence);
    await saveAcceptance(candidate, evidence);
    const result = assemble(project);
    assert.notEqual(result.status, 0);
    await assertExistingReleaseUnchanged(release);
  });
}

test("a candidate size mismatch is rejected before packages-only release mutation", async t => {
  const { project, release, manifest, saveManifest } = await fixture(t, { existingRelease: true });
  manifest.artifacts[0].sizeBytes++;
  await saveManifest();
  const result = assemble(project);
  assert.notEqual(result.status, 0);
  await assertExistingReleaseUnchanged(release);
});

test("missing recovery documentation fails preflight before release mutation", async t => {
  const { project, release } = await fixture(t, { existingRelease: true });
  await rm(path.join(project, "docs/JEAuditFlow-7.7.0-Access-Recovery-ZH.md"));
  const result = assemble(project);
  assert.notEqual(result.status, 0);
  await assertExistingReleaseUnchanged(release);
});
