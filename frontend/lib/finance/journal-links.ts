import { type PgDatabase } from "@/lib/db";
import type { EntryDraft, JournalLineInput, JournalVerificationOptions } from "./journal";
import { journalConflict, sourceKey, type JournalSourceRef } from "./journal-source";
import { findTransactionSource, linksForTransactionSource, loadTransactionLinkState, transactionSourceKey, type TransactionLink, type TransactionLinkIssue, type TransactionLinkState, type TransactionLinkSource, type TransactionSourceRef } from "./transaction-links";

const inRange = (date: string, from: string, to: string) => date >= from && date <= to;
const journalRef = (kind: string, id: string): TransactionSourceRef | null => kind === "card" ? { kind: "card", id }
  : kind === "bank_in" || kind === "bank_out" ? { kind: "bank", id }
  : kind === "invoice_manual" ? { kind: "manual_invoice", id }
  : kind === "tax_invoice" ? { kind: "tax_invoice", id } : kind === "hometax_invoice" ? { kind: "hometax", id } : null;

const hasOfficialKey = (source: TransactionLinkSource) => source.canonicalKey.startsWith("invoice:") && !!source.canonicalKey.slice("invoice:".length).trim();
interface VerificationSourceIndex {
  byKey: Map<string, TransactionLinkSource>;
  canonicalKeysByJournal: Map<string, Set<string>>;
}
// Diagnostic-only, supplied-state lifetime: callers must keep sources immutable
// throughout this read-only inspection. Writes/reloads must use a fresh state.
const verificationIndexes = new WeakMap<TransactionLinkState, VerificationSourceIndex>();
function verificationSourceIndex(state: TransactionLinkState): VerificationSourceIndex {
  const cached = verificationIndexes.get(state);
  if (cached) return cached;
  const index: VerificationSourceIndex = { byKey: new Map(), canonicalKeysByJournal: new Map() };
  const register = (ref: JournalSourceRef, canonicalKey: string) => {
    const key = sourceKey(ref), values = index.canonicalKeysByJournal.get(key) ?? new Set<string>();
    values.add(canonicalKey); index.canonicalKeysByJournal.set(key, values);
  };
  for (const source of state.sources) {
    index.byKey.set(source.key, source);
    if (!hasOfficialKey(source)) continue;
    register({ sourceKind: source.journalKind, sourceId: source.journalId }, source.canonicalKey);
    // Preserve natural identity when an HTI row is represented by an app invoice.
    const kinds = source.ref.kind === "bank" ? ["bank_in", "bank_out"]
      : [source.ref.kind === "hometax" ? "hometax_invoice" : source.ref.kind === "manual_invoice" ? "invoice_manual" : source.ref.kind];
    for (const sourceKind of kinds) register({ sourceKind, sourceId: source.ref.id }, source.canonicalKey);
  }
  verificationIndexes.set(state, index);
  return index;
}
function matchesJournalSource(source: TransactionLinkSource, ref: JournalSourceRef): boolean {
  const original = journalRef(ref.sourceKind, ref.sourceId);
  return (source.journalKind === ref.sourceKind && source.journalId === ref.sourceId)
    || (!!original && source.ref.kind === original.kind && source.ref.id === original.id);
}

function verificationSourceMatcher(state: TransactionLinkState, ref: JournalSourceRef) {
  const canonicalKeys = verificationSourceIndex(state).canonicalKeysByJournal.get(sourceKey(ref));
  return (source: TransactionLinkSource | undefined) => !!source && (matchesJournalSource(source, ref) || (hasOfficialKey(source) && !!canonicalKeys?.has(source.canonicalKey)));
}

/** A recognition consumes its invoice evidence, not a later payment's metadata.
 * Keep full-state amount/account/relation checks; do not mark the link valid or
 * reuse this diagnostic exception for regeneration, confirmation, or writes. */
export function journalVerificationLinkIssues(state: TransactionLinkState, link: TransactionLink, ref: JournalSourceRef): TransactionLinkIssue[] {
  if (link.state !== "active" || link.valid) return [];
  const selected = verificationSourceMatcher(state, ref);
  const index = verificationSourceIndex(state);
  const left = index.byKey.get(transactionSourceKey(link.left)), right = index.byKey.get(transactionSourceKey(link.right));
  const leftSelected = selected(left) || selected(link.leftSnapshot);
  const rightSelected = selected(right) || selected(link.rightSnapshot);
  if (!leftSelected && !rightSelected) return [];
  const recognition = ref.sourceKind === "tax_invoice" || ref.sourceKind === "hometax_invoice";
  if (recognition && rightSelected && !leftSelected && ["bank_invoice", "card_invoice"].includes(link.relation)
    && right && right.sourceHash === link.rightHash && !right.issues.length) {
    // source_stale combines the two endpoint hashes. With the invoice still
    // matching, the change belongs only to the payment. Keep invalid_source:
    // malformed amounts/dates can make ordinary capacity comparisons unsafe.
    return link.issues.filter(issue => issue.code !== "source_stale");
  }
  return link.issues;
}

