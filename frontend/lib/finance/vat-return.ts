// 부가세 신고 엔진 (블루프린트 P5 ②③④⑥) — 매입매출장·신고서 자동 계산·합계표·원장 대사·경비 점검
// 원칙: 원장(hometax_tax_invoices·tax_invoices·card_transactions) 위 파생 계산 — 저장은 vat_returns 스냅뿐.
// 신고 모집단 = 국세청 전송완료 문서(홈택스 수집분 ∪ 앱 발행 전송완료분, 승인번호 dedup).
// 확정·제출은 항상 사람의 명시 액션(§7 T5). 전산매체 파일 생성은 포맷 스펙 실사 후 후속.

import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { getDb, withDbWrite, rowsToObjects } from "@/lib/db";
import { getVatSummary } from "@/lib/barobill/vat";

const KST_NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");

const hashId = (prefix: string, source: string) =>
  `${prefix}-${createHash("sha256").update(source).digest("hex").slice(0, 12)}`;

// ── 과세기간 (법인 일반과세자: 분기별 예정/확정) ──

export interface VatPeriod {
  year: number;
  term: 1 | 2;
  kind: "pre" | "final";
  from: string; // YYYY-MM-DD
  to: string;
  label: string;
  dueDate: string; // 신고·납부 기한
}

