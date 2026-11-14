#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = process.env.AUDITFLOW_RELEASE_VERSION || "7.5.0";
if (!["7.5.0", "7.6.0", "7.7.0"].includes(version)) throw new Error(`Unsupported launcher release: ${version}`);
const artifactName = `JEAuditFlow-${version}-macOS-Launcher.app.zip`;
const options = {
  release: process.env.AUDITFLOW_CANDIDATE_ROOT || path.join(project, "artifacts/candidates", `${version}-candidate`),
  app: path.join(project, "local-deploy/launcher/dist/JEAuditFlowLauncher.app"),
  replace: false,
  dryRun: false
};
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument === "--release-dir" && process.argv[index + 1]) options.release = path.resolve(process.argv[++index]);
  else if (argument === "--app" && process.argv[index + 1]) options.app = path.resolve(process.argv[++index]);
  else if (argument === "--replace") options.replace = true;
  else if (argument === "--dry-run") options.dryRun = true;
  else throw new Error("Usage: node scripts/package-7.5-launcher.mjs [--release-dir DIR] [--app APP] [--dry-run] [--replace]");
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

async function sha256(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

async function filesUnder(root, prefix = "") {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (["config", "runtime", "node_modules", ".git", ".env", ".DS_Store", "__MACOSX"].includes(entry.name)) {
      throw new Error(`Disallowed launcher payload: ${relative}`);
    }
    if (entry.isDirectory()) files.push(...await filesUnder(path.join(root, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`Unexpected non-regular launcher payload: ${relative}`);
  }
  return files.sort();
}

if (process.platform !== "darwin") throw new Error("The macOS launcher archive must be verified and built on macOS");
const release = JSON.parse(await readFile(path.join(options.release, "release-manifest.json"), "utf8"));
if (release.product !== "JEAuditFlow" || release.version !== version) throw new Error(`Expected a ${version} application release`);
const appMetadata = await lstat(options.app);
if (!appMetadata.isDirectory() || appMetadata.isSymbolicLink() || path.basename(options.app) !== "JEAuditFlowLauncher.app") {
  throw new Error("Expected a regular JEAuditFlowLauncher.app bundle");
}
const info = path.join(options.app, "Contents/Info.plist");
const bundleVersion = run("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", info]);
if (bundleVersion !== version) throw new Error(`Launcher version is ${bundleVersion}; rebuild for ${version}`);
const bundleIdentifier = run("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", info]);
if (bundleIdentifier !== "local.maplemock.jeauditflowlauncher") throw new Error("Unexpected launcher bundle identifier");
run("/usr/bin/codesign", ["--verify", "--deep", "--strict", options.app]);
const architectures = run("/usr/bin/lipo", ["-archs", path.join(options.app, "Contents/MacOS/JEAuditFlowLauncher")]).split(/\s+/);
const files = await filesUnder(options.app);
const sourceDigests = new Map();
for (const file of files) sourceDigests.set(file, await sha256(path.join(options.app, file)));
if (options.dryRun) {
  console.log(JSON.stringify({ dryRun: true, version, app: options.app, archive: artifactName, architectures, bundleFiles: files.length, signature: "passed" }, null, 2));
  process.exit(0);
}

const output = path.join(options.release, artifactName);
try {
  await lstat(output);
  if (!options.replace) throw new Error(`${artifactName} exists; pass --replace to replace the generated archive`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const checksumFile = path.join(options.release, "SHA256SUMS.txt");
const checksumText = await readFile(checksumFile, "utf8");
const checksums = new Map(checksumText.split(/\r?\n/).filter(Boolean).map(line => {
  const match = line.match(/^([a-f\d]{64})\s+\*?([^\r\n]+)$/i);
  if (!match || path.basename(match[2]) !== match[2]) throw new Error("Malformed or unsafe root checksum entry");
  return [match[2], match[1].toLowerCase()];
}));
for (const artifact of release.artifacts) {
  if (path.basename(artifact.file) !== artifact.file) throw new Error("Unsafe application artifact filename");
  const digest = await sha256(path.join(options.release, artifact.file));
  if (digest !== artifact.sha256 || checksums.get(artifact.file) !== digest) {
    throw new Error(`Application archive differs from its release checksum: ${artifact.file}`);
  }
}
const temporary = await mkdtemp(path.join(os.tmpdir(), `jeauditflow-${version.replaceAll(".", "")}-launcher-`));
try {
  const archive = path.join(temporary, artifactName);
  run("/usr/bin/ditto", ["-c", "-k", "--keepParent", "--norsrc", "--noextattr", "--noqtn", options.app, archive]);
  run("/usr/bin/unzip", ["-tqq", archive]);
  const extracted = path.join(temporary, "extracted");
  run("/usr/bin/ditto", ["-x", "-k", archive, extracted]);
  const extractedApp = path.join(extracted, "JEAuditFlowLauncher.app");
  if (JSON.stringify(await filesUnder(extractedApp)) !== JSON.stringify(files)) throw new Error("Extracted launcher payload differs");
  for (const [file, digest] of sourceDigests) {
    if (await sha256(path.join(extractedApp, file)) !== digest || await sha256(path.join(options.app, file)) !== digest) {
      throw new Error(`Launcher changed during packaging: ${file}`);
    }
  }
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", extractedApp]);
  const artifact = { file: artifactName, sizeBytes: (await lstat(archive)).size, sha256: await sha256(archive), integrity: "passed" };
  const manifest = {
    product: "JEAuditFlow", version, packageType: "macos-launcher", generatedAt: new Date().toISOString(),
    sourceReleaseGeneratedAt: release.generatedAt, bundleIdentifier, architectures, minimumSystemVersion: "14.0",
    signature: "local-ad-hoc", signatureVerification: "passed-before-and-after-extraction", notarization: "not-performed",
    containsRuntimeCredentials: false, applicationServicesStarted: false, databaseWritesPerformed: false,
    files: [...sourceDigests].map(([file, sha256]) => ({ file, sha256 })), artifact
  };
  const nextArchive = `${output}.next-${process.pid}`;
  await copyFile(archive, nextArchive);
  await rename(nextArchive, output);
  await writeFile(path.join(options.release, `JEAuditFlow-${version}-macOS-Launcher.manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  checksums.set(artifactName, artifact.sha256);
  const nextChecksums = `${checksumFile}.next-${process.pid}`;
  await writeFile(nextChecksums, `${[...checksums].map(([file, digest]) => `${digest}  ${file}`).join("\n")}\n`);
  await rename(nextChecksums, checksumFile);
  console.log(JSON.stringify({ ...artifact, path: output, architectures, signatureVerification: manifest.signatureVerification, applicationServicesStarted: false, databaseWritesPerformed: false }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
