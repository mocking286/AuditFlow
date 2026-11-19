const tenantPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function microsoftGraphMailConfig(env = process.env) {
  const tenantId = String(env.AUDITFLOW_MAIL_ENTRA_TENANT_ID || "").trim();
  const clientId = String(env.AUDITFLOW_MAIL_ENTRA_CLIENT_ID || "").trim();
  const clientSecret = String(env.AUDITFLOW_MAIL_ENTRA_CLIENT_SECRET || "");
  const sender = String(env.AUDITFLOW_MAIL_FROM || "").trim();
  if (!tenantId || !clientId || !clientSecret || !sender) return null;
  if (!tenantPattern.test(tenantId) || clientId.length > 200 || clientSecret.length > 4000 || !emailPattern.test(sender)) {
    throw new Error("Microsoft Graph mail configuration is invalid");
  }
  return { tenantId, clientId, clientSecret, sender };
}

export function createMicrosoftGraphMail({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const config = microsoftGraphMailConfig(env);
  let accessToken = "";
  let tokenExpiresAt = 0;

  async function token() {
    if (!config) throw Object.assign(new Error("Microsoft Graph email is not configured"), { status: 503, code: "mail-not-configured" });
    if (accessToken && tokenExpiresAt > now() + 60_000) return accessToken;
    const form = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default"
    });
    let response;
    try {
      response = await fetchImpl(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: form,
        signal: AbortSignal.timeout(8000),
        redirect: "error"
      });
    } catch {
      throw Object.assign(new Error("Microsoft Graph authorization is unavailable"), { status: 503, code: "mail-auth-unavailable" });
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.access_token || typeof payload.access_token !== "string") {
      throw Object.assign(new Error("Microsoft Graph authorization failed"), { status: 502, code: "mail-auth-failed" });
    }
    accessToken = payload.access_token;
    tokenExpiresAt = now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000;
    return accessToken;
  }

  async function send({ to, subject, text } = {}) {
    if (!config) throw Object.assign(new Error("Microsoft Graph email is not configured"), { status: 503, code: "mail-not-configured" });
    const recipient = String(to || "").trim();
    if (!emailPattern.test(recipient)) throw Object.assign(new Error("Notification recipient email is invalid"), { status: 400, code: "mail-recipient-invalid" });
    const message = {
      message: {
        subject: String(subject || "JEAuditFlow assessment task").slice(0, 240),
        body: { contentType: "Text", content: String(text || "").slice(0, 12000) },
        toRecipients: [{ emailAddress: { address: recipient } }]
      },
      saveToSentItems: true
    };
    let response;
    try {
      response = await fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.sender)}/sendMail`, {
        method: "POST",
        headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(10000),
        redirect: "error"
      });
    } catch (error) {
      if (error?.code === "mail-not-configured") throw error;
      throw Object.assign(new Error("Microsoft Graph email delivery is unavailable"), { status: 503, code: "mail-send-unavailable" });
    }
    if (response.status !== 202) {
      accessToken = "";
      tokenExpiresAt = 0;
      throw Object.assign(new Error("Microsoft Graph rejected the notification email"), { status: 502, code: "mail-send-rejected" });
    }
    return { accepted: true, transport: "microsoft-graph" };
  }

  return Object.freeze({ configured: Boolean(config), send });
}
