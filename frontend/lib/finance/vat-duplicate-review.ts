import { createHash } from "node:crypto";
import type { TransactionLink } from "./transaction-links";
import type { ValidatedVatFollowupConsumptionPlan } from "./vat-followup-consumption-types";
import type { VatSameSupplyPlan } from './vat-same-supply-types';
import { assertSameSupplyCalculation, sameSupplyResolvesPair } from './vat-same-supply';
import type { VatReturnForm } from './vat-return';

export const VAT_DUPLICATE_REVIEW_VERSION = "g03b-r0-v1" as const;
export type VatClaimOrigin = "current" | "prior_confirmed" | "prior_period_current";
export interface VatClaimSource {
  kind: "card" | "hometax";
  sourceId: string;
  canonicalKey: string;
  partyCorpNum: string | null;
  partyName: string;
  date: string;
  supply: number;
  tax: number;
  total: number;
  sourceHash: string;
  origin: VatClaimOrigin;
  returnId?: string;
}
export interface VatDuplicateCandidateGroup {
  id: string;
  partyCorpNum: string | null;
  partyName: string;
  reason: string;
  status: "pending" | "resolved";
  cards: VatClaimSource[];
  invoices: VatClaimSource[];
  unresolvedPairCount: number;
  resolutionLinkIds: string[];
  resolutionReviewPairs?: Array<{ revisionId: string; pairKey: string }>;
  resolutionSamePairs?: Array<{ cardSourceId: string; invoiceSourceId: string; planHash: string }>;
}
export interface VatDuplicateReview {
  version: typeof VAT_DUPLICATE_REVIEW_VERSION;
  scope: { from: string; to: string; currentFrom: string; currentTo: string; priorConfirmedReturnIds: string[] };
  historyStatus: "complete" | "unavailable";
  historyIssues: string[];
  candidateGroups: VatDuplicateCandidateGroup[];
  /** Signed, source-level amounts actually claimed in this return, including reversals. */
  claimSources: VatClaimSource[];
}
export interface ConfirmedVatSnapshot {
  returnId: string;
  from: string;
  to: string;
  form: unknown;
  currentLinkSourceHash: string;
}
export function normalizeVatParty(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  // Formatting separators are harmless; letters and malformed identifiers are not silently repaired.
  if (!/^[\d\s-]+$/.test(raw)) return null;
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{10}$/.test(digits) ? digits : null;
}
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])) : value;
export const vatDuplicateReviewHash = (review: VatDuplicateReview): string => createHash("sha256").update(JSON.stringify(stable(review))).digest("hex");
const key = (s: VatClaimSource) => `${s.kind}:${s.sourceId}`;
const basis = (s: VatClaimSource) => JSON.stringify(stable({ kind: s.kind, sourceId: s.sourceId, canonicalKey: s.canonicalKey, partyCorpNum: s.partyCorpNum, partyName: s.partyName, date: s.date, supply: s.supply, tax: s.tax, total: s.total, sourceHash: s.sourceHash }));
const inRange = (s: VatClaimSource, from: string, to: string) => s.date >= from && s.date <= to;
const object = (v: unknown): Record<string, unknown> | null => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const validClaim = (value: unknown): value is VatClaimSource => {
  const s = object(value);
  return !!s && ["card", "hometax"].includes(String(s.kind)) && typeof s.sourceId === "string" && !!s.sourceId && typeof s.canonicalKey === "string" && !!s.canonicalKey
    && typeof s.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date) && typeof s.sourceHash === "string" && /^[a-f0-9]{64}$/.test(s.sourceHash)
    && [s.supply, s.tax, s.total].every(v => typeof v === "number" && Number.isSafeInteger(v)) && typeof s.partyName === "string"
    && (s.partyCorpNum === null || typeof s.partyCorpNum === "string");
};
export function snapshotClaims(snapshot: ConfirmedVatSnapshot): VatClaimSource[] | null {
  const form = object(snapshot.form), purchases = object(form?.purchases), review = object(form?.duplicateReview);
  const cards = object(purchases?.cardDeductible), invoices = object(purchases?.invoiceGeneral), non = object(purchases?.nonDeductible), undecided = object(purchases?.invoiceUndecided);
  if (!form || !purchases || !cards || !invoices) return null;
  if (object(form.filingBasis)?.version === 'vat-return-basis-v3' || form.sameSupplyConsumption) {
    try {
      const c = assertSameSupplyCalculation(form as unknown as VatReturnForm);
      if (c.rawClaims.some(s => !validClaim(s) || !inRange(s, snapshot.from, snapshot.to))) return null;
      // Stored zero effects remain visible; raw fingerprints are compared separately below.
      return (form as unknown as VatReturnForm).duplicateReview!.claimSources;
    } catch { return null; }
  }
  if (review?.version !== VAT_DUPLICATE_REVIEW_VERSION || !Array.isArray(review.claimSources)) {
    // Aggregate zero can hide offsetting claims. Only a demonstrably empty legacy population is usable.
    return cards.count === 0 && cards.tax === 0 && cards.supply === 0 && invoices.count === 0 && invoices.tax === 0 && invoices.supply === 0 && Array.isArray(object(form.ledgerSnapshot)?.rows) ? [] : null;
  }
  if (!review.claimSources.every(validClaim)) return null;
  const claims = review.claimSources as VatClaimSource[];
  if (claims.some(s => !inRange(s, snapshot.from, snapshot.to)) || new Set(claims.map(key)).size !== claims.length) return null;
  const c = claims.filter(s => s.kind === "card"), i = claims.filter(s => s.kind === "hometax");
  const sum = (ss: VatClaimSource[], field: "tax" | "supply") => ss.reduce((n, s) => n + s[field], 0);
  if (c.length !== cards.count || sum(c, "tax") !== cards.tax || sum(c, "supply") !== cards.supply) return null;
  if (sum(i, "tax") !== Number(invoices.tax) - Number(non?.tax) - Number(undecided?.tax)) return null;
  return claims;
}

