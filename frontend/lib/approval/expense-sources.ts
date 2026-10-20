// 지출 표 행의 출처 규칙(G-8, 2026-10-20 사용자 확정) — 클라이언트·서버 공용(DB 접근 없음).
// 지출 행은 증빙 목록에서 불러와서만 만든다(직접 입력 불허).
//   · 지출결의서(법인카드) = 법인카드 승인건(_cardTxnId)만. 쇼핑몰 전표는 카드 승인건과 매칭된 것만(같은 _cardTxnId).
//   · 지출결의서(개인)     = 개인 증빙(_receiptId)만 — 모바일 촬영 영수증 또는 웹의 '기타 개인 지출증빙'.
//   · 출장보고서           = 법인카드 승인건 또는 개인 증빙.
// 불러온 행의 사용일·상호·금액은 증빙 값 그대로 둔다(화면 잠금 + 서버가 사용일·금액을 원본과 대조).
// 서버 검사: lib/approval/expense-sources-check.ts

export type ExpenseSourceKind = "card" | "receipt";

export interface ExpenseSourceForm {
  tableKey: string;
  dateKey: string;
  allowed: readonly ExpenseSourceKind[];
}

export const EXPENSE_SOURCE_FORMS: Record<string, ExpenseSourceForm> = {
  "frm-expense-report": { tableKey: "expenses", dateKey: "used_on", allowed: ["card"] },
  "frm-expense-personal": { tableKey: "expenses", dateKey: "used_on", allowed: ["receipt"] },
  "frm-biz-trip-report": { tableKey: "trip_expenses", dateKey: "spent_on", allowed: ["card", "receipt"] },
};

/** 불러온 값 그대로 두는(편집 잠금) 열 — 날짜 열은 양식별 dateKey */
export function lockedExpenseColumns(form: ExpenseSourceForm): string[] {
  return [form.dateKey, "vendor", "amount"];
}

const META_KEYS = new Set(["_cardTxnId", "_receiptId", "_shopReceiptId", "_relatedContractId", "_relatedFacilityId"]);

/** 값이 하나라도 있는 행(빈 행은 검사·정산 대상이 아니다) — fields.ts missingTableRequirements 와 같은 기준 */
export function expenseRowHasContent(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  return Object.entries(row as Record<string, unknown>).some(
    ([k, v]) => !META_KEYS.has(k) && (Array.isArray(v) ? v.length > 0 : String(v ?? "").trim() !== ""),
  );
}

const marker = (row: Record<string, unknown>, key: string): string | null => {
  const v = row[key];
  return typeof v === "string" && v ? v : null;
};

/** 행의 출처 — 표식이 없으면 null(직접 입력 행). 쇼핑몰 전표 행은 매칭된 카드 표식으로 판정한다. */
export function expenseRowSource(row: Record<string, unknown>): ExpenseSourceKind | null {
  if (marker(row, "_cardTxnId")) return "card";
  if (marker(row, "_receiptId")) return "receipt";
  return null;
}

/** 화면 표시용 — 행이 이 양식에서 허용되지 않는 사유(허용이면 null) */
export function expenseRowSourceIssue(formId: string, row: Record<string, unknown>): string | null {
  const form = EXPENSE_SOURCE_FORMS[formId];
  if (!form || !expenseRowHasContent(row)) return null;
  if (marker(row, "_cardTxnId") && marker(row, "_receiptId")) return "카드와 영수증 표식이 함께 있습니다";
  const kind = expenseRowSource(row);
  if (!kind) {
    return marker(row, "_shopReceiptId") ? "카드 승인건과 매칭되지 않은 쇼핑몰 전표입니다" : "직접 입력한 행입니다";
  }
  if (!form.allowed.includes(kind)) return kind === "card" ? "이 양식에는 법인카드 내역을 담을 수 없습니다" : "이 양식에는 개인 영수증을 담을 수 없습니다";
  if (marker(row, "_shopReceiptId") && formId !== "frm-expense-report") return "쇼핑몰 전표는 지출결의서(법인카드)에만 담습니다";
  return null;
}
