/**
 * PostgreSQL access layer for AWS migration.
 *
 * Existing sql.js code remains the local default. AWS deployments can move API
 * routes to this pool incrementally by checking `isPostgresEnabled()`.
 */

export function isPostgresEnabled(): boolean {
  return process.env.MCM_DB_DRIVER === "postgres" && Boolean(process.env.DATABASE_URL);
}

let poolPromise: Promise<any> | null = null;

export async function getPgPool(): Promise<any> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when MCM_DB_DRIVER=postgres");
  }
  if (!poolPromise) {
    poolPromise = import("pg").then(({ Pool }) => {
      return new Pool({
        connectionString: process.env.DATABASE_URL,
        max: Number(process.env.PG_POOL_MAX || 10),
        ssl:
          process.env.PGSSL === "disable"
            ? false
            : { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED === "true" },
      });
    });
  }
  return poolPromise;
}

export async function withPgTransaction<T>(fn: (client: any) => Promise<T>): Promise<T> {
  const pool = await getPgPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
