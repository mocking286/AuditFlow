const DEFAULT_ALLOWED_HOST_SUFFIXES = [
  ".powerplatform.com",
  ".botframework.com",
  ".microsoft.com",
  ".azurewebsites.net"
];

const DIRECT_LINE_BASE_URL = "https://directline.botframework.com/v3/directline";

function text(value, max = 2048) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isPublicHostname(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host || host === "localhost" || host === "::1" || host === "[::1]") return false;
  if (/^(?:127|10|192\.168|169\.254)\./.test(host)) return false;
  if (/^172\.(?:1[6-9]|2\d|3[0-1])\./.test(host)) return false;
  if (/^(?:0|255)\./.test(host)) return false;
  return !/^[0-9a-f:]+$/i.test(host);
}

export function normalizeCopilotTokenEndpoint(value, allowedHostSuffixes = DEFAULT_ALLOWED_HOST_SUFFIXES) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch (_) {
    throw Object.assign(new Error("Copilot token endpoint must be a valid HTTPS URL"), { code: "copilot-invalid-endpoint" });
  }
  if (parsed.protocol !== "https:" || !isPublicHostname(parsed.hostname)) {
    throw Object.assign(new Error("Copilot token endpoint must use a public HTTPS host"), { code: "copilot-invalid-endpoint" });
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw Object.assign(new Error("Copilot token endpoint cannot include credentials or a fragment"), { code: "copilot-invalid-endpoint" });
  }
  const host = parsed.hostname.toLowerCase();
  const suffixes = (Array.isArray(allowedHostSuffixes) ? allowedHostSuffixes : DEFAULT_ALLOWED_HOST_SUFFIXES)
    .map(item => String(item || "").trim().toLowerCase())
    .filter(Boolean);
  if (!suffixes.some(suffix => host === suffix.replace(/^\./, "") || host.endsWith(suffix))) {
    throw Object.assign(new Error("Copilot token endpoint host is not an approved Microsoft endpoint"), { code: "copilot-host-not-allowed" });
  }
  if (!/\/(?:powervirtualagents|api\/botmanagement\/v1\/directline)(?:\/|$)/i.test(parsed.pathname)) {
    throw Object.assign(new Error("Copilot token endpoint path is not a supported Direct Line token route"), { code: "copilot-invalid-endpoint" });
  }
  return parsed.toString();
}

function normalizeDirectLineBaseUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || "")); } catch (_) {
    throw Object.assign(new Error("Copilot Direct Line URL is invalid"), { code: "copilot-invalid-directline" });
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || !isPublicHostname(host)
    || !(host === "directline.botframework.com" || host.endsWith(".directline.botframework.com"))) {
    throw Object.assign(new Error("Copilot Direct Line URL is not an approved endpoint"), { code: "copilot-invalid-directline" });
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  const directLinePath = /\/v3\/directline$/i.test(pathname)
    ? pathname
    : `${pathname}/v3/directline`;
  return `${parsed.origin}${directLinePath}`;
}

function extractTokenPayload(payload) {
  const token = text(payload?.token || payload?.Token, 4096);
  const expiresIn = Number(payload?.expires_in ?? payload?.expiresIn ?? payload?.expires);
  const conversationId = text(payload?.conversationId || payload?.conversationID, 256);
  if (!token) throw Object.assign(new Error("Copilot token endpoint returned no Direct Line token"), { code: "copilot-token-invalid" });
  if (!Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > 24 * 60 * 60) {
    throw Object.assign(new Error("Copilot token endpoint returned an invalid lifetime"), { code: "copilot-token-invalid" });
  }
  return {
    token,
    expiresAtMs: Date.now() + Math.floor(expiresIn * 1000),
    conversationId
  };
}

async function responseJson(response, errorPrefix) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = text(payload?.error?.message || payload?.message || payload?.error, 600);
    throw Object.assign(new Error(`${errorPrefix} (${response.status})${detail ? `: ${detail}` : ""}`), {
      code: "copilot-remote-error",
      status: response.status
    });
  }
  return payload;
}

export class CopilotDirectLineClient {
  constructor({
    tokenEndpoint,
    agentName = "",
    environmentId = "",
    schemaName = "",
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    directLineBaseUrl = DIRECT_LINE_BASE_URL,
    allowedHostSuffixes = DEFAULT_ALLOWED_HOST_SUFFIXES
  } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("Copilot Direct Line requires fetch");
    this.fetch = fetchImpl;
    this.now = now;
    this.tokenEndpoint = normalizeCopilotTokenEndpoint(tokenEndpoint, allowedHostSuffixes);
    this.agentName = text(agentName, 240);
    this.environmentId = text(environmentId, 160);
    this.schemaName = text(schemaName, 240);
    this.directLineBaseUrl = String(directLineBaseUrl || DIRECT_LINE_BASE_URL).replace(/\/+$/, "");
    this.directLineBaseUrlResolved = false;
    this.token = "";
    this.expiresAtMs = 0;
    this.conversationId = "";
    this.watermark = "";
  }

  metadata() {
    let host = "";
    try { host = new URL(this.tokenEndpoint).hostname; } catch (_) {}
    return {
      transport: "copilot-studio-direct-line",
      agent: {
        name: this.agentName,
        environmentId: this.environmentId,
        schemaName: this.schemaName
      },
      tokenEndpointHost: host,
      conversationId: this.conversationId,
      expiresAt: this.expiresAtMs ? new Date(this.expiresAtMs).toISOString() : ""
    };
  }

