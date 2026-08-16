// 부가세 준비 — 계정과목 분류 편집/일괄 지정/자동분류 재실행 + 기간 집계 + xlsx (블루프린트 P2 F3)
// 공제 판정: 가맹점 과세유형(간이2·면세4·비영리6·고유번호8 = 매입세액 불공제)과 계정과목 기본값(접대비 등)을 함께 본다.

import ExcelJS from "exceljs";
import { getDb, withDbWrite, rowsToObjects } from "@/lib/db";
import { loadCategories, classifyOne, isPgMerchant, loadStoreRules } from "@/lib/barobill/classify";

const KST_NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");

/** 과세유형만으로 불공제가 확정되는 값 — 세금계산서·신용카드 매입세액 공제 불가 유형. */
const NON_DEDUCTIBLE_TAX_TYPES = new Set([2, 4, 6, 8]);

export function judgeDeductible(storeTaxType: number | null, categoryDefault: number | null): number {
  if (storeTaxType != null && NON_DEDUCTIBLE_TAX_TYPES.has(storeTaxType)) return 0;
  if (categoryDefault === 0) return 0; // 접대비 등 계정과목 자체가 불공제
  return 1;
}

/** 단건 분류/공제/제외 수정(수동 확정). 분류를 바꾸면 학습 사전에도 반영한다(PG 가맹점 제외). */
export async function updateCardClassification(
  cardTxnId: string,
  patch: { categoryKey?: string | null; vatDeductible?: number | null; excluded?: boolean; memo?: string | null },
): Promise<void> {
  const categories = await loadCategories();
  const byKey = new Map(categories.map((c) => [c.categoryKey, c]));
  await withDbWrite(async (db) => {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT store_corp_num, store_name, store_biz_type, store_tax_type FROM card_transactions WHERE card_txn_id = $1`,
        [cardTxnId],
      ),
    );
    if (!rows.length) throw Object.assign(new Error("매입 건을 찾을 수 없습니다."), { status: 404 });
    const row = rows[0];

    const sets: string[] = [];
    const args: unknown[] = [cardTxnId];
    if (patch.categoryKey !== undefined) {
      args.push(patch.categoryKey);
      sets.push(`category_key = $${args.length}`, `category_source = 'manual'`);
      // 분류를 바꾸면 공제 여부도 기본값으로 재판정(사용자가 명시 지정한 경우는 아래에서 덮어씀)
      const cat = patch.categoryKey ? byKey.get(patch.categoryKey) : undefined;
      args.push(judgeDeductible(row.store_tax_type == null ? null : Number(row.store_tax_type), cat?.vatDeductibleDefault ?? null));
      sets.push(`vat_deductible = $${args.length}`);
    }
    if (patch.vatDeductible !== undefined) {
      args.push(patch.vatDeductible);
      sets.push(`vat_deductible = $${args.length}`);
    }
    if (patch.excluded !== undefined) {
      args.push(patch.excluded ? 1 : 0);
      sets.push(`excluded = $${args.length}`);
    }
    if (patch.memo !== undefined) {
      args.push(patch.memo);
      sets.push(`memo = $${args.length}`);
    }
    if (!sets.length) return;
    args.push(KST_NOW());
    sets.push(`updated_at = $${args.length}`);
    await db.run(`UPDATE card_transactions SET ${sets.join(", ")} WHERE card_txn_id = $1`, args);

    // 학습 사전 반영 — 실사용처만(PG 가맹점 제외)
    if (patch.categoryKey && row.store_corp_num && !isPgMerchant(row.store_biz_type ? String(row.store_biz_type) : null)) {
      await db.run(
        `INSERT INTO card_merchant_links (store_corp_num, category_key, store_name_snapshot, confirm_count, last_confirmed_at, created_at)
         VALUES ($1, $2, $3, 1, $4, $4)
         ON CONFLICT (store_corp_num) DO UPDATE SET
           category_key = EXCLUDED.category_key, store_name_snapshot = EXCLUDED.store_name_snapshot,
           confirm_count = card_merchant_links.confirm_count + 1, last_confirmed_at = EXCLUDED.last_confirmed_at`,
        [String(row.store_corp_num), patch.categoryKey, row.store_name ? String(row.store_name) : null, KST_NOW()],
      );
    }
  });
}

/** 선택 건 일괄 분류 지정. */
export async function bulkAssignCategory(cardTxnIds: string[], categoryKey: string): Promise<number> {
  let count = 0;
  for (const id of cardTxnIds) {
    await updateCardClassification(id, { categoryKey });
    count += 1;
  }
  return count;
}

/** 자동 분류 재실행 — 기본은 미분류 건만(수동 확정분 보존). all=true 면 manual 제외 전체 재계산. */
export async function runAutoClassify(options?: { from?: string; to?: string; all?: boolean }): Promise<{ scanned: number; classified: number }> {
  const db = await getDb();
  const where: string[] = ["excluded = 0"];
  const args: unknown[] = [];
  if (!options?.all) where.push("category_key IS NULL");
  else where.push("(category_source IS NULL OR category_source <> 'manual')");
  if (options?.from) {
    args.push(`${options.from} 00:00:00`);
    where.push(`approved_at >= $${args.length}`);
  }
  if (options?.to) {
    args.push(`${options.to} 23:59:59`);
    where.push(`approved_at <= $${args.length}`);
  }
  const rows = rowsToObjects(
    await db.exec(
      `SELECT card_txn_id, store_corp_num, store_name, store_biz_type, store_tax_type
         FROM card_transactions WHERE ${where.join(" AND ")}`,
      args,
    ),
  );
  if (!rows.length) return { scanned: 0, classified: 0 };

  const categories = await loadCategories();
  const byKey = new Map(categories.map((c) => [c.categoryKey, c]));
  const learnedRows = rowsToObjects(await db.exec(`SELECT store_corp_num, category_key FROM card_merchant_links`));
  const learned = new Map(learnedRows.map((r) => [String(r.store_corp_num), String(r.category_key)]));
  const storeRules = await loadStoreRules();

  let classified = 0;
  await withDbWrite(async (tx) => {
    for (const row of rows) {
      const result = classifyOne(
        {
          storeCorpNum: row.store_corp_num ? String(row.store_corp_num) : null,
          storeBizType: row.store_biz_type ? String(row.store_biz_type) : null,
          storeName: row.store_name ? String(row.store_name) : null,
        },
        categories,
        learned,
        storeRules,
      );
      if (!result) continue;
      const cat = byKey.get(result.categoryKey);
      await tx.run(
        `UPDATE card_transactions SET category_key = $2, category_source = $3, vat_deductible = $4, updated_at = $5 WHERE card_txn_id = $1`,
        [
          String(row.card_txn_id),
          result.categoryKey,
          result.source,
          judgeDeductible(row.store_tax_type == null ? null : Number(row.store_tax_type), cat?.vatDeductibleDefault ?? null),
          KST_NOW(),
        ],
      );
      classified += 1;
    }
  });
  return { scanned: rows.length, classified };
}

export interface VatSummaryRow {
  categoryKey: string | null;
  categoryLabel: string;
  count: number;
  amountTotal: number;
  supplyAmount: number;
  taxAmount: number;
  deductibleTax: number; // 공제 대상 부가세
  nonDeductibleTax: number;
}

export interface VatSummary {
  from: string;
  to: string;
  rows: VatSummaryRow[];
  totals: Omit<VatSummaryRow, "categoryKey" | "categoryLabel">;
  unclassified: number;
}

/** 기간(분기 등) 계정과목별 집계 — 취소·환불 건과 제외 표시 건은 뺀다. */
export async function getVatSummary(params: { from: string; to: string; cardId?: string }): Promise<VatSummary> {
  const db = await getDb();
  const args: unknown[] = [`${params.from} 00:00:00`, `${params.to} 23:59:59`];
  let cardWhere = "";
  if (params.cardId) {
    args.push(params.cardId);
    cardWhere = ` AND card_id = $${args.length}`;
  }
  const rows = rowsToObjects(
    await db.exec(
      `SELECT category_key,
              count(*) AS n,
              COALESCE(SUM(amount_total), 0) AS amount_total,
              COALESCE(SUM(supply_amount), 0) AS supply_amount,
              COALESCE(SUM(tax_amount), 0) AS tax_amount,
              COALESCE(SUM(CASE WHEN COALESCE(vat_deductible, 1) = 1 THEN tax_amount END), 0) AS deductible_tax,
              COALESCE(SUM(CASE WHEN COALESCE(vat_deductible, 1) = 0 THEN tax_amount END), 0) AS non_deductible_tax
         FROM card_transactions
        WHERE approved_at >= $1 AND approved_at <= $2 AND excluded = 0 AND approval_type = '승인'${cardWhere}
        GROUP BY category_key`,
      args,
    ),
  );
  const categories = await loadCategories();
  const labels = new Map(categories.map((c) => [c.categoryKey, c.label]));

  const summary: VatSummaryRow[] = rows.map((r) => ({
    categoryKey: r.category_key ? String(r.category_key) : null,
    categoryLabel: r.category_key ? labels.get(String(r.category_key)) ?? String(r.category_key) : "미분류",
    count: Number(r.n || 0),
    amountTotal: Number(r.amount_total || 0),
    supplyAmount: Number(r.supply_amount || 0),
    taxAmount: Number(r.tax_amount || 0),
    deductibleTax: Number(r.deductible_tax || 0),
    nonDeductibleTax: Number(r.non_deductible_tax || 0),
  }));
  summary.sort((a, b) => (a.categoryKey === null ? 1 : b.categoryKey === null ? -1 : b.amountTotal - a.amountTotal));

  const totals = summary.reduce(
    (acc, r) => ({
      count: acc.count + r.count,
      amountTotal: acc.amountTotal + r.amountTotal,
      supplyAmount: acc.supplyAmount + r.supplyAmount,
      taxAmount: acc.taxAmount + r.taxAmount,
      deductibleTax: acc.deductibleTax + r.deductibleTax,
      nonDeductibleTax: acc.nonDeductibleTax + r.nonDeductibleTax,
    }),
    { count: 0, amountTotal: 0, supplyAmount: 0, taxAmount: 0, deductibleTax: 0, nonDeductibleTax: 0 },
  );

  return {
    from: params.from,
    to: params.to,
    rows: summary,
    totals,
    unclassified: summary.find((r) => r.categoryKey === null)?.count ?? 0,
  };
}

/** 회계 담당자 인수용 xlsx — 요약 시트 + 상세 시트(카드사 엑셀 수기 분류 대체). */
export async function buildVatWorkbook(params: { from: string; to: string }): Promise<Buffer> {
  const db = await getDb();
  const summary = await getVatSummary(params);
  const categories = await loadCategories();
  const labels = new Map(categories.map((c) => [c.categoryKey, c.label]));

  const detail = rowsToObjects(
    await db.exec(
      `SELECT t.approved_at, c.card_company_name, c.card_alias, t.store_name, t.store_corp_num, t.store_biz_type,
              t.store_tax_type, t.amount_total, t.supply_amount, t.tax_amount, t.category_key, t.category_source,
              t.vat_deductible, t.doc_id
         FROM card_transactions t JOIN card_registry c ON c.card_id = t.card_id
        WHERE t.approved_at >= $1 AND t.approved_at <= $2 AND t.excluded = 0 AND t.approval_type = '승인'
        ORDER BY t.approved_at`,
      [`${params.from} 00:00:00`, `${params.to} 23:59:59`],
    ),
  );

  const wb = new ExcelJS.Workbook();
  const sum = wb.addWorksheet("계정과목 집계");
  sum.addRow([`법인카드 매입 부가세 집계 (${params.from} ~ ${params.to})`]);
  sum.getRow(1).font = { bold: true, size: 13 };
  sum.addRow([]);
  sum.addRow(["계정과목", "건수", "합계금액", "공급가액", "부가세", "공제대상 부가세", "불공제 부가세"]);
  sum.getRow(3).font = { bold: true };
  for (const r of summary.rows) {
    sum.addRow([r.categoryLabel, r.count, r.amountTotal, r.supplyAmount, r.taxAmount, r.deductibleTax, r.nonDeductibleTax]);
  }
  sum.addRow([
    "합계",
    summary.totals.count,
    summary.totals.amountTotal,
    summary.totals.supplyAmount,
    summary.totals.taxAmount,
    summary.totals.deductibleTax,
    summary.totals.nonDeductibleTax,
  ]);
  sum.lastRow!.font = { bold: true };
  sum.columns.forEach((col, i) => (col.width = i === 0 ? 18 : 16));
  sum.getColumn(2).numFmt = "#,##0";
  for (let c = 3; c <= 7; c += 1) sum.getColumn(c).numFmt = "#,##0";

  const det = wb.addWorksheet("매입 상세");
  det.addRow(["사용일시", "카드", "상호", "가맹점 사업자번호", "업태", "과세유형", "합계금액", "공급가액", "부가세", "계정과목", "분류근거", "공제", "귀속문서"]);
  det.getRow(1).font = { bold: true };
  const TAX_TYPE_LABEL: Record<number, string> = {
    0: "미확인", 1: "일반과세", 2: "간이과세", 4: "면세", 5: "과세특례", 6: "비영리", 7: "간이(계산서)", 8: "고유번호",
  };
  for (const r of detail) {
    det.addRow([
      String(r.approved_at ?? ""),
      String(r.card_alias || r.card_company_name || ""),
      String(r.store_name ?? ""),
      String(r.store_corp_num ?? ""),
      String(r.store_biz_type ?? ""),
      r.store_tax_type == null ? "" : TAX_TYPE_LABEL[Number(r.store_tax_type)] ?? String(r.store_tax_type),
      Number(r.amount_total || 0),
      Number(r.supply_amount || 0),
      Number(r.tax_amount || 0),
      r.category_key ? labels.get(String(r.category_key)) ?? String(r.category_key) : "미분류",
      String(r.category_source ?? ""),
      Number(r.vat_deductible ?? 1) === 1 ? "공제" : "불공제",
      r.doc_id ? "결의서 귀속" : "",
    ]);
  }
  det.columns.forEach((col, i) => (col.width = [20, 16, 26, 16, 16, 12, 14, 14, 12, 14, 10, 8, 12][i] ?? 14));
  for (let c = 7; c <= 9; c += 1) det.getColumn(c).numFmt = "#,##0";

  return Buffer.from(await wb.xlsx.writeBuffer());
}
