import { getDb, rowsToObjects } from "@/lib/db";
import { timeRangeMinutes, timeRangeText } from "@/lib/approval/fields";
import { OVERTIME_FORM_ID } from "@/lib/approval/overtime";
import { offDaySet } from "@/lib/hr/holidays";
import { TERMINAL_NAMES } from "@/lib/adt/events";
import {
  clockOfSec,
  isDeliveryVendor,
  pairReturn,
  secOfClock,
  summarizeByPerson,
  tagSecOnDay,
  type MealReturnPersonSummary,
  type ReturnStatus,
  type ReturnTag,
} from "@/lib/approval/meal-return-pure";

/*
 * 식사 외출 대조표(2026-11-26) — 귀속 구간(전월 26일~금월 25일)의 지출결의서 식대(복리후생비) 행을
 * 결제 시각과 ADT 출입 태그로 짝지어, 결제 후 사무실 복귀까지 걸린 시간을 직원별로 보여 준다.
 * 판정 규칙·한계는 meal-return-pure.ts 머리 주석. 대상 행은 식대 대조(overtime-meal.ts)와 같다:
 * 평일 17:00 이후 결제분 + 휴일 결제분, 결제 시각을 알 수 있는 행만(법인카드 승인시각·개인영수증 거래일시).
 * 조회 전용 — 표·처분을 바꾸지 않는다.
 */

const MEAL_FORM_CATEGORY: Record<string, string> = {
  "frm-expense-report": "복리후생비",
  "frm-expense-personal": "복리후생비",
};
const DINNER_FROM_SEC = 17 * 3600;

export interface MealReturnTagView {
  hm: string; // 'HH:MM'
  nextDay: boolean; // 익일 새벽 태그
  terminal: string; // 단말기 이름(미상이면 ID)
  code: string; // 근태내역 1·2·5
}

export interface MealReturnRow {
  employeeId: string;
  empName: string;
  docId: string;
  docNo: string | null;
  docStatus: string;
  rowNo: number;
  usedOn: string; // YYYY-MM-DD
  isOffDay: boolean;
  vendor: string | null;
  amount: number | null;
  paidAtHm: string;
  payKind: "card" | "receipt";
  status: ReturnStatus;
  lastBefore: MealReturnTagView | null;
  next: MealReturnTagView | null;
  minOutMinutes: number | null;
  maxOutMinutes: number | null;
  appliedMinutes: number; // 그 날 초과근무 신청(진행+승인) 분
  appliedTime: string | null; // 신청 시간대 'HH:MM ~ HH:MM'(여러 건이면 쉼표)
  hasTags: boolean; // 그 날 이 직원의 출입 태그가 하나라도 있는지(사번 미연결 판별)
}

export interface MealReturnResult {
  from: string;
  to: string;
  rows: MealReturnRow[];
  people: Array<MealReturnPersonSummary & { empName: string }>;
  /** 결제 시각을 알 수 없어 대조하지 못한 식대 행 수(수기 입력·롯데카드 등 날짜만 있는 승인). */
  noTimeCount: number;
}

const ymd8 = (d: string) => d.replace(/-/g, "");
function addDays(d: string, n: number): string {
  const t = new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000);
  return t.toISOString().slice(0, 10);
}
/** 'YYYY-MM-DD HH:MI(:SS)' 류 → 'HH:MM:SS' / 'HH:MM'(날짜만이면 null). */
function clockOf(v: unknown): string | null {
  const m = /\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2}(?::\d{2})?)/.exec(String(v ?? ""));
  return m ? m[1] : null;
}

