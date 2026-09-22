import { createHash } from "node:crypto";
import type { VatLedger, VatLedgerRow } from "./vat-return";
import type { VatCardRow } from "../barobill/vat";
import type { TransactionLinkSource, TransactionLinkState } from "./transaction-links";
import type { VatFilingScopeResult } from "./vat-filing-scope";
import type { VatClaimSource } from "./vat-duplicate-review";

export const VAT_RETURN_BASIS_SOURCES_VERSION = "g03b-r01-b2-sources-v1" as const;
export interface VatReturnBasisSource {
  kind: "card" | "hometax" | "tax_invoice";
  id: string;
  canonicalKey: string;
  aliases: Array<{ kind: string; id: string; sourceHash: string; active: boolean }>;
  sourceHash: string;
  hashVersion: "transaction-source-v1";
  date: string;
  direction: "sales" | "purchase";
  taxType: number | null;
  supply: number;
  tax: number;
  total: number;
  claimableTax: number;
  priorClaimedTax: number | null;
  disposition: "current" | "prior_filed" | "excluded" | "blocked" | "out_of_period";
  reportBox: "sales_invoice_taxable" | "sales_invoice_zero" | "sales_exempt_reference" | "purchase_invoice_general" | "purchase_exempt_reference" | "purchase_card";
  dependencyLinkIds: string[];
  subjectEvidence: "source" | "canonical_hometax" | "collection_configuration_only";
}
export interface VatReturnBasisSourcesResult {
  ledgerRows: VatLedgerRow[];
  /** Includes prior-filed cards and diagnostic-only cards whose tax date is outside the population. */
  cardIdsToExclude: string[];
  manifest: VatReturnBasisSource[];
  priorClaims: VatClaimSource[];
  issues: Array<{ sourceId: string; reason: string }>;
  sourceHash: string;
}

const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])) : value;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const key = (kind: string, id: string) => `${kind}:${id}`;
const invoiceKind = (kind: string) => kind === "hometax" || kind === "tax_invoice";
const corp = (value: unknown) => String(value ?? "").replace(/[\s-]/g, "");
const dateValid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const inPeriod = (date: string, period: { from: string; to: string }) => date >= period.from && date <= period.to;
const active = (source: TransactionLinkSource) => !Number(source.raw.excluded) && !source.raw.canceled_at && (source.kind !== "tax_invoice" || Number(source.raw.nts_send_state) === 4);
const invoiceBasis = (source: TransactionLinkSource) => [source.date, source.direction, source.supply, source.tax, source.total, Number(source.raw.tax_type), String(source.raw.modify_code ?? ""), corp(source.direction === "sales" ? source.raw.invoicee_corp_num : source.raw.invoicer_corp_num)];
const ledgerBasis = (row: VatLedgerRow) => [row.writeDate, row.direction, row.amountTotal, row.taxTotal, row.totalAmount, row.taxType, String(row.modifyCode ?? ""), corp(row.partyCorpNum)];
const validMoney = (supply: number, tax: number, total: number) => [supply, tax, total].every(Number.isSafeInteger) && supply + tax === total && (supply === 0 || tax === 0 || Math.sign(supply) === Math.sign(tax));
const rawInvoiceMoneyPresent = (source: TransactionLinkSource) => ["amount_total", "tax_total", "total_amount", "tax_type"].every(k => source.raw[k] !== null && source.raw[k] !== undefined && source.raw[k] !== "" && Number.isSafeInteger(Number(source.raw[k])));

/**
 * Pure live-source reconciliation. B1 evidence alone does not establish this result.
 * Exclusion is whole VAT evidence, after card/invoice allocation. A smaller claimedTax
 * preserves the historical deduction; it never creates a current-period remainder.
 * Callers may preserve a blocked draft, but must reject confirmation while issues remain.
 */
