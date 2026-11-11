#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = process.env.AUDITFLOW_RELEASE_VERSION || "7.4.0";
if (!["7.4.0", "7.5.0", "7.6.0"].includes(version)) throw new Error(`Unsupported deployment-support version: ${version}`);
const minorVersion = version.replace(/\.0$/, "");
const rootName = `JEAuditFlow-${version}-Deployment-Support`;
const archiveName = `${rootName}.zip`;
const payload = [
  [`local-deploy/DEPLOYMENT-SUPPORT-${minorVersion}.md`, "README.md"],
  ["local-deploy/scripts/jeauditflow-local.sh"],
  ["local-deploy/docker/compose.yaml"],
  [`local-deploy/templates/${minorVersion}.local-settings.env.example`],
  ["local-deploy/launcher/Package.swift"],
  ["local-deploy/launcher/Sources/JEAuditFlowLauncher/main.swift"],
  ["local-deploy/launcher/script/build_and_run.sh"],
  ["local-deploy/launcher/Resources/JEAuditFlowLauncher-icon-source.png"],
  ...(version === "7.4.0" ? [
    ["local-deploy/LANDING-RECOVERY-7.4.md"],
    ["local-deploy/docker-7.4/.dockerignore"],
    ["local-deploy/docker-7.4/.env.example"],
    ["local-deploy/docker-7.4/.gitignore"],
    ["local-deploy/docker-7.4/Dockerfile.backend"],
    ["local-deploy/docker-7.4/Dockerfile.client"],
    ["local-deploy/docker-7.4/README.md"],
    ["local-deploy/docker-7.4/compose.yaml"],
    ["local-deploy/docker-7.4/entrypoint.mjs"],
    ["local-deploy/docker-7.4/healthcheck.mjs"],
    ["local-deploy/docker-7.4/init-local.mjs"],
    ["local-deploy/docker-7.4/nginx.conf"],
    ["local-deploy/docker-7.4/prepare-context.mjs"],
    ["local-deploy/docker-7.4/verify.mjs"]
  ] : [])
].map(([source, target = source]) => ({ source, target }));

const options = {
  release: process.env.AUDITFLOW_CANDIDATE_ROOT || path.join(project, "artifacts/candidates", version === "7.4.0" ? "7.4.0-access-recovery-20261108" : `${version}-candidate`),
  dryRun: false,
  replace: false
};
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument === "--release-dir" && process.argv[index + 1]) options.release = path.resolve(process.argv[++index]);
  else if (argument === "--dry-run") options.dryRun = true;
  else if (argument === "--replace") options.replace = true;
  else throw new Error(`Usage: node scripts/package-${minorVersion}-deployment-support.mjs [--release-dir DIR] [--dry-run] [--replace]`);
}

function run(command, arguments_, cwd) {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

async function sha256(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

function assertSafe(relative) {
  const segments = relative.split("/");
  if (path.isAbsolute(relative) || relative.includes("\\") || segments.some(part =>
    ["", ".", "..", "config", "runtime", "secrets", "context", "node_modules", ".git", ".env", ".build", "dist", ".codex"].includes(part))) {
    throw new Error(`Disallowed deployment-support path: ${relative}`);
  }
}

async function walk(directory, prefix = "") {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path.join(directory, entry.name), relative));
    else if (entry.isFile()) paths.push(relative);
    else throw new Error(`Unexpected non-regular archive member: ${relative}`);
  }
  return paths.sort();
}

const release = JSON.parse(await readFile(path.join(options.release, "release-manifest.json"), "utf8"));
if (release.product !== "JEAuditFlow" || release.version !== version || !Array.isArray(release.artifacts)) {
  throw new Error(`Expected a JEAuditFlow ${version} release manifest`);
}
const sourceFiles = [];
for (const entry of payload) {
  assertSafe(entry.source);
  assertSafe(entry.target);
  const filename = path.join(project, entry.source);
  const metadata = await lstat(filename);
  if (!metadata.isFile() || metadata.isSymbolicLink() || !((await realpath(filename)).startsWith(`${project}${path.sep}`))) {
    throw new Error(`Expected a regular in-project source file: ${entry.source}`);
  }
  sourceFiles.push({ ...entry, bytes: metadata.size, sha256: await sha256(filename), executable: Boolean(metadata.mode & 0o111) });
}
if (options.dryRun) {
  console.log(JSON.stringify({ dryRun: true, version, releaseGeneratedAt: release.generatedAt, archive: archiveName, files: sourceFiles }, null, 2));
  process.exit(0);
}