export async function listMealReturnChecks(payYear: number, payMonth: number): Promise<MealReturnResult> {
  const db = await getDb();
  const from = new Date(Date.UTC(payYear, payMonth - 2, 26)).toISOString().slice(0, 10);
  const to = `${payYear}-${String(payMonth).padStart(2, "0")}-25`;

  // ① 구간 안에 식대 행이 있는 지출결의서(진행·승인).
  const docs = rowsToObjects(
    await db.exec(
      `SELECT d.doc_id, d.doc_no, d.form_id, d.status, d.drafter_employee_id, d.field_values, p.name AS emp_name
         FROM approval_docs d
         LEFT JOIN employee_profiles p ON p.employee_id = d.drafter_employee_id
        WHERE d.form_id = ANY($1::text[]) AND d.status IN ('in_progress','approved')
          AND d.drafter_employee_id IS NOT NULL
          AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(
                         CASE WHEN jsonb_typeof(d.field_values->'expenses') = 'array' THEN d.field_values->'expenses' ELSE '[]'::jsonb END) e
                 WHERE left(e->>'used_on', 10) BETWEEN $2 AND $3)`,
      [Object.keys(MEAL_FORM_CATEGORY), from, to]
    )
  );

  type Item = Omit<MealReturnRow, "status" | "lastBefore" | "next" | "minOutMinutes" | "maxOutMinutes" | "appliedMinutes" | "appliedTime" | "hasTags" | "isOffDay" | "paidAtHm"> & {
    cardTxnId: string | null;
    receiptId: string | null;
  };
  const items: Item[] = [];
  for (const d of docs) {
    const category = MEAL_FORM_CATEGORY[String(d.form_id)];
    let fv: Record<string, unknown> = {};
    try {
      const v = typeof d.field_values === "string" ? JSON.parse(d.field_values) : d.field_values;
      if (v && typeof v === "object") fv = v as Record<string, unknown>;
    } catch {
      continue;
    }
    const expenses = Array.isArray(fv.expenses) ? (fv.expenses as Array<Record<string, unknown>>) : [];
    expenses.forEach((row, i) => {
      if (!row || typeof row !== "object" || String(row.category ?? "") !== category) return;
      const usedOn = /^\d{4}-\d{2}-\d{2}/.exec(String(row.used_on ?? ""))?.[0] ?? "";
      if (!usedOn || usedOn < from || usedOn > to) return;
      const amountNum = Number(String(row.amount ?? "").replace(/[^\d.]/g, ""));
      items.push({
        employeeId: String(d.drafter_employee_id),
        empName: String(d.emp_name ?? ""),
        docId: String(d.doc_id),
        docNo: d.doc_no != null ? String(d.doc_no) : null,
        docStatus: String(d.status),
        rowNo: i + 1,
        usedOn,
        vendor: row.vendor != null && String(row.vendor) !== "" ? String(row.vendor) : null,
        amount: Number.isFinite(amountNum) && amountNum > 0 ? amountNum : null,
        payKind: row._cardTxnId ? "card" : "receipt",
        cardTxnId: row._cardTxnId ? String(row._cardTxnId) : null,
        receiptId: row._receiptId ? String(row._receiptId) : null,
      });
    });
  }
  if (!items.length) return { from, to, rows: [], people: [], noTimeCount: 0 };

  // ② 결제 시각 — 법인카드 승인일시 / 개인영수증 거래일시. 둘 다 없으면 대조 불가.
  const paidByTxn = new Map<string, string | null>();
  const txnIds = items.map((x) => x.cardTxnId).filter((x): x is string => !!x);
  if (txnIds.length) {
    for (const r of rowsToObjects(
      await db.exec(`SELECT card_txn_id, approved_at FROM card_transactions WHERE card_txn_id = ANY($1::text[])`, [txnIds])
    )) paidByTxn.set(String(r.card_txn_id), clockOf(r.approved_at));
  }
  const paidByReceipt = new Map<string, string | null>();
  const receiptIds = items.filter((x) => !x.cardTxnId).map((x) => x.receiptId).filter((x): x is string => !!x);
  if (receiptIds.length) {
    for (const r of rowsToObjects(
      await db.exec(`SELECT receipt_id, paid_at FROM personal_receipts WHERE receipt_id = ANY($1::text[])`, [receiptIds])
    )) paidByReceipt.set(String(r.receipt_id), clockOf(r.paid_at));
  }

  const offDays = await offDaySet(Array.from(new Set(items.map((x) => Number(x.usedOn.slice(0, 4))))), db);
  const isOff = (d: string) => {
    const dow = new Date(Date.parse(`${d}T12:00:00Z`)).getUTCDay();
    return dow === 0 || dow === 6 || offDays.has(d);
  };

  let noTimeCount = 0;
  const targets: Array<Item & { paidSec: number; isOffDay: boolean }> = [];
  for (const it of items) {
    const clock = it.cardTxnId ? paidByTxn.get(it.cardTxnId) ?? null : it.receiptId ? paidByReceipt.get(it.receiptId) ?? null : null;
    const paidSec = secOfClock(clock);
    if (paidSec == null) {
      noTimeCount += 1;
      continue;
    }
    const isOffDay = isOff(it.usedOn);
    // 식대 대조와 같은 대상 — 평일은 저녁(17:00 이후) 결제만, 휴일은 시각 무관.
    if (!isOffDay && paidSec < DINNER_FROM_SEC) continue;
    targets.push({ ...it, paidSec, isOffDay });
  }
  if (!targets.length) return { from, to, rows: [], people: [], noTimeCount };

  // ③ 직원 → ADT 사번 후보: 근태 일별(실제 연결된 사번) · 직원 마스터 adt_emp_no · 지사 별칭.
  const empIds = Array.from(new Set(targets.map((t) => t.employeeId)));
  const idnoByEmp = new Map<string, Set<string>>();
  const addIdno = (emp: string, idno: unknown) => {
    const v = idno != null ? String(idno).trim() : "";
    if (!v) return;
    if (!idnoByEmp.has(emp)) idnoByEmp.set(emp, new Set());
    idnoByEmp.get(emp)!.add(v);
  };
  for (const r of rowsToObjects(
    await db.exec(
      `SELECT employee_id, adt_emp_no FROM employee_profiles WHERE employee_id = ANY($1::text[]) AND adt_emp_no IS NOT NULL
       UNION SELECT employee_id, adt_emp_no FROM attendance_emp_aliases WHERE employee_id = ANY($1::text[])
       UNION SELECT DISTINCT employee_id, adt_emp_no FROM attendance_daily WHERE employee_id = ANY($1::text[])`,
      [empIds]
    )
  )) addIdno(String(r.employee_id), r.adt_emp_no);
  const empByIdno = new Map<string, string>();
  for (const [emp, set] of idnoByEmp) for (const idno of set) empByIdno.set(idno, emp);

  // ④ 출입 태그(구간 + 익일 새벽).
  const tagsByEmpDate = new Map<string, Array<{ dDate: string; tTime: string; terminalId: string; eventCode: string }>>();
  if (empByIdno.size) {
    for (const r of rowsToObjects(
      await db.exec(
        `SELECT e_idno, d_date, t_time, terminal_id, event_code
           FROM adt_event_raw
          WHERE e_idno = ANY($1::text[]) AND d_date BETWEEN $2 AND $3`,
        [Array.from(empByIdno.keys()), ymd8(from), ymd8(addDays(to, 1))]
      )
    )) {
      const emp = empByIdno.get(String(r.e_idno));
      if (!emp) continue;
      const k = `${emp}|${String(r.d_date)}`;
      if (!tagsByEmpDate.has(k)) tagsByEmpDate.set(k, []);
      tagsByEmpDate.get(k)!.push({
        dDate: String(r.d_date),
        tTime: String(r.t_time),
        terminalId: String(r.terminal_id ?? ""),
        eventCode: String(r.event_code ?? ""),
      });
    }
  }

  // ⑤ 그 날 초과근무 신청(진행+승인) — 시간(apply_hours 우선, 없으면 시간대 길이)과 시간대.
  const otByEmpDate = new Map<string, { minutes: number; times: string[] }>();
  for (const r of rowsToObjects(
    await db.exec(
      `SELECT d.drafter_employee_id AS employee_id,
              d.field_values->'work_period'->>'from' AS from_date,
              COALESCE(NULLIF(d.field_values->'work_period'->>'to',''), d.field_values->'work_period'->>'from') AS to_date,
              d.field_values->>'apply_hours' AS apply_hours,
              d.field_values->'work_time' AS work_time
         FROM approval_docs d
        WHERE d.form_id = $1 AND d.status IN ('in_progress','approved')
          AND d.drafter_employee_id = ANY($2::text[])
          AND (d.field_values->'work_period'->>'from') <= $4
          AND COALESCE(NULLIF(d.field_values->'work_period'->>'to',''), d.field_values->'work_period'->>'from') >= $3`,
      [OVERTIME_FORM_ID, empIds, from, to]
    )
  )) {
    const f = String(r.from_date ?? "");
    const t = String(r.to_date ?? f);
    if (!f) continue;
    const hours = Number(r.apply_hours);
    const minutes = Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : timeRangeMinutes(r.work_time) ?? 0;
    const time = timeRangeText(r.work_time);
    for (let d = f; d <= t && d <= to; d = addDays(d, 1)) {
      if (d < from) continue;
      const k = `${String(r.employee_id)}|${d}`;
      if (!otByEmpDate.has(k)) otByEmpDate.set(k, { minutes: 0, times: [] });
      const e = otByEmpDate.get(k)!;
      e.minutes += minutes;
      if (time) e.times.push(time);
    }
  }

  const view = (t: ReturnTag | null): MealReturnTagView | null =>
    t ? { hm: clockOfSec(t.sec), nextDay: t.sec >= 86400, terminal: TERMINAL_NAMES[t.terminalId] ?? t.terminalId, code: t.eventCode } : null;

  const rows: MealReturnRow[] = targets.map((it) => {
    const used8 = ymd8(it.usedOn);
    const next8 = ymd8(addDays(it.usedOn, 1));
    const raw = [...(tagsByEmpDate.get(`${it.employeeId}|${used8}`) ?? []), ...(tagsByEmpDate.get(`${it.employeeId}|${next8}`) ?? [])];
    const tags: ReturnTag[] = [];
    for (const t of raw) {
      const sec = tagSecOnDay(used8, next8, t.dDate, t.tTime);
      if (sec != null) tags.push({ sec, terminalId: t.terminalId, eventCode: t.eventCode });
    }
    const p = pairReturn(it.paidSec, tags, { delivery: isDeliveryVendor(it.vendor) });
    const ot = otByEmpDate.get(`${it.employeeId}|${it.usedOn}`);
    return {
      employeeId: it.employeeId,
      empName: it.empName,
      docId: it.docId,
      docNo: it.docNo,
      docStatus: it.docStatus,
      rowNo: it.rowNo,
      usedOn: it.usedOn,
      isOffDay: it.isOffDay,
      vendor: it.vendor,
      amount: it.amount,
      paidAtHm: clockOfSec(it.paidSec),
      payKind: it.payKind,
      status: p.status,
      lastBefore: view(p.lastBefore),
      next: view(p.next),
      minOutMinutes: p.minOutMinutes,
      maxOutMinutes: p.maxOutMinutes,
      appliedMinutes: ot?.minutes ?? 0,
      appliedTime: ot?.times.length ? ot.times.join(", ") : null,
      hasTags: tags.length > 0,
    };
  });
  rows.sort((a, b) => a.empName.localeCompare(b.empName, "ko") || a.usedOn.localeCompare(b.usedOn) || a.paidAtHm.localeCompare(b.paidAtHm));

  const nameByEmp = new Map(rows.map((r) => [r.employeeId, r.empName]));
  const people = summarizeByPerson(rows).map((s) => ({ ...s, empName: nameByEmp.get(s.employeeId) ?? "" }));
  return { from, to, rows, people, noTimeCount };
}
