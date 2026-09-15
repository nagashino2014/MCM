import { Pool } from "pg";
import type { Database, Transaction } from "./store";
export function connectQualityDb() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4,
    ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED === "true" } });
  const wrap = (client: { query(sql: string, values?: unknown[]): Promise<any> }): Database => ({
    async exec(sql, params = []) { const r = await client.query(sql, params); return r.fields?.length ? [{ columns: r.fields.map((f: any) => f.name), values: r.rows.map((row: any) => r.fields.map((f: any) => row[f.name])) }] : []; },
    async run(sql, params = []) { await client.query(sql, params); },
  });
  const tx: Transaction = async fn => { const client = await pool.connect(); try { await client.query("BEGIN"); const r = await fn(wrap(client)); await client.query("COMMIT"); return r; } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); } };
  return { db: wrap(pool), tx, close: () => pool.end() };
}
