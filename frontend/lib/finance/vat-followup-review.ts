import { rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { lockAccountingWrite } from "./write-lock";
import { assertSupplyGroupPrerequisites } from "./supply-group-prerequisites";
import { currentVatFilingSubject, getVatFilingScope, readVatFilingArchive, vatFilingSubjectFacts } from "./vat-filing-basis";
import { resolveVatFilingScope, type FactRevision, type VatFilingScopeResult } from "./vat-filing-scope";
import { requireVatFilingDocument } from "./vat-filing-documents";
import { vatReturnCollectorCorpNum } from "./vat-return-basis";
import { buildVatLedger, type VatLedger } from "./vat-return";
import { loadCardTaxRows } from "./card-tax";
import { resolveVatCardRows, vatTransactionLinkHash, isVatCardDeductible, type VatCardRow } from "../barobill/vat";
import { loadTransactionLinkState, type TransactionLinkState, type TransactionLinkSource } from "./transaction-links";
import { assertVatFinalizationOpen } from "./vat-finalization-boundary";
import { prepareVatReturnBasisSources } from "./vat-return-sources";
import { buildVatDuplicateReview, normalizeVatParty, vatDuplicateReviewHash, type VatClaimSource } from "./vat-duplicate-review";
import { evaluateVatFollowupPairs, normalizeVatFollowupApplication, normalizeVatFollowupInput, vatFollowupError as fail, vatFollowupHash as hash, vatFollowupPairKey, vatFollowupPeriods, vatFollowupText } from "./vat-followup-review-pure";
import { VAT_FOLLOWUP_REVIEW_VERSION, type VatFollowupApplication, type VatFollowupHistoricalClaim, type VatFollowupIssue, type VatFollowupPairInput, type VatFollowupPastSnapshot, type VatFollowupPayload, type VatFollowupPreview, type VatFollowupPreviewInput, type VatFollowupRecord, type VatFollowupResolvedApplication, type VatFollowupResolvedPair, type VatFollowupSaveInput, type VatFollowupSaveResult, type VatFollowupSourceSnapshot, type VatFollowupWithdrawInput } from "./vat-followup-review-types";
import type { VatFollowupSelection, ValidatedVatFollowupConsumptionPlan } from './vat-followup-consumption-types';
export type * from "./vat-followup-review-types";

const tables = ["vat_followup_review_roots", "vat_followup_review_revisions", "vat_followup_review_pairs", "vat_followup_review_requests", "vat_followup_review_consumptions", "vat_followup_review_fences", "vat_filing_documents", "vat_filing_subjects", "vat_filing_subject_revisions", "vat_filing_fact_revisions", "vat_filing_basis_snapshots", "vat_filing_basis_consumptions", "vat_filing_return_revisions", "vat_filing_return_confirmations"];
const unavailable = () => fail("후행 검토의 저장 구조 또는 보관 근거를 검증할 수 없습니다. 필수 마이그레이션과 원문을 확인하세요.", 503, "vat_followup_unavailable");
const parse = (value: unknown): any => typeof value === "string" ? JSON.parse(value) : value;
const generated = (prefix: string, requestId: string) => `${prefix}-${hash(requestId).slice(0, 40)}`;
const activeSource = (source: TransactionLinkSource) => !Number(source.raw.excluded) && !source.raw.canceled_at && (source.kind !== "tax_invoice" || Number(source.raw.nts_send_state) === 4);
const equal = (a: unknown, b: unknown) => hash(a) === hash(b);
const issue = (code: string, message: string, pairKey?: string): VatFollowupIssue => ({ code, message, ...(pairKey ? { pairKey } : {}) });
async function structure(db: PgDatabase) {
  const rows = rowsToObjects(await db.exec("SELECT name,to_regclass(name) IS NOT NULL AS present FROM unnest($1::text[]) name", [tables]));
  if (tables.some(name => !rows.some(r => r.name === name && r.present === true))) throw unavailable();
  await db.exec("SELECT revision_id,payload_hash,preview_hash,evaluation_hash,state FROM vat_followup_review_revisions WHERE false");
  await db.exec("SELECT vat_followup_database_proof(NULL,NULL,NULL,NULL,NULL) WHERE false");
}
async function transaction<T>(fn: (db: PgDatabase) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await withDbWrite(async db => { await lockAccountingWrite(db); await structure(db); return fn(db); }, { accountingSnapshot: true }); }
    catch (error) {
      const e = error as { code?: string; status?: number };
      if (attempt < 2 && ["40001", "40P01"].includes(String(e.code))) continue;
      if (e.status === 503) { if (e.code === "vat_finalization_unavailable") throw error; throw unavailable(); }
      if (e.status) throw error;
      if (["23505", "23514", "23503", "P0002"].includes(String(e.code))) throw fail("원천·과거 참조·검토 말단 또는 적용 기간이 달라졌습니다. 최신 근거로 다시 확인하세요.");
      throw unavailable();
    }
  }
}
async function documentEvidence(db: PgDatabase, subjectId: string, ref: string | null, expectedHash: string | null): Promise<boolean> {
  if (!ref?.startsWith("vat-document:") || !expectedHash) return false;
  try { return (await requireVatFilingDocument(ref.slice(13), subjectId, db)).evidenceHash === expectedHash; }
  catch (e) { if ((e as { status?: number }).status === 404) throw unavailable(); throw e; }
}
async function applicationContext(db: PgDatabase, input: VatFollowupApplication) {
  const application = normalizeVatFollowupApplication(input), dates = vatFollowupPeriods(application);
  const subject = await currentVatFilingSubject(db, application.subjectId, { from: dates.priorFrom, to: dates.dateTo });
  const collector = vatReturnCollectorCorpNum();
  if (!collector || subject.corpNum !== collector || subject.state !== "verified" || subject.entityType !== "corporation" || subject.vatRegime !== "general" || subject.filingUnit !== "single_business_place" || subject.effectiveFrom > dates.priorFrom || subject.effectiveTo !== null && subject.effectiveTo < dates.dateTo) throw fail("현재 수집 주체와 해당 반기의 검증된 단일 사업장 신고 기준이 일치해야 합니다.");
  const evidenceValid = await documentEvidence(db, subject.subjectId, subject.evidenceRef, subject.evidenceHash);
  const resolved: VatFollowupResolvedApplication = { ...application, basisSnapshotId: application.basisSnapshotId ?? null, collectorCorpNum: collector, subjectRevisionId: subject.revisionId, subjectHash: hash(subject), ...dates };
  return { application: resolved, issues: evidenceValid ? [] : [issue("subject_document_unverified", "현재 신고 주체의 서버 보관 증빙을 확인해야 합니다. 선언형 참조만으로 검토 완료할 수 없습니다.")] };
}
async function assertApplicationOpen(db: PgDatabase, application: VatFollowupResolvedApplication) {
  try { await assertVatFinalizationOpen(db, { subjectId: application.subjectId, year: application.year, term: application.term, kind: application.kind, path: application.path }); }
  catch (error) { if ((error as { status?: number }).status === 409) throw Object.assign(error as Error, { code: "vat_followup_application_confirmed" }); throw error; }
}
interface Context {
  application: VatFollowupResolvedApplication;
  issues: VatFollowupIssue[];
  state: TransactionLinkState;
  cards: VatCardRow[];
  ledger: VatLedger;
  claims: VatClaimSource[];
  basis: { scope: VatFilingScopeResult; facts: FactRevision[]; reconciliation: ReturnType<typeof prepareVatReturnBasisSources>; consumptions: Record<string, unknown>[] } | null;
}
async function loadContext(db: PgDatabase, input: VatFollowupApplication): Promise<Context> {
  const context = await applicationContext(db, input), a = context.application;
  const state = await loadTransactionLinkState(db);
  const cards = resolveVatCardRows(await loadCardTaxRows(db, { from: a.priorFrom, to: a.dateTo }), state);
  const ledger = await buildVatLedger({ from: a.priorFrom, to: a.dateTo }, db);
  const claims: VatClaimSource[] = [];
  for (const row of ledger.rows.filter(r => !r.excluded && r.direction === "purchase" && r.taxType !== 3 && r.vatDeductible === 1)) {
    const source = state.sources.find(s => s.kind === "hometax" && s.id === row.htiId);
    if (source) claims.push({ kind: "hometax", sourceId: source.id, canonicalKey: source.canonicalKey, partyCorpNum: row.partyCorpNum, partyName: row.partyName ?? "-", date: row.writeDate, supply: row.amountTotal, tax: row.taxTotal, total: row.totalAmount, sourceHash: source.sourceHash, origin: "current" });
  }
  for (const card of cards.filter(isVatCardDeductible)) {
    const source = state.sources.find(s => s.kind === "card" && s.id === String(card.card_txn_id));
    if (source) claims.push({ kind: "card", sourceId: source.id, canonicalKey: source.canonicalKey, partyCorpNum: card.store_corp_num == null ? null : String(card.store_corp_num), partyName: String(card.store_name ?? "-"), date: card.taxDate, supply: card.vatResidual.supply, tax: card.vatResidual.tax, total: card.vatResidual.total, sourceHash: source.sourceHash, origin: "current" });
  }
  let basis: Context["basis"] = null;
  if (a.path === "basis") {
    const archive = await readVatFilingArchive({ origin: "basis", id: a.basisSnapshotId! }, db), scope = archive.scope as VatFilingScopeResult;
    if (!scope || archive.record.schema_version !== "vat-filing-basis-v1" || scope.schemaVersion !== "vat-filing-basis-v1" || archive.record.scope_hash !== scope.scopeHash || archive.record.subject_id !== a.subjectId || scope.subjectId !== a.subjectId || scope.year !== a.year || scope.term !== a.term || scope.kind !== "final" || scope.dateFrom !== a.dateFrom || scope.dateTo !== a.dateTo) throw unavailable();
    let rebuilt: VatFilingScopeResult;
    try { rebuilt = resolveVatFilingScope({ ...scope.evidenceSnapshot, year: scope.year, term: scope.term, kind: scope.kind }); } catch { throw unavailable(); }
    if (!equal(rebuilt, scope)) throw unavailable();
    const current = await getVatFilingScope({ subjectId: a.subjectId, year: a.year, term: a.term, kind: "final", collectionCorpNum: a.collectorCorpNum }, db);
    if (!current.canCalculate || current.scopeHash !== scope.scopeHash) context.issues.push(issue("past_basis_changed", "현재 주체·외부 근거가 봉인 당시와 다릅니다. 기존 봉인을 유지하고 후행 정정 여부를 확인하세요."));
    const consumptions = rowsToObjects(await db.exec("SELECT consumption_id,fact_id,revision_id,kind,amount FROM vat_filing_basis_consumptions WHERE snapshot_id=$1 ORDER BY fact_id,kind", [a.basisSnapshotId]));
    const actual = consumptions.map(r => ({ factId: String(r.fact_id), revisionId: String(r.revision_id), kind: String(r.kind), amount: Number(r.amount) }));
    if (!equal(actual, [...scope.consumptions].sort((x, y) => x.factId.localeCompare(y.factId) || x.kind.localeCompare(y.kind)))) throw unavailable();
    const facts = await vatFilingSubjectFacts(db, a.subjectId), reconciliation = prepareVatReturnBasisSources({ scope, ledger, cards, transactionLinks: state });
    basis = { scope, facts, reconciliation, consumptions };
  }
  return { ...context, state, cards, ledger, claims, basis };
}
function sourceSnapshot(context: Context, kind: "card" | "hometax", id: string, expectedHash: string, pairKey: string): { snapshot: VatFollowupSourceSnapshot; issues: VatFollowupIssue[] } {
  const matches = context.state.sources.filter(s => s.kind === kind && s.id === id);
  if (matches.length !== 1) throw fail("선택한 원천이 없어졌거나 식별자가 중복되었습니다.", 409, "vat_followup_source_missing");
  const source = matches[0], issues: VatFollowupIssue[] = [];
  const add = (code: string, message: string) => issues.push(issue(code, message, pairKey));
  if (source.sourceHash !== expectedHash) add("source_hash_changed", "선택 후 원천 자료가 변경되었습니다. 최신 원천을 다시 확인하세요.");
  if (!activeSource(source) || source.direction !== "purchase") add("source_inactive", "유효한 매입 원천만 별개 공급으로 검토할 수 있습니다.");
  const claim = context.claims.find(c => c.kind === kind && c.sourceId === id);
  if (!claim) add("source_claim_unavailable", "현재 원천의 공제 상태·잔여 금액을 확인할 수 없습니다.");
  const aliases = kind === "card" ? [source] : context.state.sources.filter(s => ["hometax", "tax_invoice"].includes(s.kind) && s.canonicalKey === source.canonicalKey);
  const usable = aliases.filter(activeSource);
  if (kind === "hometax") {
    if (["hometax", "tax_invoice"].some(k => usable.filter(s => s.kind === k).length > 1) || usable.some(s => s.date !== source.date || s.direction !== source.direction || s.supply !== source.supply || s.tax !== source.tax || s.total !== source.total || Number(s.raw.tax_type) !== Number(source.raw.tax_type))) add("source_alias_conflict", "같은 공식 계산서의 현재 대표·별칭 내용이 충돌합니다.");
    for (const alias of usable.filter(s => s.kind === "hometax")) if (normalizeVatParty(alias.raw.invoicee_corp_num) !== context.application.collectorCorpNum) add("source_subject_mismatch", "계산서 원천의 매입 주체가 현재 신고 주체와 다릅니다.");
  }
  for (const code of source.issues.filter(code => code !== "modified_invoice_not_supported")) add("source_invalid", `원천 검증이 끝나지 않았습니다: ${code}`);
  if (![source.supply, source.tax, source.total].every(Number.isSafeInteger) || source.supply < 0 || source.tax <= 0 || source.supply + source.tax !== source.total) add("unsupported_source_amount", "양수 공급가액·세액의 정확한 원천 성분이 필요합니다. 취소·환급은 별도 대사 대상입니다.");
  const relatedIssue = context.ledger.blockingIssues.filter(i => i.sourceId === id || i.sourceId === source.canonicalKey || i.sourceId === String(source.raw.nts_send_key));
  for (const item of relatedIssue) add("ledger_source_conflict", item.reason);
  return { snapshot: { kind, id, canonicalKey: source.canonicalKey, sourceHash: source.sourceHash, hashVersion: "transaction-source-v1", sourceBasis: { version: 1, kind, raw: structuredClone(source.raw) }, aliases: aliases.map(s => ({ kind: s.kind, id: s.id, sourceHash: s.sourceHash, active: activeSource(s) })).sort((x, y) => `${x.kind}:${x.id}`.localeCompare(`${y.kind}:${y.id}`)), accountingDate: source.date, date: source.taxDate, direction: "purchase", supply: source.supply, tax: source.tax, total: source.total, claimSupply: claim?.supply ?? 0, claimTax: claim?.tax ?? 0, claimTotal: claim?.total ?? 0, claimedTax: claim?.tax ?? 0, partyCorpNum: normalizeVatParty(kind === "card" ? source.raw.store_corp_num : source.raw.invoicer_corp_num), partyName: source.partyName, subjectEvidence: kind === "card" ? "collection_configuration_only" : "source" }, issues };
}

