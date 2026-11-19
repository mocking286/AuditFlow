import crypto from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_RESULT_TEXT = 1_000_000;
const MAX_DETECTIONS = 20_000;

const MIME_EXTENSIONS = Object.freeze({
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/bmp": ".bmp"
});

const SUPPORTED_MIME_TYPES = new Set(Object.keys(MIME_EXTENSIONS));
const ADAPTER_ERRORS = Object.freeze({
  OCR_NOT_CONFIGURED: "Unlimited OCR is not configured.",
  OCR_CONFIG_INVALID: "Unlimited OCR configuration is invalid.",
  OCR_ALLOWED_ROOTS_REQUIRED: "OCR local allowlist is not configured.",
  OCR_PATH_REJECTED: "The temporary image is outside the OCR allowlist.",
  OCR_UNSUPPORTED_FILE: "Unlimited OCR rejected the image format.",
  OCR_FILE_TOO_LARGE: "The OCR image exceeds the configured size limit.",
  OCR_TIMEOUT: "Unlimited OCR timed out.",
  OCR_TOOL_ERROR: "Unlimited OCR could not process the image.",
  OCR_MCP_ERROR: "Unlimited OCR could not process the image.",
  OCR_PROCESS_UNAVAILABLE: "Unlimited OCR is unavailable.",
  OCR_PROCESS_START_FAILED: "Unlimited OCR could not be started.",
  OCR_PROCESS_EXITED: "Unlimited OCR stopped unexpectedly.",
  OCR_TRANSPORT_ERROR: "Unlimited OCR communication failed.",
  OCR_OUTPUT_TOO_LARGE: "Unlimited OCR returned too much output."
});

function errorWithCode(message, code) {
  return Object.assign(new Error(message), { code });
}

function normalizeMimeType(value) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

function normalizeImageBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  throw errorWithCode("OCR image payload must be binary data.", "OCR_INVALID_PAYLOAD");
}

function matchesImageSignature(bytes, mimeType) {
  if (mimeType === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/webp") {
    return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  }
  if (mimeType === "image/bmp") {
    return bytes.length >= 2 && bytes.toString("ascii", 0, 2) === "BM";
  }
  return false;
}

function safeErrorCode(value) {
  const code = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_:-]/g, "");
  return Object.hasOwn(ADAPTER_ERRORS, code) ? code : "OCR_FAILED";
}

function sanitizeStatus(status) {
  if (!status || typeof status !== "object") {
    return { configured: false, available: false, loaded: false, code: "OCR_STATUS_INVALID" };
  }
  const result = {
    configured: Boolean(status.configured),
    available: Boolean(status.available),
    loaded: Boolean(status.loaded)
  };
  if (status.code) result.code = safeErrorCode(status.code);
  if (status.device) result.device = String(status.device).replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 32);
  if (status.loadTimeSeconds != null && Number.isFinite(Number(status.loadTimeSeconds))) {
    result.loadTimeSeconds = Math.max(0, Math.min(Number(status.loadTimeSeconds), 86_400));
  }
  return result;
}

function sanitizeDetections(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_DETECTIONS).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const bbox = Array.isArray(item.bbox) ? item.bbox.slice(0, 4).map(Number) : [];
    if (bbox.length !== 4 || bbox.some(number => !Number.isFinite(number) || number < 0)) return [];
    return [{
      type: String(item.type || "text").replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 48) || "text",
      bbox,
      text: String(item.text || "").slice(0, 8_000)
    }];
  });
}

function sanitizeOcrResult(result) {
  const normalized = result && typeof result === "object" ? result : {};
  const output = {
    detections: sanitizeDetections(normalized.detections),
    rawOutput: String(normalized.rawOutput ?? normalized.raw_output ?? "").slice(0, MAX_RESULT_TEXT)
  };
  if (normalized.elapsedSeconds != null && Number.isFinite(Number(normalized.elapsedSeconds))) {
    output.elapsedSeconds = Math.max(0, Math.min(Number(normalized.elapsedSeconds), 86_400));
  }
  return output;
}