export function vatPeriod(year: number, term: 1 | 2, kind: "pre" | "final"): VatPeriod {
  const startMonth = term === 1 ? (kind === "pre" ? 1 : 4) : kind === "pre" ? 7 : 10;
  const endMonth = startMonth + 2;
  const from = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const lastDay = new Date(year, endMonth, 0).getDate();
  const to = `${year}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const due =
    term === 1
      ? kind === "pre"
        ? `${year}-04-25`
        : `${year}-07-25`
      : kind === "pre"
        ? `${year}-10-25`
        : `${year + 1}-01-25`;
  const label = `${year}년 ${term}기 ${kind === "pre" ? "예정" : "확정"} (${startMonth}~${endMonth}월)`;
  return { year, term, kind, from, to, label, dueDate: due };
}

export function vatPeriodsOfYear(year: number): VatPeriod[] {
  return [vatPeriod(year, 1, "pre"), vatPeriod(year, 1, "final"), vatPeriod(year, 2, "pre"), vatPeriod(year, 2, "final")];
}

/** 오늘(KST) 기준 가장 최근 종료된 과세기간 — 신고서 화면 기본 선택. */
export function latestClosedPeriod(): VatPeriod {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const y = now.getUTCFullYear();
  const candidates = [...vatPeriodsOfYear(y - 1), ...vatPeriodsOfYear(y)];
  const today = now.toISOString().slice(0, 10);
  const closed = candidates.filter((p) => p.to < today);
  return closed[closed.length - 1] ?? candidates[0];
}

// ── 매입매출장 ──

export interface VatLedgerRow {
  htiId: string | null; // hometax 원장 행 (앱 발행분 병합 건은 null)
  ntsSendKey: string;
  writeDate: string;
  direction: "sales" | "purchase";
  taxType: number; // 1 과세 / 2 영세 / 3 면세
  modifyCode: string | null;
  partyCorpNum: string | null; // 매출=공급받는자 / 매입=공급자
  partyName: string | null;
  amountTotal: number;
  taxTotal: number;
  totalAmount: number;
  itemName: string | null;
  vatDeductible: number | null; // 매입만 의미 (null=공제 취급)
  excluded: boolean;
  source: "hometax" | "app_issue";
}

export interface VatLedger {
  from: string;
  to: string;
  rows: VatLedgerRow[];
  lastSyncedAt: string | null;
}

/** 기간 매입매출장 — 홈택스 수집분 + 앱 발행 전송완료분(승인번호 dedup). */
export async function buildVatLedger(params: { from: string; to: string; direction?: "sales" | "purchase" }): Promise<VatLedger> {
  const db = await getDb();
  const args: unknown[] = [params.from, params.to];
  let dirWhere = "";
  if (params.direction) {
    args.push(params.direction);
    dirWhere = ` AND direction = $${args.length}`;
  }
  const htiRows = rowsToObjects(
    await db.exec(
      `SELECT hti_id, nts_send_key, write_date, direction, tax_type, modify_code,
              invoicer_corp_num, invoicer_corp_name, invoicee_corp_num, invoicee_corp_name,
              amount_total, tax_total, total_amount, item_name, vat_deductible, excluded
         FROM hometax_tax_invoices
        WHERE write_date >= $1 AND write_date <= $2${dirWhere}
        ORDER BY write_date, nts_send_key`,
      args,
    ),
  );
  const rows: VatLedgerRow[] = htiRows.map((r) => {
    const direction = String(r.direction) as "sales" | "purchase";
    return {
      htiId: String(r.hti_id),
      ntsSendKey: String(r.nts_send_key),
      writeDate: String(r.write_date).slice(0, 10),
      direction,
      taxType: Number(r.tax_type || 1),
      modifyCode: r.modify_code ? String(r.modify_code) : null,
      partyCorpNum: direction === "sales" ? (r.invoicee_corp_num ? String(r.invoicee_corp_num) : null) : r.invoicer_corp_num ? String(r.invoicer_corp_num) : null,
      partyName: direction === "sales" ? (r.invoicee_corp_name ? String(r.invoicee_corp_name) : null) : r.invoicer_corp_name ? String(r.invoicer_corp_name) : null,
      amountTotal: Number(r.amount_total || 0),
      taxTotal: Number(r.tax_total || 0),
      totalAmount: Number(r.total_amount || 0),
      itemName: r.item_name ? String(r.item_name) : null,
      vatDeductible: r.vat_deductible == null ? null : Number(r.vat_deductible),
      excluded: Number(r.excluded || 0) === 1,
      source: "hometax",
    };
  });

  // 앱 발행분 중 홈택스 수집에 아직 없는 전송완료 건 (발행 다음날 수집되기 전 최신분 커버)
  if (!params.direction || params.direction === "sales") {
    const seen = new Set(rows.map((r) => r.ntsSendKey));
    const appRows = rowsToObjects(
      await db.exec(
        `SELECT nts_send_key, write_date, tax_type, modify_code, invoicee_corp_num, invoicee_corp_name,
                amount_total, tax_total, total_amount
           FROM tax_invoices
          WHERE write_date >= $1 AND write_date <= $2
            AND canceled_at IS NULL AND nts_send_state = 4 AND nts_send_key IS NOT NULL`,
        [params.from, params.to],
      ),
    );
    for (const r of appRows) {
      const key = String(r.nts_send_key);
      if (seen.has(key)) continue;
      rows.push({
        htiId: null,
        ntsSendKey: key,
        writeDate: String(r.write_date).slice(0, 10),
        direction: "sales",
        taxType: Number(r.tax_type || 1),
        modifyCode: r.modify_code ? String(r.modify_code) : null,
        partyCorpNum: r.invoicee_corp_num ? String(r.invoicee_corp_num) : null,
        partyName: r.invoicee_corp_name ? String(r.invoicee_corp_name) : null,
        amountTotal: Number(r.amount_total || 0),
        taxTotal: Number(r.tax_total || 0),
        totalAmount: Number(r.total_amount || 0),
        itemName: null,
        vatDeductible: null,
        excluded: false,
        source: "app_issue",
      });
    }
    rows.sort((a, b) => (a.writeDate < b.writeDate ? -1 : a.writeDate > b.writeDate ? 1 : 0));
  }

  const syncRows = rowsToObjects(
    await db.exec(`SELECT max(finished_at) AS last_ok FROM finance_sync_logs WHERE kind = 'hometax' AND status = 'ok'`),
  );
  return { from: params.from, to: params.to, rows, lastSyncedAt: (syncRows[0]?.last_ok as string | null) ?? null };
}

// ── 매입 공제/제외 수정 ──

export async function updateHometaxInvoice(
  htiId: string,
  patch: { vatDeductible?: number | null; excluded?: boolean; memo?: string | null },
): Promise<void> {
  await withDbWrite(async (db) => {
    const sets: string[] = [];
    const args: unknown[] = [htiId];
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
    await db.run(`UPDATE hometax_tax_invoices SET ${sets.join(", ")} WHERE hti_id = $1`, args);
  });
}

// ── 신고서 계산 ──

interface AmountBlock {
  count: number;
  supply: number;
  tax: number;
}
const emptyBlock = (): AmountBlock => ({ count: 0, supply: 0, tax: 0 });
const addRow = (block: AmountBlock, r: { amountTotal: number; taxTotal: number }) => {
  block.count += 1;
  block.supply += r.amountTotal;
  block.tax += r.taxTotal;
};

export interface PartySummaryRow {
  corpNum: string;
  name: string;
  count: number;
  supply: number;
  tax: number;
}

// ── 간주임대료 (임대 보증금 이자상당액 — 과세표준 가산, 신고서 "기타" 란) ──
// 실측(2026 1기 확정 세무법인 명세서 대사): 보증금 × 겹침일수/연일수 × 고시 이자율(3.1%), 건별 원 미만 절사,
// 세액은 총액 × 10% 절사. 이자율은 vat_deposit_interest_rates 시드(§7 T4).

export interface RentalDeposit {
  depositId: string;
  propertyLabel: string;
  tenantName: string;
  tenantCorpNum: string | null;
  depositAmount: number;
  dateFrom: string;
  dateTo: string | null;
  memo: string | null;
  isActive: boolean;
}

export interface DeemedRentItem {
  depositId: string;
  propertyLabel: string;
  tenantName: string;
  depositAmount: number;
  days: number;
  amount: number; // 간주임대료(공급가액)
}

const dayCount = (from: string, to: string) =>
  Math.floor((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000) + 1;

async function computeDeemedRent(period: VatPeriod): Promise<{ rate: number; items: DeemedRentItem[]; supply: number; tax: number }> {
  const db = await getDb();
  const rateRows = rowsToObjects(
    await db.exec(
      `SELECT rate FROM vat_deposit_interest_rates WHERE year <= $1 ORDER BY year DESC LIMIT 1`,
      [period.year],
    ),
  );
  const rate = Number(rateRows[0]?.rate || 0);
  const rows = rowsToObjects(
    await db.exec(
      `SELECT deposit_id, property_label, tenant_name, deposit_amount, date_from, date_to
         FROM rental_deposits
        WHERE is_active = 1 AND date_from <= $2 AND (date_to IS NULL OR date_to >= $1)
        ORDER BY property_label`,
      [period.from, period.to],
    ),
  );
  const daysInYear = period.year % 4 === 0 && (period.year % 100 !== 0 || period.year % 400 === 0) ? 366 : 365;
  const items: DeemedRentItem[] = rows.map((r) => {
    const from = String(r.date_from) > period.from ? String(r.date_from) : period.from;
    const toRaw = r.date_to ? String(r.date_to) : period.to;
    const to = toRaw < period.to ? toRaw : period.to;
    const days = Math.max(0, dayCount(from, to));
    const deposit = Number(r.deposit_amount || 0);
    return {
      depositId: String(r.deposit_id),
      propertyLabel: String(r.property_label),
      tenantName: String(r.tenant_name),
      depositAmount: deposit,
      days,
      amount: Math.floor((deposit * rate * days) / daysInYear),
    };
  });
  const supply = items.reduce((acc, it) => acc + it.amount, 0);
  return { rate, items, supply, tax: Math.floor(supply / 10) }; // 세액 = 총액 × 10% 절사
}

export async function listRentalDeposits(): Promise<RentalDeposit[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT deposit_id, property_label, tenant_name, tenant_corp_num, deposit_amount, date_from, date_to, memo, is_active
         FROM rental_deposits ORDER BY is_active DESC, property_label`,
    ),
  );
  return rows.map((r) => ({
    depositId: String(r.deposit_id),
    propertyLabel: String(r.property_label),
    tenantName: String(r.tenant_name),
    tenantCorpNum: r.tenant_corp_num ? String(r.tenant_corp_num) : null,
    depositAmount: Number(r.deposit_amount || 0),
    dateFrom: String(r.date_from),
    dateTo: r.date_to ? String(r.date_to) : null,
    memo: r.memo ? String(r.memo) : null,
    isActive: Number(r.is_active || 0) === 1,
  }));
}

