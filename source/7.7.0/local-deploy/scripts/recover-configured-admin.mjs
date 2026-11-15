import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { recoverAccount, credentialMatches, parseRecoveryConfig, assertAuthenticationStopped } from "./account-recovery.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const allowed = new Set(["--check", "--apply", "--restore-configured-admin"]);
  if (args.some(argument => !allowed.has(argument)) || !args.includes("--restore-configured-admin") ||
      (args.includes("--check") && apply)) {
    throw new Error("Use --check or --apply with --restore-configured-admin; passwords are never accepted in arguments");
  }
  const env = parseRecoveryConfig(await fs.readFile(path.join(project, "local-deploy/config/7.7.local.env"), "utf8"));
  if (env.MYSQL_DATABASE !== "jeauditflow_770" || Number(env.DB_PORT) !== 43324) {
    throw new Error("Configured database is not the expected 7.7 local target");
  }
  const email = String(env.AUDITFLOW_ADMIN_EMAIL || env.AUDITFLOW_BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = env.AUDITFLOW_BOOTSTRAP_ADMIN_PASSWORD || env.AUDITFLOW_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Local administrator recovery configuration is incomplete");
  if (apply) await assertAuthenticationStopped({ port: env.AUDITFLOW_PORT });
  const { default: mysql } = await import(pathToFileURL(
    path.join(project, "local-deploy/runtime/versions/7.7.0/server/node_modules/mysql2/promise.js")
  ).href);
  const connection = await mysql.createConnection({
    host: "127.0.0.1", port: Number(env.DB_PORT), user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD, database: env.MYSQL_DATABASE
  });
  try {
    if (!apply) {
      await connection.query("START TRANSACTION READ ONLY");
      const [accounts] = await connection.execute(
        "SELECT password_hash, password_salt, disabled FROM auditflow_accounts WHERE lower(email) = ?", [email]
      );
      console.log(JSON.stringify({
        mode: "read-only", database: env.MYSQL_DATABASE, accountFound: accounts.length === 1,
        active: accounts.length === 1 && !accounts[0].disabled,
        configuredCredentialMatches: accounts.length === 1 ? await credentialMatches(password, accounts[0]) : false
      }));
      await connection.rollback();
      return;
    }
    const result = await recoverAccount({
      connection, database: env.MYSQL_DATABASE, email, password,
      backupDir: path.join(project, "local-deploy/backups/account-recovery"),
      confirmation: process.env.JEAUDITFLOW_CONFIRM_ACCOUNT_RECOVERY
    });
    console.log(JSON.stringify(result, null, 2));
  } finally { await connection.end(); }
}

main().catch(() => {
  console.error("Account recovery did not complete. Stop the 7.7 authentication service before --apply; check target/configuration/confirmation and private recovery status before retrying. No credentials were printed.");
  process.exitCode = 1;
});
