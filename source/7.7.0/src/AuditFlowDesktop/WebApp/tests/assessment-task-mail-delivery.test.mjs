import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const source = server.slice(server.indexOf("const taskNotificationDeliveries ="), server.indexOf("\nfunction loginAttemptKey("));

function harness({ status = "pending", send } = {}) {
  const notification = { id: "MAIL-1", recipientId: "ASSESSOR-1", subject: "Audit task", text: "Check baseline", status };
  const receipts = [];
  const context = {
    Map, JSON, String,
    TASK_NOTIFICATION_AUTHORITY: Symbol("test"),
    fault: (message, status) => Object.assign(new Error(message), { status }),
    collaborationStore: {
      async project() { return { snapshot: { assessmentTaskNotifications: [notification] } }; },
      async accountById() { return { email: "assessor@example.test", disabled: false }; },
      async recordTaskNotification(projectId, receipt) {
        Object.assign(notification, receipt);
        receipts.push(receipt);
        return { notification };
      }
    },
    microsoftGraphMail: { configured: true, transport: "test-transport", send },
    receipts
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.deliver = deliverAssessmentTaskNotification;`, context);
  return { ...context, notification };
}

test("concurrent retries of one task notification share one transport submission and receipt", async () => {
  let sends = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const value = harness({ send: async () => { sends++; await gate; return { transport: "test-transport" }; } });
  const first = value.deliver("PROJECT-1", value.notification, { userId: "LEAD-1" });
  const second = value.deliver("PROJECT-1", value.notification, { userId: "LEAD-1" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sends, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(value.receipts.length, 1);
  assert.equal(value.notification.status, "accepted");
});

test("a stale retry cannot resend a previously accepted notification", async () => {
  let sends = 0;
  const value = harness({ status: "accepted", send: async () => { sends++; } });
  const result = await value.deliver("PROJECT-1", { ...value.notification, status: "pending" }, {});
  assert.equal(result.status, "accepted");
  assert.equal(sends, 0);
  assert.equal(value.receipts.length, 0);
});

test("a transport failure is recorded without claiming that the message was sent", async () => {
  const value = harness({ send: async () => { throw new Error("Transport unavailable"); } });
  await value.deliver("PROJECT-1", value.notification, {});
  assert.equal(value.receipts.length, 1);
  assert.equal(value.notification.status, "failed");
  assert.equal(value.notification.transport, "test-transport");
});
