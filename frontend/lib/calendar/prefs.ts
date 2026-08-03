// 일정 메뉴(G6-C) 사용자 설정 로드/저장 — lib/home/layout.ts 의 upsert 패턴 동형.
// 저장 테이블: calendar_prefs (infra/aws/125_calendar_prefs.sql)

import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import {
  CALENDAR_TAG_KEYS,
  DEFAULT_CALENDAR_PREFS,
  type CalendarPrefs,
  type CalendarRefs,
  type CalendarTagKey,
} from "@/lib/calendar/types";

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

function normalizeTags(value: unknown): CalendarTagKey[] {
  const arr = Array.isArray(value) ? value : [];
  const out = arr.filter((t): t is CalendarTagKey =>
    (CALENDAR_TAG_KEYS as readonly string[]).includes(String(t))
  );
  return out.length ? [...new Set(out)] : [...DEFAULT_CALENDAR_PREFS.tags];
}

function normalizeRefs(value: unknown): CalendarRefs {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const strArr = (x: unknown) =>
    Array.isArray(x) ? [...new Set(x.filter((s) => typeof s === "string" && s.trim()).map(String))] : [];
  return {
    employeeIds: strArr(v.employeeIds),
    deptIds: strArr(v.deptIds),
    all: v.all === true,
  };
}

export async function loadCalendarPrefs(userId: string): Promise<CalendarPrefs> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT tags, refs FROM calendar_prefs WHERE user_id = $1`, [userId])
  );
  if (rows.length === 0) return { tags: [...DEFAULT_CALENDAR_PREFS.tags], refs: { ...DEFAULT_CALENDAR_PREFS.refs } };
  return {
    tags: normalizeTags(parseJson(rows[0].tags, [])),
    refs: normalizeRefs(parseJson(rows[0].refs, {})),
  };
}

export async function saveCalendarPrefs(userId: string, input: Partial<CalendarPrefs>): Promise<void> {
  const current = await loadCalendarPrefs(userId);
  const next: CalendarPrefs = {
    tags: input.tags ? normalizeTags(input.tags) : current.tags,
    refs: input.refs ? normalizeRefs(input.refs) : current.refs,
  };
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO calendar_prefs (user_id, tags, refs, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, $4)
       ON CONFLICT (user_id) DO UPDATE
         SET tags = EXCLUDED.tags, refs = EXCLUDED.refs, updated_at = EXCLUDED.updated_at`,
      [userId, JSON.stringify(next.tags), JSON.stringify(next.refs), new Date().toISOString()]
    );
  });
}

/**
 * refs 조건을 실제 인원(employee_id 목록)으로 확장한다.
 * all → 재직자 전원 / deptIds → 해당 부서 재직자 / employeeIds → 개별. 세 집합 합집합.
 */
export async function expandRefs(refs: CalendarRefs): Promise<string[]> {
  const db = await getDb();
  if (refs.all) {
    const rows = rowsToObjects(
      await db.exec(`SELECT employee_id FROM employee_profiles WHERE status = 'active'`)
    );
    return rows.map((r) => String(r.employee_id));
  }
  const out = new Set<string>(refs.employeeIds);
  if (refs.deptIds.length) {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT employee_id FROM employee_profiles WHERE dept_id = ANY($1::text[]) AND status = 'active'`,
        [refs.deptIds]
      )
    );
    for (const r of rows) out.add(String(r.employee_id));
  }
  return [...out];
}