/** 현재 재검증한 정확한 과거/당기 쌍만 해소한다. 과거 부분 공제와 현재 공제 가능액은 다른 값이다. */
function matchesFollowupPair(item: ValidatedVatFollowupConsumptionPlan["pairs"][number], card: VatClaimSource, invoice: VatClaimSource, plan: ValidatedVatFollowupConsumptionPlan): boolean {
  const pair = item.pair, historical = pair.historicalSide === "card" ? card : invoice, current = pair.historicalSide === "card" ? invoice : card;
  const historicalSnapshot = pair.historicalSide === "card" ? pair.card : pair.invoice, currentSnapshot = pair.historicalSide === "card" ? pair.invoice : pair.card;
  if (item.pairKey !== pair.pairKey || pair.past.subjectId !== plan.application.subjectId || pair.past.origin !== plan.application.path || historical.origin !== "prior_confirmed" || current.origin !== "current"
    || historical.date < pair.past.from || historical.date > pair.past.to || current.date <= pair.past.to
    || current.date < plan.application.currentFrom || current.date > plan.application.dateTo
    || historical.kind !== historicalSnapshot.kind || historical.sourceId !== historicalSnapshot.id
    || current.kind !== currentSnapshot.kind || current.sourceId !== currentSnapshot.id) return false;
  if (pair.past.origin === "legacy" ? historical.returnId !== pair.past.legacyReturnId
    : pair.past.basisSnapshotId !== plan.application.basisSnapshotId || historical.returnId !== `basis:${pair.past.scopeHash}`) return false;
  for (const [claim, source] of [[card, pair.card], [invoice, pair.invoice]] as const) {
    const partyName = source.kind === "card" ? String(source.sourceBasis.raw.store_name || "-") : source.partyName || "-";
    if (claim.canonicalKey !== source.canonicalKey || claim.date !== source.date || normalizeVatParty(claim.partyCorpNum) !== normalizeVatParty(source.partyCorpNum)
      || claim.partyName !== partyName) return false;
  }
  return current.sourceHash === currentSnapshot.sourceHash
    && current.supply === currentSnapshot.claimSupply && current.tax === currentSnapshot.claimTax && current.total === currentSnapshot.claimTotal
    && current.tax === item.currentClaimableTax
    && historical.sourceHash === pair.past.claim.sourceHash
    && historicalSnapshot.aliases.some(alias => alias.active && alias.kind === pair.past.claim.sourceKind && alias.id === pair.past.claim.sourceId && alias.sourceHash === pair.past.claim.sourceHash)
    && historical.supply === pair.past.claim.supply && historical.tax === pair.past.claim.claimedTax && historical.total === historicalSnapshot.claimTotal
    && historical.tax === item.priorClaimedTax;
}

