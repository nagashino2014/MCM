// test:mail-push 전용 가짜 @/lib/db — exec 는 시험이 정한 행을 그대로 돌려주고 호출을 기록한다.
type Row = Record<string, unknown>;
let provider: (sql: string, params: unknown[]) => Row[] = () => [];
export const dbCalls: { sql: string; params: unknown[] }[] = [];

export function setDbRows(fn: (sql: string, params: unknown[]) => Row[]): void {
  provider = fn;
}

const db = {
  async exec(sql: string, params: unknown[] = []): Promise<Row[]> {
    dbCalls.push({ sql, params });
    return provider(sql, params);
  },
  async run(sql: string, params: unknown[] = []): Promise<void> {
    dbCalls.push({ sql, params });
  },
};

export async function getDb(): Promise<typeof db> {
  return db;
}

export async function withDbWrite<T>(fn: (d: typeof db) => Promise<T> | T): Promise<T> {
  return fn(db);
}

export function rowsToObjects(rows: Row[]): Row[] {
  return rows;
}