/** The original drafts stay byte-for-byte equivalent when they have no links.
 * Payment allocations change the counter-account, never the cash/card total. */
export async function resolveLinkedJournalDrafts(db: PgDatabase, kind: string, drafts: EntryDraft[], from: string, to: string, supplied?: TransactionLinkState, options?: JournalVerificationOptions): Promise<EntryDraft[]> {
  if (!["card", "bank_in", "bank_out", "tax_invoice", "invoice_manual", "hometax_invoice"].includes(kind)) return drafts;
  const state = supplied ?? await loadTransactionLinkState(db);
  const verificationIndex = options ? verificationSourceIndex(state) : null;
  const findSource = (ref: TransactionSourceRef) => verificationIndex
    ? verificationIndex.byKey.get(transactionSourceKey(ref)) : findTransactionSource(state, ref);
  const verificationRef = options ? { sourceKind: kind, sourceId: options.sourceId } : null;
  const selected = verificationRef ? verificationSourceMatcher(state, verificationRef) : null;
  const relevant = (source: TransactionLinkSource | undefined) => !!source && source.journalKind === kind && inRange(source.date, from, to)
    && (!selected || selected(source));
  if (selected && state.sources.some(source => selected(source) && source.issues.some(issue => ["official_invoice_content_conflict", "multiple_active_app_invoice_rows"].includes(issue)))) {
    throw journalConflict("동일 공식 계산서의 원천 내용 또는 대표가 중복되어 검증할 수 없습니다.");
  }
  for (const link of state.links.filter(link => link.state === "active" && !link.valid)) {
    const issues = verificationRef ? journalVerificationLinkIssues(state, link, verificationRef) : link.issues;
    if (verificationRef ? issues.length > 0 : [findSource(link.left), findSource(link.right), link.leftSnapshot, link.rightSnapshot].some(relevant)) {
      throw journalConflict(`거래 연결 ${link.id}의 원천이 변경되어 기존 전표를 보존했습니다. ${issues.map(issue => issue.message).join(" / ")}`);
    }
  }
  for (const recognition of state.recognitions.filter(item => !item.valid)) {
    if (relevant(findSource(recognition.source)) || relevant(recognition.sourceSnapshot)) throw journalConflict("계산서 인식 근거가 변경되었습니다. 거래 연결에서 원천을 대사하세요.");
  }
  const out: EntryDraft[] = [];
  for (const draft of drafts) {
    if (options && draft.sourceId !== options.sourceId) continue;
    const ref = journalRef(kind, draft.sourceId);
    const links = ref ? linksForTransactionSource(state, ref).filter(link => link.state === "active" && link.valid) : [];
    if (kind === "card") {
      const source = findSource(ref!);
      if (source && source.residual.total > 0) for (const previous of state.links.filter(link => link.state === "cancelled" && link.relation === "card_invoice" && link.left.id === draft.sourceId)) {
        const pair = links.filter(link => link.rightSnapshot.canonicalKey === previous.rightSnapshot.canonicalKey);
        if (state.recognitions.some(item => item.canonicalKey === previous.rightSnapshot.canonicalKey)
          && !pair.some(link => link.relation === "distinct") && pair.filter(link => link.relation === "card_invoice").reduce((sum, link) => sum + link.total, 0) < previous.total) throw journalConflict("취소한 카드·계산서 연결의 매입 인식과 카드 잔여가 함께 남아 있습니다. 별개 거래 근거 또는 지급 연결을 다시 대사하세요.");
      }
    }
    if (!links.length) {
      if (kind === "invoice_manual" && state.links.some(link => link.relation === "manual_invoice" && link.left.id === draft.sourceId
        && state.recognitions.some(item => item.canonicalKey === link.rightSnapshot.canonicalKey))) throw journalConflict("수기 발행 연결을 취소한 계산서의 매출 인식이 남아 있습니다. 실제 계산서 연결 또는 수기 발행 기록을 대사한 뒤 재생성하세요.");
      out.push(draft); continue;
    }
    if (kind === "invoice_manual" && links.some(link => link.relation === "manual_invoice")) continue;
    const evidence = { original: draft.sourceEvidence, transactionLinks: links.map(link => ({ id: link.id, relation: link.relation, leftHash: link.leftHash, rightHash: link.rightHash, supply: link.supply, tax: link.tax, total: link.total, expenseAccount: link.expenseAccount, reason: link.reason, evidence: link.evidence })) };
    if (kind === "card") {
      const payments = links.filter(link => link.relation === "card_invoice");
      if (!payments.length) { out.push({ ...draft, sourceEvidence: evidence }); continue; }
      const total = payments.reduce((sum, link) => sum + link.total, 0);
      const tax = payments.reduce((sum, link) => sum + link.tax, 0);
      const source = findSource(ref!)!;
      const currentVat = draft.lines.filter(line => line.accountCode === "135").reduce((sum, line) => sum + line.debit, 0);
      const vatReduction = currentVat > 0 ? tax : 0;
      const costReduction = total - vatReduction;
      const lines = draft.lines.map(line => ({ ...line }));
      const cost = lines.find(line => line.debit > 0 && line.accountCode !== "135");
      if (!cost || cost.debit < costReduction || currentVat < vatReduction || total > source.total) throw journalConflict("카드 연결의 비용·세액 배부가 원천 금액을 초과합니다.");
      cost.debit -= costReduction;
      const vat = lines.find(line => line.accountCode === "135");
      if (vat) vat.debit -= vatReduction;
      lines.push({ accountCode: "251", debit: total, credit: 0, memo: "계산서 매입채무의 카드 지급" });
      out.push({ ...draft, status: total === source.total ? "auto" : draft.status, description: `계산서 카드 지급${total < source.total ? " · 잔여 카드 매입" : ""} — ${draft.partyName ?? ""}`, lines: lines.filter(line => line.debit || line.credit), sourceEvidence: evidence });
      continue;
    }
    if (kind === "bank_in" || kind === "bank_out") {
      const payments = links.filter(link => link.relation === "bank_invoice");
      if (!payments.length) { out.push(draft); continue; }
      const source = findSource(ref!)!;
      const amount = payments.reduce((sum, link) => sum + link.total, 0), residual = source.total - amount;
      if (residual < 0) throw journalConflict("은행 배부액이 실제 입출금액을 초과합니다.");
      const incoming = kind === "bank_in";
      const lines: JournalLineInput[] = incoming
        ? [{ accountCode: "103", debit: source.total, credit: 0 }, { accountCode: "108", debit: 0, credit: amount }, ...(residual ? [{ accountCode: "257", debit: 0, credit: residual, memo: "아직 계산서에 배부하지 않은 입금" }] : [])]
        : [{ accountCode: "251", debit: amount, credit: 0 }, ...(residual ? [{ accountCode: "134", debit: residual, credit: 0, memo: "아직 계산서에 배부하지 않은 출금" }] : []), { accountCode: "103", debit: 0, credit: source.total }];
      // A remaining balance is a real suspense balance, not a reason to omit the
      // entire bank transaction (including its allocated part) from the ledger.
      out.push({ ...draft, status: "auto", description: `${incoming ? "계산서 수금" : "계산서 지급"}${residual ? " · 일부 미배부" : ""} — ${draft.partyName ?? ""}`, lines, sourceEvidence: evidence });
      continue;
    }
    // Receiving/paying an invoice does not revise its recognition posting.
    // This lets later settlements coexist with an already confirmed invoice.
    out.push(draft);
  }
  if (kind !== "hometax_invoice") return out;
  for (const recognition of state.recognitions) {
    const source = findSource(recognition.source);
    if (!recognition.valid || !source || source.journalKind !== "hometax_invoice" || !inRange(source.date, from, to)
      || (options && source.journalId !== options.sourceId)) continue;
    if (out.some(draft => draft.sourceId === source.journalId)) throw journalConflict("동일 계산서의 인식 근거가 중복되었습니다.");
    const links = linksForTransactionSource(state, source.ref).filter(link => link.valid && link.state === "active");
    if (source.direction === "purchase") {
      const corp = String(source.raw.invoicer_corp_num ?? "").replace(/\D/g, "");
      for (const card of state.sources.filter(item => item.kind === "card" && item.total > 0 && item.date === source.date && item.supply === source.supply && item.tax === source.tax)) {
        if (!corp || corp !== String(card.raw.store_corp_num ?? "").replace(/\D/g, "")) continue;
        const pair = links.filter(link => link.left.kind === "card" && link.left.id === card.id);
        const resolved = pair.some(link => link.relation === "distinct") || ["supply", "tax", "total"].every(key => pair.filter(link => link.relation === "card_invoice").reduce((sum, link) => sum + link[key as "supply" | "tax" | "total"], 0) === card[key as "supply" | "tax" | "total"]);
        if (!resolved) throw journalConflict("인식한 매입계산서와 같은 조건의 카드 거래에 미해결 중복 금액이 있습니다. 전체 동일 공급 또는 별개 거래의 근거를 먼저 등록하세요.");
      }
    }
    const purchase = source.direction === "purchase";
    const pending = purchase && source.tax > 0 && source.vatDeductible !== 0 && source.vatDeductible !== 1;
    const deductible = purchase && source.vatDeductible === 1;
    const lines: JournalLineInput[] = purchase
      ? [{ accountCode: recognition.expenseAccount ?? "134", debit: source.total - (deductible ? source.tax : 0), credit: 0 }, ...(deductible && source.tax ? [{ accountCode: "135", debit: source.tax, credit: 0 }] : []), { accountCode: "251", debit: 0, credit: source.total }]
      : [{ accountCode: "108", debit: source.total, credit: 0 }, { accountCode: "412", debit: 0, credit: source.supply }, ...(source.tax ? [{ accountCode: "255", debit: 0, credit: source.tax }] : [])];
    out.push({ sourceKind: "hometax_invoice", sourceId: source.journalId, entryDate: source.date, description: `${purchase ? "매입" : "매출"}계산서 인식 — ${source.name}`, partyName: source.name, status: pending || (purchase && !recognition.expenseAccount) ? "pending" : "auto", lines,
      sourceEvidence: { invoice: source.sourceHash, recognition: { id: recognition.id, sourceHash: recognition.sourceHash, expenseAccount: recognition.expenseAccount, reason: recognition.reason, evidence: recognition.evidence, ...(recognition.review ? {review:recognition.review} : {}) } } });
  }
  return out;
}

