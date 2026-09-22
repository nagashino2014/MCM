import { createHash } from "node:crypto";
import { validateAccountingRange, validateFiscalYear } from "./write-lock";
import type { TransactionLinkState } from "./transaction-links";
import type { VatFollowupApplication, VatFollowupIssue, VatFollowupPairInput, VatFollowupPastRef, VatFollowupPreviewInput, VatFollowupResolvedPair, VatFollowupSourceRef } from "./vat-followup-review-types";

export function vatFollowupCanonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(vatFollowupCanonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${vatFollowupCanonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
}
export const vatFollowupHash = (value: unknown): string => createHash("sha256").update(vatFollowupCanonical(value)).digest("hex");
export const vatFollowupPairKey = (cardId: string, invoiceId: string): string => vatFollowupHash(["card", cardId, "hometax", invoiceId]);
export const vatFollowupError = (message: string, status = 409, code = "vat_followup_conflict") => Object.assign(new Error(message), { status, code });
export function vatFollowupText(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw vatFollowupError(`${label}을 확인하세요.`, 400, "vat_followup_input");
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw vatFollowupError("검토 입력 형식을 확인하세요.", 400, "vat_followup_input");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(k => !allowed.includes(k))) throw vatFollowupError("지원하지 않는 검토 입력 항목이 있습니다.", 400, "vat_followup_input");
}
function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw vatFollowupError("조회한 원천·보관 지문이 필요합니다.", 400, "vat_followup_input");
  return value;
}
export function normalizeVatFollowupApplication(value: unknown): VatFollowupApplication {
  const v = object(value); exact(v, ["subjectId", "year", "term", "kind", "path", "basisSnapshotId"]);
  validateFiscalYear(v.year as number);
  if (![1, 2].includes(v.term as number) || v.kind !== "final" || !["legacy", "basis"].includes(String(v.path))) throw vatFollowupError("같은 반기의 예정 근거와 확정 적용 기간을 선택하세요.", 400, "vat_followup_input");
  const basisSnapshotId = v.basisSnapshotId == null ? null : vatFollowupText(v.basisSnapshotId, "봉인 근거");
  if ((v.path === "basis") !== !!basisSnapshotId) throw vatFollowupError("신고 경로와 봉인 근거 선택이 맞지 않습니다.", 400, "vat_followup_input");
  return { subjectId: vatFollowupText(v.subjectId, "신고 주체"), year: v.year as number, term: v.term as 1 | 2, kind: "final", path: v.path as "legacy" | "basis", basisSnapshotId };
}
export function vatFollowupPeriods(application: VatFollowupApplication) {
  const y = String(application.year), first = application.term === 1;
  const priorFrom = `${y}-${first ? "01" : "07"}-01`, priorTo = `${y}-${first ? "03" : "09"}-${first ? "31" : "30"}`;
  const currentFrom = `${y}-${first ? "04" : "10"}-01`, dateTo = `${y}-${first ? "06-30" : "12-31"}`;
  const dateFrom = application.path === "basis" ? priorFrom : currentFrom;
  validateAccountingRange(priorFrom, dateTo);
  return { priorFrom, priorTo, currentFrom, dateFrom, dateTo };
}
function source(value: unknown, kind: "card" | "hometax"): VatFollowupSourceRef {
  const v = object(value); exact(v, ["kind", "id", "expectedSourceHash"]);
  if (v.kind !== kind) throw vatFollowupError("카드와 매입 계산서의 정확한 원천을 선택하세요.", 400, "vat_followup_input");
  return { kind, id: vatFollowupText(v.id, "원천"), expectedSourceHash: digest(v.expectedSourceHash) };
}
function past(value: unknown): VatFollowupPastRef {
  const v = object(value);
  if (v.origin === "legacy") { exact(v, ["origin", "returnId", "expectedArchiveHash"]); return { origin: "legacy", returnId: vatFollowupText(v.returnId, "과거 신고"), expectedArchiveHash: digest(v.expectedArchiveHash) }; }
  if (v.origin === "basis") { exact(v, ["origin", "basisSnapshotId", "factRevisionId", "expectedScopeHash"]); return { origin: "basis", basisSnapshotId: vatFollowupText(v.basisSnapshotId, "봉인 근거"), factRevisionId: vatFollowupText(v.factRevisionId, "기신고 사실 판"), expectedScopeHash: digest(v.expectedScopeHash) }; }
  throw vatFollowupError("과거 내부 신고 또는 봉인 기신고 명세를 선택하세요.", 400, "vat_followup_input");
}
export function normalizeVatFollowupInput(value: unknown): VatFollowupPreviewInput {
  const v = object(value); exact(v, ["requestId", "reviewId", "expectedVersion", "application", "state", "pairs", "expectedPreviewHash", "reviewConfirmed"]);
  if (!Number.isSafeInteger(v.expectedVersion) || Number(v.expectedVersion) < 0 || !["recorded", "verified"].includes(String(v.state))) throw vatFollowupError("검토 상태와 기대 판번호를 확인하세요.", 400, "vat_followup_input");
  if (!Array.isArray(v.pairs) || !v.pairs.length || v.pairs.length > 100) throw vatFollowupError("검토할 정확한 원천 쌍을 1~100개 선택하세요.", 400, "vat_followup_input");
  const pairs: VatFollowupPairInput[] = v.pairs.map(value => {
    const p = object(value); exact(p, ["card", "invoice", "historicalSide", "past", "documentId", "evidenceLocation", "reason"]);
    if (!["card", "invoice"].includes(String(p.historicalSide))) throw vatFollowupError("과거에 공제한 원천을 구분하세요.", 400, "vat_followup_input");
    return { card: source(p.card, "card"), invoice: source(p.invoice, "hometax"), historicalSide: p.historicalSide as "card" | "invoice", past: past(p.past), documentId: vatFollowupText(p.documentId, "서버 증빙"), evidenceLocation: vatFollowupText(p.evidenceLocation, "증빙 위치", 1000), reason: vatFollowupText(p.reason, "별개 공급 사유", 4000) };
  });
  const keys = pairs.map(p => vatFollowupPairKey(p.card.id, p.invoice.id));
  if (new Set(keys).size !== keys.length) throw vatFollowupError("같은 원천 쌍을 중복 선택했습니다.", 400, "vat_followup_input");
  return { requestId: vatFollowupText(v.requestId, "요청"), reviewId: v.reviewId == null ? null : vatFollowupText(v.reviewId, "검토 사건"), expectedVersion: Number(v.expectedVersion), application: normalizeVatFollowupApplication(v.application), state: v.state as "recorded" | "verified", pairs };
}

