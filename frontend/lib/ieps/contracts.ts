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
}

export interface ContractListItem {
  contractId: string;
  contractTitle: string;
  counterpartyEntityId: string;
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

export interface ContractTreeContractNode {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
  serviceType: string | null;
  serviceSubtype: string | null;
  contractKind: string;
  contractAmount: number | null;
  currentAmount: number | null;
  contractDate: string | null;
  collectionRate: number;
  collectionProgressLabel: string | null;
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

export interface ContractDashboard {
  kpis: {
    totalContracts: number;
    totalAmount: number;
    issuedAmount: number;
    collectedAmount: number;
    unissuedAmount: number;
    uncollectedAmount: number;
    collectionRate: number;
  };
  byServiceType: Array<{ serviceType: string; count: number; amount: number }>;
  byYear: Array<{ year: string; count: number; amount: number }>;
  uncollected: Array<{
    contractId: string;
    contractTitle: string;
    counterpartyName: string;
    stageLabel: string;
    amount: number;
    invoiceIssuedAt: string | null;
  }>;
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
    counterpartyEntityId: String(row.counterparty_entity_id ?? ""),
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
  const where: string[] = [];
  const params: unknown[] = [];

  const addParam = (value: unknown) => {
    params.push(value);
    return "$" + params.length;
  };

