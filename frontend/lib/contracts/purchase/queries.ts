import crypto from "node:crypto";
import { getDb, rowsToObjects, type PgDatabase } from "@/lib/db";
import { PURCHASE_CONTRACT_TYPES, type PurchaseContractType, type PurchaseMonthlyKind } from "./options";
import type {
  PurchaseContractDetail,
  PurchaseInvoiceCandidate,
  PurchaseMonthlyEntry,
  PurchaseMonthlyPayload,
  PurchaseTreeGroup,
  PurchaseTreeNode,
  PurchaseTreePayload,
} from "./types";

/**
 * 매입 계약 조회(331) — 매출 lib/ieps/contracts.ts 의 listContractsForTree/getContractDetail 과 같은 구조.
 * 계약 금액은 청구·지급 단계 합계를 기준으로 하고, 단계가 없을 때만 contract_amount 로 폴백한다.
 */
const toNumber = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const toNumberOrNull = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export async function listPurchaseContractsForTree(year: string | null): Promise<PurchaseTreePayload> {
  const db = await getDb();
  const yearsRows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT SUBSTRING(COALESCE(NULLIF(contract_date, ''), created_at), 1, 4) AS year
       FROM purchase_contracts
       WHERE deleted_at IS NULL`
    )
  );
  const availableYears = yearsRows
    .map((row) => String(row.year ?? ""))
    .filter((y) => /^\d{4}$/.test(y))
    .sort((a, b) => Number(b) - Number(a));

  const params: unknown[] = [];
  const where: string[] = ["p.deleted_at IS NULL"];
  if (year && /^\d{4}$/.test(year)) {
    params.push(year);
    where.push(`COALESCE(NULLIF(p.contract_date, ''), p.created_at) LIKE $${params.length} || '%'`);
  }

  const rows = rowsToObjects(
    await db.exec(
      `SELECT p.purchase_contract_id, p.contract_title, cp.company_name AS counterparty_name,
              p.contract_type, p.contract_category, p.contract_status, p.contract_amount, p.contract_date, p.completed_at,
              COALESCE(ms.total_milestone_amount, 0) AS total_milestone_amount,
              COALESCE(ms.total_paid_amount, 0) AS total_paid_amount,
              COALESCE(lm.paid_done, 0) AS paid_done
       FROM purchase_contracts p
       JOIN facilities cp ON cp.facility_id = p.counterparty_facility_id
       LEFT JOIN (
         SELECT purchase_contract_id,
                SUM(COALESCE(amount, 0)) AS total_milestone_amount,
                SUM(CASE WHEN payment_paid = 1 THEN COALESCE(paid_amount, amount, 0) ELSE 0 END) AS total_paid_amount
         FROM purchase_contract_milestones
         GROUP BY purchase_contract_id
       ) ms ON ms.purchase_contract_id = p.purchase_contract_id
       LEFT JOIN (
         -- 완료 = 마지막 단계(stage_order 최대) 지급 완료
         SELECT DISTINCT ON (purchase_contract_id) purchase_contract_id,
                CASE WHEN COALESCE(payment_paid, 0) = 1 THEN 1 ELSE 0 END AS paid_done
         FROM purchase_contract_milestones
         ORDER BY purchase_contract_id, stage_order DESC
       ) lm ON lm.purchase_contract_id = p.purchase_contract_id
       WHERE ${where.join(" AND ")}
       ORDER BY COALESCE(NULLIF(p.contract_date, ''), p.created_at) ASC NULLS LAST, p.contract_title ASC`,
      params
    )
  );

  const groupMap = new Map<PurchaseContractType, PurchaseTreeNode[]>();
  for (const t of PURCHASE_CONTRACT_TYPES) groupMap.set(t.key, []);
  for (const row of rows) {
    const type = String(row.contract_type ?? "") as PurchaseContractType;
    if (!groupMap.has(type)) continue;
    const milestoneAmount = toNumber(row.total_milestone_amount);
    const baseAmount = milestoneAmount > 0 ? milestoneAmount : toNumber(row.contract_amount);
    const paid = toNumber(row.total_paid_amount);
    groupMap.get(type)!.push({
      purchaseContractId: String(row.purchase_contract_id ?? ""),
      contractTitle: String(row.contract_title ?? ""),
      counterpartyName: String(row.counterparty_name ?? ""),
      contractCategory: String(row.contract_category ?? ""),
      currentAmount: baseAmount > 0 ? baseAmount : toNumberOrNull(row.contract_amount),
      contractDate: row.contract_date != null ? String(row.contract_date) : null,
      contractStatus: String(row.contract_status ?? "active"),
      isFullyPaid: baseAmount > 0 && paid >= baseAmount,
      isCompleted: Number(row.paid_done) === 1,
    });
  }
  // 유형은 고정 4종이라 빈 유형도 그룹으로 내보낸다(매출 트리와 달리 유형이 구조적이라 자리를 비우지 않는다).
  const groups: PurchaseTreeGroup[] = PURCHASE_CONTRACT_TYPES.map((t) => ({
    contractType: t.key,
    label: t.label,
    contracts: groupMap.get(t.key) ?? [],
  }));

  return { year: year && /^\d{4}$/.test(year) ? year : null, totalCount: rows.length, availableYears, groups };
}

export async function getPurchaseContractDetail(purchaseContractId: string): Promise<PurchaseContractDetail | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT p.*,
              cp.company_name AS counterparty_name,
              cp.business_registration_no AS counterparty_business_registration_no,
              cp.site_business_registration_no AS counterparty_site_business_registration_no,
              cp.representative_name AS counterparty_representative_name,
              cp.trade_roles AS counterparty_trade_roles,
              ja.name AS account_name,
              rc.contract_title AS related_contract_title,
              rcp.company_name AS related_counterparty_name,
              rc.deleted_at AS related_contract_deleted_at
       FROM purchase_contracts p
       JOIN facilities cp ON cp.facility_id = p.counterparty_facility_id
       LEFT JOIN journal_accounts ja ON ja.account_code = p.account_code
       LEFT JOIN contracts rc ON rc.contract_id = p.related_contract_id
       LEFT JOIN facilities rcp ON rcp.facility_id = rc.counterparty_facility_id
       WHERE p.purchase_contract_id = $1 AND p.deleted_at IS NULL`,
      [purchaseContractId]
    )
  );
  const contract = rows[0];
  if (!contract) return null;

  const milestones = rowsToObjects(
    await db.exec(
      `SELECT m.*,
              h.invoicer_corp_name AS hometax_invoicer_corp_name,
              h.write_date AS hometax_write_date,
              h.total_amount AS hometax_total_amount,
              h.amount_total AS hometax_amount_total,
              h.tax_total AS hometax_tax_total,
              h.nts_send_key AS hometax_nts_send_key,
              h.item_name AS hometax_item_name
       FROM purchase_contract_milestones m
       LEFT JOIN hometax_tax_invoices h ON h.hti_id = m.hometax_hti_id
       WHERE m.purchase_contract_id = $1
       ORDER BY m.stage_order ASC`,
      [purchaseContractId]
    )
  );
  const documents = rowsToObjects(
    await db.exec(
      `SELECT document_id, purchase_contract_id, milestone_id, document_type, display_name, original_filename,
              public_path, storage_provider, storage_key, byte_size, sha256, created_at, updated_at
       FROM purchase_contract_documents
       WHERE purchase_contract_id = $1
       ORDER BY created_at DESC`,
      [purchaseContractId]
    )
  );
  // 333 — 단가표 유무·월별 금액 연도·연결 차량 자산(등록증)
  const rateCard = rowsToObjects(
    await db.exec(`SELECT 1 AS present FROM purchase_contract_rate_cards WHERE purchase_contract_id = $1`, [purchaseContractId])
  );
  const monthlyYears = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT year FROM purchase_contract_monthly_amounts WHERE purchase_contract_id = $1 ORDER BY year DESC`,
      [purchaseContractId]
    )
  )
    .map((r) => Number(r.year))
    .filter((y) => Number.isFinite(y));
  let linkedAsset: PurchaseContractDetail["linkedAsset"] = null;
  if (contract.linked_asset_id) {
    const asset = rowsToObjects(
      await db.exec(`SELECT asset_id, name, registration_doc_key, registration_doc_name FROM reservable_assets WHERE asset_id = $1`, [
        String(contract.linked_asset_id),
      ])
    )[0];
    if (asset) {
      linkedAsset = {
        assetId: String(asset.asset_id),
        name: String(asset.name ?? ""),
        registrationDocKey: asset.registration_doc_key != null && String(asset.registration_doc_key) ? String(asset.registration_doc_key) : null,
        registrationDocName: asset.registration_doc_name != null ? String(asset.registration_doc_name) : null,
      };
    }
  }
  return { contract, milestones, documents, hasRateCard: rateCard.length > 0, monthlyYears, linkedAsset };
}

/**
 * 계약금액 = 단계 금액 합계 — 외주 계약만. 정기 구독은 월 구독료를 본문에서 받아 저장하고 임대·관리는 비해당이라
 * 단계 합계로 덮어쓰지 않는다(333). 단계 생성·수정·삭제 뒤 같은 트랜잭션에서 부른다.
 */
export async function recalcPurchaseContractAmount(db: PgDatabase, purchaseContractId: string, now: string): Promise<void> {
  await db.run(
    `UPDATE purchase_contracts p
        SET contract_amount = s.total, updated_at = $2
       FROM (SELECT SUM(COALESCE(amount, 0)) AS total, COUNT(*) AS n
               FROM purchase_contract_milestones WHERE purchase_contract_id = $1) s
      WHERE p.purchase_contract_id = $1 AND s.n > 0 AND p.contract_type = 'outsourcing'`,
    [purchaseContractId, now]
  );
}

/* ─── 월별 금액(333) ─── */

/** 한 해 12칸(비어 있는 달도 채워서)과 연도별 합계. */
export async function listMonthlyAmounts(purchaseContractId: string, kind: PurchaseMonthlyKind, year: number): Promise<PurchaseMonthlyPayload> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT m.month, m.amount, m.purpose, m.detail, m.document_id, d.public_path AS document_path, d.display_name AS document_name
         FROM purchase_contract_monthly_amounts m
         LEFT JOIN purchase_contract_documents d ON d.document_id = m.document_id
        WHERE m.purchase_contract_id = $1 AND m.kind = $2 AND m.year = $3
        ORDER BY m.month`,
      [purchaseContractId, kind, year]
    )
  );
  const byMonth = new Map<number, Record<string, unknown>>();
  for (const r of rows) byMonth.set(Number(r.month), r);
  const months: PurchaseMonthlyEntry[] = [];
  for (let month = 1; month <= 12; month++) {
    const r = byMonth.get(month);
    const detailRaw = r?.detail;
    months.push({
      month,
      amount: r ? toNumberOrNull(r.amount) : null,
      purpose: r?.purpose != null ? String(r.purpose) : "",
      detail: typeof detailRaw === "string" ? (JSON.parse(detailRaw) as Record<string, unknown>) : ((detailRaw as Record<string, unknown>) ?? {}),
      documentId: r?.document_id != null ? String(r.document_id) : null,
      documentPath: r?.document_path != null ? String(r.document_path) : null,
      documentName: r?.document_name != null ? String(r.document_name) : null,
    });
  }
  const totals = rowsToObjects(
    await db.exec(
      `SELECT year, SUM(COALESCE(amount, 0)) AS total
         FROM purchase_contract_monthly_amounts
        WHERE purchase_contract_id = $1 AND kind = $2
        GROUP BY year ORDER BY year`,
      [purchaseContractId, kind]
    )
  );
  return {
    kind,
    year,
    months,
    yearlyTotals: totals.map((t) => ({ year: Number(t.year), total: toNumber(t.total) })),
  };
}

