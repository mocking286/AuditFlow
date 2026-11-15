import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import * as recovery from "./account-recovery.mjs";

const { recoverAccount } = recovery;

const scrypt = promisify(crypto.scrypt);
const executeNode = promisify(execFile);
const original = {
  user_id: "user-existing", email: "admin@example.test", display_name: "Assessor",
  password_hash: "original-hash", password_salt: "original-salt",
  disabled: 0, created_at: "2025-01-01", updated_at: "2026-01-01"
};

// A transactional substitute at the MySQL boundary keeps account/filesystem logic real.
function database({ failVerification = false, failCommit = false, loseCommitAck = false, disabled = false } = {}) {
  let row = structuredClone(original);
  if (disabled) row.disabled = 1;
  let sessions = [
    { token: "session-a", userId: original.user_id },
    { token: "session-b", userId: original.user_id },
    { token: "other-user-session", userId: "other-user" }
  ];
  let saved;
  let committed = false;
  return {
    get state() { return { row, sessions, committed }; },
    async beginTransaction() { saved = { row: structuredClone(row), sessions: [...sessions] }; },
    async query(sql) {
      if (sql === "SELECT DATABASE() AS name") return [[{ name: "jeauditflow_770" }]];
      throw new Error("Unexpected query");
    },
    async execute(sql, params) {
      if (sql.startsWith("SELECT * FROM auditflow_accounts")) {
        return [[...(params[0] === row.email ? [structuredClone(row)] : [])]];
      }
      if (sql.startsWith("UPDATE auditflow_accounts")) {
        assert.equal(params[2], row.user_id);
        row.password_hash = params[0];
        row.password_salt = params[1];
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("DELETE FROM auditflow_sessions")) {
        assert.equal(params[0], row.user_id);
        const n = sessions.length;
        sessions = sessions.filter(session => session.userId !== params[0]);
        return [{ affectedRows: n - sessions.length }];
      }
      if (sql.startsWith("SELECT password_hash")) {
        return [[{ password_hash: failVerification ? "bad" : row.password_hash, password_salt: row.password_salt }]];
      }
      throw new Error("Unexpected execute");
    },
    async commit() {
      if (failCommit) throw new Error("Connection lost");
      committed = true;
      if (loseCommitAck) throw new Error("Commit acknowledgement lost");
    },
    async rollback() { if (saved && !committed) { row = saved.row; sessions = saved.sessions; } }
  };
}

async function withBackup(fn) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "auditflow-recovery-test-"));
  try { await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

const parameters = directory => ({
  email: "admin@example.test", password: "synthetic-reset-secret",
  database: "jeauditflow_770", backupDir: directory,
  confirmation: "RESET jeauditflow_770 admin@example.test"
});

test("recovery config parses simple shell literals without preserving quoting syntax", () => {
  const env = recovery.parseRecoveryConfig([
    "# Synthetic local-only configuration",
    "MYSQL_DATABASE=jeauditflow_770",
    "export AUDITFLOW_PORT=47683",
    "AUDITFLOW_ADMIN_EMAIL='admin@example.test'",
    "AUDITFLOW_BOOTSTRAP_ADMIN_PASSWORD='synthetic $literal password'",
    'MYSQL_PASSWORD="synthetic\\$password\\\\path\\\"quote"',
    "PLAIN_ESCAPED=synthetic\\$literal\\ password",
    "EMPTY= # Empty literal",
    "HASH=synthetic#literal # Trailing comment",
    'DOUBLE_BACKSLASH="synthetic\\q"'
  ].join("\n"));
  assert.equal(env.MYSQL_DATABASE, "jeauditflow_770");
  assert.equal(env.AUDITFLOW_PORT, "47683");
  assert.equal(env.AUDITFLOW_ADMIN_EMAIL, "admin@example.test");
  assert.equal(env.AUDITFLOW_BOOTSTRAP_ADMIN_PASSWORD, "synthetic $literal password");
  assert.equal(env.MYSQL_PASSWORD, 'synthetic$password\\path"quote');
  assert.equal(env.PLAIN_ESCAPED, "synthetic$literal password");
  assert.equal(env.EMPTY, "");
  assert.equal(env.HASH, "synthetic#literal");
  assert.equal(env.DOUBLE_BACKSLASH, "synthetic\\q");
});

test("recovery config fails closed on expansion, commands, concatenation and duplicate assignments", () => {
  for (const text of [
    "PASSWORD=$HOME", 'PASSWORD="${HOME}"', "PASSWORD=$(id)", "PASSWORD=`id`",
    'PASSWORD="`id`"', "PASSWORD=~/secret", "PASSWORD=secret;id", "PASSWORD=secret other",
    "PASSWORD=secret|id", "PASSWORD='unterminated", 'PASSWORD="unterminated',
    'PASSWORD="first"second', 'PASSWORD="first"#second',
    "PASSWORD=one\nPASSWORD=two", "source other.env", "PASSWORD=$'ansi-escaped'"
  ]) {
    assert.throws(() => recovery.parseRecoveryConfig(text), /Unsupported local recovery configuration syntax/);
  }
});

test("recovery requires the authentication listener to stop before allowing maintenance", async t => {
  const server = net.createServer(socket => socket.end());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => { if (server.listening) server.close(); });
  const port = server.address().port;
  await assert.rejects(recovery.assertAuthenticationStopped({ port }), /Stop the 7\.7 authentication service/);
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await recovery.assertAuthenticationStopped({ port });
  await assert.rejects(recovery.assertAuthenticationStopped({ port: 0 }), /valid authentication port/);
});

