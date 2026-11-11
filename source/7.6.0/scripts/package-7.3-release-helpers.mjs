import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const hashFile = file => createHash("sha256").update(readFileSync(file)).digest("hex");

async function realPathForCreation(target) {
  let unresolved = path.resolve(target);
  const suffix = [];
  while (true) {
    try {
      const base = await realpath(unresolved);
      return path.join(base, ...suffix);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(unresolved);
      if (parent === unresolved) throw error;
      suffix.unshift(path.basename(unresolved));
      unresolved = parent;
    }
  }
}

export async function assertCandidateRoot(candidateRoot, candidatesRoot) {
  const allowedRoot = await realpath(candidatesRoot);
  const actualRoot = await realPathForCreation(candidateRoot);
  const relative = path.relative(allowedRoot, actualRoot);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("AUDITFLOW_CANDIDATE_ROOT must remain under artifacts/candidates");
  }
  return actualRoot;
}

export async function assertCandidateOutputPath(candidateRoot, outputPath) {
  const root = path.resolve(candidateRoot);
  const target = path.resolve(outputPath);
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Candidate output must remain beneath its candidate root");
  }

  let current = root;
  const components = relative.split(path.sep);
  for (let index = 0; index < components.length; index += 1) {
    current = path.join(current, components[index]);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (error.code === "ENOENT") break;
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      throw new Error(`Candidate output path must not contain a symbolic link: ${current}`);
    }
    if (index < components.length - 1 && !metadata.isDirectory()) {
      throw new Error(`Candidate output parent is not a directory: ${current}`);
    }
  }
  return target;
}