export function prepareVatReturnBasisSources(input: {
  scope: VatFilingScopeResult;
  ledger: VatLedger;
  cards: VatCardRow[];
  transactionLinks: TransactionLinkState;
}): VatReturnBasisSourcesResult {
  const { scope, ledger, cards, transactionLinks } = input;
  const issues: VatReturnBasisSourcesResult["issues"] = [];
  const issueKeys = new Set<string>();
  const addIssue = (sourceId: string, reason: string) => { const k = `${sourceId}\n${reason}`; if (!issueKeys.has(k)) { issueKeys.add(k); issues.push({ sourceId, reason }); } };
  if (scope.status !== "ready" || !scope.canCalculate) addIssue(scope.subjectId, "신고 근거의 기간·신고 유형 검증이 완료되지 않았습니다.");
  if (ledger.from !== scope.populationPeriod.from || ledger.to !== scope.populationPeriod.to) addIssue(scope.subjectId, "원장 조회 범위가 봉인 근거의 신고 모집단과 일치하지 않습니다.");
  ledger.blockingIssues.forEach(i => addIssue(i.sourceId, i.reason));
  const subjectCorpNum = corp(scope.evidenceSnapshot?.subject?.corpNum);
  if (!/^\d{10}$/.test(subjectCorpNum)) addIssue(scope.subjectId, "봉인 근거의 신고 주체 사업자번호를 확인할 수 없습니다.");
  const byRef = new Map<string, TransactionLinkSource[]>();
  const byCanonical = new Map<string, TransactionLinkSource[]>();
  for (const source of transactionLinks.sources) {
    const ref = key(source.kind, source.id);
    byRef.set(ref, [...(byRef.get(ref) ?? []), source]);
    if (invoiceKind(source.kind)) byCanonical.set(source.canonicalKey, [...(byCanonical.get(source.canonicalKey) ?? []), source]);
  }
  const manifest: VatReturnBasisSource[] = [];
  const manifestByRef = new Map<string, VatReturnBasisSource>();
  const ledgerByManifest = new Map<VatReturnBasisSource, VatLedgerRow>();
  const cardByManifest = new Map<VatReturnBasisSource, VatCardRow>();
  const cardIdsToExclude = new Set<string>();
  const register = (entry: VatReturnBasisSource) => {
    manifest.push(entry);
    for (const alias of entry.aliases) {
      const ref = key(alias.kind, alias.id), old = manifestByRef.get(ref);
      if (old && old !== entry) { addIssue(ref, "동일 원천이 신고 모집단에 두 번 연결되었습니다."); old.disposition = entry.disposition = "blocked"; }
      else manifestByRef.set(ref, entry);
    }
  };
  const fail = (entry: VatReturnBasisSource, reason: string) => { entry.disposition = "blocked"; addIssue(key(entry.kind, entry.id), reason); };
  for (const row of ledger.rows) {
    const canonicalKey = `invoice:${String(row.ntsSendKey).trim()}`;
    const aliases = byCanonical.get(canonicalKey) ?? [];
    const representatives = row.htiId !== null ? byRef.get(key("hometax", row.htiId)) ?? [] : aliases.filter(s => s.kind === "tax_invoice" && active(s));
    const source = representatives.length === 1 ? representatives[0] : undefined;
    if (!source) { addIssue(row.htiId ?? canonicalKey, "계산서 원천 ID의 현재 대표를 하나로 확인할 수 없습니다."); continue; }
    const usableAliases = aliases.filter(active);
    const entry: VatReturnBasisSource = {
      kind: source.kind as "hometax" | "tax_invoice", id: source.id, canonicalKey,
      aliases: aliases.map(a => ({ kind: a.kind, id: a.id, sourceHash: a.sourceHash, active: active(a) })).sort((a, b) => key(a.kind, a.id).localeCompare(key(b.kind, b.id))),
      sourceHash: source.sourceHash, hashVersion: "transaction-source-v1", date: row.writeDate, direction: row.direction, taxType: row.taxType,
      supply: row.amountTotal, tax: row.taxTotal, total: row.totalAmount,
      claimableTax: row.direction === "purchase" && row.taxType !== 3 && row.vatDeductible === 1 ? row.taxTotal : 0,
      priorClaimedTax: null, disposition: row.excluded ? "excluded" : "current",
      reportBox: row.direction === "sales" ? row.taxType === 3 ? "sales_exempt_reference" : row.taxType === 2 ? "sales_invoice_zero" : "sales_invoice_taxable" : row.taxType === 3 ? "purchase_exempt_reference" : "purchase_invoice_general",
      dependencyLinkIds: [], subjectEvidence: source.kind === "hometax" ? "source" : usableAliases.some(a => a.kind === "hometax") ? "canonical_hometax" : "collection_configuration_only",
    };
    register(entry); ledgerByManifest.set(entry, row);
    if (!dateValid(entry.date) || !inPeriod(entry.date, scope.populationPeriod)) fail(entry, "계산서 작성일이 신고 모집단에 포함되지 않거나 유효하지 않습니다.");
    if (!rawInvoiceMoneyPresent(source) || !validMoney(entry.supply, entry.tax, entry.total) || ![1, 2, 3].includes(row.taxType) || ((row.taxType === 2 || row.taxType === 3) && row.taxTotal !== 0)) fail(entry, "계산서 금액·과세 구분을 원 단위로 확인할 수 없습니다.");
    if (!["sales", "purchase"].includes(row.direction)) fail(entry, "계산서의 매출·매입 방향을 확인할 수 없습니다.");
    if (!row.ntsSendKey.trim() || source.canonicalKey !== canonicalKey || hash(invoiceBasis(source)) !== hash(ledgerBasis(row))) fail(entry, "원장과 계산서 원천의 공식키·날짜·방향·금액·거래처가 일치하지 않습니다.");
    if (row.direction === "purchase" && source.vatDeductible !== row.vatDeductible) fail(entry, "원장과 계산서 원천의 공제 판정이 일치하지 않습니다.");
    if (!row.excluded && !active(source)) fail(entry, "신고 원천이 삭제·제외·취소되었거나 전송이 완료되지 않았습니다.");
    if (row.excluded && usableAliases.some(alias => key(alias.kind, alias.id) !== key(source.kind, source.id))) fail(entry, "제외된 원장 대표와 같은 공식키의 유효 원천이 함께 있어 제외 범위를 확인해야 합니다.");
    if (usableAliases.some(a => hash(invoiceBasis(a)) !== hash(invoiceBasis(source))) || ["hometax", "tax_invoice"].some(kind => usableAliases.filter(a => a.kind === kind).length > 1)) fail(entry, "같은 공식 계산서 키의 원천 내용 또는 대표가 충돌합니다.");
    if (!row.excluded && entry.subjectEvidence === "collection_configuration_only") fail(entry, "앱 발행 원천에 당시 공급자 사업자번호가 보존되지 않았습니다. 같은 공식키의 유효 홈택스 원천으로 주체를 확인하기 전에는 확정을 보류합니다.");
    for (const alias of usableAliases.filter(a => a.kind === "hometax")) {
      const ownCorpNum = corp(alias.direction === "sales" ? alias.raw.invoicer_corp_num : alias.raw.invoicee_corp_num);
      if (!/^\d{10}$/.test(ownCorpNum) || ownCorpNum !== subjectCorpNum) fail(entry, "계산서 원천의 신고 주체 사업자번호가 봉인 근거와 다르거나 확인되지 않습니다.");
    }
  }
  for (const card of cards) {
    const id = String(card.card_txn_id), found = byRef.get(key("card", id)) ?? [];
    const source = found.length === 1 ? found[0] : undefined;
    if (!source) { addIssue(key("card", id), "카드 원천 ID의 현재 자료를 하나로 확인할 수 없습니다."); continue; }
    const entry: VatReturnBasisSource = {
      kind: "card", id, canonicalKey: `card:${id}`, aliases: [{ kind: "card", id, sourceHash: source.sourceHash, active: active(source) }], sourceHash: source.sourceHash, hashVersion: "transaction-source-v1",
      date: card.taxDate, direction: "purchase", taxType: null,
      supply: card.vatResidual.supply, tax: card.vatResidual.tax, total: card.vatResidual.total,
      claimableTax: card.vatState === "deductible" && card.vatIssues.length === 0 ? card.vatResidual.tax : 0,
      priorClaimedTax: null, disposition: inPeriod(card.taxDate, scope.populationPeriod) ? "current" : "out_of_period", reportBox: "purchase_card", dependencyLinkIds: [...card.vatLinked.linkIds].sort(), subjectEvidence: "collection_configuration_only",
    };
    register(entry); cardByManifest.set(entry, card);
    if (entry.disposition === "out_of_period") cardIdsToExclude.add(id);
    if (!dateValid(entry.date) || !active(source) || source.canonicalKey !== entry.canonicalKey) fail(entry, "카드의 현재 귀속일·원천 상태·식별키를 확인할 수 없습니다.");
    if (!card.normalized.valid || !["purchase", "reversal"].includes(card.normalized.kind) || card.normalized.serviceCharge !== 0 || !validMoney(entry.supply, entry.tax, entry.total)) fail(entry, "카드 승인·취소 성분 또는 봉사료 포함 금액의 신고 대사를 지원하지 않습니다.");
    if ([source.supply, source.tax, source.total, source.taxDate].join("|") !== [card.normalized.supplyAmount, card.normalized.taxAmount, card.normalized.amountTotal, card.taxDate].join("|")) fail(entry, "카드 원천과 공제 대사의 원금액·귀속일이 일치하지 않습니다.");
    const sharedFields = ["card_id", "approval_type", "approval_num", "approved_at", "amount_total", "supply_amount", "tax_amount", "service_charge", "store_corp_num", "store_tax_type", "category_key", "excluded", "review_source_hash", "review_decision", "review_tax_date", "review_reason", "review_evidence", "original_card_txn_id"];
    if (sharedFields.some(field => (source.raw[field] == null ? null : String(source.raw[field])) !== (card[field] == null ? null : String(card[field])))) fail(entry, "카드 원천과 공제 대사의 승인·가맹점·분류·검토 근거가 일치하지 않습니다.");
    if (hash(source.raw.merchant_correction ?? null) !== hash(card.merchant_correction ?? null)) fail(entry, "카드 원천과 공제 대사의 가맹점 정정 근거가 일치하지 않습니다.");
    card.vatIssues.forEach(reason => fail(entry, reason));
  }

  // A missing loader projection is not proof of a nil return. The independently
  // loaded catalog must account for all active invoice/card sources in this range.
  for (const source of transactionLinks.sources) {
    if (!active(source) || manifestByRef.has(key(source.kind, source.id))) continue;
    const expectedInvoice = invoiceKind(source.kind) && inPeriod(source.date, scope.populationPeriod);
    const expectedCard = source.kind === "card" && String(source.raw.approval_type ?? "") !== "거절" && (inPeriod(source.date, scope.populationPeriod) || inPeriod(source.taxDate, scope.populationPeriod));
    if (expectedInvoice || expectedCard) addIssue(key(source.kind, source.id), "신고 모집단의 유효 원천이 원장·카드 대사 결과에 없습니다. 빈 목록을 무실적으로 간주하지 않습니다.");
  }

  const priorClaims: VatClaimSource[] = [];
  const priorRefs = new Set<string>(), priorCanonical = new Set<string>();
  for (const covered of scope.excludedSources) {
    const ref = key(covered.sourceKind, covered.sourceId);
    if (!["hometax", "tax_invoice", "card"].includes(covered.sourceKind)) { addIssue(ref, "기신고 명세의 원천 유형은 지원하지 않습니다. 수기·현금·간주임대료는 별도 대사가 필요합니다."); continue; }
    if (priorRefs.has(ref) || priorCanonical.has(covered.canonicalKey)) { addIssue(ref, "기신고 명세가 같은 원천 또는 공식 계산서를 중복 소비합니다."); continue; }
    priorRefs.add(ref); priorCanonical.add(covered.canonicalKey);
    const found = byRef.get(ref) ?? [], source = found.length === 1 ? found[0] : undefined;
    const entry = manifestByRef.get(ref);
    if (!source) { addIssue(ref, "기신고 원천이 삭제되었거나 식별자가 중복되어 현재 자료를 확인할 수 없습니다."); continue; }
    if (!active(source)) { addIssue(ref, "기신고 원천이 현재 제외·취소·미전송 상태입니다."); if (entry) entry.disposition = "blocked"; continue; }
    if (source.canonicalKey !== covered.canonicalKey || source.sourceHash !== covered.sourceHash) { addIssue(ref, "기신고 원천의 공식키 또는 원천 해시가 현재 자료와 다릅니다. 자동 대체하지 않습니다."); if (entry) entry.disposition = "blocked"; continue; }
    if (!entry || entry.disposition === "out_of_period") { addIssue(ref, "기신고 원천이 현재 신고 모집단에서 없어졌거나 날짜가 이동했습니다."); continue; }
    if (entry.disposition === "blocked" || entry.disposition === "excluded") { addIssue(ref, "기신고 원천의 현재 검증을 완료할 수 없습니다."); continue; }
    if (entry.date !== covered.date || entry.direction !== covered.direction || !scope.priorPeriodCoverage.some(period => inPeriod(covered.date, period))) { fail(entry, "기신고 명세의 날짜·방향·이전 신고 구간이 현재 원천과 일치하지 않습니다."); continue; }
    if (entry.supply !== covered.supply || entry.tax !== covered.tax) { fail(entry, "기신고 명세의 전체 공급가액·세액이 현재 신고 원천과 다릅니다. 분할 원천 신고나 비율 차감은 지원하지 않습니다."); continue; }
    if (!Number.isSafeInteger(covered.claimedTax) || (covered.claimedTax !== 0 && (entry.direction !== "purchase" || Math.sign(covered.claimedTax) !== Math.sign(entry.claimableTax) || Math.abs(covered.claimedTax) > Math.abs(entry.claimableTax)))) { fail(entry, "기신고 공제세액을 현재 원천의 공제 가능한 전체 세액과 대사할 수 없습니다."); continue; }
    entry.disposition = "prior_filed"; entry.priorClaimedTax = covered.claimedTax;
    if (entry.kind === "card") cardIdsToExclude.add(entry.id);
    if (covered.claimedTax !== 0) {
      const row = ledgerByManifest.get(entry), card = cardByManifest.get(entry);
      priorClaims.push({ kind: entry.kind === "card" ? "card" : "hometax", sourceId: entry.kind === "card" ? entry.id : row?.htiId ?? covered.sourceId, canonicalKey: entry.canonicalKey,
        partyCorpNum: row?.partyCorpNum ?? (card?.store_corp_num == null ? null : String(card.store_corp_num)), partyName: row?.partyName ?? String(card?.store_name ?? "-"),
        date: covered.date, supply: covered.supply, tax: covered.claimedTax, total: entry.total, sourceHash: covered.sourceHash, origin: "prior_confirmed", returnId: `basis:${scope.scopeHash}` });
    }
  }
  for (const entry of manifest) {
    if (entry.disposition !== "current") continue;
    const hasEvidenceAmount = entry.supply !== 0 || entry.tax !== 0 || entry.total !== 0;
    if (hasEvidenceAmount && scope.priorPeriodCoverage.some(period => inPeriod(entry.date, period))) fail(entry, "이전 신고 구간의 현재 원천이 기신고 명세에 없습니다. 지연 수집·명세 누락 여부를 확인하기 전에는 이번 신고에 추가하지 않습니다.");
  }
  manifest.sort((a, b) => key(a.kind, a.id).localeCompare(key(b.kind, b.id)));
  issues.sort((a, b) => `${a.sourceId}|${a.reason}`.localeCompare(`${b.sourceId}|${b.reason}`));
  priorClaims.sort((a, b) => key(a.kind, a.sourceId).localeCompare(key(b.kind, b.sourceId)));
  const priorLedgerRows = new Set(manifest.filter(entry => entry.disposition === "prior_filed").map(entry => ledgerByManifest.get(entry)).filter((row): row is VatLedgerRow => !!row));
  return {
    ledgerRows: ledger.rows.filter(row => !priorLedgerRows.has(row)),
    cardIdsToExclude: [...cardIdsToExclude].sort(), manifest, priorClaims, issues,
    sourceHash: hash({ version: VAT_RETURN_BASIS_SOURCES_VERSION, scopeHash: scope.scopeHash, manifest, priorClaims, issues }),
  };
}