test("CLI blocks live apply before connecting to the database and keeps live check read-only", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "auditflow-recovery-cli-"));
  const scripts = path.join(root, "local-deploy/scripts");
  const config = path.join(root, "local-deploy/config");
  const driver = path.join(root, "local-deploy/runtime/versions/7.7.0/server/node_modules/mysql2");
  const connectedMarker = path.join(root, "database-connected");
  await Promise.all([scripts, config, driver].map(directory => mkdir(directory, { recursive: true })));
  for (const file of ["account-recovery.mjs", "recover-configured-admin.mjs"]) {
    await cp(new URL(file, import.meta.url), path.join(scripts, file));
  }
  const server = net.createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(config, "7.7.local.env"), [
    "MYSQL_DATABASE=jeauditflow_770", "DB_PORT=43324",
    "MYSQL_USER=synthetic", "MYSQL_PASSWORD=synthetic-database-password",
    `AUDITFLOW_PORT=${server.address().port}`,
    "AUDITFLOW_ADMIN_EMAIL=admin@example.test",
    "AUDITFLOW_BOOTSTRAP_ADMIN_PASSWORD='synthetic $literal password'"
  ].join("\n"));
  const salt = "synthetic-salt";
  const hash = Buffer.from(await scrypt("synthetic $literal password", salt, 64)).toString("hex");
  await writeFile(path.join(driver, "package.json"), '{"type":"module"}');
  await writeFile(path.join(driver, "promise.js"), `
import { writeFile } from "node:fs/promises";
export default { async createConnection() {
  await writeFile(${JSON.stringify(connectedMarker)}, "connected");
  return {
    async query(sql) { if (sql !== "START TRANSACTION READ ONLY") throw new Error("Unexpected SQL"); },
    async execute(sql) {
      if (!sql.startsWith("SELECT password_hash")) throw new Error("Unexpected write");
      return [[{ password_hash: ${JSON.stringify(hash)}, password_salt: ${JSON.stringify(salt)}, disabled: 0 }]];
    },
    async rollback() {}, async end() {}
  };
} };
`);
  const command = path.join(scripts, "recover-configured-admin.mjs");
  await assert.rejects(executeNode(process.execPath, [command, "--apply", "--restore-configured-admin"], {
    env: { ...process.env, JEAUDITFLOW_CONFIRM_ACCOUNT_RECOVERY: "RESET jeauditflow_770 admin@example.test" }
  }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Stop the 7\.7 authentication service before --apply/);
    assert.equal(error.stderr.includes("synthetic $literal password"), false);
    return true;
  });
  await assert.rejects(stat(connectedMarker), { code: "ENOENT" });
  const checked = await executeNode(process.execPath, [command, "--check", "--restore-configured-admin"]);
  assert.deepEqual(JSON.parse(checked.stdout), {
    mode: "read-only", database: "jeauditflow_770", accountFound: true, active: true, configuredCredentialMatches: true
  });
  assert.equal(await readFile(connectedMarker, "utf8"), "connected");
});

