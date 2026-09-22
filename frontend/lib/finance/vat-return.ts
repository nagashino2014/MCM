// 부가세 신고 엔진 (블루프린트 P5 ②③④⑥) — 매입매출장·신고서 자동 계산·합계표·원장 대사·경비 점검
// 원칙: 원장(hometax_tax_invoices·tax_invoices·card_transactions) 위 파생 계산 — 저장은 vat_returns 스냅뿐.
// 신고 모집단 = 국세청 전송완료 문서(홈택스 수집분 ∪ 앱 발행 전송완료분, 승인번호 dedup).
// 확정·제출은 항상 사람의 명시 액션(§7 T5). 전산매체 파일 생성은 포맷 스펙 실사 후 후속.

import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { getDb, withDbWrite, rowsToObjects, type PgDatabase } from "@/lib/db";
import { getVatSummary, resolveVatCardRows, isVatCardDeductible, vatRelevantLinks, vatTransactionLinkHash } from "@/lib/barobill/vat";
import { loadCardTaxRows } from "@/lib/finance/card-tax";
import { applyCardMerchantCorrections, merchantIdentity } from "@/lib/finance/card-merchant-source";
import { loadTransactionLinkState } from "@/lib/finance/transaction-links";
import { lockAccountingWrite, validateFiscalYear, validateAccountingRange } from "@/lib/finance/write-lock";
import { assertVatFilingSourcesMutable, listVatFilingProtections, vatFilingProtectionOverlaps, vatFilingProtectionReferences } from "./vat-filing-protection";
import { buildVatDuplicateReview, vatDuplicateReviewHash, VAT_DUPLICATE_REVIEW_VERSION, type VatClaimSource, type VatDuplicateReview } from "./vat-duplicate-review";
import type { VatFilingScopeResult } from "./vat-filing-scope";
import { prepareVatReturnBasisSources } from "./vat-return-sources";
import { assertVatFinalizationOpen } from "./vat-finalization-boundary";
import type { VatFollowupCalculation, VatFollowupSelection, ValidatedVatFollowupConsumptionPlan } from "./vat-followup-consumption-types";
import type { VatSameSupplyCalculation, VatSameSupplySelection } from "./vat-same-supply-types";
import { prepareSameSupplyPlan, validateSameSupplyClaims, applySameSupplyAmounts, attachSameSupplyCalculation, sameSupplyLaterDiagnostics } from "./vat-same-supply";

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
  validateFiscalYear(year);
  if (![1, 2].includes(term) || !["pre", "final"].includes(kind)) throw Object.assign(new Error("신고 기수가 올바르지 않습니다."), { status: 400 });
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
  vatDeductible: number | null; // 매입만 의미 (null=미판정, 공제하지 않음)
  excluded: boolean;
  source: "hometax" | "app_issue";
}

export interface VatLedger {
  from: string;
  to: string;
  rows: VatLedgerRow[];
  lastSyncedAt: string | null;
  blockingIssues: { sourceId: string; reason: string }[];
}

/** 기간 매입매출장 — 홈택스 수집분 + 앱 발행 전송완료분(승인번호 dedup). */
export async function buildVatLedger(params: { from: string; to: string; direction?: "sales" | "purchase" }, transaction?: PgDatabase): Promise<VatLedger> {
  const db = transaction ?? await getDb();
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

  const blockingIssues: VatLedger["blockingIssues"] = [];
  // 앱 발행분 중 홈택스 수집에 아직 없는 전송완료 건 (발행 다음날 수집되기 전 최신분 커버)
  if (!params.direction || params.direction === "sales") {
    const seen = new Map(rows.map(r => [r.ntsSendKey, r]));
    const invoiceBasis = (r: VatLedgerRow) => JSON.stringify([r.writeDate,r.direction,r.taxType,r.modifyCode,r.partyCorpNum,r.amountTotal,r.taxTotal,r.totalAmount]);
    const appRows = rowsToObjects(
      await db.exec(
        `SELECT nts_send_key, write_date, tax_type, modify_code, invoicee_corp_num, invoicee_corp_name,
                amount_total, tax_total, total_amount
           FROM tax_invoices
          WHERE direction = 'sales' AND write_date >= $1 AND write_date <= $2
            AND canceled_at IS NULL AND nts_send_state = 4 AND nts_send_key IS NOT NULL`,
        [params.from, params.to],
      ),
    );
    for (const r of appRows) {
      const key = String(r.nts_send_key);
      const candidate: VatLedgerRow = {
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
      };
      const previous = seen.get(key);
      if (previous) {
        if (invoiceBasis(previous) !== invoiceBasis(candidate)) blockingIssues.push({ sourceId: key, reason: "같은 국세청 승인번호의 계산서 원천 내용이 서로 다릅니다. 원천을 대사한 뒤 다시 작성하세요." });
        continue;
      }
      rows.push(candidate);
      seen.set(key, candidate);
    }
    rows.sort((a, b) => a.writeDate.localeCompare(b.writeDate) || a.ntsSendKey.localeCompare(b.ntsSendKey));
  }

  const syncRows = rowsToObjects(
    await db.exec(`SELECT max(finished_at) AS last_ok FROM finance_sync_logs WHERE kind = 'hometax' AND status = 'ok'`),
  );
  return { from: params.from, to: params.to, rows, blockingIssues, lastSyncedAt: (syncRows[0]?.last_ok as string | null) ?? null };
}

// ── 매입 공제/제외 수정 ──

