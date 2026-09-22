import { vatHashV2 } from "./vat-canonical-v2";
import { validateAccountingRange } from "./write-lock";
import { validateSubject, type SubjectRevision } from "./vat-filing-scope";

export const recognitionError = (message: string, status = 409, code = "recognition_review_conflict") =>
  Object.assign(new Error(message), { status, code });
export const recognitionUnavailable = (message = "재검토 자료의 일관성을 확인할 수 없습니다.") =>
  recognitionError(message, 503, "recognition_review_unavailable");
export function recognitionId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.trim() !== value || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw recognitionError(`${label} 식별자가 올바르지 않습니다.`, 400, "recognition_review_input");
  }
  return value;
}
function text(value: unknown, label: string, limit: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit || value.includes("\0")) {
    throw recognitionError(`${label}을 확인하세요.`, 400, "recognition_review_input");
  }
  return value.trim();
}
export function closedObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) {
    throw recognitionError("요청 항목이 올바르지 않습니다.", 400, "recognition_review_input");
  }
  // 접근자·숨은 키·Unicode 오류와 지원하지 않는 숫자도 쓰기 전에 거절한다.
  vatHashV2(value);
  return value as Record<string, unknown>;
}
export interface RecognitionPreviewInput {
  recognitionId: string; subjectId: string; evidenceDocumentId: string; evidenceLocation: string; reason: string;
}
export interface RecognitionApplyInput extends RecognitionPreviewInput {
  requestId: string; expectedReviewVersion: number; expectedAppliedReviewId: string | null;
  expectedProjectionHash: string; expectedSourceHash: string; expectedPreviewHash: string; reviewConfirmed: true;
}
const previewKeys = ["recognitionId", "subjectId", "evidenceDocumentId", "evidenceLocation", "reason"] as const;
const applyKeys = [...previewKeys, "requestId", "expectedReviewVersion", "expectedAppliedReviewId", "expectedProjectionHash", "expectedSourceHash", "expectedPreviewHash", "reviewConfirmed"] as const;
export function validateRecognitionPreviewInput(value: unknown): RecognitionPreviewInput {
  const row = closedObject(value, previewKeys);
  return { recognitionId: recognitionId(row.recognitionId, "인식"), subjectId: recognitionId(row.subjectId, "회사"),
    evidenceDocumentId: recognitionId(row.evidenceDocumentId, "증빙"), evidenceLocation: text(row.evidenceLocation, "증빙의 확인 위치", 500), reason: text(row.reason, "재검토 사유", 2000) };
}
export function validateRecognitionApplyInput(value: unknown): RecognitionApplyInput {
  const row = closedObject(value, applyKeys), base = validateRecognitionPreviewInput(Object.fromEntries(previewKeys.map(key => [key, row[key]])));
  if (!Number.isInteger(row.expectedReviewVersion) || (row.expectedReviewVersion as number) < 0 || (row.expectedReviewVersion as number) >= 2147483647
    || row.reviewConfirmed !== true || ![row.expectedProjectionHash, row.expectedSourceHash, row.expectedPreviewHash].every(isRecognitionHash)
    || ((row.expectedReviewVersion === 0) !== (row.expectedAppliedReviewId === null))) throw recognitionError("미리보기 판과 명시적 검토 확인이 필요합니다.", 400, "recognition_review_input");
  return { ...base, requestId: recognitionId(row.requestId, "요청"), expectedReviewVersion: row.expectedReviewVersion as number,
    expectedAppliedReviewId: row.expectedAppliedReviewId === null ? null : recognitionId(row.expectedAppliedReviewId, "적용판"),
    expectedProjectionHash: row.expectedProjectionHash as string, expectedSourceHash: row.expectedSourceHash as string,
    expectedPreviewHash: row.expectedPreviewHash as string, reviewConfirmed: true };
}
export const isRecognitionHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export interface RecognitionProjection {
  schemaVersion: "r1-recognition-projection-v1"; recognitionId: string; canonicalInvoiceKey: string;
  sourceKind: string; sourceId: string; sourceHash: string; sourceSnapshotText: string; expenseAccount: string | null;
  reason: string; evidence: string; creationRequestId: string; createdBy: string; createdAt: string;
  appliedReviewId: string | null; reviewVersion: number;
}
/** source_snapshot::text는 DB 문자열 그대로 결합하고 Number/JSON 왕복을 하지 않는다. */
export function recognitionProjectionFromDbRow(row: Record<string, unknown>): RecognitionProjection {
  const required = ["recognition_id", "canonical_invoice_key", "source_kind", "source_id", "source_hash", "source_snapshot_text", "reason", "evidence", "request_id", "created_by", "created_at"];
  if (!required.every(key => typeof row[key] === "string") || !isRecognitionHash(row.source_hash)
    || !(row.expense_account === null || typeof row.expense_account === "string")
    || !(row.applied_review_id === null || typeof row.applied_review_id === "string") || !Number.isInteger(row.review_version)
    || (row.review_version as number) < 0 || (row.review_version as number) > 2147483647
    || ((row.review_version === 0) !== (row.applied_review_id === null))) throw recognitionUnavailable();
  const result: RecognitionProjection = { schemaVersion: "r1-recognition-projection-v1", recognitionId: row.recognition_id as string,
    canonicalInvoiceKey: row.canonical_invoice_key as string, sourceKind: row.source_kind as string, sourceId: row.source_id as string,
    sourceHash: row.source_hash as string, sourceSnapshotText: row.source_snapshot_text as string, expenseAccount: row.expense_account as string | null,
    reason: row.reason as string, evidence: row.evidence as string, creationRequestId: row.request_id as string,
    createdBy: row.created_by as string, createdAt: row.created_at as string, appliedReviewId: row.applied_review_id as string | null, reviewVersion: row.review_version as number };
  try { vatHashV2(result); } catch { throw recognitionUnavailable(); }
  return result;
}
export const recognitionProjectionHash = (value: RecognitionProjection): string => vatHashV2(value);

