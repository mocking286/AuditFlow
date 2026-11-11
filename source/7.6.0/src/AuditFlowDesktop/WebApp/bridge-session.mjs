import crypto from "node:crypto";
import http from "node:http";

export const BRIDGE_SERVICES = Object.freeze({
  jira: Object.freeze({ label: "Jira", host: "127.0.0.1", port: 8080, urlAliases: Object.freeze(["192.168.8.31", "192.168.8.42"]) }),
  confluence: Object.freeze({ label: "Confluence", host: "127.0.0.1", port: 8090, urlAliases: Object.freeze(["192.168.8.42"]) })
});
export const BRIDGE_LIMITS = Object.freeze({ requestBytes: 2 * 1024 * 1024, responseBytes: 8 * 1024 * 1024, requestTimeoutMs: 25_000, pollMs: 15_000 });
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const tokenHash = token => crypto.createHash("sha256").update(String(token || "")).digest();
const tokenValid = token => typeof token === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(token);
function serviceFor(route) {
  if (!Object.hasOwn(BRIDGE_SERVICES, String(route))) throw error("Unsupported bridge route");
  return BRIDGE_SERVICES[route];
}
function bridgePath(value) {
  const routePath = String(value || "/");
  if (routePath.length > 8192 || !routePath.startsWith("/") || routePath.startsWith("//") || /[\\\x00-\x20\x7f#]/.test(routePath)) throw error("Invalid bridge path");
  let pathname = routePath.split("?")[0];
  for (let count = 0; count < 3; count += 1) {
    try { pathname = decodeURIComponent(pathname); } catch { throw error("Invalid bridge path encoding"); }
    if (pathname.startsWith("//") || /[\\\x00-\x20\x7f]/.test(pathname) || pathname.split("/").some(part => part === "." || part === "..")) throw error("Invalid bridge path");
    if (!/%[0-9a-f]{2}/i.test(pathname)) break;
  }
  return routePath;
}
function bodyBytes(body, limit) {
  const text = String(body || "");
  if (text.length > Math.ceil(limit / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw error("Bridge body exceeds its size limit or is invalid", 413);
  const bytes = Buffer.from(text, "base64");
  if (bytes.length > limit) throw error("Bridge body exceeds its size limit", 413);
  return bytes;
}
function safeHeaders(value = {}, response = false) {
  const output = {};
  for (const [rawName, rawValue] of Object.entries(value).slice(0, 80)) {
    const name = rawName.toLowerCase();
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]{1,80}$/.test(name) || HOP_HEADERS.has(name) || name.startsWith("x-auditflow") || name.startsWith("x-forwarded-") || ["host", "authorization", "content-length", "origin", "referer"].includes(name)) continue;
    if (name.startsWith("access-control-") || name === "clear-site-data" || name === "service-worker-allowed") continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    if (!response && name === "set-cookie") continue;
    const cleaned = values.slice(0, name === "set-cookie" ? 30 : 1).map(item => String(item)).filter(item => item.length <= 8192 && !/[\r\n\x00]/.test(item));
    if (cleaned.length) output[name] = name === "set-cookie" ? cleaned : cleaned[0];
  }
  return output;
}
function normalizeResponse(value) {
  const status = Number(value?.status);
  if (!Number.isInteger(status) || status < 200 || status > 599) throw error("Invalid bridge response status");
  bodyBytes(value?.body, BRIDGE_LIMITS.responseBytes);
  return { status, headers: safeHeaders(value?.headers, true), body: String(value?.body || "") };
}

/** Public relay metadata and pending messages only. No private target or credential is persisted. */
export function createBridgeSessionStore({ now = () => Date.now(), ttlMs = 120_000, maxLifetimeMs = 8 * 60 * 60 * 1000, requestTimeoutMs = BRIDGE_LIMITS.requestTimeoutMs, maxSessions = 40 } = {}) {
  const sessions = new Map();
  function metadata(session) {
    return { sessionId: session.id, routes: session.routes.slice(), status: session.revoked ? "revoked" : now() >= session.expiresAt ? "expired" : session.connectedAt ? "connected" : "connecting", expiresAt: new Date(session.expiresAt).toISOString(), connectedAt: session.connectedAt ? new Date(session.connectedAt).toISOString() : null, createdAt: new Date(session.createdAt).toISOString(), pendingRequests: session.requests.size, links: Object.fromEntries(session.routes.map(route => [route, `/bridge/sessions/${session.id}/${route}/`])) };
  }
  function close(session, reason = "Bridge session expired or revoked") {
    session.revoked = true;
    for (const item of session.requests.values()) { clearTimeout(item.timer); item.reject(error(reason, 410)); }
    session.requests.clear();
    for (const wake of session.waiters) wake();
    session.waiters.clear();
  }
  function lookup(id) {
    const session = sessions.get(String(id));
    if (!session || session.revoked || now() >= session.expiresAt || now() >= session.createdAt + maxLifetimeMs) {
      if (session) close(session);
      throw error("Bridge session expired or revoked", 410);
    }
    return session;
  }
  function owner(id, userId) {
    const session = lookup(id);
    if (!userId || session.userId !== String(userId)) throw error("Bridge session access denied", 403);
    return session;
  }
  function connector(id, token) {
    const session = lookup(id);
    if (!tokenValid(token) || !crypto.timingSafeEqual(session.tokenHash, tokenHash(token))) throw error("Invalid bridge connector token", 401);
    return session;
  }
  function prune() {
    for (const [id, session] of sessions) if (session.revoked || now() >= session.expiresAt) { close(session); sessions.delete(id); }
  }
  function create({ userId, routes = ["jira", "confluence"], connectorToken } = {}) {
    prune();
    if (!userId) throw error("Bridge session owner is required", 401);
    if (!tokenValid(connectorToken)) throw error("A random connector token of at least 32 characters is required");
    if (!Array.isArray(routes) || !routes.length || routes.length > 2 || routes.some(route => typeof route !== "string" || !Object.hasOwn(BRIDGE_SERVICES, route))) throw error("Unsupported bridge route");
    if (sessions.size >= maxSessions || [...sessions.values()].filter(item => item.userId === String(userId)).length >= 5) throw error("Bridge session limit reached", 429);
    const session = { id: crypto.randomUUID(), userId: String(userId), routes: [...new Set(routes)], tokenHash: tokenHash(connectorToken), createdAt: now(), expiresAt: now() + ttlMs, connectedAt: 0, revoked: false, requests: new Map(), waiters: new Set(), rateAt: now(), rateCount: 0 };
    sessions.set(session.id, session);
    return metadata(session);
  }
  function heartbeat(id, token) {
    const session = connector(id, token);
    session.connectedAt = now();
    session.expiresAt = Math.min(now() + ttlMs, session.createdAt + maxLifetimeMs);
    return metadata(session);
  }
  function enqueue(id, userId, request = {}) {
    const session = owner(id, userId);
    serviceFor(request.route);
    if (!session.routes.includes(request.route)) throw error("Bridge route is not enabled", 403);
    const routePath = bridgePath(request.path);
    const method = String(request.method || "GET").toUpperCase();
    if (!METHODS.has(method)) throw error("Unsupported bridge method", 405);
    bodyBytes(request.body, BRIDGE_LIMITS.requestBytes);
    if (now() - session.rateAt >= 60_000) { session.rateAt = now(); session.rateCount = 0; }
    if (session.requests.size >= 32 || ++session.rateCount > 240) throw error("Bridge request limit reached", 429);
    const requestId = crypto.randomUUID();
    let resolve, reject;
    const result = new Promise((yes, no) => { resolve = yes; reject = no; });
    const item = { id: requestId, route: request.route, path: routePath, method, headers: safeHeaders(request.headers), body: String(request.body || ""), sent: false, resolve, reject };
    item.timer = setTimeout(() => { session.requests.delete(requestId); reject(error("Local bridge connector request timed out", 504)); }, requestTimeoutMs);
    session.requests.set(requestId, item);
    for (const wake of session.waiters) wake();
    return { id: requestId, result };
  }
  async function poll(id, token, waitMs = BRIDGE_LIMITS.pollMs) {
    const session = connector(id, token);
    if (session.waiters.size >= 1) throw error("A connector poll is already active", 429);
    const pending = () => [...session.requests.values()].filter(item => !item.sent);
    if (!pending().length && Number(waitMs) > 0) {
      await new Promise(resolve => {
        const wake = () => { clearTimeout(timer); session.waiters.delete(wake); resolve(); };
        const timer = setTimeout(wake, Math.max(1, Math.min(Number(waitMs) || BRIDGE_LIMITS.pollMs, BRIDGE_LIMITS.pollMs)));
        session.waiters.add(wake);
      });
    }
    connector(id, token);
    return pending().slice(0, 8).map(item => { item.sent = true; return { id: item.id, route: item.route, path: item.path, method: item.method, headers: item.headers, body: item.body }; });
  }
  function settle(id, token, requestId, response) {
    const session = connector(id, token);
    const item = session.requests.get(String(requestId));
    if (!item || !item.sent) throw error("Unknown bridge request", 404);
    const safeResponse = normalizeResponse(response);
    clearTimeout(item.timer);
    session.requests.delete(item.id);
    item.resolve(safeResponse);
    return { ok: true };
  }
  return { create, get: (id, userId) => metadata(owner(id, userId)), list: userId => { prune(); return [...sessions.values()].filter(item => item.userId === String(userId)).map(metadata); }, heartbeat, enqueue, poll, settle, revoke: (id, userId) => { const session = owner(id, userId); close(session); return metadata(session); }, revokeOwner: userId => { for (const session of sessions.values()) if (session.userId === String(userId)) close(session); }, close: () => { for (const session of sessions.values()) close(session); sessions.clear(); }, prune };
}

function proxyPrefix(sessionId, route) {
  serviceFor(route);
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(String(sessionId))) throw error("Invalid bridge session id");
  return `/bridge/sessions/${sessionId}/${route}/`;
}
function cookiePrefix(sessionId, route) { return `AFB_${String(sessionId).replace(/[^a-z0-9]/gi, "")}_${route}_`; }
export function bridgeRequestHeaders(headers, { sessionId, route } = {}) {
  proxyPrefix(sessionId, route);
  const output = safeHeaders(headers);
  const prefix = cookiePrefix(sessionId, route);
  const cookies = String(headers?.cookie || "").split(";").map(value => value.trim()).filter(value => value.startsWith(prefix)).map(value => value.slice(prefix.length)).filter(value => /^[^=;\s]+=[^\r\n;]*$/.test(value));
  if (cookies.length) output.cookie = cookies.join("; "); else delete output.cookie;
  return output;
}

/** Runs only on the Mac connector. Callers cannot supply a target URL or host. */
export async function relayLocalBridgeRequest(job, { ports = {}, timeoutMs = 20_000 } = {}) {
  const service = serviceFor(job?.route);
  const routePath = bridgePath(job?.path);
  const method = String(job?.method || "GET").toUpperCase();
  if (!METHODS.has(method)) throw error("Unsupported bridge method", 405);
  const body = bodyBytes(job?.body, BRIDGE_LIMITS.requestBytes);
  const localPort = Number(ports[job.route] || service.port);
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) throw error("Invalid fixed local service port");
  const headers = { ...safeHeaders(job.headers), host: `${service.host}:${localPort}`, "accept-encoding": "identity", "content-length": body.length };
  // Rebase origin checks onto the fixed local service without discarding CSRF tokens.
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) headers.origin = `http://${service.host}:${localPort}`;
  headers.referer = `http://${service.host}:${localPort}${routePath}`;
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: service.host, port: localPort, path: routePath, method, headers, timeout: Math.min(Math.max(Number(timeoutMs) || 20_000, 100), 23_000) }, response => {
      const chunks = []; let size = 0;
      response.on("data", chunk => { size += chunk.length; if (size > BRIDGE_LIMITS.responseBytes) response.destroy(error("Local bridge response exceeds its size limit", 413)); else chunks.push(chunk); });
      response.once("error", reject);
      response.once("end", () => resolve({ status: response.statusCode || 502, headers: safeHeaders(response.headers, true), body: Buffer.concat(chunks).toString("base64") }));
    });
    request.once("timeout", () => request.destroy(error("Local bridge service timed out", 504)));
    request.once("error", reject);
    request.end(body);
  });
}

