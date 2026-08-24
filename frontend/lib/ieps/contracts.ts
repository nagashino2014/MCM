import { getDb, rowsToObjects } from "@/lib/db";

export interface ContractListFilter {
  q?: string;
  year?: string;
  serviceType?: string;
  status?: string;
  collection?: "unissued" | "uncollected" | "issued" | "collected";
  sort?: "recent" | "amount" | "date";
  limit?: number;
  offset?: number;
  /** RBAC 가시 계약 범위. null/undefined = 제한 없음(전사), [] = 없음, [ids] = 해당 계약만. */
  contractIds?: string[] | null;
  /** 계약상대 업체(counterparty_facility_id) 한정 — 전자결재 업체↔계약 연동 검색용. */
  facilityId?: string;
  /** 계약일 하한(YYYY-MM-DD, contract_date 폴백 포함) — 최근 N년 계약 조회용. */
  dateFrom?: string;
}

export interface ContractListItem {
  contractId: string;
  contractTitle: string;
  counterpartyFacilityId: string;
  counterpartyName: string;
  facilityId: string | null;
  facilityName: string | null;
  legacyCompanyId: string | null;
  serviceType: string | null;
  serviceSubtype: string | null;
  contractKind: string;
  collectionProgressLabel: string | null;
  contractStatus: string;
  contractAmount: number | null;
  currentAmount: number | null;
  contractDate: string | null;
  startedAt: string | null;
  endedAt: string | null;
  milestoneCount: number;
  issuedCount: number;
  collectedCount: number;
  totalMilestoneAmount: number;
  totalIssuedAmount: number;
  totalCollectedAmount: number;
  collectionRate: number;
  updatedAt: string;
}

/**
 * Slim node payload tailored for the contract tree view (left ledger pane).
 * Only fields that the tree row needs for display, sorting or in-page text
 * search are included; richer metadata (service type, kind, collection rate,
 * progress label, etc.) is fetched on demand by the detail panel.
 */
export interface ContractTreeContractNode {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
  serviceSubtype: string | null;
  industryCategory: string | null;
  facilityIndustryName: string | null;
  facilityIndustryCode: string | null;
  currentAmount: number | null;
  contractDate: string | null;
  contractStatus: string;
  /** True when the total collected amount has reached the full contract amount. */
  isFullyCollected: boolean;
  /**
   * 완료 건 판정(2026-08-24, 트리 하단 집계용) — 완료일(허가일: permit_issued_at) 혹은
   * 완료일(발행일: 최종 대금지급단위의 발행일)이 존재하는 계약(completions-status 와 동일 정의).
   */
  isCompleted: boolean;
}

export interface ContractTreeServiceGroup {
  serviceType: string;
  contracts: ContractTreeContractNode[];
}

export interface ContractTreePayload {
  year: string | null;
  totalCount: number;
  availableYears: string[];
  groups: ContractTreeServiceGroup[];
}

