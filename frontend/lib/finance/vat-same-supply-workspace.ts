import { withDbRead, type PgDatabase } from '@/lib/db';
import { readVatFilingArchive } from './vat-filing-basis';
import { assertVatUsePrerequisites } from './vat-use-prerequisites';
import type { SupplySameRecord } from './supply-same-types';
import type { SupplyGroupRecord } from './supply-group-types';
import type { VatSameReviewKind, VatSameSupplyCandidate, VatSameSupplyWorkspace, VatSameSupplyExact, VatSameSupplyUse } from './vat-same-supply-workspace-types';

const fail = (message: string, status = 400, code = 'vat_same_supply_input') => Object.assign(new Error(message), { status, code });
const unavailable = () => fail('같은 공급의 보관 자료를 검증할 수 없습니다. 저장 근거와 적용 구조를 확인하세요.', 503, 'vat_same_supply_unavailable');
export function sameWorkspaceId(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) throw fail('검토 또는 신고 자료의 식별자를 확인하세요.');
  return value;
}
export function sameWorkspaceKind(value: unknown): VatSameReviewKind {
  if (value !== 'same' && value !== 'group') throw fail('검토 종류를 확인하세요.');
  return value;
}
function value<T>(result: Awaited<ReturnType<PgDatabase['exec']>>): T {
  const raw = result[0]?.values[0]?.[0]; if (raw === undefined) throw unavailable();
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
}
async function read<T>(work: (db: PgDatabase) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) try {
    return await withDbRead(async db => { await assertVatUsePrerequisites(db, process.env.FINANCE_R1_SCHEMA ?? 'public'); return work(db); });
  } catch (error) {
    const e = error as { code?: string; status?: number };
    if (['40001', '40P01'].includes(e.code ?? '') && attempt < 2) continue;
    if ([400, 403, 404, 409, 503].includes(e.status ?? 0)) throw error;
    if (e.code === '22023') throw fail('조회할 회사·사건·페이지를 확인하세요.');
    throw unavailable();
  }
}
function checkedRecord(kind: VatSameReviewKind, record: SupplySameRecord | SupplyGroupRecord, subjectId: string) {
  if (!record || record.financialUseSupported !== false || record.preview?.financialUseSupported !== false || record.draft?.subjectId !== subjectId
    || !Number.isSafeInteger(record.version) || record.version < 1 || ![kind === 'same' ? 'verified_same' : 'verified_group', 'withdrawn'].includes(record.state)) throw unavailable();
  try { sameWorkspaceId(record.caseId); sameWorkspaceId(record.revisionId); } catch { throw unavailable(); }
  return record;
}
function candidate(kind: VatSameReviewKind, record: SupplySameRecord | SupplyGroupRecord): VatSameSupplyCandidate {
  const documents = kind === 'same' ? [(record as SupplySameRecord).preview.left, (record as SupplySameRecord).preview.right]
    : [(record as SupplyGroupRecord).preview.singleton, ...(record as SupplyGroupRecord).preview.members];
  const summaries = documents.filter((row): row is NonNullable<typeof row> => !!row).map((row, index) => {
    if (![row.supply, row.tax, row.total].every(Number.isSafeInteger) || row.supply + row.tax !== row.total || typeof row.date !== 'string') throw unavailable();
    return { label: kind === 'same' ? `${index + 1}번 문서` : index === 0 ? '기준 문서' : `구성 문서 ${index}`, date: row.date, supply: row.supply, tax: row.tax, total: row.total };
  });
  return { kind, caseId: record.caseId, revisionId: record.revisionId, version: record.version, state: record.state,
    reason: record.state === 'withdrawn' ? record.withdrawalReason ?? '' : record.draft.reason, createdAt: record.createdAt,
    canSelectForCalculation: record.state !== 'withdrawn', documents: summaries };
}
/** Relation records are candidates, not a claim that their tax is deductible. Calculation rechecks the entire selection. */
export async function loadVatSameSupplyWorkspace(basisSnapshotId: string, reviewKind: string, cursor?: string): Promise<VatSameSupplyWorkspace> {
  const basisId = sameWorkspaceId(basisSnapshotId), kind = sameWorkspaceKind(reviewKind), after = cursor === undefined ? null : sameWorkspaceId(cursor);
  return read(async db => {
    const archive = await readVatFilingArchive({ origin: 'basis', id: basisId }, db), scope = archive.scope;
    if (!scope || archive.record?.subject_id !== scope.subjectId || archive.record?.scope_hash !== scope.scopeHash) throw unavailable();
    if (scope.kind !== 'final') throw fail('같은 공급 사용은 봉인 근거가 있는 확정신고에서 지원합니다.', 409, 'vat_same_supply_scope_unsupported');
    const list = value<{ records: (SupplySameRecord | SupplyGroupRecord)[]; hasMore: boolean; nextCursor: string | null }>(await db.exec(
      kind === 'same' ? 'SELECT finance_same_list($1,NULL,$2)' : 'SELECT finance_group_list($1,NULL,$2)', [scope.subjectId, after]));
    if (!list || !Array.isArray(list.records) || typeof list.hasMore !== 'boolean' || list.hasMore !== (typeof list.nextCursor === 'string' && list.nextCursor.length > 0) || !list.hasMore && list.nextCursor !== null) throw unavailable();
    return { basis: { basisSnapshotId: basisId, subjectId: scope.subjectId, scopeHash: scope.scopeHash, dateFrom: scope.dateFrom, dateTo: scope.dateTo, kind: 'final' },
      kind, records: list.records.map(row => candidate(kind, checkedRecord(kind, row, scope.subjectId))), hasMore: list.hasMore, nextCursor: list.nextCursor };
  });
}
/** Uses and the exact historical record are read in one immutable snapshot; current source diagnostics do not replace old evidence. */
export async function readVatSameSupplyExact(subjectId: string, reviewKind: string, caseId: string, revisionId: string): Promise<VatSameSupplyExact> {
  const subject = sameWorkspaceId(subjectId), kind = sameWorkspaceKind(reviewKind), caseKey = sameWorkspaceId(caseId), revision = sameWorkspaceId(revisionId);
  return read(async db => {
    const result = value<{ record: SupplySameRecord | SupplyGroupRecord; evidence: VatSameSupplyExact['evidence'] } | null>(await db.exec('SELECT finance_supply_usage_review($1,$2,$3,$4)', [subject, kind, caseKey, revision]));
    if (!result?.record) throw fail('요청한 확인판을 찾을 수 없습니다.', 404, 'vat_same_supply_record_missing');
    const record = checkedRecord(kind, result.record, subject);
    if (record.caseId !== caseKey || record.revisionId !== revision) throw unavailable();
    try { sameWorkspaceId(result.evidence?.documentId); if (kind === 'group') sameWorkspaceId(result.evidence?.manifestId); } catch { throw unavailable(); }
    if (kind === 'same' && (result.evidence.manifestId !== null || result.evidence.documentId !== (record as SupplySameRecord).draft.evidence.documentId)
      || kind === 'group' && result.evidence.manifestId !== (record as SupplyGroupRecord).draft.evidenceManifestId) throw unavailable();
    const used = value<{ uses: VatSameSupplyUse[] }>(await db.exec('SELECT finance_vat_use_list($1,$2,$3)', [subject, kind, revision]));
    if (!used || !Array.isArray(used.uses) || used.uses.some(row => row.subjectId !== subject || row.journalUseStatus !== 'not_applied'
      || !Array.isArray(row.selections) || !row.selections.some(s => s.kind === kind && s.caseId === caseKey && s.revisionId === revision) || !Array.isArray(row.effects))) throw unavailable();
    return { kind, record, evidence: result.evidence, uses: used.uses };
  });
}
export async function resolveVatSameSupplyCase(subjectId: string, reviewKind: string, portionIds: unknown) {
  const subject = sameWorkspaceId(subjectId), kind = sameWorkspaceKind(reviewKind);
  if (!Array.isArray(portionIds) || portionIds.length < 2 || portionIds.length > 21 || kind === 'same' && portionIds.length !== 2) throw fail('확인할 문서 전체 조합을 확인하세요.');
  const portions = portionIds.map(sameWorkspaceId);
  if (new Set(portions).size !== portions.length) throw fail('문서 전체가 중복되었습니다.');
  const normalized = kind === 'same' ? [...portions].sort() : [portions[0], ...portions.slice(1).sort()];
  return read(async db => {
    const record = value<{ caseId: string; revisionId: string; version: number } | null>(await db.exec('SELECT finance_supply_review_case($1,$2,$3::jsonb)', [subject, kind, JSON.stringify(normalized)]));
    if (record && (!Number.isSafeInteger(record.version) || record.version < 1)) throw unavailable();
    if (record) try { sameWorkspaceId(record.caseId); sameWorkspaceId(record.revisionId); } catch { throw unavailable(); }
    return { record };
  });
}
