// test:asset-range-booking 전용 가짜 @/lib/db — 시험이 globalThis.__assetStoreDb 에 넣은 가짜 DB 를 돌려준다.
export type PgDatabase = {
  exec: (sql: string, args?: unknown[]) => Promise<{ columns: string[]; values: unknown[][] }[]>;
  run: (sql: string, args?: unknown[]) => Promise<void>;
};

const current = (): PgDatabase => {
  const db = (globalThis as { __assetStoreDb?: PgDatabase }).__assetStoreDb;
  if (!db) throw new Error("가짜 DB 가 설정되지 않았습니다.");
  return db;
};

export async function getDb(): Promise<PgDatabase> {
  return current();
}

export async function withDbWrite<T>(fn: (db: PgDatabase) => Promise<T> | T): Promise<T> {
  return fn(current());
}

export function rowsToObjects(result: { columns: string[]; values: unknown[][] }[]): Array<Record<string, unknown>> {
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
}
