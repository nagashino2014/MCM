// 법인카드 사용 건의 지출 목적·연관 용역/사업장(2026-10-16, 마이그 283 expense_card_tags).
// 카드 매입 원장은 회계 보호 표라 컬럼을 늘리지 않고 이 표에 따로 둔다(배포 게이트·부가세 확정 가드와 분리).
// 법인카드 불러오기 모달에서 기입하고, 결의서·출장보고서를 저장할 때 표 행 값으로 갱신한다.
// 다음에 같은 카드 건을 다시 불러오면(문서 삭제 후 재기안 등) 이 값이 모달에 미리 들어간다.

import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import type { RelatedRef } from "@/lib/approval/expense-purpose";

export interface CardExpenseTag {
  purpose: string | null;
  related: RelatedRef | null;
}

/** 카드 건 ID 묶음의 태그(연관 용역/사업장 이름 조인) */
export async function loadCardExpenseTags(cardTxnIds: string[]): Promise<Map<string, CardExpenseTag>> {
  const out = new Map<string, CardExpenseTag>();
  if (!cardTxnIds.length) return out;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT t.card_txn_id, t.purpose, t.related_contract_id, t.related_facility_id,
              rc.contract_title AS related_contract_title, rf.company_name AS related_facility_name
         FROM expense_card_tags t
         LEFT JOIN contracts rc ON rc.contract_id = t.related_contract_id
         LEFT JOIN facilities rf ON rf.facility_id = t.related_facility_id
        WHERE t.card_txn_id = ANY($1::text[])`,
      [cardTxnIds]
    )
  );
  for (const r of rows) {
    out.set(String(r.card_txn_id), {
      purpose: r.purpose ? String(r.purpose) : null,
      related:
        r.related_contract_id || r.related_facility_id
          ? {
              label: String(r.related_contract_title ?? r.related_facility_name ?? ""),
              contractId: r.related_contract_id ? String(r.related_contract_id) : null,
              facilityId: r.related_facility_id ? String(r.related_facility_id) : null,
            }
          : null,
    });
  }
  return out;
}

/** 문서 저장 시 — 표 행(_cardTxnId)의 지출 목적·연관 용역/사업장을 태그 표에 반영한다. 행에 값이 없으면 기존 값을 둔다. */
export async function syncCardExpenseTags(fieldValues: Record<string, unknown>, actorUserId: string): Promise<void> {
  const refs: Array<{ id: string; purpose: string | null; contractId: string | null; facilityId: string | null }> = [];
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  for (const value of Object.values(fieldValues)) {
    if (!Array.isArray(value)) continue;
    for (const row of value) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const id = str(r._cardTxnId);
      if (!id) continue;
      refs.push({ id, purpose: str(r.detail), contractId: str(r._relatedContractId), facilityId: str(r._relatedFacilityId) });
    }
  }
  const tagged = refs.filter((r) => r.purpose || r.contractId || r.facilityId);
  if (!tagged.length) return;
  const now = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
  await withDbWrite(async (db) => {
    for (const r of tagged) {
      await db.run(
        `INSERT INTO expense_card_tags (card_txn_id, purpose, related_contract_id, related_facility_id, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (card_txn_id) DO UPDATE SET
           purpose = COALESCE(EXCLUDED.purpose, expense_card_tags.purpose),
           related_contract_id = CASE WHEN EXCLUDED.related_contract_id IS NOT NULL OR EXCLUDED.related_facility_id IS NOT NULL
                                      THEN EXCLUDED.related_contract_id ELSE expense_card_tags.related_contract_id END,
           related_facility_id = CASE WHEN EXCLUDED.related_contract_id IS NOT NULL OR EXCLUDED.related_facility_id IS NOT NULL
                                      THEN EXCLUDED.related_facility_id ELSE expense_card_tags.related_facility_id END,
           updated_by = EXCLUDED.updated_by,
           updated_at = EXCLUDED.updated_at`,
        [r.id, r.purpose, r.contractId, r.facilityId, actorUserId, now]
      );
    }
  });
}