export async function writeCandidateFile(candidateRoot, outputPath, contents) {
  const target = await assertCandidateOutputPath(candidateRoot, outputPath);
  await mkdir(path.dirname(target), { recursive: true });
  await assertCandidateOutputPath(candidateRoot, target);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, contents, { flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function validateLocalHtmlResources(root) {
  const clientRoot = await realpath(root);
  const htmlFiles = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (/\.html?$/i.test(entry.name)) htmlFiles.push(file);
    }
  }
  await visit(clientRoot);
  if (!htmlFiles.some(file => path.relative(clientRoot, file) === "index.html")) {
    throw new Error("Required client entrypoint index.html is missing");
  }
  const problems = [];
  for (const htmlFile of htmlFiles) {
    const source = await readFile(htmlFile, "utf8");
    const refs = [...source.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi)];
    for (const match of refs) {
      const raw = match[2].trim();
      if (!raw || raw.startsWith("#") || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) continue;
      // Standalone HTML workbenches build some href/src values at runtime
      // (for example ${preview} and ${asset.dataUrl}). They are not static
      // package references and cannot be resolved by this release-time scan.
      if (raw.includes("${")) continue;
      let pathname;
      try { pathname = decodeURIComponent(raw.split(/[?#]/, 1)[0]); }
      catch { problems.push(`${path.relative(clientRoot, htmlFile)}: invalid URL encoding in ${raw}`); continue; }
      const target = raw.startsWith("/")
        ? path.resolve(clientRoot, pathname.replace(/^\//, ""))
        : path.resolve(path.dirname(htmlFile), pathname);
      const relative = path.relative(clientRoot, target);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        problems.push(`${path.relative(clientRoot, htmlFile)}: resource escapes client root: ${raw}`);
      } else if (!existsSync(target)) {
        problems.push(`${path.relative(clientRoot, htmlFile)}: missing local HTML resource: ${raw}`);
      } else {
        const realTarget = await realpath(target);
        const realRelative = path.relative(clientRoot, realTarget);
        if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
          problems.push(`${path.relative(clientRoot, htmlFile)}: resource escapes client root: ${raw}`);
        }
      }
    }
  }
  if (problems.length) throw new Error(problems.join("\n"));
  return [];
}

export async function validateClientModuleResources(root) {
  const clientRoot = await realpath(root);
  const scriptFiles = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (/\.(?:m?js)$/i.test(entry.name)) scriptFiles.push(file);
    }
  }
  await visit(clientRoot);
  const problems = [];
  const importPatterns = [
    /\b(?:import|export)\s+(?:[^"'`]*?\s+from\s*)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const scriptFile of scriptFiles) {
    const source = await readFile(scriptFile, "utf8");
    const refs = [];
    for (const pattern of importPatterns) {
      for (const match of source.matchAll(pattern)) refs.push(match[1]);
    }
    for (const raw of refs) {
      if (!raw.startsWith(".")) continue;
      let pathname;
      try { pathname = decodeURIComponent(raw.split(/[?#]/, 1)[0]); }
      catch { problems.push(`${path.relative(clientRoot, scriptFile)}: invalid module URL encoding in ${raw}`); continue; }
      const target = path.resolve(path.dirname(scriptFile), pathname);
      const relative = path.relative(clientRoot, target);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        problems.push(`${path.relative(clientRoot, scriptFile)}: module resource escapes client root: ${raw}`);
      } else if (!existsSync(target)) {
        problems.push(`${path.relative(clientRoot, scriptFile)}: missing module resource: ${raw}`);
      } else {
        const realTarget = await realpath(target);
        const realRelative = path.relative(clientRoot, realTarget);
        if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
          problems.push(`${path.relative(clientRoot, scriptFile)}: module resource escapes client root: ${raw}`);
        }
      }
    }
  }
  if (problems.length) throw new Error(problems.join("\n"));
  return [];
}

export async function copyBuiltPromoAssets(extensionRoot, clientRoot) {
  const promoFiles = ["landing.html", "landing-promo.html", "favicon.svg"];
  const promoDirectories = ["next-static", "next-runtime", "assets"];
  for (const name of promoFiles) {
    const source = path.join(extensionRoot, name);
    let metadata;
    try { metadata = await lstat(source); }
    catch (error) {
      if (error.code === "ENOENT") throw new Error(`built extension promotion is missing ${name}`);
      throw error;
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`built extension promotion requires a regular file: ${name}`);
    }
  }
  for (const name of promoDirectories) {
    const source = path.join(extensionRoot, name);
    let metadata;
    try { metadata = await lstat(source); }
    catch (error) {
      if (error.code === "ENOENT") throw new Error(`built extension promotion is missing ${name}`);
      throw error;
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`built extension promotion requires a directory: ${name}`);
    }
  }

  const landing = await readFile(path.join(extensionRoot, "landing.html"), "utf8");
  const promoLanding = await readFile(path.join(extensionRoot, "landing-promo.html"), "utf8");
  if (
    landing !== promoLanding ||
    landing === await readFile(path.join(clientRoot, "index.html"), "utf8") ||
    !landing.includes("next-static/static/") ||
    landing.includes("/_next/")
  ) {
    throw new Error("built extension promotion does not contain the matching Next.js landing page");
  }

  for (const name of [...promoFiles, ...promoDirectories]) {
    await cp(path.join(extensionRoot, name), path.join(clientRoot, name), { force: true, recursive: true });
  }
}

export function isTestFixturePath(entry) {
  const normalized = String(entry).replaceAll("\\", "/").replace(/^(?:\.\/)+/, "");
  return /(^|\/)(?:tests?|fixtures?|__tests__|__fixtures__)(\/|$)/i.test(normalized)
    || /(^|\/)[^/]+\.(?:test|spec)(?:\.[^/]+)?$/i.test(normalized);
}

export async function removeTestFixturePayloads(root) {
  const packageRoot = path.resolve(root);
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(packageRoot, file).split(path.sep).join("/");
      if (isTestFixturePath(relative)) {
        await rm(file, { recursive: true, force: true });
      } else if (entry.isDirectory()) {
        await visit(file);
      }
    }
  }
  await visit(packageRoot);
}

export async function createChecksumManifest(root) {
  const packageRoot = path.resolve(root);
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else files.push(file);
    }
  }
  await visit(packageRoot);

  const lines = [];
  for (const file of files.sort((left, right) => {
    const a = path.relative(packageRoot, left).split(path.sep).join("/");
    const b = path.relative(packageRoot, right).split(path.sep).join("/");
    return a < b ? -1 : a > b ? 1 : 0;
  })) {
    const relative = path.relative(packageRoot, file).split(path.sep).join("/");
    if (relative === "SHA256SUMS.txt") continue;
    lines.push(`${hashFile(file)}  ./${relative}`);
  }
  return `${lines.join("\n")}\n`;
}

