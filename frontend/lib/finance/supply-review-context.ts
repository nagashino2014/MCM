import { createHash } from "node:crypto";
import { rowsToObjects, type PgDatabase } from "@/lib/db";
import { loadTransactionLinkState, type TransactionLinkSource } from "./transaction-links";
import { readRecognitionSubjects } from "./recognition-review-subjects";
import { strictRecognitionSubject } from "./recognition-review-pure";
import { requireVatFilingDocument } from "./vat-filing-documents";
import { supplyReviewError } from "./supply-review-pure";
import { assertSupplyCReferenceTarget } from "./supply-review-c-proof";
import type { SupplyReviewBasis, SupplyReviewCReferenceSnapshot, SupplyReviewDraft, SupplyReviewSourceSnapshot } from "./supply-review-types";

const hashText = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const parse = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : value) as T;
export const supplyUnavailable = () => supplyReviewError("공급 근거의 저장 구조 또는 보관 자료를 확인할 수 없습니다.", 503, "supply_review_unavailable");
export async function requireSupplySubject(db: PgDatabase, subjectId: string) {
  const rows = rowsToObjects(await db.exec("SELECT subject_id FROM vat_filing_subjects WHERE subject_id=$1", [subjectId]));
  if (!rows.length) throw supplyReviewError("등록된 회사 기준을 찾을 수 없습니다.", 404, "supply_review_subject_missing");
}

/** 계보는 별도 조회한다. 기존 v1 원천 SELECT와 그 지문에 열을 추가하지 않는다. */
async function metadata(db: PgDatabase, draft: SupplyReviewDraft) {
  const ids = (kind: string) => draft.members.filter(m => m.kind === kind).map(m => m.sourceId);
  const result = new Map<string, string>();
  const hti = rowsToObjects(await db.exec(`SELECT hti_id AS id,jsonb_build_object(
    'kind','hometax','ownApprovalNumber',nts_send_key,'modifyCode',modify_code,
    'rawWriteDate',raw_json->'WriteDate','storedWriteDate',write_date,'issueDateTime',issue_dt,'ntsSendDateTime',nts_send_dt,
    'originalReferenceCollection','not_collected')::text AS metadata_text
    FROM hometax_tax_invoices WHERE hti_id=ANY($1::text[]) ORDER BY hti_id`, [ids("hometax")]));
  const app = rowsToObjects(await db.exec(`SELECT i.invoice_id AS id,jsonb_build_object(
    'kind','tax_invoice','ownApprovalNumber',i.nts_send_key,'modifyCode',i.modify_code,
    'originalInvoiceId',i.original_invoice_id,'originalApprovalNumber',o.nts_send_key,
    'originalRowFound',o.invoice_id IS NOT NULL,'originalReferenceCollection','stored_app_reference')::text AS metadata_text
    FROM tax_invoices i LEFT JOIN tax_invoices o ON o.invoice_id=i.original_invoice_id
    WHERE i.invoice_id=ANY($1::text[]) ORDER BY i.invoice_id`, [ids("tax_invoice")]));
  for (const [kind, rows] of [["hometax", hti], ["tax_invoice", app]] as const) for (const row of rows) {
    if (typeof row.metadata_text !== "string") throw supplyUnavailable();
    result.set(`${kind}:${row.id}`, row.metadata_text);
  }
  return result;
}

function sourceSnapshot(member: SupplyReviewDraft["members"][number], source: TransactionLinkSource | undefined, text: string): SupplyReviewSourceSnapshot {
  const money = source ? [source.supply, source.tax, source.total] : [0, 0, 0];
  if (!money.every(Number.isSafeInteger) || !Number.isSafeInteger(money[0] + money[1])) throw supplyUnavailable();
  return { memberId: member.memberId, kind: member.kind, sourceId: member.sourceId, found: !!source,
    sourceHash: source?.sourceHash ?? null, canonicalKey: source?.canonicalKey ?? null,
    date: source?.date ?? null, taxDate: source?.taxDate ?? null, direction: source?.direction ?? null,
    partyName: source?.partyName ?? "", recipientCorpNum: source?.raw.invoicee_corp_num == null ? null : String(source.raw.invoicee_corp_num),
    ownApprovalNumber: source?.raw.nts_send_key == null ? null : String(source.raw.nts_send_key),
    supply: money[0], tax: money[1], total: money[2], sourceIssues: source?.issues ?? [], metadataText: text, metadataHash: hashText(text) };
}

