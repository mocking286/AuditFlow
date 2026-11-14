import { createReadStream, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";

const API_PREFIX = "/api/v1";
const SESSION_COOKIE = "auditflow_session";
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 210_000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_EVENT_FILE_BYTES = 8 * 1024 * 1024;
const SAFE_EVENT = /^[a-z0-9][a-z0-9_.:-]{0,63}$/i;

function localAppData() {
  return process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || process.cwd(), "AppData", "Local");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validPassword(value) {
  return typeof value === "string" && value.length >= 10 && value.length <= 128 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

function safeText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").trim().slice(0, maxLength);
}

function jsonFile(pathname, fallback) {
  try {
    if (!existsSync(pathname)) return fallback;
    return JSON.parse(readFileSync(pathname, "utf8").replace(/^\uFEFF/, ""));
  } catch (_) {
    return fallback;
  }
}

function writeJsonAtomic(pathname, value) {
  const temporary = `${pathname}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, pathname);
}

function rotateIfNeeded(pathname) {
  try {
    if (statSync(pathname).size < MAX_EVENT_FILE_BYTES) return;
    const rotated = `${pathname}.1`;
    if (existsSync(rotated)) writeFileSync(rotated, "", "utf8");
    renameSync(pathname, rotated);
  } catch (_) {
    // Missing files and transient rotation errors do not block the workbench.
  }
}

function appendJsonLine(pathname, value) {
  rotateIfNeeded(pathname);
  appendFileSync(pathname, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
}

function readJsonLines(pathname, limit = 2_000) {
  try {
    if (!existsSync(pathname)) return [];
    return readFileSync(pathname, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map(line => JSON.parse(line));
  } catch (_) {
    return [];
  }
}

function parseCookies(request) {
  const result = {};
  for (const part of String(request.headers.cookie || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    result[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
  }
  return result;
}

function requestOriginIsLocal(request) {
  const origin = String(request.headers.origin || "");
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  } catch (_) {
    return false;
  }
}

function errorPayload(code, message, requestId) {
  return {
    error: {
      code,
      message,
      traceId: requestId,
      timestamp: new Date().toISOString()
    }
  };
}

function jsonResponse(response, status, data, requestId, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-correlation-id": requestId,
    ...headers
  });
  response.end(JSON.stringify({ data, metadata: { requestId, timestamp: new Date().toISOString() } }));
}

function errorResponse(response, status, code, message, requestId) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-correlation-id": requestId
  });
  response.end(JSON.stringify(errorPayload(code, message, requestId)));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body too large"), { status: 413, code: "REQUEST_TOO_LARGE" });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch (_) {
    throw Object.assign(new Error("Request body must be valid JSON"), { status: 400, code: "INVALID_JSON" });
  }
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    telemetryConsent: user.telemetryConsent,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null
  };
}

function hashPassword(password, saltBase64) {
  return pbkdf2Sync(password, Buffer.from(saltBase64, "base64"), PASSWORD_ITERATIONS, 32, "sha256").toString("base64");
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_LIFETIME_MS / 1000)}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

function releaseFileAllowed(manifest, filename) {
  return Array.isArray(manifest.releases) && manifest.releases.some(item => item.file === filename && path.basename(item.file) === item.file);
}

function compatibleRelease(item, channel) {
  if (!item || item.channel !== channel || path.basename(String(item.file || "")) !== item.file) return false;
  if (!String(item.version || "").trim() || !Number.isSafeInteger(Number(item.size)) || Number(item.size) <= 0) return false;
  if (!/^[a-f0-9]{64}$/i.test(String(item.sha256 || ""))) return false;
  return channel !== "windows" || /\.zip$/i.test(item.file);
}

export function createOperationsService({ port, applicationRoot, productVersion }) {
  const dataRoot = path.resolve(process.env.AUDITFLOW_DATA_DIR || path.join(localAppData(), "AuditFlow Desktop", "Data"));
  const releaseRoot = path.resolve(process.env.AUDITFLOW_RELEASES_DIR || path.join(localAppData(), "AuditFlow Desktop", "Releases"));
  const usersPath = path.join(dataRoot, "users.json");
  const eventsPath = path.join(dataRoot, "usage.jsonl");
  const feedbackPath = path.join(dataRoot, "feedback.jsonl");
  const releaseManifestPath = path.join(releaseRoot, "release-manifest.json");
  const sessions = new Map();
  const rateBuckets = new Map();
  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(releaseRoot, { recursive: true });

  function users() {
    const value = jsonFile(usersPath, []);
    return Array.isArray(value) ? value : [];
  }

  function saveUsers(value) {
    writeJsonAtomic(usersPath, value);
  }

  function activeSession(request) {
    const token = parseCookies(request)[SESSION_COOKIE];
    if (!token) return null;
    const session = sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      sessions.delete(token);
      return null;
    }
    const user = users().find(item => item.id === session.userId);
    return user ? { token, session, user } : null;
  }

  function createSession(user) {
    const token = randomBytes(32).toString("base64url");
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_LIFETIME_MS });
    return token;
  }

  function rateAllowed(key, maximum, windowMs) {
    const now = Date.now();
    const bucket = rateBuckets.get(key) || [];
    const recent = bucket.filter(timestamp => now - timestamp < windowMs);
    if (recent.length >= maximum) {
      rateBuckets.set(key, recent);
      return false;
    }
    recent.push(now);
    rateBuckets.set(key, recent);
    return true;
  }

  function recordUsage(user, event, page, source, details = {}) {
    if (user && !user.telemetryConsent) return;
    const cleanEvent = SAFE_EVENT.test(String(event || "")) ? String(event) : "unknown";
    appendJsonLine(eventsPath, {
      id: randomBytes(12).toString("hex"),
      timestamp: new Date().toISOString(),
      userId: user?.id || null,
      event: cleanEvent,
      page: safeText(page, 120),
      source: safeText(source, 32) || "web",
      appVersion: safeText(details.appVersion, 32) || productVersion,
      platform: safeText(details.platform, 64),
      durationSeconds: Number.isFinite(Number(details.durationSeconds))
        ? Math.max(0, Math.min(86_400, Math.round(Number(details.durationSeconds))))
        : null
    });
  }

  function requireSession(request, response, requestId) {
    const auth = activeSession(request);
    if (!auth) errorResponse(response, 401, "AUTH_REQUIRED", "Login required for AuditFlow.", requestId);
    return auth;
  }

  function requireAdmin(request, response, requestId) {
    const auth = requireSession(request, response, requestId);
    if (!auth) return null;
    if (auth.user.role !== "admin") {
      errorResponse(response, 403, "ADMIN_REQUIRED", "Administrator access required.", requestId);
      return null;
    }
    return auth;
  }

  function releaseManifest() {
    const manifest = jsonFile(releaseManifestPath, { schemaVersion: 1, releases: [] });
    return Array.isArray(manifest.releases) ? manifest : { schemaVersion: 1, releases: [] };
  }

  async function handleAuth(request, response, pathname, requestId) {
    if (pathname === `${API_PREFIX}/auth/session` && request.method === "GET") {
      const auth = activeSession(request);
      jsonResponse(response, 200, { authenticated: Boolean(auth), user: auth ? publicUser(auth.user) : null }, requestId);
      return true;
    }

    if (pathname === `${API_PREFIX}/auth/register` && request.method === "POST") {
      if (!requestOriginIsLocal(request)) {
        errorResponse(response, 403, "LOCAL_ORIGIN_REQUIRED", "Local AuditFlow origin required.", requestId);
        return true;
      }
      if (!rateAllowed("register", 8, 60 * 60 * 1000)) {
        errorResponse(response, 429, "RATE_LIMITED", "Registration rate limit exceeded.", requestId);
        return true;
      }
      const body = await readBody(request);
      const email = normalizeEmail(body.email);
      const password = String(body.password || "");
      if (!validEmail(email)) {
        errorResponse(response, 422, "INVALID_EMAIL", "Valid email required.", requestId);
        return true;
      }
      if (!validPassword(password)) {
        errorResponse(response, 422, "WEAK_PASSWORD", "Password must be 10-128 characters with letters and numbers.", requestId);
        return true;
      }
      const allUsers = users();
      if (allUsers.some(item => item.email === email)) {
        errorResponse(response, 409, "EMAIL_EXISTS", "Email already registered.", requestId);
        return true;
      }
      const salt = randomBytes(16).toString("base64");
      const now = new Date().toISOString();
      const user = {
        id: randomBytes(16).toString("hex"),
        email,
        role: allUsers.length === 0 ? "admin" : "user",
        telemetryConsent: body.telemetryConsent !== false,
        passwordSalt: salt,
        passwordHash: hashPassword(password, salt),
        passwordIterations: PASSWORD_ITERATIONS,
        createdAt: now,
        lastLoginAt: now
      };
      allUsers.push(user);
      saveUsers(allUsers);
      const token = createSession(user);
      recordUsage(user, "auth.register", "/desktop.html", "desktop");
      jsonResponse(response, 201, { authenticated: true, user: publicUser(user) }, requestId, { "set-cookie": sessionCookie(token) });
      return true;
    }

    if (pathname === `${API_PREFIX}/auth/login` && request.method === "POST") {
      if (!requestOriginIsLocal(request)) {
        errorResponse(response, 403, "LOCAL_ORIGIN_REQUIRED", "Local AuditFlow origin required.", requestId);
        return true;
      }
      if (!rateAllowed("login", 20, 10 * 60 * 1000)) {
        errorResponse(response, 429, "RATE_LIMITED", "Login rate limit exceeded.", requestId);
        return true;
      }
      const body = await readBody(request);
      const email = normalizeEmail(body.email);
      const password = String(body.password || "");
      const allUsers = users();
      const user = allUsers.find(item => item.email === email);
      let valid = false;
      if (user && validPassword(password)) {
        const expected = Buffer.from(user.passwordHash, "base64");
        const candidate = Buffer.from(hashPassword(password, user.passwordSalt), "base64");
        valid = expected.length === candidate.length && timingSafeEqual(expected, candidate);
      }
      if (!valid || !user) {
        errorResponse(response, 401, "INVALID_CREDENTIALS", "Invalid credentials.", requestId);
        return true;
      }
      user.lastLoginAt = new Date().toISOString();
      saveUsers(allUsers);
      const token = createSession(user);
      recordUsage(user, "auth.login", "/desktop.html", "desktop");
      jsonResponse(response, 200, { authenticated: true, user: publicUser(user) }, requestId, { "set-cookie": sessionCookie(token) });
      return true;
    }

    if (pathname === `${API_PREFIX}/auth/logout` && request.method === "POST") {
      const auth = activeSession(request);
      if (auth) {
        sessions.delete(auth.token);
        recordUsage(auth.user, "auth.logout", "/desktop.html", "desktop");
      }
      jsonResponse(response, 200, { authenticated: false }, requestId, { "set-cookie": clearSessionCookie() });
      return true;
    }

    return false;
  }

  async function handleTelemetry(request, response, pathname, requestId) {
    if (pathname === `${API_PREFIX}/telemetry` && request.method === "POST") {
      const auth = requireSession(request, response, requestId);
      if (!auth) return true;
      if (!requestOriginIsLocal(request)) {
        errorResponse(response, 403, "LOCAL_ORIGIN_REQUIRED", "Local AuditFlow origin required.", requestId);
        return true;
      }
      if (!rateAllowed(`telemetry:${auth.user.id}`, 240, 60 * 60 * 1000)) {
        errorResponse(response, 429, "RATE_LIMITED", "Telemetry rate limit exceeded.", requestId);
        return true;
      }
      const body = await readBody(request);
      recordUsage(auth.user, body.event, body.page, body.source, body);
      jsonResponse(response, 202, { accepted: auth.user.telemetryConsent }, requestId);
      return true;
    }

    if (pathname === `${API_PREFIX}/feedback` && request.method === "POST") {
      const auth = requireSession(request, response, requestId);
      if (!auth) return true;
      if (!requestOriginIsLocal(request)) {
        errorResponse(response, 403, "LOCAL_ORIGIN_REQUIRED", "Local AuditFlow origin required.", requestId);
        return true;
      }
      if (!rateAllowed(`feedback:${auth.user.id}`, 20, 60 * 60 * 1000)) {
        errorResponse(response, 429, "RATE_LIMITED", "Feedback rate limit exceeded.", requestId);
        return true;
      }
      const body = await readBody(request);
      const message = safeText(body.message, 3_000);
      if (message.length < 4) {
        errorResponse(response, 422, "FEEDBACK_REQUIRED", "Feedback must contain at least 4 characters.", requestId);
        return true;
      }
      const rating = Math.max(1, Math.min(5, Number(body.rating) || 3));
      const feedback = {
        id: randomBytes(12).toString("hex"),
        timestamp: new Date().toISOString(),
        userId: auth.user.id,
        email: auth.user.email,
        category: safeText(body.category, 32) || "general",
        rating,
        message,
        status: "new",
        appVersion: safeText(body.appVersion, 32) || productVersion
      };
      appendJsonLine(feedbackPath, feedback);
      recordUsage(auth.user, "feedback.submit", "/desktop.html", "desktop", { appVersion: feedback.appVersion });
      jsonResponse(response, 201, { id: feedback.id, status: feedback.status }, requestId);
      return true;
    }

    return false;
  }

  function handleAdmin(request, response, pathname, requestId) {
    if (!pathname.startsWith(`${API_PREFIX}/admin/`) || request.method !== "GET") return false;
    const auth = requireAdmin(request, response, requestId);
    if (!auth) return true;
    const allEvents = readJsonLines(eventsPath, 10_000);
    const allFeedback = readJsonLines(feedbackPath, 2_000);
    const allUsers = users();
    const now = Date.now();

    if (pathname === `${API_PREFIX}/admin/summary`) {
      const dayEvents = allEvents.filter(item => now - Date.parse(item.timestamp) <= 24 * 60 * 60 * 1000);
      const weekEvents = allEvents.filter(item => now - Date.parse(item.timestamp) <= 7 * 24 * 60 * 60 * 1000);
      const activeEvents = allEvents.filter(item => now - Date.parse(item.timestamp) <= 5 * 60 * 1000);
      const unique = values => new Set(values.filter(Boolean)).size;
      const byEvent = {};
      for (const item of weekEvents) byEvent[item.event] = (byEvent[item.event] || 0) + 1;
      jsonResponse(response, 200, {
        registeredUsers: allUsers.length,
        activeUsers5m: unique(activeEvents.map(item => item.userId)),
        activeSessions: sessions.size,
        events24h: dayEvents.length,
        events7d: weekEvents.length,
        users7d: unique(weekEvents.map(item => item.userId)),
        feedbackTotal: allFeedback.length,
        feedbackNew: allFeedback.filter(item => item.status === "new").length,
        averageRating: allFeedback.length
          ? Number((allFeedback.reduce((sum, item) => sum + Number(item.rating || 0), 0) / allFeedback.length).toFixed(1))
          : 0,
        topEvents: Object.entries(byEvent).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([event, count]) => ({ event, count })),
        dataRoot,
        releaseRoot
      }, requestId);
      return true;
    }

    if (pathname === `${API_PREFIX}/admin/activity`) {
      jsonResponse(response, 200, allEvents.slice(-200).reverse(), requestId);
      return true;
    }

    if (pathname === `${API_PREFIX}/admin/feedback`) {
      jsonResponse(response, 200, allFeedback.slice(-200).reverse(), requestId);
      return true;
    }

    if (pathname === `${API_PREFIX}/admin/users`) {
      jsonResponse(response, 200, allUsers.map(publicUser), requestId);
      return true;
    }

    errorResponse(response, 404, "ADMIN_ENDPOINT_NOT_FOUND", "Operations endpoint not found.", requestId);
    return true;
  }

  function handleReleases(request, response, parsedUrl, requestId) {
    const { pathname } = parsedUrl;
    if (pathname === `${API_PREFIX}/releases` && request.method === "GET") {
      jsonResponse(response, 200, releaseManifest(), requestId);
      return true;
    }
    if (pathname === `${API_PREFIX}/releases/latest` && request.method === "GET") {
      const channel = safeText(parsedUrl.searchParams.get("channel"), 32) || "windows";
      const releases = releaseManifest().releases
        .filter(item => compatibleRelease(item, channel))
        .sort((left, right) => String(right.publishedAt || "").localeCompare(String(left.publishedAt || "")));
      if (!releases.length) {
        errorResponse(response, 404, "RELEASE_NOT_FOUND", `Release ${channel} not found.`, requestId);
        return true;
      }
      const item = releases[0];
      jsonResponse(response, 200, { ...item, downloadUrl: `/downloads/${encodeURIComponent(item.file)}` }, requestId);
      return true;
    }
    return false;
  }

  function handleDownload(request, response, parsedUrl, requestId) {
    if (!["GET", "HEAD"].includes(request.method) || !parsedUrl.pathname.startsWith("/downloads/")) return false;
    const filename = decodeURIComponent(parsedUrl.pathname.slice("/downloads/".length));
    if (!filename || filename.startsWith(".") || /[\/\\]/.test(filename)) {
      errorResponse(response, 404, "DOWNLOAD_NOT_FOUND", "Download path is not valid.", requestId);
      return true;
    }
    const manifest = releaseManifest();
    const registeredRelease = releaseFileAllowed(manifest, filename);
    const staticDownloadRoot = path.resolve(applicationRoot, "downloads");
    const publicDocuments = new Set([
      "JEAuditFlow-company-portal-download-guide.pdf",
      `JEAuditFlow-Operation-Manual-${productVersion}-EN.pdf`,
      `JEAuditFlow-Operation-Manual-${productVersion}-ZH.pdf`
    ]);
    if (!registeredRelease && !publicDocuments.has(filename)) {
      errorResponse(response, 404, "DOWNLOAD_NOT_FOUND", "Download is not registered in the release manifest.", requestId);
      return true;
    }
    const downloadRoot = registeredRelease ? releaseRoot : staticDownloadRoot;
    const target = path.resolve(downloadRoot, filename);
    if (!existsSync(target) || !realpathSync(target).startsWith(realpathSync(downloadRoot) + path.sep) || !statSync(target).isFile()) {
      errorResponse(response, 404, "DOWNLOAD_NOT_FOUND", "Download is not present in the local release directory.", requestId);
      return true;
    }
    const info = statSync(target);
    if (request.method === "GET") {
      const auth = activeSession(request);
      const release = manifest.releases.find(item => item.file === filename);
      recordUsage(auth?.user || null, `download.${safeText(release?.channel, 24) || "document"}`, "/portal.html", "web", { appVersion: productVersion });
    }
    response.writeHead(200, {
      "content-type": /\.pdf$/i.test(filename) ? "application/pdf" : "application/octet-stream",
      "content-length": String(info.size),
      "content-disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-correlation-id": requestId
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(target).pipe(response);
    return true;
  }

  async function handle(request, response) {
    const parsedUrl = new URL(request.url || "/", `http://127.0.0.1:${port}`);
    const { pathname } = parsedUrl;
    const isOwned = pathname.startsWith(`${API_PREFIX}/`) || pathname.startsWith("/downloads/");
    if (!isOwned) return false;
    const requestId = randomBytes(12).toString("hex");
    try {
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "access-control-allow-origin": `http://127.0.0.1:${port}`,
          "access-control-allow-credentials": "true",
          "access-control-allow-headers": "content-type, x-correlation-id",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "x-correlation-id": requestId
        });
        response.end();
        return true;
      }
      if (pathname === `${API_PREFIX}/ops/health` && request.method === "GET") {
        jsonResponse(response, 200, {
          status: "ok",
          product: "JEAuditFlow",
          version: productVersion,
          authentication: "local-email",
          telemetry: "local-consent-based",
          applicationRoot,
          time: new Date().toISOString()
        }, requestId);
        return true;
      }
      if (await handleAuth(request, response, pathname, requestId)) return true;
      if (await handleTelemetry(request, response, pathname, requestId)) return true;
      if (handleAdmin(request, response, pathname, requestId)) return true;
      if (handleReleases(request, response, parsedUrl, requestId)) return true;
      if (handleDownload(request, response, parsedUrl, requestId)) return true;
      errorResponse(response, 404, "ENDPOINT_NOT_FOUND", "AuditFlow API endpoint not found.", requestId);
      return true;
    } catch (error) {
      errorResponse(
        response,
        Number(error.status) || 500,
        safeText(error.code, 64) || "INTERNAL_ERROR",
        Number(error.status) ? safeText(error.message, 240) : "Local operations service error.",
        requestId
      );
      return true;
    }
  }

  return { handle, dataRoot, releaseRoot };
}
