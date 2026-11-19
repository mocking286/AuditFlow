import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

const MAX_PENDING = 1000;
const STATE_TTL_MS = 5 * 60 * 1000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function secureUrl(value, label) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error(`${label} must be an absolute URL`); }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.hash) {
    throw new Error(`${label} must use HTTPS (loopback HTTP is allowed for local development)`);
  }
  return url;
}

export function microsoftOidcConfig(env = process.env) {
  const tenantId = String(env.AUDITFLOW_SSO_ENTRA_TENANT_ID || "").trim().toLowerCase();
  const clientId = String(env.AUDITFLOW_SSO_ENTRA_CLIENT_ID || "").trim();
  const clientSecret = String(env.AUDITFLOW_SSO_ENTRA_CLIENT_SECRET || "");
  const redirectUri = String(env.AUDITFLOW_SSO_ENTRA_REDIRECT_URI || "").trim();
  if (!tenantId || !clientId || !clientSecret || !redirectUri) return null;
  if (!uuidPattern.test(tenantId)) throw new Error("AUDITFLOW_SSO_ENTRA_TENANT_ID must be a Microsoft Entra tenant UUID");
  if (clientId.length > 200 || clientSecret.length > 4000) throw new Error("Microsoft Entra client configuration is invalid");
  secureUrl(redirectUri, "AUDITFLOW_SSO_ENTRA_REDIRECT_URI");
  let userMap;
  try { userMap = JSON.parse(String(env.AUDITFLOW_SSO_ENTRA_USER_MAP || "{}")); } catch { throw new Error("AUDITFLOW_SSO_ENTRA_USER_MAP must be valid JSON"); }
  if (!userMap || typeof userMap !== "object" || Array.isArray(userMap)) throw new Error("AUDITFLOW_SSO_ENTRA_USER_MAP must be an object");
  const mappedUsers = Object.fromEntries(Object.entries(userMap).map(([objectId, userId]) => {
    if (!uuidPattern.test(objectId) || !String(userId || "").trim()) throw new Error("Microsoft Entra user mapping contains an invalid object ID or AuditFlow account ID");
    return [objectId.toLowerCase(), String(userId).trim()];
  }));
  if (!Object.keys(mappedUsers).length) throw new Error("At least one Microsoft Entra user mapping is required");
  return { tenantId, clientId, clientSecret, redirectUri, userMap: mappedUsers };
}

