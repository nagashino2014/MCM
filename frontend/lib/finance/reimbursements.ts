import { getDb, rowsToObjects } from "@/lib/db";

/*
 * 개인 경비 환급 이체 목록 (accounting-expansion §2 — 환급은 급여 합산 금지·별도 이체).
 * 결재 종결(approved)된 지출결의·출장보고의 **개인 지출 행**(영수증·수기 — 법인카드 행 제외)을
 * 기안자별로 집계해 이체 실행(수동)의 근거 목록을 만든다. journal.ts expense_doc 분개와
 * 같은 행 필터를 쓰며, **식대 불지급(withhold) 처분 행(마이그 203·204)은 자동 제외**한다
 * (분개에서도 동일하게 제외 — 회사가 환급하지 않는 지출). 급여 차감(deduct) 처분 행은
 * 환급에는 포함하되 표시한다 — 회수는 급여대장 '식대환수' 공제로 이뤄지므로 여기서도 빼면
 * 이중 불이익이 된다.
 */

export interface ReimburseRow {
  docId: string;
  docNo: string | null;
  formId: string;
  rowNo: number;
  usedOn: string | null; // 사용일(YYYY-MM-DD)
  vendor: string | null;
  category: string | null;
  amount: number;
  /** 'receipt'=개인카드 영수증 · 'manual'=수기 행 */
  kind: "receipt" | "manual";
  /** 식대 처분(마이그 204): withhold 면 환급 제외(합계 미포함), deduct 면 급여 차감 병행 표시 */
  mealAction: "withhold" | "deduct" | null;
}

export interface ReimburseEmployee {
  employeeId: string;
  name: string;
  /** 환급 이체액 = 개인 지출 합 - 불지급 처분 합 */
  payable: number;
  withheldTotal: number;
  withheldCount: number;
  rows: ReimburseRow[];
}

export interface ReimburseList {
  from: string;
  to: string;
  employees: ReimburseEmployee[];
  summary: { people: number; rowCount: number; payableTotal: number; withheldTotal: number; withheldCount: number };
}

const DOC_TABLES: Record<string, { tableKey: string; dateKey: string }> = {
  "frm-expense-report": { tableKey: "expenses", dateKey: "used_on" },
  "frm-biz-trip-report": { tableKey: "trip_expenses", dateKey: "spent_on" },
};

/** 결재 종결일(completed_at) 기준 [from, to] 구간의 환급 이체 목록. */
export async function listReimbursements(from: string, to: string): Promise<ReimburseList> {
  const db = await getDb();
  const docs = rowsToObjects(
    await db.exec(
      `SELECT doc_id, form_id, doc_no, drafter_employee_id, drafter_name, field_values
         FROM approval_docs
        WHERE status = 'approved' AND form_id IN ('frm-expense-report', 'frm-biz-trip-report')
          AND drafter_employee_id IS NOT NULL
          AND substr(completed_at, 1, 10) BETWEEN $1 AND $2
        ORDER BY completed_at`,
      [from, to]
    )
  );

  // 식대 처분(withhold/deduct) — 키 doc_id|row_no. 마이그 203·204 미적용 환경은 빈 맵.
  const mealActions = new Map<string, "withhold" | "deduct">();
  if (docs.length) {
    try {
      for (const r of rowsToObjects(
        await db.exec(
          `SELECT doc_id, row_no, action FROM overtime_meal_warnings
            WHERE action IN ('withhold','deduct') AND doc_id = ANY($1::text[])`,
          [docs.map((d) => String(d.doc_id))]
        )
      )) {
        mealActions.set(`${String(r.doc_id)}|${Number(r.row_no)}`, String(r.action) as "withhold" | "deduct");
      }
    } catch {
      /* 마이그 미적용 — 처분 없음 */
    }
  }

  const byEmp = new Map<string, ReimburseEmployee>();
  for (const doc of docs) {
    const docId = String(doc.doc_id);
    const formId = String(doc.form_id);
    const spec = DOC_TABLES[formId];
    if (!spec) continue;
    const fv = (doc.field_values ?? {}) as Record<string, unknown>;
    const rows = Array.isArray(fv[spec.tableKey]) ? (fv[spec.tableKey] as Array<Record<string, unknown>>) : [];
    const empId = String(doc.drafter_employee_id);

    for (const [rowIdx, row] of rows.entries()) {
      if (!row || typeof row !== "object") continue;
      if (typeof row._cardTxnId === "string" && row._cardTxnId) continue; // 법인카드 — 환급 아님
      const amount = Math.round(Number(String(row.amount ?? "").replace(/[^0-9.-]/g, "")));
      if (!amount || amount <= 0) continue;
      const rowNo = rowIdx + 1;
      const mealAction = mealActions.get(`${docId}|${rowNo}`) ?? null;
      const usedOn = /^\d{4}-\d{2}-\d{2}/.exec(String(row[spec.dateKey] ?? ""))?.[0] ?? null;

      const emp =
        byEmp.get(empId) ??
        ({
          employeeId: empId,
          name: String(doc.drafter_name ?? ""),
          payable: 0,
          withheldTotal: 0,
          withheldCount: 0,
          rows: [],
        } as ReimburseEmployee);
      emp.rows.push({
        docId,
        docNo: doc.doc_no != null ? String(doc.doc_no) : null,
        formId,
        rowNo,
        usedOn,
        vendor: row.vendor != null && String(row.vendor) !== "" ? String(row.vendor) : null,
        category: row.category != null && String(row.category) !== "" ? String(row.category) : null,
        amount,
        kind: typeof row._receiptId === "string" && row._receiptId ? "receipt" : "manual",
        mealAction,
      });
      if (mealAction === "withhold") {
        emp.withheldTotal += amount;
        emp.withheldCount += 1;
      } else {
        emp.payable += amount;
      }
      byEmp.set(empId, emp);
    }
  }

  const employees = [...byEmp.values()]
    .filter((e) => e.rows.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    from,
    to,
    employees,
    summary: {
      people: employees.filter((e) => e.payable > 0).length,
      rowCount: employees.reduce((a, e) => a + e.rows.length, 0),
      payableTotal: employees.reduce((a, e) => a + e.payable, 0),
      withheldTotal: employees.reduce((a, e) => a + e.withheldTotal, 0),
      withheldCount: employees.reduce((a, e) => a + e.withheldCount, 0),
    },
  };
}