export function mapContractListItem(row: Record<string, unknown>): ContractListItem {
  const totalMilestoneAmount = toNumber(row.total_milestone_amount);
  const totalCollectedAmount = toNumber(row.total_collected_amount);
  const baseAmount = toNumber(row.current_amount) || toNumber(row.contract_amount) || totalMilestoneAmount;
  const collectionRate = baseAmount > 0
    ? Math.min(1, Math.round((totalCollectedAmount / baseAmount) * 1000) / 1000)
    : 0;
  return {
    contractId: String(row.contract_id ?? ""),
    contractTitle: String(row.contract_title ?? ""),
    counterpartyFacilityId: String(row.counterparty_facility_id ?? ""),
    counterpartyName: String(row.counterparty_name ?? ""),
    facilityId: row.facility_id != null ? String(row.facility_id) : null,
    facilityName: row.facility_name != null ? String(row.facility_name) : null,
    legacyCompanyId: row.legacy_company_id != null ? String(row.legacy_company_id) : null,
    serviceType: row.service_type != null ? String(row.service_type) : null,
    serviceSubtype: row.service_subtype != null ? String(row.service_subtype) : null,
    contractKind: String(row.contract_kind ?? "standard"),
    collectionProgressLabel: row.collection_progress_label != null ? String(row.collection_progress_label) : null,
    contractStatus: String(row.contract_status ?? "draft"),
    contractAmount: toNumberOrNull(row.contract_amount),
    currentAmount: toNumberOrNull(row.current_amount),
    contractDate: row.contract_date != null ? String(row.contract_date) : null,
    startedAt: row.started_at != null ? String(row.started_at) : null,
    endedAt: row.ended_at != null ? String(row.ended_at) : null,
    milestoneCount: toNumber(row.milestone_count),
    issuedCount: toNumber(row.issued_count),
    collectedCount: toNumber(row.collected_count),
    totalMilestoneAmount,
    totalIssuedAmount: toNumber(row.total_issued_amount),
    totalCollectedAmount,
    collectionRate,
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function listContracts(filter: ContractListFilter) {
  const db = await getDb();
  const where: string[] = ["c.deleted_at IS NULL"];
  const params: unknown[] = [];

  const addParam = (value: unknown) => {
    params.push(value);
    return "$" + params.length;
  };

  if (filter.q) {
    const p = addParam("%" + filter.q.trim() + "%");
    where.push(`(c.contract_title ILIKE ${p} OR cp.company_name ILIKE ${p} OR c.legacy_company_id ILIKE ${p})`);
  }
  if (filter.year) {
    const p = addParam(filter.year);
    where.push(`COALESCE(NULLIF(c.contract_date, ''), c.started_at, c.created_at) LIKE ${p} || '%'`);
  }
  if (filter.serviceType) {
    const p = addParam(filter.serviceType);
    where.push(`c.service_type = ${p}`);
  }
  if (filter.status) {
    const p = addParam(filter.status);
    where.push(`c.contract_status = ${p}`);
  }
  if (filter.facilityId) {
    const p = addParam(filter.facilityId);
    where.push(`c.counterparty_facility_id = ${p}`);
  }
  if (filter.dateFrom) {
    const p = addParam(filter.dateFrom);
    where.push(`COALESCE(NULLIF(c.contract_date, ''), c.started_at, c.created_at) >= ${p}`);
  }
  if (filter.contractIds !== undefined && filter.contractIds !== null) {
    const p = addParam(filter.contractIds);
    where.push(`c.contract_id = ANY(${p})`);
  }
  if (filter.collection === "unissued") {
    where.push("COALESCE(ms.unissued_count, 0) > 0");
  } else if (filter.collection === "uncollected") {
    where.push("COALESCE(ms.uncollected_count, 0) > 0");
  } else if (filter.collection === "issued") {
    where.push("COALESCE(ms.issued_count, 0) > 0");
  } else if (filter.collection === "collected") {
    where.push("COALESCE(ms.collected_count, 0) > 0");
  }

  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  const orderBy =
    filter.sort === "amount"
      ? "COALESCE(c.current_amount, c.contract_amount, 0) DESC, c.updated_at DESC"
      : filter.sort === "date"
        ? "COALESCE(NULLIF(c.contract_date, ''), c.started_at, c.created_at) DESC, c.updated_at DESC"
        : "c.updated_at DESC";

  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const countRows = rowsToObjects(
    await db.exec(
      `SELECT COUNT(*) AS total
       FROM contracts c
       JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
       LEFT JOIN (
         SELECT contract_id,
                SUM(CASE WHEN invoice_issued = 0 AND COALESCE(amount, 0) > 0 THEN 1 ELSE 0 END) AS unissued_count,
                SUM(CASE WHEN payment_collected = 0 AND COALESCE(amount, 0) > 0 THEN 1 ELSE 0 END) AS uncollected_count,
                SUM(CASE WHEN invoice_issued = 1 THEN 1 ELSE 0 END) AS issued_count,
                SUM(CASE WHEN payment_collected = 1 THEN 1 ELSE 0 END) AS collected_count
         FROM contract_payment_milestones
         GROUP BY contract_id
       ) ms ON ms.contract_id = c.contract_id
       ${whereSql}`,
      params
    )
  );

  const listRows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id,
              c.contract_title,
              c.counterparty_facility_id,
              cp.company_name AS counterparty_name,
              c.facility_id,
              f.company_name AS facility_name,
              c.legacy_company_id,
              c.service_type,
              c.service_subtype,
              c.contract_kind,
              c.collection_progress_label,
              c.contract_status,
              c.contract_amount,
              COALESCE(c.current_amount, c.contract_amount) AS current_amount,
              c.contract_date,
              c.started_at,
              c.ended_at,
              c.updated_at,
              COALESCE(ms.milestone_count, 0) AS milestone_count,
              COALESCE(ms.issued_count, 0) AS issued_count,
              COALESCE(ms.collected_count, 0) AS collected_count,
              COALESCE(ms.total_milestone_amount, 0) AS total_milestone_amount,
              COALESCE(ms.total_issued_amount, 0) AS total_issued_amount,
              COALESCE(ms.total_collected_amount, 0) AS total_collected_amount
       FROM contracts c
       JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
       LEFT JOIN facilities f ON f.facility_id = c.facility_id
       LEFT JOIN (
         SELECT contract_id,
                COUNT(*) AS milestone_count,
                SUM(CASE WHEN invoice_issued = 1 THEN 1 ELSE 0 END) AS issued_count,
                SUM(CASE WHEN payment_collected = 1 THEN 1 ELSE 0 END) AS collected_count,
                SUM(CASE WHEN invoice_issued = 0 AND COALESCE(amount, 0) > 0 THEN 1 ELSE 0 END) AS unissued_count,
                SUM(CASE WHEN payment_collected = 0 AND COALESCE(amount, 0) > 0 THEN 1 ELSE 0 END) AS uncollected_count,
                SUM(COALESCE(amount, 0)) AS total_milestone_amount,
                SUM(CASE WHEN invoice_issued = 1 THEN COALESCE(invoice_amount, amount, 0) ELSE 0 END) AS total_issued_amount,
                SUM(CASE WHEN payment_collected = 1 THEN COALESCE(collected_amount, amount, 0) ELSE 0 END) AS total_collected_amount
         FROM contract_payment_milestones
         GROUP BY contract_id
       ) ms ON ms.contract_id = c.contract_id
       ${whereSql}
       ORDER BY ${orderBy}
       LIMIT ${addParam(limit)} OFFSET ${addParam(offset)}`,
      params
    )
  );

  return {
    items: listRows.map(mapContractListItem),
    total: toNumber(countRows[0]?.total),
  };
}

export async function listContractsForTree(
  year: string | null,
  deptId?: string | null,
  contractIds?: string[] | null
): Promise<ContractTreePayload> {
  const db = await getDb();
  const yearsRows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT SUBSTRING(COALESCE(NULLIF(contract_date, ''), started_at, created_at), 1, 4) AS year
       FROM contracts
       WHERE deleted_at IS NULL
         AND COALESCE(NULLIF(contract_date, ''), started_at, created_at) IS NOT NULL`
    )
  );
  const availableYears = yearsRows
    .map((row) => String(row.year ?? ""))
    .filter((y) => /^\d{4}$/.test(y))
    .sort((a, b) => Number(b) - Number(a));

  const params: unknown[] = [];
  const where: string[] = ["c.deleted_at IS NULL"];
  if (year && /^\d{4}$/.test(year)) {
    params.push(year);
    where.push(`COALESCE(NULLIF(c.contract_date, ''), c.started_at, c.created_at) LIKE $${params.length} || '%'`);
  }
  // 업무보고 화면용 — 수행 부서(owning_dept_id)로 한정.
  if (deptId) {
    params.push(deptId);
    where.push(`c.owning_dept_id = $${params.length}`);
  }
  // RBAC 가시 계약 범위(null = 전사).
  if (contractIds !== undefined && contractIds !== null) {
    params.push(contractIds);
    where.push(`c.contract_id = ANY($${params.length})`);
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id,
              c.contract_title,
              cp.company_name AS counterparty_name,
              c.service_type,
              c.service_subtype,
              c.industry_category,
              f.industry_name AS facility_industry_name,
              f.industry_code AS facility_industry_code,
              c.contract_status,
              COALESCE(c.current_amount, c.contract_amount) AS current_amount,
              c.contract_date,
              COALESCE(ms.total_milestone_amount, 0) AS total_milestone_amount,
              COALESCE(ms.total_collected_amount, 0) AS total_collected_amount,
              (NULLIF(c.permit_issued_at, '') IS NOT NULL OR lm.invoice_done = 1) AS is_completed
       FROM contracts c
       JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
       LEFT JOIN facilities f ON f.facility_id = c.facility_id
       LEFT JOIN (
         SELECT contract_id,
                SUM(COALESCE(amount, 0)) AS total_milestone_amount,
                SUM(CASE WHEN payment_collected = 1 THEN COALESCE(collected_amount, amount, 0) ELSE 0 END) AS total_collected_amount
         FROM contract_payment_milestones
         GROUP BY contract_id
       ) ms ON ms.contract_id = c.contract_id
       LEFT JOIN (
         -- 완료일(발행일) = 최종 대금지급단위(stage_order 최대)의 발행 완료 여부(completions-status 와 동일)
         SELECT DISTINCT ON (contract_id) contract_id,
                CASE WHEN COALESCE(invoice_issued, 0) = 1 THEN 1 ELSE 0 END AS invoice_done
         FROM contract_payment_milestones
         ORDER BY contract_id, stage_order DESC
       ) lm ON lm.contract_id = c.contract_id
       ${whereSql}
       ORDER BY
         COALESCE(NULLIF(c.contract_date, ''), c.started_at, c.created_at) ASC NULLS LAST,
         c.contract_title ASC`,
      params
    )
  );

  const groupMap = new Map<string, ContractTreeContractNode[]>();
  for (const row of rows) {
    const serviceType = row.service_type != null && String(row.service_type).trim().length > 0
      ? String(row.service_type)
      : "기타";
    // 용역 금액은 대금지급조건(milestone) 금액 합계를 기준으로 하고,
    // 단계가 하나도 없을 때만 계약에 기록된 금액으로 폴백한다.
    const milestoneAmount = toNumber(row.total_milestone_amount);
    const baseAmount = milestoneAmount > 0 ? milestoneAmount : toNumber(row.current_amount);
    const collected = toNumber(row.total_collected_amount);
    const node: ContractTreeContractNode = {
      contractId: String(row.contract_id ?? ""),
      contractTitle: String(row.contract_title ?? ""),
      counterpartyName: String(row.counterparty_name ?? ""),
      serviceSubtype: row.service_subtype != null ? String(row.service_subtype) : null,
      industryCategory: row.industry_category != null ? String(row.industry_category) : null,
      facilityIndustryName: row.facility_industry_name != null ? String(row.facility_industry_name) : null,
      facilityIndustryCode: row.facility_industry_code != null ? String(row.facility_industry_code) : null,
      currentAmount: baseAmount > 0 ? baseAmount : toNumberOrNull(row.current_amount),
      contractDate: row.contract_date != null ? String(row.contract_date) : null,
      contractStatus: String(row.contract_status ?? "active"),
      isFullyCollected: baseAmount > 0 && collected >= baseAmount,
      isCompleted: row.is_completed === true || row.is_completed === 1,
    };
    if (!groupMap.has(serviceType)) groupMap.set(serviceType, []);
    groupMap.get(serviceType)!.push(node);
  }

  const groups: ContractTreeServiceGroup[] = Array.from(groupMap.entries())
    .map(([serviceType, contracts]) => ({ serviceType, contracts }))
    .sort((a, b) => {
      const pa = serviceTypePriority(a.serviceType);
      const pb = serviceTypePriority(b.serviceType);
      if (pa !== pb) return pa - pb;
      return a.serviceType.localeCompare(b.serviceType, "ko");
    });

  return {
    year: year && /^\d{4}$/.test(year) ? year : null,
    totalCount: rows.length,
    availableYears,
    groups,
  };
}

/**
 * Tree payload of all contracts that target a single facility, used by the
 * facility detail "수주" modal. A contract is considered to target the facility
 * when its primary facility_id matches or when it is linked through
 * contract_facilities (relation_type = 'integrated_permit_target').
 * No year filtering is applied here.
 */
export async function listContractsForTreeByFacility(facilityId: string): Promise<ContractTreePayload> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id,
              c.contract_title,
              cp.company_name AS counterparty_name,
              c.service_type,
              c.service_subtype,
              c.industry_category,
              f.industry_name AS facility_industry_name,
              f.industry_code AS facility_industry_code,
              c.contract_status,
              COALESCE(c.current_amount, c.contract_amount) AS current_amount,
              c.contract_date,
              COALESCE(ms.total_milestone_amount, 0) AS total_milestone_amount,
              COALESCE(ms.total_collected_amount, 0) AS total_collected_amount
       FROM contracts c
       JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
       LEFT JOIN facilities f ON f.facility_id = c.facility_id
       LEFT JOIN (
         SELECT contract_id,
                SUM(COALESCE(amount, 0)) AS total_milestone_amount,
                SUM(CASE WHEN payment_collected = 1 THEN COALESCE(collected_amount, amount, 0) ELSE 0 END) AS total_collected_amount
         FROM contract_payment_milestones
         GROUP BY contract_id
       ) ms ON ms.contract_id = c.contract_id
       WHERE c.deleted_at IS NULL
         AND (
           c.facility_id = $1
           OR EXISTS (
             SELECT 1 FROM contract_facilities cf
             WHERE cf.contract_id = c.contract_id
               AND cf.facility_id = $1
               AND cf.relation_type = 'integrated_permit_target'
           )
         )
       ORDER BY
         COALESCE(NULLIF(c.contract_date, ''), c.started_at, c.created_at) ASC NULLS LAST,
         c.contract_title ASC`,
      [facilityId]
    )
  );

  const groupMap = new Map<string, ContractTreeContractNode[]>();
  for (const row of rows) {
    const serviceType = row.service_type != null && String(row.service_type).trim().length > 0
      ? String(row.service_type)
      : "기타";
    const milestoneAmount = toNumber(row.total_milestone_amount);
    const baseAmount = milestoneAmount > 0 ? milestoneAmount : toNumber(row.current_amount);
    const collected = toNumber(row.total_collected_amount);
    const node: ContractTreeContractNode = {
      contractId: String(row.contract_id ?? ""),
      contractTitle: String(row.contract_title ?? ""),
      counterpartyName: String(row.counterparty_name ?? ""),
      serviceSubtype: row.service_subtype != null ? String(row.service_subtype) : null,
      industryCategory: row.industry_category != null ? String(row.industry_category) : null,
      facilityIndustryName: row.facility_industry_name != null ? String(row.facility_industry_name) : null,
      facilityIndustryCode: row.facility_industry_code != null ? String(row.facility_industry_code) : null,
      currentAmount: baseAmount > 0 ? baseAmount : toNumberOrNull(row.current_amount),
      contractDate: row.contract_date != null ? String(row.contract_date) : null,
      contractStatus: String(row.contract_status ?? "active"),
      isFullyCollected: baseAmount > 0 && collected >= baseAmount,
      // 이 뷰(사업장 수주 모달)는 하단 집계를 쓰지 않아 완료 판정 서브쿼리를 생략한다.
      isCompleted: false,
    };
    if (!groupMap.has(serviceType)) groupMap.set(serviceType, []);
    groupMap.get(serviceType)!.push(node);
  }

  const groups: ContractTreeServiceGroup[] = Array.from(groupMap.entries())
    .map(([serviceType, contracts]) => ({ serviceType, contracts }))
    .sort((a, b) => {
      const pa = serviceTypePriority(a.serviceType);
      const pb = serviceTypePriority(b.serviceType);
      if (pa !== pb) return pa - pb;
      return a.serviceType.localeCompare(b.serviceType, "ko");
    });

  return {
    year: null,
    totalCount: rows.length,
    availableYears: [],
    groups,
  };
}

