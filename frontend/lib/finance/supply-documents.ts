import { rowsToObjects, withDbRead, withDbWrite, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { lockAccountingWrite } from "./write-lock";
import { assertSupplyDocumentPrerequisites } from "./supply-document-prerequisites";
import { readRecognitionSubjects } from "./recognition-review-subjects";
import { strictRecognitionSubject } from "./recognition-review-pure";
import { requireVatFilingDocument } from "./vat-filing-documents";
import { documentError, documentUnavailable, documentId, validateDocumentInput, validateDocumentPreview, validateDocumentResult, validateDocumentList } from "./supply-document-validation";
import type { SupplyDocumentInput, SupplyDocumentPreview, SupplyDocumentRegisterInput } from "./supply-document-types";

function translate(error: unknown): never {
  const e = error as { status?: number; code?: string };
  if ([400, 403, 404, 409, 503].includes(e.status ?? 0)) throw error;
  if (["23503", "23505", "23514", "40001", "40P01"].includes(e.code ?? "")) {
    throw documentError("등록 근거가 바뀌었거나 다른 기록과 충돌합니다. 최신 내용을 다시 확인하세요.", 409, "supply_document_conflict");
  }
  throw documentUnavailable();
}
async function transaction<T>(write: boolean, fn: (db: PgDatabase) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const work = async (db: PgDatabase) => {
        if (write) await lockAccountingWrite(db);
        await assertSupplyDocumentPrerequisites(db, process.env.FINANCE_R1_SCHEMA ?? "public");
        return fn(db);
      };
      // 등록 SQL이 원천 모집단의 SHARE 잠금 뒤 최신 자료를 읽는다.
      // 오래된 RR 스냅샷으로 새 alias를 놓치지 않도록 쓰기는 RC만 허용한다.
      return write ? await withDbWrite(work) : await withDbRead(work);
    } catch (error) {
      if (attempt < 2 && ["40001", "40P01"].includes(String((error as { code?: string }).code))) continue;
      return translate(error);
    }
  }
}
const args = (v: SupplyDocumentInput) => [v.subjectId, v.reviewRevisionId, v.sourceKind, v.sourceId];
function jsonValue(result: Awaited<ReturnType<PgDatabase["exec"]>>): unknown {
  const value = result[0]?.values[0]?.[0];
  if (value === undefined) throw documentUnavailable();
  return typeof value === "string" ? JSON.parse(value) : value;
}
async function subjectEvidence(db: PgDatabase, p: SupplyDocumentPreview) {
  if (!p.observation) return;
  const collector = process.env.BAROBILL_CORPNUM;
  const subject = strictRecognitionSubject(await readRecognitionSubjects(db), p.subjectId, p.observation.date, collector, collector);
  if (subject.revisionId !== p.observation.subjectRevisionId || !subject.evidenceRef?.startsWith("vat-document:") || !subject.evidenceHash) {
    throw documentError("등록일에 유효한 회사 기준과 보관 증빙을 먼저 확인하세요.", 409, "supply_document_subject_conflict");
  }
  const proof = await requireVatFilingDocument(subject.evidenceRef.slice(13), p.subjectId, db);
  if (proof.evidenceHash !== subject.evidenceHash) throw documentUnavailable();
}
async function preview(db: PgDatabase, input: SupplyDocumentInput) {
  const p = validateDocumentPreview(jsonValue(await db.exec("SELECT finance_document_preview($1,$2,$3,$4)", args(input))));
  if (p.subjectId !== input.subjectId || p.reviewRevisionId !== input.reviewRevisionId || p.source.kind !== input.sourceKind || p.source.id !== input.sourceId) throw documentUnavailable();
  await subjectEvidence(db, p);
  return p;
}
export async function previewSupplyDocument(input: unknown) {
  const value = validateDocumentInput(input); return transaction(false, db => preview(db, value));
}
async function replayCompletedRequest(value: SupplyDocumentRegisterInput, actor: string) {
  return transaction(false, async db => {
    // 불변 완료 요청은 같은 읽기 스냅샷에서 입력과 저장 근거를 검증한다.
    // 원천 쓰기 잠금 없이 재생하되, 아직 없는 요청은 기존 RC 저장 경로가 처리한다.
    const payload = { subjectId: value.subjectId, reviewRevisionId: value.reviewRevisionId,
      sourceKind: value.sourceKind, sourceId: value.sourceId,
      expectedPreviewHash: value.expectedPreviewHash, expectedVersion: value.expectedVersion };
    const existing = rowsToObjects(await db.exec(
      "SELECT actor_user_id, payload_json=$2::jsonb AS input_matches, result_json FROM finance_document_requests WHERE request_id=$1",
      [value.requestId, JSON.stringify(payload)],
    ))[0];
    if (!existing) return null;
    if (existing.actor_user_id !== actor || existing.input_matches !== true) {
      throw documentError("이미 처리된 요청의 담당자 또는 내용이 다릅니다.", 409, "supply_document_request_conflict");
    }
    try {
      await db.exec("SELECT finance_document_assert_request($1)", [value.requestId]);
    } catch (error) {
      if (["40001", "40P01"].includes(String((error as { code?: string }).code))) throw error;
      throw documentUnavailable();
    }
    return { ...validateDocumentResult(existing.result_json), replayed: true };
  });
}
export async function registerSupplyDocument(input: unknown, actorUserId: string) {
  const value = validateDocumentInput(input, true), actor = documentId(actorUserId);
  const replayed = await replayCompletedRequest(value, actor);
  if (replayed) return replayed;
  return transaction(true, async db => {
    // 완료된 요청은 현재 원천에 의존하지 않고 재생한다. SQL에서 담당자와 전체 입력을 다시 대조한다.
    const existing = rowsToObjects(await db.exec("SELECT request_id FROM finance_document_requests WHERE request_id=$1", [value.requestId]));
    if (!existing.length) {
      const p = await preview(db, value);
      if (!p.canRegister || p.version !== value.expectedVersion || p.previewHash !== value.expectedPreviewHash) {
        throw documentError("원천·회사 기준·기록 판이 바뀌었거나 등록할 수 없는 문서입니다. 미리보기를 다시 확인하세요.", 409, "supply_document_preview_stale");
      }
    }
    const result = validateDocumentResult(jsonValue(await db.exec("SELECT finance_document_register($1,$2,$3,$4,$5,$6,$7,$8)",
      [...args(value), value.expectedPreviewHash, value.expectedVersion, value.requestId, actor])));
    if (!result.replayed) await recordAuditLogInline(db, { actorUserId: actor, action: "finance_document_register", targetTable: "finance_document_registry",
      targetId: result.documentId, after: { ...result, subjectId: value.subjectId, financialUseSupported: false } });
    return result;
  });
}
export async function listSupplyDocuments(subjectId: string, selectedDocumentId?: string) {
  const subject = documentId(subjectId), doc = selectedDocumentId === undefined ? null : documentId(selectedDocumentId);
  return transaction(false, async db => {
    if (!rowsToObjects(await db.exec("SELECT subject_id FROM vat_filing_subjects WHERE subject_id=$1", [subject])).length) throw documentError("회사 기준을 찾을 수 없습니다.", 404, "supply_document_subject_missing");
    return validateDocumentList(jsonValue(await db.exec("SELECT finance_document_list($1,$2)", [subject, doc])));
  });
}
