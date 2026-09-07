import { getDb, rowsToObjects } from "@/lib/db";
import type { ContractNoteStatus } from "./note-types";

// 어음 발행/만기 총괄 현황(2026-09-03 사용자 요청 — 세무사 반기별 제출용) — 서버 조회.
// 클라이언트 공용 타입·기간 계산·필터는 note-types.ts 에 정의하고 여기서 재노출한다.
export * from "./note-types";

/**
 * 어음 건 전체 — 어음 상세(마이그 200·201)가 입력됐거나 계약 지급 방식이 어음인 청구 단계.
 * 기간 필터링은 클라이언트/export 라우트에서 공통 수행한다(수금 현황 탭과 동일 방식).
 */
export async function getContractNoteStatus(contractIds?: string[] | null): Promise<ContractNoteStatus> {
  const db = await getDb();
  const scope = contractIds ? " AND c.contract_id = ANY($1)" : "";
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id, c.contract_title, c.payment_method,
              SUBSTRING(COALESCE(NULLIF(c.contract_date, ''), c.started_at, c.created_at), 1, 10) AS contract_date,
              COALESCE(f.company_name, '') AS counterparty_name,
              m.milestone_id, m.stage_label,
              COALESCE(m.invoice_amount, m.amount, 0) AS amount,
              SUBSTRING(m.invoice_issued_at, 1, 10) AS invoice_issued_at,
              m.payment_collected,
              SUBSTRING(m.payment_collected_at, 1, 10) AS payment_collected_at,
              COALESCE(m.collected_amount, 0) AS collected_amount,
              m.note_kind, m.note_bank,
              SUBSTRING(m.note_issued_date, 1, 10) AS note_issued_date,
              SUBSTRING(m.note_maturity_date, 1, 10) AS note_maturity_date,
              m.note_fee, m.note_loan_interest_amount,
              SUBSTRING(m.note_loan_executed_date, 1, 10) AS note_loan_executed_date
         FROM contract_payment_milestones m
         JOIN contracts c ON c.contract_id = m.contract_id
         LEFT JOIN facilities f ON f.facility_id = c.counterparty_facility_id
        WHERE c.deleted_at IS NULL
          AND (m.note_issued_date IS NOT NULL OR m.note_maturity_date IS NOT NULL
               OR m.note_bank IS NOT NULL OR m.note_kind IS NOT NULL
               OR c.payment_method LIKE '어음%')${scope}
        ORDER BY COALESCE(m.note_maturity_date, m.note_issued_date, m.invoice_issued_at) DESC NULLS LAST`,
      contractIds ? [contractIds] : []
    )
  );
  return {
    rows: rows.map((r) => ({
      contractId: String(r.contract_id),
      milestoneId: String(r.milestone_id),
      contractTitle: String(r.contract_title ?? ""),
      counterpartyName: String(r.counterparty_name ?? ""),
      stageLabel: String(r.stage_label ?? ""),
      contractDate: r.contract_date ? String(r.contract_date) : null,
      paymentMethod: r.payment_method ? String(r.payment_method) : null,
      amount: Number(r.amount ?? 0),
      invoiceIssuedAt: r.invoice_issued_at ? String(r.invoice_issued_at) : null,
      collected: Number(r.payment_collected ?? 0) === 1,
      collectedAt: r.payment_collected_at ? String(r.payment_collected_at) : null,
      collectedAmount: Number(r.collected_amount ?? 0),
      noteKind: r.note_kind ? String(r.note_kind) : null,
      noteBank: r.note_bank ? String(r.note_bank) : null,
      noteIssuedDate: r.note_issued_date ? String(r.note_issued_date) : null,
      noteMaturityDate: r.note_maturity_date ? String(r.note_maturity_date) : null,
      noteFee: r.note_fee == null ? null : Number(r.note_fee),
      noteLoanInterestAmount: r.note_loan_interest_amount == null ? null : Number(r.note_loan_interest_amount),
      noteLoanExecutedDate: r.note_loan_executed_date ? String(r.note_loan_executed_date) : null,
    })),
  };
}
