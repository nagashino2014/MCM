import type { SupplyDocumentInput, SupplyDocumentRegisterInput, SupplyDocumentPreview, SupplyDocumentResult, SupplyDocumentList } from "./supply-document-types";

export function documentError(message: string, status = 400, code = "supply_document_input") {
  return Object.assign(new Error(message), { status, code });
}
export const documentUnavailable = () => documentError("문서 등록에 필요한 자료구조 또는 보관 근거를 확인할 수 없습니다.", 503, "supply_document_unavailable");
const inputError = () => documentError("문서 등록 요청을 확인하세요.");
const idPattern = /^[^\x00-\x20\x7f]{1,200}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const kinds = new Set(["card", "hometax", "tax_invoice"]);
function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw inputError();
  return value as Record<string, unknown>;
}
function keys(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  const row = obj(value), names = Object.keys(row);
  if (required.some(k => !Object.hasOwn(row, k)) || names.some(k => !required.includes(k) && !optional.includes(k))) throw inputError();
  return row;
}
export function documentId(value: unknown): string {
  if (typeof value !== "string" || !idPattern.test(value)) throw inputError();
  return value;
}
function hash(value: unknown): string { if (typeof value !== "string" || !hashPattern.test(value)) throw inputError(); return value; }
function integer(value: unknown, min = 0) { if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > 2147483647) throw inputError(); }
function bool(value: unknown) { if (typeof value !== "boolean") throw inputError(); }
function source(value: unknown, withHash = false) {
  const r = keys(value, ["kind", "id", ...(withHash ? ["sourceHash"] : [])]);
  if (typeof r.kind !== "string" || !kinds.has(r.kind)) throw inputError();
  documentId(r.id); if (withHash) hash(r.sourceHash);
}
const summaryFields = ["date", "direction", "approvalNumber", "supply", "tax", "total"];
function summary(r: Record<string, unknown>) {
  if (typeof r.date !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(r.date) || !Number.isFinite(Date.parse(`${r.date}T00:00:00Z`))
    || new Date(`${r.date}T00:00:00Z`).toISOString().slice(0, 10) !== r.date || typeof r.direction !== "string" || !["purchase", "sales"].includes(r.direction)) throw inputError();
  if (r.approvalNumber !== null && (typeof r.approvalNumber !== "string" || r.approvalNumber.length > 200)) throw inputError();
  if (![r.supply, r.tax, r.total].every(Number.isSafeInteger) || Number(r.supply) + Number(r.tax) !== r.total) throw inputError();
}
const inputFields = ["subjectId", "reviewRevisionId", "sourceKind", "sourceId"];
export function validateDocumentInput(value: unknown, register: true): SupplyDocumentRegisterInput;
export function validateDocumentInput(value: unknown, register?: false): SupplyDocumentInput;
export function validateDocumentInput(value: unknown, register = false): SupplyDocumentInput | SupplyDocumentRegisterInput {
  const r = keys(value, [...inputFields, ...(register ? ["expectedPreviewHash", "expectedVersion", "requestId"] : [])]);
  for (const name of ["subjectId", "reviewRevisionId", "sourceId"]) documentId(r[name]);
  if (typeof r.sourceKind !== "string" || !kinds.has(r.sourceKind)) throw inputError();
  if (register) { hash(r.expectedPreviewHash); integer(r.expectedVersion); documentId(r.requestId); }
  return r as unknown as SupplyDocumentInput | SupplyDocumentRegisterInput;
}
/** SQL 결과도 허용된 필드만 전달한다. 원문 카드번호·raw·내부 오류의 우발적 노출을 막는다. */
export function validateDocumentPreview(value: unknown): SupplyDocumentPreview {
  try {
    const r = keys(value, ["schemaVersion", "subjectId", "reviewRevisionId", "source", "canRegister", "issues", "documentId", "portionId", "version", "identity", "observation", "previewHash"]);
    if (r.schemaVersion !== "de1a-document-preview-v1") throw inputError();
    documentId(r.subjectId); documentId(r.reviewRevisionId); source(r.source); bool(r.canRegister); integer(r.version); hash(r.previewHash);
    for (const name of ["documentId", "portionId"]) if (r[name] !== null) documentId(r[name]);
    if (!Array.isArray(r.issues)) throw inputError();
    for (const issue of r.issues) { const i = keys(issue, ["code", "message"]); if (typeof i.code !== "string" || typeof i.message !== "string") throw inputError(); }
    if (r.identity !== null) {
      const i = keys(r.identity, ["namespace", "keyHash", "baseKeyHash", "descriptorHash"]);
      documentId(i.namespace); hash(i.keyHash); hash(i.descriptorHash); if (i.baseKeyHash !== null) hash(i.baseKeyHash);
    }
    if (r.observation !== null) {
      const o = keys(r.observation, [...summaryFields, "subjectRevisionId", "sources", "snapshotHash"]);
      summary(o); documentId(o.subjectRevisionId); hash(o.snapshotHash);
      if (!Array.isArray(o.sources)) throw inputError(); for (const s of o.sources) source(s, true);
    }
    if (r.canRegister && (!r.identity || !r.observation || r.issues.length || !(r.observation as { sources: unknown[] }).sources.length)) throw inputError();
    return r as unknown as SupplyDocumentPreview;
  } catch { throw documentUnavailable(); }
}
export function validateDocumentResult(value: unknown): SupplyDocumentResult {
  try {
    const r = keys(value, ["documentId", "portionId", "observationId", "version", "replayed"]);
    for (const name of ["documentId", "portionId", "observationId"]) documentId(r[name]); integer(r.version, 1); bool(r.replayed);
    return r as unknown as SupplyDocumentResult;
  } catch { throw documentUnavailable(); }
}
export function validateDocumentList(value: unknown): SupplyDocumentList {
  try {
    const r = keys(value, ["documents", "hasMore"], ["history", "historyHasMore"]); bool(r.hasMore);
    if (!Array.isArray(r.documents)) throw inputError();
    for (const d of r.documents) { const row = keys(d, ["documentId", "portionId", "version", "latestObservation", "observationCount"]);
      documentId(row.documentId); documentId(row.portionId); integer(row.version, 1); integer(row.observationCount, 1); summary(keys(row.latestObservation, summaryFields)); }
    if (r.history !== undefined) {
      if (!Array.isArray(r.history)) throw inputError();
      bool(r.historyHasMore);
      for (const h of r.history) { const row = keys(h, ["observationId", "version", "reviewRevisionId", "createdAt", "summary"]);
        documentId(row.observationId); documentId(row.reviewRevisionId); integer(row.version, 1); if (typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt))) throw inputError(); summary(keys(row.summary, summaryFields)); }
    } else if (r.historyHasMore !== undefined) throw inputError();
    return r as unknown as SupplyDocumentList;
  } catch { throw documentUnavailable(); }
}
