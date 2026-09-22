import { applyCardMerchantCorrections, merchantIdentity } from "@/lib/finance/card-merchant-source";
// 부가세 준비 — 계정과목 분류 편집/일괄 지정/자동분류 재실행 + 기간 집계 + xlsx (블루프린트 P2 F3)
// 공제 판정은 원천 해시와 사유·증빙이 연결된 검토 결과로만 확정한다.

import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { getDb, withDbWrite, rowsToObjects, type PgDatabase } from "@/lib/db";
import { loadCategories, classifyOne, isPgMerchant, loadStoreRules, type ExpenseCategory } from "@/lib/barobill/classify";
import { cardSourceHash, cardOriginalHash, cardTaxSourceHash, loadCardTaxRows, normalizeCardTransaction, isCardDeductible, type CardTaxRow } from "@/lib/finance/card-tax";
import { lockAccountingWrite, validateAccountingRange } from "@/lib/finance/write-lock";
import { loadTransactionLinkState, findTransactionSource, isOnlyMissingCardTaxReview, type TransactionLinkState, type TransactionLink } from "@/lib/finance/transaction-links";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { assertNewVatFilingCardMutationsAllowed } from "@/lib/finance/vat-filing-protection";

const KST_NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");

export function judgeDeductible(_storeTaxType: number | null, _categoryDefault: number | null): null {
  // Classification is a suggestion, not evidence of Article 39/46 eligibility.
  return null;
}

export interface CardClassificationPatch {
  categoryKey?: string | null; vatDeductible?: number | null; excluded?: boolean; memo?: string | null;
  vatReason?: string | null; vatEvidence?: string | null; vatDate?: string | null;
  originalCardTxnId?: string | null; reversalReason?: string | null;
}

function validateCardClassificationPatch(patch: CardClassificationPatch): void {
  for (const field of ["categoryKey", "memo", "vatReason", "vatEvidence", "vatDate", "originalCardTxnId", "reversalReason"] as const) {
    if (patch[field] !== undefined && patch[field] !== null && typeof patch[field] !== "string") throw Object.assign(new Error("분류·검토 정보의 입력 형식이 올바르지 않습니다."), { status: 400 });
  }
  if (patch.vatDeductible !== undefined && patch.vatDeductible !== null && patch.vatDeductible !== 0 && patch.vatDeductible !== 1) throw Object.assign(new Error("공제 판정은 1, 0, 미판정(null)만 가능합니다."), { status: 400 });
  if (patch.excluded !== undefined && typeof patch.excluded !== "boolean") throw Object.assign(new Error("제외 여부가 올바르지 않습니다."), { status: 400 });
}

