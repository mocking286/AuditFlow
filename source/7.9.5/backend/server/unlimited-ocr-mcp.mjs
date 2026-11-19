import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { realpath, stat } from "node:fs/promises";

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_STDOUT_BYTES = 2_000_000;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const SUPPORTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);

export function unlimitedOcrConfig(env = process.env) {
  const command = String(env.AUDITFLOW_OCR_MCP_COMMAND || "").trim();
  if (!command) return { configured: false, command: "", args: [], allowedRoots: [] };
  let args;
  try {
    args = JSON.parse(env.AUDITFLOW_OCR_MCP_ARGS_JSON || "[]");
    if (!Array.isArray(args) || args.some(value => typeof value !== "string")) throw new Error();
  } catch {
    return {
      configured: false,
      command: "",
      args: [],
      allowedRoots: [],
      error: "AUDITFLOW_OCR_MCP_ARGS_JSON must be a JSON string array."
    };
  }
  const allowedRoots = String(env.AUDITFLOW_OCR_ALLOWED_ROOTS || "")
    .split(path.delimiter)
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => path.resolve(value));
  return { configured: true, command, args, allowedRoots };
}

function parseToolResult(result) {
  if (result?.isError) {
    const message = (result.content || []).map(item => item?.text || "").filter(Boolean).join("\n");
    throw Object.assign(new Error(message || "Unlimited OCR reported a tool error."), { code: "OCR_TOOL_ERROR" });
  }
  if (result?.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const text = (result?.content || []).map(item => item?.text || "").filter(Boolean).join("\n");
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw_output: text, detections: [] }; }
}

function normalizeOcrResult(result, sourcePath) {
  if (result?.error) throw Object.assign(new Error(String(result.error).slice(0, 240)), { code: "OCR_TOOL_ERROR" });
  const detections = Array.isArray(result?.detections) ? result.detections.slice(0, 20_000).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const bbox = Array.isArray(item.bbox) ? item.bbox.slice(0, 4).map(Number) : [];
    if (bbox.length !== 4 || bbox.some(value => !Number.isFinite(value) || value < 0)) return [];
    return [{
      type: String(item.type || "text").slice(0, 48),
      bbox,
      text: String(item.text || "").slice(0, 8000)
    }];
  }) : [];
  return {
    sourcePath,
    elapsedSeconds: Number.isFinite(Number(result?.elapsed_seconds)) ? Number(result.elapsed_seconds) : null,
    detections,
    rawOutput: String(result?.raw_output || "").slice(0, 1_000_000)
  };
}

