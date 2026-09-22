import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { parsePeriod, TRIP_FORM_ID } from "@/lib/approval/trip";

/**
 * 숙박출장수당(국내여비기준표 — 마이그 224 trip_lodging_allowance_rules, 2026-09-15 사용자 요청)
 * - 기준: 승인된 **출장보고서**(frm-biz-trip-report)의 선행 문서인 출장신청서가 '숙박 출장'이면,
 *   신청서의 출장기간 일수(양끝 포함) × 직급 단가(차장 이하 3만·부장 이상 4만)를 급여 항목 trip-lodging 으로 산정.
 * - 귀속 구간은 초과근무수당과 같은 전월 26일 ~ 금월 25일(payroll/overtime.ts) — 출장기간이 구간을 걸치면
 *   구간 안에 드는 날짜만 그 달에 넣는다(다음 달 대장이 나머지를 가져간다).
 * - 대상자 = 보고서 기안자(drafter_employee_id). 동행자는 각자 신청·보고해야 산정된다.
 * - 옛 수당 규칙(payroll_pay_rules.trip-lodging)은 224에서 비활성 — 이중 지급 없음.
 */

export const TRIP_REPORT_FORM_ID = "frm-biz-trip-report";
/** 출장신청서 trip_class 의 숙박 출장 옵션(122). */
export const LODGING_TRIP_CLASS = "숙박 출장";

export interface TripLodgingRule {
  rankFrom: number;
  label: string;
  dailyAmount: number;
  isActive: boolean;
  note: string | null;
}

const toNum = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function mapRule(r: Record<string, unknown>): TripLodgingRule {
  return {
    rankFrom: Number(r.rank_from),
    label: String(r.label ?? ""),
    dailyAmount: Math.round(toNum(r.daily_amount)),
    isActive: toNum(r.is_active) === 1,
    note: r.note != null ? String(r.note) : null,
  };
}

export async function listTripLodgingRules(database?: PgDatabase): Promise<TripLodgingRule[]> {
  const db = database ?? await getDb();
  return rowsToObjects(await db.exec(`SELECT * FROM trip_lodging_allowance_rules ORDER BY rank_from`)).map(mapRule);
}

export async function saveTripLodgingRule(rule: TripLodgingRule): Promise<void> {
  if (!Number.isInteger(rule.rankFrom) || rule.rankFrom < 0) {
    throw Object.assign(new Error("직급 하한(rank_order)은 0 이상의 정수여야 합니다."), { status: 400 });
  }
  if (!rule.label.trim()) throw Object.assign(new Error("구간 이름을 입력하세요."), { status: 400 });
  await withDbWrite(async (db) => {
    await db.exec(
      `INSERT INTO trip_lodging_allowance_rules (rank_from, label, daily_amount, is_active, note, updated_at)
       VALUES ($1, $2, $3, $4, $5, now()::text)
       ON CONFLICT (rank_from) DO UPDATE SET label = EXCLUDED.label, daily_amount = EXCLUDED.daily_amount,
         is_active = EXCLUDED.is_active, note = EXCLUDED.note, updated_at = EXCLUDED.updated_at`,
      [rule.rankFrom, rule.label.trim(), Math.round(rule.dailyAmount), rule.isActive ? 1 : 0, rule.note]
    );
  });
}

export async function deleteTripLodgingRule(rankFrom: number): Promise<void> {
  await withDbWrite(async (db) => {
    await db.exec(`DELETE FROM trip_lodging_allowance_rules WHERE rank_from = $1`, [rankFrom]);
  });
}

/** 직급 서열(rank_order)에 맞는 단가 — 활성 규칙 중 rank_from ≤ rank 인 가장 큰 구간. 직급 미상은 0 구간. */
export function dailyAmountFor(rules: TripLodgingRule[], rankOrder: number | null): { amount: number; label: string } | null {
  const rank = rankOrder ?? 0;
  const hit = rules
    .filter((r) => r.isActive && r.rankFrom <= rank)
    .sort((a, b) => b.rankFrom - a.rankFrom)[0];
  return hit ? { amount: hit.dailyAmount, label: hit.label } : null;
}

/** 귀속 구간(전월 26 ~ 금월 25) — payroll/overtime.ts 와 동일 식. */
export function payrollWindow(payYear: number, payMonth: number): { from: string; to: string } {
  return {
    from: new Date(Date.UTC(payYear, payMonth - 2, 26)).toISOString().slice(0, 10),
    to: `${payYear}-${String(payMonth).padStart(2, "0")}-25`,
  };
}

/** 날짜(YYYY-MM-DD)가 속하는 귀속 급여월 — 26일 이후는 다음 달. */
export function payMonthOf(ymd: string): { payYear: number; payMonth: number } {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  if (d >= 26) return m === 12 ? { payYear: y + 1, payMonth: 1 } : { payYear: y, payMonth: m + 1 };
  return { payYear: y, payMonth: m };
}