function rewriteUrl(value, { sessionId, route, path: requestPath = "/" } = {}) {
  const prefix = proxyPrefix(sessionId, route);
  const raw = String(value || "");
  if (!raw || raw.startsWith(prefix) || raw.startsWith("#") || /^(?:data|mailto|tel|javascript|blob):/i.test(raw)) return raw;
  if (raw.startsWith("/") && !raw.startsWith("//")) return prefix + raw.slice(1);
  if (/^(?:https?:)?\/\//i.test(raw)) {
    let url; try { url = new URL(raw, "http://localhost"); } catch { return raw; }
    const service = serviceFor(route);
    if (!["127.0.0.1", "localhost", "[::1]", ...service.urlAliases].includes(url.hostname) || Number(url.port || (url.protocol === "https:" ? 443 : 80)) !== service.port) return raw;
    return prefix + url.pathname.slice(1) + url.search + url.hash;
  }
  try { const local = new URL(raw, `http://bridge.invalid${bridgePath(requestPath)}`); return prefix + local.pathname.slice(1) + local.search + local.hash; } catch { return raw; }
}

function browserBootstrap(options) {
  const prefix = proxyPrefix(options.sessionId, options.route);
  const service = serviceFor(options.route);
  const cookie = cookiePrefix(options.sessionId, options.route);
  // Jira and Confluence also construct root URLs at runtime. Keep those requests inside this session.
  return `(${bridgeBrowserAdapter.toString()})(${JSON.stringify(prefix)},${JSON.stringify(cookie)},${service.port},${JSON.stringify(service.urlAliases)});`;
}

