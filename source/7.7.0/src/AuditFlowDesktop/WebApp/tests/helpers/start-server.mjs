import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server.mjs");

export async function startAuditFlowServer({ env = {} } = {}) {
  const password = process.env.AUDITFLOW_TEST_PASSWORD || "AuditFlowLocalTest2026";
  const root = await mkdtemp(path.join(tmpdir(), "jeauditflow-test-"));
  const child = spawn(process.execPath, [serverFile, "serve"], {
    cwd: path.dirname(serverFile),
    env: {
      ...process.env,
      AUDITFLOW_SERVER_ROLE: "collaboration",
      AUDITFLOW_LOCAL_TEST: "1",
      AUDITFLOW_PORT: "0",
      AUDITFLOW_OUTPUT_DIR: path.join(root, "output"),
      AUDITFLOW_COLLAB_DIR: path.join(root, "collaboration"),
      AUDITFLOW_USER_DATA_DIR: path.join(root, "users"),
      AUDITFLOW_TEST_PASSWORD: password,
      AUDITFLOW_MYSQL_URL: "",
      MYSQL_URL: "",
      FILEANALYST_AUTOSTART: "0",
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.stderr.on("data", chunk => { output += chunk.toString(); });

  const startedAt = Date.now();
  let base = "";
  while (Date.now() - startedAt < 15000) {
    const match = output.match(/running at (http:\/\/127\.0\.0\.1:\d+)\//);
    if (match) {
      base = match[1];
      break;
    }
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!base) {
    await stop();
    throw new Error(`AuditFlow test server did not start: ${output}`);
  }

  async function stop() {
    if (child.exitCode === null) child.kill("SIGTERM");
    if (child.exitCode === null) {
      await new Promise(resolve => child.once("exit", resolve));
    }
    await rm(root, { recursive: true, force: true });
  }

  return { base, password, stop };
}
