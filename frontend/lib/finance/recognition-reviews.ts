import { randomUUID } from "node:crypto";
import { rowsToObjects, withDbRead, withDbWrite, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { assertAccountingDatesOpen, lockAccountingWrite, validateAccountingRange } from "./write-lock";
import { assertRecognitionPrerequisites } from "./recognition-prerequisites";
import { loadTransactionLinkState, transactionSourceKey, type TransactionLinkState } from "./transaction-links";
import { assertVatFilingSourcesMutable } from "./vat-filing-protection";
import { listVatFilingDocuments } from "./vat-filing-documents";
import { recognitionSubjectEvidence, readRecognitionSubjects } from "./recognition-review-subjects";
import { prepareRecognitionJournal, writeRecognitionJournal } from "./recognition-journal";
import { vatHashV2 } from "./vat-canonical-v2";
import { exactRecognitionMoney, recognitionCorpNum, recognitionError, recognitionId, recognitionProjectionFromDbRow, recognitionProjectionHash,
  recognitionUnavailable, validateRecognitionApplyInput, validateRecognitionPreviewInput, type RecognitionPreviewInput, type RecognitionProjection } from "./recognition-review-pure";

const parse = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : value) as T;
const trustedSchema = () => process.env.FINANCE_R1_SCHEMA ?? "public";
const asUnknownError = (error: unknown): never => {
  const e = error as { status?: number; code?: string };
  if ([400, 403, 404, 409, 503].includes(e.status ?? 0)) throw error;
  if (["23503", "23505", "23514", "40001", "40P01"].includes(e.code ?? "")) throw recognitionError("동시에 변경된 자료 또는 검토 결과가 있습니다. 최신 내용을 다시 확인하세요.");
  throw recognitionUnavailable();
};
async function transaction<T>(fn: (db: PgDatabase) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withDbWrite(async db => {
        await lockAccountingWrite(db);
        await assertRecognitionPrerequisites(db, trustedSchema());
        return fn(db);
      }, { accountingSnapshot: true });
    } catch (error) {
      if (attempt < 2 && ["40001", "40P01"].includes(String((error as { code?: string }).code))) continue;
      return asUnknownError(error);
    }
  }
}

/** 목록은 같은 읽기 스냅샷에서 검증한다. 실제 반영은 transaction()에서 다시 검사한다. */
async function readTransaction<T>(fn: (db: PgDatabase) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withDbRead(async db => {
        await assertRecognitionPrerequisites(db, trustedSchema());
        return fn(db);
      });
    } catch (error) {
      if (attempt < 2 && ["40001", "40P01"].includes(String((error as { code?: string }).code))) continue;
      return asUnknownError(error);
    }
  }
}

