import crypto from "node:crypto";

function normalizeHost(value) {
  const host = String(value || "").trim();
  if (!host || /[/?#@\\\s]/.test(host)) return "";
  try {
    const parsed = new URL(`https://${host}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return "";
    return parsed.host.toLowerCase();
  } catch (_) {
    return "";
  }
}

export function resolveTrustedProxyOrigin(request, { secret = "", allowedHosts = [] } = {}) {
  const expectedSecret = Buffer.from(String(secret || ""));
  const suppliedSecret = Buffer.from(String(request?.headers?.["x-auditflow-proxy-secret"] || ""));
  if (!expectedSecret.length || expectedSecret.length !== suppliedSecret.length) return "";
  if (!crypto.timingSafeEqual(expectedSecret, suppliedSecret)) return "";

  const protoValue = String(request?.headers?.["x-forwarded-proto"] || "").trim();
  if (!protoValue || protoValue.includes(",")) return "";
  const proto = protoValue.toLowerCase();
  if (proto !== "https") return "";

  const forwardedHostValue = String(request?.headers?.["x-forwarded-host"] || "").trim();
  if (!forwardedHostValue || forwardedHostValue.includes(",")) return "";
  const forwardedHost = normalizeHost(forwardedHostValue);
  if (!forwardedHost) return "";
  const hostAllowlist = new Set((Array.isArray(allowedHosts) ? allowedHosts : [])
    .map(normalizeHost)
    .filter(Boolean));
  return hostAllowlist.has(forwardedHost) ? `https://${forwardedHost}` : "";
}
