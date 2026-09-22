import { applyCardMerchantCorrections, merchantIdentity } from "./card-merchant-source";
import { createHash } from "node:crypto";
import { rowsToObjects, type PgDatabase } from "@/lib/db";
import { validateAccountingRange } from "./write-lock";

export type CardVatState = "deductible" | "non_deductible" | "undecided";
export interface CardNormalization {
  kind: "purchase" | "reversal" | "rejected" | "unknown";
  amountTotal: number; supplyAmount: number; taxAmount: number; serviceCharge: number;
  valid: boolean; issue: string | null;
}
export interface CardTaxRow extends Record<string, unknown> {
  normalized: CardNormalization;
  vatState: CardVatState;
  taxDate: string;
  issues: string[];
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Transaction type determines direction exactly once; amount signs never turn an unknown type into a purchase. */
export function normalizeCardTransaction(row: Record<string, unknown>): CardNormalization {
  const type = String(row.approval_type ?? "").trim();
  const kind = type === "승인" ? "purchase" : ["취소", "부분취소", "환불"].includes(type) ? "reversal" : type === "거절" ? "rejected" : "unknown";
  const raw = [row.amount_total, row.supply_amount, row.tax_amount, row.service_charge ?? 0].map(v => v == null || v === "" ? NaN : Number(v));
  const [total, supply, tax, service] = raw.map(Math.abs);
  let issue: string | null = null;
  if (kind === "unknown") issue = "승인 유형을 확인할 수 없습니다.";
  else if (!raw.every(Number.isSafeInteger)) issue = "거래 금액이 원 단위 정수가 아닙니다.";
  else if (total !== supply + tax + service) issue = "합계·공급가액·세액·봉사료가 일치하지 않습니다.";
  else if (kind === "purchase" && raw.some(n => n < 0)) issue = "승인 거래의 음수 금액은 원천 확인이 필요합니다.";
  const sign = kind === "reversal" ? -1 : 1;
  return { kind, amountTotal: sign * total, supplyAmount: sign * supply, taxAmount: sign * tax, serviceCharge: sign * service, valid: !issue, issue };
}

/** Only fields relevant to this evidence and calculation are fingerprinted, never provider credentials/raw payload. */
export function cardSourceHash(row: Record<string, unknown>): string {
  const values: unknown[] = ["card-tax-v1", ...["card_txn_id", "card_id", "approval_type", "approval_num", "approved_at", "amount_total", "supply_amount", "tax_amount", "service_charge", "store_corp_num", "store_tax_type", "category_key", "excluded"].map(key => row[key] == null ? null : String(row[key]))];
  const identity = merchantIdentity(row);
  if (identity) values.push(["merchant-correction-v1",identity.eventId,identity.version,identity.evidenceHash,identity.status,identity.issues]);
  return hash(values);
}
export function cardOriginalHash(row: Record<string, unknown>): string {
  return hash([cardSourceHash(row), row.review_source_hash ?? null, row.review_decision ?? null, row.review_tax_date ?? null, row.review_reason ?? null, row.review_evidence ?? null]);
}
const hasEvidence = (r: Record<string, unknown>) => typeof r.review_reason === "string" && !!r.review_reason.trim() && typeof r.review_evidence === "string" && !!r.review_evidence.trim();

const REVIEW_SELECT = `SELECT t.*, r.decision AS review_decision, r.reason AS review_reason,
  r.evidence_ref AS review_evidence, r.source_hash AS review_source_hash, r.tax_date AS review_tax_date,
  r.original_card_txn_id, r.original_source_hash, r.reversal_reason, r.reviewed_at
  FROM card_transactions t LEFT JOIN card_tax_reviews r ON r.card_txn_id = t.card_txn_id`;

export function isCardDeductible(row: CardTaxRow): boolean {
  return row.normalized.valid && ["purchase", "reversal"].includes(row.normalized.kind) && row.vatState === "deductible" && row.issues.length === 0;
}

/** All card tax consumers use this population. Loading parents and sibling refunds also detects changes outside the requested period. */
export async function loadCardTaxRows(db: PgDatabase, params: { from: string; to: string; cardId?: string; dateBasis?: "accounting" | "tax" }): Promise<CardTaxRow[]> {
  validateAccountingRange(params.from, params.to);
  const raw = await applyCardMerchantCorrections(db, rowsToObjects(await db.exec(REVIEW_SELECT)));
  const byId = new Map(raw.map(r => [String(r.card_txn_id), r]));
  const duplicateKeys = new Map<string, number>();
  const keyOf = (r: Record<string, unknown>) => hash([r.card_id, r.approval_num, r.approved_at, normalizeCardTransaction(r).kind, Math.abs(Number(r.amount_total)), r.store_corp_num]);
  for (const r of raw) if (!Number(r.excluded) && r.approval_num) duplicateKeys.set(keyOf(r), (duplicateKeys.get(keyOf(r)) ?? 0) + 1);
  const results: CardTaxRow[] = [];
  for (const r of raw) {
    if (Number(r.excluded) || (params.cardId && r.card_id !== params.cardId)) continue;
    const normalized = normalizeCardTransaction(r);
    if (normalized.kind === "rejected") continue;
    // A stale date override remains visible at both dates so it cannot disappear from a review queue.
    const taxDate = String(r.review_tax_date || r.approved_at || "").slice(0, 10);
    const approvedDate = String(r.approved_at ?? "").slice(0, 10);
    if (params.dateBasis === "accounting" ? !(approvedDate >= params.from && approvedDate <= params.to) : !(taxDate >= params.from && taxDate <= params.to) && !(approvedDate >= params.from && approvedDate <= params.to)) continue;
    const issues: string[] = [...(normalized.issue ? [normalized.issue] : []), ...(merchantIdentity(r)?.issues ?? [])];
    try { validateAccountingRange(approvedDate, approvedDate); validateAccountingRange(taxDate, taxDate); }
    catch { issues.push("거래일 또는 검토된 신고 귀속일이 올바르지 않습니다."); }
    let vatState: CardVatState = "undecided";
    const validReview = r.review_source_hash === cardSourceHash(r) && hasEvidence(r);
    if (validReview && r.review_decision != null) vatState = Number(r.review_decision) === 1 ? "deductible" : "non_deductible";
    else if (!r.review_source_hash && normalized.valid && normalized.taxAmount === 0) vatState = "non_deductible";
    else issues.push(r.review_source_hash ? "원천이 변경되어 공제 검토를 다시 해야 합니다." : "공제 여부와 증빙을 검토해야 합니다.");
    if ((duplicateKeys.get(keyOf(r)) ?? 0) > 1 && r.approval_num) issues.push("동일 승인번호·일시·금액의 중복 후보가 있습니다.");
    if (normalized.kind === "reversal") {
      const original = byId.get(String(r.original_card_txn_id ?? ""));
      if (!validReview || !original || !r.reversal_reason || !r.review_tax_date) issues.push("취소 원거래·사유·신고 귀속일의 증빙 검토가 필요합니다.");
      else {
        const originalNorm = normalizeCardTransaction(original);
        if (Number(original.excluded) || !originalNorm.valid || originalNorm.kind !== "purchase" || original.card_id !== r.card_id || original.store_corp_num !== r.store_corp_num || r.original_source_hash !== cardOriginalHash(original)) issues.push("취소에 연결한 원승인이 변경되었거나 일치하지 않습니다.");
        const originalDecision = original.review_source_hash === cardSourceHash(original) && hasEvidence(original) ? original.review_decision : !original.review_source_hash && originalNorm.taxAmount === 0 ? 0 : null;
        if (originalDecision == null || Number(originalDecision) !== Number(r.review_decision)) issues.push("취소 공제 판정은 검토가 끝난 원승인과 일치해야 합니다.");
        const siblings = raw.filter(s => !Number(s.excluded) && s.original_card_txn_id === r.original_card_txn_id && normalizeCardTransaction(s).kind === "reversal");
        if (["amount_total", "supply_amount", "tax_amount", "service_charge"].some(key => siblings.reduce((a, s) => a + Math.abs(Number(s[key] ?? 0)), 0) > Math.abs(Number(original[key] ?? 0)))) issues.push("연결된 취소의 합계·공급가액·세액·봉사료가 원승인을 초과합니다.");
      }
    }
    // Valid attributed rows occur only in their selected tax period; unresolved overrides are also visible at source date.
    if (params.dateBasis !== "accounting" && !issues.length && !(taxDate >= params.from && taxDate <= params.to)) continue;
    results.push({ ...r, normalized, vatState, taxDate, issues });
  }
  return results.sort((a, b) => String(a.card_txn_id).localeCompare(String(b.card_txn_id)));
}

export function cardTaxSourceHash(rows: CardTaxRow[]): string {
  return hash(rows.map(r => [String(r.card_txn_id), cardSourceHash(r), r.taxDate, r.vatState, r.issues, r.review_decision, r.review_reason, r.review_evidence, r.original_card_txn_id, r.original_source_hash, r.reversal_reason]));
}
