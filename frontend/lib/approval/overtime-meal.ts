import crypto from "node:crypto";
import { rowsToObjects, type PgDatabase } from "@/lib/db";
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

/** 식대로 보는 분류 옵션(마이그 199 — 회식·다과·직원 식대가 복리후생비로 통합). */
const MEAL_CATEGORY = "복리후생비";
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
  if (!rows.length || String(rows[0].form_id) !== "frm-expense-report") return;
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
  // 식대(복리후생비) 행만 대상 — 행 순번은 표 순서 기준 1부터(비식대 행 포함 순번).
  const mealRows = expenses
    .map((row, i) => ({ row, rowNo: i + 1 }))
    .filter(({ row }) => row && typeof row === "object" && String(row.category ?? "") === MEAL_CATEGORY);

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
