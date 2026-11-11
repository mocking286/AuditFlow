import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCollaborationStore } from "../collaboration-store.mjs";

test("file-backed feedback retains the complete API-supported 50000-character content", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "auditflow-feedback-length-"));
  const store = createCollaborationStore({ directory });
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  const content = "x".repeat(49982) + "unique-tail-marker";
  assert.equal(content.length, 50000);
  const result = await store.createFeedback({ userId: "SYNTHETIC", userName: "Fixture" }, { feature: "Long feedback", content });
  assert.equal(result.content, content);
  const entries = await store.listFeedback({ userId: "SYNTHETIC" });
  assert.equal(entries[0].content, content);
});