export async function getContractDetail(contractId: string) {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.*,
              cp.company_name AS counterparty_name,
              cp.business_registration_no AS counterparty_business_registration_no,
              cp.corporate_registration_no AS counterparty_corporate_registration_no,
              cp.representative_name AS counterparty_representative_name,
              f.company_name AS facility_name,
              f.site_address AS facility_address,
              f.site_business_registration_no AS facility_site_business_registration_no,
              f.corporate_registration_no AS facility_corporate_registration_no,
              f.integrated_permit_target AS facility_integrated_permit_target,
              od.dept_name AS owning_dept_name
       FROM contracts c
       JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
       LEFT JOIN facilities f ON f.facility_id = c.facility_id
       LEFT JOIN departments od ON od.dept_id = c.owning_dept_id
       WHERE c.contract_id = $1
         AND c.deleted_at IS NULL`,
      [contractId]
    )
  );
  const contract = rows[0];
  if (!contract) return null;

  const milestones = rowsToObjects(
    await db.exec(
      `SELECT *
       FROM contract_payment_milestones
       WHERE contract_id = $1
       ORDER BY stage_order ASC`,
      [contractId]
    )
  );
  const invoices = rowsToObjects(
    await db.exec(
      `SELECT i.*, d.public_path, d.display_name AS document_display_name
       FROM contract_invoices i
       LEFT JOIN contract_documents d ON d.document_id = i.document_id
       WHERE i.contract_id = $1
       ORDER BY i.issue_date DESC, i.created_at DESC`,
      [contractId]
    )
  );
  const documents = rowsToObjects(
    await db.exec(
      `SELECT document_id, contract_id, document_type, display_name, original_filename,
              public_path, storage_provider, storage_key, byte_size, sha256, source,
              created_at, updated_at
       FROM contract_documents
       WHERE contract_id = $1
         AND document_type IN ('contract', 'amendment')
       ORDER BY created_at DESC`,
      [contractId]
    )
  );
  const changes = rowsToObjects(
    await db.exec(
      `SELECT *
       FROM contract_change_events
       WHERE contract_id = $1
       ORDER BY COALESCE(changed_at, created_at) DESC`,
      [contractId]
    )
  );
  const outsourcing = rowsToObjects(
    await db.exec(
      `SELECT o.*, cp.company_name AS counterparty_facility_name, d.public_path AS document_public_path,
              d.display_name AS document_display_name
       FROM contract_outsourcing o
       LEFT JOIN facilities cp ON cp.facility_id = o.counterparty_facility_id
       LEFT JOIN contract_documents d ON d.document_id = o.document_id
       WHERE o.contract_id = $1
       ORDER BY COALESCE(o.contract_date, o.created_at) DESC`,
      [contractId]
    )
  );
  const targetFacilities = rowsToObjects(
    await db.exec(
      `SELECT cf.facility_id, cf.relation_type, cf.stage_label, cf.memo,
              f.company_name, f.business_registration_no, f.site_business_registration_no,
              f.site_address, f.region_sido, f.region_sigungu, f.industry_code,
              f.industry_name, f.integrated_permit_target
       FROM contract_facilities cf
       JOIN facilities f ON f.facility_id = cf.facility_id
       WHERE cf.contract_id = $1
         AND cf.relation_type = 'integrated_permit_target'
       ORDER BY f.company_name ASC`,
      [contractId]
    )
  );
  if (targetFacilities.length === 0 && contract.facility_id) {
    targetFacilities.push({
      facility_id: contract.facility_id,
      relation_type: "integrated_permit_target",
      company_name: contract.facility_name,
      business_registration_no: contract.facility_site_business_registration_no,
      site_business_registration_no: contract.facility_site_business_registration_no,
      site_address: contract.facility_address,
      integrated_permit_target: contract.facility_integrated_permit_target,
    });
  }

  return { contract, milestones, invoices, documents, changes, outsourcing, targetFacilities };
}

// ---------------------------------------------------------------------------
// Contract Dashboard V2 — 엑셀 계약현황 대쉬보드 이전용 집계 계층
// ---------------------------------------------------------------------------

export const DASHBOARD_SERVICE_CATEGORIES = [
  "통합환경허가",
  "장외·화관법",
  "HAPs 용역",
  "ESG·탄소중립",
  "기타 용역",
] as const;

export type DashboardServiceCategory = (typeof DASHBOARD_SERVICE_CATEGORIES)[number];

export interface ContractDashboardV2Filter {
  /** 기준연도 (YYYY). 생략 시 데이터가 존재하는 최신 연도. */
  year?: string;
  /** 기준 용역분류 (단일 선택). 생략/무효 시 통합환경허가. */
  category?: string;
  /** RBAC 가시 계약 범위. null/undefined = 전사(필터 없음). */
  contractIds?: string[] | null;
}

export interface DashboardMonthlyBlock {
  total: number;
  /** index 0 = 1월 … index 11 = 12월 */
  monthly: number[];
  byCategory: Array<{
    category: string;
    current: number;
    d1: number;
    d2: number;
    /** 기준연도 총액 대비 점유율 (%) */
    share: number;
  }>;
}

export interface ContractDashboardV2 {
  year: string;
  availableYears: string[];
  /** 조건별 필터에서 선택된 기준 용역분류 (단일) */
  category: string;
  sales: DashboardMonthlyBlock;
  orders: DashboardMonthlyBlock;
  serviceDetail: {
    totalCount: number;
    rows: Array<{ label: string; count: number; amount: number }>;
  };
  collection: {
    /** 기준연도 계약(전체 분류)의 수금 완료액 합 */
    collectedTotal: number;
    /** 기준연도 계약(선택 분류)의 수금 완료액 합 */
    collectedCategory: number;
    prevCollectedTotal: number;
    prevCollectedCategory: number;
    /** collectedTotal / 기준연도 수주총액 (%) */
    rateTotal: number;
    /** collectedCategory / 기준연도 선택 분류 수주액 (%) */
    rateCategory: number;
  };
  regions: Array<{ sido: string; amount: number }>;
  uncollected: Array<{
    contractId: string;
    contractTitle: string;
    counterpartyName: string;
    /** 발행/수금 모달용 청구·수금 단계 ID */
    milestoneId: string;
    category: string;
    stageLabel: string;
    paymentTerms: string | null;
    amount: number;
    /** 부분입금 차감 후 미수 잔액 */
    outstandingAmount: number;
    invoiceIssuedAt: string | null;
    agingMonths: number;
  }>;
  recentCollections: Array<{
    contractId: string;
    contractTitle: string;
    counterpartyName: string;
    /** 발행/수금 모달용 청구·수금 단계 ID */
    milestoneId: string;
    category: string;
    stageLabel: string;
    paymentTerms: string | null;
    invoiceIssuedAt: string | null;
    invoiceAmount: number;
    amount: number;
    collectedAt: string;
    daysAgo: number;
  }>;
}

/** 계약 기준일: 계약일 → 착수일 → 생성일 순 폴백 (기존 byYear 집계와 동일 규칙) */
const CONTRACT_DATE_SQL = "COALESCE(NULLIF(c.contract_date, ''), c.started_at, c.created_at)";
/** 계약 금액: 변경 후 금액 → 원 계약금액 폴백 */
const CONTRACT_AMOUNT_SQL = "COALESCE(c.current_amount, c.contract_amount, 0)";

/** service_type 원문을 대쉬보드 5대 분류로 정규화하는 SQL CASE 식 (serviceTypePriority 와 동일 규칙) */
export function categoryCaseSql(col: string): string {
  return `CASE
    WHEN UPPER(COALESCE(${col}, '')) LIKE '%HAPS%' THEN 'HAPs 용역'
    WHEN COALESCE(${col}, '') LIKE '%통합%' THEN '통합환경허가'
    WHEN COALESCE(${col}, '') LIKE '%장외%' OR COALESCE(${col}, '') LIKE '%화관%' OR COALESCE(${col}, '') LIKE '%유해화학%' THEN '장외·화관법'
    WHEN UPPER(COALESCE(${col}, '')) LIKE '%ESG%' OR COALESCE(${col}, '') LIKE '%탄소%' THEN 'ESG·탄소중립'
    ELSE '기타 용역'
  END`;
}

function sanitizeCategory(input: string | undefined): string {
  const allowed = new Set<string>(DASHBOARD_SERVICE_CATEGORIES);
  return input && allowed.has(input) ? input : DASHBOARD_SERVICE_CATEGORIES[0];
}

export async function getContractDashboardV2(
  filter: ContractDashboardV2Filter = {}
): Promise<ContractDashboardV2> {
  const db = await getDb();
  const catCase = categoryCaseSql("c.service_type");
  // RBAC 가시 계약 범위(null = 전사). 각 contracts 쿼리에 동일 조건을 마지막 파라미터로 합류.
  const contractIds = filter.contractIds;
  const scopeSql = (n: number) => (contractIds ? ` AND c.contract_id = ANY($${n})` : "");
  const scopeArg: unknown[] = contractIds ? [contractIds] : [];

  const yearRows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) AS year
       FROM contracts c
       WHERE c.deleted_at IS NULL${scopeSql(1)}
       ORDER BY year DESC
       LIMIT 14`,
      scopeArg
    )
  );
  const availableYears = yearRows
    .map((r) => String(r.year ?? ""))
    .filter((y) => /^\d{4}$/.test(y));

  const year =
    filter.year && /^\d{4}$/.test(filter.year)
      ? filter.year
      : availableYears[0] ?? String(new Date().getFullYear());
  const d1Year = String(Number(year) - 1);
  const d2Year = String(Number(year) - 2);
  const category = sanitizeCategory(filter.category);

  // ---------------- 수주 (계약일 기준) — 분류 필터와 무관하게 전체 집계 ----------------
  const ordersMonthlyRows = rowsToObjects(
    await db.exec(
      `SELECT CAST(SUBSTRING(${CONTRACT_DATE_SQL}, 6, 2) AS int) AS month,
              SUM(${CONTRACT_AMOUNT_SQL}) AS amount
       FROM contracts c
       WHERE c.deleted_at IS NULL
         AND SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) = $1${scopeSql(2)}
       GROUP BY 1
       ORDER BY 1`,
      [year, ...scopeArg]
    )
  );

  const ordersByCategoryRows = rowsToObjects(
    await db.exec(
      `SELECT ${catCase} AS category,
              SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) AS year,
              SUM(${CONTRACT_AMOUNT_SQL}) AS amount
       FROM contracts c
       WHERE c.deleted_at IS NULL
         AND SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) IN ($1, $2, $3)${scopeSql(4)}
       GROUP BY 1, 2`,
      [year, d1Year, d2Year, ...scopeArg]
    )
  );

  // ---------------- 매출 (계산서 발행일 기준) — 분류 필터와 무관하게 전체 집계 ----------------
  const salesMonthlyRows = rowsToObjects(
    await db.exec(
      `SELECT CAST(SUBSTRING(m.invoice_issued_at, 6, 2) AS int) AS month,
              SUM(COALESCE(m.invoice_amount, m.amount, 0)) AS amount
       FROM contract_payment_milestones m
       JOIN contracts c ON c.contract_id = m.contract_id
       WHERE c.deleted_at IS NULL
         AND m.invoice_issued = 1
         AND m.invoice_issued_at IS NOT NULL
         AND SUBSTRING(m.invoice_issued_at, 1, 4) = $1${scopeSql(2)}
       GROUP BY 1
       ORDER BY 1`,
      [year, ...scopeArg]
    )
  );

  const salesByCategoryRows = rowsToObjects(
    await db.exec(
      `SELECT ${catCase} AS category,
              SUBSTRING(m.invoice_issued_at, 1, 4) AS year,
              SUM(COALESCE(m.invoice_amount, m.amount, 0)) AS amount
       FROM contract_payment_milestones m
       JOIN contracts c ON c.contract_id = m.contract_id
       WHERE c.deleted_at IS NULL
         AND m.invoice_issued = 1
         AND m.invoice_issued_at IS NOT NULL
         AND SUBSTRING(m.invoice_issued_at, 1, 4) IN ($1, $2, $3)${scopeSql(4)}
       GROUP BY 1, 2`,
      [year, d1Year, d2Year, ...scopeArg]
    )
  );

  // ---------------- 용역별 수주 상세 (선택 분류 내 세부유형) ----------------
  const serviceDetailRows = rowsToObjects(
    await db.exec(
      `SELECT COALESCE(NULLIF(c.service_subtype, ''), COALESCE(c.service_type, '기타')) AS label,
              COUNT(*) AS count,
              SUM(${CONTRACT_AMOUNT_SQL}) AS amount
       FROM contracts c
       WHERE c.deleted_at IS NULL
         AND SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) = $1
         AND ${catCase} = $2${scopeSql(3)}
       GROUP BY 1
       ORDER BY amount DESC, count DESC`,
      [year, category, ...scopeArg]
    )
  );

  // ---------------- 수금 (기준연도/전년도 계약 대상 수금 완료액 — 엑셀 수금율 산식) ----------------
  const collectionRows = rowsToObjects(
    await db.exec(
      `SELECT SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) AS year,
              ${catCase} AS category,
              SUM(COALESCE(m.collected_amount, m.amount, 0)) AS amount
       FROM contract_payment_milestones m
       JOIN contracts c ON c.contract_id = m.contract_id
       WHERE c.deleted_at IS NULL
         AND m.payment_collected = 1
         AND SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) IN ($1, $2)${scopeSql(3)}
       GROUP BY 1, 2`,
      [year, d1Year, ...scopeArg]
    )
  );

  // ---------------- 지역별 수주 (발주처 사업장 시도 기준 / 선택 분류) ----------------
  const regionRows = rowsToObjects(
    await db.exec(
      `SELECT COALESCE(NULLIF(f.region_sido, ''), '미상') AS sido,
              SUM(${CONTRACT_AMOUNT_SQL}) AS amount
       FROM contracts c
       JOIN facilities f ON f.facility_id = c.counterparty_facility_id
       WHERE c.deleted_at IS NULL
         AND SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) = $1
         AND ${catCase} = $2${scopeSql(3)}
       GROUP BY 1
       ORDER BY amount DESC`,
      [year, category, ...scopeArg]
    )
  );

  // ---------------- 미수금 (발행 완료 + 수금 미완료 / 선택 분류 + 기준연도 발행분) ----------------
  const uncollectedRows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id,
              c.contract_title,
              f.company_name AS counterparty_name,
              m.milestone_id,
              m.stage_label,
              m.payment_terms,
              COALESCE(m.invoice_amount, m.amount, 0) AS amount,
              COALESCE(m.collected_amount, 0) AS partial_collected,
              m.invoice_issued_at
       FROM contract_payment_milestones m
       JOIN contracts c ON c.contract_id = m.contract_id
       JOIN facilities f ON f.facility_id = c.counterparty_facility_id
       WHERE c.deleted_at IS NULL
         AND m.invoice_issued = 1
         AND m.payment_collected = 0
         AND COALESCE(m.invoice_amount, m.amount, 0) > 0
         AND ${catCase} = $1
         AND SUBSTRING(m.invoice_issued_at, 1, 4) = $2${scopeSql(3)}
       ORDER BY m.invoice_issued_at DESC NULLS LAST
       LIMIT 50`,
      [category, year, ...scopeArg]
    )
  );

  // ---------------- 수금내역 (최근 2개월 수금 완료 / 선택 분류) ----------------
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 2);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const recentCollectionRows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id,
              c.contract_title,
              COALESCE(f.company_name, '') AS counterparty_name,
              ${catCase} AS category,
              m.milestone_id,
              m.stage_label,
              m.payment_terms,
              m.invoice_issued_at,
              COALESCE(m.invoice_amount, m.amount, 0) AS invoice_amount,
              COALESCE(m.collected_amount, m.amount, 0) AS amount,
              m.payment_collected_at
       FROM contract_payment_milestones m
       JOIN contracts c ON c.contract_id = m.contract_id
       LEFT JOIN facilities f ON f.facility_id = c.counterparty_facility_id
       WHERE c.deleted_at IS NULL
         AND m.payment_collected = 1
         AND m.payment_collected_at IS NOT NULL
         AND SUBSTRING(m.payment_collected_at, 1, 10) >= $1
         AND ${catCase} = $2${scopeSql(3)}
       ORDER BY m.payment_collected_at DESC
       LIMIT 50`,
      [cutoffStr, category, ...scopeArg]
    )
  );

  // ---------------- 후처리 ----------------
  const buildMonthly = (rows: Array<Record<string, unknown>>): number[] => {
    const arr = new Array<number>(12).fill(0);
    for (const r of rows) {
      const m = toNumber(r.month);
      if (m >= 1 && m <= 12) arr[m - 1] += toNumber(r.amount);
    }
    return arr;
  };

  const buildBlock = (
    monthlyRows: Array<Record<string, unknown>>,
    byCategoryRows: Array<Record<string, unknown>>
  ): DashboardMonthlyBlock => {
    const monthly = buildMonthly(monthlyRows);
    const map = new Map<string, { current: number; d1: number; d2: number }>();
    for (const cat of DASHBOARD_SERVICE_CATEGORIES) map.set(cat, { current: 0, d1: 0, d2: 0 });
    for (const r of byCategoryRows) {
      const cat = String(r.category ?? "");
      const entry = map.get(cat);
      if (!entry) continue;
      const y = String(r.year ?? "");
      const amount = toNumber(r.amount);
      if (y === year) entry.current += amount;
      else if (y === d1Year) entry.d1 += amount;
      else if (y === d2Year) entry.d2 += amount;
    }
    const total = [...map.values()].reduce((s, v) => s + v.current, 0);
    const byCategory = DASHBOARD_SERVICE_CATEGORIES.filter((c) => map.has(c)).map((cat) => {
      const v = map.get(cat)!;
      return {
        category: cat,
        current: v.current,
        d1: v.d1,
        d2: v.d2,
        share: total > 0 ? Math.round((v.current / total) * 1000) / 10 : 0,
      };
    });
    return { total, monthly, byCategory };
  };

  const orders = buildBlock(ordersMonthlyRows, ordersByCategoryRows);
  const sales = buildBlock(salesMonthlyRows, salesByCategoryRows);

  let collectedTotal = 0;
  let collectedCategory = 0;
  let prevCollectedTotal = 0;
  let prevCollectedCategory = 0;
  for (const r of collectionRows) {
    const y = String(r.year ?? "");
    const cat = String(r.category ?? "");
    const amount = toNumber(r.amount);
    if (y === year) {
      collectedTotal += amount;
      if (cat === category) collectedCategory += amount;
    } else if (y === d1Year) {
      prevCollectedTotal += amount;
      if (cat === category) prevCollectedCategory += amount;
    }
  }
  const categoryOrders = orders.byCategory.find((b) => b.category === category)?.current ?? 0;
  const rateTotal = orders.total > 0 ? Math.round((collectedTotal / orders.total) * 1000) / 10 : 0;
  const rateCategory = categoryOrders > 0 ? Math.round((collectedCategory / categoryOrders) * 1000) / 10 : 0;

  const now = Date.now();
  const uncollected = uncollectedRows.map((r) => {
    const issuedAt = r.invoice_issued_at != null ? String(r.invoice_issued_at).slice(0, 10) : null;
    let agingMonths = 0;
    if (issuedAt) {
      const t = Date.parse(issuedAt);
      if (Number.isFinite(t)) agingMonths = Math.max(0, Math.floor((now - t) / (1000 * 60 * 60 * 24 * 30)));
    }
    const amount = toNumber(r.amount);
    return {
      contractId: String(r.contract_id ?? ""),
      contractTitle: String(r.contract_title ?? ""),
      counterpartyName: String(r.counterparty_name ?? ""),
      milestoneId: String(r.milestone_id ?? ""),
      category,
      stageLabel: String(r.stage_label ?? ""),
      paymentTerms: r.payment_terms != null ? String(r.payment_terms) : null,
      amount,
      outstandingAmount: Math.max(0, amount - toNumber(r.partial_collected)),
      invoiceIssuedAt: issuedAt,
      agingMonths,
    };
  });

  const recentCollections = recentCollectionRows.map((r) => {
    const collectedAt = String(r.payment_collected_at ?? "").slice(0, 10);
    const t = Date.parse(collectedAt);
    const daysAgo = Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / (1000 * 60 * 60 * 24))) : 0;
    return {
      contractId: String(r.contract_id ?? ""),
      contractTitle: String(r.contract_title ?? ""),
      counterpartyName: String(r.counterparty_name ?? ""),
      milestoneId: String(r.milestone_id ?? ""),
      category: String(r.category ?? ""),
      stageLabel: String(r.stage_label ?? ""),
      paymentTerms: r.payment_terms != null ? String(r.payment_terms) : null,
      invoiceIssuedAt: r.invoice_issued_at != null ? String(r.invoice_issued_at).slice(0, 10) : null,
      invoiceAmount: toNumber(r.invoice_amount),
      amount: toNumber(r.amount),
      collectedAt,
      daysAgo,
    };
  });

  return {
    year,
    availableYears,
    category,
    sales,
    orders,
    serviceDetail: {
      totalCount: serviceDetailRows.reduce((s, r) => s + toNumber(r.count), 0),
      rows: serviceDetailRows.map((r) => ({
        label: String(r.label ?? "기타"),
        count: toNumber(r.count),
        amount: toNumber(r.amount),
      })),
    },
    collection: {
      collectedTotal,
      collectedCategory,
      prevCollectedTotal,
      prevCollectedCategory,
      rateTotal,
      rateCategory,
    },
    regions: regionRows.map((r) => ({ sido: String(r.sido ?? "미상"), amount: toNumber(r.amount) })),
    uncollected,
    recentCollections,
  };
}

