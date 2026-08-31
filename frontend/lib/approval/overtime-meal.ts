import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { timeRangeMinutes } from "@/lib/approval/fields";
import { OVERTIME_FORM_ID } from "@/lib/approval/overtime";
import { offDaySet } from "@/lib/hr/holidays";

/*
 * 지출결의서 식대 × 초과근무 신청 대조 (2026-08-27 사규 확정, 마이그 203).
 * 저녁 식대 인정 기준: 평일은 그 날 초과근무 신청 2시간 이상, 휴일(토·일·공휴일)은 4시간 이상.
 * 지출결의서(frm-expense-report) 상신 시 식대(복리후생비) 행의 사용일·결제시각을
 * 법인카드(card_transactions)·개인영수증(personal_receipts)에서 찾아 그 날 초과근무
 * 신청 시간(진행+승인 합)과 대조한다. 기준 미달이면:
 *   ① field_values._meal_check 스냅샷 저장 → 결재 화면 경고 배너(_over_limit 패턴)
 *   ② overtime_meal_warnings 에 이력 적재(문서 단위 재작성 — 재상신 멱등)
 * 상신은 막지 않는다 — 1차는 경고, 재발(과거 이력 존재)은 배너에 반환 청구 검토로 표시하고
 * 불지급/경고/반환은 결재자가 판단한다.
 */

/**
 * 검증 대상 양식 → 식대로 보는 분류 옵션. 양식별 라벨이 다르다:
 * 법인카드 지출결의서는 '복리후생비'(마이그 199 통합), 개인카드 지출결의서는 '식대'(마이그 202).
 * 둘 다 expenses 표·used_on 열을 쓴다. 출장보고서의 '식비'는 출장 중 식대라 대상이 아니다.
 */
const MEAL_FORM_CATEGORY: Record<string, string> = {
  "frm-expense-report": "복리후생비",
  "frm-expense-personal": "식대",
};
/** 평일 저녁 식사로 보는 결제 시각 하한 — 점심 회식·다과(초과근무와 무관)를 오탐하지 않기 위한 경계. */
const DINNER_FROM_HM = "17:00";
/** 인정 기준(분): 평일 2시간, 휴일 4시간. */
export const MEAL_REQUIRED_WEEKDAY_MIN = 120;
export const MEAL_REQUIRED_OFFDAY_MIN = 240;

export interface MealViolation {
  rowNo: number; // expenses 표 행 순번(1부터)
  usedOn: string; // YYYY-MM-DD
  vendor: string | null;
  amount: number | null;
  paidAtHm: string | null; // 결제 시각 'HH:MM'(미상 NULL)
  isOffDay: boolean;
  requiredMinutes: number;
  appliedMinutes: number; // 그 날 초과근무 신청 분
}

/** 상신 시 field_values._meal_check 로 고정 저장되는 판정 스냅샷. */
export interface MealCheckSnapshot {
  checkedAt: string;
  /** 이 문서 이전의 경고 이력 수 — 0이면 1차 경고, 1 이상이면 재발(반환 청구 검토 대상). */
  priorWarningCount: number;
  violations: MealViolation[];
}

/**
 * 식대 행 1건 판정(순수 함수).
 * 휴일: 결제 시각 무관 4시간 기준. 평일: 저녁(17:00 이후) 결제만 2시간 기준 —
 * 결제 시각을 알 수 없는 수기 행은 점심(무관 지출)일 수 있어 판정하지 않는다(오탐 방지).
 */
export function evaluateMealRow(input: {
  paidAtHm: string | null;
  isOffDay: boolean;
  appliedMinutes: number;
}): { violation: boolean; requiredMinutes: number } | null {
  if (input.isOffDay) {
    return { violation: input.appliedMinutes < MEAL_REQUIRED_OFFDAY_MIN, requiredMinutes: MEAL_REQUIRED_OFFDAY_MIN };
  }
  if (!input.paidAtHm || input.paidAtHm < DINNER_FROM_HM) return null;
  return { violation: input.appliedMinutes < MEAL_REQUIRED_WEEKDAY_MIN, requiredMinutes: MEAL_REQUIRED_WEEKDAY_MIN };
}

const hoursToMin = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 60) : 0;
};

/** 'YYYY-MM-DD HH:MI(:SS)' 류 텍스트에서 'HH:MM' 추출 — 날짜만 있으면(롯데카드 등) null. */
function hmOf(v: unknown): string | null {
  const m = /\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2})/.exec(String(v ?? ""));
  return m ? m[1] : null;
}