export async function updateHometaxInvoice(
  htiId: string,
  patch: { vatDeductible?: number | null; excluded?: boolean; memo?: string | null },
): Promise<void> {
  if (patch.vatDeductible !== undefined && patch.vatDeductible !== null && patch.vatDeductible !== 0 && patch.vatDeductible !== 1) throw Object.assign(new Error("공제 판정은 공제(1), 불공제(0), 미판정(null) 중 하나여야 합니다."), { status: 400 });
  if (patch.excluded !== undefined && typeof patch.excluded !== "boolean") throw Object.assign(new Error("제외 여부가 올바르지 않습니다."), { status: 400 });
  await withDbWrite(async (db) => {
    await lockAccountingWrite(db);
    const current = rowsToObjects(await db.exec("SELECT hti_id,nts_send_key,write_date,vat_deductible,excluded FROM hometax_tax_invoices WHERE hti_id=$1 FOR UPDATE", [htiId]))[0];
    if (!current) return;
    const currentDeductible = current.vat_deductible == null ? null : Number(current.vat_deductible);
    const changesEvidence = (patch.vatDeductible !== undefined && patch.vatDeductible !== currentDeductible)
      || (patch.excluded !== undefined && Number(current.excluded ?? 0) !== Number(patch.excluded));
    if (changesEvidence) {
      const aliases = current.nts_send_key ? rowsToObjects(await db.exec("SELECT invoice_id FROM tax_invoices WHERE nts_send_key=$1", [current.nts_send_key])) : [];
      await assertVatFilingSourcesMutable(db, { dates: [String(current.write_date ?? "")], refs: [{ kind: "hometax", id: htiId }, ...aliases.map(row => ({ kind: "tax_invoice", id: String(row.invoice_id) }))], origins: ["external_filing", "basis_snapshot"] });
    }
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
  }, { accountingSnapshot: true });
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

async function computeDeemedRent(period: VatPeriod, transaction?: PgDatabase): Promise<{ rate: number; items: DeemedRentItem[]; supply: number; tax: number }> {
  const db = transaction ?? await getDb();
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
        ORDER BY property_label, deposit_id`,
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

/** A deposit can straddle a protected period even when neither endpoint lies in it. */
async function assertRentalDepositEvidenceMutable(db: PgDatabase, depositId: string, ranges: Array<{ from: string; to: string }>): Promise<void> {
  for (const range of ranges) validateAccountingRange(range.from, range.to);
  const protections = await listVatFilingProtections(db, { origins: ["external_filing", "basis_snapshot"] });
  const blocked = protections.filter(protection => ranges.some(range => vatFilingProtectionOverlaps(protection, range.from, range.to))
    || vatFilingProtectionReferences(protection, [{ kind: "deemed_rent", id: depositId }]));
  if (blocked.length) throw Object.assign(new Error("확인된 신고 접수 또는 봉인된 신고 근거 기간에 영향을 주는 임대보증금입니다. 과거 근거를 보존하는 후행 검토가 필요합니다."), { status: 409, code: "vat_filing_protected", protectionIds: blocked.map(item => item.id) });
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
    await lockAccountingWrite(db);
    const current = rowsToObjects(await db.exec("SELECT deposit_id,property_label,tenant_name,deposit_amount,date_from,date_to,is_active FROM rental_deposits WHERE deposit_id=$1 FOR UPDATE", [depositId]))[0];
    const nextTo = input.dateTo || null;
    const changesEvidence = !current || Number(current.is_active) !== 1 || String(current.property_label) !== input.propertyLabel.trim()
      || String(current.tenant_name) !== input.tenantName.trim() || Number(current.deposit_amount) !== input.depositAmount
      || String(current.date_from) !== input.dateFrom || (current.date_to == null ? null : String(current.date_to)) !== nextTo;
    if (changesEvidence) {
      const ranges = [{ from: input.dateFrom, to: nextTo ?? "9999-12-31" }];
      if (current && Number(current.is_active) === 1) ranges.push({ from: String(current.date_from), to: current.date_to == null ? "9999-12-31" : String(current.date_to) });
      await assertRentalDepositEvidenceMutable(db, depositId, ranges);
    }
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
  }, { accountingSnapshot: true });
  return depositId;
}

/** 보증금 비활성(소프트 삭제) — 과거 기수 재계산 보존을 위해 행은 남긴다. */
export async function deactivateRentalDeposit(depositId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await lockAccountingWrite(db);
    const current = rowsToObjects(await db.exec("SELECT date_from,date_to,is_active FROM rental_deposits WHERE deposit_id=$1 FOR UPDATE", [depositId]))[0];
    if (!current || Number(current.is_active) !== 1) return;
    await assertRentalDepositEvidenceMutable(db, depositId, [{ from: String(current.date_from), to: current.date_to == null ? "9999-12-31" : String(current.date_to) }]);
    await db.run(`UPDATE rental_deposits SET is_active = 0, updated_at = $2 WHERE deposit_id = $1`, [depositId, KST_NOW()]);
  }, { accountingSnapshot: true });
}

export interface VatReturnForm {
  filingBasis?: {
    version: "vat-return-basis-v1" | "vat-return-basis-v2" | "vat-return-basis-v3"; basisSnapshotId: string; subjectId: string; scopeHash: string;
    mode: "unknown" | "preliminary" | "notice"; noticeDeduction: number;
    calculationHash: string; verificationStatus: "complete" | "blocked";
    sourceManifest: unknown; sourceManifestHash: string; priorClaims: VatClaimSource[];
    priorReportedSalesSupply: number; priorReportedClaimedTax: number;
    payment: VatFilingScopeResult["payment"];
    legacyArchives?: Array<{returnId:string;from:string;to:string;status:"preserved_not_filing_evidence";sourceStatus:"unchanged"|"changed"|"unavailable"}>;
  };
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
    invoiceUndecided: AmountBlock; // 미판정 세금계산서 — 공제에서 보류
    cardUndecided: AmountBlock; // 카드 검토 대기 — 공제에서 보류
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
  blockingIssues: { sourceId: string; reason: string }[];
  sourceEvidence: { version: "g03b-v1"; cardSourceHash: string; linkSourceHash: string; sourceHash: string; duplicateReviewVersion?: typeof VAT_DUPLICATE_REVIEW_VERSION; duplicateReviewHash?: string };
  duplicateReview?: VatDuplicateReview;
  followupConsumption?: VatFollowupCalculation;
  sameSupplyConsumption?: VatSameSupplyCalculation;
  ledgerSnapshot: VatLedger; // 다운로드도 같은 계산 시점의 원천을 사용
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
  transaction?: PgDatabase,
  basis?: {basisSnapshotId: string; scope: VatFilingScopeResult},
  selection?: VatFollowupSelection,
  sameSupply?: VatSameSupplySelection,
): Promise<VatReturnForm> {
  if (!transaction) return withDbWrite(async db => {
    await lockAccountingWrite(db);
    return buildVatReturn(period, manualInput, db, basis, selection, sameSupply);
  }, {accountingSnapshot:true});
  const db = transaction;
  period = vatPeriod(period.year, period.term, period.kind);
  if (sameSupply && (!basis || period.kind !== 'final')) throw Object.assign(new Error('같은 공급 공제 조정은 봉인 근거가 있는 확정신고에서만 지원합니다.'), {status:400,code:'vat_same_supply_input'});
  if (selection && period.kind !== "final") throw Object.assign(new Error("후행 검토는 같은 반기의 확정 신고에만 적용할 수 있습니다."), { status: 400, code: "vat_followup_selection_invalid" });
  if (basis) {
    if (!basis.scope.canCalculate || basis.scope.year!==period.year || basis.scope.term!==period.term || basis.scope.kind!==(period.kind==='pre'?'preliminary':'final')) throw Object.assign(new Error("신고 근거와 계산 기간이 일치하지 않습니다."),{status:409});
    period = {...period, from:basis.scope.dateFrom,to:basis.scope.dateTo,label:`${period.year}년 ${period.term}기 ${period.kind==='pre'?'예정':'확정'} (${basis.scope.dateFrom}~${basis.scope.dateTo})`};
  }
  const manualFields = basis ? MANUAL_FIELDS.filter(f=>['etaxCredit','penalty'].includes(f.key)) : MANUAL_FIELDS;
  if (manualInput && (typeof manualInput !== "object" || Array.isArray(manualInput) || Object.entries(manualInput).some(([key, value]) => !manualFields.some(f => f.key === key) || !Number.isSafeInteger(value) || value < 0))) throw Object.assign(new Error(basis ? "예정고지·미환급액은 자유 입력할 수 없습니다. 허용된 보정 항목의 0 이상 원 단위 정수만 입력하세요." : "수동 보정은 알려진 항목의 0 이상 원 단위 정수로 입력하세요."), { status: 400 });
  let ledger = await buildVatLedger({ from: period.from, to: period.to }, db);
  const transactionLinks = await loadTransactionLinkState(db);
  let cardRows = await loadCardTaxRows(db, {from:period.from,to:period.to});
  const populationCards = resolveVatCardRows(cardRows,transactionLinks);
  const reconciled = basis ? prepareVatReturnBasisSources({scope:basis.scope,ledger,cards:populationCards,transactionLinks}) : null;
  if (reconciled) {
    ledger = {...ledger,rows:reconciled.ledgerRows,blockingIssues:[...ledger.blockingIssues,...reconciled.issues]};
    cardRows=cardRows.filter(r=>!reconciled.cardIdsToExclude.includes(String(r.card_txn_id)));
  }
  const active = ledger.rows.filter((r) => !r.excluded);
  const sales = active.filter((r) => r.direction === "sales");
  const purchases = active.filter((r) => r.direction === "purchase");

  const form: VatReturnForm = {
    period,
    sales: { invoiceTaxable: emptyBlock(), deemedRent: emptyBlock(), invoiceZeroRated: emptyBlock(), exemptInvoice: emptyBlock(), total: { supply: 0, tax: 0 } },
    deemedRentItems: [],
    depositInterestRate: 0,
    purchases: { invoiceGeneral: emptyBlock(), cardDeductible: emptyBlock(), nonDeductible: emptyBlock(), invoiceUndecided: emptyBlock(), cardUndecided: emptyBlock(), exemptInvoice: emptyBlock(), totalDeductibleTax: 0 },
    taxDue: 0,
    manual: manualFields.map((f) => ({ ...f, amount: Number(manualInput?.[f.key] ?? 0) })),
    finalTaxDue: 0,
    salesByParty: [],
    purchasesByParty: [],
    cardByMerchant: [],
    cardUnclassified: 0,
    blockingIssues: [...ledger.blockingIssues],
    sourceEvidence: { version: "g03b-v1", cardSourceHash: "", linkSourceHash: "", sourceHash: "" },
    ledgerSnapshot: ledger,
    recon: { journalSalesCredit: 0, reportSalesSupply: 0, salesDiff: 0, journalVatInDebit: 0, reportDeductibleTax: 0, vatInDiff: 0 },
    warnings: [],
    generatedAt: KST_NOW(),
  };

  if (basis && reconciled) form.filingBasis={version:'vat-return-basis-v1',basisSnapshotId:basis.basisSnapshotId,subjectId:basis.scope.subjectId,
    scopeHash:basis.scope.scopeHash,mode:basis.scope.mode,noticeDeduction:basis.scope.noticeDeduction!,calculationHash:'',verificationStatus:'blocked',
    sourceManifest:reconciled.manifest,sourceManifestHash:reconciled.sourceHash,priorClaims:reconciled.priorClaims,
    priorReportedSalesSupply:basis.scope.excludedSources.filter(s=>s.direction==='sales').reduce((n,s)=>n+s.supply,0),
    priorReportedClaimedTax:basis.scope.excludedSources.reduce((n,s)=>n+s.claimedTax,0),payment:basis.scope.payment};
  for (const r of sales) {
    if (r.taxType === 2) addRow(form.sales.invoiceZeroRated, r);
    else if (r.taxType === 3) addRow(form.sales.exemptInvoice, r);
    else addRow(form.sales.invoiceTaxable, r);
  }
  // 간주임대료 — 과세표준 가산 (신고서 4란 기타, 세금계산서 없는 매출)
  const deemed = await computeDeemedRent(period, db);
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
    else if (r.vatDeductible !== 1) {
      addRow(form.purchases.invoiceUndecided, r);
      form.blockingIssues.push({ sourceId: r.htiId ?? r.ntsSendKey, reason: "매입 계산서의 공제 여부를 판정하세요." });
    }
  }

  // 카드 매입 공제분 (부가세 보드 집계 재사용 — 승인 건·제외 제거 반영)
  const vatCardRows = resolveVatCardRows(cardRows, transactionLinks);
  const cardSummary = await getVatSummary({ from: period.from, to: period.to }, db, cardRows, transactionLinks);
  form.purchases.cardDeductible = {
    count: cardSummary.totals.deductibleCount,
    supply: cardSummary.totals.deductibleSupply,
    tax: cardSummary.totals.deductibleTax,
  };
  form.purchases.cardUndecided = { count: cardSummary.totals.undecidedCount, supply: cardSummary.totals.undecidedSupply, tax: cardSummary.totals.undecidedTax };
  form.cardUnclassified = cardSummary.unclassified;
  form.blockingIssues.push(...cardSummary.blockingIssues.map(r => ({ sourceId: r.cardTxnId, reason: r.reason })));
  if (form.cardUnclassified) form.blockingIssues.push({ sourceId: "card-category", reason: `카드 계정과목 미분류 ${form.cardUnclassified}건` });
  form.sourceEvidence.cardSourceHash = cardSummary.sourceHash;
  form.sourceEvidence.linkSourceHash = cardSummary.linkSourceHash;
  const periodLinks = vatRelevantLinks(transactionLinks, {from: period.from, to: period.to});
  for (const link of periodLinks.filter(link => link.relation === "manual_invoice" && !link.valid)) {
    form.blockingIssues.push(...link.issues.map(issue => ({ sourceId: link.id, reason: issue.message })));
  }

  form.purchases.totalDeductibleTax =
    form.purchases.invoiceGeneral.tax - form.purchases.nonDeductible.tax - form.purchases.invoiceUndecided.tax + form.purchases.cardDeductible.tax;
  form.taxDue = form.sales.total.tax - form.purchases.totalDeductibleTax;
  const manualDelta = form.manual.reduce((acc, f) => acc + (f.key === "penalty" ? f.amount : -f.amount), 0);
  // 국고금 단수계산: 납부세액 10원 미만 절사 (실측: 79,741,594 → 납부서 79,741,590)
  const beforeRound = form.taxDue + manualDelta - (basis?.scope.noticeDeduction ?? 0);
  form.finalTaxDue = beforeRound > 0 ? Math.floor(beforeRound / 10) * 10 : beforeRound;

  form.salesByParty = partySummary(sales.filter((r) => r.taxType !== 3));
  form.purchasesByParty = partySummary(purchases.filter((r) => r.taxType !== 3));

  // 신용카드매출전표등 수령명세서 — 가맹점별 공제분
  const merchants = new Map<string, PartySummaryRow>();
  for (const r of vatCardRows.filter(isVatCardDeductible)) {
    const key = String(r.store_corp_num || "-");
    const item = merchants.get(key) ?? { corpNum: key, name: String(r.store_name || "-"), count: 0, supply: 0, tax: 0 };
    item.count += 1;
    item.supply += r.vatResidual.supply;
    item.tax += r.vatResidual.tax;
    merchants.set(key, item);
  }
  form.cardByMerchant = [...merchants.values()].sort((a, b) => b.supply - a.supply || a.corpNum.localeCompare(b.corpNum));

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
  form.recon.reportSalesSupply = form.sales.total.supply - form.sales.deemedRent.supply + form.sales.exemptInvoice.supply + (form.filingBasis?.priorReportedSalesSupply ?? 0);
  form.recon.salesDiff = form.recon.reportSalesSupply - form.recon.journalSalesCredit;
  form.recon.journalVatInDebit = Number(jr[0]?.vat_in_debit || 0);
  form.recon.reportDeductibleTax = form.purchases.totalDeductibleTax + (form.filingBasis?.priorReportedClaimedTax ?? 0);
  form.recon.vatInDiff = form.recon.reportDeductibleTax - form.recon.journalVatInDebit;

  // 경고 (T3 — 확정 전 반드시 해소해야 할 항목)
  if (!ledger.lastSyncedAt) form.warnings.push("홈택스 수집 이력이 없습니다. 수집 서비스 신청·수집 실행 후 작성하세요.");
  if (sales.length === 0 && purchases.length === 0) form.warnings.push("기간 내 수집된 전자(세금)계산서가 없습니다.");
  if (form.cardUnclassified > 0) form.warnings.push(`미분류 법인카드 매입 ${form.cardUnclassified}건 — 부가세 집계 탭에서 분류를 확정하세요.`);
  if (form.purchases.cardUndecided.count) form.warnings.push(`공제 여부 미판정 카드 ${form.purchases.cardUndecided.count}건 — 공제에서 보류됩니다.`);
  if (form.purchases.invoiceUndecided.count) form.warnings.push(`공제 여부 미판정 매입 계산서 ${form.purchases.invoiceUndecided.count}건 — 공제에서 보류됩니다.`);
  // Supplier overlap is a review requirement, never a same-supply finding or an amount adjustment.
  const sourceMap = new Map(transactionLinks.sources.map(source => [source.key, source]));
  const claimSources = (invoices: VatLedgerRow[], cards: typeof vatCardRows): VatClaimSource[] => [
    ...invoices.filter(r => !r.excluded && r.direction === "purchase" && r.taxType !== 3 && r.vatDeductible === 1).map(r => ({
      kind: "hometax" as const, sourceId: r.htiId ?? r.ntsSendKey, canonicalKey: `invoice:${r.ntsSendKey}`,
      partyCorpNum: r.partyCorpNum, partyName: r.partyName ?? "-", date: r.writeDate,
      supply: r.amountTotal, tax: r.taxTotal, total: r.totalAmount,
      sourceHash: sourceMap.get(`hometax:${r.htiId}`)?.sourceHash ?? createHash("sha256").update(JSON.stringify(r)).digest("hex"), origin: "current" as const,
    })),
    ...cards.filter(isVatCardDeductible).map(r => ({
      kind: "card" as const, sourceId: String(r.card_txn_id), canonicalKey: `card:${String(r.card_txn_id)}`,
      partyCorpNum: r.store_corp_num == null ? null : String(r.store_corp_num), partyName: String(r.store_name || "-"), date: r.taxDate,
      supply: r.vatResidual.supply, tax: r.vatResidual.tax, total: r.vatResidual.total,
      sourceHash: sourceMap.get(`card:${String(r.card_txn_id)}`)?.sourceHash ?? createHash("sha256").update(JSON.stringify(r)).digest("hex"), origin: "current" as const,
    })),
  ];
  const halfFrom = `${period.year}-${period.term === 1 ? "01" : "07"}-01`;
  const halfTo = `${period.year}-${period.term === 1 ? "06-30" : "12-31"}`;
  const historicalRows = basis ? [] : rowsToObjects(await db.exec(
    "SELECT return_id, date_from, date_to, form_json FROM vat_returns WHERE status='confirmed' AND date_from >= $1 AND date_to <= $2 AND NOT (period_year=$3 AND period_term=$4 AND period_kind=$5) ORDER BY return_id",
    [halfFrom, halfTo, period.year, period.term, period.kind],
  ));
  const halfLedger = await buildVatLedger({ from: halfFrom, to: halfTo, direction: "purchase" }, db);
  const halfCards = resolveVatCardRows(await loadCardTaxRows(db, { from: halfFrom, to: halfTo }), transactionLinks);
  const followupPlan: ValidatedVatFollowupConsumptionPlan | undefined = selection
    ? await (await import("./vat-followup-consumption")).prepareVatFollowupConsumption(db, {
      subjectId: selection.subjectId, year: period.year, term: period.term, kind: "final", path: basis ? "basis" : "legacy", basisSnapshotId: basis?.basisSnapshotId ?? null,
    }, selection) : undefined;
  const rawClaims = claimSources(purchases, vatCardRows);
  const samePlan = sameSupply ? await prepareSameSupplyPlan(db, basis!.basisSnapshotId, sameSupply) : undefined;
  if (samePlan) validateSameSupplyClaims(samePlan, rawClaims, reconciled?.priorClaims ?? []);
  form.duplicateReview = buildVatDuplicateReview({
    from: halfFrom, to: halfTo, currentFrom: period.from, currentTo: period.to,
    currentClaims: rawClaims, liveHalfClaims: claimSources(halfLedger.rows, halfCards), links: transactionLinks.links,
    reconciledPriorClaims: reconciled?.priorClaims,
    followupPlan,
    sameSupplyPlan: samePlan,
    unresolvedHalfSources: [
      ...halfLedger.rows.filter(r => !r.excluded && r.taxType !== 3 && r.vatDeductible == null).map(r => ({ date: r.writeDate, sourceId: r.htiId ?? r.ntsSendKey, reason: "매입 계산서 공제 여부 미판정" })),
      ...halfCards.filter(r => r.vatIssues.length > 0 || r.vatState === "undecided" && [r.vatResidual.supply, r.vatResidual.tax, r.vatResidual.total].some(n => n !== 0)).map(r => ({ date: r.taxDate, sourceId: String(r.card_txn_id), reason: r.vatIssues.join(" ") || "카드 공제 여부 미판정" })),
    ],
    confirmed: historicalRows.map(r => {
      let value: unknown = r.form_json;
      if (typeof value === "string") { try { value = JSON.parse(value); } catch { value = null; } }
      const from = String(r.date_from).slice(0, 10), to = String(r.date_to).slice(0, 10);
      return { returnId: String(r.return_id), from, to, form: value, currentLinkSourceHash: vatTransactionLinkHash(transactionLinks, { from, to }) };
    }),
  });
  if (selection) {
    const selected = selection.pairs.map(p => JSON.stringify([p.revisionId, p.pairKey])).sort();
    const applied = form.duplicateReview.candidateGroups.flatMap(g => g.resolutionReviewPairs ?? []).map(p => JSON.stringify([p.revisionId, p.pairKey])).sort();
    if (new Set(selected).size !== selected.length || JSON.stringify(selected) !== JSON.stringify(applied)) {
      throw Object.assign(new Error("선택한 후행 검토가 현재 미해소 원천 쌍과 정확히 일치하지 않습니다. 이미 해소된 쌍·다른 기간·변경된 근거를 확인하세요."), { status: 409, code: "vat_followup_selection_invalid" });
    }
  }
  for (const group of form.duplicateReview.candidateGroups.filter(g => g.status === "pending")) form.blockingIssues.push({ sourceId: group.id, reason: `${group.partyName}: ${group.reason}` });
  for (const reason of form.duplicateReview.historyIssues) form.blockingIssues.push({ sourceId: "prior-vat-evidence", reason });
  if (samePlan) applySameSupplyAmounts(form, samePlan, rawClaims);
  form.sourceEvidence.duplicateReviewVersion = VAT_DUPLICATE_REVIEW_VERSION;
  form.sourceEvidence.duplicateReviewHash = vatDuplicateReviewHash(form.duplicateReview);
  if (Math.abs(form.recon.salesDiff) > 0) form.warnings.push("신고 매출과 전표 매출이 일치하지 않습니다. 대사 카드를 확인하세요.");

  form.sourceEvidence.sourceHash = createHash("sha256").update(JSON.stringify({ period, ledger: ledger.rows, deemed, cardSourceHash: cardSummary.sourceHash, duplicateReviewHash: form.sourceEvidence.duplicateReviewHash })).digest("hex");
  if (form.filingBasis) {
    const archived=rowsToObjects(await db.exec("SELECT return_id,date_from,date_to,form_json FROM vat_returns WHERE status='confirmed' AND date_from<=$2 AND date_to>=$1 ORDER BY return_id",[halfFrom,halfTo]));
    form.filingBasis.legacyArchives=archived.map(r=>{
      let old:any;try{old=typeof r.form_json==='string'?JSON.parse(r.form_json):r.form_json;}catch{old=null;}
      const claims=old?.duplicateReview?.claimSources;
      const sourceStatus=!Array.isArray(claims)?'unavailable' as const:claims.some((s:any)=>sourceMap.get(`${s.kind}:${s.sourceId}`)?.sourceHash!==s.sourceHash)?'changed' as const:'unchanged' as const;
      return {returnId:String(r.return_id),from:String(r.date_from),to:String(r.date_to),status:'preserved_not_filing_evidence' as const,sourceStatus};
    });
    if(archived.length)form.warnings.push('기존 내부 확정본은 보존하며 외부 신고 접수 근거로 사용하지 않았습니다. 기존 원천의 변경·검증 불가 여부는 신고 근거 자료를 확인하세요.');
    if(basis!.scope.priorPeriodCoverage.length)form.warnings.push('전표 대사는 이번 신고와 기신고 실적을 합한 반기 전체 금액을 비교합니다. 기신고 부분 공제 차이 등은 별도 대사해야 합니다.');
  }
  if (basis && basis.scope.priorPeriodCoverage.length && deemed.items.length) form.blockingIssues.push({sourceId:'prior-deemed-rent',reason:'기신고 간주임대료의 기간별 원천 대사가 필요합니다. B2에서 반기액을 자동 가산하지 않습니다.'});
  if (basis && !ledger.lastSyncedAt) form.blockingIssues.push({sourceId:'collection-evidence',reason:'수집 성공 이력이 없어 현재 원천 모집단을 확인할 수 없습니다.'});
  if (basis && !sales.length && !purchases.length && !populationCards.length && !basis.scope.excludedSources.length && !deemed.items.length) form.blockingIssues.push({sourceId:'empty-live-population',reason:'현재 무실적 신고의 모집단 확인 절차가 필요합니다. 빈 수집 결과만으로 확정하지 않습니다.'});
  if (basis) form.blockingIssues.push(...await sameSupplyLaterDiagnostics(db,basis.scope.subjectId,period.from,period.to));
  if (form.filingBasis) form.filingBasis.verificationStatus=form.blockingIssues.length?'blocked':'complete';
  if (followupPlan) await (await import("./vat-followup-consumption")).attachVatFollowupCalculation(form, followupPlan);
  if (samePlan) attachSameSupplyCalculation(form, samePlan, rawClaims);
  return form;
}

// ── 신고서 저장/확정/조회 ──

export interface VatReturnRecord {
  origin?: "legacy" | "basis_return";
  basisSnapshotId?: string;
  revision?: number;
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

/** 서버가 같은 잠금·트랜잭션에서 다시 계산하므로 호출자가 넘긴 세액은 신뢰하지 않는다. */
export async function saveVatReturnDraft(period: VatPeriod, manual: Record<string, number> | undefined, userId: string, selection?: VatFollowupSelection): Promise<{ returnId: string; form: VatReturnForm }> {
  return withDbWrite(async db => {
    await lockAccountingWrite(db);
    const p = vatPeriod(period.year, period.term, period.kind);
    const existing = rowsToObjects(await db.exec("SELECT status FROM vat_returns WHERE period_year=$1 AND period_term=$2 AND period_kind=$3 FOR UPDATE", [p.year, p.term, p.kind]));
    if (existing[0]?.status === "confirmed") throw Object.assign(new Error("확정된 신고서는 덮어쓸 수 없습니다. 확정을 취소한 뒤 다시 저장하세요."), { status: 409 });
    await assertVatFinalizationOpen(db, { subjectId: null, year: p.year, term: p.term, kind: p.kind, path: "legacy" });
    const form = await buildVatReturn(p, manual, db, undefined, selection);
    const saved = rowsToObjects(await db.exec(
      `INSERT INTO vat_returns (return_id, period_year, period_term, period_kind, date_from, date_to, status, form_json, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7::jsonb, $8, $9, $9)
       ON CONFLICT (period_year, period_term, period_kind) DO UPDATE SET
         form_json = EXCLUDED.form_json, updated_at = EXCLUDED.updated_at, status = 'draft'
       WHERE vat_returns.status <> 'confirmed' RETURNING return_id`,
      [hashId("vr", `${p.year}:${p.term}:${p.kind}`), p.year, p.term, p.kind, p.from, p.to, JSON.stringify(form), userId, KST_NOW()],
    ));
    if (!saved.length) throw Object.assign(new Error("확정된 신고서는 덮어쓸 수 없습니다."), { status: 409 });
    return { returnId: String(saved[0].return_id), form };
  }, {accountingSnapshot:true});
}

export async function saveVatReturn(form: VatReturnForm, userId: string): Promise<string> {
  const selection = form.followupConsumption ? (await import("./vat-followup-consumption")).selectionFromVatFollowupForm(form) : undefined;
  return (await saveVatReturnDraft(form.period, Object.fromEntries(form.manual.map(f => [f.key, f.amount])), userId, selection)).returnId;
}

/** JSONB key 순서나 수집 시각만 바뀐 것은 세액 변경으로 보지 않는다. */
function comparableForm(form: VatReturnForm): string {
  const { generatedAt: _generatedAt, warnings: _warnings, ledgerSnapshot, ...calculation } = form;
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, stable(v)])) : value;
  return JSON.stringify(stable({ ...calculation, ledgerRows: ledgerSnapshot?.rows }));
}

/** 확정 — 확정 차단 조건(T3): 미분류 카드 건이 남아 있으면 거부. */
export async function confirmVatReturn(returnId: string, userId: string): Promise<void> {
  for (let attempt = 0; ; attempt++) try {
    await withDbWrite(async (db) => {
      await lockAccountingWrite(db);
      const rows = rowsToObjects(await db.exec(`SELECT form_json, status, period_year, period_term, period_kind FROM vat_returns WHERE return_id = $1 FOR UPDATE`, [returnId]));
      if (!rows.length) throw Object.assign(new Error("신고서를 찾을 수 없습니다. 먼저 저장하세요."), { status: 404 });
      if (rows[0].status === "confirmed") return;
      const form = (typeof rows[0].form_json === "string" ? JSON.parse(String(rows[0].form_json)) : rows[0].form_json) as VatReturnForm;
      if (form.sourceEvidence?.version !== "g03b-v1" || !form.ledgerSnapshot || form.sourceEvidence.duplicateReviewVersion !== VAT_DUPLICATE_REVIEW_VERSION || form.duplicateReview?.version !== VAT_DUPLICATE_REVIEW_VERSION) throw Object.assign(new Error("이전 형식의 초안입니다. 현재 원천으로 다시 계산하여 저장한 뒤 확정하세요."), { status: 409 });
      const period = vatPeriod(Number(rows[0].period_year), Number(rows[0].period_term) as 1 | 2, String(rows[0].period_kind) as "pre" | "final");
      await assertVatFinalizationOpen(db, { subjectId: null, year: period.year, term: period.term, kind: period.kind, path: "legacy" });
      const selection = form.followupConsumption ? (await import("./vat-followup-consumption")).selectionFromVatFollowupForm(form) : undefined;
      const current = await buildVatReturn(period, Object.fromEntries(form.manual.map(f => [f.key, f.amount])), db, undefined, selection);
      if (current.blockingIssues.length) throw Object.assign(new Error(`검토가 끝나지 않아 확정할 수 없습니다: ${current.blockingIssues.slice(0, 3).map(r => r.reason).join(" ")}`), { status: 409 });
      if (comparableForm(form) !== comparableForm(current)) throw Object.assign(new Error("원천 자료 또는 계산 결과가 변경되었습니다. 다시 계산하여 초안을 저장한 뒤 확정하세요."), { status: 409 });
      await db.run(
        `UPDATE vat_returns SET status = 'confirmed', confirmed_by = $2, confirmed_at = $3, updated_at = $3 WHERE return_id = $1`,
        [returnId, userId, KST_NOW()],
      );
      if (form.followupConsumption) await (await import("./vat-followup-consumption")).persistVatFollowupConsumption(db, form, { path: "legacy", returnId }, userId);
    }, {accountingSnapshot:true});
    return;
  } catch (error) {
    if (["40001", "40P01"].includes(String((error as { code?: string }).code))) {
      if (attempt < 2) continue;
      throw Object.assign(new Error("확정 중 신고 자료가 변경되었습니다. 최신 저장본을 확인한 뒤 다시 확정하세요."), { status: 409, code: "vat_return_concurrent_change" });
    }
    if (["23514", "23503", "23505"].includes(String((error as { code?: string }).code))) {
      throw Object.assign(new Error("신고 확정과 후행 검토의 사용 근거가 충돌합니다. 최신 저장본과 과거 참조를 확인하세요."), { status: 409, code: "vat_followup_consumption_conflict" });
    }
    if (["42P01", "42703", "42883", "55000"].includes(String((error as { code?: string }).code))) {
      throw Object.assign(new Error("신고 확정과 후행 검토의 사용 구조를 검증할 수 없습니다. 저장 근거와 마이그레이션236을 확인하세요."), { status: 503, code: "vat_followup_consumption_unavailable" });
    }
    throw error;
  }
}

export async function unconfirmVatReturn(returnId: string): Promise<void> {
  try { await withDbWrite(async (db) => {
    await lockAccountingWrite(db);
    const updated = rowsToObjects(await db.exec(
      `UPDATE vat_returns SET status = 'draft', confirmed_by = NULL, confirmed_at = NULL, updated_at = $2 WHERE return_id = $1 RETURNING return_id`,
      [returnId, KST_NOW()],
    ));
    if (!updated.length) throw Object.assign(new Error("신고서를 찾을 수 없습니다."), { status: 404 });
  }); } catch (error) {
    if (String((error as { code?: string }).code) === "23514") throw Object.assign(new Error("확정 신고에서 사용한 원문은 직접 확정 취소할 수 없습니다. 보관된 신고와 후행 검토의 사용 근거를 확인하세요."), { status: 409, code: "vat_return_consumed" });
    throw error;
  }
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
  verificationIssues: ExpenseAlertItem[]; // 정정 근거 미확인: 중복 여부를 정상 0건으로 표시하지 않는다.
}

export async function buildExpenseAlerts(params: { from: string; to: string }): Promise<ExpenseAlerts> {
  const db = await getDb();
  const args = [`${params.from} 00:00:00`, `${params.to} 23:59:59`];
  const base = `FROM card_transactions t JOIN card_registry c ON c.card_id = t.card_id
    WHERE t.approved_at >= $1 AND t.approved_at <= $2 AND t.excluded = 0 AND t.approval_type = '승인'`;

  const candidates = await applyCardMerchantCorrections(db, rowsToObjects(await db.exec(
    `SELECT t.card_txn_id, t.approved_at, t.store_corp_num, t.store_name, t.amount_total,
            c.card_id AS registry_card_id, COALESCE(c.card_alias, c.card_company_name) AS card_alias
       FROM card_transactions t LEFT JOIN card_registry c ON c.card_id = t.card_id
      WHERE t.approved_at >= $1 AND t.approved_at <= $2 AND t.excluded = 0 AND t.approval_type = '승인'
      ORDER BY t.approved_at DESC`, args,
  )));
  const duplicateKey = (row: Record<string, unknown>) => {
    const party = row.store_corp_num ?? row.store_name;
    return party == null || merchantIdentity(row)?.issues.length ? null : JSON.stringify([party, String(row.approved_at).slice(0, 10), Number(row.amount_total)]);
  };
  const counts = new Map<string, number>();
  for (const row of candidates) { const key = duplicateKey(row); if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1); }
  const dup = candidates.filter(row => row.registry_card_id != null && (counts.get(duplicateKey(row) ?? "") ?? 0) > 1).slice(0, 100);
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
    verificationIssues: candidates.filter(row => merchantIdentity(row)?.issues.length).map(row => toItem(`중복 판단 보류: ${merchantIdentity(row)!.issues.join(" / ")}`)(row)),
  };
}

// ── 신고 자료 xlsx (신고서 요약 + 합계표 + 카드명세 + 매입매출장) ──

export async function buildVatReturnWorkbook(form: VatReturnForm): Promise<Buffer> {
  if (!form.ledgerSnapshot) throw Object.assign(new Error("이전 신고서에는 원천 명세 스냅샷이 없습니다. 현재 자료로 별도 재작성하세요."), { status: 409 });
  const ledger = form.ledgerSnapshot;
  const wb = new ExcelJS.Workbook();
  const money = "#,##0";
  const review = form.duplicateReview;
  const reviewBlocked = (form.blockingIssues?.length ?? 0) > 0 || review?.historyStatus === "unavailable" || review?.candidateGroups.some(g => g.status === "pending");
  const reviewNotice = !review
    ? "이전 형식: 저장·확정 당시 공제 검토 정보가 수집되지 않았습니다. 현재 자료로 과거 검토 상태를 소급하지 않습니다."
    : reviewBlocked ? "검토 보류: 미해소 공제 검토 항목이 있습니다. 표시된 세액은 초안 계산값이며, 공제 검토 시트를 확인하세요."
      : "저장 당시 공제 검토 차단 사유 없음. 현재 원천의 재검증이나 국세청 신고 접수 완료를 뜻하지 않습니다.";

  const sum = wb.addWorksheet("신고서 요약");
  sum.addRow([`부가가치세 신고 자료 — ${form.period.label}`]);
  sum.getRow(1).font = { bold: true, size: 13 };
  sum.addRow([`과세기간: ${form.period.from} ~ ${form.period.to} · 신고기한: ${form.period.dueDate} · 작성: ${form.generatedAt}`]);
  sum.addRow([reviewNotice]);
  sum.mergeCells(3, 1, 3, 4);
  sum.getRow(3).height = 42;
  sum.getCell("A3").alignment = { wrapText: true, vertical: "middle" };
  sum.getRow(3).font = { bold: true, color: { argb: reviewBlocked || !review ? "FF9A6700" : "FF166534" } };
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
    ["매입 · 계산서 미판정(공제 보류)", form.purchases.invoiceUndecided.count, form.purchases.invoiceUndecided.supply, -form.purchases.invoiceUndecided.tax],
    ["카드 · 미판정(참고, 공제 미포함)", form.purchases.cardUndecided.count, form.purchases.cardUndecided.supply, form.purchases.cardUndecided.tax],
    ["매입세액 차감계", "", 0, form.purchases.totalDeductibleTax],
    ["납부(환급)세액", "", 0, form.taxDue],
  ];
  for (const r of rows) sum.addRow(r);
  for (const f of form.manual) if (f.amount) sum.addRow([f.label, "", 0, f.amount]);
  if (form.filingBasis) sum.addRow(["예정고지세액(확인된 근거 차감)", "", 0, -form.filingBasis.noticeDeduction]);
  sum.addRow(["차가감 납부할 세액", "", 0, form.finalTaxDue]).font = { bold: true };
  sum.columns.forEach((col, i) => (col.width = i === 0 ? 34 : 16));
  sum.getColumn(3).numFmt = money;
  sum.getColumn(4).numFmt = money;
  if (form.filingBasis) {
    const basis=form.filingBasis,proof=wb.addWorksheet('신고 근거');
    proof.addRow(['항목','저장된 내용']).font={bold:true};
    for(const item of [
      ['구분','B2 세액 계산 자료. 국세청 접수·납부 완료를 뜻하지 않습니다.'],
      ['계산 기간',`${form.period.from} ~ ${form.period.to}`],['신고 주체',basis.subjectId],['적용 방식',basis.mode==='notice'?'예정고지':'예정신고'],
      ['근거 보관 ID',basis.basisSnapshotId],['근거 지문',basis.scopeHash],['계산 지문',basis.calculationHash],['현재 원천 대사',basis.verificationStatus==='complete'?'차단 사유 없음':'검토 보류'],
      ['예정고지 차감',basis.noticeDeduction],['확인된 납부 원금',basis.payment.paidPrincipal??'미확인'],['미납 원금',basis.payment.outstandingPrincipal??'미확인'],
      ['기신고 매출 공급가액',basis.priorReportedSalesSupply],['기신고 공제세액',basis.priorReportedClaimedTax],['전표 대사 범위','이번 신고와 기신고를 합한 모집단 전체'],
      ['주의','등록 근거 및 현재 DB 원천 대사 결과입니다. 수집 자체의 완전성과 외부 접수는 별도 확인합니다.'],
    ])proof.addRow(item);
    for(const archive of basis.legacyArchives??[])proof.addRow([`보존 내부 확정 ${archive.returnId}`,`${archive.from}~${archive.to}: 외부 접수 근거로 미사용 / 현재 원천 ${archive.sourceStatus}`]);
    proof.getColumn(1).width=30;proof.getColumn(2).width=90;proof.getColumn(2).alignment={wrapText:true};
    const sources=wb.addWorksheet('신고 원천 대사');sources.addRow(['유형','원천 ID','정규 식별자','원천 날짜','방향','공급가액','세액','과거 공제세액','처리','신고 구분','원천 지문','별칭']).font={bold:true};
    for(const s of (Array.isArray(basis.sourceManifest)?basis.sourceManifest:[]) as Array<Record<string,any>>)sources.addRow([s.kind,s.id,s.canonicalKey,s.date,s.direction,s.supply,s.tax,s.priorClaimedTax,s.disposition,s.reportBox,s.sourceHash,JSON.stringify(s.aliases)]);
    sources.columns.forEach((c,i)=>{c.width=[18,25,32,15,14,18,18,18,20,28,68,70][i];if(i>=5&&i<=7)c.numFmt=money;});
  }
  if (form.followupConsumption) {
    const followup = form.followupConsumption, sheet = wb.addWorksheet("후행 검토 근거");
    sheet.addRow(["저장된 계산에 선택한 정확한 별개 공급 쌍입니다. 과거 신고·원천·세액을 변경하지 않으며 외부 신고 접수나 납부 완료를 인증하지 않습니다."]);
    sheet.mergeCells(1, 1, 1, 15); sheet.getRow(1).height = 38; sheet.getCell("A1").alignment = { wrapText: true };
    sheet.addRow(["계산 지문", followup.calculationHash, "적용 주체", followup.application.subjectId, "계산 범위", `${form.period.from} ~ ${form.period.to}`]);
    sheet.addRow(["검토 사건", "검토 판", "정확한 쌍", "카드 원천", "계산서 원천", "과거 측", "과거 근거 구분", "과거 참조", "과거 신고 공제세액", "현재 공제 가능세액", "현재 공급가액", "검토 증빙", "증빙 지문", "증빙 위치", "검토 사유"]).font = { bold: true };
    for (const selected of followup.pairs) {
      const pair = selected.pair, current = pair.historicalSide === "card" ? pair.invoice : pair.card;
      sheet.addRow([selected.reviewId, selected.revisionId, selected.pairKey, pair.card.id, pair.invoice.id,
        pair.historicalSide === "card" ? "카드" : "계산서", pair.past.origin === "legacy" ? "내부 확정 원문(외부 접수 아님)" : "봉인된 기신고 명세·서버 증빙",
        pair.past.origin === "legacy" ? pair.past.legacyReturnId : `${pair.past.basisSnapshotId} / ${pair.past.factRevisionId} / ${pair.past.consumptionId}`,
        selected.priorClaimedTax, selected.currentClaimableTax, current.claimSupply, `vat-document:${pair.document.documentId}`, pair.document.evidenceHash, pair.evidenceLocation, pair.reason]);
    }
    sheet.addRow(["금액 읽기", "과거 부분 공제액은 당시 신고액입니다. 미공제 잔액을 현재 추가 공제하지 않으며, 같은 현재 원천이 여러 쌍에 있으면 위 행의 금액을 중복 합산하지 않습니다."]);
    sheet.columns.forEach((column, i) => { column.width = [30, 32, 68, 30, 30, 12, 32, 70, 22, 22, 22, 45, 68, 36, 60][i]; if (i >= 8 && i <= 10) column.numFmt = money; });
    sheet.eachRow(row => { row.alignment = { wrapText: true, vertical: "top" }; });
  }

  if (form.sameSupplyConsumption) {
    const use = form.sameSupplyConsumption, sheet = wb.addWorksheet('같은 공급 공제 조정');
    sheet.addRow(['저장된 신고에서 계산서를 대표 공제로 유지하고 대응 카드의 공제를 억제한 근거입니다. 전표에는 적용하지 않았습니다.']);
    sheet.mergeCells(1,1,1,12); sheet.getRow(1).height=38; sheet.getCell('A1').alignment={wrapText:true};
    sheet.addRow(['계산 지문',use.calculationHash,'검토 계획',use.plan.planHash]);
    sheet.addRow(['유형','원천 ID','문서 전체','관측','대표 계산서','원 공급가액','원 세액','실제 공제 공급가액','실제 공제 세액','억제 세액','귀속일','전표 적용']).font={bold:true};
    for (const e of use.claimEffects) sheet.addRow([e.sourceType==='card'?'카드':'계산서',e.sourceId,e.wholeId,e.observationId,e.representativeSourceId,e.rawSupplyAmount,e.rawTaxAmount,e.claimedSupplyAmount,e.claimedTaxAmount,e.suppressedTaxAmount,e.taxDate,'미적용']);
    for (const review of use.plan.selections) sheet.addRow(['사용 검토',review.kind,review.caseId,review.revisionId,review.version,review.proofHash]);
    sheet.columns.forEach((column,i)=>{column.width=[14,30,35,35,30,20,20,24,20,20,16,16][i]; if(i>=5&&i<=9)column.numFmt=money;});
    sheet.eachRow(row=>{row.alignment={wrapText:true,vertical:'top'};});
  }

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

  // Export only the supplied saved form. Never reconstruct historical review from current DB rows.
  const check = wb.addWorksheet("공제 검토", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const noticeRow = (message: string) => {
    const row = check.addRow([message]);
    check.mergeCells(row.number, 1, row.number, 12);
    row.height = 32;
    row.alignment = { wrapText: true, vertical: "middle" };
  };
  noticeRow(`공제 검토 — 저장된 신고서 기준 · ${form.period.label}`);
  check.getRow(1).font = { bold: true, size: 13 };
  noticeRow(reviewNotice);
  noticeRow("동일 공급으로 단정하거나 세액을 자동 차감한 결과가 아닙니다. 검토 대상에는 과거 신고 원천이 포함될 수 있어 아래 행의 세액을 현재 신고세액으로 합산하지 않습니다.");
  if (review) {
    noticeRow(`중복 검토 범위: ${review.scope.from} ~ ${review.scope.to} · 이번 신고 범위: ${review.scope.currentFrom} ~ ${review.scope.currentTo}`);
    noticeRow(`과거 신고 근거: ${review.historyStatus === "complete" ? "저장 당시 확인 가능" : "확인 불가·검토 보류"} · 참조 확정본: ${review.scope.priorConfirmedReturnIds.join(", ") || "없음"}`);
  }
  for (const issue of form.blockingIssues ?? []) noticeRow(`검토 보류 [${issue.sourceId}]: ${issue.reason}`);
  for (const reason of review?.historyIssues ?? []) noticeRow(`과거 신고 확인: ${reason}`);
  check.addRow(["구분", "공급자", "사업자번호", "관계 상태", "원천 종류", "원천 ID", "귀속일", "원천 범위", "공급가액", "세액", "합계", "사유·근거"]).font = { bold: true };
  const originLabels = { current: "이번 신고", prior_confirmed: "다른 기수 확정본", prior_period_current: "다른 기수 현재 원천" };
  const sourceRow = (label: string, source: VatClaimSource, state: string, reason: string) => {
    const row = check.addRow([label, source.partyName, source.partyCorpNum ?? "미확인", state, source.kind === "card" ? "카드" : "계산서", source.sourceId, source.date, `${originLabels[source.origin]}${source.returnId ? ` (${source.returnId})` : ""}`, source.supply, source.tax, source.total, reason]);
    row.alignment = { wrapText: true, vertical: "top" };
    row.height = 45;
  };
  for (const group of review?.candidateGroups ?? []) {
    noticeRow(`후보 ${group.partyName} · ${group.status === "pending" ? "검토 보류" : "근거 확인"} · 미해소 관계 ${group.unresolvedPairCount}개: ${group.reason}`);
    const resolutions = [group.resolutionLinkIds.length ? `검토 연결: ${group.resolutionLinkIds.join(", ")}` : "", group.resolutionReviewPairs?.length ? `후행 검토 쌍: ${group.resolutionReviewPairs.map(p => `${p.revisionId}/${p.pairKey}`).join(", ")}` : ""].filter(Boolean);
    for (const source of [...group.cards, ...group.invoices]) sourceRow("검토 대상", source, group.status === "pending" ? "보류" : "해소", resolutions.join(" / ") || "검토 근거 미등록");
  }
  if (review) {
    noticeRow("이번 신고서의 원천별 공제 내역 — 아래는 저장 당시의 부호 있는 공제 성분이며, 위 검토 대상 행과 중복 합산하지 않습니다.");
    for (const source of review.claimSources) sourceRow("공제 원천", source, "저장 당시", "");
  }
  check.columns.forEach((col, i) => (col.width = [14, 24, 17, 12, 12, 26, 13, 24, 16, 14, 16, 45][i]));
  for (const column of [9, 10, 11]) check.getColumn(column).numFmt = money;

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
      r.direction === "purchase" && r.taxType !== 3 ? (r.excluded ? "제외" : r.vatDeductible === 0 ? "불공제" : r.vatDeductible === 1 ? "공제" : "미판정") : "",
      r.modifyCode ? `수정(${r.modifyCode})` : r.source === "app_issue" ? "앱 발행분" : "",
    ]);
  }
  led.columns.forEach((col, i) => (col.width = [12, 6, 6, 26, 15, 24, 18, 14, 12, 14, 8, 12][i] ?? 12));
  for (const c of [8, 9, 10]) led.getColumn(c).numFmt = money;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
