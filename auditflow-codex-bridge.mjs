/*
 * AuditFlow 9.4.4 local Codex bridge
 *
 * This small, dependency-free service intentionally listens only on loopback.
 * It invokes an already authenticated local Codex CLI, never puts credentials
 * in the extension, command line, logs, or response body.
 */
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "9.4.4";
const HOST = "127.0.0.1";
const PORT = Number(process.env.AUDITFLOW_PORT || 4173);
const BRIDGE_DIR = path.dirname(fileURLToPath(import.meta.url));
const STATUS_TTL_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;
const MAX_REQUEST_TIMEOUT_MS = 300_000;
const MAX_PROMPT_CHARS = 180_000;
const MAX_BODY_BYTES = 2_000_000;
const MAX_OUTPUT_BYTES = 1_000_000;
const cliState = { checkedAt: 0, available: false, authenticated: false, executable: "codex" };
// An explicitly entered Virtual Key is kept only in this process's memory.
// It is never written to disk, returned to the browser or logged.
const runtimeProvider = { virtualKey: "", baseUrl: "", model: "" };

function resolveCodexExecutable() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  for (const root of [path.join(home, ".vscode", "extensions"), path.join(home, ".cursor", "extensions")]) {
    try {
      if (!existsSync(root)) continue;
      for (const extension of readdirSync(root)) {
        if (!/codex|chatgpt|openai/i.test(extension)) continue;
        const bin = path.join(root, extension, "bin");
        if (!existsSync(bin)) continue;
        for (const platform of readdirSync(bin)) {
          for (const name of ["codex.exe", "codex.cmd", "codex.bat"]) {
            const candidate = path.join(bin, platform, name);
            if (existsSync(candidate)) return candidate;
          }
        }
      }
    } catch (_) { /* A missing or inaccessible editor directory is harmless. */ }
  }
  return "codex";
}

function cliStatus({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - cliState.checkedAt < STATUS_TTL_MS) return { ...cliState };
  try {
    cliState.executable = resolveCodexExecutable();
    const result = spawnSync(cliState.executable, ["login", "status"], {
      cwd: BRIDGE_DIR,
      shell: false,
      stdio: "ignore",
      timeout: 4_000,
      windowsHide: true
    });
    cliState.available = !result.error && !result.signal;
    cliState.authenticated = cliState.available && result.status === 0;
  } catch (_) {
    cliState.available = false;
    cliState.authenticated = false;
  }
  cliState.checkedAt = now;
  return { ...cliState };
}

function nestedText(value, depth = 0) {
  if (depth > 5 || value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(item => nestedText(item, depth + 1)).filter(Boolean).join("\n");
  if (typeof value !== "object") return "";
  for (const key of ["text", "content", "message", "output", "result"]) {
    const text = nestedText(value[key], depth + 1);
    if (text) return text;
  }
  return "";
}

function parseCliOutput(raw) {
  const messages = [];
  String(raw || "").split(/\r?\n/).forEach(line => {
    const source = line.trim();
    if (!source) return;
    try {
      const event = JSON.parse(source);
      const item = event?.item || event?.message || {};
      const text = nestedText(item) || nestedText(event?.text) || nestedText(event?.output);
      if ((item?.type === "agent_message" || event?.type === "agent_message" || event?.type === "item.completed") && text) messages.push(text);
    } catch (_) {
      // Older CLI releases may print just the final response on stdout.
      if (!source.startsWith("{") && !source.startsWith("[")) messages.push(source);
    }
  });
  return messages.join("\n").trim();
}

function boundedTimeout(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.max(15_000, Math.min(Math.trunc(requested), MAX_REQUEST_TIMEOUT_MS));
}

function safeProviderUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    const loopback = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password) return "";
    return url.toString().replace(/\/$/, "");
  } catch (_) { return ""; }
}

