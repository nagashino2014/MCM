import { rowsToObjects, type PgDatabase } from "@/lib/db";
import { requireVatFilingDocument, type VatFilingDocument } from "./vat-filing-documents";
import { vatHashV2 } from "./vat-canonical-v2";
import { recognitionError, recognitionSubjectRows, recognitionUnavailable, strictRecognitionSubject } from "./recognition-review-pure";

export interface RecognitionSubjectProof {
  date: string; subjectId: string; revisionId: string; corpNum: string; revisionHash: string; evidenceRef: string; evidenceHash: string;
}
export async function readRecognitionSubjects(db: PgDatabase) {
  return recognitionSubjectRows(rowsToObjects(await db.exec(`SELECT r.revision_id,r.subject_id,r.version,r.payload_json,s.subject_id AS parent_subject_id
    FROM vat_filing_subject_revisions r LEFT JOIN vat_filing_subjects s ON s.subject_id=r.subject_id ORDER BY r.subject_id,r.version`)));
}
export async function recognitionSubjectEvidence(db: PgDatabase, input: { subjectId: string; documentId: string; dates: string[]; recipient: unknown }): Promise<{ subjectProof: RecognitionSubjectProof[]; document: VatFilingDocument }> {
  const document = await requireVatFilingDocument(input.documentId, input.subjectId, db);
  const rows = await readRecognitionSubjects(db), subjectProof: RecognitionSubjectProof[] = [];
  // 수집 주체는 서버 환경값이며 요청값·다른 주체의 번호로 대체하지 않는다.
  const collector = process.env.BAROBILL_CORPNUM?.trim();
  for (const date of [...new Set(input.dates)].sort()) {
    const subject = strictRecognitionSubject(rows, input.subjectId, date, input.recipient, collector);
    if (!subject.evidenceRef?.startsWith("vat-document:") || !subject.evidenceHash) {
      throw recognitionError("회사 기준의 서버 보관 증빙을 먼저 확인하세요. 선언된 지문만으로 재검토할 수 없습니다.", 409, "recognition_subject_evidence_required");
    }
    const evidence = await requireVatFilingDocument(subject.evidenceRef.slice("vat-document:".length), input.subjectId, db);
    if (evidence.evidenceHash !== subject.evidenceHash || evidence.evidenceRef !== subject.evidenceRef) throw recognitionUnavailable("회사 기준의 증빙과 보관 원문이 일치하지 않습니다.");
    subjectProof.push({ date, subjectId: subject.subjectId, revisionId: subject.revisionId, corpNum: subject.corpNum,
      revisionHash: vatHashV2(subject), evidenceRef: evidence.evidenceRef, evidenceHash: evidence.evidenceHash });
  }
  if (!subjectProof.length || new Set(subjectProof.map(row => `${row.subjectId}:${row.corpNum}`)).size !== 1) {
    throw recognitionError("업무일 사이 회사 기준이 달라 재검토할 수 없습니다.", 409, "recognition_subject_conflict");
  }
  return { subjectProof, document };
}