export async function readSupplyCReference(db: PgDatabase, revisionId: string, pairLineNo: number): Promise<SupplyReviewCReferenceSnapshot> {
  const rows = rowsToObjects(await db.exec(`SELECT p.pair_json::text AS pair_text,r.subject_id,v.state,
    c.consumption_id,c.payload_json::text AS consumed_text,c.basis_confirmation_id,c.legacy_archive_id,c.calculation_hash,
    p.pair_key FROM vat_followup_review_pairs p
    JOIN vat_followup_review_revisions v ON v.revision_id=p.revision_id
    JOIN vat_followup_review_roots r ON r.review_id=v.review_id
    LEFT JOIN vat_followup_review_consumptions c ON c.revision_id=p.revision_id AND c.pair_line_no=p.line_no
    WHERE p.revision_id=$1 AND p.line_no=$2`, [revisionId, pairLineNo]));
  if (rows.length > 1) throw supplyUnavailable();
  const row = rows[0];
  if (!row) { const text = "null"; return { revisionId, pairLineNo, found: false, consumptionId: null, subjectId: null,
    pairKey: null, historicalSide: null, historicalKind: null, historicalSourceId: null, claimedSupply: null, claimedTax: null,
    snapshotText: text, snapshotHash: hashText(text) }; }
  const pair = parse<import("./vat-followup-review-types").VatFollowupResolvedPair>(row.pair_text);
  const consumed = row.consumed_text == null ? null : parse<{ revisionId: string; pairLineNo: number; pairKey: string; pair: typeof pair; priorClaimedTax: number }>(row.consumed_text);
  if (!pair?.past?.claim || pair.pairKey !== row.pair_key || pair.past.subjectId !== row.subject_id || !["card", "invoice"].includes(pair.historicalSide)
    || !Number.isSafeInteger(pair.past.claim.claimedTax) || pair.past.claim.claimedTax < 0
    || consumed && (row.state !== "verified" || consumed.revisionId !== revisionId || consumed.pairLineNo !== pairLineNo
      || consumed.pairKey !== pair.pairKey || consumed.priorClaimedTax !== pair.past.claim.claimedTax
      || hashText(JSON.stringify(consumed.pair)) !== hashText(JSON.stringify(pair)))) throw supplyUnavailable();
  const targetProofText = row.consumption_id == null ? null : await assertSupplyCReferenceTarget(db, {
    basis_confirmation_id: row.basis_confirmation_id, legacy_archive_id: row.legacy_archive_id,
    calculation_hash: row.calculation_hash, subject_id: row.subject_id, consumption_id: row.consumption_id,
  }, revisionId, pairLineNo);
  const text = JSON.stringify({ revisionId, pairLineNo, state: row.state, pairText: row.pair_text, consumptionText: row.consumed_text ?? null, targetProofText,
    basisConfirmationId: row.basis_confirmation_id ?? null, legacyArchiveId: row.legacy_archive_id ?? null, calculationHash: row.calculation_hash ?? null });
  return { revisionId, pairLineNo, found: true, consumptionId: row.consumption_id == null ? null : String(row.consumption_id),
    subjectId: String(row.subject_id), pairKey: pair.pairKey, historicalSide: pair.historicalSide,
    historicalKind: pair.past.claim.sourceKind === "tax_invoice" ? null : pair.past.claim.sourceKind,
    historicalSourceId: pair.past.claim.sourceId,
    // C의 supply는 원천 공급가액이다. 실제 기공제 공급가액으로 추정하지 않는다.
    claimedSupply: null, claimedTax: pair.past.claim.claimedTax, snapshotText: text, snapshotHash: hashText(text) };
}

