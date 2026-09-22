import { rowsToObjects, withDbWrite, type PgDatabase } from '@/lib/db';
import { lockAccountingWrite } from './write-lock';
import { currentVatFilingSubject, readVatFilingArchive } from './vat-filing-basis';
import type { VatFilingScopeResult } from './vat-filing-scope';
import { listVatFilingDocuments } from './vat-filing-documents';
import { assertVatFinalizationOpen } from './vat-finalization-boundary';
import { buildBasisVatReturn, vatReturnCollectorCorpNum } from './vat-return-basis';
import { buildVatReturn, vatPeriod, type VatReturnForm } from './vat-return';
import { loadTransactionLinkState, type TransactionLinkSource } from './transaction-links';
import { listVatFollowupReviews, loadVatFollowupConsumptionPlan } from './vat-followup-review';
import { assertVatFollowupConsumptionStructure } from './vat-followup-consumption';
import { normalizeVatFollowupApplication, vatFollowupHash, vatFollowupPairKey, vatFollowupPeriods } from './vat-followup-review-pure';
import type { VatFollowupApplication, VatFollowupIssue, VatFollowupPastRef, VatFollowupPayload } from './vat-followup-review-types';
import type { VatFollowupSelection } from './vat-followup-consumption-types';
import type { VatFollowupDisplayPayload, VatFollowupWorkspace, VatFollowupWorkspaceApplication, VatFollowupWorkspaceCandidate, VatFollowupWorkspaceRecord } from './vat-followup-workspace-types';

const fail = (message: string, status = 400, code = 'vat_followup_workspace_input') => Object.assign(new Error(message), { status, code });
const unavailable = () => fail('후행 검토의 조회 구조 또는 저장 근거를 검증할 수 없습니다. 적용한 자료구조와 보관 원문을 확인하세요.', 503, 'vat_followup_workspace_unavailable');
const parse = (v: unknown): any => typeof v === 'string' ? JSON.parse(v) : v;
const id = (v: unknown): v is string => typeof v === 'string' && v === v.trim() && v.length > 0 && v.length <= 200 && !/[\u0000-\u001f\u007f]/.test(v);
const issue = (code: string, message: string, pairKey?: string): VatFollowupIssue => ({ code, message, ...(pairKey ? { pairKey } : {}) });

/** 기존 Date.toString()/ISO 표시 원문은 보존하고, 명시된 시간대로만 정렬한다. */
function recordTime(value: string): number {
  if (typeof value !== 'string') throw unavailable();
  const iso = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})$/.exec(value);
  const native = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT([+-]\d{4})(?: \([^()\r\n]*\))?$/.exec(value);
  if (!iso && !native) throw unavailable();
  const year = Number(iso?.[1] ?? native![4]), month = iso ? Number(iso[2]) - 1 : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(native![2]);
  const day = Number(iso?.[3] ?? native![3]), hour = Number(iso?.[4] ?? native![5]), minute = Number(iso?.[5] ?? native![6]), second = Number(iso?.[6] ?? native![7]);
  const millis = iso ? Number((iso[7] ?? '').padEnd(3, '0').slice(0, 3)) : 0;
  const zone = (iso?.[8] ?? native![8]).replace(':', '');
  const zoneHours = zone === 'Z' ? 0 : Number(zone.slice(1, 3)), zoneMinutes = zone === 'Z' ? 0 : Number(zone.slice(3, 5));
  if (year < 1000 || month < 0 || month > 11 || hour > 23 || minute > 59 || second > 59 || zoneHours > 23 || zoneMinutes > 59) throw unavailable();
  const local = new Date(Date.UTC(year, month, day, hour, minute, second, millis));
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month || local.getUTCDate() !== day || native && ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][local.getUTCDay()] !== native[1]) throw unavailable();
  const time = local.getTime() - (zone === 'Z' ? 0 : (zone[0] === '-' ? -1 : 1) * (zoneHours * 60 + zoneMinutes) * 60000);
  if (!Number.isFinite(time)) throw unavailable();
  return time;
}
export function orderVatFollowupWorkspaceRecords<T extends { createdAt: string; version: number; revisionId: string }>(records: readonly T[]): T[] {
  return records.map(record => ({ record, time: recordTime(record.createdAt) }))
    .sort((x, y) => y.time - x.time || y.record.version - x.record.version || x.record.revisionId.localeCompare(y.record.revisionId)).map(item => item.record);
}

