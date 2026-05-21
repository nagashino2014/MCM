/**
 * Frontend Aurora PostgreSQL access layer.
 *
 * The earlier SQLite (sql.js) implementation backed every API route during
 * local development. AWS staging and onwards run on Aurora PostgreSQL, so this
 * module now exposes a sql.js-compatible *asynchronous* wrapper (PgDatabase)
 * that lets call sites migrate with minimal churn:
 *
 *   const db = await getDb();
 *   const r = await db.exec("SELECT ... WHERE x = $1", [value]);
 *
 * SQL itself must use PostgreSQL syntax ($1, $2 placeholders, ON CONFLICT,
 * COALESCE, etc.). The previous SQLite-only forms (?, INSERT OR REPLACE,
 * GROUP_CONCAT) are rewritten as part of the migration.
 */

type SqlExecResult = { columns: string[]; values: unknown[][] };

// Minimal surface area of node-postgres that we actually use, declared inline
// to avoid the @types/pg ESM-vs-CJS dual-package resolution quirks under
// `moduleResolution: "bundler"`. Runtime is provided by the `pg` package.
type PgFieldDef = { name: string };
type PgQueryResult = {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
  fields: PgFieldDef[];
};
type PgClient = {
  query: (text: string, values?: unknown[]) => Promise<PgQueryResult>;
  release: (err?: Error | boolean) => void;
};
type PgPool = {
  query: (text: string, values?: unknown[]) => Promise<PgQueryResult>;
  connect: () => Promise<PgClient>;
  end: () => Promise<void>;
};
type PgPoolConfig = {
  connectionString?: string;
  max?: number;
  ssl?: boolean | { rejectUnauthorized?: boolean };
};
type PgPoolCtor = new (config: PgPoolConfig) => PgPool;

let pool: PgPool | null = null;

async function getPool(): Promise<PgPool> {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to access the application database.");
  }
  const mod = (await import("pg")) as unknown as { Pool?: PgPoolCtor; default?: { Pool: PgPoolCtor } };
  const PoolCtor: PgPoolCtor = mod.Pool ?? mod.default!.Pool;
  pool = new PoolCtor({
    connectionString,
    max: Number(process.env.PG_POOL_MAX || 10),
    ssl:
      process.env.PGSSL === "disable"
        ? false
        : { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED === "true" },
  });
  return pool;
}

function toExecResult(qr: PgQueryResult): SqlExecResult[] {
  if (!qr.fields || qr.fields.length === 0) return [];
  const columns = qr.fields.map((f) => f.name);
  const values = qr.rows.map((row) =>
    columns.map((c) => (row as Record<string, unknown>)[c])
  );
  return [{ columns, values }];
}

/**
 * sql.js-compatible asynchronous database handle backed by PostgreSQL.
 *
 * All methods are async; existing call sites that previously relied on the
 * synchronous sql.js API must add `await`. Bound parameters use the same
 * positional array shape as sql.js — only the placeholder syntax differs
 * (`$1, $2, ...`).
 */
export class PgDatabase {
  private readonly client: PgPool | PgClient;

  constructor(client: PgPool | PgClient) {
    this.client = client;
  }

  async exec(sql: string, params: unknown[] = []): Promise<SqlExecResult[]> {
    const qr = await this.client.query(sql, params);
    return toExecResult(qr);
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    await this.client.query(sql, params);
  }

  prepare(sql: string): PgPreparedStatement {
    return new PgPreparedStatement(this.client, sql);
  }

  /** Always returns null on PostgreSQL. Retained for sql.js parity. */
  export(): null {
    return null;
  }
}

/**
 * Prepared-statement wrapper that buffers result rows so call sites can
 * iterate with the familiar sql.js `step()` / `getAsObject()` pattern.
 */
export class PgPreparedStatement {
  private readonly client: PgPool | PgClient;
  private readonly sql: string;
  private currentParams: unknown[] = [];
  private buffered: Record<string, unknown>[] = [];
  private cursor = 0;
  private executed = false;

  constructor(client: PgPool | PgClient, sql: string) {
    this.client = client;
    this.sql = sql;
  }

  bind(params: unknown[] = []): boolean {
    this.currentParams = params;
    this.buffered = [];
    this.cursor = 0;
    this.executed = false;
    return true;
  }

  async run(params: unknown[] = []): Promise<void> {
    await this.client.query(this.sql, params);
  }

  async step(): Promise<boolean> {
    if (!this.executed) {
      const qr = await this.client.query(this.sql, this.currentParams);
      this.buffered = qr.rows;
      this.executed = true;
      this.cursor = 0;
    }
    return this.cursor < this.buffered.length;
  }

  getAsObject(): Record<string, unknown> {
    if (this.cursor >= this.buffered.length) return {};
    const row = this.buffered[this.cursor];
    this.cursor += 1;
    return row;
  }

  free(): boolean {
    this.buffered = [];
    this.executed = false;
    this.cursor = 0;
    return true;
  }
}

/**
 * Returns the shared PostgreSQL-backed handle. The pool is created lazily on
 * first call and reused process-wide.
 */
export async function getDb(): Promise<PgDatabase> {
  const p = await getPool();
  return new PgDatabase(p);
}

/**
 * Runs `fn` inside a PostgreSQL transaction. Replaces the previous in-process
 * mutex; PostgreSQL itself enforces write isolation. The signature mirrors
 * the original sql.js helper to minimise churn at call sites.
 */
export async function withDbWrite<T>(
  fn: (db: PgDatabase) => Promise<T> | T
): Promise<T> {
  const p = await getPool();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const db = new PgDatabase(client);
    const result = await fn(db);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // intentional: surface the original error, not a rollback failure
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Converts a sql.js-style exec result into a plain object array. Retained for
 * call sites that still use the legacy shape.
 */
export function rowsToObjects(
  result: SqlExecResult[]
): Array<Record<string, unknown>> {
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => (obj[col] = row[i]));
    return obj;
  });
}

/**
 * Reset hint kept for sql.js parity. PostgreSQL pools manage connections
 * automatically, so this is intentionally a no-op.
 */
export function invalidateDb(): void {
  // intentional no-op for PostgreSQL
}

/**
 * Returns a human-readable identifier for the configured database. Used by the
 * legacy `/api/health` route, which previously surfaced the SQLite file path.
 */
export function getDbPath(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return "(DATABASE_URL not set)";
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "(invalid DATABASE_URL)";
  }
}
