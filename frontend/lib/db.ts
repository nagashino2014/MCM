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
  command?: string;
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
  fields: PgFieldDef[];
};
type PgClient = {
  query: (text: string, values?: unknown[]) => Promise<PgQueryResult>;
  release: (err?: Error | boolean) => void;
  on: (event: "error", listener: (error: Error) => void) => unknown;
  removeListener: (event: "error", listener: (error: Error) => void) => unknown;
};
type PgPool = {
  query: (text: string, values?: unknown[]) => Promise<PgQueryResult>;
  connect: () => Promise<PgClient>;
  end: () => Promise<void>;
};
type PgPoolConfig = {
  connectionString?: string;
  max?: number;
  application_name?: string;
  ssl?: boolean | { rejectUnauthorized?: boolean };
};
type PgPoolCtor = new (config: PgPoolConfig) => PgPool;

let pool: PgPool | null = null;

function buildConnectionStringFromParts(): string | null {
  const host = process.env.PGHOST;
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  const database = process.env.PGDATABASE;
  if (!host || !user || !password || !database) return null;
  const port = process.env.PGPORT || "5432";
  const encodedUser = encodeURIComponent(user);
  const encodedPassword = encodeURIComponent(password);
  return `postgresql://${encodedUser}:${encodedPassword}@${host}:${port}/${database}`;
}

async function getPool(): Promise<PgPool> {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL || buildConnectionStringFromParts();
  if (!connectionString) {
    throw new Error("DATABASE_URL or PGHOST/PGUSER/PGPASSWORD/PGDATABASE is required to access the application database.");
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
  fn: (db: PgDatabase) => Promise<T> | T,
  options?: { accountingSnapshot?: boolean },
): Promise<T> {
  const p = await getPool();
  const client = await p.connect();
  let transactionStarted = false;
  const accountingSessionLocks: number[] = [];
  let discardClient: Error | undefined;
  // 대여 중에는 pool의 유휴 오류 처리가 제거되므로 연결 오류를 직접 받아 폐기한다.
  const onClientError = (error: Error) => { discardClient ??= error; };
  client.on("error", onClientError);
  try {
    if (options?.accountingSnapshot) {
      // Acquire BEFORE BEGIN: a repeatable-read snapshot taken while waiting for
      // the previous accounting writer could miss its newly inserted closing.
      try {
        // Match journal -> expense ordering, and start the snapshot only after
        // both the previous closing/source writer and meal disposition finish.
        for (const domain of [1296256326, 724303]) {
          await client.query("SELECT pg_advisory_lock($1, 1)", [domain]);
          accountingSessionLocks.push(domain);
        }
      } catch (error) {
        discardClient = error instanceof Error ? error : new Error("Accounting session lock failed");
        throw error;
      }
    }
    await client.query(options?.accountingSnapshot ? "BEGIN ISOLATION LEVEL REPEATABLE READ" : "BEGIN");
    transactionStarted = true;
    const db = new PgDatabase(client);
    const result = await fn(db);
    if (discardClient) throw discardClient;
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      if (transactionStarted) await client.query("ROLLBACK");
    } catch {
      discardClient = new Error("Rollback failed; connection must not return to pool");
    }
    throw err;
  } finally {
    for (const domain of accountingSessionLocks.reverse()) {
      if (discardClient) break;
      try {
        const unlocked = await client.query("SELECT pg_advisory_unlock($1, 1) AS unlocked", [domain]);
        if (unlocked.rows[0]?.unlocked !== true) discardClient = new Error("Accounting session unlock failed");
      } catch {
        discardClient = new Error("Accounting session unlock failed; connection must not return to pool");
      }
    }
    // Discarding also releases any session lock on a broken/uncertain connection.
    try {
      client.release(discardClient);
    } finally {
      // 정상 반납 시 pool의 유휴 listener가 먼저 복원된 뒤 이 대여의 listener만 제거한다.
      client.removeListener("error", onClientError);
    }
  }
}

/**
 * 같은 연결의 고정 스냅샷으로 조회한다. 회계 쓰기용 세션 잠금은 얻지 않는다.
 * callback은 이 db만 사용하며, 조회 결과를 쓰기 허가로 재사용하지 않는다.
 */
export async function withDbRead<T>(fn: (db: PgDatabase) => Promise<T> | T): Promise<T> {
  const client = await (await getPool()).connect();
  let transactionStarted = false;
  let discardClient: Error | undefined;
  const onClientError = (error: Error) => { discardClient ??= error; };
  client.on("error", onClientError);
  try {
    // BEGIN 응답이 불명확해도 ROLLBACK을 시도하고, 실패한 연결은 폐기한다.
    transactionStarted = true;
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await fn(new PgDatabase(client));
    if (discardClient) throw discardClient;
    const committed = await client.query("COMMIT");
    if (committed.command !== "COMMIT") throw new Error("Read transaction did not commit");
    if (discardClient) throw discardClient;
    return result;
  } catch (error) {
    try {
      if (transactionStarted) await client.query("ROLLBACK");
    } catch {
      discardClient = new Error("Read transaction rollback failed; connection must not return to pool");
    }
    throw error;
  } finally {
    try {
      client.release(discardClient);
    } finally {
      client.removeListener("error", onClientError);
    }
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