export function createPortableTarArchive(root, archive) {
  execFileSync("tar", ["-czf", archive, "-C", path.dirname(root), path.basename(root)], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
    stdio: "inherit"
  });
}

export function assertNoTestFixturePaths(entries, label = "Package archive") {
  const forbidden = entries.filter(isTestFixturePath);
  if (forbidden.length) {
    throw new Error(`${label} contains test or fixture payloads: ${forbidden.join(", ")}`);
  }
}

export async function prepareReleaseManualAssets(clientRoot, manualRoot, version) {
  const helpManualJsPath = path.join(clientRoot, "help-manual.js");
  const helpManualHtmlPath = path.join(clientRoot, "help-manual.html");
  const portalPath = path.join(clientRoot, "portal.html");
  const helpManualJs = await readFile(helpManualJsPath, "utf8");
  const versionPattern = /(\bconst VERSION\s*=\s*["'])(\d+\.\d+\.\d+)(["'];)/;
  const match = helpManualJs.match(versionPattern);
  if (!match) throw new Error("Unable to locate the version in help-manual.js");

  const sourceVersion = match[2];
  const sourceMinor = sourceVersion.split(".").slice(0, 2).join(".");
  const targetMinor = version.split(".").slice(0, 2).join(".");
  const helpManualHtml = await readFile(helpManualHtmlPath, "utf8");
  const portal = await readFile(portalPath, "utf8");
  if (![helpManualHtml, portal].every(source => source.includes(sourceVersion) && source.includes(sourceMinor))) {
    throw new Error("Help manual or portal does not contain its declared release version");
  }

  await writeCandidateFile(clientRoot, helpManualJsPath, helpManualJs.replace(versionPattern, `$1${version}$3`));
  await writeCandidateFile(clientRoot, helpManualHtmlPath, helpManualHtml
    .replaceAll(sourceVersion, version)
    .replaceAll(sourceMinor, targetMinor));
  await writeCandidateFile(clientRoot, portalPath, portal
    .replaceAll(sourceVersion, version)
    .replaceAll(sourceMinor, targetMinor));

  const downloadsRoot = path.join(clientRoot, "downloads");
  await assertCandidateOutputPath(clientRoot, downloadsRoot);
  await mkdir(downloadsRoot, { recursive: true });
  const copiedManuals = [];
  for (const language of ["EN", "ZH"]) {
    const name = `JEAuditFlow-Operation-Manual-${version}-${language}.pdf`;
    const source = path.join(manualRoot, name);
    const target = path.join(downloadsRoot, name);
    if (!existsSync(source)) throw new Error(`Generated ${language} operation manual is missing: ${source}`);
    await assertCandidateOutputPath(clientRoot, target);
    await cp(source, target, { force: true });
    copiedManuals.push(target);
  }

  const updatedPortal = await readFile(portalPath, "utf8");
  for (const language of ["EN", "ZH"]) {
    const name = `JEAuditFlow-Operation-Manual-${version}-${language}.pdf`;
    if (!updatedPortal.includes(name) || !existsSync(path.join(downloadsRoot, name))) {
      throw new Error(`Release portal does not point to its ${language} operation manual`);
    }
  }
  return copiedManuals;
}

export async function stampClientVersion(root, version) {
  const indexPath = path.join(root, "index.html");
  const appPath = path.join(root, "app.js");
  const htmlFiles = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (/\.html?$/i.test(entry.name)) htmlFiles.push(file);
    }
  }
  await visit(root);
  const app = await readFile(appPath, "utf8");
  const titlePattern = /(<title>\s*JEAuditFlow\s+)\d+\.\d+\.\d+([^<]*<\/title>)/i;
  const appPattern = /(\bconst\s+APP_VERSION\s*=\s*["'])\d+\.\d+\.\d+(["'];)/;
  const desktopRangePattern = /(\bconst\s+DESKTOP_VERSION_RANGE\s*=\s*["'])\d+\.\d+\.x(["'];)/;
  const indexHtml = await readFile(indexPath, "utf8");
  if (!titlePattern.test(indexHtml)) throw new Error("Unable to locate JEAuditFlow version in client index.html title");
  if (!appPattern.test(app)) throw new Error("Unable to locate APP_VERSION in client app.js");
  if (!desktopRangePattern.test(app)) throw new Error("Unable to locate DESKTOP_VERSION_RANGE in client app.js");
  for (const htmlFile of htmlFiles) {
    const html = await readFile(htmlFile, "utf8");
    if (titlePattern.test(html)) {
      await writeCandidateFile(root, htmlFile, html.replace(titlePattern, `$1${version}$2`));
    }
  }
  const clientRange = `${version.split(".").slice(0, 2).join(".")}.x`;
  const updatedApp = app
    .replace(appPattern, `$1${version}$2`)
    .replace(desktopRangePattern, `$1${clientRange}$2`);
  await writeCandidateFile(root, appPath, updatedApp);
  await stampDesktopShellVersion(root, version);
}

export async function stampDesktopShellVersion(root, version) {
  const desktopHtmlPath = path.join(root, "desktop.html");
  const desktopShellPath = path.join(root, "desktop-shell.js");
  const desktopHtml = await readFile(desktopHtmlPath, "utf8");
  const desktopShell = await readFile(desktopShellPath, "utf8");
  const titlePattern = /(<title>\s*JEAuditFlow\s+)\d+\.\d+\.\d+([^<]*<\/title>)/i;
  const labelPattern = /(版本\s+)\d+\.\d+\.\d+/;
  const appPattern = /(\bconst\s+APP_VERSION\s*=\s*["'])\d+\.\d+\.\d+(["'];)/;

  if (!titlePattern.test(desktopHtml)) throw new Error("Unable to locate JEAuditFlow version in desktop.html title");
  if (!labelPattern.test(desktopHtml)) throw new Error("Unable to locate JEAuditFlow version in desktop.html branding");
  if (!appPattern.test(desktopShell)) throw new Error("Unable to locate APP_VERSION in desktop-shell.js");

  await writeCandidateFile(root, desktopHtmlPath, desktopHtml
    .replace(titlePattern, (_, prefix, suffix) => `${prefix}${version}${suffix}`)
    .replace(labelPattern, (_, prefix) => `${prefix}${version}`));
  await writeCandidateFile(root, desktopShellPath, desktopShell.replace(appPattern, `$1${version}$2`));
}

export async function jiraFlowSourceSha256(sourceRoot) {
  const sourceDirectories = ["src/main/java", "src/main/resources"].map(directory => path.join(sourceRoot, directory));
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else files.push(file);
    }
  }
  for (const directory of sourceDirectories) {
    if (existsSync(directory)) await visit(directory);
  }
  files.sort((left, right) => path.relative(sourceRoot, left).localeCompare(path.relative(sourceRoot, right)));
  if (!files.length) throw new Error("JiraFlow source tree is empty");
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(path.relative(sourceRoot, file).split(path.sep).join("/"));
    digest.update("\0");
    digest.update(await readFile(file));
    digest.update("\0");
  }
  return digest.digest("hex");
}

export async function applyJiraFlowReleaseOverlay({ candidateRoot, sourceRoot, overlayRoot, version }) {
  const manifest = JSON.parse(await readFile(path.join(overlayRoot, "overlay-manifest.json"), "utf8"));
  if (manifest.releaseVersion !== version || manifest.baseVersion !== "7.2.0" || !Array.isArray(manifest.files) || !manifest.files.length) {
    throw new Error("JiraFlow source overlay manifest does not match the release");
  }
  const files = [...new Set(manifest.files)];
  if (files.length !== manifest.files.length) throw new Error("JiraFlow source overlay contains duplicate paths");
  for (const relative of files) {
    if (typeof relative !== "string" || relative.includes("\\") || relative.split("/").some(part => ["", ".", ".."].includes(part)) ||
        !/^src\/main\/(?:java|resources)\//.test(relative)) {
      throw new Error(`Invalid JiraFlow source overlay path: ${relative}`);
    }
    const source = path.join(overlayRoot, relative);
    const metadata = await lstat(source);
    if (!metadata.isFile() || metadata.isSymbolicLink() || !(await realpath(source)).startsWith(`${await realpath(overlayRoot)}${path.sep}`)) {
      throw new Error(`Expected a regular JiraFlow overlay source: ${relative}`);
    }
    const destination = path.join(sourceRoot, relative);
    await assertCandidateOutputPath(candidateRoot, destination);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { force: true });
  }
  return manifest;
}

function jiraFlowJarMetadata(jarPath) {
  let manifest;
  try {
    manifest = execFileSync("unzip", ["-p", jarPath, "META-INF/MANIFEST.MF"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    throw new Error("Configured JiraFlow JAR is invalid or has no manifest");
  }
  const unfoldedManifest = manifest.replace(/\r?\n[ \t]/g, "");
  return Object.fromEntries(unfoldedManifest.split(/\r?\n/).flatMap(line => {
    const separator = line.indexOf(":");
    return separator > 0 ? [[line.slice(0, separator).trim(), line.slice(separator + 1).trim()]] : [];
  }));
}

export function requireJiraFlowJar(configuredPath, projectRoot, expected = {}) {
  const expectedRelease = expected.releaseVersion || "7.3.0";
  if (!configuredPath?.trim()) throw new Error(`A JiraFlow JAR is required for JEAuditFlow ${expectedRelease}`);
  if (!path.isAbsolute(configuredPath)) throw new Error("AUDITFLOW_JIRAFLOW_JAR must be an absolute path to a JAR file");
  const jarPath = path.resolve(configuredPath);
  if (!existsSync(jarPath)) throw new Error(`Configured AUDITFLOW_JIRAFLOW_JAR does not exist: ${jarPath}`);
  if (!jarPath.toLowerCase().endsWith(".jar")) {
    throw new Error("AUDITFLOW_JIRAFLOW_JAR must be an absolute path to a JAR file");
  }
  const metadata = jiraFlowJarMetadata(jarPath);
  if (
    metadata["JEAuditFlow-JiraFlow-Version"] !== "2.1.0" ||
    metadata["JEAuditFlow-Release-Version"] !== expectedRelease ||
    !/^[a-f0-9]{64}$/i.test(metadata["JEAuditFlow-Source-SHA256"] || "") ||
    (expected.sourceSha256 && metadata["JEAuditFlow-Source-SHA256"] !== expected.sourceSha256)
  ) {
    throw new Error(`JiraFlow JAR release provenance does not match the ${expectedRelease} source build`);
  }
  return jarPath;
}

export function jiraFlowManifest(jarPath, expected = {}) {
  const metadata = jiraFlowJarMetadata(jarPath);
  return {
    version: metadata["JEAuditFlow-JiraFlow-Version"],
    releaseVersion: metadata["JEAuditFlow-Release-Version"],
    jar: "jiraflow/jiraflow.jar",
    jarSha256: hashFile(jarPath),
    source: "checked-in-jiraflow-source",
    sourceSha256: metadata["JEAuditFlow-Source-SHA256"],
    inputSha256: hashFile(jarPath),
    ...(expected.sourceSha256 ? { expectedSourceSha256: expected.sourceSha256 } : {})
  };
}
