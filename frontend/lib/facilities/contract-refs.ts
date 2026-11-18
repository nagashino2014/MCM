import { rowsToObjects, type PgDatabase } from "@/lib/db";

/*
 * 사업장을 쓰는 살아 있는 계약(사용자 지시 2026-11-18) — 사업장 삭제 전에 확인한다.
 * 예전에는 삭제가 계약 참조를 보지 않아, 중복 사업장을 지우면서 그 사업장을 계약상대로 쓰던 계약 20건이
 * 지워진 사업장을 가리키게 됐다(372 로 재연결). 중복 사업장은 삭제 대신 [중복 병합](api/facilities/merge — 계약 참조를 옮긴다)으로 합친다.
 *   매출 계약: 계약상대(counterparty_facility_id)·대상사업장(facility_id)·통합허가 대상사업장(contract_facilities)
 *   매입 계약: 계약상대(purchase_contracts.counterparty_facility_id)
 */

export interface FacilityContractRefs {
  sales: number;
  purchase: number;
  /** 앞의 몇 건 계약명(안내용) */
  titles: string[];
}

type Db = Pick<PgDatabase, "exec">;

export async function facilityContractRefs(db: Db, facilityId: string): Promise<FacilityContractRefs> {
  const rows = rowsToObjects(
    await db.exec(
      `WITH sales AS (
         SELECT c.contract_id, c.contract_title, COALESCE(NULLIF(c.contract_date, ''), c.created_at) AS d
           FROM contracts c
          WHERE c.deleted_at IS NULL
            AND (c.counterparty_facility_id = $1 OR c.facility_id = $1
                 OR EXISTS (SELECT 1 FROM contract_facilities cf WHERE cf.contract_id = c.contract_id AND cf.facility_id = $1))
       ), purchase AS (
         SELECT p.purchase_contract_id, p.contract_title, COALESCE(p.contract_date, '') AS d
           FROM purchase_contracts p
          WHERE p.deleted_at IS NULL AND p.counterparty_facility_id = $1
       )
       SELECT (SELECT COUNT(*) FROM sales) AS sales_n,
              (SELECT COUNT(*) FROM purchase) AS purchase_n,
              (SELECT string_agg(t, E'\\n') FROM (
                 SELECT contract_title AS t FROM (SELECT contract_title, d FROM sales UNION ALL SELECT contract_title, d FROM purchase) u
                  ORDER BY d DESC NULLS LAST LIMIT 3) x) AS titles`,
      [facilityId]
    )
  );
  const r = rows[0] ?? {};
  return {
    sales: Number(r.sales_n ?? 0),
    purchase: Number(r.purchase_n ?? 0),
    titles: String(r.titles ?? "").split("\n").map((t) => t.trim()).filter(Boolean),
  };
}

/** 삭제를 막을 때 보여 줄 안내 — 계약이 없으면 null */
export function facilityDeleteBlockedMessage(refs: FacilityContractRefs): string | null {
  const total = refs.sales + refs.purchase;
  if (total === 0) return null;
  const parts = [refs.sales ? `매출 계약 ${refs.sales}건` : "", refs.purchase ? `매입 계약 ${refs.purchase}건` : ""].filter(Boolean).join("·");
  const sample = refs.titles.length ? ` (예: ${refs.titles.join(", ")}${total > refs.titles.length ? " 등" : ""})` : "";
  return `이 사업장을 쓰는 계약이 있어 지울 수 없습니다 — ${parts}${sample}. 중복 사업장이면 [중복 병합]으로 남길 사업장에 합치세요(계약이 함께 옮겨집니다).`;
}