/** 이미 서버가 읽은 원천/과거 명세의 정확한 쌍만 평가한다. 금액이나 링크를 바꾸지 않는다. */
export function evaluateVatFollowupPairs(application: VatFollowupApplication, pairs: VatFollowupResolvedPair[], links: TransactionLinkState): { pairs: VatFollowupResolvedPair[]; canReview: boolean; issues: VatFollowupIssue[]; taxDelta: 0 } {
  const period = vatFollowupPeriods(application), issues: VatFollowupIssue[] = [];
  const evaluatedPairs = structuredClone(pairs);
  for (const pair of evaluatedPairs) {
    const add = (code: string, message: string) => { if (!pair.issues.some(i => i.code === code)) pair.issues.push({ code, message, pairKey: pair.pairKey }); };
    const historical = pair.historicalSide === "card" ? pair.card : pair.invoice, current = pair.historicalSide === "card" ? pair.invoice : pair.card, claim = pair.past.claim;
    if (historical.date < period.priorFrom || historical.date > period.priorTo || current.date < period.currentFrom || current.date > period.dateTo) add("pair_period_mismatch", "과거 예정 기간과 당기 별개 원천의 귀속일을 확인하세요.");
    if (pair.past.from !== period.priorFrom || pair.past.to !== period.priorTo || pair.past.subjectId !== application.subjectId || pair.past.origin !== application.path) add("past_scope_mismatch", "신고 경로·주체·예정 기간의 과거 명세가 일치하지 않습니다.");
    if (pair.past.origin === "basis" && pair.past.basisSnapshotId !== application.basisSnapshotId) add("past_basis_mismatch", "적용할 봉인의 실제 기신고 명세를 선택하세요.");
    if (!historical.aliases.some(a => a.active && a.kind === claim.sourceKind && a.id === claim.sourceId && a.sourceHash === claim.sourceHash) || claim.canonicalKey !== historical.canonicalKey || claim.date !== historical.date || claim.supply !== historical.claimSupply || claim.tax !== historical.claimTax || !Number.isSafeInteger(claim.claimedTax) || claim.claimedTax <= 0 || claim.claimedTax > historical.claimTax) add("past_source_changed", "과거 기공제 명세와 현재 원천·별칭·금액이 일치하지 않습니다. 별개 검토로 과거 오류를 해소할 수 없습니다.");
    if (current.claimTax <= 0 || current.claimTotal <= 0) add("current_claim_unavailable", "현재 원천의 유효한 잔여 공제액을 확인해야 합니다.");
    if (!pair.card.partyCorpNum || !pair.invoice.partyCorpNum || pair.card.partyCorpNum !== pair.invoice.partyCorpNum) add("pair_party_mismatch", "같은 공급자의 정확한 카드·매입 계산서 후보를 선택하세요.");
    if (pair.past.evidenceVerification === "unverified_declaration") add("past_document_unverified", "과거의 선언형 증빙만으로 실제 신고 원문을 확인할 수 없습니다. 서버 보관 원문과 명세 대사가 필요합니다.");
    const opposing = links.links.filter(link => link.relation === "card_invoice" && link.left.id === pair.card.id && (link.right.id === pair.invoice.id || link.rightSnapshot.canonicalKey === pair.invoice.canonicalKey));
    if (opposing.some(link => link.state === "active")) add("same_supply_conflict", "같은 두 원천의 동일 공급 배부와 별개 공급 검토가 충돌합니다.");
    if (opposing.some(link => link.state === "cancelled")) add("cancelled_same_supply_review", "이전에 동일 공급으로 확인한 연결의 취소 근거를 먼저 대사해야 합니다. C-a에서는 이 상충 이력을 별개로 해소하지 않습니다.");
    issues.push(...pair.issues);
  }
  return { pairs: evaluatedPairs, canReview: !issues.length, issues, taxDelta: 0 };
}
