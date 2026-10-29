import { getDb, rowsToObjects } from "@/lib/db";
import { getEmployeeAnnual, type PayrollItemDef } from "@/lib/payroll/queries";

/**
 * 직원별 연간 급여 명세(화면·엑셀·PDF 공통 데이터) + 퇴직금 적립·추계.
 * 급여대장에는 퇴직금 라인이 없으므로(지급 시점에만 발생) 대장의 지급 라인으로 계산해 함께 보여 준다.
 *
 * 퇴직금 추계(근로자퇴직급여 보장법 제8조, 근로기준법 제2조 평균임금):
 *  - 퇴직금 = 1일 평균임금 × 30일 × 재직일수 ÷ 365 (계속근로 1년 이상만 지급 대상)
 *  - 1일 평균임금 = (산정 기준일 이전 3개월 임금총액 + 직전 1년 상여·연차수당 × 3/12) ÷ 3개월 일수
 *  - 월별 적립액 = 그 달 임금총액 ÷ 12 (연간 임금총액의 1/12 — 퇴직연금 DC 부담금 기준과 같은 관행)
 *  - 실비변상 항목(정산 경비·출장수당·출장숙박수당)은 임금에서 제외한다.
 * 대장 월 단위 근사치이므로 실제 지급액은 퇴사일 기준 일할·통상임금 비교로 확정한다(재무 퇴직 정산).
 */

/** 실비변상 — 평균임금·적립 기준에서 제외 */
export const SEVERANCE_EXCLUDED_ITEMS = ["expense-settle", "trip", "trip-lodging"] as const;
/** 상여성 — 3개월 임금에서 빼고 직전 1년분 × 3/12 로 가산 */
const BONUS_ITEMS = new Set(["bonus", "incentive", "key-talent"]);
const LEAVE_PAY_ITEMS = new Set(["annual-leave"]);

export type AnnualItem = PayrollItemDef & { amounts: Record<number, number>; total: number };

export interface AnnualProfile {
  name: string;
  employeeId: string | null;
  empNo: string | null;
  deptName: string | null;
  positionName: string | null;
  hiredAt: string | null;
  resignedAt: string | null;
}

export interface SeveranceEstimate {
  /** 월별 적립액(그 달 임금총액 ÷ 12) */
  accrual: Record<number, number>;
  accrualTotal: number;
  /** 산정 기준일 — 퇴사일(그해 퇴사) 또는 그해 마지막 급여월 말일 */
  referenceDate: string | null;
  referenceLabel: "퇴사일" | "기준일";
  /** 평균임금 산정 기간(대장 월) */
  windowLabel: string | null;
  windowDays: number;
  wage3m: number;
  bonusAdd: number;
  leaveAdd: number;
  avgDailyWage: number;
  serviceDays: number | null;
  eligible: boolean;
  estimate: number | null;
  /** 재무 퇴직 정산에 입력된 확정 퇴직금 */
  settled: { amount: number | null; status: string; resignDate: string | null } | null;
  notes: string[];
}

export interface AnnualStatement {
  year: number;
  profile: AnnualProfile;
  items: AnnualItem[];
  monthTotals: Record<number, { pay: number; ded: number; net: number }>;
  months: number[];
  severance: SeveranceEstimate;
}

const toNum = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown) => (v == null || v === "" ? null : String(v));
const ym = (y: number, m: number) => y * 12 + (m - 1);
const ymYear = (k: number) => Math.floor(k / 12);
const ymMonth = (k: number) => (k % 12) + 1;
const daysInMonth = (k: number) => new Date(Date.UTC(ymYear(k), ymMonth(k), 0)).getUTCDate();
const isoDate = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const dayNo = (iso: string) => Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000);
const monthEnd = (k: number) => `${ymYear(k)}-${String(ymMonth(k)).padStart(2, "0")}-${String(daysInMonth(k)).padStart(2, "0")}`;

