import crypto from "node:crypto";
import { promisify } from "node:util";
import { mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import net from "node:net";

const scrypt = promisify(crypto.scrypt);

export function parseRecoveryConfig(text) {
  const values = Object.create(null);
  for (const [index, line] of String(text).split(/\r?\n/).entries()) {
    const source = line.trimStart();
    if (!source || source.startsWith("#")) continue;
    const invalid = () => new Error(`Unsupported local recovery configuration syntax at line ${index + 1}`);
    const assignment = source.match(/^(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!assignment || Object.hasOwn(values, assignment[1])) throw invalid();
    const [, key, raw] = assignment;
    let value = "", position = 0;
    const quote = ['"', "'"].includes(raw[0]) ? raw[position++] : "";
    let closed = !quote;
    while (position < raw.length) {
      const character = raw[position++];
      if (quote && character === quote) { closed = true; break; }
      if (quote === "'") { value += character; continue; }
      if (character === "\\") {
        if (position === raw.length) throw invalid();
        const next = raw[position++];
        value += quote === '"' && !['$', '`', '"', "\\"].includes(next) ? `\\${next}` : next;
        continue;
      }
      if (character === "$" || character === "`") throw invalid();
      if (!quote) {
        if (/[ \t]/.test(character)) {
          position--;
          break;
        }
        if (character === "#" && position === 1) { position = raw.length; break; }
        if (['"', "'", "~"].includes(character) || /[;&|<>()]/.test(character)) throw invalid();
      }
      value += character;
    }
    if (!closed || !/^(?:[ \t]+(?:#.*)?)?$/.test(raw.slice(position))) throw invalid();
    values[key] = value;
  }
  return values;
}

function authenticationPortIsOpen(port, host) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let finished = false;
    const finish = (error, open) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      if (error) reject(new Error("Could not confirm the 7.7 authentication service is stopped"));
      else resolve(open);
    };
    socket.setTimeout(1500, () => finish(true));
    socket.once("connect", () => finish(null, true));
    socket.once("error", error => finish(error.code === "ECONNREFUSED" ? null : error, false));
  });
}

export async function assertAuthenticationStopped({ port } = {}) {
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    throw new Error("A valid authentication port is required for account recovery");
  }
  for (const host of ["127.0.0.1", "::1"]) {
    if (await authenticationPortIsOpen(numericPort, host)) {
      throw new Error("Stop the 7.7 authentication service before applying account recovery");
    }
  }
}

export async function credentialMatches(password, account) {
  const actual = Buffer.from(await scrypt(String(password), String(account.password_salt), 64));
  const expected = Buffer.from(String(account.password_hash), "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function privateBackup(filename, value) {
  const file = await open(filename, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await file.sync();
  } finally { await file.close(); }
}

export async function recoverAccount({ connection, email, password, database, backupDir, confirmation }) {
  email = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("A valid target account email is required");
  if (!/^jeauditflow_[0-9]+$/.test(database || "")) throw new Error("An explicit local database is required");
  if (confirmation !== `RESET ${database} ${email}`) throw new Error("Account recovery confirmation does not match target");
  if (typeof password !== "string" || password.length < 10 || password.length > 200) {
    throw new Error("Recovery password must contain 10-200 characters");
  }
  if (!backupDir || !path.isAbsolute(backupDir)) throw new Error("An absolute private backup directory is required");
  const [[identity]] = await connection.query("SELECT DATABASE() AS name");
  if (identity?.name !== database) throw new Error("Connected database does not match recovery target");

  let jobDir;
  let commitAttempted = false;
  const evidence = { operation: "account-password-recovery", database, startedAt: new Date().toISOString(), status: "prepared" };
  await connection.beginTransaction();
  try {
    const [accounts] = await connection.execute(
      "SELECT * FROM auditflow_accounts WHERE lower(email) = ? FOR UPDATE", [email]
    );
    if (accounts.length !== 1 || accounts[0].disabled) throw new Error("Expected exactly one active existing account");
    const account = accounts[0];
    evidence.accountRef = crypto.createHash("sha256").update(account.user_id).digest("hex").slice(0, 16);
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    jobDir = path.join(backupDir, `account-recovery-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`);
    await mkdir(jobDir, { mode: 0o700 });
    const backupPath = path.join(jobDir, "account-before.json");
    await privateBackup(backupPath, { database, account, createdAt: evidence.startedAt });
    await privateBackup(path.join(jobDir, "recovery.json"), evidence);

    const salt = crypto.randomBytes(24).toString("hex");
    const digest = Buffer.from(await scrypt(password, salt, 64)).toString("hex");
    const [updated] = await connection.execute(
      "UPDATE auditflow_accounts SET password_hash = ?, password_salt = ? WHERE user_id = ?",
      [digest, salt, account.user_id]
    );
    if (updated.affectedRows !== 1) throw new Error("Account recovery update did not affect exactly one account");
    const [deleted] = await connection.execute("DELETE FROM auditflow_sessions WHERE user_id = ?", [account.user_id]);
    const [verified] = await connection.execute(
      "SELECT password_hash, password_salt FROM auditflow_accounts WHERE user_id = ?", [account.user_id]
    );
    if (verified.length !== 1 || !(await credentialMatches(password, verified[0]))) {
      throw new Error("Credential verification failed; recovery transaction must roll back");
    }
    commitAttempted = true;
    await connection.commit();
    evidence.status = "recovered";
    evidence.completedAt = new Date().toISOString();
    evidence.revokedSessions = deleted.affectedRows;
    try {
      await writeFile(path.join(jobDir, "recovery.json"), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    } catch {
      evidence.auditStatus = "completion-record-write-failed";
    }
    return { ...evidence, backupPath };
  } catch (error) {
    await connection.rollback().catch(() => {});
    evidence.status = commitAttempted ? "commit-unknown-verify-before-retry" : "rolled-back";
    if (jobDir) {
      await writeFile(path.join(jobDir, "recovery.json"), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 }).catch(() => {});
    }
    if (commitAttempted) throw new Error("Account recovery commit outcome is uncertain; inspect account before retrying");
    throw error;
  }
}