// ---------------------------------------------------------------------------
// Contract Dashboard V2 — 발주처 상세
// ---------------------------------------------------------------------------

export interface CounterpartySearchItem {
  facilityId: string;
  name: string;
  contractCount: number;
}

export interface CounterpartyDetail {
  facilityId: string;
  name: string;
  yearly: Array<{ year: string; orders: number; sales: number }>;
  current: {
    year: string;
    orderAmount: number;
    salesAmount: number;
    orderCount: number;
    topCategory: string | null;
  };
  contracts: Array<{
    contractId: string;
    contractDate: string | null;
    contractTitle: string;
    amount: number;
  }>;
}

export async function searchDashboardCounterparties(q: string): Promise<CounterpartySearchItem[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT f.facility_id, f.company_name, COUNT(*) AS contract_count
       FROM contracts c
       JOIN facilities f ON f.facility_id = c.counterparty_facility_id
       WHERE c.deleted_at IS NULL
         AND f.company_name ILIKE '%' || $1 || '%'
       GROUP BY f.facility_id, f.company_name
       ORDER BY contract_count DESC, f.company_name ASC
       LIMIT 12`,
      [q]
    )
  );
  return rows.map((r) => ({
    facilityId: String(r.facility_id ?? ""),
    name: String(r.company_name ?? ""),
    contractCount: toNumber(r.contract_count),
  }));
}

export async function getDashboardCounterpartyDetail(
  facilityId: string,
  year: string
): Promise<CounterpartyDetail | null> {
  const db = await getDb();
  const catCase = categoryCaseSql("c.service_type");

  const nameRows = rowsToObjects(
    await db.exec(`SELECT company_name FROM facilities WHERE facility_id = $1`, [facilityId])
  );
  if (nameRows.length === 0) return null;
  const name = String(nameRows[0].company_name ?? "");

  const fromYear = String(Number(year) - 5);
  const orderYearRows = rowsToObjects(
    await db.exec(
      `SELECT SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) AS year,
              SUM(${CONTRACT_AMOUNT_SQL}) AS amount
       FROM contracts c
       WHERE c.deleted_at IS NULL
         AND c.counterparty_facility_id = $1
         AND SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) BETWEEN $2 AND $3
       GROUP BY 1`,
      [facilityId, fromYear, year]
    )
  );
  const salesYearRows = rowsToObjects(
    await db.exec(
      `SELECT SUBSTRING(m.invoice_issued_at, 1, 4) AS year,
              SUM(COALESCE(m.invoice_amount, m.amount, 0)) AS amount
       FROM contract_payment_milestones m
       JOIN contracts c ON c.contract_id = m.contract_id
       WHERE c.deleted_at IS NULL
         AND c.counterparty_facility_id = $1
         AND m.invoice_issued = 1
         AND m.invoice_issued_at IS NOT NULL
         AND SUBSTRING(m.invoice_issued_at, 1, 4) BETWEEN $2 AND $3
       GROUP BY 1`,
      [facilityId, fromYear, year]
    )
  );

  const ordersByYear = new Map(orderYearRows.map((r) => [String(r.year ?? ""), toNumber(r.amount)]));
  const salesByYear = new Map(salesYearRows.map((r) => [String(r.year ?? ""), toNumber(r.amount)]));
  const yearly: CounterpartyDetail["yearly"] = [];
  for (let y = Number(fromYear); y <= Number(year); y += 1) {
    const key = String(y);
    yearly.push({ year: key, orders: ordersByYear.get(key) ?? 0, sales: salesByYear.get(key) ?? 0 });
  }

  const statRows = rowsToObjects(
    await db.exec(
      `SELECT COUNT(*) AS order_count,
              SUM(${CONTRACT_AMOUNT_SQL}) AS order_amount
       FROM contracts c
       WHERE c.deleted_at IS NULL
         AND c.counterparty_facility_id = $1
         AND SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) = $2`,
      [facilityId, year]
    )
  );
  const topCategoryRows = rowsToObjects(
    await db.exec(
      `SELECT ${catCase} AS category,
              SUM(${CONTRACT_AMOUNT_SQL}) AS amount
       FROM contracts c
       WHERE c.deleted_at IS NULL
         AND c.counterparty_facility_id = $1
         AND SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) = $2
       GROUP BY 1
       ORDER BY amount DESC
       LIMIT 1`,
      [facilityId, year]
    )
  );
  const contractRows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id,
              SUBSTRING(${CONTRACT_DATE_SQL}, 1, 10) AS contract_date,
              c.contract_title,
              ${CONTRACT_AMOUNT_SQL} AS amount
       FROM contracts c
       WHERE c.deleted_at IS NULL
         AND c.counterparty_facility_id = $1
         AND SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) = $2
       ORDER BY contract_date DESC
       LIMIT 20`,
      [facilityId, year]
    )
  );

  return {
    facilityId,
    name,
    yearly,
    current: {
      year,
      orderAmount: toNumber(statRows[0]?.order_amount),
      salesAmount: salesByYear.get(year) ?? 0,
      orderCount: toNumber(statRows[0]?.order_count),
      topCategory: topCategoryRows.length > 0 ? String(topCategoryRows[0].category ?? "") : null,
    },
    contracts: contractRows.map((r) => ({
      contractId: String(r.contract_id ?? ""),
      contractDate: r.contract_date != null ? String(r.contract_date) : null,
      contractTitle: String(r.contract_title ?? ""),
      amount: toNumber(r.amount),
    })),
  };
}