export function createMicrosoftOidc({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), accountById } = {}) {
  const config = microsoftOidcConfig(env);
  const pending = new Map();
  let discoveryCache = null;
  let jwksCache = null;
  const enabled = Boolean(config);

  async function discovery() {
    if (discoveryCache && discoveryCache.expiresAt > now()) return discoveryCache.value;
    const issuer = `https://login.microsoftonline.com/${config.tenantId}/v2.0`;
    let response;
    try {
      response = await fetchImpl(`${issuer}/.well-known/openid-configuration`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5000),
        redirect: "error"
      });
    } catch {
      throw Object.assign(new Error("Microsoft sign-in is temporarily unavailable"), { status: 503, code: "sso-provider-unavailable" });
    }
    const value = await response.json().catch(() => null);
    if (!response.ok || value?.issuer !== issuer || !Array.isArray(value?.response_types_supported) || !value.response_types_supported.includes("code")) {
      throw Object.assign(new Error("Microsoft sign-in configuration could not be verified"), { status: 503, code: "sso-provider-invalid" });
    }
    for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) {
      const url = secureUrl(value[key], `Microsoft ${key}`);
      if (url.hostname !== "login.microsoftonline.com") throw Object.assign(new Error("Microsoft sign-in endpoint is not trusted"), { status: 503, code: "sso-provider-invalid" });
    }
    discoveryCache = { value, expiresAt: now() + 60 * 60 * 1000 };
    return value;
  }

  async function start() {
    if (!config) throw Object.assign(new Error("Microsoft single sign-on is not configured"), { status: 503, code: "sso-not-configured" });
    const provider = await discovery();
    const createdAt = now();
    for (const [key, value] of pending) if (value.expiresAt <= createdAt) pending.delete(key);
    if (pending.size >= MAX_PENDING) throw Object.assign(new Error("Too many pending Microsoft sign-in requests"), { status: 429, code: "sso-rate-limited" });
    const state = crypto.randomBytes(32).toString("base64url");
    const nonce = crypto.randomBytes(32).toString("base64url");
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    pending.set(state, { nonce, verifier, expiresAt: createdAt + STATE_TTL_MS });
    const target = new URL(provider.authorization_endpoint);
    for (const [key, value] of Object.entries({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: config.redirectUri,
      response_mode: "query",
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256"
    })) target.searchParams.set(key, value);
    return { url: target.toString(), state };
  }

  async function callback({ code, state, stateCookie }) {
    if (!config) throw Object.assign(new Error("Microsoft single sign-on is not configured"), { status: 503, code: "sso-not-configured" });
    const stateValue = String(state || "");
    const cookieValue = String(stateCookie || "");
    if (!stateValue || stateValue !== cookieValue || stateValue.length > 128) {
      throw Object.assign(new Error("Microsoft sign-in state did not match this browser session"), { status: 401, code: "sso-state-invalid" });
    }
    const transaction = pending.get(stateValue);
    pending.delete(stateValue);
    if (!transaction || transaction.expiresAt <= now()) throw Object.assign(new Error("Microsoft sign-in request expired"), { status: 401, code: "sso-state-expired" });
    const authCode = String(code || "");
    if (!authCode || authCode.length > 4096) throw Object.assign(new Error("Microsoft sign-in response is invalid"), { status: 400, code: "sso-code-invalid" });
    const provider = await discovery();
    const form = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code: authCode,
      redirect_uri: config.redirectUri,
      code_verifier: transaction.verifier,
      scope: "openid profile email"
    });
    let tokenResponse;
    try {
      tokenResponse = await fetchImpl(provider.token_endpoint, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: form,
        signal: AbortSignal.timeout(8000),
        redirect: "error"
      });
    } catch {
      throw Object.assign(new Error("Microsoft sign-in could not be completed"), { status: 503, code: "sso-token-unavailable" });
    }
    const tokens = await tokenResponse.json().catch(() => null);
    if (!tokenResponse.ok || !tokens?.id_token) throw Object.assign(new Error("Microsoft sign-in could not be verified"), { status: 401, code: "sso-token-invalid" });
    if (!jwksCache) jwksCache = createRemoteJWKSet(new URL(provider.jwks_uri), { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 3600000 });
    let claims;
    try {
      ({ payload: claims } = await jwtVerify(tokens.id_token, jwksCache, {
        issuer: provider.issuer,
        audience: config.clientId,
        algorithms: ["RS256"],
        requiredClaims: ["iss", "aud", "exp", "iat", "nonce", "tid", "oid"]
      }));
    } catch {
      throw Object.assign(new Error("Microsoft sign-in identity token is invalid"), { status: 401, code: "sso-token-invalid" });
    }
    const tenantId = String(claims.tid || "").toLowerCase();
    const objectId = String(claims.oid || "").toLowerCase();
    if (tenantId !== config.tenantId || claims.nonce !== transaction.nonce || !uuidPattern.test(objectId)) {
      throw Object.assign(new Error("Microsoft sign-in tenant or session did not match"), { status: 401, code: "sso-identity-mismatch" });
    }
    const userId = config.userMap[objectId];
    if (!userId) throw Object.assign(new Error("Microsoft identity is not mapped to an AuditFlow account"), { status: 403, code: "sso-principal-unmapped" });
    const account = await accountById?.(userId);
    if (!account || account.disabled) throw Object.assign(new Error("Microsoft identity is not mapped to an active AuditFlow account"), { status: 403, code: "sso-principal-unmapped" });
    return {
      userId: account.userId,
      userName: account.displayName,
      account,
      isAdmin: Boolean(account.isAdmin)
    };
  }

  return Object.freeze({ enabled, start, callback });
}