/** from~to(양끝 포함)의 달력일수. 역전이면 0. */
export function calendarDays(from: string, to: string): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/** 두 기간의 겹치는 달력일수. */
function overlapDays(a: { from: string; to: string }, b: { from: string; to: string }): number {
  const from = a.from > b.from ? a.from : b.from;
  const to = a.to < b.to ? a.to : b.to;
  return to < from ? 0 : calendarDays(from, to);
}

export interface TripLodgingTrip {
  reportDocId: string;
  reportDocNo: string | null;
  requestDocNo: string | null;
  title: string;
  from: string;
  to: string;
  /** 이 귀속월에 들어가는 일수(구간 밖은 제외) */
  days: number;
  dailyAmount: number;
  amount: number;
}

export interface TripLodgingAmount {
  amount: number;
  days: number;
  rankLabel: string;
  trips: TripLodgingTrip[];
  /** 승인 대기 중이라 이번 산정에서 빠진 보고서 수(경고 문구용) */
  pendingReports: number;
}

/**
 * 급여대장 생성용 — 귀속 구간의 인원별 숙박출장수당.
 * 승인된 출장보고서 × 선행 출장신청서(trip_class='숙박 출장')만 대상. 결재 진행 중 보고서는 pending 으로 센다.
 */
export async function tripLodgingAmounts(payYear: number, payMonth: number, database?: PgDatabase): Promise<Map<string, TripLodgingAmount>> {
  const db = database ?? await getDb();
  const rules = await listTripLodgingRules(db);
  const map = new Map<string, TripLodgingAmount>();
  if (!rules.some((r) => r.isActive)) return map;
  const win = payrollWindow(payYear, payMonth);
  const rows = rowsToObjects(
    await db.exec(
      `SELECT r.doc_id, r.doc_no, r.title, r.status, r.drafter_employee_id,
              q.doc_no AS req_doc_no, q.field_values AS req_values,
              pos.rank_order
         FROM approval_docs r
         JOIN approval_docs q ON q.doc_id = r.ref_doc_id AND q.form_id = $1 AND q.status = 'approved'
         LEFT JOIN employee_profiles p ON p.employee_id = r.drafter_employee_id
         LEFT JOIN positions pos ON pos.position_id = p.position_id
        WHERE r.form_id = $2 AND r.status IN ('approved', 'in_progress') AND r.drafter_employee_id IS NOT NULL
          AND q.field_values->>'trip_class' = $3
          AND (q.field_values->'trip_period'->>'from') <= $5
          AND COALESCE(q.field_values->'trip_period'->>'to', q.field_values->'trip_period'->>'from') >= $4`,
      [TRIP_FORM_ID, TRIP_REPORT_FORM_ID, LODGING_TRIP_CLASS, win.from, win.to]
    )
  );
  for (const r of rows) {
    const empId = String(r.drafter_employee_id);
    let reqValues: Record<string, unknown> = {};
    try {
      const v = typeof r.req_values === "string" ? JSON.parse(r.req_values) : r.req_values;
      if (v && typeof v === "object") reqValues = v as Record<string, unknown>;
    } catch {
      continue;
    }
    const period = parsePeriod(reqValues.trip_period);
    if (!period) continue;
    const rate = dailyAmountFor(rules, r.rank_order == null ? null : Number(r.rank_order));
    if (!rate) continue;
    const cur = map.get(empId) ?? { amount: 0, days: 0, rankLabel: rate.label, trips: [], pendingReports: 0 };
    if (String(r.status) !== "approved") {
      cur.pendingReports += 1;
      map.set(empId, cur);
      continue;
    }
    const days = overlapDays(period, win);
    if (days <= 0) continue;
    const amount = days * rate.amount;
    cur.days += days;
    cur.amount += amount;
    cur.trips.push({
      reportDocId: String(r.doc_id),
      reportDocNo: r.doc_no != null ? String(r.doc_no) : null,
      requestDocNo: r.req_doc_no != null ? String(r.req_doc_no) : null,
      title: String(r.title ?? ""),
      from: period.from,
      to: period.to,
      days,
      dailyAmount: rate.amount,
      amount,
    });
    map.set(empId, cur);
  }
  return map;
}

/** 출장보고서 상신 시 스냅샷(field_values._lodging_allowance) — 결재 화면 안내·기안 화면 미리보기 공용. */
export interface LodgingAllowanceSnapshot {
  from: string;
  to: string;
  days: number;
  dailyAmount: number;
  rankLabel: string;
  amount: number;
  /** 귀속 급여월(구간을 걸치면 복수) — "2026-09: 3일 / 2026-10: 2일" */
  months: Array<{ payYear: number; payMonth: number; days: number; amount: number }>;
}

