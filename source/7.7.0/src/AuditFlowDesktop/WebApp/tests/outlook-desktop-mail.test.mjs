import assert from "node:assert/strict";
import test from "node:test";
import { createAssessmentMail } from "../assessment-mail.mjs";
import { createOutlookDesktopMail, outlookDesktopMailConfig } from "../outlook-desktop-mail.mjs";

const env = { AUDITFLOW_MAIL_TRANSPORT: "outlook-desktop", AUDITFLOW_SERVER_ROLE: "desktop", AUDITFLOW_MAIL_FROM: "me@example.test" };

test("Outlook mail requires explicit transport, sender, platform and desktop role", () => {
  assert.equal(outlookDesktopMailConfig({ AUDITFLOW_MAIL_FROM: env.AUDITFLOW_MAIL_FROM }, "darwin"), null);
  assert.equal(outlookDesktopMailConfig({ ...env, AUDITFLOW_MAIL_FROM: "" }, "darwin"), null);
  assert.throws(() => outlookDesktopMailConfig(env, "linux"), /macOS desktop/);
  assert.throws(() => outlookDesktopMailConfig({ ...env, AUDITFLOW_SERVER_ROLE: "collaboration" }, "darwin"), /macOS desktop/);
  assert.throws(() => outlookDesktopMailConfig({ ...env, AUDITFLOW_MAIL_FROM: "me@example.test\nbcc:other@example.test" }, "darwin"), /explicit sender/);
});

test("Outlook receives mail data only through arguments, with bounded execution and no shell", async () => {
  let call;
  const mail = createOutlookDesktopMail({
    env, platform: "darwin",
    execFileImpl: async (...args) => { call = args; return { stdout: "accepted\n" }; }
  });
  const text = 'Review BP1.\n" & do shell script "touch /tmp/never" & "\n$(never-run)';
  assert.deepEqual(await mail.send({ to: "assignee@example.test", subject: "Task\nassigned", text }), { accepted: true, transport: "outlook-desktop" });
  assert.equal(call[0], "/usr/bin/osascript");
  assert.equal(call[1][0], "-e");
  assert.equal(call[1][1].includes(text), false);
  assert.deepEqual(call[1].slice(2), ["--", "me@example.test", "assignee@example.test", "Task assigned", text]);
  assert.equal(call[2].timeout, 15000);
  assert.equal(call[2].shell, undefined);
  assert.match(call[1][1], /count of senderAccounts\) is not 1/);
  assert.match(call[1][1], /account:senderAccount/);
});

test("Outlook never sends invalid addresses or NUL content and hides automation errors", async () => {
  let calls = 0;
  const mail = createOutlookDesktopMail({
    env, platform: "darwin",
    execFileImpl: async () => { calls += 1; throw new Error("private local mailbox details"); }
  });
  await assert.rejects(mail.send({ to: "one@example.test,two@example.test" }), error => error.code === "mail-recipient-invalid");
  await assert.rejects(mail.send({ to: "one@example.test", text: "invalid\0text" }), error => error.code === "mail-content-invalid");
  assert.equal(calls, 0);
  await assert.rejects(mail.send({ to: "one@example.test" }), error => error.code === "mail-outlook-unavailable" && !error.message.includes("private local"));
  assert.equal(calls, 1);
});

test("Outlook reports only explicit acceptance and has no silent fallback", async () => {
  const mail = createOutlookDesktopMail({ env, platform: "darwin", execFileImpl: async () => ({ stdout: "" }) });
  await assert.rejects(mail.send({ to: "one@example.test" }), error => error.code === "mail-outlook-unavailable");
  assert.equal(createAssessmentMail({ env: {}, platform: "darwin" }).transport, "microsoft-graph");
  assert.equal(createAssessmentMail({ env, platform: "darwin" }).transport, "outlook-desktop");
  assert.throws(() => createAssessmentMail({ env: { AUDITFLOW_MAIL_TRANSPORT: "smtp" } }), /Unsupported/);
});
