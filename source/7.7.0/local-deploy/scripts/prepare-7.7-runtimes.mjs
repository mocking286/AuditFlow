#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../runtime/toolchains");
if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("This installer targets macOS arm64; select platform-specific official archives on other hosts");
await mkdir(root, { recursive: true, mode: 0o700 });
const artifacts = [
  {
    name: "node-v26.13.1-darwin-arm64.tar.gz",
    url: "https://nodejs.org/dist/v26.13.1/node-v26.13.1-darwin-arm64.tar.gz",
    checksumUrl: "https://nodejs.org/dist/v26.13.1/SHASUMS256.txt",
    executable: "node-v26.13.1-darwin-arm64/bin/node"
  },
  {
    name: "openjdk-27.0.1.0.3_macos-aarch64_bin.tar.gz",
    url: "https://download.java.net/java/GA/jdk27.0.1.0.3/b14170c9b2de463d9b89442c6db3e384/1/GPL/openjdk-27.0.1.0.3_macos-aarch64_bin.tar.gz",
    checksumUrl: "https://download.java.net/java/GA/jdk27.0.1.0.3/b14170c9b2de463d9b89442c6db3e384/1/GPL/openjdk-27.0.1.0.3_macos-aarch64_bin.tar.gz.sha256",
    executable: "jdk-27.0.1.0.3.jdk/Contents/Home/bin/java"
  },
  {
    name: "mysql-connector-j-26.10.0.jar",
    url: "https://repo.maven.apache.org/maven2/com/mysql/mysql-connector-j/26.10.0/mysql-connector-j-26.10.0.jar",
    checksumUrl: "https://repo.maven.apache.org/maven2/com/mysql/mysql-connector-j/26.10.0/mysql-connector-j-26.10.0.jar.sha256",
    executable: "mysql-connector-j-26.10.0.jar"
  }
];
const receipts = [];
for (const artifact of artifacts) {
  const checksumResponse = await fetch(artifact.checksumUrl);
  if (!checksumResponse.ok) throw new Error(`Checksum unavailable (${checksumResponse.status})`);
  const checksumText = await checksumResponse.text();
  const checksum = artifact.name.startsWith("node-")
    ? checksumText.split(/\r?\n/).find(line => line.endsWith(`  ${artifact.name}`))?.split(/\s+/)[0]
    : checksumText.trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/i.test(checksum || "")) throw new Error(`Invalid official checksum for ${artifact.name}`);
  const archive = path.join(root, artifact.name);
  let bytes;
  try { bytes = await readFile(archive); } catch {
    const response = await fetch(artifact.url);
    if (!response.ok) throw new Error(`Download unavailable (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash("sha256").update(bytes).digest("hex") !== checksum.toLowerCase()) throw new Error(`Checksum mismatch: ${artifact.name}`);
  await writeFile(archive, bytes, { mode: 0o600 });
  if (artifact.name.endsWith(".tar.gz")) {
    try { await access(path.join(root, artifact.executable)); } catch {
      execFileSync("tar", ["-xzf", archive, "-C", root]);
    }
  }
  await access(path.join(root, artifact.executable));
  receipts.push({ ...artifact, sha256: checksum, bytes: bytes.length, installed: path.join(root, artifact.executable) });
}
await writeFile(path.join(root, "7.7-runtime-receipt.json"), `${JSON.stringify({ checkedAt: new Date().toISOString(), artifacts: receipts }, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(receipts.map(({ name, installed, sha256 }) => ({ name, installed, sha256 })), null, 2));
