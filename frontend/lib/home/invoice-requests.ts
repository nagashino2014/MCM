/**
 * 홈 대시보드 세금계산서 발행 요청 워크플로 조회 계층 (H10·H11).
 * 요청 상태 = contract_payment_milestones.invoice_requested_at 존재 AND invoice_issued=0.
 * (069 마이그레이션 컬럼. 발행 완료 시 요청 상태는 자동 해소된다.)
 *
 * mutation(요청/취소/발행)은 각 라우트에서 withDbWrite 로 직접 처리하고, 여기서는 조회만 담당한다.
 */
import { getDb, rowsToObjects } from "@/lib/db";

/** H10 트리의 대금단위(자식 노드). */
export interface InvoiceRequestMilestone {
  milestoneId: string;
  stageLabel: string | null;
  stageOrder: number;
  amount: number | null;
  requested: boolean;
  requestedAt: string | null;
  requestNote: string | null;
}

/** H10 트리의 계약(부모 노드). */
export interface InvoiceRequestContract {
  contractId: string;
  contractTitle: string | null;
  serviceType: string | null;
  facilityName: string | null;
  milestones: InvoiceRequestMilestone[];
}

/**
 * H10 — 세션 사용자가 참여(service_participants)한 계약의 미발행 대금단위 트리.
 * 계약(부모) → 대금단위(자식). 발주처 사업장명(counterparty)을 함께 담아 표시한다.
 * 계정-직원(employee_profiles.user_id) 미연결이면 빈 배열.
 */
export async function listInvoiceRequestsMine(userId: string): Promise<InvoiceRequestContract[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id,
              c.contract_title,
              c.service_type,
              f.company_name AS facility_name,
              m.milestone_id,
              m.stage_label,
              m.stage_order,
              m.amount,
              m.invoice_requested_at,
              m.invoice_request_note
         FROM service_participants sp
         JOIN employee_profiles ep ON ep.employee_id = sp.employee_id
         JOIN contracts c ON c.contract_id = sp.contract_id
         LEFT JOIN facilities f ON f.facility_id = c.counterparty_facility_id
         JOIN contract_payment_milestones m ON m.contract_id = c.contract_id
        WHERE ep.user_id = $1
          AND m.invoice_issued = 0
        ORDER BY c.contract_title NULLS LAST, c.contract_id, m.stage_order`,
      [userId]
    )
  );

  const byContract = new Map<string, InvoiceRequestContract>();
  for (const r of rows) {
    const contractId = String(r.contract_id);
    let node = byContract.get(contractId);
    if (!node) {
      node = {
        contractId,
        contractTitle: r.contract_title != null ? String(r.contract_title) : null,
        serviceType: r.service_type != null ? String(r.service_type) : null,
        facilityName: r.facility_name != null ? String(r.facility_name) : null,
        milestones: [],
      };
      byContract.set(contractId, node);
    }
    const requestedAt = r.invoice_requested_at != null ? String(r.invoice_requested_at) : null;
    node.milestones.push({
      milestoneId: String(r.milestone_id),
      stageLabel: r.stage_label != null ? String(r.stage_label) : null,
      stageOrder: Number(r.stage_order ?? 0),
      amount: r.amount != null ? Number(r.amount) : null,
      requested: !!requestedAt,
      requestedAt,
      requestNote: r.invoice_request_note != null ? String(r.invoice_request_note) : null,
    });
  }
  return [...byContract.values()];
}

/** H11 수신함 행. */
export interface InvoiceInboxItem {
  milestoneId: string;
  contractId: string;
  contractTitle: string | null;
  serviceType: string | null;
  facilityName: string | null;
  stageLabel: string | null;
  amount: number | null;
  requestedAt: string | null;
  requestedByName: string | null;
  requestNote: string | null;
}

/**
 * H11 — 발행 요청됨(& 미발행) 대금단위 리스트. 회계 담당자 수신함.
 * 요청일 오름차순(오래된 요청 먼저).
 */
export async function listInvoiceRequestInbox(): Promise<InvoiceInboxItem[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT m.milestone_id,
              m.contract_id,
              m.stage_label,
              m.amount,
              m.invoice_requested_at,
              m.invoice_request_note,
              c.contract_title,
              c.service_type,
              f.company_name AS facility_name,
              req.name AS requested_by_name
         FROM contract_payment_milestones m
         JOIN contracts c ON c.contract_id = m.contract_id
         LEFT JOIN facilities f ON f.facility_id = c.counterparty_facility_id
         LEFT JOIN employee_profiles req ON req.employee_id = m.invoice_requested_by
        WHERE m.invoice_requested_at IS NOT NULL
          AND m.invoice_issued = 0
        ORDER BY m.invoice_requested_at ASC`,
      []
    )
  );
  return rows.map((r) => ({
    milestoneId: String(r.milestone_id),
    contractId: String(r.contract_id),
    contractTitle: r.contract_title != null ? String(r.contract_title) : null,
    serviceType: r.service_type != null ? String(r.service_type) : null,
    facilityName: r.facility_name != null ? String(r.facility_name) : null,
    stageLabel: r.stage_label != null ? String(r.stage_label) : null,
    amount: r.amount != null ? Number(r.amount) : null,
    requestedAt: r.invoice_requested_at != null ? String(r.invoice_requested_at) : null,
    requestedByName: r.requested_by_name != null ? String(r.requested_by_name) : null,
    requestNote: r.invoice_request_note != null ? String(r.invoice_request_note) : null,
  }));
}