async function historicalSnapshot(db: PgDatabase, context: Context, input: VatFollowupPairInput, historical: VatFollowupSourceSnapshot, pairKey: string): Promise<{ snapshot: VatFollowupPastSnapshot; issues: VatFollowupIssue[] }> {
  const a = context.application, issues: VatFollowupIssue[] = [];
  const add = (code: string, message: string) => issues.push(issue(code, message, pairKey));
  if (input.past.origin !== a.path) throw fail("적용할 신고 경로에 맞는 과거 근거를 선택하세요.");
  if (input.past.origin === "legacy") {
    const row = rowsToObjects(await db.exec("SELECT to_jsonb(r) AS archive FROM vat_returns r WHERE return_id=$1", [input.past.returnId]))[0];
    if (!row) throw fail("과거 내부 신고 저장본을 찾을 수 없습니다.", 404);
    const archive = parse(row.archive), form = parse(archive.form_json);
    if (archive.status !== "confirmed" || Number(archive.period_year) !== a.year || Number(archive.period_term) !== a.term || archive.period_kind !== "pre" || archive.date_from !== a.priorFrom || archive.date_to !== a.priorTo || form?.period?.from !== a.priorFrom || form?.period?.to !== a.priorTo) throw fail("같은 반기의 확정된 예정 내부 신고 원문을 선택하세요.");
    const archiveHash = hash(archive);
    if (archiveHash !== input.past.expectedArchiveHash) add("legacy_archive_changed", "선택 후 과거 내부 신고 원문 또는 확정 정보가 변경되었습니다.");
    const review = form.duplicateReview;
    if (!review || review.version !== "g03b-r0-v1" || !Array.isArray(review.claimSources) || !form.sourceEvidence || form.sourceEvidence.duplicateReviewHash !== vatDuplicateReviewHash(review)) throw fail("과거 내부 신고의 원천별 공제 명세와 저장 지문을 확인할 수 없습니다.", 409, "vat_followup_legacy_unavailable");
    const checked = buildVatDuplicateReview({ from: a.priorFrom, to: a.dateTo, currentFrom: a.currentFrom, currentTo: a.dateTo, currentClaims: [], liveHalfClaims: context.claims, confirmed: [{ returnId: input.past.returnId, from: a.priorFrom, to: a.priorTo, form, currentLinkSourceHash: vatTransactionLinkHash(context.state, { from: a.priorFrom, to: a.priorTo }) }], links: context.state.links });
    for (const reason of checked.historyIssues) add("legacy_history_unavailable", reason);
    const claims = (review.claimSources as VatClaimSource[]).filter(c => c.kind === historical.kind && c.sourceId === historical.id);
    if (claims.length !== 1) throw fail("선택한 과거 원천의 공제 명세를 하나로 확인할 수 없습니다.", 409, "vat_followup_past_claim_missing");
    const c = claims[0];
    const claim: VatFollowupHistoricalClaim = { sourceKind: c.kind, sourceId: c.sourceId, canonicalKey: c.canonicalKey, sourceHash: c.sourceHash, direction: "purchase", supply: c.supply, tax: c.tax, claimedTax: c.tax, date: c.date };
    return { snapshot: { origin: "legacy", legacyReturnId: input.past.returnId, basisSnapshotId: null, factRevisionId: null, consumptionId: null, subjectId: a.subjectId, from: a.priorFrom, to: a.priorTo, archiveHash, scopeHash: null, evidenceVerification: "legacy_internal_snapshot_only", archive, claim }, issues };
  }
  const basis = context.basis;
  if (!basis || input.past.basisSnapshotId !== a.basisSnapshotId) throw fail("적용할 봉인의 기신고 근거를 선택하세요.");
  const pastRef = input.past;
  if (basis.scope.scopeHash !== pastRef.expectedScopeHash) add("past_scope_hash_changed", "선택한 봉인의 지문이 다릅니다.");
  const consumption = basis.consumptions.find(c => c.kind === "filing" && c.revision_id === pastRef.factRevisionId);
  const fact = basis.facts.find(f => f.revisionId === pastRef.factRevisionId);
  const stored = basis.scope.evidenceSnapshot.facts.find(f => f.revisionId === pastRef.factRevisionId);
  if (!consumption || !fact || !stored || fact.kind !== "filing" || fact.state !== "verified" || fact.subjectId !== a.subjectId || consumption.fact_id !== fact.factId || !equal(fact, stored) || !basis.scope.effectiveFactRevisionIds.includes(fact.revisionId)) throw fail("봉인에서 실제 소비한 유효한 기신고 명세를 확인할 수 없습니다.");
  const declared = fact.sourceCoverage.filter(c => c.canonicalKey === historical.canonicalKey && historical.aliases.some(alias => alias.kind === c.sourceKind && alias.id === c.sourceId));
  if (declared.length !== 1 || !["card", "hometax", "tax_invoice"].includes(declared[0].sourceKind) || declared[0].direction !== "purchase") throw fail("선택한 원천의 기신고 매입 명세를 하나로 확인할 수 없습니다.", 409, "vat_followup_past_claim_missing");
  const coverage = declared[0];
  const priorKeys = new Set(basis.scope.excludedSources.flatMap(c => [c.sourceId, `${c.sourceKind}:${c.sourceId}`, c.canonicalKey]));
  priorKeys.add(a.subjectId); priorKeys.add(historical.id); priorKeys.add(`${historical.kind}:${historical.id}`);
  for (const row of basis.reconciliation.issues.filter(r => priorKeys.has(r.sourceId))) add("basis_source_reconciliation", row.reason);
  const oldSubject = basis.scope.evidenceSnapshot.subject;
  const evidenceValid = await documentEvidence(db, a.subjectId, fact.evidenceRef, fact.evidenceHash) && await documentEvidence(db, a.subjectId, oldSubject.evidenceRef, oldSubject.evidenceHash);
  if (!evidenceValid) add("past_document_unverified", "기신고 사실·주체의 서버 보관 원문이 부족합니다. 기존 선언을 실제 접수 인증으로 승격하지 않습니다.");
  const claim: VatFollowupHistoricalClaim = { ...coverage, sourceKind: coverage.sourceKind as VatFollowupHistoricalClaim["sourceKind"], direction: "purchase" };
  return { snapshot: { origin: "basis", legacyReturnId: null, basisSnapshotId: a.basisSnapshotId, factRevisionId: fact.revisionId, consumptionId: String(consumption.consumption_id), subjectId: a.subjectId, from: fact.from, to: fact.to, archiveHash: hash(basis.scope), scopeHash: basis.scope.scopeHash, evidenceVerification: evidenceValid ? "server_document_verified" : "unverified_declaration", archive: basis.scope, claim }, issues };
}
async function resolvePairs(db: PgDatabase, context: Context, inputs: VatFollowupPairInput[]) {
  const pairs: VatFollowupResolvedPair[] = [];
  for (const input of inputs) {
    const pairKey = vatFollowupPairKey(input.card.id, input.invoice.id);
    const card = sourceSnapshot(context, "card", input.card.id, input.card.expectedSourceHash, pairKey), invoice = sourceSnapshot(context, "hometax", input.invoice.id, input.invoice.expectedSourceHash, pairKey);
    const historical = input.historicalSide === "card" ? card.snapshot : invoice.snapshot;
    const past = await historicalSnapshot(db, context, input, historical, pairKey);
    historical.claimedTax = past.snapshot.claim.claimedTax;
    const document = await requireVatFilingDocument(input.documentId, context.application.subjectId, db);
    const proofRow = rowsToObjects(await db.exec("SELECT vat_followup_database_proof($1,$2,$3,$4,$5) AS proof", [input.card.id, input.invoice.id, past.snapshot.legacyReturnId, past.snapshot.basisSnapshotId, past.snapshot.factRevisionId]))[0];
    const proof = parse(proofRow?.proof);
    if (proof?.version !== "vat-followup-db-v1" || !/^[a-f0-9]{64}$/.test(proof.digest)) throw unavailable();
    pairs.push({ pairKey, databaseProof: proof, card: card.snapshot, invoice: invoice.snapshot, historicalSide: input.historicalSide, past: past.snapshot, document: { documentId: document.documentId, evidenceHash: document.evidenceHash }, evidenceLocation: input.evidenceLocation, reason: input.reason, issues: [...context.issues.map(i => ({ ...i, pairKey })), ...card.issues, ...invoice.issues, ...past.issues] });
  }
  return evaluateVatFollowupPairs(context.application, pairs, context.state);
}
async function rawRecords(db: PgDatabase, reviewId?: string, application?: VatFollowupApplication): Promise<VatFollowupRecord[]> {
  const clauses: string[] = [], params: unknown[] = [];
  if (reviewId) { params.push(reviewId); clauses.push(`r.review_id=$${params.length}`); }
  if (application) {
    for (const [column, value] of [["subject_id", application.subjectId], ["period_year", application.year], ["period_term", application.term], ["application_path", application.path]] as const) { params.push(value); clauses.push(`e.${column}=$${params.length}`); }
    params.push(application.basisSnapshotId ?? null); clauses.push(`e.basis_snapshot_id IS NOT DISTINCT FROM $${params.length}`);
  }
  const rows = rowsToObjects(await db.exec(`SELECT r.*,e.subject_id,e.collector_corp_num,e.application_path,e.period_year,e.period_term,e.date_from,e.date_to,e.basis_snapshot_id,
    EXISTS(SELECT 1 FROM vat_followup_review_consumptions c WHERE c.revision_id=r.revision_id) AS consumed
    FROM vat_followup_review_revisions r JOIN vat_followup_review_roots e ON e.review_id=r.review_id ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY r.review_id,r.version`, params));
  const records: VatFollowupRecord[] = [];
  for (const row of rows) {
    const payload = parse(row.payload_json) as VatFollowupPayload, a = payload?.application;
    if (!payload || payload.schemaVersion !== VAT_FOLLOWUP_REVIEW_VERSION || row.schema_version !== payload.schemaVersion || payload.state !== row.state || !Array.isArray(payload.pairs) || !a || hash(payload) !== row.payload_hash || a.subjectId !== row.subject_id || a.collectorCorpNum !== row.collector_corp_num || a.path !== row.application_path || a.year !== Number(row.period_year) || a.term !== Number(row.period_term) || a.dateFrom !== row.date_from || a.dateTo !== row.date_to || a.basisSnapshotId !== (row.basis_snapshot_id ?? null)) throw unavailable();
    const children = rowsToObjects(await db.exec("SELECT pair_json FROM vat_followup_review_pairs WHERE revision_id=$1 ORDER BY line_no", [row.revision_id])).map(r => parse(r.pair_json));
    if (!equal(children, payload.pairs)) throw unavailable();
    for (const pair of payload.pairs) {
      const document = await requireVatFilingDocument(pair.document.documentId, a.subjectId, db);
      if (document.evidenceHash !== pair.document.evidenceHash || hash(pair.past.archive) !== pair.past.archiveHash) throw unavailable();
    }
    records.push({ reviewId: String(row.review_id), revisionId: String(row.revision_id), version: Number(row.version), payload, payloadHash: String(row.payload_hash), actorUserId: String(row.actor_user_id), reviewedBy: row.reviewed_by == null ? null : String(row.reviewed_by), createdAt: String(row.created_at), consumed: row.consumed === true, currentIssues: [], currentValid: false, verificationStatus: "stale" });
  }
  return records;
}
const head = (records: VatFollowupRecord[]) => records.reduce<VatFollowupRecord | undefined>((latest, row) => !latest || row.version > latest.version ? row : latest, undefined);
function toInput(record: VatFollowupRecord): VatFollowupPreviewInput {
  const a = record.payload.application;
  return { requestId: "current-diagnostic", reviewId: record.reviewId, expectedVersion: record.version, application: { subjectId: a.subjectId, year: a.year, term: a.term, kind: "final", path: a.path, basisSnapshotId: a.basisSnapshotId }, state: record.payload.state === "recorded" ? "recorded" : "verified", pairs: record.payload.pairs.map(p => ({ card: { kind: "card", id: p.card.id, expectedSourceHash: p.card.sourceHash }, invoice: { kind: "hometax", id: p.invoice.id, expectedSourceHash: p.invoice.sourceHash }, historicalSide: p.historicalSide, past: p.past.origin === "legacy" ? { origin: "legacy", returnId: p.past.legacyReturnId!, expectedArchiveHash: p.past.archiveHash } : { origin: "basis", basisSnapshotId: p.past.basisSnapshotId!, factRevisionId: p.past.factRevisionId!, expectedScopeHash: p.past.scopeHash! }, documentId: p.document.documentId, evidenceLocation: p.evidenceLocation, reason: p.reason })) };
}
export async function listVatFollowupReviews(input: VatFollowupApplication, db?: PgDatabase): Promise<VatFollowupRecord[]> {
  const application = normalizeVatFollowupApplication(input);
  if (!db) return transaction(tx => listVatFollowupReviews(application, tx));
  await structure(db);
    const records = await rawRecords(db, undefined, application);
    const latest = new Map<string, number>(); for (const row of records) latest.set(row.reviewId, Math.max(latest.get(row.reviewId) ?? 0, row.version));
    let context: Context | null = null;
    for (const record of records) {
      if (record.version !== latest.get(record.reviewId) || record.payload.state !== "verified") { record.currentIssues = [issue("review_not_effective", "현재 검토 완료 말단이 아닙니다.")]; continue; }
      await db.exec("SAVEPOINT vat_followup_diagnostic");
      try {
        context ??= await loadContext(db, application);
        const evaluation = await resolvePairs(db, context, toInput(record).pairs);
        record.currentIssues = [...evaluation.issues];
        if (!equal(evaluation.pairs, record.payload.pairs) || !equal(context.application, record.payload.application)) record.currentIssues.push(issue("review_sources_changed", "저장한 검토 이후 원천·별칭·과거 근거·증빙 또는 주체가 변경됐습니다."));
        record.currentValid = !record.currentIssues.length;
        record.verificationStatus = record.currentValid ? "available" : "stale";
        await db.exec("RELEASE SAVEPOINT vat_followup_diagnostic");
      } catch (e) {
        await db.exec("ROLLBACK TO SAVEPOINT vat_followup_diagnostic");
        await db.exec("RELEASE SAVEPOINT vat_followup_diagnostic");
        record.verificationStatus = [400, 403, 404, 409].includes(Number((e as { status?: number }).status)) ? "stale" : "unavailable";
        record.currentIssues = [issue("review_verification_failed", record.verificationStatus === "unavailable" ? "현재 검토 근거의 무결성을 확인할 수 없습니다." : "현재 원천이나 과거 참조를 다시 확인해야 합니다.")];
      }
    }
    return records;
}
/** 계산·확정 호출자의 동일 DB/트랜잭션을 사용한다. 목록의 available 표시를 소비 근거로 복사하지 않는다. */
export async function loadVatFollowupConsumptionPlan(db: PgDatabase, input: VatFollowupApplication, selection: VatFollowupSelection): Promise<ValidatedVatFollowupConsumptionPlan> {
  const application = normalizeVatFollowupApplication(input);
  if (!selection || Object.keys(selection).some(k => !['subjectId', 'pairs'].includes(k)) || selection.subjectId !== application.subjectId
    || !Array.isArray(selection.pairs) || selection.pairs.length < 1 || selection.pairs.length > 100
    || selection.pairs.some(p => !p || Object.keys(p).some(k => !['revisionId', 'pairKey'].includes(k))
      || typeof p.revisionId !== 'string' || !p.revisionId.length || p.revisionId.length > 200 || p.revisionId !== p.revisionId.trim()
      || typeof p.pairKey !== 'string' || !/^[a-f0-9]{64}$/.test(p.pairKey))
    || new Set(selection.pairs.map(p => `${p.revisionId}:${p.pairKey}`)).size !== selection.pairs.length) {
    throw fail('적용할 주체와 검토 판의 정확한 거래 쌍을 선택하세요.', 400, 'vat_followup_selection_input');
  }
  await structure(db);
  const records = await rawRecords(db, undefined, application);
  const latest = new Map<string, number>();
  for (const row of records) latest.set(row.reviewId, Math.max(latest.get(row.reviewId) ?? 0, row.version));
  const context = await loadContext(db, application);
  if (context.issues.length) throw Object.assign(fail('현재 신고 주체·근거를 다시 확인하세요.', 409, 'vat_followup_selection_stale'), { issues: context.issues });
  const result: ValidatedVatFollowupConsumptionPlan = { application: context.application, pairs: [] };
  for (const revisionId of [...new Set(selection.pairs.map(p => p.revisionId))].sort()) {
    const record = records.find(r => r.revisionId === revisionId);
    if (!record || record.payload.state !== 'verified' || record.version !== latest.get(record.reviewId)) {
      throw fail('현재 유효한 검토 완료판만 적용할 수 있습니다. 기록·철회 또는 이전 판은 사용할 수 없습니다.', 409, 'vat_followup_selection_stale');
    }
    if (!equal(record.payload.application, context.application)) throw fail('검토 이후 주체·신고 근거가 변경되었습니다.', 409, 'vat_followup_selection_stale');
    const keys = new Set(selection.pairs.filter(p => p.revisionId === revisionId).map(p => p.pairKey));
    const selected = record.payload.pairs.map((pair, line) => ({ pair, line })).filter(p => keys.has(p.pair.pairKey));
    if (selected.length !== keys.size) throw fail('선택한 거래 쌍이 해당 검토 판에 없습니다.', 409, 'vat_followup_selection_stale');
    const inputs = toInput(record).pairs;
    const evaluation = await resolvePairs(db, context, selected.map(p => inputs[p.line]));
    if (!evaluation.canReview || evaluation.issues.length) throw Object.assign(fail('원천·과거 근거·증빙을 다시 검토해야 합니다.', 409, 'vat_followup_selection_stale'), { issues: evaluation.issues });
    for (const { pair, line } of selected) {
      const actual = evaluation.pairs.find(p => p.pairKey === pair.pairKey);
      if (!actual || !equal(actual, pair)) throw fail('검토 이후 원천·별칭·기공제·귀속 또는 증빙이 변경되었습니다.', 409, 'vat_followup_selection_stale');
      const current = pair.historicalSide === 'card' ? pair.invoice : pair.card;
      result.pairs.push({ reviewId: record.reviewId, revisionId, pairLineNo: line, pairKey: pair.pairKey, payloadHash: record.payloadHash,
        pair: structuredClone(actual), priorClaimedTax: actual.past.claim.claimedTax, currentClaimableTax: current.claimTax });
    }
  }
  if (new Set(result.pairs.map(p => p.pairKey)).size !== result.pairs.length) throw fail('같은 거래 쌍을 중복 적용할 수 없습니다.', 409, 'vat_followup_selection_stale');
  result.pairs.sort((a, b) => a.revisionId < b.revisionId ? -1 : a.revisionId > b.revisionId ? 1 : a.pairLineNo - b.pairLineNo);
  return result;
}
async function preview(db: PgDatabase, input: VatFollowupPreviewInput): Promise<VatFollowupPreview> {
  const normalized = normalizeVatFollowupInput(input), reviewId = normalized.reviewId ?? generated("vfr", normalized.requestId), revisionId = generated("vfrv", normalized.requestId);
  const previous = head(await rawRecords(db, reviewId));
  if ((previous?.version ?? 0) !== normalized.expectedVersion) throw fail("최신 검토 판번호로 다시 확인하세요.");
  if (previous && (previous.consumed || !equal(toInput(previous).application, normalized.application))) throw fail("소비된 검토 또는 기존 사건의 주체·적용 기간을 변경할 수 없습니다.");
  if (previous?.payload.state === "verified" && normalized.state === "recorded") throw fail("검토 완료판을 단순 기록으로 낮출 수 없습니다. 명시 철회 또는 검토한 전체 대체판을 사용하세요.");
  const context = await loadContext(db, normalized.application);
  await assertApplicationOpen(db, context.application);
  const evaluated = await resolvePairs(db, context, normalized.pairs);
  const others = await rawRecords(db, undefined, normalized.application);
  const otherHeads = new Map<string, VatFollowupRecord>(); for (const row of others) if (!otherHeads.has(row.reviewId) || otherHeads.get(row.reviewId)!.version < row.version) otherHeads.set(row.reviewId, row);
  const owned = new Set([...otherHeads.values()].filter(r => r.reviewId !== reviewId && r.payload.state === "verified").flatMap(r => r.payload.pairs.map(p => p.pairKey)));
  if (normalized.state === "verified" && evaluated.pairs.some(p => owned.has(p.pairKey))) throw fail("같은 적용 기간·원천 쌍의 검토 완료 사건이 이미 있습니다. 기존 사건의 새 판으로 검토하세요.");
  const payload: VatFollowupPayload = { schemaVersion: VAT_FOLLOWUP_REVIEW_VERSION, application: context.application, state: normalized.state, pairs: evaluated.pairs, withdrawalReason: null };
  const selectedKeys = new Set(evaluated.pairs.map(pair => pair.pairKey));
  const relevantHeads = [...otherHeads.values()].filter(row => row.payload.pairs.some(pair => selectedKeys.has(pair.pairKey)));
  return { reviewId, revisionId, version: normalized.expectedVersion + 1, normalized, payload, canReview: evaluated.canReview, issues: evaluated.issues, taxDelta: 0, applicationStatus: "not_integrated_in_ca", previewHash: hash({ normalized, payload, previous: previous?.payloadHash ?? null, otherHeads: relevantHeads.map(r => [r.reviewId, r.version, r.payloadHash]).sort() }) };
}
export async function previewVatFollowupReview(input: VatFollowupPreviewInput): Promise<VatFollowupPreview> { return transaction(db => preview(db, input)); }

