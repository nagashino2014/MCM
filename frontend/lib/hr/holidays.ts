/**
 * 휴무일 단일 소스(서버 전용) — 법정공휴일(외부 소스) + 사내 지정 휴무일(company_holidays, 마이그 168).
 *
 * 휴무일을 명확히 규정해야 초과근무 산정이 정확해진다(휴일은 소정근로가 없어 재실 전체가 초과근무 대상).
 * 소비처: ①lib/payroll/overtime.ts(대조 산정) ②/api/home/holidays(홈·일정 캘린더 붉은 표시·휴무일명)
 *        ③/api/approval/holidays(휴무일 지정 화면).
 */

import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getHolidays, type Holiday } from "@/lib/home/holidays";

/** 사내 휴무일 지정 사유 — 화면 목록박스와 동일 순서. */
export const COMPANY_HOLIDAY_REASONS: Array<{ key: string; label: string }> = [
  { key: "substitute", label: "대체휴일" },
  { key: "foundation", label: "창립기념일" },
  { key: "collective_leave", label: "전체연차 사용" },
];

export interface OffDay {
  date: string; // YYYY-MM-DD
  name: string; // 휴무일명(캘린더 표시)
  /** public=법정공휴일·명절(외부 소스) · company=사내 지정 */
  source: "public" | "company";
  /** 사내 지정일 때의 사유 키 */
  reason?: string | null;
  /** 매년 반복 규칙에서 전개된 날짜(창립기념일 등) */
  recurring?: boolean;
}

/** 매년 반복되는 사내 휴무일 규칙(월·일만 보관, 마이그 169). */
export interface AnnualHoliday {
  month: number;
  day: number;
  name: string;
  reason: string;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 매년 반복 규칙 목록. */
export async function listAnnualHolidays(): Promise<AnnualHoliday[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT month, day, name, reason FROM company_annual_holidays ORDER BY month, day`)
  );
  return rows.map((r) => ({
    month: Number(r.month),
    day: Number(r.day),
    name: String(r.name),
    reason: String(r.reason),
  }));
}

/** 반복 규칙 등록/수정(월·일이 키). */
export async function saveAnnualHoliday(
  input: { month: number; day: number; name: string; reason: string },
  actorUserId?: string | null
): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO company_annual_holidays (month, day, name, reason, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5, now()::text, now()::text)
       ON CONFLICT (month, day) DO UPDATE SET
         name = EXCLUDED.name, reason = EXCLUDED.reason, updated_at = now()::text`,
      [input.month, input.day, input.name, input.reason, actorUserId ?? null]
    );
  });
}

/** 반복 규칙 삭제. */
export async function deleteAnnualHoliday(month: number, day: number): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM company_annual_holidays WHERE month = $1 AND day = $2`, [month, day]);
  });
}

/** 근로자의 날 — 법정공휴일이 아니라 외부 소스에 없을 수 있어 항상 채운다(유급휴일이라 소정근로 없음). */
function laborDay(year: number): Holiday {
  return { date: `${year}-05-01`, name: "근로자의 날" };
}

/** 대체공휴일 대상인 고정일 공휴일(월-일 → 표기명). 신정·현충일은 대체 대상이 아니다. */
const SUBSTITUTE_BASES: Array<{ md: string; name: string }> = [
  { md: "03-01", name: "삼일절" },
  { md: "05-05", name: "어린이날" },
  { md: "07-17", name: "제헌절" }, // 2026년 공휴일 재지정
  { md: "08-15", name: "광복절" },
  { md: "10-03", name: "개천절" },
  { md: "10-09", name: "한글날" },
  { md: "12-25", name: "성탄절" },
];

const shiftDate = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * 대체휴일 명칭 보정 — 외부 소스는 대체휴일도 원래 공휴일과 같은 이름(때로는 다른 표기)으로 준다.
 * 예) 2026 광복절 8/15(토) → 대체 8/17(월)이 "광복절"로 온다. 캘린더에서 구분되도록 "광복절 대체휴일"로 바꾼다.
 * 방식: 고정일 공휴일이 주말이면 그 다음 평일부터 훑어 **휴무일로 잡혀 있는 첫 날**을 대체휴일로 본다.
 */
function labelSubstitutes(year: number, map: Map<string, OffDay>): void {
  const taken = new Set<string>();
  for (const base of SUBSTITUTE_BASES) {
    const origin = `${year}-${base.md}`;
    const dow = new Date(`${origin}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) continue; // 평일이면 대체휴일이 생기지 않는다
    for (let i = 1; i <= 4; i++) {
      const cand = shiftDate(origin, i);
      const candDow = new Date(`${cand}T00:00:00Z`).getUTCDay();
      if (candDow === 0 || candDow === 6) continue; // 주말은 건너뛴다
      if (taken.has(cand)) continue; // 다른 공휴일의 대체로 이미 잡힌 날
      const hit = map.get(cand);
      if (!hit) break; // 그 평일이 휴무일이 아니면 대체휴일이 없는 것
      if (SUBSTITUTE_BASES.some((b) => `${year}-${b.md}` === cand)) continue; // 다른 공휴일 당일
      map.set(cand, { ...hit, name: `${base.name} 대체휴일` });
      taken.add(cand);
      break;
    }
  }
}

