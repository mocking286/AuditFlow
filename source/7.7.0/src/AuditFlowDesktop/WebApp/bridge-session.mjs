import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { isAllowedJiraRestRequest } from "./jira-rest-channel.mjs";

export const BRIDGE_SERVICES = Object.freeze({
  jira: Object.freeze({ label: "Jira", host: "127.0.0.1", port: 8080, urlAliases: Object.freeze(["192.168.8.31", "192.168.8.42"]) }),
  confluence: Object.freeze({ label: "Confluence", host: "127.0.0.1", port: 8090, urlAliases: Object.freeze(["192.168.8.42"]) }),
  jiraflow: Object.freeze({ label: "JiraFlow", host: "127.0.0.1", port: 47585, urlAliases: Object.freeze([]), basePath: "/" }),
  "jira-api": Object.freeze({ label: "Jira REST API", host: "127.0.0.1", port: 8080, urlAliases: Object.freeze([]), basePath: "/" }),
  polarion: Object.freeze({ label: "Polarion", host: "127.0.0.1", port: 80, urlAliases: Object.freeze([]), basePath: "/polarion/" })
});
export const BRIDGE_LIMITS = Object.freeze({ requestBytes: 2 * 1024 * 1024, responseBytes: 8 * 1024 * 1024, requestTimeoutMs: 25_000, pollMs: 15_000 });
export function isAllowedJiraFlowBridgeRequest(routePath, method) {
  const pathname = String(routePath).split("?")[0];
  const key = "[A-Za-z][A-Za-z0-9_-]{0,63}";
  const rules = method === "GET" ? [
    /^\/health$/,
    /^\/api\/integrations\/auditflow\/projects$/,
    /^\/api\/projects$/,
    /^\/api\/search$/,
    new RegExp(`^/api/issues/${key}-\\d{1,12}$`),
    new RegExp(`^/api/projects/${key}/workflow$`),
    new RegExp(`^/api/integrations/auditflow/projects/${key}/events$`)
  ] : method === "POST" ? [
    /^\/api\/integrations\/auditflow\/projects\/ensure$/,
    /^\/api\/integrations\/auditflow\/issues\/upsert$/,
    /^\/api\/integrations\/auditflow\/transitions$/
  ] : method === "PUT" ? [
    new RegExp(`^/api/projects/${key}/auditflow-mapping$`)
  ] : [];
  return rules.some(rule => rule.test(pathname));
}
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const tokenHash = token => crypto.createHash("sha256").update(String(token || "")).digest();
const tokenValid = token => typeof token === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(token);
function serviceFor(route) {
  if (!Object.hasOwn(BRIDGE_SERVICES, String(route))) throw error("Unsupported bridge route");
  return BRIDGE_SERVICES[route];
}
export function normalizeTrustedLocalHost(value, fallback = "") {
  const host = String(value || fallback).trim().toLowerCase();
  if (!host || host.includes("/") || host.includes("@") || /[\s?#]/.test(host)) throw error("Invalid fixed local service host");
  const version = net.isIP(host);
  if (!version) throw error("Local bridge target must be a fixed loopback or private IP address");
  const octets = host.split(".").map(Number);
  const loopback = version === 4 && octets[0] === 127 || version === 6 && host === "::1";
  const privateV4 = version === 4 && (octets[0] === 10 || octets[0] === 192 && octets[1] === 168 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
  const privateV6 = version === 6 && (/^(?:fc|fd)/.test(host) || /^fe[89ab]/.test(host));
  if (!loopback && !privateV4 && !privateV6) throw error("Local bridge target must use a loopback or private IP address");
  return host;
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
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  // A repeated four-character regex group overflows V8's stack on large GWT bundles.
  if (text.length > Math.ceil(limit / 3) * 4 || text.length % 4 !== 0 ||
      /[^A-Za-z0-9+/]/.test(padding ? text.slice(0, -padding) : text)) throw error("Bridge body exceeds its size limit or is invalid", 413);
  const bytes = Buffer.from(text, "base64");
  if (bytes.length > limit) throw error("Bridge body exceeds its size limit", 413);
  return bytes;
}
function splitSetCookieHeader(value) {
  const cookies = [];
  let start = 0, quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    if (quoted && value[index] === "\\") { index += 1; continue; }
    if (value[index] === '"') quoted = !quoted;
    // Foundation can coalesce Set-Cookie; Expires dates and quoted values also contain commas.
    if (!quoted && value[index] === "," && /^[ \t]*[!#$%&'*+.^_`|~0-9A-Za-z-]+=/.test(value.slice(index + 1))) {
      cookies.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  cookies.push(value.slice(start).trim());
  return cookies.filter(Boolean);
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
    if (cleaned.length) output[name] = name === "set-cookie" ? cleaned.flatMap(splitSetCookieHeader).slice(0, 30) : cleaned[0];
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
    if (!Array.isArray(routes) || !routes.length || routes.length > 5 || routes.some(route => typeof route !== "string" || !Object.hasOwn(BRIDGE_SERVICES, route))) throw error("Unsupported bridge route");
    if (sessions.size >= maxSessions || [...sessions.values()].filter(item => item.userId === String(userId)).length >= 5) throw error("Bridge session limit reached", 429);
    const session = { id: crypto.randomUUID(), userId: String(userId), routes: [...new Set(routes)], tokenHash: tokenHash(connectorToken), createdAt: now(), expiresAt: now() + ttlMs, connectedAt: 0, revoked: false, requests: new Map(), waiters: new Set(), rateAt: now(), rateCount: 0, assetRateCount: 0 };
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
    // Enterprise pages load many independent scripts/fonts before their first API call.
    // Only bodyless browser assets receive the larger, still bounded read budget.
    const browserAsset = ["jira", "confluence", "polarion"].includes(request.route)
      && ["GET", "HEAD"].includes(method) && !request.body
      && /\.(?:js|css|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|otf|eot)$/i.test(routePath.split("?")[0]);
    if (now() - session.rateAt >= 60_000) { session.rateAt = now(); session.rateCount = 0; session.assetRateCount = 0; }
    if (session.requests.size >= 128 ||
        (!browserAsset && [...session.requests.values()].filter(item => !item.browserAsset).length >= 32) ||
        (browserAsset ? ++session.assetRateCount > 1200 : ++session.rateCount > 240)) throw error("Bridge request limit reached", 429);
    const requestId = crypto.randomUUID();
    let resolve, reject;
    const result = new Promise((yes, no) => { resolve = yes; reject = no; });
    const item = { id: requestId, route: request.route, path: routePath, method, headers: safeHeaders(request.headers), body: String(request.body || ""), browserAsset, sent: false, resolve, reject };
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
  return {
    create,
    get: (id, userId) => metadata(owner(id, userId)),
    list: userId => { prune(); return [...sessions.values()].filter(item => item.userId === String(userId)).map(metadata); },
    connectedForUser: (userId, route) => {
      prune();
      const session = [...sessions.values()].reverse().find(item => item.userId === String(userId)
        && item.routes.includes(String(route)) && item.connectedAt && now() < item.expiresAt);
      return session ? metadata(session) : null;
    },
    heartbeat,
    enqueue,
    poll,
    settle,
    revoke: (id, userId) => { const session = owner(id, userId); close(session); return metadata(session); },
    revokeOwner: userId => { for (const session of sessions.values()) if (session.userId === String(userId)) close(session); },
    close: () => { for (const session of sessions.values()) close(session); sessions.clear(); },
    prune
  };
}

function proxyPrefix(sessionId, route) {
  serviceFor(route);
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(String(sessionId))) throw error("Invalid bridge session id");
  return `/bridge/sessions/${sessionId}/${route}/`;
}
function cookiePrefix(sessionId, route) { return `AFB_${String(sessionId).replace(/[^a-z0-9]/gi, "")}_${route}_`; }
function nativeGwtModuleBase(value, { sessionId, route, publicOrigin } = {}) {
  if (route !== "polarion" || !publicOrigin) return value;
  try {
    const address = new URL(value);
    const prefix = proxyPrefix(sessionId, route);
    if (address.origin !== normalizeBridgeRemoteOrigin(publicOrigin) ||
        !address.pathname.startsWith(`${prefix}gwt/`) || address.search || address.hash ||
        address.username || address.password) return value;
    address.pathname = "/polarion/" + address.pathname.slice(prefix.length);
    return address.href;
  } catch { return value; }
}

export function bridgeRequestBody(body, options = {}) {
  if (options.route !== "polarion" || !/^text\/x-gwt-rpc(?:;|$)/i.test(options.headers?.["content-type"] || "")) return body;
  const text = body.toString("utf8");
  const metadata = /^7\|\d{1,3}\|\d{1,7}\|([^|]{1,8192})\|/.exec(text);
  if (!metadata) return body;
  const moduleBase = metadata[1];
  const restored = nativeGwtModuleBase(moduleBase, options);
  if (restored === moduleBase) return body;
  const start = metadata[0].length - moduleBase.length - 1;
  return Buffer.from(text.slice(0, start) + restored + text.slice(start + moduleBase.length));
}

export function bridgeRequestHeaders(headers, { sessionId, route, publicOrigin } = {}) {
  proxyPrefix(sessionId, route);
  const output = safeHeaders(headers);
  if (output["x-gwt-module-base"]) output["x-gwt-module-base"] = nativeGwtModuleBase(output["x-gwt-module-base"], { sessionId, route, publicOrigin });
  const prefix = cookiePrefix(sessionId, route);
  const cookies = String(headers?.cookie || "").split(";").map(value => value.trim()).filter(value => value.startsWith(prefix)).map(value => value.slice(prefix.length)).filter(value => /^[^=;\s]+=[^\r\n;]*$/.test(value));
  if (cookies.length) output.cookie = cookies.join("; "); else delete output.cookie;
  return output;
}

/** Runs only on the Mac connector. Callers cannot supply a target URL or host. */
export async function relayLocalBridgeRequest(job, { ports = {}, hosts = {}, localTargets = {}, timeoutMs = 20_000, publicOrigin } = {}) {
  const service = serviceFor(job?.route);
  const routePath = bridgePath(job?.path);
  const method = String(job?.method || "GET").toUpperCase();
  if (!METHODS.has(method)) throw error("Unsupported bridge method", 405);
  const body = bodyBytes(job?.body, BRIDGE_LIMITS.requestBytes);
  if (job.route === "jira-api") {
    if (!isAllowedJiraRestRequest(routePath, method)) throw error("Jira REST connector route is not allowed", 403);
    const client = localTargets["jira-api"];
    if (!client?.configured || typeof client.request !== "function") throw error("Configure local Jira REST credentials in the launcher", 503);
    let payload;
    try { payload = body.length ? JSON.parse(body.toString("utf8")) : undefined; }
    catch { throw error("Invalid Jira REST request body"); }
    const result = await client.request(routePath, { method, body: payload });
    const response = Buffer.from(JSON.stringify(result));
    if (response.length > BRIDGE_LIMITS.responseBytes) throw error("Jira REST response exceeds its size limit", 413);
    return { status: 200, headers: { "content-type": "application/json" }, body: response.toString("base64") };
  }
  const configuredTarget = job.route === "polarion" ? localTargets.polarion || {} : {};
  const jiraFlowTarget = job.route === "jiraflow" ? localTargets.jiraflow || {} : {};
  const localPort = Number(configuredTarget.port || jiraFlowTarget.port || ports[job.route] || service.port);
  const localHost = job.route === "polarion"
    ? normalizeTrustedLocalHost(configuredTarget.host || hosts[job.route], service.host)
    : job.route === "jiraflow"
      ? normalizeTrustedLocalHost(jiraFlowTarget.host || hosts[job.route], service.host)
    : service.host;
  const protocol = String(configuredTarget.protocol || "http:");
  if (protocol !== "http:" && protocol !== "https:") throw error("Polarion bridge target must use HTTP or HTTPS");
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) throw error("Invalid fixed local service port");
  if (job.route === "jiraflow") {
    if (!["127.0.0.1", "::1"].includes(localHost)) throw error("JiraFlow connector target must use loopback");
    if (!isAllowedJiraFlowBridgeRequest(routePath, method)) {
      throw error("JiraFlow connector route is not allowed");
    }
    const token = String(jiraFlowTarget.token || "");
    const actor = String(jiraFlowTarget.actor || "");
    if (!/^[A-Za-z0-9._:-]{24,255}$/.test(token) || !/^[A-Za-z0-9._@-]{1,191}$/.test(actor)) {
      throw error("JiraFlow local connector credentials are unavailable", 503);
    }
  }
  const targetUrl = configuredTarget.baseUrl ? new URL(String(configuredTarget.baseUrl)) : null;
  if (targetUrl && (targetUrl.protocol !== protocol || targetUrl.username || targetUrl.password ||
      targetUrl.search || targetUrl.hash || normalizeTrustedLocalHost(targetUrl.hostname) !== localHost ||
      Number(targetUrl.port || (protocol === "https:" ? 443 : 80)) !== localPort || targetUrl.pathname !== service.basePath)) {
    throw error("Polarion base URL must match its fixed local HTTP(S) target");
  }
  const routePrefix = targetUrl ? targetUrl.pathname : String(service.basePath || "/");
  const servicePath = routePrefix === "/" ? routePath : routePrefix.replace(/\/$/, "") + routePath;
  const upstreamOrigin = new URL(`${protocol}//${localHost}:${localPort}`);
  const authority = publicOrigin ? new URL(normalizeBridgeRemoteOrigin(publicOrigin)) : upstreamOrigin;
  const headers = { ...safeHeaders(job.headers), host: job.route === "polarion" ? upstreamOrigin.host : authority.host, "accept-encoding": "identity", "content-length": body.length };
  if (job.route === "jiraflow") {
    headers.authorization = `Bearer ${jiraFlowTarget.token}`;
    headers["x-jiraflow-user"] = jiraFlowTarget.actor;
    headers.host = upstreamOrigin.host;
  }
  const transport = protocol === "https:" ? https : http;
  // Network targets stay fixed by the local launcher; browser headers cannot choose the destination.
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) headers.origin = authority.origin;
  headers.referer = `${authority.origin}${servicePath}`;
  return new Promise((resolve, reject) => {
    const request = transport.request({ protocol, hostname: localHost, port: localPort, path: servicePath, method, headers, timeout: Math.min(Math.max(Number(timeoutMs) || 20_000, 100), 23_000) }, response => {
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

function rewriteServiceUrl(value, { sessionId, route, path: requestPath = "/", publicOrigin } = {}) {
  const prefix = proxyPrefix(sessionId, route);
  const raw = String(value || "");
  if (!raw || raw === prefix.slice(0, -1) || raw.startsWith(prefix) || raw.startsWith("#") || /^(?:data|mailto|tel|javascript|blob):/i.test(raw)) return raw;
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    const basePath = String(serviceFor(route).basePath || "/").replace(/\/$/, "");
    return prefix + (basePath && raw.startsWith(`${basePath}/`) ? raw.slice(basePath.length + 1) : raw.slice(1));
  }
  if (/^(?:https?:)?\/\//i.test(raw)) {
    let url; try { url = new URL(raw, "http://localhost"); } catch { return raw; }
    const service = serviceFor(route);
    if (publicOrigin && url.origin === normalizeBridgeRemoteOrigin(publicOrigin)) return rewriteServiceUrl(url.pathname + url.search + url.hash, { sessionId, route, path: requestPath });
    const privateHost = route === "polarion" && (() => {
      const version = net.isIP(url.hostname);
      const parts = url.hostname.split(".").map(Number);
      return version === 4 && (parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
        || version === 6 && (/^(?:fc|fd|fe[89ab])/i.test(url.hostname));
    })();
    if (!["127.0.0.1", "localhost", "[::1]", ...service.urlAliases].includes(url.hostname) && !privateHost) return raw;
    if (route !== "polarion" && Number(url.port || (url.protocol === "https:" ? 443 : 80)) !== service.port) return raw;
    const basePath = String(service.basePath || "/").replace(/\/$/, "");
    if (route === "polarion" && !(url.pathname === basePath || url.pathname.startsWith(`${basePath}/`))) return raw;
    const serviceRelativePath = url.pathname === basePath ? "" : basePath && url.pathname.startsWith(`${basePath}/`) ? url.pathname.slice(basePath.length + 1) : url.pathname.slice(1);
    return prefix + serviceRelativePath + url.search + url.hash;
  }
  try { const local = new URL(raw, `http://bridge.invalid${bridgePath(requestPath)}`); return prefix + local.pathname.slice(1) + local.search + local.hash; } catch { return raw; }
}

function rewriteUrl(value, options) {
  const rewritten = rewriteServiceUrl(value, options);
  if (options.route !== "jira" || !rewritten.startsWith("/")) return rewritten;
  const address = new URL(rewritten, "http://bridge.invalid");
  const destination = address.searchParams.get("os_destination");
  if (!destination) return rewritten;
  const prefix = proxyPrefix(options.sessionId, options.route);
  const local = rewriteServiceUrl(destination, options);
  // Jira's native login UI prepends its context path after authentication.
  // Leave only a fixed-service path here, including for encoded base URLs.
  address.searchParams.set("os_destination", local.startsWith(prefix) ? `/${local.slice(prefix.length)}` : "/default.jsp");
  return address.pathname + address.search + address.hash;
}

function browserBootstrap(options) {
  const prefix = proxyPrefix(options.sessionId, options.route);
  const service = serviceFor(options.route);
  const cookie = cookiePrefix(options.sessionId, options.route);
  // Jira and Confluence also construct root URLs at runtime. Keep those requests inside this session.
  return `(${bridgeBrowserAdapter.toString()})(${JSON.stringify(prefix)},${JSON.stringify(cookie)},${service.port},${JSON.stringify(service.urlAliases)},${JSON.stringify(service.basePath || "/")},${JSON.stringify(options.route)});`;
}

function bridgeBrowserAdapter(prefix, cookiePrefix, port, urlAliases, basePath, route) {
  "use strict";
  function url(value) {
    try {
      const address = new URL(String(value), location.href);
      const host = address.hostname.replace(/^\[|\]$/g, "");
      const parts = host.split(".").map(Number);
      const privatePolarionHost = route === "polarion" && (
        parts.length === 4 && (parts[0] === 10 || parts[0] === 192 && parts[1] === 168 ||
          parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        /^(?:fc|fd|fe[89ab])/i.test(host)
      );
      const polarionContext = address.pathname === "/polarion" || address.pathname.startsWith("/polarion/");
      const polarionLoopbackHost = route === "polarion" && ["127.0.0.1", "localhost", "::1"].includes(host);
      if ((address.origin === location.origin && !address.pathname.startsWith(prefix)) ||
          ((privatePolarionHost || polarionLoopbackHost) && polarionContext) ||
          (["127.0.0.1", "localhost", "[::1]", ...urlAliases].includes(address.hostname) && Number(address.port || (address.protocol === "https:" ? 443 : 80)) === port)) {
        const basePathWithoutTrailingSlash = basePath.replace(/\/$/, "");
        const relativePath = address.pathname === basePathWithoutTrailingSlash ? "" : basePath !== "/" && address.pathname.startsWith(basePath) ? address.pathname.slice(basePath.length) : address.pathname.replace(/^[/]/, "");
        return location.origin + prefix + relativePath + address.search + address.hash;
      }
    } catch { /* Non-URL attribute values retain their original meaning. */ }
    return value;
  }
  const originalFetch = window.fetch;
  if (originalFetch) window.fetch = function (input, options) { return originalFetch.call(this, typeof input === "string" || input instanceof URL ? url(input) : new Request(url(input.url), input), options); };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, address, ...options) { return originalOpen.call(this, method, url(address), ...options); };
  for (const [type, attribute] of [["HTMLImageElement", "src"], ["HTMLScriptElement", "src"], ["HTMLLinkElement", "href"]]) {
    const prototype = window[type]?.prototype;
    const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, attribute);
    if (descriptor?.get && descriptor?.set && descriptor.configurable) Object.defineProperty(prototype, attribute, {
      ...descriptor,
      set(value) { descriptor.set.call(this, url(value)); }
    });
  }
  for (const method of ["pushState", "replaceState"]) {
    const original = window.history?.[method];
    if (original) window.history[method] = function (...args) {
      if (args.length > 2 && args[2] != null && args[2] !== "") args[2] = url(args[2]);
      return original.apply(this, args);
    };
  }
  function fix(node) {
    if (node.nodeType !== 1) return;
    ["href", "src", "action", "poster", "data"].forEach(attribute => {
      const value = node.getAttribute(attribute);
      if (value) { const rewritten = url(value); if (rewritten !== value) node.setAttribute(attribute, rewritten); }
    });
  }
  new MutationObserver(mutations => mutations.forEach(mutation => {
    if (mutation.type === "attributes") fix(mutation.target);
    else mutation.addedNodes.forEach(node => { fix(node); node.querySelectorAll?.("[href],[src],[action],[poster],[data]").forEach(fix); });
  })).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href", "src", "action", "poster", "data"] });
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
    const serviceBasePath = String(serviceFor(options.route).basePath || "/").replace(/\/$/, "");
    output.headers["set-cookie"] = output.headers["set-cookie"].flatMap(value => {
      const parts = value.split(";"); const pair = parts.shift();
      if (!/^[^=;\s]+=[^\r\n]*$/.test(pair || "")) return [];
      const originalPath = parts.find(part => /^\s*path=/i.test(part))?.trim().slice(5) || "/";
      let relativePath = originalPath.startsWith("/") && !originalPath.startsWith("//") ? originalPath.slice(1) : "";
      if (serviceBasePath && (originalPath === serviceBasePath || originalPath.startsWith(`${serviceBasePath}/`))) {
        relativePath = originalPath.slice(serviceBasePath.length).replace(/^\/+/, "");
      }
      const path = prefix + relativePath;
      const attributes = parts.filter(part => !/^\s*(?:domain|path)=/i.test(part)).map(part => `;${part}`).join("");
      return [`${cookiePrefix(options.sessionId, options.route)}${pair}; Path=${path}${attributes}`];
    });
  }
  delete output.headers["content-length"];
  delete output.headers["content-security-policy-report-only"];
  delete output.headers["report-to"];
  delete output.headers["nel"];
  const type = String(output.headers["content-type"] || "").toLowerCase();
  if (/text\/html|text\/css/.test(type) && !output.headers["content-encoding"]) {
    let text = Buffer.from(output.body, "base64").toString("utf8");
    // Keep executable code opaque except for Jira's named context metadata.
    // WRM uses this value before lazy scripts can be observed in the DOM.
    const scripts = [];
    if (/text\/html/.test(type)) text = text.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (_, open, code, close) => {
      if (options.route === "jira") {
        const context = prefix.slice(0, -1);
        code = code.replace(/(^[ \t]*window\.contextPath\s*=\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gm, (_, lead) => lead + JSON.stringify(context));
        code = code.replace(/(^[ \t]*WRM\._unparsedData\[(["'])com\.atlassian\.plugins\.atlassian-plugins-webresource-plugin:context-path\.context-path\2\]\s*=\s*)"(?:\\.|[^"\\])*"/gm, (_, lead) => lead + JSON.stringify(JSON.stringify(context)));
      }
      scripts.push(code);
      return `${open}AUDITFLOW_SCRIPT_${scripts.length - 1}_BODY${close}`;
    });
    const service = serviceFor(options.route);
    const hosts = ["127.0.0.1", "localhost", "[::1]", ...service.urlAliases].map(host => host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const local = service.port === 80
      ? new RegExp(`https?:\\/\\/(?:${hosts})(?::\\d+)?(?=[/\"'\\s]|$)`, "g")
      : new RegExp(`https?:\\/\\/(?:${hosts}):${service.port}(?=[/\"'\\s]|$)`, "g");
    text = text.replace(local, prefix.slice(0, -1));
    if (options.route === "polarion") {
      const localPolarion = /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?\/polarion(?=[/'"#?\s])/gi;
      text = text.replace(localPolarion, prefix.slice(0, -1));
    }
    if (service.basePath && service.basePath !== "/") {
      const base = service.basePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      text = text.replace(new RegExp(`${prefix.slice(0, -1)}${base}(?=[/\"'\\s]|$)`, "g"), prefix.slice(0, -1));
    }
    text = text.replace(/(\b(?:href|src|action|poster|data|content)\s*=\s*)(["'])(\/(?!\/)[^"']*)\2/gi, (_, lead, quote, value) => `${lead}${quote}${rewrite(value)}${quote}`);
    text = text.replace(/url\(\s*(["']?)(\/(?!\/)[^)'"\s]*)\1\s*\)/gi, (_, quote, value) => `url(${quote}${rewrite(value)}${quote})`);
    if (/text\/html/.test(type)) {
      text = text.replace(/AUDITFLOW_SCRIPT_(\d+)_BODY/g, (_, index) => scripts[Number(index)]);
      text = text.replace(/(<meta\b(?=[^>]*\bname=["']ajs-context-path["'])[^>]*\bcontent=)(["'])[^"']*\2/gi, (_, lead, quote) => `${lead}${quote}${prefix.slice(0, -1)}${quote}`);
      if (options.publicOrigin) {
        const base = normalizeBridgeRemoteOrigin(options.publicOrigin) + prefix.slice(0, -1);
        text = text.replace(/(<meta\b(?=[^>]*\bname=["']ajs-(?:jira-)?base-url["'])[^>]*\bcontent=)(["'])[^"']*\2/gi, (_, lead, quote) => `${lead}${quote}${base}${quote}`);
      }
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
export function createOutboundBridgeConnector({ remoteOrigin, sessionId, connectorToken, routes = ["jira", "confluence"], fetchImpl = globalThis.fetch, relay = relayLocalBridgeRequest, localTargets = {}, onStatus = () => {} } = {}) {
  const origin = normalizeBridgeRemoteOrigin(remoteOrigin);
  proxyPrefix(sessionId, "jira");
  if (!tokenValid(connectorToken)) throw error("Invalid bridge connector token");
  if (!Array.isArray(routes) || !routes.length || routes.some(route => !Object.hasOwn(BRIDGE_SERVICES, route))) throw error("Invalid connector routes");
  const allowedRoutes = new Set(routes);
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
          try {
            if (!allowedRoutes.has(job.route)) throw error("This local connector does not allow the requested service route", 403);
            result = await relay(job, { publicOrigin: origin, localTargets, ...localTargets });
          } catch (cause) {
            const statusCode = cause.status === 403 ? 403 : 502;
            result = { status: statusCode, headers: { "content-type": "text/plain; charset=utf-8" }, body: Buffer.from(statusCode === 403 ? "This local connector does not allow the requested service route." : "The selected local service is unavailable. Verify that the configured service is running and reachable from the connector.").toString("base64") };
          }
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