/** 직원의 특정 일자들에 대한 초과근무 신청 분(진행+승인 합) — 날짜별 맵. */
async function loadAppliedMinutes(
  db: PgDatabase,
  employeeId: string,
  dates: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!dates.length) return map;
  // 기간(from~to) 신청(구양식)도 커버하도록 범위 겹침으로 매칭한다.
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.field_values->'work_period'->>'from' AS from_date,
              COALESCE(NULLIF(d.field_values->'work_period'->>'to',''),
                       d.field_values->'work_period'->>'from') AS to_date,
              d.field_values->>'apply_hours' AS apply_hours,
              d.field_values->'work_time' AS work_time
         FROM approval_docs d
        WHERE d.form_id = $1 AND d.status IN ('in_progress','approved')
          AND d.drafter_employee_id = $2
          AND (d.field_values->'work_period'->>'from') <= $4
          AND COALESCE(NULLIF(d.field_values->'work_period'->>'to',''),
                       d.field_values->'work_period'->>'from') >= $3`,
      [OVERTIME_FORM_ID, employeeId, [...dates].sort()[0], [...dates].sort().pop()]
    )
  );
  for (const date of dates) {
    let sum = 0;
    for (const r of rows) {
      const from = String(r.from_date ?? "");
      const to = String(r.to_date ?? from);
      if (!from || date < from || date > to) continue;
      // 신청시간(apply_hours) 우선, 없으면 시간대(work_time) 길이로 산정.
      sum += hoursToMin(r.apply_hours) || timeRangeMinutes(r.work_time) || 0;
    }
    map.set(date, sum);
  }
  return map;
}

/**
 * 상신 시 식대 대조 판정을 field_values 에 고정 저장(submitDoc 트랜잭션 내부).
 * 위반이 없으면 기존 스냅샷·이력을 지운다(수정 후 재상신 대응).
 */
export async function assessMealChecksOnSubmit(txn: PgDatabase, docId: string): Promise<void> {
  const rows = rowsToObjects(
    await txn.exec(
      `SELECT form_id, drafter_employee_id, field_values FROM approval_docs WHERE doc_id = $1`,
      [docId]
    )
  );
  if (!rows.length) return;
  const mealCategory = MEAL_FORM_CATEGORY[String(rows[0].form_id)];
  if (!mealCategory) return;
  const employeeId = rows[0].drafter_employee_id != null ? String(rows[0].drafter_employee_id) : null;
  if (!employeeId) return;
  let fv: Record<string, unknown> = {};
  try {
    const v = typeof rows[0].field_values === "string" ? JSON.parse(rows[0].field_values) : rows[0].field_values;
    if (v && typeof v === "object") fv = v as Record<string, unknown>;
  } catch {
    return;
  }

  const expenses = Array.isArray(fv.expenses) ? (fv.expenses as Array<Record<string, unknown>>) : [];
  // 식대 분류 행만 대상 — 행 순번은 표 순서 기준 1부터(비식대 행 포함 순번).
  const mealRows = expenses
    .map((row, i) => ({ row, rowNo: i + 1 }))
    .filter(({ row }) => row && typeof row === "object" && String(row.category ?? "") === mealCategory);

  let violations: MealViolation[] = [];
  if (mealRows.length) {
    // 결제 시각: 법인카드는 승인일시, 개인카드는 영수증 거래일시에서 얻는다(수기 행은 미상).
    const txnIds = mealRows.map(({ row }) => String(row._cardTxnId ?? "")).filter(Boolean);
    const receiptIds = mealRows.map(({ row }) => String(row._receiptId ?? "")).filter(Boolean);
    const paidAtByTxn = new Map<string, string | null>();
    if (txnIds.length) {
      for (const r of rowsToObjects(
        await txn.exec(`SELECT card_txn_id, approved_at FROM card_transactions WHERE card_txn_id = ANY($1::text[])`, [txnIds])
      )) {
        paidAtByTxn.set(String(r.card_txn_id), hmOf(r.approved_at));
      }
    }
    const paidAtByReceipt = new Map<string, string | null>();
    if (receiptIds.length) {
      for (const r of rowsToObjects(
        await txn.exec(`SELECT receipt_id, paid_at FROM personal_receipts WHERE receipt_id = ANY($1::text[])`, [receiptIds])
      )) {
        paidAtByReceipt.set(String(r.receipt_id), hmOf(r.paid_at));
      }
    }

    const items = mealRows
      .map(({ row, rowNo }) => {
        const usedOn = /^\d{4}-\d{2}-\d{2}/.exec(String(row.used_on ?? ""))?.[0] ?? "";
        if (!usedOn) return null;
        const cardTxnId = String(row._cardTxnId ?? "");
        const receiptId = String(row._receiptId ?? "");
        const paidAtHm = cardTxnId
          ? paidAtByTxn.get(cardTxnId) ?? null
          : receiptId
            ? paidAtByReceipt.get(receiptId) ?? null
            : null;
        const amountNum = Number(String(row.amount ?? "").replace(/[^\d.]/g, ""));
        return {
          rowNo,
          usedOn,
          vendor: row.vendor != null && String(row.vendor) !== "" ? String(row.vendor) : null,
          amount: Number.isFinite(amountNum) && amountNum > 0 ? amountNum : null,
          paidAtHm,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const dates = Array.from(new Set(items.map((x) => x.usedOn)));
    const offDays = await offDaySet(Array.from(new Set(dates.map((d) => Number(d.slice(0, 4))))));
    const appliedByDate = await loadAppliedMinutes(txn, employeeId, dates);

    for (const it of items) {
      const dow = new Date(Date.parse(`${it.usedOn}T12:00:00Z`)).getUTCDay();
      const isOffDay = dow === 0 || dow === 6 || offDays.has(it.usedOn);
      const appliedMinutes = appliedByDate.get(it.usedOn) ?? 0;
      const verdict = evaluateMealRow({ paidAtHm: it.paidAtHm, isOffDay, appliedMinutes });
      if (verdict?.violation) {
        violations.push({
          rowNo: it.rowNo,
          usedOn: it.usedOn,
          vendor: it.vendor,
          amount: it.amount,
          paidAtHm: it.paidAtHm,
          isOffDay,
          requiredMinutes: verdict.requiredMinutes,
          appliedMinutes,
        });
      }
    }
    violations = violations.sort((a, b) => a.rowNo - b.rowNo);
  }

  // 이력은 문서 단위로 재작성한다(재상신 멱등). 재발 판정은 이 문서를 제외한 과거 이력 수.
  await txn.run(`DELETE FROM overtime_meal_warnings WHERE doc_id = $1`, [docId]);
  const next = { ...fv };
  if (!violations.length) {
    delete next._meal_check;
  } else {
    const prior = rowsToObjects(
      await txn.exec(
        `SELECT count(*) AS c FROM overtime_meal_warnings WHERE employee_id = $1 AND doc_id <> $2`,
        [employeeId, docId]
      )
    );
    const snapshot: MealCheckSnapshot = {
      checkedAt: new Date().toISOString(),
      priorWarningCount: Number(prior[0]?.c ?? 0),
      violations,
    };
    next._meal_check = snapshot;
    for (const v of violations) {
      await txn.run(
        `INSERT INTO overtime_meal_warnings
           (warning_id, employee_id, doc_id, used_on, row_no, vendor, amount, paid_at_hm,
            is_off_day, required_minutes, applied_minutes, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now()::text)`,
        [
          "omw-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14),
          employeeId, docId, v.usedOn, v.rowNo, v.vendor, v.amount, v.paidAtHm,
          v.isOffDay, v.requiredMinutes, v.appliedMinutes,
        ]
      );
    }
  }
  await txn.run(`UPDATE approval_docs SET field_values = $2::jsonb WHERE doc_id = $1`, [docId, JSON.stringify(next)]);
}

/* ── 관리자 처분(마이그 204) — 경고/불지급/급여 차감 ─────────────────────── */

/** 처분: warning=경고(기본) · withhold=불지급(환급 제외, 급여 영향 없음) · deduct=급여 차감(식대환수 공제). */
export type MealWarningAction = "warning" | "withhold" | "deduct";
export const MEAL_WARNING_ACTIONS: MealWarningAction[] = ["warning", "withhold", "deduct"];

export interface MealWarningRow {
  warningId: string;
  employeeId: string;
  empName: string;
  docId: string;
  docNo: string | null;
  docStatus: string | null;
  usedOn: string;
  rowNo: number;
  vendor: string | null;
  amount: number | null;
  paidAtHm: string | null;
  isOffDay: boolean;
  requiredMinutes: number;
  appliedMinutes: number;
  /** 이 건 이전의 누적 경고 수(재발 판정 — 1·2회는 경고, 반복 시 불지급·차감 대상) */
  priorCount: number;
  action: MealWarningAction;
  actionNote: string | null;
  actionAt: string | null;
  createdAt: string;
}

/** 귀속 구간(전월 26 ~ 금월 25 — 급여·대조와 동일)의 식대 경고 이력 + 직원별 누적. */
export async function listMealWarnings(payYear: number, payMonth: number): Promise<MealWarningRow[]> {
  const db = await getDb();
  const from = new Date(Date.UTC(payYear, payMonth - 2, 26)).toISOString().slice(0, 10);
  const to = `${payYear}-${String(payMonth).padStart(2, "0")}-25`;
  const rows = rowsToObjects(
    await db.exec(
      `SELECT w.warning_id, w.employee_id, p.name AS emp_name, w.doc_id, d.doc_no, d.status AS doc_status,
              to_char(w.used_on, 'YYYY-MM-DD') AS used_on, w.row_no, w.vendor, w.amount, w.paid_at_hm,
              w.is_off_day, w.required_minutes, w.applied_minutes,
              w.action, w.action_note, w.action_at, w.created_at,
              (SELECT count(*) FROM overtime_meal_warnings x
                WHERE x.employee_id = w.employee_id AND x.used_on < w.used_on) AS prior_count
         FROM overtime_meal_warnings w
         JOIN employee_profiles p ON p.employee_id = w.employee_id
         LEFT JOIN approval_docs d ON d.doc_id = w.doc_id
        WHERE w.used_on BETWEEN $1::date AND $2::date
        ORDER BY p.name, w.used_on, w.row_no`,
      [from, to]
    )
  );
  return rows.map((r) => ({
    warningId: String(r.warning_id),
    employeeId: String(r.employee_id),
    empName: String(r.emp_name ?? ""),
    docId: String(r.doc_id),
    docNo: r.doc_no != null ? String(r.doc_no) : null,
    docStatus: r.doc_status != null ? String(r.doc_status) : null,
    usedOn: String(r.used_on),
    rowNo: Number(r.row_no),
    vendor: r.vendor != null ? String(r.vendor) : null,
    amount: r.amount != null ? Number(r.amount) : null,
    paidAtHm: r.paid_at_hm != null ? String(r.paid_at_hm) : null,
    isOffDay: r.is_off_day === true || r.is_off_day === "t",
    requiredMinutes: Number(r.required_minutes),
    appliedMinutes: Number(r.applied_minutes),
    priorCount: Number(r.prior_count ?? 0),
    action: (MEAL_WARNING_ACTIONS as string[]).includes(String(r.action)) ? (String(r.action) as MealWarningAction) : "warning",
    actionNote: r.action_note != null ? String(r.action_note) : null,
    actionAt: r.action_at != null ? String(r.action_at) : null,
    createdAt: String(r.created_at ?? ""),
  }));
}

/** 처분 지정 — 경고로 되돌리면 메모·처분자 이력도 함께 지운다. */
export async function setMealWarningAction(
  warningId: string,
  action: MealWarningAction,
  note: string | null,
  actorUserId: string
): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE overtime_meal_warnings
          SET action = $2,
              action_note = $3,
              action_by = CASE WHEN $2 = 'warning' THEN NULL ELSE $4 END,
              action_at = CASE WHEN $2 = 'warning' THEN NULL ELSE now()::text END
        WHERE warning_id = $1`,
      [warningId, action, action === "warning" ? null : note, actorUserId]
    );
  });
}

/**
 * 급여대장 생성용 — 귀속 구간의 '급여 차감(deduct)' 처분 합계(직원별).
 * buildLedger 가 '식대환수'(meal-clawback) 공제 라인으로 반영한다.
 */
export async function mealClawbackAmounts(
  payYear: number,
  payMonth: number
): Promise<Map<string, { amount: number; count: number }>> {
  const db = await getDb();
  const from = new Date(Date.UTC(payYear, payMonth - 2, 26)).toISOString().slice(0, 10);
  const to = `${payYear}-${String(payMonth).padStart(2, "0")}-25`;
  const rows = rowsToObjects(
    await db.exec(
      `SELECT employee_id, sum(amount) AS amount, count(*) AS n
         FROM overtime_meal_warnings
        WHERE action = 'deduct' AND amount IS NOT NULL
          AND used_on BETWEEN $1::date AND $2::date
        GROUP BY employee_id`,
      [from, to]
    )
  );
  const map = new Map<string, { amount: number; count: number }>();
  for (const r of rows) {
    const amount = Math.round(Number(r.amount ?? 0));
    if (amount > 0) map.set(String(r.employee_id), { amount, count: Number(r.n ?? 0) });
  }
  return map;
}