/** 사내 지정 휴무일(연도 단위). */
export async function listCompanyHolidays(year?: number): Promise<OffDay[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    year == null
      ? await db.exec(
          `SELECT to_char(holiday_date,'YYYY-MM-DD') AS d, name, reason FROM company_holidays ORDER BY holiday_date`
        )
      : await db.exec(
          `SELECT to_char(holiday_date,'YYYY-MM-DD') AS d, name, reason
             FROM company_holidays
            WHERE holiday_date >= make_date($1,1,1) AND holiday_date <= make_date($1,12,31)
            ORDER BY holiday_date`,
          [year]
        )
  );
  return rows.map((r) => ({
    date: String(r.d),
    name: String(r.name),
    source: "company" as const,
    reason: r.reason != null ? String(r.reason) : null,
  }));
}

/**
 * 그 해의 전체 휴무일 — 법정공휴일 + 근로자의 날 + 매년 반복 규칙 + 사내 지정(특정일).
 * 같은 날짜가 겹치면 **더 구체적인 쪽이 이긴다**: 법정 < 반복 규칙 < 특정일 지정.
 */
export async function listOffDays(year: number): Promise<OffDay[]> {
  const pub: OffDay[] = [];
  try {
    for (const h of [...(await getHolidays(year)), laborDay(year)]) {
      pub.push({ date: h.date, name: h.name, source: "public" });
    }
  } catch {
    pub.push({ ...laborDay(year), source: "public" });
  }
  const annual = await listAnnualHolidays().catch(() => [] as AnnualHoliday[]);
  const company = await listCompanyHolidays(year).catch(() => [] as OffDay[]);

  const map = new Map<string, OffDay>();
  for (const d of pub) if (!map.has(d.date)) map.set(d.date, d);
  labelSubstitutes(year, map); // 사내 지정보다 먼저 — 사내 명칭이 있으면 그쪽이 덮어쓴다
  for (const a of annual) {
    const date = `${year}-${pad2(a.month)}-${pad2(a.day)}`;
    // 2월 30일 같은 잘못된 조합은 건너뛴다(윤년 2/29 는 그 해에만 유효).
    const d = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.getUTCDate() !== a.day) continue;
    map.set(date, { date, name: a.name, source: "company", reason: a.reason, recurring: true });
  }
  for (const d of company) map.set(d.date, d);
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** 초과근무 산정용 — 여러 해의 휴무일 날짜 집합. */
export async function offDaySet(years: number[]): Promise<Set<string>> {
  const set = new Set<string>();
  for (const y of new Set(years)) {
    for (const d of await listOffDays(y)) set.add(d.date);
  }
  return set;
}

/** 사내 휴무일 지정(같은 날짜 재지정은 덮어쓴다). */
export async function saveCompanyHoliday(
  input: { date: string; name: string; reason: string; note?: string | null },
  actorUserId?: string | null
): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO company_holidays (holiday_date, name, reason, note, created_by, created_at, updated_at)
       VALUES ($1::date,$2,$3,$4,$5, now()::text, now()::text)
       ON CONFLICT (holiday_date) DO UPDATE SET
         name = EXCLUDED.name, reason = EXCLUDED.reason, note = EXCLUDED.note, updated_at = now()::text`,
      [input.date, input.name, input.reason, input.note ?? null, actorUserId ?? null]
    );
  });
}

/** 사내 휴무일 해제. */
export async function deleteCompanyHoliday(date: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM company_holidays WHERE holiday_date = $1::date`, [date]);
  });
}