export async function saveRentalDeposit(input: {
  depositId?: string;
  propertyLabel: string;
  tenantName: string;
  tenantCorpNum?: string | null;
  depositAmount: number;
  dateFrom: string;
  dateTo?: string | null;
  memo?: string | null;
}): Promise<string> {
  const depositId = input.depositId || hashId("rd", `${input.propertyLabel}:${input.tenantName}:${Date.now()}`);
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO rental_deposits (deposit_id, property_label, tenant_name, tenant_corp_num, deposit_amount, date_from, date_to, memo, created_at)
       VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, NULLIF($7, ''), NULLIF($8, ''), $9)
       ON CONFLICT (deposit_id) DO UPDATE SET
         property_label = EXCLUDED.property_label, tenant_name = EXCLUDED.tenant_name,
         tenant_corp_num = EXCLUDED.tenant_corp_num, deposit_amount = EXCLUDED.deposit_amount,
         date_from = EXCLUDED.date_from, date_to = EXCLUDED.date_to, memo = EXCLUDED.memo,
         is_active = 1, updated_at = $9`,
      [
        depositId,
        input.propertyLabel.trim(),
        input.tenantName.trim(),
        String(input.tenantCorpNum ?? "").replace(/[^0-9]/g, ""),
        input.depositAmount,
        input.dateFrom,
        input.dateTo ?? "",
        input.memo ?? "",
        KST_NOW(),
      ],
    );
  });
  return depositId;
}

/** 보증금 비활성(소프트 삭제) — 과거 기수 재계산 보존을 위해 행은 남긴다. */
export async function deactivateRentalDeposit(depositId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`UPDATE rental_deposits SET is_active = 0, updated_at = $2 WHERE deposit_id = $1`, [depositId, KST_NOW()]);
  });
}

export interface VatReturnForm {
  period: VatPeriod;
  // 과세표준 및 매출세액
  sales: {
    invoiceTaxable: AmountBlock; // (1) 세금계산서 발급분 — 과세
    deemedRent: AmountBlock; // (4) 기타 — 간주임대료(보증금 이자상당액)
    invoiceZeroRated: AmountBlock; // (5) 영세율 세금계산서 발급분
    exemptInvoice: AmountBlock; // 면세 계산서 발급분 (부가세 계산 밖 — 과세표준명세 참고)
    total: { supply: number; tax: number }; // (9) 합계
  };
  deemedRentItems: DeemedRentItem[]; // 부동산임대공급가액명세서 근거
  depositInterestRate: number; // 적용 고시 이자율 (예: 0.031)
  // 매입세액
  purchases: {
    invoiceGeneral: AmountBlock; // (10) 세금계산서 수취분 일반매입 (제외 표시 뺀 전체)
    cardDeductible: AmountBlock; // (14) 그밖의 공제 — 신용카드매출전표등 수령명세서 제출분
    nonDeductible: AmountBlock; // (16) 공제받지못할 매입세액 — 세금계산서 수취분 중 불공제 지정
    exemptInvoice: AmountBlock; // 면세 계산서 수취분 (참고)
    totalDeductibleTax: number; // (17) 차감계 세액
  };
  taxDue: number; // 납부(환급)세액 = 매출세액 - 매입 차감계
  manual: { label: string; key: string; amount: number }[]; // 수동 보정(예정고지·전자신고 세액공제·가산세 등)
  finalTaxDue: number; // 차가감 납부할 세액
  salesByParty: PartySummaryRow[]; // 매출처별 세금계산서합계표 (과세+영세)
  purchasesByParty: PartySummaryRow[]; // 매입처별 세금계산서합계표
  cardByMerchant: PartySummaryRow[]; // 신용카드매출전표등 수령명세서 (공제분)
  cardUnclassified: number; // 미분류 카드 건수 (T3 — 0 이 아니면 확정 차단 경고)
  recon: {
    journalSalesCredit: number; // 전표 매출 계정(411+412) 순대변
    reportSalesSupply: number;
    salesDiff: number;
    journalVatInDebit: number; // 전표 부가세대급금(135) 순차변
    reportDeductibleTax: number;
    vatInDiff: number;
  };
  warnings: string[];
  generatedAt: string;
}

const MANUAL_FIELDS: Array<{ key: string; label: string }> = [
  { key: "prepaidNotice", label: "예정고지세액(기납부, 차감)" },
  { key: "prepaidUnrefunded", label: "예정신고 미환급세액(차감)" },
  { key: "etaxCredit", label: "전자신고 세액공제(차감)" },
  { key: "penalty", label: "가산세액(가산)" },
];

function partySummary(rows: VatLedgerRow[]): PartySummaryRow[] {
  const map = new Map<string, PartySummaryRow>();
  for (const r of rows) {
    const key = r.partyCorpNum || "-";
    const cur = map.get(key) ?? { corpNum: key, name: r.partyName ?? "-", count: 0, supply: 0, tax: 0 };
    cur.count += 1;
    cur.supply += r.amountTotal;
    cur.tax += r.taxTotal;
    if (r.partyName) cur.name = r.partyName;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.supply - a.supply);
}

/** 신고서 자동 계산 — 저장하지 않고 계산 결과만 반환(저장은 saveVatReturn). */
export async function buildVatReturn(
  period: VatPeriod,
  manualInput?: Record<string, number>,
): Promise<VatReturnForm> {
  const db = await getDb();
  const ledger = await buildVatLedger({ from: period.from, to: period.to });
  const active = ledger.rows.filter((r) => !r.excluded);
  const sales = active.filter((r) => r.direction === "sales");
  const purchases = active.filter((r) => r.direction === "purchase");

  const form: VatReturnForm = {
    period,
    sales: { invoiceTaxable: emptyBlock(), deemedRent: emptyBlock(), invoiceZeroRated: emptyBlock(), exemptInvoice: emptyBlock(), total: { supply: 0, tax: 0 } },
    deemedRentItems: [],
    depositInterestRate: 0,
    purchases: { invoiceGeneral: emptyBlock(), cardDeductible: emptyBlock(), nonDeductible: emptyBlock(), exemptInvoice: emptyBlock(), totalDeductibleTax: 0 },
    taxDue: 0,
    manual: MANUAL_FIELDS.map((f) => ({ ...f, amount: Number(manualInput?.[f.key] ?? 0) })),
    finalTaxDue: 0,
    salesByParty: [],
    purchasesByParty: [],
    cardByMerchant: [],
    cardUnclassified: 0,
    recon: { journalSalesCredit: 0, reportSalesSupply: 0, salesDiff: 0, journalVatInDebit: 0, reportDeductibleTax: 0, vatInDiff: 0 },
    warnings: [],
    generatedAt: KST_NOW(),
  };

  for (const r of sales) {
    if (r.taxType === 2) addRow(form.sales.invoiceZeroRated, r);
    else if (r.taxType === 3) addRow(form.sales.exemptInvoice, r);
    else addRow(form.sales.invoiceTaxable, r);
  }
  // 간주임대료 — 과세표준 가산 (신고서 4란 기타, 세금계산서 없는 매출)
  const deemed = await computeDeemedRent(period);
  form.depositInterestRate = deemed.rate;
  form.deemedRentItems = deemed.items.filter((it) => it.amount > 0);
  form.sales.deemedRent = { count: form.deemedRentItems.length, supply: deemed.supply, tax: deemed.tax };

  form.sales.total.supply = form.sales.invoiceTaxable.supply + form.sales.invoiceZeroRated.supply + deemed.supply;
  form.sales.total.tax = form.sales.invoiceTaxable.tax + deemed.tax;

  for (const r of purchases) {
    if (r.taxType === 3) {
      addRow(form.purchases.exemptInvoice, r);
      continue;
    }
    addRow(form.purchases.invoiceGeneral, r);
    if (r.vatDeductible === 0) addRow(form.purchases.nonDeductible, r);
  }

  // 카드 매입 공제분 (부가세 보드 집계 재사용 — 승인 건·제외 제거 반영)
  const cardSummary = await getVatSummary({ from: period.from, to: period.to });
  form.purchases.cardDeductible = {
    count: cardSummary.totals.count,
    supply: cardSummary.totals.supplyAmount,
    tax: cardSummary.totals.deductibleTax,
  };
  form.cardUnclassified = cardSummary.unclassified;

  form.purchases.totalDeductibleTax =
    form.purchases.invoiceGeneral.tax - form.purchases.nonDeductible.tax + form.purchases.cardDeductible.tax;
  form.taxDue = form.sales.total.tax - form.purchases.totalDeductibleTax;
  const manualDelta = form.manual.reduce((acc, f) => acc + (f.key === "penalty" ? f.amount : -f.amount), 0);
  // 국고금 단수계산: 납부세액 10원 미만 절사 (실측: 79,741,594 → 납부서 79,741,590)
  const beforeRound = form.taxDue + manualDelta;
  form.finalTaxDue = beforeRound > 0 ? Math.floor(beforeRound / 10) * 10 : beforeRound;

  form.salesByParty = partySummary(sales.filter((r) => r.taxType !== 3));
  form.purchasesByParty = partySummary(purchases.filter((r) => r.taxType !== 3));

  // 신용카드매출전표등 수령명세서 — 가맹점별 공제분
  const cardRows = rowsToObjects(
    await db.exec(
      `SELECT store_corp_num, max(store_name) AS store_name, count(*) AS n,
              COALESCE(SUM(supply_amount), 0) AS supply, COALESCE(SUM(tax_amount), 0) AS tax
         FROM card_transactions
        WHERE approved_at >= $1 AND approved_at <= $2 AND excluded = 0 AND approval_type = '승인'
          AND COALESCE(vat_deductible, 1) = 1 AND COALESCE(tax_amount, 0) > 0
        GROUP BY store_corp_num ORDER BY supply DESC`,
      [`${period.from} 00:00:00`, `${period.to} 23:59:59`],
    ),
  );
  form.cardByMerchant = cardRows.map((r) => ({
    corpNum: r.store_corp_num ? String(r.store_corp_num) : "-",
    name: r.store_name ? String(r.store_name) : "-",
    count: Number(r.n || 0),
    supply: Number(r.supply || 0),
    tax: Number(r.tax || 0),
  }));

  // 원장(전표) ↔ 신고서 대사 (T3)
  const jr = rowsToObjects(
    await db.exec(
      `SELECT
         COALESCE(SUM(CASE WHEN l.account_code IN ('411', '412') THEN l.credit - l.debit END), 0) AS sales_credit,
         COALESCE(SUM(CASE WHEN l.account_code = '135' THEN l.debit - l.credit END), 0) AS vat_in_debit
       FROM journal_lines l
       JOIN journal_entries e ON e.entry_id = l.entry_id
      WHERE e.entry_date >= $1 AND e.entry_date <= $2 AND e.status IN ('auto', 'confirmed')`,
      [period.from, period.to],
    ),
  );
  form.recon.journalSalesCredit = Number(jr[0]?.sales_credit || 0);
  // 간주임대료는 세무상 가산일 뿐 장부 매출이 아니므로 전표 대사에서는 제외
  form.recon.reportSalesSupply = form.sales.total.supply - form.sales.deemedRent.supply + form.sales.exemptInvoice.supply;
  form.recon.salesDiff = form.recon.reportSalesSupply - form.recon.journalSalesCredit;
  form.recon.journalVatInDebit = Number(jr[0]?.vat_in_debit || 0);
  form.recon.reportDeductibleTax = form.purchases.totalDeductibleTax;
  form.recon.vatInDiff = form.recon.reportDeductibleTax - form.recon.journalVatInDebit;

  // 경고 (T3 — 확정 전 반드시 해소해야 할 항목)
  if (!ledger.lastSyncedAt) form.warnings.push("홈택스 수집 이력이 없습니다. 수집 서비스 신청·수집 실행 후 작성하세요.");
  if (sales.length === 0 && purchases.length === 0) form.warnings.push("기간 내 수집된 전자(세금)계산서가 없습니다.");
  if (form.cardUnclassified > 0) form.warnings.push(`미분류 법인카드 매입 ${form.cardUnclassified}건 — 부가세 집계 탭에서 분류를 확정하세요.`);
  const undecided = rowsToObjects(
    await db.exec(
      `SELECT count(*) AS n FROM card_transactions
        WHERE approved_at >= $1 AND approved_at <= $2 AND excluded = 0 AND approval_type = '승인' AND vat_deductible IS NULL`,
      [`${period.from} 00:00:00`, `${period.to} 23:59:59`],
    ),
  );
  const undecidedCount = Number(undecided[0]?.n || 0);
  if (undecidedCount > 0) form.warnings.push(`공제 여부 미판정 카드 매입 ${undecidedCount}건 (공제로 집계 중) — 분류 확정을 권장합니다.`);

  // 카드결제+세금계산서 이중 공제 후보: 같은 기간, 매입 계산서 공급자 = 카드 가맹점
  const dupRows = rowsToObjects(
    await db.exec(
      `SELECT count(DISTINCT h.invoicer_corp_num) AS n
         FROM hometax_tax_invoices h
        WHERE h.direction = 'purchase' AND h.write_date >= $1 AND h.write_date <= $2 AND h.excluded = 0 AND h.tax_type <> 3
          AND EXISTS (
            SELECT 1 FROM card_transactions c
             WHERE c.store_corp_num = h.invoicer_corp_num AND c.excluded = 0 AND c.approval_type = '승인'
               AND COALESCE(c.vat_deductible, 1) = 1
               AND c.approved_at >= $3 AND c.approved_at <= $4
          )`,
      [period.from, period.to, `${period.from} 00:00:00`, `${period.to} 23:59:59`],
    ),
  );
  const dupParties = Number(dupRows[0]?.n || 0);
  if (dupParties > 0)
    form.warnings.push(
      `세금계산서 수취처와 카드 공제 가맹점이 겹치는 거래처 ${dupParties}곳 — 이중 공제 여부를 확인하세요(카드 건 불공제 처리 또는 계산서 제외).`,
    );
  if (Math.abs(form.recon.salesDiff) > 0) form.warnings.push("신고 매출과 전표 매출이 일치하지 않습니다. 대사 카드를 확인하세요.");

  return form;
}

// ── 신고서 저장/확정/조회 ──

export interface VatReturnRecord {
  returnId: string;
  periodYear: number;
  periodTerm: number;
  periodKind: string;
  dateFrom: string;
  dateTo: string;
  status: string;
  form: VatReturnForm;
  memo: string | null;
  createdBy: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  updatedAt: string | null;
}

export async function saveVatReturn(form: VatReturnForm, userId: string): Promise<string> {
  const p = form.period;
  const returnId = hashId("vr", `${p.year}:${p.term}:${p.kind}`);
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO vat_returns (return_id, period_year, period_term, period_kind, date_from, date_to, status, form_json, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7::jsonb, $8, $9, $9)
       ON CONFLICT (period_year, period_term, period_kind) DO UPDATE SET
         form_json = EXCLUDED.form_json, updated_at = EXCLUDED.updated_at,
         status = CASE WHEN vat_returns.status = 'confirmed' THEN 'confirmed' ELSE 'draft' END`,
      [returnId, p.year, p.term, p.kind, p.from, p.to, JSON.stringify(form), userId, KST_NOW()],
    );
  });
  return returnId;
}

