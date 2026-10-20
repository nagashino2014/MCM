// 지출 표 행 출처 서버 검사(G-8, 2026-10-20) — 규칙은 expense-sources.ts.
// 저장(POST /api/approval/docs)과 상신(submitDoc) 모두에서 부른다. 모바일·API 직접 호출도 같은 관문을 지난다.
//   · 내용이 있는 행은 양식이 허용하는 증빙 표식을 가져야 한다(직접 입력 행 거부).
//   · 증빙은 실제로 있고, 제외되지 않았고, 다른 문서에 연결되지 않아야 한다(1회 연결).
//     영수증은 기안자 본인 것만. 카드는 '승인' 건만.
//   · 행의 사용일·금액은 증빙 원본 값과 같아야 한다(화면은 이 두 칸과 상호를 잠근다).
//   · 한 문서 안에서 같은 증빙을 두 번 쓸 수 없다.

import { getDb, rowsToObjects, type PgDatabase } from "@/lib/db";
import { EXPENSE_SOURCE_FORMS, expenseRowHasContent, expenseRowSourceIssue } from "./expense-sources";

const amountOf = (v: unknown): number => Number(String(v ?? "").replace(/[^\d.-]/g, "")) || 0;
const ymd = (v: unknown): string => String(v ?? "").trim().slice(0, 10);

/** 위반 목록("지출 내역 2행: …") — 비어 있으면 통과. 대상 양식이 아니면 항상 빈 목록. */
export async function checkExpenseRowSources(params: {
  docId: string | null;
  formId: string;
  fieldValues: Record<string, unknown>;
  drafterUserId: string;
  db?: PgDatabase;
}): Promise<string[]> {
  const form = EXPENSE_SOURCE_FORMS[params.formId];
  if (!form) return [];
  const rawRows = params.fieldValues[form.tableKey];
  const rows = Array.isArray(rawRows) ? (rawRows as unknown[]) : [];
  const issues: string[] = [];
  const cardIds = new Map<string, number[]>();
  const receiptIds = new Map<string, number[]>();
  // 행 번호는 화면과 같게 내용 있는 행만 센다(기안 화면은 빈 행을 보여 주지 않는다).
  const rowNo = new Map<number, number>();

  rows.forEach((raw, idx) => {
    if (!expenseRowHasContent(raw)) return;
    rowNo.set(idx, rowNo.size + 1);
    const row = raw as Record<string, unknown>;
    const issue = expenseRowSourceIssue(params.formId, row);
    if (issue) {
      issues.push(`지출 내역 ${rowNo.get(idx)}행: ${issue} — 행을 삭제하고 불러오기로 다시 담으세요.`);
      return;
    }
    const card = typeof row._cardTxnId === "string" ? row._cardTxnId : "";
    const receipt = typeof row._receiptId === "string" ? row._receiptId : "";
    if (card) cardIds.set(card, [...(cardIds.get(card) ?? []), idx]);
    if (receipt) receiptIds.set(receipt, [...(receiptIds.get(receipt) ?? []), idx]);
  });

  for (const [, idxs] of [...cardIds, ...receiptIds]) {
    if (idxs.length > 1) issues.push(`지출 내역 ${idxs.map((i) => rowNo.get(i)).join("·")}행: 같은 증빙이 두 번 담겼습니다.`);
  }
  if (!cardIds.size && !receiptIds.size) return issues;

  const db = params.db ?? (await getDb());
  const rowAt = (idx: number) => rows[idx] as Record<string, unknown>;

  if (cardIds.size) {
    const found = new Map(
      rowsToObjects(
        await db.exec(
          `SELECT card_txn_id, doc_id, excluded, approval_type, amount_total, approved_at
             FROM card_transactions WHERE card_txn_id = ANY($1::text[])`,
          [[...cardIds.keys()]],
        ),
      ).map((r) => [String(r.card_txn_id), r]),
    );
    for (const [id, idxs] of cardIds) {
      const src = found.get(id);
      const at = idxs[0];
      const label = `지출 내역 ${rowNo.get(at)}행`;
      if (!src) issues.push(`${label}: 법인카드 승인건을 찾을 수 없습니다.`);
      else if (src.doc_id && String(src.doc_id) !== params.docId) issues.push(`${label}: 다른 문서에 이미 사용된 법인카드 승인건입니다.`);
      else if (Number(src.excluded ?? 0) === 1 || String(src.approval_type ?? "") !== "승인") issues.push(`${label}: 제외되었거나 승인 상태가 아닌 법인카드 건입니다.`);
      else if (amountOf(rowAt(at).amount) !== Number(src.amount_total) || ymd(rowAt(at)[form.dateKey]) !== ymd(src.approved_at)) {
        issues.push(`${label}: 사용일·금액이 법인카드 승인내역과 다릅니다 — 행을 삭제하고 다시 불러오세요.`);
      }
    }
  }

  if (receiptIds.size) {
    const found = new Map(
      rowsToObjects(
        await db.exec(
          `SELECT receipt_id, owner_user_id, doc_id, excluded, total_amount, paid_at
             FROM personal_receipts WHERE receipt_id = ANY($1::text[])`,
          [[...receiptIds.keys()]],
        ),
      ).map((r) => [String(r.receipt_id), r]),
    );
    for (const [id, idxs] of receiptIds) {
      const src = found.get(id);
      const at = idxs[0];
      const label = `지출 내역 ${rowNo.get(at)}행`;
      if (!src || String(src.owner_user_id) !== params.drafterUserId) issues.push(`${label}: 본인이 등록한 증빙을 찾을 수 없습니다.`);
      else if (src.doc_id && String(src.doc_id) !== params.docId) issues.push(`${label}: 다른 문서에 이미 사용된 증빙입니다.`);
      else if (Number(src.excluded ?? 0) === 1) issues.push(`${label}: 제외 처리된 증빙입니다.`);
      else if (amountOf(rowAt(at).amount) !== Number(src.total_amount) || ymd(rowAt(at)[form.dateKey]) !== ymd(src.paid_at)) {
        issues.push(`${label}: 사용일·금액이 증빙 원본과 다릅니다 — 행을 삭제하고 다시 불러오세요.`);
      }
    }
  }
  return issues;
}

/** 위반이 있으면 400 오류 — 메시지에 행 번호와 사유를 모두 담는다. */
export async function assertExpenseRowSources(params: Parameters<typeof checkExpenseRowSources>[0]): Promise<void> {
  const issues = await checkExpenseRowSources(params);
  if (issues.length) throw Object.assign(new Error(`지출 내역은 불러오기로만 담을 수 있습니다 — ${issues.join(" / ")}`), { status: 400 });
}