  async fetchToken() {
    const response = await this.fetch(this.tokenEndpoint, {
      method: "GET",
      headers: { accept: "application/json" }
    });
    const payload = await responseJson(response, "Copilot token request failed");
    const token = extractTokenPayload(payload);
    this.token = token.token;
    this.expiresAtMs = token.expiresAtMs;
    if (token.conversationId) this.conversationId = token.conversationId;
    await this.resolveRegionalDirectLineUrl();
    return token;
  }

  async resolveRegionalDirectLineUrl() {
    if (this.directLineBaseUrlResolved) return this.directLineBaseUrl;
    this.directLineBaseUrlResolved = true;
    let tokenUrl;
    try { tokenUrl = new URL(this.tokenEndpoint); } catch (_) { return this.directLineBaseUrl; }
    if (!tokenUrl.hostname.endsWith(".environment.api.powerplatform.com")) return this.directLineBaseUrl;
    const apiVersion = text(tokenUrl.searchParams.get("api-version") || "2022-03-01-preview", 80);
    const settingsUrl = new URL("/powervirtualagents/regionalchannelsettings", tokenUrl.origin);
    settingsUrl.searchParams.set("api-version", apiVersion);
    try {
      const response = await this.fetch(settingsUrl.toString(), {
        method: "GET",
        headers: { accept: "application/json" }
      });
      const payload = await responseJson(response, "Copilot regional settings request failed");
      const regionalUrl = text(payload?.channelUrlsById?.directline || payload?.channelUrlsById?.DirectLine, 2048);
      if (regionalUrl) this.directLineBaseUrl = normalizeDirectLineBaseUrl(regionalUrl);
    } catch (_) {
      // Fall back to the global Direct Line host when regional metadata is not exposed.
    }
    return this.directLineBaseUrl;
  }

  async ensureToken() {
    if (!this.token || this.expiresAtMs - this.now() < 60_000) await this.fetchToken();
    return this.token;
  }

  async startConversation() {
    await this.ensureToken();
    await this.resolveRegionalDirectLineUrl();
    if (this.conversationId) return this.conversationId;
    const response = await this.fetch(`${this.directLineBaseUrl}/conversations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json"
      }
    });
    const payload = await responseJson(response, "Copilot conversation start failed");
    this.conversationId = text(payload?.conversationId, 256);
    if (!this.conversationId) throw Object.assign(new Error("Copilot Direct Line returned no conversation ID"), { code: "copilot-conversation-invalid" });
    return this.conversationId;
  }

  async listActivities() {
    const conversationId = await this.startConversation();
    const suffix = this.watermark ? `?watermark=${encodeURIComponent(this.watermark)}` : "";
    const response = await this.fetch(`${this.directLineBaseUrl}/conversations/${encodeURIComponent(conversationId)}/activities${suffix}`, {
      method: "GET",
      headers: { authorization: `Bearer ${this.token}` }
    });
    const payload = await responseJson(response, "Copilot activity receive failed");
    if (payload?.watermark) this.watermark = text(payload.watermark, 256);
    return Array.isArray(payload?.activities) ? payload.activities : [];
  }

  async sendActivity(message, { userId = "auditflow-assessor" } = {}) {
    const conversationId = await this.startConversation();
    const body = {
      type: "message",
      from: { id: text(userId, 128) || "auditflow-assessor" },
      text: text(message, 180_000)
    };
    if (!body.text) throw Object.assign(new Error("Copilot message cannot be empty"), { code: "copilot-empty-message" });
    const response = await this.fetch(`${this.directLineBaseUrl}/conversations/${encodeURIComponent(conversationId)}/activities`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const payload = await responseJson(response, "Copilot message send failed");
    return text(payload?.id, 256);
  }

  async receiveActivities({ timeoutMs = 45_000, pollMs = 900, userId = "auditflow-assessor", sendId = "" } = {}) {
    const conversationId = await this.startConversation();
    const deadline = this.now() + Math.max(1_000, Math.min(Number(timeoutMs) || 45_000, 120_000));
    let responseParts = [];
    let lastBotAt = 0;
    while (this.now() < deadline) {
      await this.ensureToken();
      const activities = await this.listActivities();
      let receivedBotThisPoll = false;
      let receivedReplyForSend = false;
      for (const activity of activities) {
        const activityId = text(activity?.id, 256);
        const fromId = text(activity?.from?.id, 128);
        const replyToId = text(activity?.replyToId, 256);
        if (sendId && (activityId === sendId || (replyToId && replyToId !== sendId))) continue;
        if (fromId && fromId === userId) continue;
        if (activity?.type === "message" && text(activity?.text, 180_000)) {
          responseParts.push(text(activity.text, 180_000));
          lastBotAt = this.now();
          receivedBotThisPoll = true;
          if (sendId && replyToId === sendId) receivedReplyForSend = true;
        }
      }
      if (responseParts.length && (
        receivedReplyForSend ||
        (!sendId && (!receivedBotThisPoll || this.now() - lastBotAt >= Math.max(250, pollMs * 1.5)))
      )) {
        return {
          text: responseParts.join("\n\n").slice(0, 180_000),
          activityType: "message"
        };
      }
      await sleep(Math.min(pollMs, Math.max(100, deadline - this.now())));
    }
    throw Object.assign(new Error("Copilot response timed out while waiting for Direct Line activities"), { code: "copilot-timeout" });
  }

  async chat(message, options = {}) {
    await this.startConversation();
    await this.listActivities();
    const sendId = await this.sendActivity(message, options);
    const response = await this.receiveActivities({ ...options, sendId });
    return {
      ...response,
      conversationId: this.conversationId,
      ...this.metadata()
    };
  }
}

export const COPILOT_DIRECT_LINE_DEFAULTS = {
  directLineBaseUrl: DIRECT_LINE_BASE_URL,
  allowedHostSuffixes: DEFAULT_ALLOWED_HOST_SUFFIXES.slice()
};