export async function getAnnualStatement(year: number, name: string): Promise<AnnualStatement> {
  const db = await getDb();
  const annual = await getEmployeeAnnual(year, name);
  const months = Object.keys(annual.monthTotals).map(Number).sort((a, b) => a - b);

  // 인적사항 — 그해 마지막 대장 행 기준, 매칭 직원은 현재 인사 정보 우선(급여대장 상세와 같은 규칙)
  const prof = rowsToObjects(await db.exec(
    `SELECT e.employee_id, COALESCE(p.employee_no, e.emp_no) AS emp_no,
            COALESCE(d.dept_name, e.dept_name) AS dept_name,
            COALESCE(pos.position_name, e.position_name) AS position_name,
            COALESCE(p.hired_at, e.hired_at) AS hired_at
       FROM payroll_entries e
       JOIN payroll_ledgers l ON l.ledger_id = e.ledger_id
       LEFT JOIN employee_profiles p ON p.employee_id = e.employee_id
       LEFT JOIN positions pos ON pos.position_id = p.position_id
       LEFT JOIN departments d ON d.dept_id = p.dept_id
      WHERE l.pay_year = $1 AND e.name = $2
      ORDER BY l.pay_month DESC, (l.ledger_kind = 'salary') DESC
      LIMIT 1`,
    [year, name]
  ))[0] ?? {};
  const employeeId = str(prof.employee_id);

  // 같은 성명의 전 기간 지급 라인(평균임금은 전년도 말 월까지 거슬러 본다)
  const lineRows = rowsToObjects(await db.exec(
    `SELECT l.pay_year, l.pay_month, l.ledger_kind, li.item_id, sum(li.amount) AS amount
       FROM payroll_entries e
       JOIN payroll_ledgers l ON l.ledger_id = e.ledger_id
       JOIN payroll_entry_lines li ON li.entry_id = e.entry_id
       JOIN payroll_item_defs d ON d.item_id = li.item_id
      WHERE e.name = $1 AND d.kind = 'pay' AND l.pay_year <= $2
      GROUP BY l.pay_year, l.pay_month, l.ledger_kind, li.item_id`,
    [name, year]
  ));
  const metaRows = rowsToObjects(await db.exec(
    `SELECT max(e.resigned_at) FILTER (WHERE e.resigned_at ~ '^\\d{4}-\\d{2}-\\d{2}') AS resigned_at,
            min(e.hired_at) FILTER (WHERE e.hired_at ~ '^\\d{4}-\\d{2}-\\d{2}') AS first_hired
       FROM payroll_entries e WHERE e.name = $1`,
    [name]
  ))[0] ?? {};
  const settledRow = employeeId
    ? rowsToObjects(await db.exec(
        `SELECT severance_amount, status, resign_date FROM severance_settlements WHERE employee_id = $1`,
        [employeeId]
      ))[0]
    : undefined;

  const resignedAt = isoDate(str(metaRows.resigned_at)) ?? isoDate(str(settledRow?.resign_date));
  const hiredAt = isoDate(str(prof.hired_at)) ?? isoDate(str(metaRows.first_hired));
  const profile: AnnualProfile = {
    name,
    employeeId,
    empNo: str(prof.emp_no),
    deptName: str(prof.dept_name),
    positionName: str(prof.position_name),
    hiredAt,
    resignedAt,
  };

  // 월(ym)별 임금 분류
  const excluded = new Set<string>(SEVERANCE_EXCLUDED_ITEMS);
  const wageAll = new Map<number, number>();  // 적립 기준(상여 포함)
  const regular = new Map<number, number>();  // 3개월 임금(상여·연차수당 제외)
  const bonus = new Map<number, number>();
  const leave = new Map<number, number>();
  const add = (m: Map<number, number>, k: number, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const r of lineRows) {
    const itemId = String(r.item_id);
    if (excluded.has(itemId)) continue;
    const k = ym(toNum(r.pay_year), toNum(r.pay_month));
    const amt = toNum(r.amount);
    add(wageAll, k, amt);
    if (String(r.ledger_kind) === "bonus" || BONUS_ITEMS.has(itemId)) add(bonus, k, amt);
    else if (LEAVE_PAY_ITEMS.has(itemId)) add(leave, k, amt);
    else add(regular, k, amt);
  }

  const accrual: Record<number, number> = {};
  for (const m of months) accrual[m] = Math.floor((wageAll.get(ym(year, m)) ?? 0) / 12);
  const accrualTotal = Object.values(accrual).reduce((a, b) => a + b, 0);

  const notes: string[] = [];
  // 산정 기준일: 그해(또는 그 이전) 퇴사 → 퇴사일, 아니면 그해 마지막 급여월 말일
  const resignInScope = resignedAt && Number(resignedAt.slice(0, 4)) <= year ? resignedAt : null;
  const lastMonth = months.length ? months[months.length - 1] : null;
  const referenceDate = resignInScope ?? (lastMonth ? monthEnd(ym(year, lastMonth)) : null);

  let windowLabel: string | null = null;
  let windowDays = 0;
  let wage3m = 0;
  let bonusAdd = 0;
  let leaveAdd = 0;
  let avgDailyWage = 0;
  let serviceDays: number | null = null;
  let estimate: number | null = null;
  if (referenceDate) {
    const refK = ym(Number(referenceDate.slice(0, 4)), Number(referenceDate.slice(5, 7)));
    // 기준일이 월말이면 그 달까지 3개월, 월 중간(퇴사)이면 직전 온전한 3개월
    const endK = referenceDate === monthEnd(refK) ? refK : refK - 1;
    const win = [endK - 2, endK - 1, endK];
    windowLabel = `${ymYear(win[0])}.${String(ymMonth(win[0])).padStart(2, "0")}~${ymYear(endK)}.${String(ymMonth(endK)).padStart(2, "0")}`;
    windowDays = win.reduce((a, k) => a + daysInMonth(k), 0);
    wage3m = win.reduce((a, k) => a + (regular.get(k) ?? 0), 0);
    const yearKs = Array.from({ length: 12 }, (_, i) => endK - 11 + i);
    bonusAdd = Math.floor((yearKs.reduce((a, k) => a + (bonus.get(k) ?? 0), 0) * 3) / 12);
    leaveAdd = Math.floor((yearKs.reduce((a, k) => a + (leave.get(k) ?? 0), 0) * 3) / 12);
    avgDailyWage = windowDays ? Math.floor(((wage3m + bonusAdd + leaveAdd) / windowDays) * 100) / 100 : 0;
    if (win.some((k) => !wageAll.has(k))) notes.push("산정 기간 중 급여대장이 없는 달이 있어 평균임금이 낮게 잡혔을 수 있습니다.");
    if (hiredAt && dayNo(hiredAt) <= dayNo(referenceDate)) {
      serviceDays = dayNo(referenceDate) - dayNo(hiredAt) + 1;
      estimate = Math.floor((avgDailyWage * 30 * serviceDays) / 365);
    } else {
      notes.push("입사일이 없어 재직일수와 추계 퇴직금을 계산하지 못했습니다(인사 정보의 입사일을 확인하세요).");
    }
  }
  const eligible = serviceDays != null && serviceDays >= 365;
  if (serviceDays != null && !eligible) notes.push("계속근로 1년 미만 — 퇴직금 지급 대상이 아닙니다(1년이 되는 날부터 지급 대상).");

  return {
    year,
    profile,
    items: annual.items,
    monthTotals: annual.monthTotals,
    months,
    severance: {
      accrual,
      accrualTotal,
      referenceDate,
      referenceLabel: resignInScope ? "퇴사일" : "기준일",
      windowLabel,
      windowDays,
      wage3m,
      bonusAdd,
      leaveAdd,
      avgDailyWage,
      serviceDays,
      eligible,
      estimate,
      settled: settledRow
        ? { amount: settledRow.severance_amount == null ? null : toNum(settledRow.severance_amount), status: String(settledRow.status), resignDate: str(settledRow.resign_date) }
        : null,
      notes,
    },
  };
}

/** 재직일수 → 'N년 M개월'(표시용, 365·30일 근사) */
export function serviceLabel(days: number | null): string {
  if (days == null) return "-";
  const y = Math.floor(days / 365);
  const m = Math.floor((days % 365) / 30);
  return `${days.toLocaleString("ko-KR")}일 (${y ? `${y}년 ` : ""}${m}개월)`;
}