async function replay(db: PgDatabase, requestId: string, action: "save" | "withdraw", payloadHash: string, actor: string): Promise<VatFollowupSaveResult | null> {
  const row = rowsToObjects(await db.exec("SELECT action,payload_hash,actor_user_id,result_json FROM vat_followup_review_requests WHERE request_id=$1", [requestId]))[0];
  if (!row) return null;
  if (row.action !== action || row.payload_hash !== payloadHash || row.actor_user_id !== actor) throw fail("같은 요청 식별자에 다른 내용 또는 담당자가 있습니다.");
  return { ...parse(row.result_json), replayed: true };
}
async function persist(db: PgDatabase, value: { reviewId: string; revisionId: string; version: number; previousRevisionId: string | null; payload: VatFollowupPayload; previewHash: string; evaluationHash: string; requestId: string; requestHash: string; action: "save" | "withdraw" }, actor: string): Promise<VatFollowupSaveResult> {
  const { payload: p } = value, a = p.application;
  await db.run("INSERT INTO vat_followup_review_roots(review_id,subject_id,collector_corp_num,application_path,period_year,period_term,period_kind,date_from,date_to,basis_snapshot_id,created_by) VALUES($1,$2,$3,$4,$5,$6,'final',$7,$8,$9,$10) ON CONFLICT(review_id) DO NOTHING", [value.reviewId, a.subjectId, a.collectorCorpNum, a.path, a.year, a.term, a.dateFrom, a.dateTo, a.basisSnapshotId, actor]);
  await db.run("INSERT INTO vat_followup_review_revisions(revision_id,review_id,version,previous_revision_id,schema_version,payload_json,payload_hash,preview_hash,evaluation_hash,state,actor_user_id,reviewed_by,request_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13)", [value.revisionId, value.reviewId, value.version, value.previousRevisionId, VAT_FOLLOWUP_REVIEW_VERSION, JSON.stringify(p), hash(p), value.previewHash, value.evaluationHash, p.state, actor, p.state === "recorded" ? null : actor, value.requestId]);
  for (const [index, pair] of p.pairs.entries()) {
    await db.run("INSERT INTO vat_followup_review_pairs(revision_id,line_no,pair_key,pair_json,card_source_id,invoice_source_id,card_source_hash,invoice_source_hash,historical_side,past_origin,legacy_return_id,past_basis_snapshot_id,past_fact_revision_id,document_id,document_hash) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)", [value.revisionId, index, pair.pairKey, JSON.stringify(pair), pair.card.id, pair.invoice.id, pair.card.sourceHash, pair.invoice.sourceHash, pair.historicalSide, pair.past.origin, pair.past.legacyReturnId, pair.past.basisSnapshotId, pair.past.factRevisionId, pair.document.documentId, pair.document.evidenceHash]);
  }
  const result: VatFollowupSaveResult = { reviewId: value.reviewId, revisionId: value.revisionId, version: value.version, state: p.state, replayed: false, applicationStatus: "not_integrated_in_ca" };
  await db.run("INSERT INTO vat_followup_review_requests(request_id,action,actor_user_id,payload_hash,result_json) VALUES($1,$2,$3,$4,$5::jsonb)", [value.requestId, value.action, actor, value.requestHash, JSON.stringify(result)]);
  await recordAuditLogInline(db, { actorUserId: actor, action: "finance_vat_filing_basis", targetTable: "vat_followup_review_revisions", targetId: value.revisionId, after: { action: `followup_${value.action}`, ...result, payloadHash: hash(p), requestId: value.requestId } });
  return result;
}
export async function saveVatFollowupReview(input: VatFollowupSaveInput, actorUserId: string): Promise<VatFollowupSaveResult> {
  const normalized = normalizeVatFollowupInput(input), actor = vatFollowupText(actorUserId, "담당자");
  if (!/^[a-f0-9]{64}$/.test(input.expectedPreviewHash ?? "")) throw fail("검토 미리보기를 먼저 확인하세요.", 400, "vat_followup_input");
  if (normalized.state === "verified" && input.reviewConfirmed !== true) throw fail("정확한 원천 쌍과 증빙을 명시적으로 검토하세요.", 400, "vat_followup_input");
  const requestHash = hash({ normalized, expectedPreviewHash: input.expectedPreviewHash, reviewConfirmed: input.reviewConfirmed === true });
  return transaction(async db => {
    const previousRequest = await replay(db, normalized.requestId, "save", requestHash, actor); if (previousRequest) return previousRequest;
    await assertSupplyGroupPrerequisites(db, process.env.FINANCE_R1_SCHEMA ?? 'public');
    const p = await preview(db, normalized);
    if (p.previewHash !== input.expectedPreviewHash) throw fail("미리보기 후 원천·과거 근거·검토 판이 변경되었습니다. 다시 확인하세요.", 409, "vat_followup_preview_changed");
    if (normalized.state === "verified" && !p.canReview) throw Object.assign(fail("별개 공급 검토를 완료할 근거가 부족합니다.", 409, "vat_followup_review_incomplete"), { issues: p.issues });
    const records = await rawRecords(db, p.reviewId), previous = head(records);
    if (records.some(r => r.consumed)) throw fail("당기 확정에서 소비한 검토는 직접 대체할 수 없습니다.", 409, "vat_followup_consumed");
    return persist(db, { reviewId: p.reviewId, revisionId: p.revisionId, version: p.version, previousRevisionId: previous?.revisionId ?? null, payload: p.payload, previewHash: p.previewHash, evaluationHash: hash({ canReview: p.canReview, issues: p.issues, taxDelta: 0 }), requestId: normalized.requestId, requestHash, action: "save" }, actor);
  });
}
/** 미소비 철회는 원래 근거를 보존한다. 현재 원천 변경이나 이후 당기 확정으로 막지 않는다. */
export async function withdrawVatFollowupReview(input: VatFollowupWithdrawInput, actorUserId: string): Promise<VatFollowupSaveResult> {
  if (!input || typeof input !== "object" || Object.keys(input).some(k => !["requestId", "reviewId", "expectedVersion", "reason"].includes(k))) throw fail("철회 입력 형식을 확인하세요.", 400, "vat_followup_input");
  const actor = vatFollowupText(actorUserId, "담당자"), requestId = vatFollowupText(input.requestId, "요청"), reviewId = vatFollowupText(input.reviewId, "검토 사건"), reason = vatFollowupText(input.reason, "철회 사유", 2000);
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw fail("철회할 최신 판번호를 확인하세요.", 400, "vat_followup_input");
  const requestHash = hash({ requestId, reviewId, expectedVersion: input.expectedVersion, reason });
  return transaction(async db => {
    const previousRequest = await replay(db, requestId, "withdraw", requestHash, actor); if (previousRequest) return previousRequest;
    await assertSupplyGroupPrerequisites(db, process.env.FINANCE_R1_SCHEMA ?? 'public');
    const records = await rawRecords(db, reviewId), previous = head(records);
    if (!previous) throw fail("철회할 검토를 찾을 수 없습니다.", 404);
    if (previous.version !== input.expectedVersion || previous.payload.state === "withdrawn") throw fail("철회할 최신 유효 판이 다릅니다.");
    if (records.some(r => r.consumed)) throw fail("당기 확정에서 소비한 검토는 직접 철회할 수 없습니다.", 409, "vat_followup_consumed");
    const payload: VatFollowupPayload = { ...structuredClone(previous.payload), state: "withdrawn", withdrawalReason: reason };
    return persist(db, { reviewId, revisionId: generated("vfrv", requestId), version: previous.version + 1, previousRevisionId: previous.revisionId, payload, previewHash: hash({ previous: previous.payloadHash, reason }), evaluationHash: hash({ canReview: true, issues: [], taxDelta: 0 }), requestId, requestHash, action: "withdraw" }, actor);
  });
}
