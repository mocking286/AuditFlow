import { createMicrosoftGraphMail } from "./microsoft-graph-mail.mjs";
import { createOutlookDesktopMail } from "./outlook-desktop-mail.mjs";

export function createAssessmentMail(options = {}) {
  const env = options.env || process.env;
  const transport = String(env.AUDITFLOW_MAIL_TRANSPORT || "microsoft-graph").trim();
  if (transport === "outlook-desktop") return createOutlookDesktopMail(options);
  if (transport !== "microsoft-graph") throw new Error("Unsupported assessment email transport");
  return Object.freeze({ ...createMicrosoftGraphMail(options), transport: "microsoft-graph" });
}