export async function loadSupplyReviewBasis(db: PgDatabase, draft: SupplyReviewDraft): Promise<SupplyReviewBasis> {
  await requireSupplySubject(db, draft.subjectId);
  const subjects = await readRecognitionSubjects(db), state = await loadTransactionLinkState(db), extra = await metadata(db, draft);
  const selected = subjects.filter(s => s.subjectId === draft.subjectId);
  const subjectText = JSON.stringify({ collector: process.env.BAROBILL_CORPNUM?.trim() ?? null, revisions: selected,
    sameNumberRevisions: subjects.filter(s => s.subjectId !== draft.subjectId && selected.some(v => v.corpNum && v.corpNum === s.corpNum)) });
  const basis: SupplyReviewBasis = { schemaVersion: "de0-supply-basis-v1", subjectId: draft.subjectId,
    subjectSnapshotText: subjectText, subjectSnapshotHash: hashText(subjectText), subjectIssues: [], sources: [], documents: [], cReferences: [] };
  for (const member of draft.members) {
    const source = state.sources.find(s => s.kind === member.kind && s.id === member.sourceId);
    const text = extra.get(`${member.kind}:${member.sourceId}`) ?? JSON.stringify({ kind: member.kind, originalReferenceCollection: "not_applicable" });
    basis.sources.push(sourceSnapshot(member, source, text));
  }
  const dates = new Set(draft.lines.flatMap(l => [l.dateFrom, l.dateTo]));
  for (const source of basis.sources) { if (source.date) dates.add(source.date); if (source.taxDate) dates.add(source.taxDate); }
  // 양끝이 유효해도 중간에 회사 기준이 끊길 수 있다. 모든 판 경계의 전후를 확인한다.
  for (const s of subjects) for (const boundary of [s.effectiveFrom, s.effectiveTo].filter((v): v is string => v !== null)) {
    const day = new Date(`${boundary}T00:00:00Z`);
    for (const offset of [-1, 0, 1]) {
      const date = new Date(day.getTime() + offset * 86400000).toISOString().slice(0, 10);
      if (/^[1-9]\d{3}-\d{2}-\d{2}$/.test(date) && draft.lines.some(l => l.dateFrom <= date && date <= l.dateTo)) dates.add(date);
    }
  }
  for (const date of [...dates].sort()) {
    try {
      const subject = strictRecognitionSubject(subjects, draft.subjectId, date, process.env.BAROBILL_CORPNUM, process.env.BAROBILL_CORPNUM);
      if (!subject.evidenceRef?.startsWith("vat-document:") || !subject.evidenceHash) {
        basis.subjectIssues.push({ code: "subject_document_missing", scope: date, severity: "missing", message: "해당일 회사 기준의 보관 증빙이 필요합니다." });
      } else {
        const doc = await requireVatFilingDocument(subject.evidenceRef.slice(13), draft.subjectId, db);
        if (doc.evidenceHash !== subject.evidenceHash) throw supplyUnavailable();
      }
    } catch (error) {
      const e = error as { status?: number; code?: string; message: string };
      if (![400, 409].includes(e.status ?? 0)) throw error;
      basis.subjectIssues.push({ code: "subject_date_unresolved", scope: date, severity: "conflict", message: e.message });
    }
  }
  for (const s of basis.sources) if (s.found && s.kind !== "card" && s.date) {
    try { strictRecognitionSubject(subjects, draft.subjectId, s.date, s.recipientCorpNum, process.env.BAROBILL_CORPNUM); }
    catch (error) { if ((error as { status?: number }).status === 503) throw error;
      basis.subjectIssues.push({ code: "source_subject_unresolved", scope: s.memberId, severity: "conflict", message: "계산서의 공급받는 자와 회사 기준을 확인하세요." }); }
  }
  const documents = new Set<string>();
  for (const line of draft.lines) if (line.documentId) documents.add(line.documentId);
  for (const member of draft.members) if (member.correction.documentId) documents.add(member.correction.documentId);
  for (const claim of draft.claims) if (claim.documentId) documents.add(claim.documentId);
  for (const id of [...documents].sort()) { const doc = await requireVatFilingDocument(id, draft.subjectId, db);
    basis.documents.push({ documentId: doc.documentId, subjectId: doc.subjectId, evidenceHash: doc.evidenceHash, fileName: doc.fileName }); }
  const cRefs = new Map(draft.claims.filter(c => c.cReference).map(c => [JSON.stringify(c.cReference), c.cReference!]));
  for (const ref of [...cRefs.values()].sort((a, b) => a.revisionId.localeCompare(b.revisionId) || a.pairLineNo - b.pairLineNo)) {
    const snap = await readSupplyCReference(db, ref.revisionId, ref.pairLineNo);
    if (snap.found && snap.subjectId !== draft.subjectId) throw supplyReviewError("다른 회사의 검토 근거입니다.", 403, "supply_review_subject_forbidden");
    basis.cReferences.push(snap);
  }
  return basis;
}
