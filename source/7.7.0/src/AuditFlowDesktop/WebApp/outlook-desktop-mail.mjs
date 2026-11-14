import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sendScript = `
on run argv
  set senderAddress to item 1 of argv
  set recipientAddress to item 2 of argv
  set messageSubject to item 3 of argv
  set messageText to item 4 of argv
  tell application id "com.microsoft.Outlook"
    set senderAccounts to (every account whose email address is senderAddress)
    if (count of senderAccounts) is not 1 then error "The configured sender account is unavailable"
    set senderAccount to item 1 of senderAccounts
    set taskMessage to make new outgoing message with properties {subject:messageSubject, plain text content:messageText, account:senderAccount}
    make new to recipient at taskMessage with properties {email address:{address:recipientAddress}}
    send taskMessage
  end tell
  return "accepted"
end run`;

export function outlookDesktopMailConfig(env = process.env, platform = process.platform) {
  if (String(env.AUDITFLOW_MAIL_TRANSPORT || "").trim() !== "outlook-desktop") return null;
  const sender = String(env.AUDITFLOW_MAIL_FROM || "").trim();
  if (!sender) return null;
  if (platform !== "darwin" || env.AUDITFLOW_SERVER_ROLE !== "desktop" || !emailPattern.test(sender)) {
    throw new Error("Outlook desktop mail requires a macOS desktop connector and an explicit sender email");
  }
  return { sender };
}

export function createOutlookDesktopMail({ env = process.env, platform = process.platform, execFileImpl = execFileAsync } = {}) {
  const config = outlookDesktopMailConfig(env, platform);

  async function send({ to, subject, text } = {}) {
    if (!config) throw Object.assign(new Error("Outlook desktop email is not configured"), { status: 503, code: "mail-not-configured" });
    const recipient = String(to || "").trim();
    if (!emailPattern.test(recipient)) throw Object.assign(new Error("Notification recipient email is invalid"), { status: 400, code: "mail-recipient-invalid" });
    const messageSubject = String(subject || "JEAuditFlow assessment task").replace(/[\r\n]/g, " ").slice(0, 240);
    const messageText = String(text || "").slice(0, 12000);
    if ([messageSubject, messageText].some(value => value.includes("\0"))) {
      throw Object.assign(new Error("Notification email contains invalid text"), { status: 400, code: "mail-content-invalid" });
    }
    let result;
    try {
      result = await execFileImpl("/usr/bin/osascript", ["-e", sendScript, "--", config.sender, recipient, messageSubject, messageText], {
        timeout: 15000,
        maxBuffer: 4096,
        windowsHide: true
      });
    } catch {
      throw Object.assign(new Error("Outlook did not confirm accepting the email; check its Outbox before retrying"), { status: 503, code: "mail-outlook-unavailable" });
    }
    if (String(result?.stdout || "").trim() !== "accepted") {
      throw Object.assign(new Error("Outlook did not confirm accepting the email; check its Outbox before retrying"), { status: 503, code: "mail-outlook-unavailable" });
    }
    return { accepted: true, transport: "outlook-desktop" };
  }

  return Object.freeze({ configured: Boolean(config), transport: "outlook-desktop", send });
}