/**
 * Bridges browser-side visual extraction to the existing local Unlimited OCR
 * adapter. The adapter remains responsible for model/process status and the
 * local path allowlist; this service only handles one bounded image payload at
 * a time and never persists the bytes after the call completes.
 */
export function createDocumentVisualOcrService({
  adapter,
  tempRoot = path.join(os.tmpdir(), "auditflow-ocr"),
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
  idFactory = () => crypto.randomUUID()
} = {}) {
  if (!adapter || typeof adapter.ocrImage !== "function" || typeof adapter.status !== "function") {
    throw errorWithCode("An Unlimited OCR adapter is required.", "OCR_ADAPTER_REQUIRED");
  }
  const root = path.resolve(String(tempRoot || ""));
  if (!root || root === path.parse(root).root) {
    throw errorWithCode("The OCR temporary workspace is invalid.", "OCR_WORKSPACE_INVALID");
  }
  const payloadLimit = Math.max(1, Math.min(Number(maxImageBytes) || DEFAULT_MAX_IMAGE_BYTES, 50 * 1024 * 1024));

  async function status() {
    try {
      return sanitizeStatus(await adapter.status());
    } catch (error) {
      return {
        configured: false,
        available: false,
        loaded: false,
        code: safeErrorCode(error?.code || "OCR_STATUS_FAILED")
      };
    }
  }

  async function ocrImageBytes(imageBytes, {
    mimeType,
    prompt,
    maxLength
  } = {}) {
    const mime = normalizeMimeType(mimeType);
    if (!SUPPORTED_MIME_TYPES.has(mime)) {
      throw errorWithCode("OCR accepts PNG, JPEG, WEBP, or BMP images only.", "OCR_UNSUPPORTED_MIME");
    }
    const bytes = normalizeImageBuffer(imageBytes);
    if (!bytes.byteLength) throw errorWithCode("OCR image payload is empty.", "OCR_EMPTY_PAYLOAD");
    if (bytes.byteLength > payloadLimit) {
      throw errorWithCode("OCR image payload exceeds the configured size limit.", "OCR_FILE_TOO_LARGE");
    }
    if (!matchesImageSignature(bytes, mime)) {
      throw errorWithCode("OCR image bytes do not match the declared image format.", "OCR_MIME_MISMATCH");
    }

    let workspace = "";
    let response;
    let failure = null;
    try {
      await mkdir(root, { recursive: true });
      workspace = await mkdtemp(path.join(root, "request-"));
      const generatedId = String(idFactory() || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "image";
      const imagePath = path.join(workspace, `${generatedId}${MIME_EXTENSIONS[mime]}`);
      await writeFile(imagePath, bytes, { flag: "wx", mode: 0o600 });
      try {
        const result = await adapter.ocrImage(imagePath, {
          ...(prompt ? { prompt: String(prompt).slice(0, 500) } : {}),
          ...(maxLength != null ? { max_length: Math.max(256, Math.min(Number(maxLength) || 8192, 16_384)) } : {})
        });
        response = {
        mimeType: mime,
        byteLength: bytes.byteLength,
        ...sanitizeOcrResult(result)
        };
      } catch (error) {
        const code = safeErrorCode(error?.code);
        failure = errorWithCode(ADAPTER_ERRORS[code] || "Unlimited OCR request failed.", code);
      }
    } catch (_) {
      failure = errorWithCode("OCR temporary image processing failed.", "OCR_TEMPORARY_FAILURE");
    } finally {
      if (workspace) {
        try {
          await rm(workspace, { recursive: true, force: true });
        } catch {
          failure = errorWithCode("OCR temporary image cleanup failed.", "OCR_TEMP_CLEANUP_FAILED");
        }
      }
    }
    if (failure) throw failure;
    return response;
  }

  return Object.freeze({ status, ocrImageBytes });
}

export const documentVisualOcrLimits = Object.freeze({
  defaultMaxImageBytes: DEFAULT_MAX_IMAGE_BYTES,
  maxResultText: MAX_RESULT_TEXT,
  maxDetections: MAX_DETECTIONS,
  supportedMimeTypes: [...SUPPORTED_MIME_TYPES]
});