  if (filter.q) {
    const p = addParam("%" + filter.q.trim() + "%");
    where.push(`(c.contract_title ILIKE ${p} OR e.entity_name ILIKE ${p} OR c.legacy_company_id ILIKE ${p})`);
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
       JOIN legal_entities e ON e.entity_id = c.counterparty_entity_id
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
              c.counterparty_entity_id,
              e.entity_name AS counterparty_name,
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
       JOIN legal_entities e ON e.entity_id = c.counterparty_entity_id
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

export async function listContractsForTree(year: string | null): Promise<ContractTreePayload> {
  const db = await getDb();
  const yearsRows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT SUBSTRING(COALESCE(NULLIF(contract_date, ''), started_at, created_at), 1, 4) AS year
       FROM contracts
       WHERE COALESCE(NULLIF(contract_date, ''), started_at, created_at) IS NOT NULL`
    )
  );
  const availableYears = yearsRows
    .map((row) => String(row.year ?? ""))
    .filter((y) => /^\d{4}$/.test(y))
    .sort((a, b) => Number(b) - Number(a));

  const params: unknown[] = [];
  const where: string[] = [];
  if (year && /^\d{4}$/.test(year)) {
    params.push(year);
    where.push(`COALESCE(NULLIF(c.contract_date, ''), c.started_at, c.created_at) LIKE $${params.length} || '%'`);
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id,
              c.contract_title,
              e.entity_name AS counterparty_name,
              c.service_type,
              c.service_subtype,
              c.contract_kind,
              c.contract_amount,
              COALESCE(c.current_amount, c.contract_amount) AS current_amount,
              c.contract_date,
              c.collection_progress_label,
              COALESCE(ms.total_milestone_amount, 0) AS total_milestone_amount,
              COALESCE(ms.total_collected_amount, 0) AS total_collected_amount
       FROM contracts c
       JOIN legal_entities e ON e.entity_id = c.counterparty_entity_id
       LEFT JOIN (
         SELECT contract_id,
                SUM(COALESCE(amount, 0)) AS total_milestone_amount,
                SUM(CASE WHEN payment_collected = 1 THEN COALESCE(collected_amount, amount, 0) ELSE 0 END) AS total_collected_amount
         FROM contract_payment_milestones
         GROUP BY contract_id
       ) ms ON ms.contract_id = c.contract_id
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
    const baseAmount = toNumber(row.current_amount) || toNumber(row.contract_amount) || toNumber(row.total_milestone_amount);
    const collected = toNumber(row.total_collected_amount);
    const node: ContractTreeContractNode = {
      contractId: String(row.contract_id ?? ""),
      contractTitle: String(row.contract_title ?? ""),
      counterpartyName: String(row.counterparty_name ?? ""),
      serviceType: row.service_type != null ? String(row.service_type) : null,
      serviceSubtype: row.service_subtype != null ? String(row.service_subtype) : null,
      contractKind: String(row.contract_kind ?? "standard"),
      contractAmount: toNumberOrNull(row.contract_amount),
      currentAmount: toNumberOrNull(row.current_amount),
      contractDate: row.contract_date != null ? String(row.contract_date) : null,
      collectionRate: baseAmount > 0 ? Math.min(1, Math.round((collected / baseAmount) * 1000) / 1000) : 0,
      collectionProgressLabel: row.collection_progress_label != null ? String(row.collection_progress_label) : null,
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

export async function getContractDetail(contractId: string) {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.*,
              e.entity_name AS counterparty_name,
              e.business_registration_no AS counterparty_business_registration_no,
              e.corporate_registration_no AS counterparty_corporate_registration_no,
              e.representative_name AS counterparty_representative_name,
              f.company_name AS facility_name,
              f.site_address AS facility_address,
              f.site_business_registration_no AS facility_site_business_registration_no,
              f.corporate_registration_no AS facility_corporate_registration_no,
              f.integrated_permit_target AS facility_integrated_permit_target
       FROM contracts c
       JOIN legal_entities e ON e.entity_id = c.counterparty_entity_id
       LEFT JOIN facilities f ON f.facility_id = c.facility_id
       WHERE c.contract_id = $1`,
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
  const changes = rowsToObjects(
    await db.exec(
      `SELECT *
       FROM contract_change_events
       WHERE contract_id = $1
       ORDER BY COALESCE(changed_at, created_at) DESC`,
      [contractId]
    )
  );

  return { contract, milestones, invoices, changes };
}

export async function getContractDashboard(): Promise<ContractDashboard> {
  const db = await getDb();
  const kpiRows = rowsToObjects(
    await db.exec(
      `WITH contract_totals AS (
         SELECT COUNT(*) AS total_contracts,
                SUM(COALESCE(current_amount, contract_amount, 0)) AS total_amount
         FROM contracts
       ),
       milestone_totals AS (
         SELECT SUM(CASE WHEN invoice_issued = 1 THEN COALESCE(invoice_amount, amount, 0) ELSE 0 END) AS issued_amount,
                SUM(CASE WHEN payment_collected = 1 THEN COALESCE(collected_amount, amount, 0) ELSE 0 END) AS collected_amount,
                SUM(CASE WHEN invoice_issued = 0 THEN COALESCE(amount, 0) ELSE 0 END) AS unissued_amount,
                SUM(CASE WHEN payment_collected = 0 THEN COALESCE(amount, 0) ELSE 0 END) AS uncollected_amount
         FROM contract_payment_milestones
       )
       SELECT contract_totals.total_contracts,
              contract_totals.total_amount,
              milestone_totals.issued_amount,
              milestone_totals.collected_amount,
              milestone_totals.unissued_amount,
              milestone_totals.uncollected_amount
       FROM contract_totals
       CROSS JOIN milestone_totals`
    )
  );
  const k = kpiRows[0] ?? {};
  const totalAmount = toNumber(k.total_amount);
  const collectedAmount = toNumber(k.collected_amount);

  const byServiceType = rowsToObjects(
    await db.exec(
      `SELECT COALESCE(service_type, '미분류') AS service_type,
              COUNT(*) AS count,
              SUM(COALESCE(current_amount, contract_amount, 0)) AS amount
       FROM contracts
       GROUP BY COALESCE(service_type, '미분류')
       ORDER BY amount DESC
       LIMIT 20`
    )
  ).map((row) => ({
    serviceType: String(row.service_type ?? "미분류"),
    count: toNumber(row.count),
    amount: toNumber(row.amount),
  }));

  const byYear = rowsToObjects(
    await db.exec(
      `SELECT SUBSTRING(COALESCE(NULLIF(contract_date, ''), started_at, created_at), 1, 4) AS year,
              COUNT(*) AS count,
              SUM(COALESCE(current_amount, contract_amount, 0)) AS amount
       FROM contracts
       GROUP BY SUBSTRING(COALESCE(NULLIF(contract_date, ''), started_at, created_at), 1, 4)
       ORDER BY year DESC
       LIMIT 12`
    )
  ).map((row) => ({
    year: String(row.year ?? ""),
    count: toNumber(row.count),
    amount: toNumber(row.amount),
  }));

  const uncollected = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id,
              c.contract_title,
              e.entity_name AS counterparty_name,
              m.stage_label,
              COALESCE(m.amount, 0) AS amount,
              m.invoice_issued_at
       FROM contract_payment_milestones m
       JOIN contracts c ON c.contract_id = m.contract_id
       JOIN legal_entities e ON e.entity_id = c.counterparty_entity_id
       WHERE m.payment_collected = 0
         AND COALESCE(m.amount, 0) > 0
       ORDER BY COALESCE(m.invoice_issued_at, c.contract_date, c.created_at) DESC
       LIMIT 10`
    )
  ).map((row) => ({
    contractId: String(row.contract_id ?? ""),
    contractTitle: String(row.contract_title ?? ""),
    counterpartyName: String(row.counterparty_name ?? ""),
    stageLabel: String(row.stage_label ?? ""),
    amount: toNumber(row.amount),
    invoiceIssuedAt: row.invoice_issued_at != null ? String(row.invoice_issued_at) : null,
  }));

  return {
    kpis: {
      totalContracts: toNumber(k.total_contracts),
      totalAmount,
      issuedAmount: toNumber(k.issued_amount),
      collectedAmount,
      unissuedAmount: toNumber(k.unissued_amount),
      uncollectedAmount: toNumber(k.uncollected_amount),
      collectionRate: totalAmount > 0 ? Math.round((collectedAmount / totalAmount) * 1000) / 10 : 0,
    },
    byServiceType,
    byYear,
    uncollected,
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