/** 확정 — 확정 차단 조건(T3): 미분류 카드 건이 남아 있으면 거부. */
export async function confirmVatReturn(returnId: string, userId: string): Promise<void> {
  await withDbWrite(async (db) => {
    const rows = rowsToObjects(await db.exec(`SELECT form_json, status FROM vat_returns WHERE return_id = $1`, [returnId]));
    if (!rows.length) throw Object.assign(new Error("신고서를 찾을 수 없습니다. 먼저 저장하세요."), { status: 404 });
    const form = (typeof rows[0].form_json === "string" ? JSON.parse(String(rows[0].form_json)) : rows[0].form_json) as VatReturnForm;
    if (form.cardUnclassified > 0) {
      throw Object.assign(new Error(`미분류 카드 매입 ${form.cardUnclassified}건이 남아 있어 확정할 수 없습니다.`), { status: 400 });
    }
    await db.run(
      `UPDATE vat_returns SET status = 'confirmed', confirmed_by = $2, confirmed_at = $3, updated_at = $3 WHERE return_id = $1`,
      [returnId, userId, KST_NOW()],
    );
  });
}

export async function unconfirmVatReturn(returnId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE vat_returns SET status = 'draft', confirmed_by = NULL, confirmed_at = NULL, updated_at = $2 WHERE return_id = $1`,
      [returnId, KST_NOW()],
    );
  });
}

export async function listVatReturns(): Promise<VatReturnRecord[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT return_id, period_year, period_term, period_kind, date_from, date_to, status, form_json, memo,
              created_by, confirmed_by, confirmed_at, updated_at
         FROM vat_returns ORDER BY period_year DESC, period_term DESC, period_kind DESC`,
    ),
  );
  return rows.map((r) => ({
    returnId: String(r.return_id),
    periodYear: Number(r.period_year),
    periodTerm: Number(r.period_term),
    periodKind: String(r.period_kind),
    dateFrom: String(r.date_from),
    dateTo: String(r.date_to),
    status: String(r.status),
    form: (typeof r.form_json === "string" ? JSON.parse(String(r.form_json)) : r.form_json) as VatReturnForm,
    memo: r.memo ? String(r.memo) : null,
    createdBy: r.created_by ? String(r.created_by) : null,
    confirmedBy: r.confirmed_by ? String(r.confirmed_by) : null,
    confirmedAt: r.confirmed_at ? String(r.confirmed_at) : null,
    updatedAt: r.updated_at ? String(r.updated_at) : null,
  }));
}

