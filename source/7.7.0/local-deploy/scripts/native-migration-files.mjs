import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export async function migrationFileManifest(directory) {
  const files = [];
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const filename = path.join(current, entry.name);
      const relative = path.relative(directory, filename);
      if (entry.isDirectory()) {
        files.push({ path: relative, type: "directory" });
        await visit(filename);
      } else if (entry.isFile()) {
        const bytes = await readFile(filename);
        files.push({ path: relative, type: "file", bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex") });
      } else {
        throw new Error(`Migration requires regular files and directories: ${relative}`);
      }
    }
  }
  await visit(directory);
  return files;
}

export async function verifyMigrationFileCopy(source, destination) {
  const expected = await migrationFileManifest(source);
  const actual = await migrationFileManifest(destination);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Migration file copy differs in paths, directory structure, or file content");
  }
  const files = expected.filter(entry => entry.type === "file");
  return { count: files.length, bytes: files.reduce((total, entry) => total + entry.bytes, 0),
    sha256: createHash("sha256").update(JSON.stringify(expected)).digest("hex") };
}