/** Conservative review candidates, never a same-supply verdict or an automatic tax adjustment. */
export function buildVatDuplicateReview(input: {
  from: string; to: string; currentFrom: string; currentTo: string;
  currentClaims: VatClaimSource[]; liveHalfClaims: VatClaimSource[];
  confirmed: ConfirmedVatSnapshot[]; links: TransactionLink[];
  unresolvedHalfSources?: Array<{ date: string; sourceId: string; reason: string }>;
  /** B2가 현재 원천과 별도로 대사를 마친 외부 기신고 명세. */
  reconciledPriorClaims?: VatClaimSource[];
  followupPlan?: ValidatedVatFollowupConsumptionPlan;
  sameSupplyPlan?: VatSameSupplyPlan;
}): VatDuplicateReview {
  const current = input.currentClaims.map(s => ({ ...s, partyCorpNum: normalizeVatParty(s.partyCorpNum), origin: "current" as const })).sort((a, b) => key(a).localeCompare(key(b)));
  const review: VatDuplicateReview = {
    version: VAT_DUPLICATE_REVIEW_VERSION,
    scope: { from: input.from, to: input.to, currentFrom: input.currentFrom, currentTo: input.currentTo, priorConfirmedReturnIds: input.confirmed.map(s => s.returnId).sort() },
    historyStatus: "complete", historyIssues: [], candidateGroups: [], claimSources: current,
  };
  const historyIssue = (message: string) => { if (!review.historyIssues.includes(message)) review.historyIssues.push(message); review.historyStatus = "unavailable"; };
  if (input.currentFrom > input.from) {
    const previousEnd = new Date(`${input.currentFrom}T00:00:00Z`);
    previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
    if (!input.confirmed.some(h => h.from === input.from && h.to === previousEnd.toISOString().slice(0, 10))) {
      historyIssue("같은 반기의 앞선 예정 신고에 대한 확정 근거가 없습니다. 원천 자료가 없다는 이유만으로 미공제를 단정할 수 없으므로 실제 신고·무실적·사업개시 근거를 대사해야 합니다.");
    }
  }
  const historical: VatClaimSource[] = (input.reconciledPriorClaims ?? []).map(s => ({...s, partyCorpNum: normalizeVatParty(s.partyCorpNum), origin: "prior_confirmed" as const})), delayed: VatClaimSource[] = [];
  const live = input.liveHalfClaims.map(s => ({ ...s, partyCorpNum: normalizeVatParty(s.partyCorpNum) }));
  for (const source of input.unresolvedHalfSources ?? []) if (source.date < input.currentFrom || input.confirmed.some(h => source.date >= h.from && source.date <= h.to)) {
    historyIssue(`${source.date} 원천 ${source.sourceId}의 공제 판단을 확인할 수 없습니다: ${source.reason} 이전 신고의 누락·중복 여부를 검토하세요.`);
  }
  for (const snapshot of [...input.confirmed].sort((a, b) => a.returnId.localeCompare(b.returnId))) {
    const claims = snapshotClaims(snapshot);
    if (!claims) {
      historyIssue(`${snapshot.from}~${snapshot.to} 확정 신고서의 원천별 공제 내역을 복원할 수 없습니다. 과거 확정본과 실제 신고 증빙을 대사해야 합니다.`);
      continue;
    }
    const evidence = object(object(snapshot.form)?.sourceEvidence);
    if (object(object(snapshot.form)?.duplicateReview)?.version === VAT_DUPLICATE_REVIEW_VERSION && evidence?.linkSourceHash !== snapshot.currentLinkSourceHash) {
      historyIssue(`${snapshot.from}~${snapshot.to} 확정 이후 동일·별개 공급 판단의 연결 근거가 변경되었습니다. 이전 신고의 판단 근거를 재검토하세요.`);
    }
    historical.push(...claims.map(s => ({ ...s, partyCorpNum: normalizeVatParty(s.partyCorpNum), origin: "prior_confirmed" as const, returnId: snapshot.returnId })));
    const stored = new Map(claims.map(s => [key(s), s]));
    const archivedForm = object(snapshot.form);
    const rawClaims = archivedForm?.sameSupplyConsumption
      ? assertSameSupplyCalculation(snapshot.form as VatReturnForm).rawClaims : claims;
    const now = live.filter(s => inRange(s, snapshot.from, snapshot.to));
    const fresh = new Map(now.map(s => [key(s), s]));
    for (const claim of rawClaims) if (!fresh.has(key(claim)) || basis({ ...claim, partyCorpNum: normalizeVatParty(claim.partyCorpNum) }) !== basis(fresh.get(key(claim))!)) {
      historyIssue(`${snapshot.from}~${snapshot.to} 확정 이후 ${claim.kind === "card" ? "카드" : "계산서"} ${claim.sourceId}의 공제 원천이 변경되거나 없어졌습니다. 확정본을 보존하고 해당 신고를 재검토하세요.`);
    }
    for (const claim of now) if (!stored.has(key(claim))) {
      delayed.push({ ...claim, origin: "prior_period_current", returnId: snapshot.returnId });
      historyIssue(`${snapshot.from}~${snapshot.to} 확정 이후 ${claim.kind === "card" ? "카드" : "계산서"} ${claim.sourceId}의 공제 원천이 추가 수집되었습니다. 해당 기간을 재검토하세요.`);
    }
  }
  // Earlier live sources with no app confirmation cannot be assumed unclaimed outside this app.
  const unrecorded = live.filter(s => s.date < input.currentFrom && !input.confirmed.some(h => inRange(s, h.from, h.to)));
  if (unrecorded.length) {
    historyIssue("같은 반기의 이전 기간에 공제 원천이 있으나 앱의 확정 신고 내역이 없습니다. 외부 신고 여부와 원천별 공제 내역을 먼저 확인하세요.");
    delayed.push(...unrecorded.map(s => ({ ...s, origin: "prior_period_current" as const })));
  }
  const all = [...current, ...historical, ...delayed];
  const seen = new Map<string, VatClaimSource>();
  for (const source of all) {
    const old = seen.get(key(source));
    if (old && (old.origin === "current" || source.origin === "current" || old.returnId !== source.returnId)) historyIssue(`원천 ${source.sourceId}가 둘 이상의 신고 범위에 나타납니다. 귀속과 과거 공제 내역을 재검토하세요.`);
    if (!old) seen.set(key(source), source);
  }
  const eligible = [...seen.values()].filter(s => s.tax > 0 && s.total > 0);
  for (const source of eligible.filter(s => !s.partyCorpNum)) review.candidateGroups.push({
    id: `missing-party:${key(source)}`, partyCorpNum: null, partyName: source.partyName,
    reason: "공제 원천의 사업자번호가 없거나 형식이 올바르지 않아 중복 증빙을 검토할 수 없습니다. 원천 사업자번호를 확인하세요.", status: "pending",
    cards: source.kind === "card" ? [source] : [], invoices: source.kind === "hometax" ? [source] : [], unresolvedPairCount: 0, resolutionLinkIds: [],
  });
  const parties = [...new Set(eligible.map(s => s.partyCorpNum).filter((s): s is string => !!s))].sort();
  for (const party of parties) {
    const sources = eligible.filter(s => s.partyCorpNum === party);
    const cards = sources.filter(s => s.kind === "card"), invoices = sources.filter(s => s.kind === "hometax");
    if (!cards.length || !invoices.length) continue;
    let unresolved = 0, compared = 0;
    const resolutions = new Set<string>();
    const reviewResolutions: Array<{ revisionId: string; pairKey: string }> = [];
    const sameResolutions: Array<{ cardSourceId: string; invoiceSourceId: string; planHash: string }> = [];
    for (const card of cards) for (const invoice of invoices) {
      if (card.origin === "prior_confirmed" && invoice.origin === "prior_confirmed") continue;
      compared++;
      const pair = input.links.filter(l => l.state === "active" && l.valid && l.left.kind === "card" && l.left.id === card.sourceId
        && l.right.kind === "hometax" && l.right.id === invoice.sourceId && l.leftHash === card.sourceHash && l.rightHash === invoice.sourceHash);
      const allocations = pair.filter(l => l.relation === "card_invoice");
      const fullInvoice = allocations.length > 0 && ["supply", "tax", "total"].every(field => allocations.reduce((n, l) => n + l[field as "supply" | "tax" | "total"], 0) === invoice[field as "supply" | "tax" | "total"]);
      // A partial same-supply allocation does not become a distinct whole source pair.
      const distinct = allocations.length === 0 ? pair.find(l => l.relation === "distinct") : undefined;
      const same = input.sameSupplyPlan && sameSupplyResolvesPair(input.sameSupplyPlan, card, invoice);
      if (same && (distinct || allocations.length)) throw Object.assign(new Error('같은 공급 사용과 현재 원천의 별개 공급·지급 연결 근거가 충돌합니다.'), {status:409,code:'vat_same_supply_relation_conflict'});
      if (same) sameResolutions.push({cardSourceId:card.sourceId,invoiceSourceId:invoice.sourceId,planHash:input.sameSupplyPlan!.planHash});
      else if (fullInvoice) allocations.forEach(l => resolutions.add(l.id));
      else if (distinct) resolutions.add(distinct.id);
      else {
        const reviewed = allocations.length === 0 && review.historyStatus === "complete" && input.followupPlan
          ? input.followupPlan.pairs.filter(item => matchesFollowupPair(item, card, invoice, input.followupPlan!)) : [];
        if (reviewed.length === 1) reviewResolutions.push({ revisionId: reviewed[0].revisionId, pairKey: reviewed[0].pairKey });
        else unresolved++;
      }
    }
    if (!compared) continue;
    review.candidateGroups.push({
      id: `supplier:${party}`, partyCorpNum: party, partyName: invoices[0]?.partyName || cards[0].partyName,
      reason: unresolved ? "같은 공급자의 카드 잔여 공제와 계산서 공제가 함께 있습니다. 날짜·금액이 달라도 부분·합산 증빙일 수 있어 동일 공급 배부 또는 실제 별개 공급의 근거를 확인해야 합니다. 중복으로 확정하거나 세액을 자동 차감하지 않았습니다. 작성일 이전 지급의 동일 공급 연결은 아직 지원하지 않습니다." : "해당 원천 쌍의 유효한 배부 또는 별개 공급 근거를 확인했습니다. 금액은 원천별 공제 내역을 유지합니다.",
      status: unresolved ? "pending" : "resolved", cards, invoices, unresolvedPairCount: unresolved, resolutionLinkIds: [...resolutions].sort(),
      ...(reviewResolutions.length ? { resolutionReviewPairs: reviewResolutions.sort((a, b) => `${a.revisionId}:${a.pairKey}`.localeCompare(`${b.revisionId}:${b.pairKey}`)) } : {}),
      ...(sameResolutions.length ? { resolutionSamePairs: sameResolutions.sort((a,b)=>`${a.cardSourceId}:${a.invoiceSourceId}`.localeCompare(`${b.cardSourceId}:${b.invoiceSourceId}`)) } : {}),
    });
  }
  review.candidateGroups.sort((a, b) => a.id.localeCompare(b.id));
  review.historyIssues.sort();
  return review;
}