async function currentRecognition(db: PgDatabase, id: string) {
  const row = rowsToObjects(await db.exec(`SELECT r.*,r.source_snapshot::text AS source_snapshot_text,
    r1_recognition_projection_hash(r) AS projection_hash FROM transaction_invoice_recognitions r WHERE recognition_id=$1 FOR UPDATE`, [id]))[0];
  if (!row) throw recognitionError("기존 인식 기록을 찾을 수 없습니다.", 404, "recognition_review_missing");
  await db.exec("SELECT r1_assert_recognition_current($1)", [id]);
  const projection = recognitionProjectionFromDbRow(row), hash = recognitionProjectionHash(projection);
  if (hash !== row.projection_hash) throw recognitionUnavailable("현재 인식의 비교 지문이 일치하지 않습니다.");
  return { row, projection, hash };
}
function currentAndPreviousSource(state: TransactionLinkState, before: RecognitionProjection) {
  const recognition = state.recognitions.find(row => row.id === before.recognitionId), previous = recognition?.sourceSnapshot;
  const source = state.sources.find(row => row.kind === before.sourceKind && row.id === before.sourceId);
  if (!recognition || !source || !previous || before.sourceKind !== "hometax" || source.kind !== "hometax"
    || source.direction !== "purchase" || previous.direction !== "purchase" || previous.kind !== "hometax"
    || previous.id !== source.id || previous.canonicalKey !== source.canonicalKey || before.canonicalInvoiceKey !== source.canonicalKey
    || previous.journalKind !== "hometax_invoice" || source.journalKind !== "hometax_invoice" || previous.journalId !== source.journalId) {
    throw recognitionError("같은 대표 홈택스 매입계산서의 기존 인식만 재검토할 수 있습니다. 대표 변경·취소는 별도 확인이 필요합니다.", 409, "recognition_review_unsupported");
  }
  if (source.issues.length || source.raw.modify_code || Number(source.raw.tax_type) !== 1 || source.raw.vat_deductible !== 0 && source.raw.vat_deductible !== 1) {
    throw recognitionError("정상 과세 매입계산서의 공제 여부와 원천 내용을 먼저 확인하세요.", 409, "recognition_review_source_invalid");
  }
  for (const date of [previous.date, previous.taxDate, source.date, source.taxDate]) validateAccountingRange(date, date);
  if (previous.date !== source.date || previous.taxDate !== source.taxDate) throw recognitionError("회계일·신고 귀속일이 바뀐 인식은 이 재검토에서 변경할 수 없습니다.", 409, "recognition_review_date_changed");
  if (!previous.raw || recognitionCorpNum(previous.raw.invoicee_corp_num) !== recognitionCorpNum(source.raw.invoicee_corp_num)) {
    throw recognitionError("이전 원천과 현재 계산서의 공급받는 자가 다릅니다.", 409, "recognition_subject_conflict");
  }
  const aliases = state.sources.filter(row => row.canonicalKey === source.canonicalKey);
  if (aliases.some(row => row.issues.some(issue => ["official_invoice_content_conflict", "multiple_active_app_invoice_rows"].includes(issue)))) throw recognitionError("같은 공식 계산서의 대표와 원문이 충돌합니다.");
  const keys = new Set(aliases.map(row => row.key)); keys.add(transactionSourceKey(recognition.source));
  const relatedLinks = state.links.filter(link => keys.has(transactionSourceKey(link.left)) || keys.has(transactionSourceKey(link.right))
    || [link.leftSnapshot.canonicalKey, link.rightSnapshot.canonicalKey].includes(source.canonicalKey));
  if (relatedLinks.some(link => link.state === "active")) throw recognitionError("활성 지급·수기·별개 거래 연결이 있습니다. 연결 근거를 먼저 확인하세요.", 409, "recognition_review_active_links");
  return { recognition, previous, source, aliases, relatedLinks };
}
async function checkSourceAndProtection(db: PgDatabase, state: TransactionLinkState, before: RecognitionProjection) {
  const selected = currentAndPreviousSource(state, before);
  const ids = selected.aliases.filter(row => row.kind === "hometax").map(row => row.id).sort();
  const rawRows = rowsToObjects(await db.exec(`SELECT hti_id,amount_total::text AS supply_text,tax_total::text AS tax_text,total_amount::text AS total_text
    FROM hometax_tax_invoices WHERE hti_id=ANY($1::text[]) ORDER BY hti_id FOR UPDATE`, [ids]));
  const row = rawRows.find(row => row.hti_id === selected.source.id);
  if (!row) throw recognitionError("계산서 원천을 찾을 수 없습니다.");
  const [supply, tax, total] = [row.supply_text, row.tax_text, row.total_text].map(exactRecognitionMoney);
  if (supply <= 0 || total <= 0 || supply + tax !== total || !Number.isSafeInteger(supply + tax)
    || supply !== selected.source.supply || tax !== selected.source.tax || total !== selected.source.total) throw recognitionError("매입계산서의 공급가액·세액·합계가 정확히 일치하지 않습니다.");
  const account = rowsToObjects(await db.exec("SELECT account_code,acct_type,is_active FROM journal_accounts WHERE account_code=$1 FOR SHARE", [before.expenseAccount]))[0];
  if (!account || account.acct_type !== "expense" || account.is_active !== 1) throw recognitionError("기존 비용 계정이 활성 상태인지 확인하세요. 재검토에서 임의 계정으로 바꾸지 않습니다.");
  const dates = [selected.previous.date, selected.previous.taxDate, selected.source.date, selected.source.taxDate];
  await assertAccountingDatesOpen(db, dates);
  await assertVatFilingSourcesMutable(db, { dates, refs: selected.aliases.map(source => ({ kind: source.kind, id: source.id })) });
  // 이미 사용된 C 검토의 정확 원천도 보호한다. 조회 실패를 빈 소비로 바꾸지 않는다.
  const consumed = rowsToObjects(await db.exec(`SELECT c.consumption_id FROM vat_followup_review_consumptions c
    JOIN vat_followup_review_pairs p ON p.revision_id=c.revision_id AND p.line_no=c.pair_line_no
    WHERE p.invoice_source_id=ANY($1::text[]) LIMIT 1`, [ids]));
  if (consumed.length) throw recognitionError("이미 확정 신고에 사용된 후행 검토 원천입니다. 과거 소비 근거를 보존해야 합니다.", 409, "recognition_review_consumed");
  return selected;
}