/** Follow both current and cancelled edges so regenerating a payment also
 * updates its earlier invoice and removes an old manual duplicate atomically. */
export function linkedJournalComponent(state: TransactionLinkState, from: string, to: string): Array<{ sourceKind: string; sourceId: string; date: string }> {
  const selected = new Set(state.sources.filter(source => inRange(source.date, from, to)).map(source => source.canonicalKey));
  let changed = true;
  while (changed) {
    changed = false;
    for (const link of state.links) {
      const ends = [findTransactionSource(state, link.left) ?? link.leftSnapshot, findTransactionSource(state, link.right) ?? link.rightSnapshot];
      if (!ends.some(source => selected.has(source.canonicalKey) || inRange(source.date, from, to))) continue;
      for (const source of ends) if (!selected.has(source.canonicalKey)) { selected.add(source.canonicalKey); changed = true; }
    }
  }
  const linked = new Set(state.links.flatMap(link => [link.leftSnapshot.canonicalKey, link.rightSnapshot.canonicalKey]));
  const values = [...state.sources, ...state.links.flatMap(link => [link.leftSnapshot, link.rightSnapshot])].filter(source => selected.has(source.canonicalKey) && linked.has(source.canonicalKey));
  const refs = new Map<string, { sourceKind: string; sourceId: string; date: string }>();
  for (const source of values) refs.set(`${source.journalKind}:${source.journalId}:${source.date}`, { sourceKind: source.journalKind, sourceId: source.journalId, date: source.date });
  return [...refs.values()];
}

