import { isManagedJournalSource, sourceFingerprint, sourceKey, type JournalSourceRef, type JournalSourceState } from "./journal-source";
import { transactionSourceKey, type TransactionLinkState, type TransactionSourceRef } from "./transaction-links";
import { validateAccountingRange } from "./write-lock";

export interface ClosingImpactDate {
  date: string;
  sourceKey: string;
  basis: "current_source" | "journal_entry" | "journal_snapshot" | "link_snapshot" | "recognition_snapshot";
  evidenceId: string;
  version: number;
}
export interface ClosingImpactTrace {
  sourceId: string;
  disposition: "selected" | "deferred";
  reason: "target_year_evidence" | "accounting_dependency" | "outside_target_year" | "undated_obligation";
  dates: ClosingImpactDate[];
}
export interface ClosingImpact {
  version: 1;
  year: number;
  sources: ClosingImpactTrace[];
}
export interface ClosingImpactSummary {
  version: 1;
  year: number;
  detail: "summary";
  // 원천·전표 별칭을 각각 세므로 실제 거래 건수와 구분한다.
  referenceCount: number;
  selectedReferenceCount: number;
  deferredReferenceCount: number;
  reasonCounts: Record<ClosingImpactTrace["reason"], number>;
}
export type ClosingImpactResult = ClosingImpact | ClosingImpactSummary;
const emptySummary = (year: number): ClosingImpactSummary => ({version: 1, year, detail: "summary", referenceCount: 0, selectedReferenceCount: 0, deferredReferenceCount: 0,
  reasonCounts: {target_year_evidence: 0, accounting_dependency: 0, outside_target_year: 0, undated_obligation: 0}});
const countTrace = (summary: ClosingImpactSummary, trace: Pick<ClosingImpactTrace, "disposition" | "reason">) => {
  summary.referenceCount++;
  if (trace.disposition === "selected") summary.selectedReferenceCount++; else summary.deferredReferenceCount++;
  summary.reasonCounts[trace.reason]++;
};
export function summarizeClosingImpact(impact: ClosingImpactResult): ClosingImpactSummary {
  if ("detail" in impact) return impact;
  const summary = emptySummary(impact.year);
  for (const source of impact.sources) countTrace(summary, source);
  return summary;
}
const journalNode = (ref: JournalSourceRef) => `journal:${sourceKey(ref)}`;
const sourceNode = (ref: TransactionSourceRef) => `source:${transactionSourceKey(ref)}`;
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const validDate = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try { validateAccountingRange(value, value); return true; } catch { return false; }
};
const parse = (value: unknown) => { try { return record(typeof value === "string" ? JSON.parse(value) : value); } catch { return null; } };

/** Identity edges are undirected; accounting dependencies are not. In particular,
 * an invoice does not depend on every other invoice paid by its future payment.
 * Historical dates identify an obligation, never replace its current source. */