function bridgeBrowserAdapter(prefix, cookiePrefix, port, urlAliases) {
  "use strict";
  function url(value) {
    try {
      const address = new URL(String(value), location.href);
      if ((address.origin === location.origin && !address.pathname.startsWith(prefix)) || (["127.0.0.1", "localhost", "[::1]", ...urlAliases].includes(address.hostname) && Number(address.port) === port)) {
        return location.origin + prefix + address.pathname.replace(/^[/]/, "") + address.search + address.hash;
      }
    } catch { /* Non-URL attribute values retain their original meaning. */ }
    return value;
  }
  const originalFetch = window.fetch;
  if (originalFetch) window.fetch = function (input, options) { return originalFetch.call(this, typeof input === "string" || input instanceof URL ? url(input) : new Request(url(input.url), input), options); };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, address, ...options) { return originalOpen.call(this, method, url(address), ...options); };
  function fix(node) {
    if (node.nodeType !== 1) return;
    ["href", "src", "action", "poster", "data"].forEach(attribute => { const value = node.getAttribute(attribute); if (value) node.setAttribute(attribute, url(value)); });
  }
  new MutationObserver(mutations => mutations.forEach(mutation => mutation.addedNodes.forEach(node => { fix(node); node.querySelectorAll?.("[href],[src],[action],[poster]").forEach(fix); }))).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("submit", event => fix(event.target), true);
  try {
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
    if (descriptor?.get && descriptor?.set) Object.defineProperty(document, "cookie", {
      get() { return descriptor.get.call(document).split(";").map(value => value.trim()).filter(value => value.startsWith(cookiePrefix)).map(value => value.slice(cookiePrefix.length)).join("; "); },
      set(value) { const parts = String(value).split(";"), first = parts.shift(); descriptor.set.call(document, cookiePrefix + first + "; Path=" + prefix + parts.filter(part => !/^[ ]*(path|domain)=/i.test(part)).map(part => ";" + part).join("")); }
    });
  } catch { /* HttpOnly session cookies remain managed by the browser. */ }
}