/** DB numeric 문자열에서 정수성과 상한을 먼저 확인하고 마지막에만 Number로 변환한다. */
export function exactRecognitionMoney(value: unknown): number {
  if (typeof value !== "string" || value.length > 100) throw recognitionError("금액의 정확한 문자열 표현을 확인할 수 없습니다.");
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) throw recognitionError("원 단위 금액 형식을 확인하세요.");
  const exponent = Number(match[4] ?? 0), fraction = match[3] ?? "";
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 100) throw recognitionError("지원 금액 범위를 벗어났습니다.");
  let amount = BigInt(match[2] + fraction), scale = fraction.length - exponent;
  if (scale > 0) { const denominator = BigInt(10) ** BigInt(scale); if (amount % denominator !== BigInt(0)) throw recognitionError("금액은 정확한 원 단위 정수여야 합니다."); amount /= denominator; }
  else if (scale < 0) amount *= BigInt(10) ** BigInt(-scale);
  if (match[1] === "-" && amount !== BigInt(0) || amount > BigInt("9007199254740991")) throw recognitionError("금액이 지원하는 양수 원 단위 범위를 벗어났습니다.");
  return Number(amount);
}

export function recognitionCorpNum(value: unknown): string {
  if (typeof value !== "string" || !/^(?:\d{10}|\d{3}-\d{2}-\d{5})$/.test(value) || /^0+$/.test(value.replaceAll("-", ""))) {
    throw recognitionError("업무일에 적용할 회사의 사업자번호를 확인하세요.", 409, "recognition_subject_conflict");
  }
  return value.replaceAll("-", "");
}
export function recognitionSubjectRows(rows: Record<string, unknown>[]): SubjectRevision[] {
  return rows.map(row => {
    let value: unknown, subject: SubjectRevision;
    try {
      value = typeof row.payload_json === "string" ? JSON.parse(row.payload_json) : row.payload_json;
      subject = validateSubject(value);
      const storedNumber = value && typeof value === "object" ? (value as Record<string, unknown>).corpNum : null;
      // B1 writes a canonical number. Do not normalize old SQL-only payloads while
      // computing a proof that SQL checks against the immutable original payload.
      if (typeof storedNumber !== "string" || storedNumber !== "" && (!/^\d{10}$/.test(storedNumber) || /^0+$/.test(storedNumber))) throw new Error();
    } catch { throw recognitionUnavailable("저장된 회사 기준 판의 형식을 확인할 수 없습니다."); }
    if (subject.revisionId !== row.revision_id || subject.subjectId !== row.subject_id || subject.version !== row.version
      || row.parent_subject_id !== row.subject_id) throw recognitionUnavailable("회사 기준 판과 원장 연결이 일치하지 않습니다.");
    // validateSubject의 정규화가 잘못된 번호를 수선한 것처럼 보이지 않게 원문을 사용한다.
    return { ...subject, corpNum: (value as Record<string, unknown>).corpNum as string };
  });
}
const covers = (subject: SubjectRevision, date: string) => subject.effectiveFrom <= date && (subject.effectiveTo === null || subject.effectiveTo >= date);
/** 미래판은 제외하되, 종료·축소된 최신 구간 뒤에서 옛 무기한 판이 부활하지 않게 한다. */
export function selectRecognitionSubject(rows: SubjectRevision[], subjectId: string, date: string): SubjectRevision | null {
  validateAccountingRange(date, date);
  const applicable = rows.filter(row => row.subjectId === subjectId && row.effectiveFrom <= date).sort((a, b) => b.version - a.version);
  const chosen = applicable.find(row => covers(row, date));
  if (!chosen) return null;
  if (applicable.some(row => row.version > chosen.version && row.effectiveTo !== null && row.effectiveTo < date
    && row.effectiveFrom <= (chosen.effectiveTo ?? "9999-12-31") && chosen.effectiveFrom <= row.effectiveTo)) return null;
  return chosen;
}
export function strictRecognitionSubject(rows: SubjectRevision[], subjectId: string, date: string, recipient: unknown, collector: unknown): SubjectRevision {
  const chosen = selectRecognitionSubject(rows, subjectId, date);
  if (!chosen || chosen.state !== "verified" || chosen.entityType !== "corporation" || chosen.vatRegime !== "general" || chosen.filingUnit !== "single_business_place") {
    throw recognitionError("업무일에 유효한 검증된 단일 법인 사업장 기준이 필요합니다.", 409, "recognition_subject_conflict");
  }
  const corpNum = recognitionCorpNum(chosen.corpNum);
  if (corpNum !== recognitionCorpNum(recipient) || corpNum !== recognitionCorpNum(collector)) throw recognitionError("계산서의 공급받는 자·수집 주체·회사 기준 번호가 다릅니다.", 409, "recognition_subject_conflict");
  for (const otherId of new Set(rows.map(row => row.subjectId))) {
    if (otherId === subjectId) continue;
    const other = selectRecognitionSubject(rows, otherId, date);
    if (!other || other.corpNum === "") continue;
    if (recognitionCorpNum(other.corpNum) === corpNum) throw recognitionError("같은 업무일에 동일 사업자번호를 가진 회사 기준이 중복됩니다.", 409, "recognition_subject_conflict");
  }
  return { ...chosen, corpNum };
}