// ---------------------------------------------------------------------------
// 수주/수금/발행 현황 — 수주 현황 (연도 기준 계약 원본 리스트)
// 지역/용역/업종 필터링은 클라이언트 및 export 라우트에서 공통 헬퍼로 수행한다.
// ---------------------------------------------------------------------------

export interface ContractOrdersStatusRow {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
  /** 대쉬보드 5대 분류로 정규화된 용역분류 */
  category: string;
  /** 용역 세분류 원문 */
  serviceSubtype: string | null;
  /** YYYY-MM-DD */
  contractDate: string | null;
  amount: number;
  /** 발주처 사업장 시도 (원문) */
  sido: string | null;
  /** 계약에 기록된 업종 분류 */
  industryCategory: string | null;
  /** 대상 사업장 업종명 */
  facilityIndustryName: string | null;
  /** 대상 사업장 KSIC 업종코드 */
  facilityIndustryCode: string | null;
}

export interface ContractOrdersYearlyEntry {
  year: string;
  /** 해당 연도 전체 용역 수주액 */
  total: number;
  /** 대쉬보드 5대 분류별 수주액 */
  byCategory: Record<string, number>;
}

export interface ContractOrdersStatus {
  year: string;
  availableYears: string[];
  rows: ContractOrdersStatusRow[];
  /** 기준연도 포함 직전 10개년 수주액 추이 (연도 오름차순) */
  yearly: ContractOrdersYearlyEntry[];
}

