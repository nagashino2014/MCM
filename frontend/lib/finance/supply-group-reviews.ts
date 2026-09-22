import { rowsToObjects, withDbRead, withDbWrite, type PgDatabase } from '@/lib/db';
import { recordAuditLogInline } from '@/lib/auth/audit';
import { lockAccountingWrite } from './write-lock';
import { assertSupplyGroupPrerequisites } from './supply-group-prerequisites';
import { readVatFilingDocument, requireVatFilingDocument } from './vat-filing-documents';
import { readRecognitionSubjects } from './recognition-review-subjects';
import { strictRecognitionSubject } from './recognition-review-pure';
import { inspectGroupPdf, inspectGroupPdfMetadata, renderGroupPdfPage } from './supply-group-pdf';
import { validateDocumentList } from './supply-document-validation';
import { groupError, groupHash, groupId, groupKeys, groupObject, groupUnavailable,
  validateGroupEvidence, validateGroupPreviewInput, validateGroupRegions, validateGroupWithdraw } from './supply-group-pure';
import type { SupplyGroupEvidenceDiagnostics, SupplyGroupEvidenceInput, SupplyGroupEvidenceResult, SupplyGroupList, SupplyGroupPreview, SupplyGroupPreviewInput,
  SupplyGroupResult, SupplyGroupSaveInput, SupplyGroupWithdrawInput } from './supply-group-types';

function failure(error: unknown): never {
  const e = error as { status?: number; code?: string };
  if ([400, 403, 404, 409, 503].includes(e.status ?? 0)) throw error;
  if (['23503', '23505', '23514', '40001', '40P01'].includes(e.code ?? '')) throw groupError('근거 또는 최신 확인판이 바뀌었습니다. 다시 확인하세요.', 409, 'supply_group_conflict');
  if (e.code === '22023') throw groupError('전체 대응 검토 입력을 확인하세요.');
  throw groupUnavailable();
}
async function transaction<T>(write: boolean, fn: (db: PgDatabase) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const work = async (db: PgDatabase) => {
        if (write) await lockAccountingWrite(db);
        await assertSupplyGroupPrerequisites(db, process.env.FINANCE_R1_SCHEMA ?? 'public');
        return fn(db);
      };
      return write ? await withDbWrite(work) : await withDbRead(work);
    } catch (error) {
      if (attempt < 2 && ['40001', '40P01'].includes(String((error as { code?: string }).code))) continue;
      return failure(error);
    }
  }
}
function resultValue<T>(r: Awaited<ReturnType<PgDatabase['exec']>>): T {
  const v = r[0]?.values[0]?.[0]; if (v === undefined || v === null) throw groupUnavailable();
  return (typeof v === 'string' ? JSON.parse(v) : v) as T;
}
function validResult(v: SupplyGroupResult): SupplyGroupResult {
  if (!v || v.financialUseSupported !== false || !['verified_group', 'withdrawn'].includes(v.state)
    || !Number.isSafeInteger(v.version) || v.version < 1 || typeof v.replayed !== 'boolean') throw groupUnavailable();
  try { groupId(v.caseId); groupId(v.revisionId); } catch { throw groupUnavailable(); }
  return v;
}
function validPreview(v: SupplyGroupPreview): SupplyGroupPreview {
  if (!v || v.schemaVersion !== 'de1b-group-preview-v1' || v.financialUseSupported !== false || typeof v.canVerify !== 'boolean'
    || !Array.isArray(v.issues) || !Array.isArray(v.members) || !Array.isArray(v.timeDiagnostics)
    || !/^[a-f0-9]{64}$/.test(v.previewHash) || v.canVerify !== (v.issues.length === 0)) throw groupUnavailable();
  for (const side of [v.singleton, ...v.members]) if (side && (![side.supply, side.tax, side.total].every(Number.isSafeInteger) || side.supply + side.tax !== side.total)) throw groupUnavailable();
  return v;
}
function validEvidence(v: SupplyGroupEvidenceResult): SupplyGroupEvidenceResult {
  if (!v || v.verificationLevel !== 'human_review' || typeof v.replayed !== 'boolean') throw groupUnavailable();
  try { groupId(v.manifestId); groupHash(v.manifestHash); } catch { throw groupUnavailable(); }
  return v;
}
async function requireSubject(db: PgDatabase, subject: string) {
  if (!rowsToObjects(await db.exec('SELECT subject_id FROM vat_filing_subjects WHERE subject_id=$1', [subject])).length) throw groupError('회사 기준을 찾을 수 없습니다.', 404, 'supply_group_subject_missing');
}
async function pdfDocument(db: PgDatabase, subject: string, document: string, expectedHash?: string) {
  await requireSubject(db, subject);
  const doc = await readVatFilingDocument(document, subject, db);
  if (expectedHash !== undefined && doc.evidenceHash !== expectedHash) throw groupError('선택한 보관 원문이 다릅니다.', 409, 'supply_group_document_changed');
  if (doc.contentType !== 'application/pdf') throw groupError('이번 원문 위치 검토는 PDF를 지원합니다.', 400, 'supply_group_pdf_required');
  return doc;
}

