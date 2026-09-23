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
    poolPromise = import("pg").then(async ({ Pool }) => {
      const candidate = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: Number(process.env.PG_POOL_MAX || 10),
        ssl:
          process.env.PGSSL === "disable"
            ? false
            : { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED === "true" },
      });
      const expected = process.env.MCM_DB_EXPECTED_ROLE?.trim() ?? "";
      const required = process.env.NODE_ENV === "production" || process.env.MCM_DB_ROLE_REQUIRED === "true";
      if (!expected) {
        if (required) {
          await candidate.end();
          throw new Error("MCM_DB_EXPECTED_ROLE is required for this database client.");
        }
        return candidate;
      }
      if (!/^[a-z_][a-z0-9_]{0,62}$/.test(expected)) {
        await candidate.end();
        throw new Error("MCM_DB_EXPECTED_ROLE is invalid.");
      }
      try {
        const result = await candidate.query("SELECT current_user::text AS current_user, session_user::text AS session_user");
        if (result.rows[0]?.current_user !== expected || result.rows[0]?.session_user !== expected) {
          throw new Error(`Database role mismatch: expected ${expected}.`);
        }
      } catch (error) {
        await candidate.end();
        throw error;
      }
      return candidate;
    }).catch((error) => {
      poolPromise = null;
      throw error;
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
