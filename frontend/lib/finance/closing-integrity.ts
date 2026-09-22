import { rowsToObjects, type PgDatabase } from "@/lib/db";
import { buildJournalDraftsForVerification, type EntryDraft } from "./journal";
import { isManagedJournalSource, loadJournalSourceStates, sourceFingerprint, sourceKey, validateJournalDrafts, type JournalSourceRef } from "./journal-source";
import { loadTransactionLinkState } from "./transaction-links";
import { buildClosingImpact, summarizeClosingImpact, type ClosingImpactResult } from "./closing-impact";
import { journalVerificationLinkIssues } from "./journal-links";
import { validateAccountingRange } from "./write-lock";

export interface ClosingIntegrityIssue { code: string; sourceId: string; message: string }
export interface ClosingCompleteness {
  scope: "g03b-r0";
  status: "verified" | "incomplete" | "verificationUnavailable";
  canClose: boolean;
  verificationUnavailable: boolean;
  checkedAt: string;
  issues: ClosingIntegrityIssue[];
  missingRequirements?: string[];
  impact?: ClosingImpactResult;
}
export interface ClosingInspectionOptions { impactDetails?: boolean }
export function summarizeClosingCompleteness(value: ClosingCompleteness): ClosingCompleteness {
  return value.impact ? {...value, impact: summarizeClosingImpact(value.impact)} : value;
}