/** READ ONLY snapshot yields complete immutable bytes; expensive rendering holds no DB connection. */
export async function inspectSupplyGroupEvidence(input: unknown) {
  const p = groupObject(input), hasRegions = Object.hasOwn(p, 'regions');
  groupKeys(p, ['subjectId', 'documentId', 'evidenceHash', ...(hasRegions ? ['regions'] : [])]);
  const subject = groupId(p.subjectId), document = groupId(p.documentId), expectedHash = groupHash(p.evidenceHash);
  const regions = hasRegions ? validateGroupRegions(p.regions) : undefined;
  const doc = await transaction(false, db => pdfDocument(db, subject, document, expectedHash));
  return regions ? inspectGroupPdf(doc.bytes, regions) : inspectGroupPdfMetadata(doc.bytes);
}
export async function readSupplyGroupPage(subjectId: string, documentId: string, pageNumber: number) {
  const subject = groupId(subjectId), document = groupId(documentId);
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 20) throw groupError('PDF 페이지 번호를 확인하세요.');
  const doc = await transaction(false, db => pdfDocument(db, subject, document));
  return renderGroupPdfPage(doc.bytes, pageNumber);
}
/** Advisory extraction status from the immutable evidence, never a new validity/financial decision. */
export async function readSupplyGroupEvidenceDiagnostics(subjectId: string, manifestId: string): Promise<SupplyGroupEvidenceDiagnostics> {
  const subject = groupId(subjectId), manifest = groupId(manifestId);
  return transaction(false, async db => {
    await requireSubject(db, subject);
    const row = rowsToObjects(await db.exec('SELECT request_id,payload_json,document_id FROM finance_group_evidence WHERE subject_id=$1 AND manifest_id=$2', [subject, manifest]))[0];
    if (!row) throw groupError('보관된 원문 위치 근거를 찾을 수 없습니다.', 404, 'supply_group_evidence_missing');
    try { await db.exec('SELECT finance_group_assert_request($1)', [row.request_id]); }
    catch (error) { if (['40001', '40P01'].includes(String((error as { code?: string }).code))) throw error; throw groupUnavailable(); }
    const payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
    if (!payload || payload.subjectId !== subject || payload.documentId !== row.document_id || !Array.isArray(payload.regions) || !Array.isArray(payload.adapter?.regions)) throw groupUnavailable();
    const document = await requireVatFilingDocument(String(row.document_id), subject, db);
    if (document.evidenceHash !== payload.evidenceHash) throw groupUnavailable();
    const regions: SupplyGroupEvidenceDiagnostics['regions'] = payload.regions.map((region: { regionId: string; pageNumber: number; role: string }) => {
      const matches = payload.adapter.regions.filter((r: { regionId: string }) => r.regionId === region.regionId);
      if (matches.length !== 1 || !['text', 'no_text'].includes(matches[0].textStatus) || !['detail', 'context'].includes(region.role) || !Number.isSafeInteger(region.pageNumber) || region.pageNumber < 1) throw groupUnavailable();
      return { regionId: region.regionId, pageNumber: region.pageNumber, role: region.role as 'detail' | 'context', textStatus: matches[0].textStatus as 'text' | 'no_text' };
    });
    return { manifestId: manifest, verificationLevel: 'human_review', regions, noTextDetailCount: regions.filter(r => r.role === 'detail' && r.textStatus === 'no_text').length };
  });
}
async function evidenceReplay(db: PgDatabase, value: SupplyGroupEvidenceInput, actor: string) {
  const old = rowsToObjects(await db.exec("SELECT actor_user_id,action,payload_json-'adapter'=$2::jsonb AS input_matches FROM finance_group_requests WHERE request_id=$1", [value.requestId, JSON.stringify(value)]))[0];
  if (!old) return null;
  if (old.actor_user_id !== actor || old.action !== 'evidence' || old.input_matches !== true) throw groupError('이미 처리된 원문 요청의 담당자나 내용이 다릅니다.', 409, 'supply_group_request_conflict');
  try { return validEvidence(resultValue<SupplyGroupEvidenceResult>(await db.exec('SELECT finance_group_evidence_replay($1::jsonb,$2)', [JSON.stringify(value), actor]))); }
  catch (error) { if (['40001', '40P01'].includes(String((error as { code?: string }).code))) throw error; throw groupUnavailable(); }
}
export async function registerSupplyGroupEvidence(input: unknown, actorUserId: string): Promise<SupplyGroupEvidenceResult> {
  const value = validateGroupEvidence(input), actor = groupId(actorUserId);
  const saved = await transaction(false, db => evidenceReplay(db, value, actor));
  if (saved) return saved;
  const doc = await transaction(false, db => pdfDocument(db, value.subjectId, value.documentId, value.evidenceHash));
  const adapter = await inspectGroupPdf(doc.bytes, value.regions);
  return transaction(true, async db => {
    await db.exec('SELECT finance_group_lock()');
    const completed = await evidenceReplay(db, value, actor); if (completed) return completed;
    // The stored document is immutable, but verify subject/hash again inside the writing transaction.
    await pdfDocument(db, value.subjectId, value.documentId, value.evidenceHash);
    const result = validEvidence(resultValue<SupplyGroupEvidenceResult>(await db.exec('SELECT finance_group_evidence_write($1::jsonb,$2)', [JSON.stringify({ ...value, adapter }), actor])));
    if (!result.replayed) await recordAuditLogInline(db, { actorUserId: actor, action: 'finance_supply_group_review', targetTable: 'finance_group_evidence', targetId: result.manifestId, after: { action: 'evidence_register', ...result } });
    return result;
  });
}
async function subjectEvidence(db: PgDatabase, value: SupplyGroupPreview) {
  await requireSubject(db, value.draft.subjectId);
  const subjects = await readRecognitionSubjects(db), collector = process.env.BAROBILL_CORPNUM;
  for (const date of new Set([value.singleton, ...value.members].map(v => v?.date).filter((v): v is string => !!v))) {
    const subject = strictRecognitionSubject(subjects, value.draft.subjectId, date, collector, collector);
    if (!subject.evidenceRef?.startsWith('vat-document:') || !subject.evidenceHash) throw groupError('해당일 회사 근거가 부족합니다.', 409, 'supply_group_subject_changed');
    const document = await requireVatFilingDocument(subject.evidenceRef.slice(13), value.draft.subjectId, db);
    if (document.evidenceHash !== subject.evidenceHash) throw groupUnavailable();
  }
}
async function preview(db: PgDatabase, value: SupplyGroupPreviewInput) {
  const result = validPreview(resultValue<SupplyGroupPreview>(await db.exec('SELECT finance_group_preview($1::jsonb)', [JSON.stringify(value)])));
  await subjectEvidence(db, result); return result;
}
export async function previewSupplyGroup(input: unknown): Promise<SupplyGroupPreview> {
  const value = validateGroupPreviewInput(input); return transaction(false, db => preview(db, value));
}
async function replay(value: SupplyGroupSaveInput | SupplyGroupWithdrawInput, action: string, actor: string) {
  return transaction(false, async db => {
    const old = rowsToObjects(await db.exec('SELECT actor_user_id,action,payload_json=$2::jsonb AS input_matches,result_json FROM finance_group_requests WHERE request_id=$1', [value.requestId, JSON.stringify(value)]))[0];
    if (!old) return null;
    if (old.actor_user_id !== actor || old.action !== action || old.input_matches !== true) throw groupError('이미 처리된 요청의 담당자나 내용이 다릅니다.', 409, 'supply_group_request_conflict');
    try { await db.exec('SELECT finance_group_assert_request($1)', [value.requestId]); }
    catch (error) { if (['40001', '40P01'].includes(String((error as { code?: string }).code))) throw error; throw groupUnavailable(); }
    return { ...validResult(old.result_json as SupplyGroupResult), replayed: true };
  });
}
async function write(value: SupplyGroupSaveInput | SupplyGroupWithdrawInput, action: 'verify' | 'withdraw', actor: string) {
  const completed = await replay(value, action, actor); if (completed) return completed;
  return transaction(true, async db => {
    await db.exec('SELECT finance_group_lock()');
    const old = rowsToObjects(await db.exec('SELECT request_id FROM finance_group_requests WHERE request_id=$1', [value.requestId]));
    if (!old.length && action === 'verify') {
      const { requestId: _request, expectedPreviewHash, ...input } = value as SupplyGroupSaveInput;
      const now = await preview(db, input);
      if (!now.canVerify) throw Object.assign(groupError('전체 대응을 확인할 근거가 부족합니다. 표시된 항목을 보완하세요.', 409, 'supply_group_review_incomplete'), { groupIssues: now.issues });
      if (now.previewHash !== expectedPreviewHash) throw groupError('미리보기 후 근거가 변경되었습니다. 다시 확인하세요.', 409, 'supply_group_preview_changed');
    }
    const result = validResult(resultValue<SupplyGroupResult>(await db.exec('SELECT finance_group_write($1,$2::jsonb,$3,$4)', [action, JSON.stringify(value), value.requestId, actor])));
    if (!result.replayed) await recordAuditLogInline(db, { actorUserId: actor, action: 'finance_supply_group_review', targetTable: 'finance_group_revisions', targetId: result.revisionId, after: { action, ...result } });
    return result;
  });
}
export async function verifySupplyGroup(input: unknown, actorUserId: string) { return write(validateGroupPreviewInput(input, true), 'verify', groupId(actorUserId)); }
export async function withdrawSupplyGroup(input: unknown, actorUserId: string) { return write(validateGroupWithdraw(input), 'withdraw', groupId(actorUserId)); }
export async function listSupplyGroup(subjectId: string, caseId?: string, cursor?: string): Promise<SupplyGroupList> {
  const subject = groupId(subjectId), id = caseId === undefined ? null : groupId(caseId), after = cursor === undefined ? null : groupId(cursor);
  return transaction(false, async db => {
    await requireSubject(db, subject);
    const result = resultValue<SupplyGroupList>(await db.exec('SELECT finance_group_list($1,$2,$3)', [subject, id, after]));
    if (!result || !Array.isArray(result.records) || typeof result.hasMore !== 'boolean' || result.hasMore !== (typeof result.nextCursor === 'string' && result.nextCursor.length > 0) || !result.hasMore && result.nextCursor !== null || result.hasMore && result.records.length === 0) throw groupUnavailable();
    for (const r of result.records) { validResult({ ...r, replayed: false }); validPreview(r.preview); }
    return result;
  });
}

/** A stable key cursor keeps older whole documents selectable without capping the conflict domain. */
export async function listSupplyGroupDocuments(subjectId: string, cursor?: string) {
  const subject = groupId(subjectId), after = cursor === undefined ? null : groupId(cursor);
  return transaction(false, async db => {
    await requireSubject(db, subject);
    const keys = rowsToObjects(await db.exec('SELECT document_id FROM finance_document_registry WHERE subject_id=$1 AND ($2::text IS NULL OR document_id>$2) ORDER BY document_id LIMIT 51', [subject, after]));
    const documents = [];
    for (const row of keys.slice(0, 50)) {
      const list = validateDocumentList(resultValue(await db.exec('SELECT finance_document_list($1,$2)', [subject, row.document_id])));
      if (list.documents.length !== 1 || list.documents[0].documentId !== row.document_id) throw groupUnavailable();
      documents.push(list.documents[0]);
    }
    return { documents, hasMore: keys.length > 50, nextCursor: keys.length > 50 ? String(keys[49].document_id) : null };
  });
}