export function rewriteBridgeResponse(response, options = {}) {
  const output = normalizeResponse(response);
  const prefix = proxyPrefix(options.sessionId, options.route);
  const rewrite = value => rewriteUrl(value, options);
  if (output.headers.location) {
    const location = rewrite(output.headers.location);
    if (/^(?:https?:)?\/\//i.test(location)) throw error("Local service redirect leaves the bridge session", 502);
    output.headers.location = location;
  }
  if (output.headers["set-cookie"]) {
    output.headers["set-cookie"] = output.headers["set-cookie"].flatMap(value => {
      const parts = value.split(";"); const pair = parts.shift();
      if (!/^[^=;\s]+=[^\r\n]*$/.test(pair || "")) return [];
      const originalPath = parts.find(part => /^\s*path=/i.test(part))?.trim().slice(5) || "/";
      const path = originalPath.startsWith("/") && !originalPath.startsWith("//") ? prefix + originalPath.slice(1) : prefix;
      const attributes = parts.filter(part => !/^\s*(?:domain|path)=/i.test(part)).map(part => `;${part}`).join("");
      return [`${cookiePrefix(options.sessionId, options.route)}${pair}; Path=${path}${attributes}`];
    });
  }
  delete output.headers["content-length"];
  delete output.headers["content-security-policy-report-only"];
  delete output.headers["report-to"];
  delete output.headers["nel"];
  const type = String(output.headers["content-type"] || "").toLowerCase();
  if (/text\/html|text\/css|(?:application|text)\/(?:x-)?javascript|application\/json/.test(type) && !output.headers["content-encoding"]) {
    let text = Buffer.from(output.body, "base64").toString("utf8");
    const service = serviceFor(options.route);
    const hosts = ["127.0.0.1", "localhost", "[::1]", ...service.urlAliases].map(host => host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const local = new RegExp(`https?:\\/\\/(?:${hosts}):${service.port}(?=[/\"'\\s]|$)`, "g");
    text = text.replace(local, prefix.slice(0, -1));
    text = text.replace(/(\b(?:href|src|action|poster|data|content)\s*=\s*)(["'])(\/(?!\/)[^"']*)\2/gi, (_, lead, quote, value) => `${lead}${quote}${rewrite(value)}${quote}`);
    text = text.replace(/url\(\s*(["']?)(\/(?!\/)[^)'"\s]*)\1\s*\)/gi, (_, quote, value) => `url(${quote}${rewrite(value)}${quote})`);
    text = text.replace(/(["'`])(\/(?!\/)[^"'`\r\n]*)\1/g, (_, quote, value) => `${quote}${rewrite(value)}${quote}`);
    if (/text\/html/.test(type)) {
      const nonce = crypto.randomBytes(16).toString("base64");
      const bootstrap = `<script nonce="${nonce}">${browserBootstrap(options)}</script>`;
      text = /<head(?:\s[^>]*)?>/i.test(text) ? text.replace(/<head(?:\s[^>]*)?>/i, value => value + bootstrap) : bootstrap + text;
      if (output.headers["content-security-policy"]) output.headers["content-security-policy"] = output.headers["content-security-policy"].replace(/script-src([^;]*)/gi, (_, sources) => `script-src${sources} 'nonce-${nonce}'`);
    }
    output.body = Buffer.from(text).toString("base64");
    if (Buffer.from(output.body, "base64").length > BRIDGE_LIMITS.responseBytes) throw error("Rewritten bridge response exceeds its size limit", 413);
    delete output.headers.etag;
  }
  output.headers["cache-control"] = "private, no-store";
  output.headers["x-content-type-options"] = "nosniff";
  output.headers["referrer-policy"] = "same-origin";
  return output;
}

export function normalizeBridgeRemoteOrigin(value) {
  let url; try { url = new URL(String(value)); } catch { throw error("Invalid public bridge origin"); }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || (!loopback && /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname))) throw error("Bridge origin requires public HTTPS or local loopback HTTP");
  return url.origin;
}

/** The connector initiates every network request; remote relay cannot dial a private host. */
export function createOutboundBridgeConnector({ remoteOrigin, sessionId, connectorToken, fetchImpl = globalThis.fetch, relay = relayLocalBridgeRequest, onStatus = () => {} } = {}) {
  const origin = normalizeBridgeRemoteOrigin(remoteOrigin);
  proxyPrefix(sessionId, "jira");
  if (!tokenValid(connectorToken)) throw error("Invalid bridge connector token");
  let running = false, controller = null, task = null, state = "stopped", lastError = "", lastConnectedAt = "";
  const status = () => ({ sessionId, remoteOrigin: origin, status: state, running, lastConnectedAt, error: lastError });
  const setStatus = value => { state = value; try { onStatus(status()); } catch { /* Status observers do not own transport. */ } };
  async function call(path, body, signal) {
    const response = await fetchImpl(`${origin}/api/bridge/sessions/${encodeURIComponent(sessionId)}/connector/${path}`, { method: "POST", headers: { "content-type": "application/json", "x-auditflow-bridge-token": connectorToken }, body: JSON.stringify(body || {}), credentials: "omit", redirect: "error", signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw error(payload.error || "Bridge relay is unavailable", response.status);
    return payload;
  }
  async function run() {
    let failures = 0;
    while (running) {
      controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45_000);
      try {
        await call("heartbeat", {}, controller.signal);
        lastConnectedAt = new Date().toISOString(); lastError = ""; failures = 0; setStatus("connected");
        const payload = await call("poll", { waitMs: BRIDGE_LIMITS.pollMs }, controller.signal);
        await Promise.all((payload.requests || []).slice(0, 8).map(async job => {
          let result;
          try { result = await relay(job); } catch { result = { status: 502, headers: { "content-type": "text/plain; charset=utf-8" }, body: Buffer.from("The selected Mac-local service is unavailable. Start Jira on port 8080 or Confluence on port 8090.").toString("base64") }; }
          await call("result", { requestId: job.id, response: result }, controller.signal);
        }));
      } catch (cause) {
        if (!running) break;
        lastError = [401, 403, 410].includes(cause.status) ? "Bridge session expired or authorization was revoked" : "Public relay is unavailable";
        setStatus("disconnected");
        if ([401, 403, 410].includes(cause.status) || ++failures >= 5) { running = false; break; }
        await new Promise(resolve => { const retry = setTimeout(resolve, Math.min(500 * 2 ** failures, 8000)); controller.signal.addEventListener("abort", () => { clearTimeout(retry); resolve(); }, { once: true }); });
      } finally { clearTimeout(timer); }
    }
    setStatus("stopped");
  }
  return { status, start: () => { if (!running) { running = true; setStatus("connecting"); task = run(); } return status(); }, stop: async () => { running = false; controller?.abort(); await task; return status(); } };
}