function safeModel(value) {
  const model = String(value || "").trim();
  return /^[A-Za-z0-9._:-]{1,120}$/.test(model) ? model : "";
}

function extractProviderText(payload) {
  const direct = String(payload?.output_text || payload?.output || "").trim();
  if (direct) return direct;
  const parts = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      const text = String(content?.text || content?.output_text || "").trim();
      if (text) parts.push(text);
    }
  }
  return parts.join("\n").trim();
}

async function runVirtualKeyProvider(prompt, timeoutMs) {
  const baseUrl = safeProviderUrl(runtimeProvider.baseUrl);
  if (!runtimeProvider.virtualKey || !baseUrl) return { ok: false, status: 503, error: "The local provider session is not ready." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedTimeout(timeoutMs));
  try {
    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${runtimeProvider.virtualKey}` },
      body: JSON.stringify({ model: safeModel(runtimeProvider.model) || "gpt-5.4", input: String(prompt || "").slice(0, MAX_PROMPT_CHARS), store: false }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, status: response.status >= 400 && response.status < 600 ? response.status : 502, error: `The local provider returned HTTP ${response.status}.` };
    const output = extractProviderText(payload);
    return output ? { ok: true, output, transport: "provider" } : { ok: false, status: 502, error: "The local provider returned no usable assessment." };
  } catch (error) {
    return error?.name === "AbortError"
      ? { ok: false, status: 504, error: `The local provider request timed out after ${Math.round(boundedTimeout(timeoutMs) / 1000)} seconds.` }
      : { ok: false, status: 502, error: "The local provider request could not be completed." };
  } finally { clearTimeout(timer); }
}

function runCodex(prompt, timeoutMs) {
  if (!cliStatus().authenticated) return Promise.resolve({ ok: false, status: 503, error: "The local Codex session is not ready. Run `codex login` and retry." });
  const bridgePrompt = [
    "You are the local AuditFlow model bridge for an Automotive SPICE assessment.",
    "Return only the requested assessor opinion. Do not run commands, read local files, change data, reveal credentials, or describe tool use.",
    "Use only the assessment context supplied below. Keep the response concise, actionable, and auditable.",
    "",
    String(prompt || "").slice(0, MAX_PROMPT_CHARS)
  ].join("\n");
  return new Promise(resolve => {
    let stdout = "";
    let settled = false;
    let timedOut = false;
    let timer;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child;
    try {
      // The assessment text is passed on stdin, not in command-line arguments.
      child = spawn(resolveCodexExecutable(), ["exec", "--ephemeral", "--skip-git-repo-check", "--ignore-rules", "--color", "never", "--json", "-s", "read-only", "-"], {
        cwd: BRIDGE_DIR,
        shell: false,
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true
      });
    } catch (_) {
      finish({ ok: false, status: 503, error: "The local Codex model could not be started." });
      return;
    }
    timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, boundedTimeout(timeoutMs));
    child.on("error", () => finish({ ok: false, status: 503, error: "The local Codex model could not be started." }));
    child.stdout.on("data", chunk => {
      if (settled) return;
      stdout += chunk.toString("utf8");
      if (Buffer.byteLength(stdout, "utf8") > MAX_OUTPUT_BYTES) {
        child.kill();
        finish({ ok: false, status: 502, error: "The local Codex response exceeded the safety limit." });
      }
    });
    child.on("close", code => {
      if (settled) return;
      if (timedOut) return finish({ ok: false, status: 504, error: `The local Codex model request timed out after ${Math.round(boundedTimeout(timeoutMs) / 1000)} seconds.` });
      const output = parseCliOutput(stdout);
      if (code === 0 && output) return finish({ ok: true, output, transport: "codex-cli" });
      finish({ ok: false, status: 502, error: "The local Codex model returned no usable assessment." });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(bridgePrompt, "utf8");
  });
}

function runModel(prompt, timeoutMs) {
  return runtimeProvider.virtualKey ? runVirtualKeyProvider(prompt, timeoutMs) : runCodex(prompt, timeoutMs);
}

function trustedOrigin(request) {
  const origin = String(request.headers.origin || "");
  return !origin || origin.startsWith("chrome-extension://") || /^http:\/\/(127\.0\.0\.1|localhost)(?::\d+)?$/i.test(origin);
}

function corsHeaders(request) {
  const origin = String(request.headers.origin || "");
  return {
    "access-control-allow-origin": origin && trustedOrigin(request) ? origin : "null",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "vary": "Origin"
  };
}

function sendJson(response, request, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...corsHeaders(request) });
  response.end(JSON.stringify(value));
}

async function jsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body too large."), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch (_) { throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 }); }
}

function statusPayload() {
  const status = cliStatus();
  const virtualKeyConfigured = !!runtimeProvider.virtualKey;
  const providerReady = virtualKeyConfigured || status.authenticated;
  return {
    ok: true,
    version: VERSION,
    session: {
      providerReady,
      virtualKeyConfigured,
      transport: virtualKeyConfigured ? "provider" : status.authenticated ? "codex-cli" : "unavailable",
      model: virtualKeyConfigured ? (safeModel(runtimeProvider.model) || "gpt-5.4") : status.authenticated ? "local Codex CLI" : null
    },
    detected: { cliAvailable: status.available, cliAuthenticated: status.authenticated },
    limits: { opinionTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS }
  };
}

const server = http.createServer(async (request, response) => {
  try {
    if (!trustedOrigin(request)) {
      sendJson(response, request, 403, { error: "Only a local AuditFlow page may use this bridge." });
      return;
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders(request));
      response.end();
      return;
    }
    const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
    if (request.method === "GET" && url.pathname === "/api/codex/status") {
      sendJson(response, request, 200, statusPayload());
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, request, 200, { status: "ok", app: "AuditFlow Codex Bridge", version: VERSION, ...statusPayload() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/ai/opinion") {
      const body = await jsonBody(request);
      const prompt = String(body.prompt || "").trim();
      if (!prompt) {
        sendJson(response, request, 400, { error: "Missing prompt." });
        return;
      }
      const result = await runModel(prompt, body.timeoutMs);
      if (!result.ok) {
        sendJson(response, request, result.status || 502, { error: result.error });
        return;
      }
      sendJson(response, request, 200, { output: result.output, transport: result.transport, timeoutMs: boundedTimeout(body.timeoutMs) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/codex/virtual-key") {
      const body = await jsonBody(request);
      const virtualKey = String(body.virtualKey || "").trim();
      const baseUrl = safeProviderUrl(body.baseUrl);
      if (virtualKey.length < 8 || virtualKey.length > 1024 || !baseUrl) {
        sendJson(response, request, 400, { error: "Enter a valid HTTPS provider URL and Virtual Key." });
        return;
      }
      runtimeProvider.virtualKey = virtualKey;
      runtimeProvider.baseUrl = baseUrl;
      runtimeProvider.model = safeModel(body.model);
      sendJson(response, request, 200, statusPayload());
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/codex/clear-virtual-key") {
      runtimeProvider.virtualKey = "";
      runtimeProvider.baseUrl = "";
      runtimeProvider.model = "";
      sendJson(response, request, 200, statusPayload());
      return;
    }
    sendJson(response, request, 404, { error: "Not found." });
  } catch (error) {
    sendJson(response, request, error?.status || 500, { error: String(error?.message || "Local bridge error.") });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`AuditFlow Codex bridge v${VERSION} listening on http://${HOST}:${PORT}`);
  console.log(`Opinion requests may run for up to ${Math.round(DEFAULT_REQUEST_TIMEOUT_MS / 1000)} seconds.`);
});

server.on("error", error => {
  console.error(`AuditFlow Codex bridge could not start: ${error.message}`);
  process.exitCode = 1;
});