// ── 경비 점검 리포트 (P5 ⑥ — 동일가맹점 중복·휴일·심야) ──

export interface ExpenseAlertItem {
  approvedAt: string;
  cardAlias: string;
  storeName: string;
  amountTotal: number;
  reason: string;
}

export interface ExpenseAlerts {
  from: string;
  to: string;
  duplicates: ExpenseAlertItem[]; // 같은 날 같은 가맹점 같은 금액 2건 이상
  holiday: ExpenseAlertItem[]; // 주말 사용
  lateNight: ExpenseAlertItem[]; // 22시~06시 사용
}

export async function buildExpenseAlerts(params: { from: string; to: string }): Promise<ExpenseAlerts> {
  const db = await getDb();
  const args = [`${params.from} 00:00:00`, `${params.to} 23:59:59`];
  const base = `FROM card_transactions t JOIN card_registry c ON c.card_id = t.card_id
    WHERE t.approved_at >= $1 AND t.approved_at <= $2 AND t.excluded = 0 AND t.approval_type = '승인'`;

  const dup = rowsToObjects(
    await db.exec(
      `SELECT t.approved_at, COALESCE(c.card_alias, c.card_company_name) AS card_alias, t.store_name, t.amount_total
         ${base}
          AND EXISTS (
            SELECT 1 FROM card_transactions o
             WHERE o.card_txn_id <> t.card_txn_id AND o.excluded = 0 AND o.approval_type = '승인'
               AND COALESCE(o.store_corp_num, o.store_name) = COALESCE(t.store_corp_num, t.store_name)
               AND o.amount_total = t.amount_total
               AND substr(o.approved_at, 1, 10) = substr(t.approved_at, 1, 10)
          )
        ORDER BY t.approved_at DESC LIMIT 100`,
      args,
    ),
  );
  const weekend = rowsToObjects(
    await db.exec(
      `SELECT t.approved_at, COALESCE(c.card_alias, c.card_company_name) AS card_alias, t.store_name, t.amount_total
         ${base}
          AND EXTRACT(dow FROM t.approved_at::timestamp) IN (0, 6)
        ORDER BY t.approved_at DESC LIMIT 100`,
      args,
    ),
  );
  const night = rowsToObjects(
    await db.exec(
      `SELECT t.approved_at, COALESCE(c.card_alias, c.card_company_name) AS card_alias, t.store_name, t.amount_total
         ${base}
          AND length(t.approved_at) >= 13
          AND substr(t.approved_at, 12, 8) <> '00:00:00'
          AND (substr(t.approved_at, 12, 2)::int >= 22 OR substr(t.approved_at, 12, 2)::int < 6)
        ORDER BY t.approved_at DESC LIMIT 100`,
      args,
    ),
  );
  const toItem = (reason: string) => (r: Record<string, unknown>): ExpenseAlertItem => ({
    approvedAt: String(r.approved_at ?? ""),
    cardAlias: String(r.card_alias ?? ""),
    storeName: String(r.store_name ?? ""),
    amountTotal: Number(r.amount_total || 0),
    reason,
  });
  return {
    from: params.from,
    to: params.to,
    duplicates: dup.map(toItem("동일 가맹점·동일 금액 중복")),
    holiday: weekend.map(toItem("휴일 사용")),
    lateNight: night.map(toItem("심야 사용")),
  };
}