export function createUnlimitedOcrMcpAdapter({
  config = unlimitedOcrConfig(),
  spawnProcess = spawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  idFactory = (() => { let id = 0; return () => ++id; })()
} = {}) {
  let child = null;
  let lines = null;
  let starting = null;
  let initialized = false;
  let stdoutBytes = 0;
  let nextId = idFactory;
  const pending = new Map();

  function closeProcess(error = Object.assign(new Error("Unlimited OCR MCP process closed."), { code: "OCR_PROCESS_CLOSED" })) {
    const process = child;
    child = null;
    lines?.close();
    lines = null;
    initialized = false;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
    if (process && process.exitCode === null && process.signalCode === null) {
      try { process.kill(); } catch (_) { /* Process may already have exited. */ }
    }
  }

  function send(method, params = {}) {
    if (!child || !child.stdin.writable) return Promise.reject(Object.assign(new Error("Unlimited OCR MCP process is unavailable."), { code: "OCR_PROCESS_UNAVAILABLE" }));
    const id = nextId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        closeProcess(Object.assign(new Error(`Unlimited OCR MCP ${method} timed out.`), { code: "OCR_TIMEOUT" }));
      }, Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
      pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      } catch {
        clearTimeout(timer);
        pending.delete(id);
        reject(Object.assign(new Error("Could not send a request to Unlimited OCR MCP."), { code: "OCR_TRANSPORT_ERROR" }));
      }
    });
  }

  function startProcess() {
    if (!config.configured) {
      return Promise.reject(Object.assign(new Error(config.error || "Unlimited OCR MCP is not configured on this host."), { code: "OCR_NOT_CONFIGURED" }));
    }
    if (initialized && child) return Promise.resolve();
    if (starting) return starting;
    starting = new Promise((resolve, reject) => {
      try {
        child = spawnProcess(config.command, config.args, {
          shell: false,
          stdio: ["pipe", "pipe", "ignore"],
          windowsHide: true
        });
      } catch {
        starting = null;
        reject(Object.assign(new Error("Unlimited OCR MCP process could not be started."), { code: "OCR_PROCESS_START_FAILED" }));
        return;
      }
      stdoutBytes = 0;
      lines = createInterface({ input: child.stdout });
      lines.on("line", line => {
        stdoutBytes += Buffer.byteLength(line, "utf8");
        if (stdoutBytes > MAX_STDOUT_BYTES) {
          closeProcess(Object.assign(new Error("Unlimited OCR MCP output exceeded the safety limit."), { code: "OCR_OUTPUT_TOO_LARGE" }));
          return;
        }
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (message.id == null) return;
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) {
          request.reject(Object.assign(new Error(String(message.error.message || "MCP request failed").slice(0, 240)), { code: "OCR_MCP_ERROR" }));
        } else request.resolve(message.result);
      });
      child.stdout.once("error", () => closeProcess(Object.assign(new Error("Unlimited OCR MCP output stream failed."), { code: "OCR_TRANSPORT_ERROR" })));
      child.once("error", () => closeProcess(Object.assign(new Error("Unlimited OCR MCP process could not be started."), { code: "OCR_PROCESS_START_FAILED" })));
      child.once("close", code => closeProcess(Object.assign(
        new Error(`Unlimited OCR MCP process exited${code == null ? "" : ` with code ${code}`}.`),
        { code: "OCR_PROCESS_EXITED" }
      )));
      child.stdin.once("error", () => closeProcess(Object.assign(new Error("Unlimited OCR MCP input stream failed."), { code: "OCR_TRANSPORT_ERROR" })));
      send("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "jeauditflow", version: "6.9.0" }
      }).then(() => {
        if (!child) throw Object.assign(new Error("Unlimited OCR MCP stopped during initialization."), { code: "OCR_PROCESS_EXITED" });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
        initialized = true;
        starting = null;
        resolve();
      }).catch(error => {
        starting = null;
        closeProcess(error);
        reject(error);
      });
    });
    return starting;
  }

  async function callTool(name, args) {
    await startProcess();
    const response = await send("tools/call", { name, arguments: args });
    return parseToolResult(response);
  }

  async function validateImagePath(imagePath) {
    if (!config.allowedRoots.length) throw Object.assign(new Error("Configure AUDITFLOW_OCR_ALLOWED_ROOTS before enabling OCR."), { code: "OCR_ALLOWED_ROOTS_REQUIRED" });
    const requested = path.resolve(String(imagePath || ""));
    if (!SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(requested).toLowerCase())) {
      throw Object.assign(new Error("OCR accepts PNG, JPG, JPEG, WEBP, or BMP images only."), { code: "OCR_UNSUPPORTED_FILE" });
    }
    let actual;
    try {
      actual = await realpath(requested);
      const info = await stat(actual);
      if (!info.isFile()) throw new Error("not a file");
      if (info.size > MAX_IMAGE_BYTES) throw Object.assign(new Error("too large"), { code: "OCR_FILE_TOO_LARGE" });
    } catch (error) {
      if (error?.code === "OCR_FILE_TOO_LARGE") throw error;
      throw Object.assign(new Error("The selected OCR image is unavailable."), { code: "OCR_FILE_UNAVAILABLE" });
    }
    const allowed = await Promise.all(config.allowedRoots.map(async root => {
      try {
        const actualRoot = await realpath(root);
        const relative = path.relative(actualRoot, actual);
        return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
      } catch { return false; }
    }));
    if (!allowed.includes(true)) throw Object.assign(new Error("The selected OCR image is outside the configured local allowlist."), { code: "OCR_PATH_REJECTED" });
    return actual;
  }

  return {
    configured: () => Boolean(config.configured && config.allowedRoots.length),
    async status() {
      if (!config.configured) return { configured: false, available: false, loaded: false, error: config.error || "Unlimited OCR MCP is not configured.", code: config.error ? "OCR_CONFIG_INVALID" : "OCR_NOT_CONFIGURED" };
      if (!config.allowedRoots.length) return { configured: false, available: false, loaded: false, error: "OCR local image allowlist is not configured.", code: "OCR_ALLOWED_ROOTS_REQUIRED" };
      try {
        const result = await callTool("model_status", {});
        return {
          configured: true,
          available: true,
          loaded: Boolean(result?.loaded),
          device: result?.device ? String(result.device).slice(0, 80) : null,
          loadTimeSeconds: result?.load_time_seconds != null && Number.isFinite(Number(result.load_time_seconds))
            ? Number(result.load_time_seconds)
            : null
        };
      } catch (error) {
        return { configured: true, available: false, loaded: false, error: error.message, code: error.code || "OCR_STATUS_FAILED" };
      }
    },
    async ocrImage(imagePath, options = {}) {
      if (!config.configured) {
        throw Object.assign(new Error(config.error || "Unlimited OCR MCP is not configured on this host."), {
          code: config.error ? "OCR_CONFIG_INVALID" : "OCR_NOT_CONFIGURED"
        });
      }
      const safePath = await validateImagePath(imagePath);
      const result = await callTool("ocr_image", {
        path: safePath,
        ...(options.prompt ? { prompt: String(options.prompt).slice(0, 500) } : {}),
        ...(options.max_length ? { max_length: Math.max(256, Math.min(Number(options.max_length) || 8192, 16384)) } : {})
      });
      return normalizeOcrResult(result, safePath);
    },
    close() {
      closeProcess();
    }
  };
}