/** 직원의 직급 서열(rank_order). */
export async function employeeRankOrder(employeeId: string): Promise<number | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT pos.rank_order FROM employee_profiles p LEFT JOIN positions pos ON pos.position_id = p.position_id WHERE p.employee_id = $1`,
      [employeeId]
    )
  );
  return rows.length && rows[0].rank_order != null ? Number(rows[0].rank_order) : null;
}

/** 출장기간 + 직급 → 수당 미리보기(귀속월 분할 포함). 규칙이 없으면 null. */
export function previewLodgingAllowance(
  period: { from: string; to: string },
  rules: TripLodgingRule[],
  rankOrder: number | null
): LodgingAllowanceSnapshot | null {
  const rate = dailyAmountFor(rules, rankOrder);
  if (!rate) return null;
  const total = calendarDays(period.from, period.to);
  if (total <= 0) return null;
  // 귀속월 분할 — 시작일의 귀속월부터 종료일의 귀속월까지 구간별 겹침 일수.
  const months: LodgingAllowanceSnapshot["months"] = [];
  let cur = payMonthOf(period.from);
  const last = payMonthOf(period.to);
  for (let guard = 0; guard < 24; guard++) {
    const win = payrollWindow(cur.payYear, cur.payMonth);
    const days = overlapDays(period, win);
    if (days > 0) months.push({ payYear: cur.payYear, payMonth: cur.payMonth, days, amount: days * rate.amount });
    if (cur.payYear === last.payYear && cur.payMonth === last.payMonth) break;
    cur = cur.payMonth === 12 ? { payYear: cur.payYear + 1, payMonth: 1 } : { payYear: cur.payYear, payMonth: cur.payMonth + 1 };
  }
  return { from: period.from, to: period.to, days: total, dailyAmount: rate.amount, rankLabel: rate.label, amount: total * rate.amount, months };
}

export interface TripLodgingUpcoming {
  employeeId: string;
  name: string;
  positionName: string | null;
  payYear: number;
  payMonth: number;
  days: number;
  amount: number;
  trips: TripLodgingTrip[];
  pendingReports: number;
  /** 급여대장 반영 상태 */
  paid: "none" | "draft" | "confirmed";
}

/** 설정 화면용 — 지난 monthsBack 개월 ~ 이번 달 + 다음 달의 인원별 산정 내역과 대장 반영 상태. */
export async function listTripLodgingUpcoming(monthsBack = 3): Promise<TripLodgingUpcoming[]> {
  const db = await getDb();
  const names = new Map(
    rowsToObjects(
      await db.exec(
        `SELECT p.employee_id, p.name, pos.position_name FROM employee_profiles p LEFT JOIN positions pos ON pos.position_id = p.position_id`
      )
    ).map((r) => [String(r.employee_id), { name: String(r.name ?? ""), positionName: r.position_name != null ? String(r.position_name) : null }])
  );
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const base = payMonthOf(today);
  const out: TripLodgingUpcoming[] = [];
  for (let off = -monthsBack; off <= 1; off++) {
    const idx = base.payMonth - 1 + off;
    const payYear = base.payYear + Math.floor(idx / 12);
    const payMonth = ((idx % 12) + 12) % 12 + 1;
    const amounts = await tripLodgingAmounts(payYear, payMonth);
    for (const [employeeId, a] of amounts) {
      if (a.amount <= 0 && a.pendingReports === 0) continue;
      const who = names.get(employeeId);
      out.push({
        employeeId, name: who?.name ?? employeeId, positionName: who?.positionName ?? null,
        payYear, payMonth, days: a.days, amount: a.amount, trips: a.trips, pendingReports: a.pendingReports, paid: "none",
      });
    }
  }
  if (!out.length) return out;
  const paidRows = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id, lg.pay_year, lg.pay_month, lg.status
         FROM payroll_entry_lines l JOIN payroll_entries e ON e.entry_id = l.entry_id
         JOIN payroll_ledgers lg ON lg.ledger_id = e.ledger_id
        WHERE l.item_id = 'trip-lodging' AND l.amount > 0 AND lg.ledger_kind = 'salary'`
    )
  );
  const paidMap = new Map(paidRows.map((p) => [`${p.employee_id}|${p.pay_year}-${p.pay_month}`, String(p.status)]));
  for (const u of out) {
    const st = paidMap.get(`${u.employeeId}|${u.payYear}-${u.payMonth}`);
    u.paid = st === "confirmed" ? "confirmed" : st === "draft" ? "draft" : "none";
  }
  return out.sort((a, b) => a.payYear - b.payYear || a.payMonth - b.payMonth || a.name.localeCompare(b.name));
}
