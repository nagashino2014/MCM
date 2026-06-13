import { getDb, rowsToObjects } from "@/lib/db";
import { categoryCaseSql } from "./contracts";
import type {
  ContractCollectionRow,
  ContractCollectionsOrdersYearly,
  ContractCollectionsStatus,
} from "./collections-types";

// 클라이언트 공용 타입은 collections-types.ts 에 정의하고 여기서 재노출한다.
export * from "./collections-types";

/** 계약 기준일/금액 폴백 — contracts.ts 의 집계 규칙과 동일 */
const CONTRACT_DATE_SQL = "COALESCE(NULLIF(c.contract_date, ''), c.started_at, c.created_at)";
const CONTRACT_AMOUNT_SQL = "COALESCE(c.current_amount, c.contract_amount, 0)";

/**
 * 수주/수금/발행 현황 — 수금 현황.
 * 수금 완료(payment_collected=1)된 청구·수금 단계 전체와,
 * 수금 비율 계산용 연도별 수주액을 함께 반환한다.
 * 용역분류/연도 필터링은 클라이언트 및 export 라우트에서 공통으로 수행한다.
 */
export async function getContractCollectionsStatus(): Promise<ContractCollectionsStatus> {
  const db = await getDb();
  const catCase = categoryCaseSql("c.service_type");

  const yearRows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) AS year
       FROM contracts c
       WHERE c.deleted_at IS NULL
       ORDER BY year DESC
       LIMIT 14`
    )
  );
  const availableYears = yearRows
    .map((r) => String(r.year ?? ""))
    .filter((y) => /^\d{4}$/.test(y));

  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id,
              c.contract_title,
              COALESCE(f.company_name, '') AS counterparty_name,
              ${catCase} AS category,
              COALESCE(c.service_subtype, '') AS subtype,
              m.milestone_id,
              m.stage_label,
              SUBSTRING(${CONTRACT_DATE_SQL}, 1, 10) AS contract_date,
              COALESCE(m.collected_amount, m.amount, 0) AS amount,
              SUBSTRING(m.payment_collected_at, 1, 10) AS collected_at,
              SUBSTRING(m.invoice_issued_at, 1, 10) AS invoice_issued_at
       FROM contract_payment_milestones m
       JOIN contracts c ON c.contract_id = m.contract_id
       LEFT JOIN facilities f ON f.facility_id = c.counterparty_facility_id
       WHERE c.deleted_at IS NULL
         AND m.payment_collected = 1
         AND COALESCE(m.collected_amount, m.amount, 0) > 0
       ORDER BY collected_at DESC NULLS LAST, c.contract_title ASC, m.stage_order ASC`
    )
  );

  // 수금 비율(수금액 / 수주액) 계산용 — 연도/분류별 수주액
  const currentYear = new Date().getFullYear();
  const fromYear = String(currentYear - 9);
  const ordersRows = rowsToObjects(
    await db.exec(
      `SELECT SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) AS year,
              ${catCase} AS category,
              SUM(${CONTRACT_AMOUNT_SQL}) AS amount
       FROM contracts c
       WHERE c.deleted_at IS NULL
         AND SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) BETWEEN $1 AND $2
       GROUP BY 1, 2`,
      [fromYear, String(currentYear)]
    )
  );
  const ordersMap = new Map<string, ContractCollectionsOrdersYearly>();
  for (let y = Number(fromYear); y <= currentYear; y += 1) {
    ordersMap.set(String(y), { year: String(y), total: 0, byCategory: {} });
  }
  for (const r of ordersRows) {
    const entry = ordersMap.get(String(r.year ?? ""));
    if (!entry) continue;
    const cat = String(r.category ?? "기타 용역");
    const amount = toNumber(r.amount);
    entry.total += amount;
    entry.byCategory[cat] = (entry.byCategory[cat] ?? 0) + amount;
  }

  const mapped: ContractCollectionRow[] = rows.map((r) => ({
    contractId: String(r.contract_id ?? ""),
    contractTitle: String(r.contract_title ?? ""),
    counterpartyName: String(r.counterparty_name ?? ""),
    category: String(r.category ?? "기타 용역"),
    subtype: String(r.subtype ?? ""),
    milestoneId: String(r.milestone_id ?? ""),
    stageLabel: String(r.stage_label ?? ""),
    contractDate: r.contract_date != null ? String(r.contract_date) : null,
    amount: toNumber(r.amount),
    collectedAt: r.collected_at != null ? String(r.collected_at) : null,
    invoiceIssuedAt: r.invoice_issued_at != null ? String(r.invoice_issued_at) : null,
  }));

  return {
    availableYears,
    rows: mapped,
    ordersYearly: [...ordersMap.values()],
  };
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
