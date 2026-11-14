import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatorScript = path.join(scriptsRoot, "generate-sup-qa-checklist-catalog.py");
const catalogFileName = "sup-qa-checklist-catalog.js";
const defaultEntryCount = 496;
const defaultSourceManifestCount = 13;

function expectedNumber(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (received ${process.env[name] || fallback})`);
  }
  return value;
}

function parseCatalogSource(source, file) {
  const match = source.match(
    /^\s*globalThis\.AUDITFLOW_SUP_QA_CHECKLIST_CATALOG\s*=\s*(\{[\s\S]*\})\s*;\s*$/
  );
  if (!match) {
    throw new Error(`Checklist catalog assignment is missing or malformed: ${file}`);
  }
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`Checklist catalog JSON is unreadable: ${file}: ${error.message}`);
  }
}

function readCatalogFile(file) {
  if (!existsSync(file)) throw new Error(`Checklist catalog is missing: ${file}`);
  return parseCatalogSource(readFileSync(file, "utf8"), file);
}

function metadataFor(catalog) {
  return {
    release: catalog.release,
    entryCount: catalog.entryCount,
    sourceManifestCount: Array.isArray(catalog.sourceManifest) ? catalog.sourceManifest.length : 0,
    sourcePaths: Array.isArray(catalog.sourceManifest)
      ? catalog.sourceManifest.map(item => item?.sourcePath).filter(Boolean).sort()
      : []
  };
}

function assertCatalog(catalog, {
  version,
  expectedEntryCount,
  expectedSourceManifestCount,
  label
}) {
  const expectedSourcePaths = Array.isArray(catalog.sourceManifest)
    ? catalog.sourceManifest.map(item => item?.sourcePath).filter(Boolean)
    : [];
  if (catalog.schemaVersion !== 1) {
    throw new Error(`${label} checklist catalog schema mismatch: expected 1, found ${catalog.schemaVersion ?? "<missing>"}`);
  }
  if (catalog.release !== version) {
    throw new Error(`${label} checklist catalog release mismatch: expected ${version}, found ${catalog.release ?? "<missing>"}`);
  }
  if (catalog.entryCount !== expectedEntryCount) {
    throw new Error(
      `${label} checklist catalog entryCount mismatch: expected ${expectedEntryCount}, ` +
      `found ${catalog.entryCount ?? "<missing>"}`
    );
  }
  if (!Array.isArray(catalog.entries) || catalog.entries.length !== catalog.entryCount) {
    throw new Error(
      `${label} checklist catalog entries mismatch: declared ${catalog.entryCount ?? "<missing>"}, ` +
      `actual ${Array.isArray(catalog.entries) ? catalog.entries.length : "<missing>"}`
    );
  }
  if (!Array.isArray(catalog.sourceManifest) || catalog.sourceManifest.length !== expectedSourceManifestCount) {
    throw new Error(
      `${label} checklist catalog sourceManifest mismatch: expected ${expectedSourceManifestCount}, ` +
      `found ${Array.isArray(catalog.sourceManifest) ? catalog.sourceManifest.length : "<missing>"}`
    );
  }
  if (new Set(expectedSourcePaths).size !== expectedSourceManifestCount) {
    throw new Error(`${label} checklist catalog sourceManifest contains duplicate or missing sourcePath values`);
  }
  if (catalog.sourceManifest.some(item => !item?.sourceDocument || !item?.sourcePath || !Number.isInteger(item.recordCount) || item.recordCount <= 0)) {
    throw new Error(`${label} checklist catalog sourceManifest contains an incomplete or empty source entry`);
  }
  return metadataFor(catalog);
}

function expectedMetadataFor(version) {
  const entryCount = expectedNumber("AUDITFLOW_EXPECTED_CHECKLIST_ENTRY_COUNT", defaultEntryCount);
  const sourceManifestCount = expectedNumber("AUDITFLOW_EXPECTED_CHECKLIST_SOURCE_COUNT", defaultSourceManifestCount);
  return {
    version,
    entryCount,
    sourceManifestCount,
    // The validation APIs use the explicit `expected*` names. Keep both
    // forms here because build scripts also serialize the compact metadata.
    expectedEntryCount: entryCount,
    expectedSourceManifestCount: sourceManifestCount
  };
}

export function catalogPath(webRoot) {
  return path.join(webRoot, catalogFileName);
}

export async function refreshAndValidateChecklistCatalog({ webRoot, version, outputFile }) {
  if (!existsSync(generatorScript)) throw new Error(`Checklist catalog generator is missing: ${generatorScript}`);
  const generatedFile = outputFile || path.join(
    path.dirname(scriptsRoot),
    "artifacts",
    "checklist-build",
    version,
    catalogFileName
  );
  await mkdir(path.dirname(generatedFile), { recursive: true });
  if (process.env.AUDITFLOW_USE_BUNDLED_CHECKLIST_CATALOG === "1") {
    const bundled = readCatalogFile(path.join(webRoot, catalogFileName));
    bundled.release = version;
    await writeFile(generatedFile, `globalThis.AUDITFLOW_SUP_QA_CHECKLIST_CATALOG = ${JSON.stringify(bundled, null, 2)};\n`);
  } else execFileSync("python3", [generatorScript], {
    cwd: scriptsRoot,
    env: {
      ...process.env,
      AUDITFLOW_RELEASE_VERSION: version,
      AUDITFLOW_CHECKLIST_OUTPUT: generatedFile
    },
    stdio: "inherit"
  });
  const expected = expectedMetadataFor(version);
  const catalog = readCatalogFile(generatedFile);
  const metadata = assertCatalog(catalog, {
    version,
    expectedEntryCount: expected.entryCount,
    expectedSourceManifestCount: expected.sourceManifestCount,
    label: "Generated"
  });
  return { expected, metadata, catalogFile: generatedFile };
}

export function validateChecklistCatalogFile(file, {
  version,
  expectedEntryCount,
  expectedSourceManifestCount,
  label = file
}) {
  const catalog = readCatalogFile(file);
  const metadata = assertCatalog(catalog, {
    version,
    expectedEntryCount,
    expectedSourceManifestCount,
    label
  });
  return { catalog, metadata };
}

export function validateChecklistCatalogCopies(files, {
  version,
  expectedEntryCount,
  expectedSourceManifestCount,
  label = "Staged"
}) {
  return files.map(file => validateChecklistCatalogFile(file, {
    version,
    expectedEntryCount,
    expectedSourceManifestCount,
    label: `${label} ${file}`
  }).metadata);
}

export function validateChecklistCatalogArchive(archive, entries, {
  version,
  expectedEntryCount,
  expectedSourceManifestCount,
  label = "Archive"
}) {
  return entries.map(entry => {
    let source;
    try {
      source = execFileSync("unzip", ["-p", archive, entry], { encoding: "utf8" });
    } catch (error) {
      throw new Error(`${label} checklist catalog entry is unreadable: ${entry}: ${error.message}`);
    }
    const catalog = parseCatalogSource(source, `${archive}:${entry}`);
    return assertCatalog(catalog, {
      version,
      expectedEntryCount,
      expectedSourceManifestCount,
      label: `${label} ${entry}`
    });
  });
}
