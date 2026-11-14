import crypto from "node:crypto";
import { normalizePublicContentBatch, publicContentIdempotencyKey } from "./local-content-contract.mjs";

function localMysqlOptions(connectionString) {
  const parsed = new URL(connectionString);
  if (parsed.protocol !== "mysql:" || !["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname)) {
    throw new Error("The local content catalog accepts MySQL connections on loopback only");
  }
  return {
    host: parsed.hostname.replace(/^\[|\]$/g, ""),
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    timezone: "Z",
    connectionLimit: 4,
    waitForConnections: true,
    queueLimit: 100
  };
}

export async function createLocalContentStore({ url, pool: injectedPool } = {}) {
  if (!url && !injectedPool) throw new Error("AUDITFLOW_CONTENT_MYSQL_URL is required");
  let pool = injectedPool;
  if (!pool) {
    const mysql = await import("mysql2/promise");
    pool = mysql.default.createPool(localMysqlOptions(url));
  }

  async function queuePublicChanges(input) {
    const changes = normalizePublicContentBatch(input);
    if (!changes.length) return { queued: 0, duplicates: 0, cloudSync: "not-configured" };
    const connection = await pool.getConnection();
    let queued = 0;
    let duplicates = 0;
    try {
      await connection.beginTransaction();
      for (const change of changes) {
        const idempotencyKey = publicContentIdempotencyKey(change);
        const [result] = await connection.execute(
          `INSERT INTO sync_outbox
            (event_id, idempotency_key, aggregate_type, aggregate_key, operation, local_version, payload)
           VALUES (?, ?, 'content_revision', ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
          [
            crypto.randomUUID(),
            idempotencyKey,
            `${change.contentKey}#${change.revision}`,
            change.operation,
            change.revision,
            JSON.stringify(change)
          ]
        );
        if (Number(result.affectedRows) === 1) queued += 1;
        else duplicates += 1;
      }
      await connection.commit();
      return { queued, duplicates, cloudSync: "not-configured" };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function pendingCount() {
    const [rows] = await pool.execute("SELECT COUNT(*) AS pending FROM sync_outbox WHERE status IN ('pending','retry')");
    return Number(rows[0]?.pending || 0);
  }

  return {
    queuePublicChanges,
    pendingCount,
    close: injectedPool ? async () => {} : () => pool.end()
  };
}
