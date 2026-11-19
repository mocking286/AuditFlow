import crypto from "node:crypto";

const CONTENT_KINDS = new Set(["document", "image", "video", "aspice-rule"]);
const METADATA_KEYS = new Set(["title", "summary", "tags"]);

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function boundedText(value, name, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw invalid(`${name} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}

export function normalizePublicContentChange(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("Each content change must be an object");
  const allowedKeys = new Set([
    "contentKey", "revision", "contentKind", "sha256", "byteSize", "mediaType",
    "storageKey", "productVersion", "locale", "metadata", "operation", "classification"
  ]);
  if (Object.keys(input).some(key => !allowedKeys.has(key))) throw invalid("Only public content metadata can be queued");
  if (input.classification !== undefined && input.classification !== "public") throw invalid("Only public content can be queued");

  const operation = input.operation === undefined ? "upsert" : input.operation;
  if (operation !== "upsert" && operation !== "delete") throw invalid("Unsupported content operation");
  const contentKey = boundedText(input.contentKey, "contentKey", 191);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(contentKey)) throw invalid("contentKey contains unsupported characters");
  const revision = Number(input.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) throw invalid("revision must be a positive integer");
  if (!CONTENT_KINDS.has(input.contentKind)) throw invalid("Only public document, image, video, and ASPICE rule content can be queued");

  const normalized = {
    contentKey,
    revision,
    contentKind: input.contentKind,
    operation
  };
  if (operation === "upsert") {
    const sha256 = boundedText(input.sha256, "sha256", 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw invalid("sha256 must be a 64-character hexadecimal digest");
    const byteSize = Number(input.byteSize);
    if (!Number.isSafeInteger(byteSize) || byteSize < 0 || byteSize > 2 ** 40) throw invalid("byteSize is outside the supported range");
    const mediaType = boundedText(input.mediaType, "mediaType", 160);
    if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mediaType)) throw invalid("mediaType must be a MIME type");
    const storageKey = boundedText(input.storageKey, "storageKey", 768);
    if (storageKey.startsWith("/") || storageKey.includes("\\") || storageKey.split("/").some(part => !part || part === "." || part === "..")) {
      throw invalid("storageKey must be a safe relative path");
    }
    const productVersion = boundedText(input.productVersion, "productVersion", 32);
    if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(productVersion)) throw invalid("productVersion must be a semantic version");
    const locale = input.locale === undefined ? "und" : boundedText(input.locale, "locale", 16);
    if (!/^(?:und|[a-z]{2,3}(?:-[A-Z]{2})?)$/.test(locale)) throw invalid("locale is not supported");
    const metadataInput = input.metadata === undefined ? {} : input.metadata;
    if (!metadataInput || typeof metadataInput !== "object" || Array.isArray(metadataInput)) throw invalid("metadata must be an object");
    if (Object.keys(metadataInput).some(key => !METADATA_KEYS.has(key))) throw invalid("metadata contains a non-public field");
    const metadata = {};
    if (metadataInput.title !== undefined) metadata.title = boundedText(metadataInput.title, "metadata.title", 200);
    if (metadataInput.summary !== undefined) metadata.summary = boundedText(metadataInput.summary, "metadata.summary", 1000);
    if (metadataInput.tags !== undefined) {
      if (!Array.isArray(metadataInput.tags) || metadataInput.tags.length > 20) throw invalid("metadata.tags must contain at most 20 values");
      metadata.tags = metadataInput.tags.map(tag => boundedText(tag, "metadata.tags[]", 50));
    }
    Object.assign(normalized, { sha256, byteSize, mediaType, storageKey, productVersion, locale, metadata, classification: "public" });
  }
  return normalized;
}

export function normalizePublicContentBatch(changes) {
  if (!Array.isArray(changes) || changes.length > 100) throw invalid("changes must be an array with at most 100 entries");
  return changes.map(normalizePublicContentChange);
}

export function publicContentIdempotencyKey(change) {
  const normalized = normalizePublicContentChange(change);
  return `public-content-v1:${crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex")}`;
}