const output = path.join(options.release, archiveName);
try {
  await lstat(output);
  if (!options.replace) throw new Error(`${archiveName} exists; pass --replace to replace this generated support archive`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const checksumFile = path.join(options.release, "SHA256SUMS.txt");
const checksumText = await readFile(checksumFile, "utf8");
const checksums = new Map(checksumText.split(/\r?\n/).filter(Boolean).map(line => {
  const match = line.match(/^([a-f\d]{64})\s+\*?([^\r\n]+)$/i);
  if (!match) throw new Error("Malformed SHA256SUMS.txt entry");
  return [match[2].replace(/^\.\//, ""), match[1].toLowerCase()];
}));
for (const artifact of release.artifacts) {
  if (path.basename(artifact.file) !== artifact.file) throw new Error("Unsafe application artifact filename");
  const actual = await sha256(path.join(options.release, artifact.file));
  if (actual !== artifact.sha256 || checksums.get(artifact.file) !== actual) {
    throw new Error(`Application archive differs from the final release manifest: ${artifact.file}`);
  }
}

const temporary = await mkdtemp(path.join(os.tmpdir(), `jeauditflow-${version.replaceAll(".", "")}-support-`));
try {
  const staging = path.join(temporary, rootName);
  await mkdir(staging);
  for (const entry of sourceFiles) {
    const target = path.join(staging, entry.target);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(project, entry.source), target);
    await chmod(target, entry.executable ? 0o755 : 0o644);
    if (await sha256(target) !== entry.sha256) throw new Error(`Source changed during packaging: ${entry.source}`);
  }
  const manifest = {
    product: "JEAuditFlow", version, packageType: "deployment-support", generatedAt: new Date().toISOString(),
    sourceBuild: path.basename(options.release), sourceReleaseGeneratedAt: release.generatedAt,
    deploymentTargets: version === "7.4.0" ? ["macos-native-with-docker-mysql", "docker"] : ["macos-native-with-docker-mysql"],
    includesApplicationArchives: false, containsRuntimeCredentials: false, usesExplicitAllowlist: true,
    applicationArchives: release.artifacts.map(({ file, sizeBytes, sha256: digest }) => ({ file, sizeBytes, sha256: digest })),
    files: sourceFiles.map(({ source, target, bytes, sha256: digest, executable }) => ({ source, file: target, sizeBytes: bytes, sha256: digest, executable }))
  };
  const manifestName = "deployment-support-manifest.json";
  await writeFile(path.join(staging, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
  const internalChecksums = sourceFiles.map(entry => `${entry.sha256}  ${entry.target}`);
  internalChecksums.push(`${await sha256(path.join(staging, manifestName))}  ${manifestName}`);
  await writeFile(path.join(staging, "SHA256SUMS.txt"), `${internalChecksums.join("\n")}\n`);
  const archive = path.join(temporary, archiveName);
  run("zip", ["-qr", archive, rootName], temporary);
  run("unzip", ["-tqq", archive]);
  const extracted = path.join(temporary, "extracted");
  await mkdir(extracted);
  run("unzip", ["-q", archive, "-d", extracted]);
  const extractedRoot = path.join(extracted, rootName);
  const expected = [...sourceFiles.map(entry => entry.target), manifestName, "SHA256SUMS.txt"].sort();
  if (JSON.stringify(await walk(extractedRoot)) !== JSON.stringify(expected)) throw new Error("Support archive differs from its explicit allowlist");
  for (const entry of sourceFiles) {
    if (await sha256(path.join(extractedRoot, entry.target)) !== entry.sha256) throw new Error(`Extracted checksum mismatch: ${entry.target}`);
  }
  for (const entry of sourceFiles.filter(file => file.target.endsWith(".sh"))) {
    run("bash", ["-n", path.join(extractedRoot, entry.target)]);
  }
  for (const entry of sourceFiles.filter(file => file.target.endsWith(".mjs"))) {
    run(process.execPath, ["--check", path.join(extractedRoot, entry.target)]);
  }
  const digest = await sha256(archive);
  const sizeBytes = (await lstat(archive)).size;
  const sidecar = { ...manifest, artifact: { file: archiveName, sizeBytes, sha256: digest, integrity: "passed", extractedAllowlist: "passed", syntax: { bash: "passed", node: "passed", swift: "not-run-by-support-packager" } } };
  const nextArchive = `${output}.next-${process.pid}`;
  await copyFile(archive, nextArchive);
  await rename(nextArchive, output);
  await writeFile(path.join(options.release, `${rootName}.manifest.json`), `${JSON.stringify(sidecar, null, 2)}\n`);
  checksums.set(archiveName, digest);
  const nextChecksums = `${checksumFile}.next-${process.pid}`;
  await writeFile(nextChecksums, `${[...checksums].map(([file, hash]) => `${hash}  ${file}`).join("\n")}\n`);
  await rename(nextChecksums, checksumFile);
  console.log(JSON.stringify({ file: output, sizeBytes, sha256: digest, payloadFiles: sourceFiles.length, archiveFiles: expected.length, applicationServicesStarted: false, databaseWritesPerformed: false }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
