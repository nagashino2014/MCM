import { getDb, rowsToObjects } from "@/lib/db";
import { categoryCaseSql } from "./contracts";
import type {
  ContractCompletionRow,
  ContractCompletionsStatus,
  ContractCompletionsYearlyContracts,
} from "./completions-types";

// 클라이언트 공용 타입은 completions-types.ts 에 정의하고 여기서 재노출한다.
export * from "./completions-types";

/** 계약 기준일 폴백 — contracts.ts 의 집계 규칙과 동일 */
const CONTRACT_DATE_SQL = "COALESCE(NULLIF(c.contract_date, ''), c.started_at, c.created_at)";

/**
 * 수주/수금/발행 현황 — 완료 현황.
 * 완료 건 = 완료일(허가일: contracts.permit_issued_at) 혹은
 * 완료일(발행일: 최종 대금지급단위의 계산서 발행일)이 존재하는 계약.
 * 완료 비율 계산용 연도별 계약 건수(전체/분류별/세분류별)를 함께 반환한다.
 */
export async function getContractCompletionsStatus(): Promise<ContractCompletionsStatus> {
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

  // 최종 대금지급단위(stage_order 최대)의 발행일 — 발행 완료(invoice_issued=1)인 경우만
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id,
              c.contract_title,
              COALESCE(f.company_name, '') AS counterparty_name,
              ${catCase} AS category,
              COALESCE(c.service_subtype, '') AS subtype,
              SUBSTRING(${CONTRACT_DATE_SQL}, 1, 10) AS contract_date,
              SUBSTRING(NULLIF(c.permit_issued_at, ''), 1, 10) AS permit_date,
              lm.invoice_done_date
       FROM contracts c
       LEFT JOIN facilities f ON f.facility_id = c.counterparty_facility_id
       LEFT JOIN (
         SELECT DISTINCT ON (contract_id) contract_id,
                CASE WHEN COALESCE(invoice_issued, 0) = 1
                     THEN SUBSTRING(invoice_issued_at, 1, 10)
                     ELSE NULL END AS invoice_done_date
         FROM contract_payment_milestones
         ORDER BY contract_id, stage_order DESC
       ) lm ON lm.contract_id = c.contract_id
       WHERE c.deleted_at IS NULL
         AND (NULLIF(c.permit_issued_at, '') IS NOT NULL OR lm.invoice_done_date IS NOT NULL)
       ORDER BY contract_date DESC NULLS LAST, c.contract_title ASC`
    )
  );

  // 완료 비율(완료 건수 / 계약 건수) 계산용 — 연도/분류/세분류별 계약 건수
  const currentYear = new Date().getFullYear();
  const fromYear = String(currentYear - 9);
  const countRows = rowsToObjects(
    await db.exec(
      `SELECT SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) AS year,
              ${catCase} AS category,
              COALESCE(c.service_subtype, '') AS subtype,
              COUNT(*) AS cnt
       FROM contracts c
       WHERE c.deleted_at IS NULL
         AND SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) BETWEEN $1 AND $2
       GROUP BY 1, 2, 3`,
      [fromYear, String(currentYear)]
    )
  );
  const countsMap = new Map<string, ContractCompletionsYearlyContracts>();
  for (let y = Number(fromYear); y <= currentYear; y += 1) {
    countsMap.set(String(y), { year: String(y), total: 0, byCategory: {}, bySubtype: {} });
  }
  for (const r of countRows) {
    const entry = countsMap.get(String(r.year ?? ""));
    if (!entry) continue;
    const cat = String(r.category ?? "기타 용역");
    const subtype = String(r.subtype ?? "").trim();
    const cnt = toNumber(r.cnt);
    entry.total += cnt;
    entry.byCategory[cat] = (entry.byCategory[cat] ?? 0) + cnt;
    if (subtype) {
      const subMap = entry.bySubtype[cat] ?? {};
      subMap[subtype] = (subMap[subtype] ?? 0) + cnt;
      entry.bySubtype[cat] = subMap;
    }
  }

  const mapped: ContractCompletionRow[] = rows.map((r) => ({
    contractId: String(r.contract_id ?? ""),
    contractTitle: String(r.contract_title ?? ""),
    counterpartyName: String(r.counterparty_name ?? ""),
    category: String(r.category ?? "기타 용역"),
    subtype: String(r.subtype ?? ""),
    contractDate: r.contract_date != null ? String(r.contract_date) : null,
    permitDate: r.permit_date != null ? String(r.permit_date) : null,
    invoiceDoneDate: r.invoice_done_date != null ? String(r.invoice_done_date) : null,
  }));

  return {
    availableYears,
    rows: mapped,
    contractsYearly: [...countsMap.values()],
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
