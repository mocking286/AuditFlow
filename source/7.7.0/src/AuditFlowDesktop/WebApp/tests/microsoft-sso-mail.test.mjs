import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createMicrosoftGraphMail, microsoftGraphMailConfig } from "../microsoft-graph-mail.mjs";
import { createMicrosoftOidc, microsoftOidcConfig } from "../microsoft-oidc.mjs";

const tenantId = "00000000-0000-4000-8000-000000000001";
const clientId = "00000000-0000-4000-8000-000000000002";
const objectId = "00000000-0000-4000-8000-000000000003";
const graphEnv = {
  AUDITFLOW_MAIL_ENTRA_TENANT_ID: tenantId,
  AUDITFLOW_MAIL_ENTRA_CLIENT_ID: clientId,
  AUDITFLOW_MAIL_ENTRA_CLIENT_SECRET: "test-secret-only",
  AUDITFLOW_MAIL_FROM: "sender@example.test"
};
const ssoEnv = {
  AUDITFLOW_SSO_ENTRA_TENANT_ID: tenantId,
  AUDITFLOW_SSO_ENTRA_CLIENT_ID: clientId,
  AUDITFLOW_SSO_ENTRA_CLIENT_SECRET: "test-secret-only",
  AUDITFLOW_SSO_ENTRA_REDIRECT_URI: "http://127.0.0.1:47683/api/auth/sso/callback",
  AUDITFLOW_SSO_ENTRA_USER_MAP: JSON.stringify({ [objectId]: "ASSESSOR-1" })
};
const provider = {
  issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
  response_types_supported: ["code"],
  authorization_endpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
  token_endpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
  jwks_uri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("mail stays disabled without complete configuration and never opens a network request", async () => {
  let calls = 0;
  const mail = createMicrosoftGraphMail({ env: {}, fetchImpl: async () => { calls += 1; } });
  assert.equal(mail.configured, false);
  assert.equal(microsoftGraphMailConfig({ ...graphEnv, AUDITFLOW_MAIL_FROM: "" }), null);
  await assert.rejects(mail.send({ to: "me@example.test" }), error => error.code === "mail-not-configured" && error.status === 503);
  assert.equal(calls, 0);
});

test("mail configuration rejects invalid tenants and recipients before requesting a token", async () => {
  assert.throws(() => microsoftGraphMailConfig({ ...graphEnv, AUDITFLOW_MAIL_ENTRA_TENANT_ID: "common" }), /configuration is invalid/);
  let calls = 0;
  const mail = createMicrosoftGraphMail({ env: graphEnv, fetchImpl: async () => { calls += 1; } });
  await assert.rejects(mail.send({ to: "me@example.test\nbcc:other@example.test" }), error => error.code === "mail-recipient-invalid");
  assert.equal(calls, 0);
});

test("Graph transport uses an explicit sender, caches tokens and reports acceptance only", async () => {
  let clock = 0;
  const calls = [];
  const mail = createMicrosoftGraphMail({
    env: graphEnv,
    now: () => clock,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return url.includes("/token") ? json({ access_token: "private-test-token", expires_in: 3600 }) : new Response(null, { status: 202 });
    }
  });
  assert.deepEqual(await mail.send({ to: "me@example.test", subject: "Task assigned", text: "Review SYS.2.BP1" }), { accepted: true, transport: "microsoft-graph" });
  await mail.send({ to: "me@example.test", text: "Review SUP.8.BP1" });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`);
  assert.equal(new URLSearchParams(calls[0].options.body).get("scope"), "https://graph.microsoft.com/.default");
  assert.equal(calls[1].url, "https://graph.microsoft.com/v1.0/users/sender%40example.test/sendMail");
  const message = JSON.parse(calls[1].options.body);
  assert.equal(message.message.body.contentType, "Text");
  assert.deepEqual(message.message.toRecipients, [{ emailAddress: { address: "me@example.test" } }]);
  assert.equal(message.saveToSentItems, true);
  assert.equal(calls[1].options.redirect, "error");
  clock = 3_600_000;
  await mail.send({ to: "me@example.test", text: "Review MAN.3.BP1" });
  assert.equal(calls.length, 5);
});

test("Graph errors omit token responses and do not turn unrelated 2xx statuses into acceptance", async () => {
  for (const status of [200, 401, 429, 500]) {
    const mail = createMicrosoftGraphMail({
      env: graphEnv,
      fetchImpl: async url => url.includes("/token")
        ? json({ access_token: "private-test-token", expires_in: 3600 })
        : json({ secret: "must-not-leak" }, status)
    });
    await assert.rejects(mail.send({ to: "me@example.test" }), error =>
      error.code === "mail-send-rejected" && !error.message.includes("private-test-token") && !error.message.includes("must-not-leak"));
  }
  const unavailable = createMicrosoftGraphMail({ env: graphEnv, fetchImpl: async () => { throw new Error("secret=must-not-leak"); } });
  await assert.rejects(unavailable.send({ to: "me@example.test" }), error =>
    error.code === "mail-send-unavailable" && !error.message.includes("must-not-leak"));
});

test("SSO remains disabled until a complete tenant registration and account mapping are configured", async () => {
  const sso = createMicrosoftOidc({ env: {}, fetchImpl: async () => { throw new Error("network must not be called"); } });
  assert.equal(sso.enabled, false);
  await assert.rejects(sso.start(), error => error.code === "sso-not-configured");
  assert.equal(microsoftOidcConfig({ ...ssoEnv, AUDITFLOW_SSO_ENTRA_CLIENT_ID: "" }), null);
  assert.throws(() => microsoftOidcConfig({ ...ssoEnv, AUDITFLOW_SSO_ENTRA_USER_MAP: "{}" }), /mapping is required/);
  assert.throws(() => microsoftOidcConfig({ ...ssoEnv, AUDITFLOW_SSO_ENTRA_USER_MAP: "[]" }), /must be an object/);
  assert.throws(() => microsoftOidcConfig({ ...ssoEnv, AUDITFLOW_SSO_ENTRA_USER_MAP: '{"not-an-object-id":"ADMIN"}' }), /invalid object ID/);
  assert.throws(() => microsoftOidcConfig({ ...ssoEnv, AUDITFLOW_SSO_ENTRA_TENANT_ID: "common" }), /tenant UUID/);
});

test("SSO redirect URIs allow local HTTP only and never contain credentials or fragments", () => {
  for (const value of ["http://example.test/api/auth/sso/callback", "https://user:pass@example.test/callback", "https://example.test/callback#token"]) {
    assert.throws(() => microsoftOidcConfig({ ...ssoEnv, AUDITFLOW_SSO_ENTRA_REDIRECT_URI: value }), /must use HTTPS/);
  }
  assert.equal(microsoftOidcConfig({ ...ssoEnv, AUDITFLOW_SSO_ENTRA_REDIRECT_URI: "https://audit.example.test/api/auth/sso/callback" }).redirectUri, "https://audit.example.test/api/auth/sso/callback");
});

test("SSO starts authorization-code login with independent state, nonce and S256 PKCE", async () => {
  let discoveries = 0;
  const sso = createMicrosoftOidc({ env: ssoEnv, fetchImpl: async () => { discoveries += 1; return json(provider); } });
  const first = await sso.start();
  const second = await sso.start();
  const url = new URL(first.url);
  assert.equal(sso.enabled, true);
  assert.equal(url.origin, "https://login.microsoftonline.com");
  assert.equal(url.searchParams.get("client_id"), clientId);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "openid profile email");
  assert.equal(url.searchParams.get("state"), first.state);
  assert.match(url.searchParams.get("code_challenge"), /^[a-zA-Z0-9_-]{43}$/);
  assert.notEqual(first.state, second.state);
  assert.notEqual(url.searchParams.get("nonce"), new URL(second.url).searchParams.get("nonce"));
  assert.equal(url.searchParams.has("client_secret"), false);
  assert.equal(discoveries, 1);
});

test("SSO fails closed on untrusted discovery documents", async () => {
  for (const invalid of [
    { ...provider, issuer: "https://other.example.test/v2.0" },
    { ...provider, token_endpoint: "https://other.example.test/token" },
    { ...provider, jwks_uri: "http://login.microsoftonline.com/keys" },
    { ...provider, response_types_supported: ["token"] }
  ]) {
    const sso = createMicrosoftOidc({ env: ssoEnv, fetchImpl: async () => json(invalid) });
    await assert.rejects(sso.start());
  }
});

test("SSO rejects state mismatch, expiry and replay without using a sign-in code", async () => {
  let clock = 0;
  let tokenRequests = 0;
  const sso = createMicrosoftOidc({
    env: ssoEnv,
    now: () => clock,
    fetchImpl: async url => {
      if (url.includes("/token")) { tokenRequests += 1; return json({ error: "invalid_grant", private: "must-not-leak" }, 401); }
      return json(provider);
    }
  });
  const { state } = await sso.start();
  await assert.rejects(sso.callback({ state, stateCookie: "different-browser", code: "auth-code" }), error => error.code === "sso-state-invalid");
  assert.equal(tokenRequests, 0);
  clock = 300_001;
  await assert.rejects(sso.callback({ state, stateCookie: state, code: "auth-code" }), error => error.code === "sso-state-expired");
  const fresh = await sso.start();
  await assert.rejects(sso.callback({ state: fresh.state, stateCookie: fresh.state, code: "auth-code" }), error =>
    error.code === "sso-token-invalid" && !error.message.includes("must-not-leak"));
  await assert.rejects(sso.callback({ state: fresh.state, stateCookie: fresh.state, code: "auth-code" }), error => error.code === "sso-state-expired");
  assert.equal(tokenRequests, 1);
});

test("SSO exchanges its code with the same redirect URI and PKCE verifier", async () => {
  let tokenForm;
  const sso = createMicrosoftOidc({
    env: ssoEnv,
    fetchImpl: async (url, options) => {
      if (url.includes("/token")) { tokenForm = new URLSearchParams(options.body); return json({}); }
      return json(provider);
    }
  });
  const login = await sso.start();
  await assert.rejects(sso.callback({ state: login.state, stateCookie: login.state, code: "test-auth-code" }), error => error.code === "sso-token-invalid");
  assert.equal(tokenForm.get("redirect_uri"), ssoEnv.AUDITFLOW_SSO_ENTRA_REDIRECT_URI);
  assert.equal(tokenForm.get("grant_type"), "authorization_code");
  assert.equal(tokenForm.get("code"), "test-auth-code");
  const challenge = crypto.createHash("sha256").update(tokenForm.get("code_verifier")).digest("base64url");
  assert.equal(challenge, new URL(login.url).searchParams.get("code_challenge"));
});