export interface MonthlyUpsertRow {
  month: number;
  amount: number | null;
  purpose?: string | null;
  detail?: Record<string, unknown> | null;
  documentId?: string | null;
}

/**
 * 한 해의 월별 금액 upsert — 금액·목적·명세서가 모두 비면 행을 지운다. detail/documentId 가 undefined 면 기존 값 유지
 * (월별 표의 금액만 고칠 때 명세서 파싱 결과를 날리지 않는다).
 */
export async function upsertMonthlyAmounts(
  db: PgDatabase,
  purchaseContractId: string,
  kind: PurchaseMonthlyKind,
  year: number,
  rows: MonthlyUpsertRow[],
  now: string
): Promise<void> {
  for (const row of rows) {
    const month = Math.floor(Number(row.month));
    if (!Number.isFinite(month) || month < 1 || month > 12) continue;
    const amount = row.amount != null && Number.isFinite(Number(row.amount)) ? Number(row.amount) : null;
    const purpose = row.purpose == null ? undefined : String(row.purpose).trim() || null;
    const existing = rowsToObjects(
      await db.exec(
        `SELECT entry_id, purpose, detail, document_id FROM purchase_contract_monthly_amounts
          WHERE purchase_contract_id = $1 AND kind = $2 AND year = $3 AND month = $4`,
        [purchaseContractId, kind, year, month]
      )
    )[0];
    const nextPurpose = purpose === undefined ? (existing?.purpose != null ? String(existing.purpose) : null) : purpose;
    const nextDetail = row.detail === undefined ? existing?.detail ?? {} : (row.detail ?? {});
    const nextDocument = row.documentId === undefined ? (existing?.document_id != null ? String(existing.document_id) : null) : row.documentId;
    const empty = amount == null && !nextPurpose && !nextDocument && Object.keys((nextDetail as Record<string, unknown>) ?? {}).length === 0;
    if (empty) {
      if (existing) await db.run(`DELETE FROM purchase_contract_monthly_amounts WHERE entry_id = $1`, [String(existing.entry_id)]);
      continue;
    }
    if (existing) {
      await db.run(
        `UPDATE purchase_contract_monthly_amounts
            SET amount = $2, purpose = $3, detail = $4::jsonb, document_id = $5, updated_at = $6
          WHERE entry_id = $1`,
        [String(existing.entry_id), amount, nextPurpose, JSON.stringify(nextDetail), nextDocument, now]
      );
    } else {
      await db.run(
        `INSERT INTO purchase_contract_monthly_amounts
           (entry_id, purchase_contract_id, kind, year, month, amount, purpose, detail, document_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $10)`,
        ["pma_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16), purchaseContractId, kind, year, month, amount, nextPurpose, JSON.stringify(nextDetail), nextDocument, now]
      );
    }
  }
}

/**
 * 홈택스 매입 세금계산서 후보 — 계약상대 사업자번호(공급자 invoicer_corp_num)가 같은 매입 계산서.
 * 단계 금액이 있으면 금액 차이가 작은 순, 그다음 작성일 최신순. 이미 다른 단계에 연결된 건은 표시만 하고 숨기지 않는다.
 */
export async function listPurchaseInvoiceCandidates(
  purchaseContractId: string,
  milestoneId: string | null
): Promise<{ candidates: PurchaseInvoiceCandidate[]; corpNum: string | null; targetAmount: number | null }> {
  const db = await getDb();
  const head = rowsToObjects(
    await db.exec(
      `SELECT cp.business_registration_no, cp.site_business_registration_no
         FROM purchase_contracts p JOIN facilities cp ON cp.facility_id = p.counterparty_facility_id
        WHERE p.purchase_contract_id = $1 AND p.deleted_at IS NULL`,
      [purchaseContractId]
    )
  )[0];
  if (!head) return { candidates: [], corpNum: null, targetAmount: null };
  const corpNum =
    String(head.business_registration_no ?? "").replace(/\D/g, "") ||
    String(head.site_business_registration_no ?? "").replace(/\D/g, "") ||
    null;
  if (!corpNum) return { candidates: [], corpNum: null, targetAmount: null };

  let targetAmount: number | null = null;
  if (milestoneId) {
    const m = rowsToObjects(
      await db.exec(
        `SELECT amount, invoice_amount FROM purchase_contract_milestones WHERE milestone_id = $1 AND purchase_contract_id = $2`,
        [milestoneId, purchaseContractId]
      )
    )[0];
    targetAmount = toNumberOrNull(m?.invoice_amount) ?? toNumberOrNull(m?.amount);
  }

  const rows = rowsToObjects(
    await db.exec(
      `SELECT h.hti_id, h.write_date, h.issue_dt, h.invoicer_corp_num, h.invoicer_corp_name, h.item_name,
              h.amount_total, h.tax_total, h.total_amount, h.nts_send_key,
              m.milestone_id AS linked_milestone_id
         FROM hometax_tax_invoices h
         LEFT JOIN purchase_contract_milestones m ON m.hometax_hti_id = h.hti_id
        WHERE h.direction = 'purchase' AND COALESCE(h.excluded, 0) = 0
          AND regexp_replace(COALESCE(h.invoicer_corp_num, ''), '\\D', '', 'g') = $1
        ORDER BY CASE WHEN $2::numeric IS NULL THEN 0 ELSE abs(h.total_amount - $2::numeric) END ASC,
                 h.write_date DESC
        LIMIT 20`,
      [corpNum, targetAmount]
    )
  );
  const candidates: PurchaseInvoiceCandidate[] = rows.map((r) => ({
    htiId: String(r.hti_id ?? ""),
    writeDate: String(r.write_date ?? ""),
    issueDt: r.issue_dt != null ? String(r.issue_dt) : null,
    invoicerCorpNum: r.invoicer_corp_num != null ? String(r.invoicer_corp_num) : null,
    invoicerCorpName: r.invoicer_corp_name != null ? String(r.invoicer_corp_name) : null,
    itemName: r.item_name != null ? String(r.item_name) : null,
    amountTotal: toNumber(r.amount_total),
    taxTotal: toNumber(r.tax_total),
    totalAmount: toNumber(r.total_amount),
    ntsSendKey: String(r.nts_send_key ?? ""),
    linkedMilestoneId: r.linked_milestone_id != null ? String(r.linked_milestone_id) : null,
  }));
  return { candidates, corpNum, targetAmount };
}