export interface RecognitionReviewPreview {
  status: "ready"; recognitionId: string; currentReviewVersion: number; currentAppliedReviewId: string | null;
  currentProjectionHash: string; currentSourceHash: string; previewHash: string; canApply: boolean; noChange: boolean;
  before: { lines: Array<{ accountCode: string; debit: number; credit: number }>; total: number };
  after: { lines: Array<{ accountCode: string; debit: number; credit: number }>; total: number };
  references: { documentName: string; subjectCorpNum: string };
  otherIssues: Array<{ code: string; message: string }>;
}
export interface RecognitionReviewResult {
  status: "restored"; recognitionId: string; reviewId: string; reviewVersion: number; basisHash: string; entryId: string; sourceHash: string; replayed: boolean;
}
async function prepare(db: PgDatabase, input: RecognitionPreviewInput) {
  const current = await currentRecognition(db, input.recognitionId), state = await loadTransactionLinkState(db);
  const selected = await checkSourceAndProtection(db, state, current.projection);
  const { subjectProof, document } = await recognitionSubjectEvidence(db, { subjectId: input.subjectId, documentId: input.evidenceDocumentId,
    dates: [selected.source.date, selected.source.taxDate], recipient: selected.source.raw.invoicee_corp_num });
  const sourceSnapshotText = rowsToObjects(await db.exec("SELECT ($1::jsonb)::text AS snapshot_text", [JSON.stringify(selected.source)]))[0]?.snapshot_text;
  if (typeof sourceSnapshotText !== "string") throw recognitionUnavailable();
  const evidence = `${document.evidenceRef} / ${input.evidenceLocation}`;
  const proposed: RecognitionProjection = { ...current.projection, sourceHash: selected.source.sourceHash, sourceSnapshotText,
    reason: input.reason, evidence, appliedReviewId: "r1-preview", reviewVersion: current.projection.reviewVersion + 1 };
  if (proposed.reviewVersion > 2147483647) throw recognitionError("인식 검토 판번호의 상한을 초과했습니다.");
  const candidate = structuredClone(state), item = candidate.recognitions.find(row => row.id === input.recognitionId)!;
  Object.assign(item, { sourceHash: proposed.sourceHash, sourceSnapshot: structuredClone(selected.source), reason: input.reason, evidence,
    valid: true, issues: [], review: { schemaVersion: 1, reviewId: "r1-preview", reviewVersion: proposed.reviewVersion, basisHash: "0".repeat(64) } });
  const journal = await prepareRecognitionJournal(db, { state: candidate, recognitionId: input.recognitionId, createdAt: "2000-01-01T00:00:00.000Z" });
  const noChange = current.projection.sourceHash === proposed.sourceHash && current.projection.sourceSnapshotText === proposed.sourceSnapshotText
    && current.projection.reason === proposed.reason && current.projection.evidence === proposed.evidence;
  const previewHash = vatHashV2({ schemaVersion: "r1-preview-v1", input, currentProjectionHash: current.hash,
    currentSourceHash: selected.source.sourceHash, sourceSnapshotText, subjectProof,
    document: { documentId: document.documentId, subjectId: document.subjectId, evidenceRef: document.evidenceRef, evidenceHash: document.evidenceHash },
    beforeJournal: journal.before, afterLines: journal.executionResult.lines, cancelledLinks: selected.relatedLinks.map(link => ({ id: link.id, state: link.state, leftHash: link.leftHash, rightHash: link.rightHash })) });
  const beforeLines = journal.before.lines.map(line => ({ accountCode: String(line.account_code), debit: Number(line.debit), credit: Number(line.credit) }));
  const afterLines = journal.executionResult.lines.map(line => ({ accountCode: line.account_code, debit: line.debit, credit: line.credit }));
  const preview: RecognitionReviewPreview = { status: "ready", recognitionId: input.recognitionId, currentReviewVersion: current.projection.reviewVersion,
    currentAppliedReviewId: current.projection.appliedReviewId, currentProjectionHash: current.hash, currentSourceHash: selected.source.sourceHash,
    previewHash, canApply: !noChange, noChange, before: { lines: beforeLines, total: beforeLines.reduce((sum, line) => sum + line.debit, 0) },
    after: { lines: afterLines, total: afterLines.reduce((sum, line) => sum + line.debit, 0) },
    references: { documentName: document.fileName, subjectCorpNum: subjectProof[0].corpNum },
    otherIssues: state.issues.filter(issue => issue.sourceKey !== selected.source.key).map(issue => ({ code: issue.code, message: issue.message })).slice(0, 100) };
  return { input, current, state: candidate, selected, proposed, subjectProof, document, preview };
}
export async function previewRecognitionReview(input: unknown): Promise<RecognitionReviewPreview> {
  const value = validateRecognitionPreviewInput(input);
  return transaction(async db => (await prepare(db, value)).preview);
}
export async function applyRecognitionReview(input: unknown, actorUserId: string): Promise<RecognitionReviewResult> {
  const value = validateRecognitionApplyInput(input), actor = recognitionId(actorUserId, "담당자"), payloadHash = vatHashV2(value);
  return transaction(async db => {
    const old = rowsToObjects(await db.exec("SELECT action,actor_user_id,payload_hash,result_json FROM recognition_review_requests WHERE request_id=$1", [value.requestId]))[0];
    if (old) {
      if (old.action !== "apply" || old.actor_user_id !== actor || old.payload_hash !== payloadHash) throw recognitionError("같은 요청 식별자에 다른 내용 또는 담당자가 있습니다.");
      return { ...parse<RecognitionReviewResult>(old.result_json), replayed: true };
    }
    const previewInput: RecognitionPreviewInput = { recognitionId: value.recognitionId, subjectId: value.subjectId,
      evidenceDocumentId: value.evidenceDocumentId, evidenceLocation: value.evidenceLocation, reason: value.reason };
    const p = await prepare(db, previewInput);
    if (p.preview.currentReviewVersion !== value.expectedReviewVersion || p.preview.currentAppliedReviewId !== value.expectedAppliedReviewId
      || p.preview.currentProjectionHash !== value.expectedProjectionHash || p.preview.currentSourceHash !== value.expectedSourceHash || p.preview.previewHash !== value.expectedPreviewHash) {
      throw recognitionError("미리보기 이후 원천·검토판·증빙 또는 전표가 변경됐습니다. 최신 내용으로 다시 검토하세요.", 409, "recognition_review_preview_stale");
    }
    if (p.preview.noChange) throw recognitionError("이미 같은 근거와 내용으로 반영되어 변경할 사항이 없습니다.", 409, "recognition_review_no_change");
    const reviewId = `rr-${randomUUID()}`, createdAt = new Date().toISOString(), after = { ...p.proposed, appliedReviewId: reviewId };
    const afterHash = recognitionProjectionHash(after);
    const basis = { schemaVersion: "r1-review-basis-v1", recognitionId: value.recognitionId, reviewId, reviewVersion: after.reviewVersion,
      previousReviewId: p.current.projection.appliedReviewId, beforeProjectionHash: p.current.hash, afterProjectionHash: afterHash,
      representative: { sourceKind: p.selected.source.kind, sourceId: p.selected.source.id, canonicalKey: p.selected.source.canonicalKey,
        journalKind: p.selected.source.journalKind, journalId: p.selected.source.journalId },
      dates: { accountingDate: p.selected.source.date, taxDate: p.selected.source.taxDate }, subjectProof: p.subjectProof,
      reviewDocument: { documentId: p.document.documentId, subjectId: p.document.subjectId, evidenceRef: p.document.evidenceRef, evidenceHash: p.document.evidenceHash, location: value.evidenceLocation },
      reason: value.reason, requestId: value.requestId, actorUserId: actor, reviewConfirmed: true };
    const basisHash = vatHashV2(basis), recognition = p.state.recognitions.find(row => row.id === value.recognitionId)!;
    recognition.review = { schemaVersion: 1, reviewId, reviewVersion: after.reviewVersion, basisHash };
    const journal = await prepareRecognitionJournal(db, { state: p.state, recognitionId: value.recognitionId, createdAt });
    await db.run(`INSERT INTO recognition_review_revisions(review_id,recognition_id,review_version,previous_review_id,
      before_projection_json,before_projection_hash,after_projection_json,after_projection_hash,basis_json,basis_hash,execution_result_json,
      target_entry_id,target_source_kind,target_source_id,request_id,actor_user_id,created_at)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9::jsonb,$10,$11::jsonb,$12,$13,$14,$15,$16,$17)`,
    [reviewId, value.recognitionId, after.reviewVersion, p.current.projection.appliedReviewId,
      JSON.stringify(p.current.projection), p.current.hash, JSON.stringify(after), afterHash, JSON.stringify(basis), basisHash,
      JSON.stringify(journal.executionResult), journal.targetEntryId, p.selected.source.journalKind, p.selected.source.journalId, value.requestId, actor, createdAt]);
    const updated = rowsToObjects(await db.exec(`UPDATE transaction_invoice_recognitions r SET source_hash=$2,source_snapshot=$3::jsonb,reason=$4,evidence=$5,
      applied_review_id=$6,review_version=$7 WHERE recognition_id=$1 AND review_version=$8 AND applied_review_id IS NOT DISTINCT FROM $9
      AND r1_recognition_projection_hash(r)=$10 RETURNING recognition_id`, [value.recognitionId, after.sourceHash, after.sourceSnapshotText,
      after.reason, after.evidence, reviewId, after.reviewVersion, value.expectedReviewVersion, value.expectedAppliedReviewId, value.expectedProjectionHash]));
    if (updated.length !== 1) throw recognitionError("현재 인식 판이 변경되어 적용하지 않았습니다.");
    await writeRecognitionJournal(db, journal);
    const result: RecognitionReviewResult = { status: "restored", recognitionId: value.recognitionId, reviewId, reviewVersion: after.reviewVersion,
      basisHash, entryId: journal.targetEntryId, sourceHash: journal.executionResult.snapshot.source_hash, replayed: false };
    await db.run(`INSERT INTO recognition_review_requests(request_id,action,recognition_id,review_id,actor_user_id,payload_hash,result_json,created_at)
      VALUES($1,'apply',$2,$3,$4,$5,$6::jsonb,$7)`, [value.requestId, value.recognitionId, reviewId, actor, payloadHash, JSON.stringify(result), createdAt]);
    await recordAuditLogInline(db, { actorUserId: actor, action: "finance_recognition_review", targetTable: "recognition_review_revisions", targetId: reviewId,
      before: p.current.projection, after: { reviewId, recognitionId: value.recognitionId, reviewVersion: after.reviewVersion, basisHash, entryId: result.entryId, sourceHash: result.sourceHash } });
    return result;
  });
}

export async function listRecognitionReviews(query: { from?: string; to?: string } = {}) {
  const from = query.from ?? "1000-01-01", to = query.to ?? "9999-12-31"; validateAccountingRange(from, to);
  return readTransaction(async db => {
    const state = await loadTransactionLinkState(db), subjects = await readRecognitionSubjects(db);
    return { items: state.recognitions.filter(row => row.source.kind === "hometax" && row.sourceSnapshot.date >= from && row.sourceSnapshot.date <= to)
      .map(row => { const source = state.sources.find(source => source.key === transactionSourceKey(row.source)) ?? row.sourceSnapshot;
        return { recognitionId: row.id, name: source.name, date: source.date, total: source.total, sourceKind: row.source.kind,
          sourceId: row.source.id, valid: row.valid, reviewVersion: row.review?.reviewVersion ?? 0, expenseAccount: row.expenseAccount }; }),
      subjects: [...new Map(subjects.map(row => [row.subjectId, { subjectId: row.subjectId, corpNum: row.corpNum }])).values()] };
  });
}
export async function listRecognitionReviewDocuments(subjectId: string) {
  const id = recognitionId(subjectId, "회사");
  return readTransaction(async db => ({ documents: await listVatFilingDocuments(id, db) }));
}