export function isCardSettlementOnly(state: TransactionLinkState, id: string): boolean {
  const source = findTransactionSource(state, { kind: "card", id });
  const links = linksForTransactionSource(state, { kind: "card", id }).filter(link => link.relation === "card_invoice");
  return !!source && links.length > 0 && links.every(link => link.valid) && links.reduce((sum, link) => sum + link.total, 0) === source.total;
}

export function isLinkedJournalSource(state: TransactionLinkState, kind: string, id: string): boolean {
  const ref = journalRef(kind, id);
  if (!ref) return false;
  if (linksForTransactionSource(state, ref).length) return true;
  return state.recognitions.some(item => [item.sourceSnapshot, findTransactionSource(state, item.source)].some(source => source?.journalKind === kind && source.journalId === id));
}

/** A confirmed linked posting must retain its allocation amounts and accounts.
 * Change allocation/evidence in the linking workflow, then regenerate. */
export function assertLinkedPostingLines(draft: EntryDraft, proposed: JournalLineInput[], linked = false): void {
  const evidence = draft.sourceEvidence as { transactionLinks?: unknown[]; recognition?: unknown };
  if (!linked && !evidence?.transactionLinks?.length && !evidence?.recognition) return;
  if (draft.sourceKind === "hometax_invoice" && draft.status === "pending") throw journalConflict("매입계산서 공제·비용 계정 검토를 먼저 완료하세요.");
  const totals = (lines: JournalLineInput[]) => {
    const accounts = new Map<string, [number, number]>();
    for (const line of lines) { const previous = accounts.get(line.accountCode) ?? [0, 0]; accounts.set(line.accountCode, [previous[0] + line.debit, previous[1] + line.credit]); }
    return JSON.stringify([...accounts].filter(([, value]) => value[0] || value[1]).sort(([a], [b]) => a.localeCompare(b)));
  };
  if (totals(draft.lines) !== totals(proposed)) throw journalConflict("연결된 거래의 배부 금액·계정은 거래 연결에서 변경한 뒤 전표를 재생성하세요.");
}