// ── 신고 자료 xlsx (신고서 요약 + 합계표 + 카드명세 + 매입매출장) ──

export async function buildVatReturnWorkbook(form: VatReturnForm): Promise<Buffer> {
  const ledger = await buildVatLedger({ from: form.period.from, to: form.period.to });
  const wb = new ExcelJS.Workbook();
  const money = "#,##0";

  const sum = wb.addWorksheet("신고서 요약");
  sum.addRow([`부가가치세 신고 자료 — ${form.period.label}`]);
  sum.getRow(1).font = { bold: true, size: 13 };
  sum.addRow([`과세기간: ${form.period.from} ~ ${form.period.to} · 신고기한: ${form.period.dueDate} · 작성: ${form.generatedAt}`]);
  sum.addRow([]);
  sum.addRow(["구분", "건수", "공급가액", "세액"]).font = { bold: true };
  const rows: Array<[string, number | string, number, number]> = [
    ["매출 · 세금계산서 발급분(과세)", form.sales.invoiceTaxable.count, form.sales.invoiceTaxable.supply, form.sales.invoiceTaxable.tax],
    ["매출 · 기타(간주임대료)", form.sales.deemedRent.count, form.sales.deemedRent.supply, form.sales.deemedRent.tax],
    ["매출 · 영세율 세금계산서", form.sales.invoiceZeroRated.count, form.sales.invoiceZeroRated.supply, 0],
    ["매출 · 면세 계산서(참고)", form.sales.exemptInvoice.count, form.sales.exemptInvoice.supply, 0],
    ["매출세액 합계 (과세표준)", "", form.sales.total.supply, form.sales.total.tax],
    ["매입 · 세금계산서 수취분", form.purchases.invoiceGeneral.count, form.purchases.invoiceGeneral.supply, form.purchases.invoiceGeneral.tax],
    ["매입 · 신용카드 수령분(공제)", form.purchases.cardDeductible.count, form.purchases.cardDeductible.supply, form.purchases.cardDeductible.tax],
    ["매입 · 공제받지못할 매입세액", form.purchases.nonDeductible.count, form.purchases.nonDeductible.supply, -form.purchases.nonDeductible.tax],
    ["매입세액 차감계", "", 0, form.purchases.totalDeductibleTax],
    ["납부(환급)세액", "", 0, form.taxDue],
  ];
  for (const r of rows) sum.addRow(r);
  for (const f of form.manual) if (f.amount) sum.addRow([f.label, "", 0, f.amount]);
  sum.addRow(["차가감 납부할 세액", "", 0, form.finalTaxDue]).font = { bold: true };
  sum.columns.forEach((col, i) => (col.width = i === 0 ? 34 : 16));
  sum.getColumn(3).numFmt = money;
  sum.getColumn(4).numFmt = money;

  const addPartySheet = (title: string, data: PartySummaryRow[]) => {
    const ws = wb.addWorksheet(title);
    ws.addRow(["사업자번호", "상호", "건수", "공급가액", "세액"]).font = { bold: true };
    for (const p of data) ws.addRow([p.corpNum, p.name, p.count, p.supply, p.tax]);
    ws.addRow(["합계", "", data.reduce((a, p) => a + p.count, 0), data.reduce((a, p) => a + p.supply, 0), data.reduce((a, p) => a + p.tax, 0)]).font = { bold: true };
    ws.columns.forEach((col, i) => (col.width = [16, 28, 8, 16, 14][i] ?? 14));
    ws.getColumn(4).numFmt = money;
    ws.getColumn(5).numFmt = money;
  };
  addPartySheet("매출처별 합계표", form.salesByParty);
  addPartySheet("매입처별 합계표", form.purchasesByParty);
  addPartySheet("카드 수령명세", form.cardByMerchant);

  if (form.deemedRentItems.length) {
    const dr = wb.addWorksheet("간주임대료 명세");
    dr.addRow([`부동산임대공급가액명세서 근거 — 적용 이자율 ${(form.depositInterestRate * 100).toFixed(1)}%`]).font = { bold: true };
    dr.addRow(["물건지", "임차인", "보증금", "임대일수", "간주임대료", "세액(총액 기준 절사)"]).font = { bold: true };
    for (const it of form.deemedRentItems) dr.addRow([it.propertyLabel, it.tenantName, it.depositAmount, it.days, it.amount, ""]);
    dr.addRow(["합계", "", "", "", form.sales.deemedRent.supply, form.sales.deemedRent.tax]).font = { bold: true };
    dr.columns.forEach((col, i) => (col.width = [28, 24, 14, 10, 14, 16][i] ?? 14));
    for (const c of [3, 5, 6]) dr.getColumn(c).numFmt = money;
  }

  const led = wb.addWorksheet("매입매출장");
  led.addRow(["작성일", "구분", "유형", "승인번호", "거래처 사업자번호", "거래처", "품목", "공급가액", "세액", "합계", "공제", "비고"]).font = { bold: true };
  const TAX_LABEL: Record<number, string> = { 1: "과세", 2: "영세", 3: "면세" };
  for (const r of ledger.rows) {
    led.addRow([
      r.writeDate,
      r.direction === "sales" ? "매출" : "매입",
      TAX_LABEL[r.taxType] ?? String(r.taxType),
      r.ntsSendKey,
      r.partyCorpNum ?? "",
      r.partyName ?? "",
      r.itemName ?? "",
      r.amountTotal,
      r.taxTotal,
      r.totalAmount,
      r.direction === "purchase" && r.taxType !== 3 ? (r.excluded ? "제외" : r.vatDeductible === 0 ? "불공제" : "공제") : "",
      r.modifyCode ? `수정(${r.modifyCode})` : r.source === "app_issue" ? "앱 발행분" : "",
    ]);
  }
  led.columns.forEach((col, i) => (col.width = [12, 6, 6, 26, 15, 24, 18, 14, 12, 14, 8, 12][i] ?? 12));
  for (const c of [8, 9, 10]) led.getColumn(c).numFmt = money;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