const REQUIREMENTS: Record<string, string> = {
  card_merchant_corrections: "228 카드 사업자번호 정정 이력",
  card_tax_reviews: "225 카드 검토 자료",
  journal_source_snapshots: "226 전표 원천 스냅샷",
  transaction_links: "227 거래 연결",
  transaction_invoice_recognitions: "227 발생 인식",
  transaction_link_history: "227 연결 이력",
  transaction_link_requests: "227 연결 요청 이력",
};
const REQUIRED_COLUMNS: Record<string, string[]> = {
  card_merchant_corrections: ["event_id","card_txn_id","version","action","corp_num","original_corp_num","original_source_hash","original_basis","reason","evidence","actor_user_id","reviewed_by","created_at","request_id","payload_hash"],
  card_tax_reviews: ["card_txn_id", "decision", "reason", "evidence_ref", "source_hash", "tax_date", "original_card_txn_id", "original_source_hash", "reversal_reason", "reviewed_at"],
  journal_source_snapshots: ["entry_id", "snapshot_version", "source_hash", "source_json", "captured_at"],
  transaction_links: ["link_id", "relation", "left_kind", "left_id", "right_kind", "right_id", "canonical_invoice_key", "supply", "tax", "total", "expense_account", "reason", "evidence", "left_hash", "right_hash", "left_snapshot", "right_snapshot", "state", "request_id", "created_by", "created_at", "cancelled_by", "cancelled_at", "cancel_reason"],
  transaction_invoice_recognitions: ["recognition_id", "canonical_invoice_key", "source_kind", "source_id", "source_hash", "source_snapshot", "expense_account", "reason", "evidence", "request_id", "created_by", "created_at"],
  transaction_link_history: ["history_id", "link_id", "action", "request_id", "actor_user_id", "reason", "snapshot", "created_at"],
  transaction_link_requests: ["request_id", "action", "payload_hash", "result_json", "actor_user_id", "created_at"],
};
const validDate = (value: string) => { try { validateAccountingRange(value, value); return true; } catch { return false; } };
/** Diagnostic scope, not a tax/completeness certification of every business source. */
export async function inspectClosingCompleteness(db: PgDatabase, year: number, pendingCount: number, closed: boolean, options: ClosingInspectionOptions = {}): Promise<ClosingCompleteness> {
  const issues: ClosingIntegrityIssue[] = [];
  let unavailable = false;
  let impact: ClosingImpactResult | undefined;
  const result = (): ClosingCompleteness => ({ scope: "g03b-r0", status: unavailable ? "verificationUnavailable" : issues.length ? "incomplete" : "verified", canClose: !closed && !unavailable && !issues.length, verificationUnavailable: unavailable, checkedAt: new Date().toISOString(), issues, ...(impact ? {impact} : {}) });
  const add = (code: string, sourceId: string, message: string) => {
    if (!issues.some(issue => issue.code === code && issue.sourceId === sourceId)) issues.push({code, sourceId, message});
  };
  if (pendingCount) add("pending_journal", String(year), `확정 대기 전표 ${pendingCount}건이 장부에 반영되지 않았습니다.`);
  // Recover a read failure before returning a diagnostic to the owning transaction.
  // No source/journal/closing writes are performed inside this savepoint.
  await db.run("SAVEPOINT closing_integrity_check");
  try {
    const required = Object.keys(REQUIREMENTS);
    const present = rowsToObjects(await db.exec("SELECT name, to_regclass(name) IS NOT NULL AS present FROM unnest($1::text[]) name", [required]));
    const missing = present.filter(row => !row.present).map(row => String(row.name));
    if (missing.length) {
      unavailable = true;
      for (const table of missing) add("schema_requirement_missing", table, `${REQUIREMENTS[table]}가 준비되지 않아 마감 완결성을 검증할 수 없습니다.`);
      await db.run("RELEASE SAVEPOINT closing_integrity_check");
      return {...result(), missingRequirements: missing.map(table => REQUIREMENTS[table])};
    }
    // SELECT * readers can silently turn absent fields into undefined/stale.
    // Check the full 225/226/227 contract before interpreting any business row.
    const columns = Object.entries(REQUIRED_COLUMNS).flatMap(([table, names]) => names.map(name => ({table, name})));
    const missingColumns = rowsToObjects(await db.exec(`SELECT r.table_name,r.column_name
      FROM unnest($1::text[],$2::text[]) r(table_name,column_name)
      LEFT JOIN pg_attribute a ON a.attrelid=to_regclass(r.table_name) AND a.attname=r.column_name AND a.attnum>0 AND NOT a.attisdropped
      WHERE a.attname IS NULL`, [columns.map(c => c.table), columns.map(c => c.name)]));
    if (missingColumns.length) {
      unavailable = true;
      for (const column of missingColumns) add("schema_requirement_missing", `${column.table_name}.${column.column_name}`, `${REQUIREMENTS[String(column.table_name)]}의 필수 항목이 없어 마감 완결성을 검증할 수 없습니다.`);
      await db.run("RELEASE SAVEPOINT closing_integrity_check");
      return {...result(), missingRequirements: missingColumns.map(column => `${REQUIREMENTS[String(column.table_name)]}: ${column.column_name}`)};
    }

    const state = await loadTransactionLinkState(db);
    const entries = rowsToObjects(await db.exec("SELECT e.entry_id,e.entry_date,e.source_kind,e.source_id,e.status,s.source_hash,s.source_json,s.snapshot_version FROM journal_entries e LEFT JOIN journal_source_snapshots s USING(entry_id) ORDER BY e.entry_id"));
    const managed = entries.filter(entry => isManagedJournalSource(String(entry.source_kind)));
    const refs = managed.map(entry => ({sourceKind: String(entry.source_kind), sourceId: String(entry.source_id)}));
    const current = await loadJournalSourceStates(db, refs);
    const selection = buildClosingImpact(state, managed, current, year, options.impactDetails ? "full" : "summary");
    impact = selection.impact;
    const inYear = (date: string) => date.slice(0, 4) === String(year);
    for (const missing of selection.unavailable) {
      unavailable = true;
      add("source_evidence_unavailable", missing.sourceId, `대상 원천의 날짜·동일성·소비 근거를 확인할 수 없습니다. ${missing.requirements.join(" / ")}`);
    }
    const selectedRefs = [...selection.candidates.values()];
    for (const link of state.links.filter(link => link.state === "active" && !link.valid)) {
      const affected = new Map(selectedRefs.flatMap(ref => journalVerificationLinkIssues(state, link, ref)).map(issue => [issue.code, issue]));
      if (affected.size) add("invalid_link", link.id, `거래 연결의 원천·배부 근거를 다시 검토해야 합니다. ${[...affected.values()].map(issue => issue.message).join(" / ")}`);
    }
    for (const recognition of state.recognitions.filter(item => !item.valid)) {
      if (selection.isSourceSelected(recognition.source)) add("invalid_recognition", recognition.id, "계산서 발생 인식의 원천·계정 근거가 변경되어 대사가 필요합니다.");
    }
    const accounts = new Set(rowsToObjects(await db.exec("SELECT account_code FROM journal_accounts")).map(row => String(row.account_code)));
    // Include unposted/deleted obligations identified by recognition/link evidence.
    // Current dates remain verification inputs; saved dates only select the scope.
    const candidateStates = await loadJournalSourceStates(db, selectedRefs);
    const candidates = new Map(selectedRefs.map(ref => [sourceKey(ref), {ref, date: candidateStates.get(sourceKey(ref))?.date ?? null}]));
    for (const entry of managed) {
      const ref = {sourceKind: String(entry.source_kind), sourceId: String(entry.source_id)};
      if (selection.isJournalSelected(ref) && String(entry.status) === "pending" && !inYear(String(entry.entry_date))) add("related_pending_journal", `${ref.sourceKind}/${ref.sourceId}`, "해당 지급에 연결된 다른 기간에 확정 대기 전표가 남아 있습니다. 관련 거래의 인식과 지급 대사를 완료하세요.");
    }
    const draftCache = new Map<string, EntryDraft[]>();
    for (const [key, {ref, date}] of candidates) {
      const entry = managed.find(row => String(row.source_kind) === ref.sourceKind && String(row.source_id) === ref.sourceId);
      const id = `${ref.sourceKind}/${ref.sourceId}`;
      if (!date || !validDate(date) || candidateStates.get(key)?.exists === false) { add("journal_source_unavailable", id, "대상 장부·인식·배부에 필요한 원천이 삭제되었거나 원천 일자를 확인할 수 없습니다."); continue; }
      const sourceState = candidateStates.get(key);
      if (sourceState?.actualKind && sourceState.actualKind !== ref.sourceKind) { add("journal_source_changed", id, "전표 원천의 입출금 종류가 변경되어 재대사가 필요합니다."); continue; }
      const cacheKey = `${key}:${date}`;
      try {
        if (!draftCache.has(cacheKey)) draftCache.set(cacheKey, await buildJournalDraftsForVerification(db, ref.sourceKind, date, date, state, {sourceId: ref.sourceId}));
        const draft = draftCache.get(cacheKey)!.find(draft => draft.sourceId === ref.sourceId);
        if (!draft) {
          // A fully replaced manual invoice intentionally has no separate posting.
          // Any old posting still present must nevertheless be reconciled.
          const replacedManual = !entry && ref.sourceKind === "invoice_manual" && state.links.some(link => link.state === "active" && link.valid && link.relation === "manual_invoice" && link.left.id === ref.sourceId);
          if (!replacedManual) add("journal_source_not_postable", id, "대상 전표·인식의 원천이 취소·제외되었거나 대표가 변경되어 현재 기표 대상과 일치하지 않습니다.");
          continue;
        }
        validateJournalDrafts([draft], accounts);
        if (!entry) { add("journal_regeneration_required", id, "연결된 거래의 전표가 아직 생성되지 않았습니다. 원천 대사와 재생성을 완료하세요."); continue; }
        if (!entry.source_hash) {
          unavailable = true;
          add("legacy_source_evidence_unavailable", id, "기존 전표에 원천 스냅샷이 없어 현재 근거와의 일치를 검증할 수 없습니다. 원천 대사를 먼저 완료하세요.");
        } else if (String(entry.entry_date) !== draft.entryDate || String(entry.source_hash) !== sourceFingerprint(draft, draft.entryDate, draft.sourceEvidence).hash) {
          add("journal_source_changed", id, "전표 생성·확정 뒤 원천 또는 연결 근거가 변경되어 재대사가 필요합니다.");
        }
      } catch (error) {
        if ((error as {status?: number}).status !== 409) throw error;
        add("journal_verification_blocked", id, "현재 원천·연결로 전표를 재검증할 수 없습니다. 연결 및 발생 인식의 문제를 먼저 해결하세요.");
      }
    }
    await db.run("RELEASE SAVEPOINT closing_integrity_check");
    return result();
  } catch {
    await db.run("ROLLBACK TO SAVEPOINT closing_integrity_check");
    await db.run("RELEASE SAVEPOINT closing_integrity_check");
    unavailable = true;
    add("verification_failed", String(year), "마감 완결성 검증을 끝내지 못했습니다. 필요한 자료 구조와 원천 상태를 점검한 뒤 다시 조회하세요.");
    return result();
  }
}