/** 선택은 식별자만 받는다. 금액·원천·과거 명세는 저장된 판에서 다시 읽는다. */
export function parseVatFollowupSelection(value: unknown): VatFollowupSelection | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('적용할 정확한 검토 쌍을 선택하세요.');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !['subjectId', 'pairs'].includes(k)) || !id(v.subjectId) || !Array.isArray(v.pairs) || v.pairs.length < 1 || v.pairs.length > 100) throw fail('신고 주체와 1~100개의 정확한 검토 쌍이 필요합니다.');
  const pairs = v.pairs.map(p => {
    if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some(k => !['revisionId', 'pairKey'].includes(k)) || !id(p.revisionId) || typeof p.pairKey !== 'string' || !/^[a-f0-9]{64}$/.test(p.pairKey)) throw fail('검토 판과 원천 쌍의 식별자를 확인하세요.');
    return { revisionId: p.revisionId as string, pairKey: p.pairKey as string };
  });
  if (new Set(pairs.map(p => `${p.revisionId}:${p.pairKey}`)).size !== pairs.length) throw fail('같은 검토 쌍을 중복 선택할 수 없습니다.');
  return { subjectId: v.subjectId, pairs };
}

/** 최대 100쌍의 사유·문서 위치를 담는 메타데이터만 받는다. 증빙 바이트는 기존 문서 API를 사용한다. */
export async function readVatFollowupJson(req: Request): Promise<Record<string, unknown>> {
  const maximum = 1024 * 1024, declared = req.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw fail('요청은 1MiB 이하로 나누어 입력하세요.');
  if (!req.body) throw fail('입력 JSON이 필요합니다.');
  const reader = req.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > maximum) { await reader.cancel(); throw fail('요청은 1MiB 이하로 나누어 입력하세요.'); } chunks.push(next.value); }
    try { const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
    catch { throw fail('입력 JSON 형식이 올바르지 않습니다.'); }
  } finally { reader.releaseLock(); }
}

function identifiers(card: Record<string, unknown> | undefined, invoice: Record<string, unknown> | undefined): string[] {
  return [card?.approval_num ? `카드 승인번호: ${card.approval_num}` : '', invoice?.nts_send_key ? `계산서 국세청 전송번호: ${invoice.nts_send_key}` : ''].filter(Boolean);
}
function sourceRef(source: TransactionLinkSource | undefined, kind: 'card' | 'hometax') {
  return source ? { kind, id: source.id, expectedSourceHash: source.sourceHash } : null;
}
/** API에는 검토·재입력에 필요한 명세만 보낸다. 저장 원문/지문 계산은 변경하지 않는다. */
export function vatFollowupDisplayPayload(payload: VatFollowupPayload): VatFollowupDisplayPayload {
  return { ...payload, pairs: payload.pairs.map(pair => {
    const { sourceBasis: _cardRaw, aliases: _cardAliases, ...card } = pair.card;
    const { sourceBasis: _invoiceRaw, aliases: _invoiceAliases, ...invoice } = pair.invoice;
    const { archive: _archive, ...past } = pair.past;
    const { databaseProof: _proof, ...rest } = pair;
    return { ...rest, card, invoice, past };
  }) };
}
async function diagnostic<T>(db: PgDatabase, fn: () => Promise<T>): Promise<{ value: T; error?: never } | { value?: never; error: VatFollowupIssue }> {
  await db.exec('SAVEPOINT vat_followup_workspace_read');
  try { const value = await fn(); await db.exec('RELEASE SAVEPOINT vat_followup_workspace_read'); return { value }; }
  catch (e) {
    await db.exec('ROLLBACK TO SAVEPOINT vat_followup_workspace_read'); await db.exec('RELEASE SAVEPOINT vat_followup_workspace_read');
    const error = e as { status?: number; code?: string; message?: string };
    if (![400, 404, 409].includes(error.status ?? 0)) throw e;
    return { error: issue(error.code ?? 'vat_followup_current_unavailable', error.message ?? '현재 원천과 과거 근거를 다시 확인하세요.') };
  }
}