async function applyCardClassification(db: PgDatabase, cardTxnId: string, patch: CardClassificationPatch, categories: ExpenseCategory[], actorUserId?: string): Promise<void> {
  validateCardClassificationPatch(patch);
  const byKey = new Map(categories.map((c) => [c.categoryKey, c]));
  if (patch.categoryKey && !byKey.has(patch.categoryKey)) throw Object.assign(new Error("존재하지 않는 분류입니다."), { status: 400 });
    await lockAccountingWrite(db);
    const rows = rowsToObjects(
      await db.exec(
        `SELECT * FROM card_transactions WHERE card_txn_id = $1 FOR UPDATE`,
        [cardTxnId],
      ),
    );
    if (!rows.length) throw Object.assign(new Error("매입 건을 찾을 수 없습니다."), { status: 404 });
    const row = (await applyCardMerchantCorrections(db,rows))[0];

    const sets: string[] = [];
    const args: unknown[] = [cardTxnId];
    if (patch.categoryKey !== undefined) {
      args.push(patch.categoryKey);
      sets.push(`category_key = $${args.length}`, `category_source = 'manual'`);
      // 분류를 바꾸면 공제 여부도 기본값으로 재판정(사용자가 명시 지정한 경우는 아래에서 덮어씀)
      const cat = patch.categoryKey ? byKey.get(patch.categoryKey) : undefined;
      if (patch.vatDeductible === undefined) {
        args.push(judgeDeductible(row.store_tax_type == null ? null : Number(row.store_tax_type), cat?.vatDeductibleDefault ?? null));
        sets.push(`vat_deductible = $${args.length}`);
      }
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
    if (patch.categoryKey !== undefined || patch.vatDeductible !== undefined || patch.excluded !== undefined) {
      if (patch.vatDate) validateAccountingRange(patch.vatDate, patch.vatDate);
      await assertNewVatFilingCardMutationsAllowed(db, {
        cardTxnIds: [cardTxnId, ...(patch.originalCardTxnId ? [patch.originalCardTxnId] : [])],
        additionalDates: patch.vatDate ? [patch.vatDate] : [],
      });
    }
    args.push(KST_NOW());
    sets.push(`updated_at = $${args.length}`);
    await db.run(`UPDATE card_transactions SET ${sets.join(", ")} WHERE card_txn_id = $1`, args);

    if (patch.vatDeductible !== undefined) {
      if (patch.vatDeductible === null) await db.run("DELETE FROM card_tax_reviews WHERE card_txn_id = $1", [cardTxnId]);
      else {
        const reason = typeof patch.vatReason === "string" ? patch.vatReason.trim() : "";
        const evidence = typeof patch.vatEvidence === "string" ? patch.vatEvidence.trim() : "";
        if (!reason || !evidence || reason.length > 2000 || evidence.length > 1000) throw Object.assign(new Error("공제·불공제 사유와 증빙 참조를 입력하세요."), { status: 400 });
        const current = (await applyCardMerchantCorrections(db, rowsToObjects(await db.exec("SELECT * FROM card_transactions WHERE card_txn_id = $1", [cardTxnId]))))[0];
        const n = normalizeCardTransaction(current);
        if (!n.valid || !["purchase", "reversal"].includes(n.kind)) throw Object.assign(new Error("승인 유형과 금액을 먼저 확인하세요."), { status: 409 });
        let originalHash: string | null = null;
        let taxDate = patch.vatDate || String(current.approved_at).slice(0, 10);
        validateAccountingRange(taxDate, taxDate);
        if (n.kind === "reversal") {
          if (!patch.originalCardTxnId || !patch.vatDate || !["return", "contract_cancellation", "price_adjustment", "original_correction"].includes(patch.reversalReason ?? "")) throw Object.assign(new Error("취소 원승인, 사유, 신고 귀속일을 입력하세요."), { status: 400 });
          validateAccountingRange(patch.vatDate, patch.vatDate);
          const original = (await applyCardMerchantCorrections(db, rowsToObjects(await db.exec("SELECT t.*, r.tax_date AS review_tax_date, r.source_hash AS review_source_hash, r.decision AS review_decision, r.reason AS review_reason, r.evidence_ref AS review_evidence FROM card_transactions t LEFT JOIN card_tax_reviews r ON r.card_txn_id=t.card_txn_id WHERE t.card_txn_id = $1", [patch.originalCardTxnId]))))[0];
          if (!original) throw Object.assign(new Error("취소 원승인을 찾을 수 없습니다."), { status: 400 });
          const originalDate = String(original.review_tax_date || original.approved_at).slice(0, 10);
          if (patch.vatDate < originalDate || (patch.reversalReason === "original_correction" && patch.vatDate !== originalDate)) throw Object.assign(new Error("취소 귀속일은 검토된 원거래 귀속일 이후여야 하며, 당초 거래 정정은 원거래의 증빙상 귀속일을 사용하세요."), { status: 400 });
          taxDate = patch.vatDate;
          originalHash = cardOriginalHash(original);
        }
        await db.run(`INSERT INTO card_tax_reviews(card_txn_id,decision,reason,evidence_ref,source_hash,tax_date,original_card_txn_id,original_source_hash,reversal_reason,reviewed_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(card_txn_id) DO UPDATE SET decision=EXCLUDED.decision,reason=EXCLUDED.reason,evidence_ref=EXCLUDED.evidence_ref,source_hash=EXCLUDED.source_hash,tax_date=EXCLUDED.tax_date,original_card_txn_id=EXCLUDED.original_card_txn_id,original_source_hash=EXCLUDED.original_source_hash,reversal_reason=EXCLUDED.reversal_reason,reviewed_at=EXCLUDED.reviewed_at`,
          [cardTxnId,patch.vatDeductible,reason,evidence,cardSourceHash(current),taxDate,n.kind === "reversal" ? patch.originalCardTxnId : null,originalHash,n.kind === "reversal" ? patch.reversalReason : null,KST_NOW()]);
        const checked = (await loadCardTaxRows(db, { from: taxDate, to: taxDate })).find(r => r.card_txn_id === cardTxnId);
        if (!checked || checked.issues.length) throw Object.assign(new Error(checked?.issues.join(" ") || "카드 검토 결과를 확인할 수 없습니다."), { status: 409 });
      }
    }

    if (actorUserId) await recordAuditLogInline(db, {
      actorUserId, action: "finance_card_meta_update", targetTable: "card_transactions", targetId: cardTxnId,
      before: { categoryKey: row.category_key, vatDeductible: row.vat_deductible, excluded: row.excluded },
      after: patch,
    });

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
}

/** 단건 분류/공제/제외 수정(수동 확정). 분류를 바꾸면 학습 사전에도 반영한다(PG 가맹점 제외). */
export async function updateCardClassification(cardTxnId: string, patch: CardClassificationPatch, actorUserId?: string): Promise<void> {
  validateCardClassificationPatch(patch);
  const categories = await loadCategories();
  await withDbWrite(db=>applyCardClassification(db,cardTxnId,patch,categories,actorUserId),{accountingSnapshot:true});
}

/** 선택 건 일괄 분류 지정. */
export async function bulkAssignCategory(cardTxnIds: string[], categoryKey: string): Promise<number> {
  if (!cardTxnIds.length) return 0;
  const categories = await loadCategories();
  return withDbWrite(async db=>{
  let count = 0;
  for (const id of cardTxnIds) {
    await applyCardClassification(db,id,{categoryKey},categories);
    count += 1;
  }
  return count;
  },{accountingSnapshot:true});
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
  const categories = await loadCategories();
  const byKey = new Map(categories.map((c) => [c.categoryKey, c]));
  const learnedRows = rowsToObjects(await db.exec(`SELECT store_corp_num, category_key FROM card_merchant_links`));
  const learned = new Map(learnedRows.map((r) => [String(r.store_corp_num), String(r.category_key)]));
  const storeRules = await loadStoreRules();

  let classified = 0, scanned = 0;
  await withDbWrite(async (tx) => {
    await lockAccountingWrite(tx);
    const rows = await applyCardMerchantCorrections(tx, rowsToObjects(await tx.exec(`SELECT *, EXISTS(SELECT 1 FROM card_tax_reviews r WHERE r.card_txn_id=card_transactions.card_txn_id) AS has_tax_review FROM card_transactions WHERE ${where.join(" AND ")}`, args)));
    scanned = rows.length;
    const planned: Array<{row: Record<string,unknown>; result: NonNullable<ReturnType<typeof classifyOne>>}> = [];
    for (const row of rows) {
      if (merchantIdentity(row)?.issues.length || row.has_tax_review || row.category_source === "manual") continue;
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
      planned.push({row,result});
    }
    await assertNewVatFilingCardMutationsAllowed(tx,{cardTxnIds:planned.map(item=>String(item.row.card_txn_id))});
    for (const {row,result} of planned) {
      const cat = byKey.get(result.categoryKey);
      const changed = rowsToObjects(await tx.exec(
        `UPDATE card_transactions SET category_key = $2, category_source = $3, updated_at = $5 WHERE card_txn_id = $1 AND NOT EXISTS (SELECT 1 FROM card_tax_reviews r WHERE r.card_txn_id = card_transactions.card_txn_id) AND (category_source IS NULL OR category_source <> 'manual') AND $4::integer IS NULL RETURNING card_txn_id`,
        [
          String(row.card_txn_id),
          result.categoryKey,
          result.source,
          judgeDeductible(row.store_tax_type == null ? null : Number(row.store_tax_type), cat?.vatDeductibleDefault ?? null),
          KST_NOW(),
        ],
      ));
      classified += changed.length;
    }
  }, {accountingSnapshot:true});
  return { scanned, classified };
}

export interface VatSummaryRow {
  categoryKey: string | null; categoryLabel: string;
  count: number; amountTotal: number; supplyAmount: number; taxAmount: number;
  deductibleTax: number; nonDeductibleTax: number; undecidedTax: number;
  deductibleCount: number; deductibleSupply: number; undecidedCount: number;
  linkedCount: number; linkedSupply: number; linkedTax: number; linkedAmount: number;
  undecidedSupply: number;
}
export interface VatSummary {
  from: string; to: string; rows: VatSummaryRow[];
  totals: Omit<VatSummaryRow, "categoryKey" | "categoryLabel">;
  unclassified: number; sourceHash: string; linkSourceHash: string;
  blockingIssues: Array<{cardTxnId: string; reason: string}>;
}
const emptyTotals = () => ({count:0,amountTotal:0,supplyAmount:0,taxAmount:0,deductibleTax:0,nonDeductibleTax:0,undecidedTax:0,deductibleCount:0,deductibleSupply:0,undecidedCount:0,linkedCount:0,linkedSupply:0,linkedTax:0,linkedAmount:0,undecidedSupply:0});

export interface VatCardRow extends CardTaxRow {
  vatLinked: { supply: number; tax: number; total: number; linkIds: string[] };
  vatResidual: { supply: number; tax: number; total: number };
  vatIssues: string[];
}
const inRange = (date: string | undefined, from: string, to: string) => !!date && date >= from && date <= to;

/** Keep both former and current periods visible when an active relation becomes stale. */
export function vatRelevantLinks(state: TransactionLinkState, params: {from: string; to: string; cardId?: string}, includeCancelledCard = false): TransactionLink[] {
  return state.links.filter(link => {
    if ((link.state !== "active" && !(includeCancelledCard && link.relation === "card_invoice")) || !["card_invoice", "distinct", "manual_invoice"].includes(link.relation)) return false;
    const left = findTransactionSource(state, link.left), right = findTransactionSource(state, link.right);
    if (params.cardId && (link.left.kind !== "card" || String(left?.raw.card_id ?? link.leftSnapshot.raw.card_id) !== params.cardId)) return false;
    return [left?.taxDate, right?.taxDate, link.leftSnapshot.taxDate, link.rightSnapshot.taxDate].some(date => inRange(date, params.from, params.to));
  }).sort((a, b) => a.id.localeCompare(b.id));
}

/** Only VAT-relevant relations are fingerprinted; bank settlements do not change VAT entitlement. */
export function vatTransactionLinkHash(state: TransactionLinkState, params: {from: string; to: string; cardId?: string}): string {
  const historyIssues = cancelledVatLinkIssues(state);
  return createHash("sha256").update(JSON.stringify(vatRelevantLinks(state, params, true).map(link => ({
    id: link.id, relation: link.relation, state: link.state, left: link.left, right: link.right,
    supply: link.supply, tax: link.tax, total: link.total, reason: link.reason, evidence: link.evidence,
    leftHash: link.leftHash, rightHash: link.rightHash, valid: link.valid, issues: link.issues,
    currentLeftHash: findTransactionSource(state, link.left)?.sourceHash ?? null,
    currentRightHash: findTransactionSource(state, link.right)?.sourceHash ?? null,
    historyIssues: historyIssues.filter(issue => issue.cardTxnId === link.left.id),
  })))).digest("hex");
}

/** Cancelling a payment relation does not make its previously identified supply independent again. */
export function cancelledVatLinkIssues(state: TransactionLinkState): Array<{cardTxnId: string; reason: string; linkIds: string[]}> {
  const groups = new Map<string, TransactionLink[]>();
  for (const link of state.links.filter(l => l.state === "cancelled" && l.relation === "card_invoice")) {
    const key = JSON.stringify([link.left,link.right]);
    groups.set(key,[...(groups.get(key) ?? []),link]);
  }
  const issues: Array<{cardTxnId: string; reason: string; linkIds: string[]}> = [];
  for (const previous of groups.values()) {
    const first=previous[0], left=findTransactionSource(state,first.left), right=findTransactionSource(state,first.right);
    if (!left || !right || right.direction !== "purchase" || Number(right.raw.excluded) === 1) continue;
    const active = state.links.filter(l => l.state === "active" && l.valid && l.left.kind === "card" && l.left.id === first.left.id);
    if (active.some(l => l.relation === "distinct" && l.right.kind === first.right.kind && l.right.id === first.right.id)) continue;
    const all = active.filter(l=>l.relation === "card_invoice");
    const amounts = (links: TransactionLink[]) => links.reduce((n,l)=>({supply:n.supply+l.supply,tax:n.tax+l.tax,total:n.total+l.total}),{supply:0,tax:0,total:0});
    const allocated = amounts(all);
    if (left.supply === allocated.supply && left.tax === allocated.tax && left.total === allocated.total) continue;
    const restored = amounts(all.filter(l=>l.right.kind === first.right.kind && l.right.id === first.right.id));
    const previousMaximum = {supply:Math.max(...previous.map(l=>l.supply)),tax:Math.max(...previous.map(l=>l.tax)),total:Math.max(...previous.map(l=>l.total))};
    if (restored.supply < previousMaximum.supply || restored.tax < previousMaximum.tax || restored.total < previousMaximum.total) issues.push({cardTxnId:first.left.id,linkIds:previous.map(l=>l.id),reason:`이전에 같은 공급으로 확인한 ${first.right.id} 연결을 취소했습니다. 남은 카드 금액의 중복 공제를 막기 위해 연결을 복원하거나 잘못 연결한 별개 공급의 근거를 등록하세요.`});
  }
  return issues;
}

/** Original statement amounts remain unchanged. Only the duplicated VAT evidence portion is allocated away. */
export function resolveVatCardRows(cards: CardTaxRow[], state: TransactionLinkState): VatCardRow[] {
  const cancelledIssues = cancelledVatLinkIssues(state);
  return cards.map(card => {
    const links = state.links.filter(link => link.state === "active" && link.relation === "card_invoice" && link.left.kind === "card" && link.left.id === String(card.card_txn_id));
    const valid = links.filter(link => link.valid);
    let vatLinked = valid.reduce((n, link) => ({ supply: n.supply + link.supply, tax: n.tax + link.tax, total: n.total + link.total, linkIds: [...n.linkIds, link.id] }), { supply: 0, tax: 0, total: 0, linkIds: [] as string[] });
    const linkIssues = links.filter(link => !link.valid).flatMap(link => link.issues.map(issue => issue.message));
    const raw = { supply: card.normalized.supplyAmount, tax: card.normalized.taxAmount, total: card.normalized.amountTotal };
    if (valid.length && ([vatLinked.supply, vatLinked.tax, vatLinked.total].some(n => !Number.isSafeInteger(n) || n < 0) || vatLinked.supply > raw.supply || vatLinked.tax > raw.tax || vatLinked.total > raw.total)) {
      linkIssues.push("연결 배부가 카드 원천 성분을 초과하여 공제 차감을 보류합니다.");
      vatLinked = { supply: 0, tax: 0, total: 0, linkIds: [] };
    }
    const vatResidual = { supply: raw.supply - vatLinked.supply, tax: raw.tax - vatLinked.tax, total: raw.total - vatLinked.total };
    const fullyAllocated = valid.length > 0 && vatResidual.supply === 0 && vatResidual.tax === 0 && vatResidual.total === 0;
    // An entirely linked payment no longer claims card VAT. A stale prior review is never waived.
    const issues = fullyAllocated && card.normalized.valid && card.normalized.kind === "purchase" && isOnlyMissingCardTaxReview(card) ? [] : card.issues;
    const historyIssues = cancelledIssues.filter(issue=>issue.cardTxnId === String(card.card_txn_id)).map(issue=>issue.reason);
    return { ...card, vatLinked, vatResidual, vatIssues: [...issues, ...linkIssues, ...historyIssues] };
  });
}

export function hasVatCardResidual(row: VatCardRow): boolean {
  return row.vatResidual.supply !== 0 || row.vatResidual.tax !== 0 || row.vatResidual.total !== 0;
}
export function isVatCardDeductible(row: VatCardRow): boolean {
  return hasVatCardResidual(row) && isCardDeductible(row) && row.vatIssues.length === 0;
}

/** A single signed population feeds summary, return and workbook. Unresolved tax is displayed separately. */
export async function getVatSummary(params: {from:string;to:string;cardId?:string}, txn?: PgDatabase, suppliedRows?: CardTaxRow[], suppliedLinks?: TransactionLinkState): Promise<VatSummary> {
  if (!txn) return withDbWrite(async db => { await lockAccountingWrite(db); return getVatSummary(params, db, suppliedRows, suppliedLinks); }, {accountingSnapshot:true});
  const db = txn ?? await getDb();
  const cards = suppliedRows ?? await loadCardTaxRows(db,params);
  const links = suppliedLinks ?? await loadTransactionLinkState(db);
  const effectiveCards = resolveVatCardRows(cards, links);
  const categories = await loadCategories(db);
  const labels = new Map(categories.map(c => [c.categoryKey,c.label]));
  const groups = new Map<string|null,VatSummaryRow>();
  const blockingIssues: VatSummary["blockingIssues"] = [];
  let unclassified = 0;
  for (const card of effectiveCards) {
    const key = card.category_key ? String(card.category_key) : null;
    const group = groups.get(key) ?? {categoryKey:key,categoryLabel:key ? labels.get(key) ?? key : "미분류",...emptyTotals()};
    group.count++;
    const n=card.normalized;
    if(n.valid) {group.amountTotal+=n.amountTotal;group.supplyAmount+=n.supplyAmount;group.taxAmount+=n.taxAmount;}
    if(card.vatLinked.linkIds.length) {group.linkedCount++;group.linkedSupply+=card.vatLinked.supply;group.linkedTax+=card.vatLinked.tax;group.linkedAmount+=card.vatLinked.total;}
    if(isVatCardDeductible(card)) {group.deductibleTax+=card.vatResidual.tax;group.deductibleSupply+=card.vatResidual.supply;group.deductibleCount++;}
    else if(hasVatCardResidual(card) && card.vatState === "non_deductible" && !card.vatIssues.length) group.nonDeductibleTax+=card.vatResidual.tax;
    else if(hasVatCardResidual(card)) {group.undecidedCount++;if(n.valid){group.undecidedTax+=card.vatResidual.tax;group.undecidedSupply+=card.vatResidual.supply;}}
    if(key === null && hasVatCardResidual(card)) unclassified++;
    for(const reason of card.vatIssues) blockingIssues.push({cardTxnId:String(card.card_txn_id),reason});
    groups.set(key,group);
  }
  const rows=[...groups.values()].sort((a,b) => a.categoryKey === null ? 1 : b.categoryKey === null ? -1 : b.amountTotal-a.amountTotal);
  const totals=emptyTotals();
  for(const row of rows) for(const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key]+=row[key];
  for(const link of vatRelevantLinks(links,params).filter(link => !link.valid && link.left.kind === "card")) for(const issue of link.issues) if(!blockingIssues.some(row => row.cardTxnId === link.left.id && row.reason === issue.message)) blockingIssues.push({cardTxnId:link.left.id,reason:issue.message});
  const relevantHistoricalIds = new Set(vatRelevantLinks(links,params,true).map(link=>link.id));
  for(const issue of cancelledVatLinkIssues(links)) if(issue.linkIds.some(id=>relevantHistoricalIds.has(id)) && !blockingIssues.some(row=>row.cardTxnId===issue.cardTxnId&&row.reason===issue.reason)) blockingIssues.push({cardTxnId:issue.cardTxnId,reason:issue.reason});
  const linkSourceHash = vatTransactionLinkHash(links,params);
  return {from:params.from,to:params.to,rows,totals,unclassified,sourceHash:createHash("sha256").update(JSON.stringify([cardTaxSourceHash(cards),linkSourceHash])).digest("hex"),linkSourceHash,blockingIssues};
}

export async function buildVatWorkbook(params: {from:string;to:string}): Promise<Buffer> {
  const { cards, summary } = await withDbWrite(async db => {
    await lockAccountingWrite(db);
    const raw = await loadCardTaxRows(db,params);
    const links = await loadTransactionLinkState(db);
    return { cards: resolveVatCardRows(raw,links), summary: await getVatSummary(params,db,raw,links) };
  }, {accountingSnapshot:true});
  const wb=new ExcelJS.Workbook();
  const sum=wb.addWorksheet("계정과목 집계");
  sum.addRow([`법인카드 매입 부가세 집계 (${params.from} ~ ${params.to})`]);
  sum.addRow(["미판정·취소 귀속 검토가 끝나기 전에는 신고용 확정 자료로 사용할 수 없습니다."]);
  sum.addRow(["계정과목","원천 건수","원천 합계금액","원천 공급가액","원천 부가세","잔여 공제 부가세","잔여 불공제 부가세","잔여 미판정 부가세","잔여 미판정 건수","계산서 연결 공급가액","계산서 연결 부가세","잔여 공제 공급가액","잔여 공제 건수"]);
  for(const r of [...summary.rows,{categoryLabel:"합계",...summary.totals}]) sum.addRow([r.categoryLabel,r.count,r.amountTotal,r.supplyAmount,r.taxAmount,r.deductibleTax,r.nonDeductibleTax,r.undecidedTax,r.undecidedCount,r.linkedSupply,r.linkedTax,r.deductibleSupply,r.deductibleCount]);
  sum.getRow(1).font={bold:true,size:13};sum.getRow(3).font={bold:true};sum.lastRow!.font={bold:true};
  sum.columns.forEach(c => {c.width=18;c.numFmt="#,##0";});
  const det=wb.addWorksheet("매입 상세");
  det.addRow(["거래 ID","사용일시","신고 귀속일","유형","상호","사업자번호","원천 합계금액","원천 공급가액","원천 부가세","잔여 공제 판정","검토사항","사유","증빙 참조","원승인 ID","연결 공급가액","연결 부가세","잔여 공급가액","잔여 부가세","연결 ID"]);
  for(const r of cards) det.addRow([String(r.card_txn_id),String(r.approved_at??""),r.taxDate,String(r.approval_type??""),String(r.store_name??""),String(r.store_corp_num??""),r.normalized.valid?r.normalized.amountTotal:null,r.normalized.valid?r.normalized.supplyAmount:null,r.normalized.valid?r.normalized.taxAmount:null,r.vatIssues.length?"검토 필요":!hasVatCardResidual(r)?"계산서에 전액 연결":r.vatState==="deductible"?"공제":r.vatState==="non_deductible"?"불공제":"미판정",r.vatIssues.join(" / "),String(r.review_reason??""),String(r.review_evidence??""),String(r.original_card_txn_id??""),r.vatLinked.supply,r.vatLinked.tax,r.normalized.valid?r.vatResidual.supply:null,r.normalized.valid?r.vatResidual.tax:null,r.vatLinked.linkIds.join(", ")]);
  det.getRow(1).font={bold:true};det.columns.forEach(c=>c.width=20);
  for(let i=7;i<=9;i++)det.getColumn(i).numFmt="#,##0";
  return Buffer.from(await wb.xlsx.writeBuffer());
}
