import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { bootstrapAuditFlow, DEFAULT_ADMIN_EMAIL } from "../bootstrap.mjs";
import { createCollaborationStore } from "../collaboration-store.mjs";

const passwordDigest = (password, salt) => crypto.scryptSync(password, salt, 64).toString("hex");
const administrator = {
  userId: "EXISTING-ADMIN",
  userName: "Existing Administrator",
  isAdmin: true,
  account: { email: DEFAULT_ADMIN_EMAIL, isAdmin: true }
};
const legacyStartup = {
  AUDITFLOW_SERVER_ROLE: "desktop",
  AUDITFLOW_BOOTSTRAP_MBEAL: "1",
  AUDITFLOW_BOOTSTRAP_CORE_PROJECTS: "1",
  AUDITFLOW_RECONCILE_CORE_DIRECTORY: "1",
  AUDITFLOW_LOCAL_ADMIN_PASSWORD_SYNC: "1",
  AUDITFLOW_BOOTSTRAP_ADMIN_PASSWORD: "DifferentConfiguredPassword-2026!",
  AUDITFLOW_BOOTSTRAP_MBEAL_LEAD_PASSWORD: "SyntheticLeadPassword-2026!"
};

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "auditflow-bootstrap-preserve-"));
  const store = createCollaborationStore({ directory });
  t.after(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return store;
}

async function addAccount(store, { userId = administrator.userId, email = DEFAULT_ADMIN_EMAIL, disabled = false } = {}) {
  await store.createAccount({
    userId, email, displayName: "Preserved Account", disabled,
    passwordSalt: "synthetic-existing-salt",
    passwordHash: passwordDigest("ExistingPassword-2026!", "synthetic-existing-salt")
  });
}

test("ordinary restart keeps the active administrator password and existing sessions", async t => {
  const store = await fixture(t);
  await addAccount(store);
  await store.createSession({
    tokenHash: "synthetic-session-hash",
    userId: administrator.userId,
    expiresAt: new Date(Date.now() + 3600000).toISOString()
  });
  const before = await readFile(store.filePath, "utf8");
  for (let restart = 0; restart < 2; restart++) {
    await bootstrapAuditFlow({
      store, passwordDigest,
      env: {
        AUDITFLOW_SERVER_ROLE: "desktop",
        AUDITFLOW_LOCAL_ADMIN_PASSWORD_SYNC: "1",
        AUDITFLOW_BOOTSTRAP_ADMIN_PASSWORD: "DifferentConfiguredPassword-2026!"
      }
    });
    const account = await store.accountByEmail(DEFAULT_ADMIN_EMAIL);
    assert.equal(account.passwordHash, passwordDigest("ExistingPassword-2026!", account.passwordSalt));
    assert.equal((await store.sessionByTokenHash("synthetic-session-hash")).userId, administrator.userId);
    assert.equal(await readFile(store.filePath, "utf8"), before);
  }
});

test("ordinary startup preserves credentials, disabled state, owners, members and project bytes despite legacy flags", async t => {
  const store = await fixture(t);
  await addAccount(store);
  await addAccount(store, { userId: "EXISTING-MEMBER", email: "member@example.test", disabled: true });
  await store.saveProject("EXISTING-PROJECT", {
    expectedRevision: 0,
    workspaceId: "EXISTING-WORKSPACE",
    snapshot: {
      id: "EXISTING-PROJECT", name: "Preserved assessment",
      evidence: [{ id: "EV-EXISTING", content: "Original evidence" }],
      assessments: [{ id: "ASSESSMENT-EXISTING", code: "SWE.1.BP1", rating: "L", assessorConfirmed: true }],
      traceLinks: [{ id: "TRACE-EXISTING" }], records: []
    }
  }, administrator);
  await store.setMember("EXISTING-PROJECT", {
    userId: "EXISTING-MEMBER", name: "Preserved Member", role: "Viewer",
    processScopes: ["SWE.1"], permissions: { view: true, use: false, forms: false, remarks: false, traceability: false },
    expectedRevision: 1
  }, administrator);
  await store.updateAccount(administrator.userId, { disabled: true });
  const before = await readFile(store.filePath, "utf8");

  const result = await bootstrapAuditFlow({ store, passwordDigest, env: legacyStartup });

  assert.equal(result.preservedExistingData, true);
  assert.deepEqual(result.createdAccounts, []);
  assert.equal(result.reconciliation, null);
  assert.equal(await readFile(store.filePath, "utf8"), before);
});

test("existing non-core users do not trigger administrator creation or secret validation", async t => {
  const store = await fixture(t);
  await addAccount(store, { userId: "LEGACY-USER", email: "legacy@example.test" });
  const before = await readFile(store.filePath, "utf8");
  await bootstrapAuditFlow({
    store, passwordDigest,
    env: { AUDITFLOW_SERVER_ROLE: "desktop", AUDITFLOW_BOOTSTRAP_CORE_PROJECTS: "1", AUDITFLOW_BOOTSTRAP_MBEAL: "1" }
  });
  assert.equal(await readFile(store.filePath, "utf8"), before);
  assert.equal(await store.accountByEmail(DEFAULT_ADMIN_EMAIL), null);
});

test("legacy project-only stores are preserved before first-run account provisioning", async t => {
  const store = await fixture(t);
  await store.saveProject("ORPHANED-LEGACY-PROJECT", {
    expectedRevision: 0, snapshot: { id: "ORPHANED-LEGACY-PROJECT", name: "Legacy data", evidence: [], assessments: [], records: [] }
  }, administrator);
  const before = await readFile(store.filePath, "utf8");
  const result = await bootstrapAuditFlow({ store, passwordDigest, env: legacyStartup });
  assert.equal(result.preservedExistingData, true);
  assert.equal(await readFile(store.filePath, "utf8"), before);
});

test("empty stores may provision an explicitly configured first-run administrator", async t => {
  const store = await fixture(t);
  const result = await bootstrapAuditFlow({
    store, passwordDigest,
    env: { AUDITFLOW_BOOTSTRAP_ADMIN_PASSWORD: "FirstRunPassword-2026!" }
  });
  assert.deepEqual(result.createdAccounts, [DEFAULT_ADMIN_EMAIL]);
  const created = await store.accountByEmail(DEFAULT_ADMIN_EMAIL);
  assert.equal(created.passwordHash, passwordDigest("FirstRunPassword-2026!", created.passwordSalt));
  assert.equal(await store.countAccounts(), 1);
});

test("unknown bootstrap operations fail before changing existing data", async t => {
  const store = await fixture(t);
  await addAccount(store);
  const before = await readFile(store.filePath, "utf8");
  await assert.rejects(
    bootstrapAuditFlow({ store, passwordDigest, env: legacyStartup, operation: "upgrade-and-clean" }),
    /Unsupported bootstrap operation/
  );
  assert.equal(await readFile(store.filePath, "utf8"), before);
});