async function workspace(db: PgDatabase, input?: VatFollowupApplication, page = 1, recordPage = 1): Promise<VatFollowupWorkspace> {
  await assertVatFollowupConsumptionStructure(db);
  const subjectRows = rowsToObjects(await db.exec('SELECT subject_id FROM vat_filing_subjects ORDER BY subject_id'));
  const subjects = new Map<string, Awaited<ReturnType<typeof currentVatFilingSubject>>>();
  for (const row of subjectRows) subjects.set(String(row.subject_id), await currentVatFilingSubject(db, String(row.subject_id)));
  const bases = rowsToObjects(await db.exec("SELECT snapshot_id,subject_id,scope_hash,period_year,period_term,scope_json FROM vat_filing_basis_snapshots WHERE period_kind='final' ORDER BY period_year DESC,period_term DESC,snapshot_id"));
  const applications: VatFollowupWorkspaceApplication[] = bases.map(b => {
    const scope = parse(b.scope_json) as VatFilingScopeResult;
    if (!scope || scope.subjectId !== b.subject_id || scope.scopeHash !== b.scope_hash || scope.year !== Number(b.period_year) || scope.term !== Number(b.period_term) || scope.kind !== 'final') throw unavailable();
    return { application: { subjectId: String(b.subject_id), year: Number(b.period_year), term: Number(b.period_term) as 1 | 2, kind: 'final', path: 'basis', basisSnapshotId: String(b.snapshot_id) }, label: `${b.period_year}년 ${b.period_term}기 확정 · 봉인 근거`, corpNum: scope.evidenceSnapshot.subject.corpNum, scopeHash: String(b.scope_hash), readOnlyCalculation: false };
  });
  const legacyPeriods = rowsToObjects(await db.exec("SELECT DISTINCT period_year,period_term FROM vat_returns WHERE period_kind='pre' AND status='confirmed' ORDER BY period_year DESC,period_term DESC"));
  for (const subject of subjects.values()) if (subject.corpNum === vatReturnCollectorCorpNum()) for (const p of legacyPeriods) applications.push({ application: { subjectId: subject.subjectId, year: Number(p.period_year), term: Number(p.period_term) as 1 | 2, kind: 'final', path: 'legacy', basisSnapshotId: null }, label: `${p.period_year}년 ${p.period_term}기 · 과거 내부 신고 검토(계산 읽기 전용)`, corpNum: subject.corpNum, scopeHash: null, readOnlyCalculation: true });
  const result: VatFollowupWorkspace = { integrationMode: 'explicit_selection', applications, application: input ?? null, scopeHash: null, records: [], recordPage, recordPageSize: 10, recordTotal: 0, candidates: [], candidatePage: page, candidatePageSize: 50, candidateTotal: 0, documents: [], consumptions: [], canCreateReview: false, issues: [] };
  if (!input) return result;
  const a = normalizeVatFollowupApplication(input), dates = vatFollowupPeriods(a);
  const subjectCheck = await diagnostic(db, async () => {
    const subject = await currentVatFilingSubject(db, a.subjectId, { from: dates.priorFrom, to: dates.dateTo });
    if (subject.corpNum !== vatReturnCollectorCorpNum() || !subject.corpNum || subject.state !== 'verified' || subject.entityType !== 'corporation' || subject.vatRegime !== 'general' || subject.filingUnit !== 'single_business_place' || subject.effectiveFrom > dates.priorFrom || subject.effectiveTo !== null && subject.effectiveTo < dates.dateTo) throw fail('해당 반기와 서버 수집 주체에 맞는 검증된 단일 사업장 기준을 먼저 확인하세요.', 409, 'vat_followup_subject_unavailable');
    return subject;
  });
  result.application = a;
  result.documents = await listVatFilingDocuments(a.subjectId, db);
  const open = await diagnostic(db, () => assertVatFinalizationOpen(db, a));
  result.canCreateReview = !open.error && !subjectCheck.error;
  if (open.error) result.issues.push(open.error);
  if (subjectCheck.error) result.issues.push(subjectCheck.error);
  const records = await listVatFollowupReviews(a, db);
  const latest = new Map<string, number>(); for (const row of records) latest.set(row.reviewId, Math.max(latest.get(row.reviewId) ?? 0, row.version));
  const consumptions = rowsToObjects(await db.exec(`SELECT r.review_id,c.revision_id,p.pair_key,c.basis_confirmation_id,b.return_id AS basis_return_id,l.return_id AS legacy_return_id
    FROM vat_followup_review_consumptions c JOIN vat_followup_review_revisions r ON r.revision_id=c.revision_id
    JOIN vat_followup_review_pairs p ON p.revision_id=c.revision_id AND p.line_no=c.pair_line_no
    LEFT JOIN vat_filing_return_confirmations b ON b.confirmation_id=c.basis_confirmation_id
    LEFT JOIN vat_followup_legacy_archives l ON l.archive_id=c.legacy_archive_id WHERE c.revision_id=ANY($1::text[]) ORDER BY c.revision_id,p.pair_key`, [records.map(r => r.revisionId)]));
  result.consumptions = consumptions.map(c => { if (!c.basis_return_id && !c.legacy_return_id) throw unavailable(); return { reviewId: String(c.review_id), revisionId: String(c.revision_id), pairKey: String(c.pair_key), path: c.basis_confirmation_id ? 'basis' : 'legacy', returnId: String(c.basis_return_id ?? c.legacy_return_id), confirmationId: c.basis_confirmation_id ? String(c.basis_confirmation_id) : null }; });
  result.recordTotal = records.length;
  const orderedRecords = orderVatFollowupWorkspaceRecords(records);
  for (const record of orderedRecords.slice((recordPage - 1) * result.recordPageSize, recordPage * result.recordPageSize)) {
    const isLatest = latest.get(record.reviewId) === record.version;
    const reason = !isLatest ? '이전 검토 판입니다.' : record.payload.state !== 'verified' ? '현재 검토 완료판만 선택할 수 있습니다.' : record.consumed ? '확정 신고에서 이미 사용한 검토입니다.' : open.error?.message ?? subjectCheck.error?.message ?? null;
    const row: VatFollowupWorkspaceRecord = { ...record, payload: vatFollowupDisplayPayload(record.payload), latest: isLatest, canSelect: false, canWithdraw: isLatest && record.payload.state !== 'withdrawn' && !records.some(r => r.reviewId === record.reviewId && r.consumed), selectionUnavailableReason: reason, pairSelections: [] };
    for (const pair of record.payload.pairs) {
      let invalid = reason;
      if (!invalid && !record.currentValid) { const checked = await diagnostic(db, () => loadVatFollowupConsumptionPlan(db, a, { subjectId: a.subjectId, pairs: [{ revisionId: record.revisionId, pairKey: pair.pairKey }] })); invalid = checked.error?.message ?? null; }
      const current = pair.historicalSide === 'card' ? pair.invoice : pair.card;
      row.pairSelections.push({ revisionId: record.revisionId, pairKey: pair.pairKey, canSelect: !invalid, selectionUnavailableReason: invalid, priorClaimedTax: pair.past.claim.claimedTax, currentClaimableTax: current.claimTax, pastLabel: pair.past.origin === 'legacy' ? `내부 예정 신고 ${pair.past.from}~${pair.past.to} (외부 접수 인증 아님)` : `봉인 기신고 명세 ${pair.past.from}~${pair.past.to}`, officialIdentifiers: identifiers(pair.card.sourceBasis.raw, pair.invoice.sourceBasis.raw), documentFileName: result.documents.find(d => d.documentId === pair.document.documentId)?.fileName ?? '보관 증빙' });
    }
    row.canSelect = row.pairSelections.some(p => p.canSelect);
    row.selectionUnavailableReason ??= row.canSelect ? null : row.pairSelections.find(p => p.selectionUnavailableReason)?.selectionUnavailableReason ?? '현재 적용 가능한 쌍이 없습니다.';
    result.records.push(row);
  }
  let scope: VatFilingScopeResult | null = null;
  if (a.path === 'basis') {
    const archive = await readVatFilingArchive({ origin: 'basis', id: a.basisSnapshotId! }, db);
    scope = archive.scope as VatFilingScopeResult;
    if (scope.subjectId !== a.subjectId || scope.year !== a.year || scope.term !== a.term || scope.kind !== 'final') throw fail('선택한 신고 주체·기수와 봉인 근거가 다릅니다.', 409, 'vat_followup_application_mismatch');
    result.scopeHash = scope.scopeHash;
  }
  const computed = await diagnostic<VatReturnForm>(db, () => scope ? buildBasisVatReturn({ basisSnapshotId: a.basisSnapshotId!, expectedScopeHash: scope.scopeHash }, db) : buildVatReturn(vatPeriod(a.year, a.term, 'final'), undefined, db));
  if (computed.error) { result.issues.push(computed.error); return result; }
  const review = computed.value.duplicateReview;
  if (!review) throw unavailable();
  result.issues.push(...review.historyIssues.map(message => issue('vat_followup_history_unavailable', message)));
  const links = await loadTransactionLinkState(db), sources = new Map(links.sources.map(s => [`${s.kind}:${s.id}`, s]));
  const legacyArchives = new Map<string, any>();
  const filingConsumptions = scope ? rowsToObjects(await db.exec("SELECT revision_id,fact_id FROM vat_filing_basis_consumptions WHERE snapshot_id=$1 AND kind='filing'", [a.basisSnapshotId])) : [];
  const candidates: VatFollowupWorkspaceCandidate[] = [];
  for (const group of review.candidateGroups) for (const card of group.cards) for (const invoice of group.invoices) {
    if (card.origin === 'prior_confirmed' && invoice.origin === 'prior_confirmed') continue;
    const pairKey = vatFollowupPairKey(card.sourceId, invoice.sourceId), cardSource = sources.get(`card:${card.sourceId}`), invoiceSource = sources.get(`hometax:${invoice.sourceId}`);
    const historicalSide = card.origin === 'prior_confirmed' && invoice.origin === 'current' ? 'card' : invoice.origin === 'prior_confirmed' && card.origin === 'current' ? 'invoice' : null;
    const historical = historicalSide === 'card' ? card : historicalSide === 'invoice' ? invoice : null, current = historicalSide === 'card' ? invoice : historicalSide === 'invoice' ? card : null;
    const problems: VatFollowupIssue[] = [];
    let past: VatFollowupPastRef | null = null, pastLabel = '정확한 과거 공제 명세를 확인해야 합니다.';
    if (!historical || !current) problems.push(issue('vat_followup_pair_scope', '이 후행 검토는 같은 반기의 과거 기신고 원천과 당기 원천 쌍에 적용합니다.', pairKey));
    else if (a.path === 'legacy' && historical.returnId) {
      if (!legacyArchives.has(historical.returnId)) legacyArchives.set(historical.returnId, parse(rowsToObjects(await db.exec('SELECT to_jsonb(r) AS archive FROM vat_returns r WHERE return_id=$1', [historical.returnId]))[0]?.archive));
      const archive = legacyArchives.get(historical.returnId);
      if (archive) { past = { origin: 'legacy', returnId: historical.returnId, expectedArchiveHash: vatFollowupHash(archive) }; pastLabel = `내부 예정 신고 ${archive.date_from}~${archive.date_to} (외부 접수 인증 아님)`; }
    } else if (scope) {
      const source = historicalSide === 'card' ? cardSource : invoiceSource;
      const aliases = links.sources.filter(s => s.canonicalKey === source?.canonicalKey);
      const facts = scope.evidenceSnapshot.facts.filter(f => f.kind === 'filing' && f.state === 'verified' && scope!.effectiveFactRevisionIds.includes(f.revisionId) && filingConsumptions.some(c => c.revision_id === f.revisionId && c.fact_id === f.factId) && f.sourceCoverage.some(c => c.canonicalKey === source?.canonicalKey && aliases.some(s => s.kind === c.sourceKind && s.id === c.sourceId)));
      if (facts.length === 1) { past = { origin: 'basis', basisSnapshotId: a.basisSnapshotId!, factRevisionId: facts[0].revisionId, expectedScopeHash: scope.scopeHash }; pastLabel = `봉인 기신고 명세 ${facts[0].from}~${facts[0].to}${facts[0].data.externalKey ? ` · ${facts[0].data.externalKey}` : ''}`; }
    }
    if (!past) problems.push(issue('vat_followup_past_claim_missing', '서버에서 과거 명세를 하나로 연결하지 못했습니다.', pairKey));
    if (!cardSource || !invoiceSource) problems.push(issue('vat_followup_source_missing', '현재 원천이 없거나 식별할 수 없습니다.', pairKey));
    const existingLinks = links.links.filter(l => l.state === 'active' && l.left.kind === 'card' && l.left.id === card.sourceId && l.right.kind === 'hometax' && (l.right.id === invoice.sourceId || l.rightSnapshot.canonicalKey === invoice.canonicalKey));
    if (existingLinks.some(l => l.relation === 'card_invoice' || l.relation === 'distinct')) problems.push(issue('vat_followup_existing_relation', '이미 동일·별개 공급 연결이 있는 쌍은 후행 검토로 다시 해소하지 않습니다.', pairKey));
    if (review.historyStatus !== 'complete') problems.push(issue('vat_followup_history_unavailable', '과거 원천 대사를 먼저 확인하세요.', pairKey));
    if (records.some(r => latest.get(r.reviewId) === r.version && r.payload.state === 'verified' && r.payload.pairs.some(p => p.pairKey === pairKey))) problems.push(issue('vat_followup_existing_review', '검토 완료 사건이 있습니다. 아래 원장에서 해당 판을 선택하거나 검토하세요.', pairKey));
    candidates.push({ pairKey, groupId: group.id, card, invoice, cardRef: sourceRef(cardSource, 'card'), invoiceRef: sourceRef(invoiceSource, 'hometax'), historicalSide, past, pastLabel, officialIdentifiers: identifiers(cardSource?.raw, invoiceSource?.raw), priorClaimedTax: historical?.tax ?? null, currentClaimableTax: current?.tax ?? null, canStartReview: result.canCreateReview && !problems.length, issues: problems });
  }
  result.candidateTotal = candidates.length;
  result.candidates = candidates.slice((page - 1) * result.candidatePageSize, page * result.candidatePageSize);
  return result;
}

export async function getVatFollowupWorkspace(input?: VatFollowupApplication, page = 1, recordPage = 1): Promise<VatFollowupWorkspace> {
  if ([page, recordPage].some(p => !Number.isSafeInteger(p) || p < 1 || p > 100000)) throw fail('조회 페이지 번호를 확인하세요.');
  const application = input === undefined ? undefined : normalizeVatFollowupApplication(input);
  for (let attempt = 0; ; attempt++) {
    try { return await withDbWrite(async db => { await lockAccountingWrite(db); return workspace(db, application, page, recordPage); }, { accountingSnapshot: true }); }
    catch (e) { const error = e as { status?: number; code?: string }; if (attempt < 2 && ['40001', '40P01'].includes(error.code ?? '')) continue; if (error.status) throw e; if (['40001', '40P01'].includes(error.code ?? '')) throw fail('다른 작업이 근거를 변경했습니다. 다시 조회하세요.', 409, 'vat_followup_concurrent_change'); throw unavailable(); }
  }
}
