import { randomUUID } from "node:crypto";
import { rowsToObjects, withDbRead, withDbWrite, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { lockAccountingWrite } from "./write-lock";
import { assertSupplyReviewPrerequisites } from "./supply-review-prerequisites";
import { vatHashV2 } from "./vat-canonical-v2";
import { assessSupplyReview, supplyReviewError, validateSupplyReviewDraft, validateSupplyReviewPreviewInput, validateSupplyReviewSaveInput, validateSupplyReviewWithdrawInput } from "./supply-review-pure";
import { loadSupplyReviewBasis, readSupplyCReference, requireSupplySubject, supplyUnavailable } from "./supply-review-context";
import { readRecognitionSubjects } from "./recognition-review-subjects";
import { listVatFilingDocuments } from "./vat-filing-documents";
import { loadTransactionLinkState } from "./transaction-links";
import type { SupplyReviewAssessment, SupplyReviewBasis, SupplyReviewPreview, SupplyReviewPreviewInput, SupplyReviewRecord } from "./supply-review-types";

const parse = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : value) as T;
const identifier = (v: unknown): string => { if (typeof v !== "string" || !v || v.length > 200 || /[\x00-\x20\x7f]/.test(v)) throw supplyReviewError("식별자를 확인하세요."); return v; };
const schema = () => process.env.FINANCE_R1_SCHEMA ?? "public";
function translate(error: unknown): never {
  const e = error as { status?: number; code?: string };
  if ([400, 403, 404, 409, 503].includes(e.status ?? 0)) throw error;
  if (["23503", "23505", "23514", "40001", "40P01"].includes(e.code ?? "")) throw supplyReviewError("자료가 동시에 바뀌었거나 저장 근거가 맞지 않습니다. 다시 조회하세요.", 409, "supply_review_conflict");
  throw supplyUnavailable();
}
async function transaction<T>(write: boolean, fn: (db: PgDatabase) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const work = async (db: PgDatabase) => { if (write) await lockAccountingWrite(db); await assertSupplyReviewPrerequisites(db, schema()); return fn(db); };
      return write ? await withDbWrite(work, { accountingSnapshot: true }) : await withDbRead(work);
    } catch (error) { if (attempt < 2 && ["40001", "40P01"].includes(String((error as { code?: string }).code))) continue; return translate(error); }
  }
}
function record(row: Record<string, unknown>): SupplyReviewRecord {
  try {
    const draft = validateSupplyReviewDraft(parse(row.payload_json)), basis = parse<SupplyReviewBasis>(row.basis_json), assessment = parse<SupplyReviewAssessment>(row.assessment_json);
    if (vatHashV2(draft) !== row.payload_hash || vatHashV2(basis) !== row.basis_hash || draft.subjectId !== row.subject_id
      || basis.subjectId !== draft.subjectId || vatHashV2(assessSupplyReview(draft, basis)) !== vatHashV2(assessment)
      || vatHashV2({ draft, basis, assessment }) !== row.preview_hash || row.schema_version !== draft.schemaVersion
      || !["recorded", "withdrawn"].includes(String(row.state))) throw supplyUnavailable();
    return { caseId: String(row.case_id), subjectId: String(row.subject_id), revisionId: String(row.revision_id), version: Number(row.version),
      previousRevisionId: row.previous_revision_id == null ? null : String(row.previous_revision_id), state: row.state as "recorded" | "withdrawn",
      actorUserId: String(row.actor_user_id), createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      draft, basis, assessment, payloadHash: String(row.payload_hash), basisHash: String(row.basis_hash),
      withdrawalReason: row.withdrawal_reason == null ? null : String(row.withdrawal_reason) };
  } catch { throw supplyUnavailable(); }
}
async function latest(db: PgDatabase, caseId: string | null): Promise<SupplyReviewRecord | null> {
  if (!caseId) return null;
  const rows = rowsToObjects(await db.exec(`SELECT r.*,c.subject_id FROM finance_supply_review_cases c
    JOIN finance_supply_review_revisions r ON r.case_id=c.case_id WHERE c.case_id=$1 ORDER BY r.version DESC LIMIT 1`, [caseId]));
  if (!rows[0]) throw supplyReviewError("공급 근거 기록을 찾을 수 없습니다.", 404, "supply_review_missing");
  return record(rows[0]);
}
async function preview(db: PgDatabase, input: SupplyReviewPreviewInput): Promise<SupplyReviewPreview> {
  const current = await latest(db, input.caseId);
  if (current && current.subjectId !== input.draft.subjectId) throw supplyReviewError("기존 기록의 회사를 바꿀 수 없습니다.", 409, "supply_review_subject_conflict");
  const basis = await loadSupplyReviewBasis(db, input.draft), assessment = assessSupplyReview(input.draft, basis);
  return { caseId: input.caseId, currentRevisionId: current?.revisionId ?? null, currentVersion: current?.version ?? 0,
    previewHash: vatHashV2({ draft: input.draft, basis, assessment }), draft: input.draft, basis, assessment };
}
export async function previewSupplyReview(input: unknown) {
  const value = validateSupplyReviewPreviewInput(input); return transaction(false, db => preview(db, value));
}
export interface SupplyReviewResult { caseId: string; revisionId: string; version: number; state: "recorded" | "withdrawn"; replayed: boolean }
async function replay(db: PgDatabase, requestId: string, action: string, actor: string, payloadHash: string): Promise<SupplyReviewResult | null> {
  const old = rowsToObjects(await db.exec("SELECT action,actor_user_id,payload_hash,result_json FROM finance_supply_review_requests WHERE request_id=$1", [requestId]))[0];
  if (!old) return null;
  if (old.action !== action || old.actor_user_id !== actor || old.payload_hash !== payloadHash) throw supplyReviewError("같은 요청 식별자의 내용 또는 담당자가 다릅니다.", 409, "supply_review_request_conflict");
  return { ...parse<SupplyReviewResult>(old.result_json), replayed: true };
}
async function persist(db: PgDatabase, p: SupplyReviewPreview, action: "save" | "withdraw", actor: string, requestId: string, requestHash: string, reason: string | null): Promise<SupplyReviewResult> {
  if (p.currentVersion >= 2147483647) throw supplyReviewError("기록 판번호 상한을 초과했습니다.", 409);
  const caseId = p.caseId ?? `sr-${randomUUID()}`, revisionId = `srv-${randomUUID()}`, version = p.currentVersion + 1;
  const result: SupplyReviewResult = { caseId, revisionId, version, state: action === "save" ? "recorded" : "withdrawn", replayed: false };
  if (!p.caseId) await db.run("INSERT INTO finance_supply_review_cases(case_id,subject_id,created_by)VALUES($1,$2,$3)", [caseId, p.draft.subjectId, actor]);
  await db.run(`INSERT INTO finance_supply_review_revisions(revision_id,case_id,version,previous_revision_id,schema_version,state,
    payload_json,payload_hash,basis_json,basis_hash,assessment_json,preview_hash,withdrawal_reason,actor_user_id,request_id)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11::jsonb,$12,$13,$14,$15)`,
    [revisionId, caseId, version, p.currentRevisionId, p.draft.schemaVersion, result.state, JSON.stringify(p.draft), vatHashV2(p.draft),
      JSON.stringify(p.basis), vatHashV2(p.basis), JSON.stringify(p.assessment), p.previewHash, reason, actor, requestId]);
  await db.run("INSERT INTO finance_supply_review_requests(request_id,action,actor_user_id,payload_hash,result_json)VALUES($1,$2,$3,$4,$5::jsonb)", [requestId, action, actor, requestHash, JSON.stringify(result)]);
  await recordAuditLogInline(db, { actorUserId: actor, action: "finance_supply_review", targetTable: "finance_supply_review_revisions", targetId: revisionId,
    after: { ...result, subjectId: p.draft.subjectId, previewHash: p.previewHash, canApply: false, consumptionSupported: false } });
  return result;
}
export async function saveSupplyReview(input: unknown, actorUserId: string) {
  const value = validateSupplyReviewSaveInput(input), actor = identifier(actorUserId), requestHash = vatHashV2(value);
  return transaction(true, async db => {
    const previous = await replay(db, value.requestId, "save", actor, requestHash); if (previous) return previous;
    const p = await preview(db, { caseId: value.caseId, draft: value.draft });
    if (p.currentRevisionId !== value.expectedRevisionId || p.currentVersion !== value.expectedVersion || p.previewHash !== value.expectedPreviewHash) {
      throw supplyReviewError("미리보기 이후 원천·근거·기록 판이 바뀌었습니다. 최신 내용을 다시 확인하세요.", 409, "supply_review_preview_stale");
    }
    return persist(db, p, "save", actor, value.requestId, requestHash, null);
  });
}
export async function withdrawSupplyReview(input: unknown, actorUserId: string) {
  const value = validateSupplyReviewWithdrawInput(input), actor = identifier(actorUserId), requestHash = vatHashV2(value);
  return transaction(true, async db => {
    const previous = await replay(db, value.requestId, "withdraw", actor, requestHash); if (previous) return previous;
    const current = (await latest(db, value.caseId))!;
    if (current.revisionId !== value.expectedRevisionId || current.version !== value.expectedVersion || current.state !== "recorded") throw supplyReviewError("철회할 최신 기록을 다시 확인하세요.", 409, "supply_review_preview_stale");
    const p: SupplyReviewPreview = { caseId: current.caseId, currentRevisionId: current.revisionId, currentVersion: current.version,
      draft: current.draft, basis: current.basis, assessment: current.assessment,
      previewHash: vatHashV2({ draft: current.draft, basis: current.basis, assessment: current.assessment }) };
    return persist(db, p, "withdraw", actor, value.requestId, requestHash, value.reason);
  });
}
export async function listSupplyReviewHistory(caseId: string) {
  const id = identifier(caseId); return transaction(false, async db => {
    await latest(db, id);
    const rows = rowsToObjects(await db.exec(`SELECT r.*,c.subject_id FROM finance_supply_review_revisions r
      JOIN finance_supply_review_cases c ON c.case_id=r.case_id WHERE r.case_id=$1 ORDER BY r.version DESC LIMIT 101`, [id]));
    return { history: rows.slice(0, 100).map(record), hasMore: rows.length > 100 };
  });
}
export async function listSupplyReviews(subjectId?: string, sourceOffset = 0) {
  if (subjectId !== undefined) identifier(subjectId);
  if (!Number.isSafeInteger(sourceOffset) || sourceOffset < 0 || sourceOffset > 1000000) throw supplyReviewError("조회 위치를 확인하세요.");
  return transaction(false, async db => {
    const subjectRows = await readRecognitionSubjects(db), latestSubjects = new Map<string, typeof subjectRows[number]>();
    for (const s of subjectRows) if (!latestSubjects.has(s.subjectId) || latestSubjects.get(s.subjectId)!.version < s.version) latestSubjects.set(s.subjectId, s);
    const subjects = [...latestSubjects.values()].map(s => ({ subjectId: s.subjectId, label: `${s.corpNum || "번호 미확인"} · ${s.subjectId}` }));
    if (!subjectId) return { subjects, documents: [], sources: [], cReferences: [], records: [], hasMore: false, sourcesHasMore: false, nextSourceOffset: null };
    await requireSupplySubject(db, subjectId);
    const documents = await listVatFilingDocuments(subjectId, db), state = await loadTransactionLinkState(db);
    const allSources = state.sources.filter(s => ["card", "hometax", "tax_invoice"].includes(s.kind)).sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
    const sources = allSources.slice(sourceOffset, sourceOffset + 500).map(s => ({ kind: s.kind, sourceId: s.id, name: s.name, date: s.date, supply: s.supply, tax: s.tax, total: s.total }));
    const rows = rowsToObjects(await db.exec(`SELECT r.*,c.subject_id FROM finance_supply_review_cases c
      JOIN LATERAL(SELECT * FROM finance_supply_review_revisions WHERE case_id=c.case_id ORDER BY version DESC LIMIT 1) r ON true
      WHERE c.subject_id=$1 ORDER BY r.created_at DESC,r.revision_id DESC LIMIT 101`, [subjectId]));
    const cRows = rowsToObjects(await db.exec(`SELECT c.revision_id,c.pair_line_no FROM vat_followup_review_consumptions c
      JOIN vat_followup_review_revisions v ON v.revision_id=c.revision_id JOIN vat_followup_review_roots r ON r.review_id=v.review_id
      WHERE r.subject_id=$1 ORDER BY c.revision_id,c.pair_line_no LIMIT 201`, [subjectId]));
    const cReferences = []; for (const row of cRows.slice(0, 200)) { const r = await readSupplyCReference(db, String(row.revision_id), Number(row.pair_line_no));
      cReferences.push({ revisionId: r.revisionId, pairLineNo: r.pairLineNo, pairKey: r.pairKey, claimedSupply: r.claimedSupply, claimedTax: r.claimedTax, historicalKind: r.historicalKind, historicalSourceId: r.historicalSourceId }); }
    return { subjects, documents, sources, cReferences, cReferencesHasMore: cRows.length > 200, records: rows.slice(0, 100).map(record), hasMore: rows.length > 100,
      sourcesHasMore: allSources.length > sourceOffset + 500, nextSourceOffset: allSources.length > sourceOffset + 500 ? sourceOffset + 500 : null };
  });
}
