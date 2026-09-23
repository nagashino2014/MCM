import { Pool } from "pg";
import type { Database, Transaction } from "./store";

function requiredDatabaseRole(): string | null {
  const expected = process.env.MCM_DB_EXPECTED_ROLE?.trim() ?? "";
  const required = process.env.NODE_ENV === "production" || process.env.MCM_DB_ROLE_REQUIRED === "true";
  if (!expected) {
    if (required) throw new Error("MCM_DB_EXPECTED_ROLE is required for this database client.");
    return null;
  }
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(expected)) throw new Error("MCM_DB_EXPECTED_ROLE is invalid.");
  return expected;
}

export async function assertQualityDatabaseRole(client: {
  query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<void> {
  const expected = requiredDatabaseRole();
  if (!expected) return;
  const result = await client.query("SELECT current_user::text AS current_user, session_user::text AS session_user");
  const row = result.rows[0];
  if (row?.current_user !== expected || row?.session_user !== expected) {
    throw new Error(`Database role mismatch: expected ${expected}.`);
  }
}

export function connectQualityDb() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4,
    application_name: process.env.PGAPPNAME || "mcm-quality-worker",
    ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED === "true" } });
  const ready = assertQualityDatabaseRole(pool);
  const wrap = (client: { query(sql: string, values?: unknown[]): Promise<any> }): Database => ({
    async exec(sql, params = []) { await ready; const r = await client.query(sql, params); return r.fields?.length ? [{ columns: r.fields.map((f: any) => f.name), values: r.rows.map((row: any) => r.fields.map((f: any) => row[f.name])) }] : []; },
    async run(sql, params = []) { await ready; await client.query(sql, params); },
  });
  const tx: Transaction = async fn => { await ready; const client = await pool.connect(); try { await client.query("BEGIN"); const r = await fn(wrap(client)); await client.query("COMMIT"); return r; } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); } };
  return { db: wrap(pool), tx, ready, close: () => pool.end() };
}
