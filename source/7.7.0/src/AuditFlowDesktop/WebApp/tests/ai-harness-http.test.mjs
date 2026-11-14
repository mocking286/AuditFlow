import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const serverPath = fileURLToPath(new URL("../server.mjs", import.meta.url));

async function startProviderStub() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      authorization: request.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      choices: [{
        message: {
          content: "Provider candidate review completed for SYS.2.BP1. Formal rating remains assessor-controlled."
        }
      }]
    }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

async function startServer(root, provider) {
  const child = spawn(process.execPath, [serverPath, "serve"], {
    cwd: path.dirname(serverPath),
    env: {
      ...process.env,
      AUDITFLOW_SERVER_ROLE: "desktop",
      AUDITFLOW_LOCAL_TEST: "1",
      AUDITFLOW_PORT: "0",
      AUDITFLOW_OUTPUT_DIR: path.join(root, "output"),
      AUDITFLOW_COLLAB_DIR: path.join(root, "collaboration"),
      AUDITFLOW_USER_DATA_DIR: path.join(root, "users"),
      AUDITFLOW_TEST_PASSWORD: "AuditFlowHarnessTest11!",
      AUDITFLOW_MODEL_PROVIDER: "deepseek",
      AUDITFLOW_MODEL_PROTOCOL: "chat-completions",
      AUDITFLOW_MODEL_BASE_URL: provider.baseUrl,
      AUDITFLOW_MODEL: "stub-model",
      AUDITFLOW_MODEL_API_KEY: "local-test-provider-key",
      AUDITFLOW_MYSQL_URL: "",
      MYSQL_URL: "",
      FILEANALYST_AUTOSTART: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.stderr.on("data", chunk => { output += chunk.toString(); });
  const startedAt = Date.now();
  let base = "";
  while (Date.now() - startedAt < 15000) {
    base = output.match(/running at (http:\/\/127\.0\.0\.1:\d+)\//)?.[1] || "";
    if (base || child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!base) {
    child.kill("SIGTERM");
    throw new Error(`server did not start: ${output}`);
  }
  return {
    base,
    stop: async () => {
      if (child.exitCode === null) child.kill("SIGTERM");
      if (child.exitCode === null) await new Promise(resolve => child.once("exit", resolve));
    }
  };
}

test("authenticated Codex opinion records project evidence scope and persists the run history", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "auditflow-ai-harness-http-"));
  const provider = await startProviderStub();
  const server = await startServer(root, provider);
  t.after(async () => {
    await server.stop();
    await provider.close();
    await rm(root, { recursive: true, force: true });
  });

  async function request(route, options = {}) {
    const response = await fetch(`${server.base}${route}`, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) }
    });
    return { response, body: await response.json() };
  }

  const login = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "test-user-01@auditflow.local", password: "AuditFlowHarnessTest11!" })
  });
  assert.equal(login.response.status, 200, JSON.stringify(login.body));
  const session = login.body.sessionToken;
  const headers = { "x-auditflow-session": session };
  const projectId = `AI-HARNESS-${Date.now()}`;
  const created = await request("/api/projects", {
    method: "POST",
    headers,
    body: JSON.stringify({
      projectId,
      expectedRevision: 0,
      snapshot: {
        id: projectId,
        name: "Harness project",
        processes: ["SYS.2"],
        assessments: [{ id: "A1", process: "SYS.2", code: "BP1" }],
        evidence: [{ id: "EV-1", code: "SYS2-REQ", atomicItems: [] }],
        records: []
      }
    })
  });
  assert.equal(created.response.status, 200, JSON.stringify(created.body));

  const opinion = await request("/api/ai/opinion", {
    method: "POST",
    headers,
    body: JSON.stringify({
      projectId,
      prompt: "Review SYS.2.BP1 against evidence SYS2-REQ at SRS.docx Section 4.2.",
      runContext: {
        processCodes: ["SYS.2"],
        assessmentRefs: ["SYS.2.BP1"],
        evidenceRefs: [{ id: "EV-1", code: "SYS2-REQ", locator: "SRS.docx Section 4.2", role: "direct" }]
      }
    })
  });
  assert.equal(opinion.response.status, 200, JSON.stringify(opinion.body));
  assert.match(opinion.body.output, /assessor-controlled/);
  assert.equal(opinion.body.modelUnavailable, false);
  assert.equal(opinion.body.assessmentGenerated, true);
  assert.equal(opinion.body.candidateOnly, true);
  assert.equal(opinion.body.modelStatus, "complete");
  assert.equal(provider.requests.length, 1);
  assert.match(JSON.stringify(provider.requests[0].body), /SYS\.2\.BP1/);
  assert.match(JSON.stringify(provider.requests[0].body), /SRS\.docx Section 4\.2/);
  assert.equal(provider.requests[0].authorization, "Bearer local-test-provider-key");

  const runs = await request(`/api/ai/harness/runs?projectId=${encodeURIComponent(projectId)}`, { headers });
  assert.equal(runs.response.status, 200, JSON.stringify(runs.body));
  assert.equal(runs.body.runs.length, 1);
  assert.equal(runs.body.runs[0].status, "complete");
  assert.equal(runs.body.runs[0].projectId, projectId);
  assert.equal(runs.body.runs[0].provider, "deepseek");
  assert.equal(runs.body.runs[0].model, "stub-model");
  assert.equal(runs.body.runs[0].transport, "provider");
  assert.equal(runs.body.runs[0].candidateOnly, true);
  assert.equal(runs.body.runs[0].graph.nodes.find(node => node.id === "model-review").status, "complete");
  assert.deepEqual(runs.body.runs[0].assessmentRefs, ["SYS.2.BP1"]);
  assert.deepEqual(runs.body.runs[0].evidenceRefs[0], {
    id: "EV-1",
    code: "SYS2-REQ",
    locator: "SRS.docx Section 4.2",
    role: "direct"
  });
  assert.doesNotMatch(JSON.stringify(runs.body), /Review SYS\.2\.BP1|local-test-provider-key/);
});