export async function getContractOrdersStatus(
  yearFilter?: string,
  contractIds?: string[] | null
): Promise<ContractOrdersStatus> {
  const db = await getDb();
  const catCase = categoryCaseSql("c.service_type");
  const scope1 = contractIds ? " AND c.contract_id = ANY($1)" : "";

  const yearRows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) AS year
       FROM contracts c
       WHERE c.deleted_at IS NULL${scope1}
       ORDER BY year DESC
       LIMIT 14`,
      contractIds ? [contractIds] : []
    )
  );
  const availableYears = yearRows
    .map((r) => String(r.year ?? ""))
    .filter((y) => /^\d{4}$/.test(y));
  // "all" = 전체 기간 (연도 제한 없음)
  const isAllPeriod = yearFilter === "all";
  const latestYear = availableYears[0] ?? String(new Date().getFullYear());
  const year = isAllPeriod
    ? "all"
    : yearFilter && /^\d{4}$/.test(yearFilter)
      ? yearFilter
      : latestYear;

  const rowsParams: unknown[] = isAllPeriod ? [] : [year];
  const rowsScope = contractIds ? ` AND c.contract_id = ANY($${rowsParams.length + 1})` : "";
  if (contractIds) rowsParams.push(contractIds);
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id,
              c.contract_title,
              ${catCase} AS category,
              SUBSTRING(${CONTRACT_DATE_SQL}, 1, 10) AS contract_date,
              ${CONTRACT_AMOUNT_SQL} AS amount,
              cp.company_name AS counterparty_name,
              NULLIF(cp.region_sido, '') AS sido,
              c.service_subtype,
              c.industry_category,
              f.industry_name AS facility_industry_name,
              f.industry_code AS facility_industry_code
       FROM contracts c
       LEFT JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
       LEFT JOIN facilities f ON f.facility_id = c.facility_id
       WHERE c.deleted_at IS NULL
         ${isAllPeriod ? "" : `AND SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) = $1`}${rowsScope}
       ORDER BY contract_date DESC NULLS LAST, c.contract_title ASC`,
      rowsParams
    )
  );

  // 기준연도(전체 기간이면 최신 연도) 포함 직전 10개년 — 연도/분류별 수주액 추이
  const anchorYear = isAllPeriod ? latestYear : year;
  const fromYear = String(Number(anchorYear) - 9);
  const yearlyRows = rowsToObjects(
    await db.exec(
      `SELECT SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) AS year,
              ${catCase} AS category,
              SUM(${CONTRACT_AMOUNT_SQL}) AS amount
       FROM contracts c
       WHERE c.deleted_at IS NULL
         AND SUBSTRING(${CONTRACT_DATE_SQL}, 1, 4) BETWEEN $1 AND $2${contractIds ? " AND c.contract_id = ANY($3)" : ""}
       GROUP BY 1, 2`,
      contractIds ? [fromYear, anchorYear, contractIds] : [fromYear, anchorYear]
    )
  );
  const yearlyMap = new Map<string, ContractOrdersYearlyEntry>();
  for (let y = Number(fromYear); y <= Number(anchorYear); y += 1) {
    yearlyMap.set(String(y), { year: String(y), total: 0, byCategory: {} });
  }
  for (const r of yearlyRows) {
    const entry = yearlyMap.get(String(r.year ?? ""));
    if (!entry) continue;
    const cat = String(r.category ?? "기타 용역");
    const amount = toNumber(r.amount);
    entry.total += amount;
    entry.byCategory[cat] = (entry.byCategory[cat] ?? 0) + amount;
  }

  return {
    year,
    availableYears,
    yearly: [...yearlyMap.values()],
    rows: rows.map((r) => ({
      contractId: String(r.contract_id ?? ""),
      contractTitle: String(r.contract_title ?? ""),
      counterpartyName: String(r.counterparty_name ?? ""),
      category: String(r.category ?? "기타 용역"),
      serviceSubtype: r.service_subtype != null ? String(r.service_subtype) : null,
      contractDate: r.contract_date != null ? String(r.contract_date) : null,
      amount: toNumber(r.amount),
      sido: r.sido != null ? String(r.sido) : null,
      industryCategory: r.industry_category != null ? String(r.industry_category) : null,
      facilityIndustryName:
        r.facility_industry_name != null ? String(r.facility_industry_name) : null,
      facilityIndustryCode:
        r.facility_industry_code != null ? String(r.facility_industry_code) : null,
    })),
  };
}

/**
 * Tree group ordering: 통합허가 → 장외&화관법 → HAPs → ESG탄소중립 → 기술진단 → (기타 카테고리들 가나다순) → 기타.
 * Returns a numeric priority where smaller comes first.
 */
function serviceTypePriority(serviceType: string): number {
  const t = serviceType.trim();
  if (t.includes("통합허가") || t.includes("통합환경")) return 1;
  if (t.includes("장외") || t.includes("화관법") || t.includes("유해화학")) return 2;
  if (t.includes("HAPs")) return 3;
  if (t.includes("ESG") || t.includes("탄소중립")) return 4;
  if (t.includes("기술진단") || t.includes("진단")) return 5;
  if (t === "기타") return 99;
  return 50;
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

function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  return toNumber(value);
}