export function buildClosingImpact(
  state: TransactionLinkState,
  entries: Record<string, unknown>[],
  current: Map<string, JournalSourceState>,
  year: number,
  detail: "full" | "summary" = "full",
) {
  const parents = new Map<string, string>();
  const root = (node: string): string => {
    const parent = parents.get(node);
    if (!parent) { parents.set(node, node); return node; }
    if (parent === node) return node;
    const result = root(parent); parents.set(node, result); return result;
  };
  const identify = (...nodes: string[]) => {
    const first = root(nodes[0]);
    for (const node of nodes.slice(1)) { const other = root(node); if (other !== first) parents.set(other, first); }
  };
  const dates = new Map<string, ClosingImpactDate[]>();
  const missing = new Map<string, Set<string>>();
  const missingAt = (node: string, reason: string) => {
    root(node); const reasons = missing.get(node) ?? new Set<string>(); reasons.add(reason); missing.set(node, reasons);
  };
  const dateAt = (node: string, date: unknown, basis: ClosingImpactDate["basis"], evidenceId: string, version = 1) => {
    root(node);
    if (!validDate(date)) { missingAt(node, `${basis}:${evidenceId}:date`); return; }
    const values = dates.get(node) ?? []; values.push({date, sourceKey: node, basis, evidenceId, version}); dates.set(node, values);
  };
  const addJournal = (ref: JournalSourceRef) => { root(journalNode(ref)); };
  const obligations = new Set<string>();
  const sourceRefs = new Map<string, TransactionSourceRef>();
  const fallbackRefs = new Map<string, JournalSourceRef>();
  const addSource = (value: unknown, expected: TransactionSourceRef, basis: ClosingImpactDate["basis"], evidenceId: string, includeDate: boolean) => {
    const node = sourceNode(expected); root(node); sourceRefs.set(transactionSourceKey(expected), expected);
    const source = record(value);
    const ref = record(source?.ref);
    if (!source || !ref || ref.kind !== expected.kind || ref.id !== expected.id) {
      // Attribute damaged evidence to its stored endpoint, not every accounting year.
      if (includeDate) missingAt(node, `${basis}:${evidenceId}:identity`);
      return;
    }
    if (typeof source.journalKind === "string" && isManagedJournalSource(source.journalKind) && typeof source.journalId === "string" && source.journalId) {
      const journal = {sourceKind: source.journalKind, sourceId: source.journalId}; addJournal(journal); identify(node, journalNode(journal));
      fallbackRefs.set(transactionSourceKey(expected), journal);
    } else if (includeDate) missingAt(node, `${basis}:${evidenceId}:journal_identity`);
    // An official key is an identity. An absent key ('invoice:') is not.
    if (typeof source.canonicalKey === "string" && source.canonicalKey.startsWith("invoice:") && source.canonicalKey.slice(8).trim()) identify(node, `canonical:${source.canonicalKey}`);
    if (expected.kind === "hometax") {
      const original = {sourceKind: "hometax_invoice", sourceId: expected.id}; addJournal(original); identify(node, journalNode(original));
    }
    if (includeDate) dateAt(node, source.date, basis, evidenceId);
  };
  const consumed = new Map<string, Set<string>>();
  const storedLinks = new Map(state.links.map(link => [link.id, link]));
  const consumedLinks = new Set<string>();
  // Manual replacement suppresses a posting rather than writing a payment
  // snapshot. Its retained invoice recognition is the surviving consumption
  // evidence. Only a still-issued manual source can leave duplicate recognition.
  const retainedManual = new Set(state.links.filter(link => link.state === "cancelled" && link.relation === "manual_invoice"
    && state.sources.some(source => source.key === transactionSourceKey(link.left) && Number(source.raw.invoice_issued) === 1)
    && state.recognitions.some(item => item.canonicalKey === link.rightSnapshot.canonicalKey)).map(link => link.id));
  for (const entry of entries) {
    const ref = {sourceKind: String(entry.source_kind), sourceId: String(entry.source_id)};
    if (!isManagedJournalSource(ref.sourceKind)) continue;
    addJournal(ref); const node = journalNode(ref);
    dateAt(node, String(entry.entry_date), "journal_entry", String(entry.entry_id), 0);
    const source = current.get(sourceKey(ref));
    if (source?.exists) dateAt(node, source.date, "current_source", sourceKey(ref));
    const snapshot = parse(entry.source_json);
    if (!snapshot) { missingAt(node, `journal_snapshot:${String(entry.entry_id)}:missing`); continue; }
    // Keep contradictory saved/current dates visible, including synthetic legacy
    // rows whose journal date was moved after their source snapshot was captured.
    dateAt(node, snapshot.entryDate, "journal_snapshot", String(entry.entry_id), Number(snapshot.version));
    if (snapshot.version !== 1 || Number(entry.snapshot_version) !== 1 || snapshot.sourceKind !== ref.sourceKind || snapshot.sourceId !== ref.sourceId) missingAt(node, `journal_snapshot:${String(entry.entry_id)}:identity_or_version`);
    if (entry.source_hash && sourceFingerprint({...ref, status: snapshot.generatedExclusion ? "excluded" : undefined}, String(snapshot.entryDate), snapshot.evidence).hash !== entry.source_hash) missingAt(node, `journal_snapshot:${String(entry.entry_id)}:hash_mismatch`);
    const evidence = record(snapshot.evidence);
    if (Array.isArray(evidence?.transactionLinks)) for (const item of evidence.transactionLinks) {
      const id = record(item)?.id;
      if (typeof id !== "string" || !storedLinks.has(id)) { missingAt(node, `journal_snapshot:${String(entry.entry_id)}:consumed_link_missing`); continue; }
      consumedLinks.add(id);
      const ids = consumed.get(node) ?? new Set<string>(); ids.add(id); consumed.set(node, ids);
    }
    const recognitionId = record(evidence?.recognition)?.id;
    if (typeof recognitionId === "string" && !state.recognitions.some(item => item.id === recognitionId)) missingAt(node, `journal_snapshot:${String(entry.entry_id)}:consumed_recognition_missing`);
  }
  for (const source of state.sources) addSource(source, source.ref, "current_source", source.key, true);
  for (const link of state.links) {
    if (link.state !== "active" && !consumedLinks.has(link.id) && !retainedManual.has(link.id)) continue;
    addSource(link.leftSnapshot, link.left, "link_snapshot", link.id, true);
    addSource(link.rightSnapshot, link.right, "link_snapshot", link.id, true);
    obligations.add(transactionSourceKey(link.left)); obligations.add(transactionSourceKey(link.right));
  }
  for (const recognition of state.recognitions) {
    addSource(recognition.sourceSnapshot, recognition.source, "recognition_snapshot", recognition.id, true);
    const node = sourceNode(recognition.source);
    if (recognition.canonicalKey.startsWith("invoice:") && recognition.canonicalKey.slice(8).trim()) identify(node, `canonical:${recognition.canonicalKey}`);
    obligations.add(transactionSourceKey(recognition.source));
  }
  const dependencies = new Map<string, Set<string>>();
  const depend = (from: string, to: string) => {
    const a = root(from), b = root(to), next = dependencies.get(a) ?? new Set<string>(); next.add(b); dependencies.set(a, next);
  };
  for (const link of state.links.filter(item => item.state === "active")) {
    if (link.relation === "bank_invoice" || link.relation === "card_invoice" || link.relation === "manual_invoice") depend(sourceNode(link.left), sourceNode(link.right));
    // Manual invoice replacement consumes the old recognition as duplicate evidence.
    if (link.relation === "manual_invoice") depend(sourceNode(link.right), sourceNode(link.left));
  }
  for (const [node, ids] of consumed) for (const id of ids) {
    const link = storedLinks.get(id)!;
    // Cancelled rows are historical proof only for journals that consumed them.
    // They never reconnect the entire current transaction network.
    depend(node, sourceNode(link.left)); depend(node, sourceNode(link.right));
  }
  for (const id of retainedManual) {
    const link = storedLinks.get(id)!;
    for (const recognition of state.recognitions.filter(item => item.canonicalKey === link.rightSnapshot.canonicalKey)) depend(sourceNode(recognition.source), sourceNode(link.left));
  }
  const groupedDates = new Map<string, ClosingImpactDate[]>();
  for (const [node, values] of dates) { const key = root(node); groupedDates.set(key, [...(groupedDates.get(key) ?? []), ...values]); }
  const seeds = new Set([...groupedDates].filter(([, values]) => values.some(value => value.date.slice(0, 4) === String(year))).map(([node]) => node));
  const undated = new Set<string>();
  // An existing obligation with no recoverable date cannot be called a future
  // transaction. Do not guess a year or silently certify it as out of scope.
  for (const key of obligations) { const ref = sourceRefs.get(key); if (ref && !groupedDates.get(root(sourceNode(ref)))?.length) undated.add(root(sourceNode(ref))); }
  for (const entry of entries) {
    const ref = {sourceKind: String(entry.source_kind), sourceId: String(entry.source_id)};
    if (isManagedJournalSource(ref.sourceKind) && !groupedDates.get(root(journalNode(ref)))?.length) undated.add(root(journalNode(ref)));
  }
  for (const node of undated) missingAt(node, "accounting_obligation:recognition_date_undetermined");
  const selected = new Set([...seeds, ...undated]), queue = [...selected];
  for (let i = 0; i < queue.length; i++) for (const next of dependencies.get(queue[i]) ?? []) if (!selected.has(next)) { selected.add(next); queue.push(next); }
  const isSourceSelected = (ref: TransactionSourceRef) => selected.has(root(sourceNode(ref)));
  const isJournalSelected = (ref: JournalSourceRef) => selected.has(root(journalNode(ref)));
  const candidates = new Map<string, JournalSourceRef>();
  for (const entry of entries) {
    const ref = {sourceKind: String(entry.source_kind), sourceId: String(entry.source_id)};
    if (isManagedJournalSource(ref.sourceKind) && isJournalSelected(ref)) candidates.set(sourceKey(ref), ref);
  }
  const currentSources = new Map(state.sources.map(source => [source.key, source]));
  for (const key of obligations) {
    const source = currentSources.get(key), ref = sourceRefs.get(key);
    if (!ref || !isSourceSelected(ref)) continue;
    const journal = source ? {sourceKind: source.journalKind, sourceId: source.journalId} : fallbackRefs.get(key);
    if (journal) candidates.set(sourceKey(journal), journal);
    else missingAt(sourceNode(ref), `source:${key}:journal_identity`);
  }
  const unavailable = [...missing].filter(([node]) => selected.has(root(node))).map(([node, reasons]) => ({sourceId: node, requirements: [...reasons].sort()}));
  const traceNodes = new Map<string, string>();
  for (const entry of entries) if (isManagedJournalSource(String(entry.source_kind))) {
    const ref = {sourceKind: String(entry.source_kind), sourceId: String(entry.source_id)}; traceNodes.set(`${ref.sourceKind}/${ref.sourceId}`, journalNode(ref));
  }
  for (const key of obligations) { const ref = sourceRefs.get(key); if (ref) traceNodes.set(key, sourceNode(ref)); }
  const classification = (node: string): Pick<ClosingImpactTrace, "disposition" | "reason"> => {
    const identity = root(node), selectedHere = selected.has(identity);
    return {disposition: selectedHere ? "selected" : "deferred", reason: undated.has(identity) ? "undated_obligation" : selectedHere ? seeds.has(identity) ? "target_year_evidence" : "accounting_dependency" : "outside_target_year"};
  };
  let impact: ClosingImpactResult;
  if (detail === "summary") {
    // 일상 조회는 날짜 근거 배열을 복제·정렬하거나 응답에 싣지 않는다.
    impact = emptySummary(year);
    for (const node of traceNodes.values()) countTrace(impact, classification(node));
  } else {
    impact = {version: 1, year, sources: [...traceNodes].sort(([a], [b]) => a.localeCompare(b)).map(([sourceId, node]) => {
      const values = [...new Map((groupedDates.get(root(node)) ?? []).map(value => [JSON.stringify(value), value])).values()].sort((a, b) => a.date.localeCompare(b.date) || a.evidenceId.localeCompare(b.evidenceId));
      return {sourceId, ...classification(node), dates: values};
    })};
  }
  return {impact, candidates, unavailable, isSourceSelected, isJournalSelected};
}