test("recovery changes only credentials and invalidates only the target sessions", async () => {
  await withBackup(async directory => {
    const connection = database();
    const result = await recoverAccount({ connection, ...parameters(directory) });
    assert.equal(connection.state.committed, true);
    assert.deepEqual(connection.state.sessions, [{ token: "other-user-session", userId: "other-user" }]);
    const { password_hash, password_salt, ...rest } = connection.state.row;
    const { password_hash: oldHash, password_salt: oldSalt, ...before } = original;
    assert.deepEqual(rest, before);
    assert.notEqual(password_hash, oldHash);
    assert.notEqual(password_salt, oldSalt);
    assert.equal(password_hash, Buffer.from(await scrypt("synthetic-reset-secret", password_salt, 64)).toString("hex"));
    assert.equal(result.revokedSessions, 2);
    assert.equal(result.status, "recovered");
    assert.ok(!JSON.stringify(result).includes("synthetic-reset-secret"));
    const backup = JSON.parse(await readFile(result.backupPath, "utf8"));
    assert.deepEqual(backup.account, original);
    assert.ok(!JSON.stringify(backup).includes("synthetic-reset-secret"));
    assert.equal((await stat(result.backupPath)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(result.backupPath))).mode & 0o777, 0o700);
  });
});

test("wrong confirmation or database performs no recovery and writes no backup", async () => {
  await withBackup(async directory => {
    for (const override of [{ confirmation: "" }, { database: "jeauditflow_710" }]) {
      const connection = database();
      await assert.rejects(recoverAccount({ connection, ...parameters(directory), ...override }));
      assert.deepEqual(connection.state.row, original);
      assert.equal(connection.state.committed, false);
    }
    assert.deepEqual(await readdir(directory), []);
  });
});

test("verification failure rolls credentials and sessions back, retaining private recovery backup", async () => {
  await withBackup(async directory => {
    const connection = database({ failVerification: true });
    await assert.rejects(recoverAccount({ connection, ...parameters(directory) }), /verification/i);
    assert.deepEqual(connection.state.row, original);
    assert.equal(connection.state.sessions.length, 3);
    assert.equal(connection.state.committed, false);
    const jobs = await readdir(directory);
    assert.equal(jobs.length, 1);
    const evidence = JSON.parse(await readFile(path.join(directory, jobs[0], "recovery.json"), "utf8"));
    assert.equal(evidence.status, "rolled-back");
  });
});

test("missing target and weak password never create a replacement account", async () => {
  await withBackup(async directory => {
    const connection = database();
    await assert.rejects(recoverAccount({
      connection, ...parameters(directory), email: "missing@example.test",
      confirmation: "RESET jeauditflow_770 missing@example.test"
    }), /account/i);
    await assert.rejects(recoverAccount({ connection, ...parameters(directory), password: "short" }), /password/i);
    assert.deepEqual(connection.state.row, original);
    assert.deepEqual(await readdir(directory), []);
  });
});

test("disabled accounts cannot be silently reactivated by recovery", async () => {
  await withBackup(async directory => {
    const connection = database({ disabled: true });
    await assert.rejects(recoverAccount({ connection, ...parameters(directory) }), /active existing account/i);
    assert.equal(connection.state.row.disabled, 1);
    assert.equal(connection.state.committed, false);
    assert.deepEqual(await readdir(directory), []);
  });
});

test("uncertain commit is recorded separately so operators cannot blindly retry", async () => {
  await withBackup(async directory => {
    const connection = database({ failCommit: true });
    await assert.rejects(recoverAccount({ connection, ...parameters(directory) }), /outcome is uncertain/i);
    const [job] = await readdir(directory);
    const evidence = JSON.parse(await readFile(path.join(directory, job, "recovery.json"), "utf8"));
    assert.equal(evidence.status, "commit-unknown-verify-before-retry");
    assert.equal(connection.state.committed, false);
  });
});

test("lost commit acknowledgement stays uncertain when the database already committed", async () => {
  await withBackup(async directory => {
    const connection = database({ loseCommitAck: true });
    await assert.rejects(recoverAccount({ connection, ...parameters(directory) }), /outcome is uncertain/i);
    const [job] = await readdir(directory);
    const evidence = JSON.parse(await readFile(path.join(directory, job, "recovery.json"), "utf8"));
    assert.equal(evidence.status, "commit-unknown-verify-before-retry");
    assert.equal(connection.state.committed, true);
    assert.notEqual(connection.state.row.password_hash, original.password_hash);
    assert.deepEqual(connection.state.sessions, [{ token: "other-user-session", userId: "other-user" }]);
  });
});
