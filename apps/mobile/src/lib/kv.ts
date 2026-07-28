/**
 * 간단 키-값 저장소 (expo-sqlite).
 * 용도: API 응답 캐시(오프라인·재진입 즉시 렌더)와 소소한 사용자 설정(앱 잠금 등).
 * 토큰처럼 민감한 값은 여기 두지 않는다 — 그건 SecureStore(`tokens.ts`) 담당.
 */
import { Platform } from "react-native";
import * as SQLite from "expo-sqlite";

const isWeb = Platform.OS === "web";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync("mcm.db");
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, at INTEGER NOT NULL)`
      );
      return db;
    })();
  }
  return dbPromise;
}

export interface KvEntry<T> {
  value: T;
  /** 저장 시각(ms) — 화면에서 "○○ 기준" 표시에 쓴다. */
  at: number;
}

export async function kvGet<T>(key: string): Promise<KvEntry<T> | null> {
  try {
    if (isWeb) {
      const raw = globalThis.localStorage?.getItem(`kv:${key}`);
      return raw ? (JSON.parse(raw) as KvEntry<T>) : null;
    }
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string; at: number }>(
      "SELECT value, at FROM kv WHERE key = ?",
      key
    );
    if (!row) return null;
    return { value: JSON.parse(row.value) as T, at: row.at };
  } catch {
    return null;
  }
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  const at = Date.now();
  try {
    if (isWeb) {
      globalThis.localStorage?.setItem(`kv:${key}`, JSON.stringify({ value, at }));
      return;
    }
    const db = await getDb();
    await db.runAsync(
      "INSERT OR REPLACE INTO kv (key, value, at) VALUES (?, ?, ?)",
      key,
      JSON.stringify(value),
      at
    );
  } catch {
    // 캐시는 실패해도 기능에 영향 없음(무음 처리).
  }
}

export async function kvDel(key: string): Promise<void> {
  try {
    if (isWeb) {
      globalThis.localStorage?.removeItem(`kv:${key}`);
      return;
    }
    const db = await getDb();
    await db.runAsync("DELETE FROM kv WHERE key = ?", key);
  } catch {
    /* noop */
  }
}

/** 로그아웃 시 호출 — 캐시된 업무 데이터가 다음 사용자에게 보이지 않게 비운다. */
export async function kvClearAll(): Promise<void> {
  try {
    if (isWeb) {
      const ls = globalThis.localStorage;
      if (!ls) return;
      Object.keys(ls)
        .filter((k) => k.startsWith("kv:"))
        .forEach((k) => ls.removeItem(k));
      return;
    }
    const db = await getDb();
    await db.runAsync("DELETE FROM kv");
  } catch {
    /* noop */
  }
}
