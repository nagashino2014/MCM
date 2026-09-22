"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { RecognitionReviewPanel } from "./RecognitionReviewPanel";
import type { TransactionLink, TransactionLinkInput, TransactionLinkRelation, TransactionLinkSource, TransactionLinkState } from "@/lib/finance/transaction-links";

type Mode = TransactionLinkRelation;
interface LinkResponse extends TransactionLinkState {
  expenseAccounts: Array<{ accountCode: string; name: string }>;
  permissions: { manage: boolean; bank: boolean };
}
interface DraftAllocation {
  left: TransactionLinkSource;
  right: TransactionLinkSource;
  supply: number;
  tax: number;
  total: number;
  expenseAccount: string;
}
const ENDPOINT = "/api/finance/transaction-links";
const modes: Array<[Mode, string, string]> = [
  ["card_invoice", "카드 · 매입계산서", "같은 공급의 증빙을 연결합니다. 카드 지급과 카드사에 대한 채무는 유지합니다."],
  ["bank_invoice", "계좌 · 매입/매출계산서", "입금·출금을 계산서에 나눠 연결합니다. 공급가액과 세액은 결제금액으로 다시 계산하지 않습니다."],
  ["manual_invoice", "수기 매출 · 대표 계산서", "동일 매출의 전체 공급가액을 확인하고 대표 계산서를 연결합니다."],
  ["distinct", "별개 거래 확인", "카드와 매입계산서가 서로 다른 공급이라는 근거를 남깁니다."],
];
const money = (value: number) => Number.isFinite(value) ? `${value.toLocaleString("ko-KR")}원` : "확인 필요";
const nameOf = (s: TransactionLinkSource) => `${s.name || "거래처 미상"} · ${s.date} · ${s.ref.kind === "manual_invoice" ? "공급가액 " : ""}${money(s.total)}`;
const issueLabels: Record<string, string> = {
  invalid_source_date: "거래일 또는 신고 귀속일을 확인하세요",
  unsupported_negative_or_invalid_amount: "금액이 올바르지 않거나 취소·환불 등 별도 검토가 필요한 거래입니다",
  source_excluded_or_cancelled: "제외되었거나 취소된 거래입니다",
  official_invoice_key_required: "계산서의 공식 승인번호를 확인하세요",
  modified_invoice_not_supported: "수정계산서는 별도 검토가 필요합니다",
  invalid_invoice_direction: "매입·매출 구분을 확인하세요",
  invalid_bank_direction: "입금·출금 구분을 확인하세요",
  manual_invoice_not_issued: "수기 발행 기록을 확인하세요",
  unsupported_card_type_or_service: "카드 취소·환불 또는 봉사료 포함 거래는 별도 검토가 필요합니다",
  card_tax_review_required: "카드 공제 검토 전입니다. 전체 공급을 계산서에 연결하거나 카드 검토를 먼저 완료하세요",
};
const sourceIssue = (issue: string) => issueLabels[issue] ?? (/^[a-z_]+$/.test(issue) ? "거래 증빙을 추가로 확인해야 합니다" : issue);
const sourceLabel = (s: TransactionLinkSource) => s.ref.kind === "card" ? "카드" : s.ref.kind === "bank" ? s.direction === "in" ? "입금" : "출금" : s.ref.kind === "manual_invoice" ? "수기 매출" : s.direction === "purchase" ? "매입계산서" : "매출계산서";
const modeLabel = (mode: Mode) => modes.find(([key]) => key === mode)?.[1] ?? mode;
const integer = (value: string) => /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const newRequestId = () => globalThis.crypto.randomUUID();
const isInvoice = (s: TransactionLinkSource) => s.ref.kind === "hometax" || s.ref.kind === "tax_invoice";
const legacyBlocked = (s: TransactionLinkSource) => s.legacyConfirmedReconBlock || s.legacyCollectionBlock;

function SourcePicker({ title, rows, selected, onSelect, disabled, blockLegacy }: {
  title: string; rows: TransactionLinkSource[]; selected: string | null;
  onSelect: (source: TransactionLinkSource) => void; disabled: boolean; blockLegacy: boolean;
}) {
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const filtered = useMemo(() => rows.filter(s => `${s.name} ${s.date} ${sourceLabel(s)} ${s.total}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [rows, search]);
  useEffect(() => setOffset(0), [rows, search]);
  return <section className="min-w-0 rounded-xl border border-[var(--cd-border,#ddd)] p-3">
    <h3 className="font-semibold mb-2">{title}</h3>
    <label className="block text-xs cd-text-muted mb-2">{title} 검색
      <input type="search" className="cd-input w-full mt-1" value={search} onChange={e => setSearch(e.target.value)} placeholder="거래처 · 날짜 · 금액" disabled={disabled}/>
    </label>
    <div className="overflow-x-auto">
      <table className="w-full text-sm"><thead className="text-left cd-text-muted"><tr><th className="py-2">거래</th><th className="text-right">금액 / 남은 금액</th><th><span className="sr-only">선택</span></th></tr></thead>
        <tbody>{filtered.slice(offset, offset + 8).map(s => <tr key={s.key} className="border-t border-[var(--cd-border,#eee)]" aria-selected={selected === s.key}>
          <td className="py-2 pr-2"><div className="font-medium">{s.name || "거래처 미상"}</div><div className="text-xs cd-text-muted">{sourceLabel(s)} · {s.date}</div>
            {legacyBlocked(s) && <div className="text-xs text-amber-700">{blockLegacy ? "기존 확정 수금 · 신규 배부 제한" : "기존 확정 수금 연결 있음"}</div>}
            {s.issues.length > 0 && <div className="text-xs text-amber-700">확인 필요: {s.issues.map(sourceIssue).join(" / ")}</div>}
          </td>
          <td className="text-right whitespace-nowrap"><div>{s.ref.kind === "manual_invoice" && <span className="text-xs">공급가액 </span>}{money(s.total)}</div><div className="text-xs cd-text-muted">{s.ref.kind === "manual_invoice" ? "전체 공급가액 연결" : `남음 ${money(s.residual.total)}`}</div></td>
          <td className="pl-2"><button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" aria-label={`${title} 선택: ${nameOf(s)}`} aria-pressed={selected === s.key} disabled={disabled || blockLegacy && legacyBlocked(s)} onClick={() => onSelect(s)}>{selected === s.key ? "선택됨" : "선택"}</button></td>
        </tr>)}</tbody>
      </table>
      {!filtered.length && <p className="text-sm cd-text-muted py-4">조회 조건에 맞는 거래가 없습니다.</p>}
    </div>
    <PaginationControls total={filtered.length} limit={8} offset={offset} loading={disabled} onPageChange={setOffset}/>
  </section>;
}

export function TransactionLinkPanel() {
  const now = new Date();
  const year = now.getFullYear();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const [data, setData] = useState<LinkResponse | null>(null);
  const [mode, setMode] = useState<Mode>("card_invoice");
  const [left, setLeft] = useState<TransactionLinkSource | null>(null);
  const [right, setRight] = useState<TransactionLinkSource | null>(null);
  const [supply, setSupply] = useState("");
  const [tax, setTax] = useState("");
  const [total, setTotal] = useState("");
  const [expenseAccount, setExpenseAccount] = useState("");
  const [allocations, setAllocations] = useState<DraftAllocation[]>([]);
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelIds, setCancelIds] = useState<string[]>([]);
  const [cancelReason, setCancelReason] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyOffset, setHistoryOffset] = useState(0);
  const [recognitionReviewOpen, setRecognitionReviewOpen] = useState(false);
  const inFlight = useRef(false);
  const getVersion = useRef(0);
  // The same payload keeps its request id after an uncertain network response.
  const pendingRequest = useRef<{ payload: string; id: string } | null>(null);

  const refresh = async (keepNotice = false) => {
    if (!from || !to || from > to) { setError("조회 시작일과 종료일을 확인하세요."); return; }
    const version = ++getVersion.current;
    setLoading(true);
    if (!keepNotice) setNotice(null);
    setError(null);
    try {
      const res = await fetch(`${ENDPOINT}?${new URLSearchParams({ from, to })}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "거래 목록을 불러오지 못했습니다.");
      if (version === getVersion.current) setData(body as LinkResponse);
    } catch (e) {
      if (version === getVersion.current) setError(e instanceof Error ? e.message : String(e));
    } finally { if (version === getVersion.current) setLoading(false); }
  };
  useEffect(() => { void refresh(); return () => { getVersion.current++; }; }, []); // Initial period; later requests use the 조회 button.

  const canWrite = !!data?.permissions.manage && (mode !== "bank_invoice" || !!data?.permissions.bank);
  const sourceRows = data?.sources ?? [];
  const leftRows = sourceRows.filter(s => mode === "bank_invoice" ? s.ref.kind === "bank" : mode === "manual_invoice" ? s.ref.kind === "manual_invoice" : s.ref.kind === "card");
  const salesTarget = mode === "manual_invoice" || mode === "bank_invoice" && left?.direction === "in";
  const rightRows = sourceRows.filter(s => isInvoice(s) && (salesTarget ? s.direction === "sales" : s.ref.kind === "hometax" && s.direction === "purchase"));
  const isPurchase = mode === "card_invoice" || mode === "bank_invoice" && left?.direction === "out";
  const chosenAmount = mode === "distinct" ? { supply: 0, tax: 0, total: 0 } : mode === "manual_invoice" && right ? { supply: right.supply, tax: right.tax, total: right.total }
    : mode === "bank_invoice" ? { supply: 0, tax: 0, total: integer(total) } : { supply: integer(supply), tax: integer(tax), total: integer(total) };
  const amountValid = chosenAmount.total !== null && chosenAmount.supply !== null && chosenAmount.tax !== null
    && (mode === "distinct" || chosenAmount.total > 0)
    && (mode !== "card_invoice" || chosenAmount.supply + chosenAmount.tax === chosenAmount.total);
  const activeHistory = data?.links ?? [];
  const history = activeHistory.filter(link => `${link.leftSnapshot.name} ${link.rightSnapshot.name} ${link.reason} ${link.evidence} ${modeLabel(link.relation)}`.toLocaleLowerCase().includes(historySearch.trim().toLocaleLowerCase()));
  useEffect(() => setHistoryOffset(0), [historySearch, data]);

  const resetSelection = () => { setLeft(null); setRight(null); setSupply(""); setTax(""); setTotal(""); setExpenseAccount(""); };
  const changeMode = (next: Mode) => {
    if (allocations.length || busy) return;
    setMode(next); resetSelection(); setError(null); setNotice(null);
  };
  const chooseLeft = (s: TransactionLinkSource) => { setLeft(s); setRight(null); setSupply(""); setTax(""); setTotal(""); setError(null); setNotice(null); };
  const chooseRight = (s: TransactionLinkSource) => { setRight(s); setSupply(""); setTax(""); setTotal(""); setError(null); setNotice(null); };

  const addAllocation = () => {
    setError(null); setNotice(null);
    if (!left || !right || !amountValid || !canWrite) return;
    if (allocations.length >= 100) { setError("한 번에 최대 100건까지 저장할 수 있습니다."); return; }
    if (allocations.some(a => a.left.key === left.key && a.right.canonicalKey === right.canonicalKey)) { setError("같은 거래 쌍이 배부 목록에 이미 있습니다."); return; }
    if (mode === "manual_invoice" && left.supply !== right.supply) { setError("수기 매출과 대표 계산서의 전체 공급가액이 일치해야 합니다."); return; }
    const next: DraftAllocation = { left, right, supply: chosenAmount.supply!, tax: chosenAmount.tax!, total: chosenAmount.total!, expenseAccount };
    if (mode !== "distinct" && mode !== "manual_invoice") {
      for (const s of [left, right]) {
        const pending = allocations.filter(a => [a.left.canonicalKey, a.right.canonicalKey].includes(s.canonicalKey));
        if (pending.reduce((sum, a) => sum + a.total, next.total) > s.residual.total) { setError(`${s.name}: 남은 금액보다 많이 배부할 수 없습니다.`); return; }
        if (mode === "card_invoice" && (pending.reduce((sum, a) => sum + a.supply, next.supply) > s.residual.supply || pending.reduce((sum, a) => sum + a.tax, next.tax) > s.residual.tax)) { setError(`${s.name}: 공급가액 또는 세액의 남은 금액을 초과했습니다.`); return; }
      }
    }
    setAllocations(a => [...a, next]); setRight(null); setSupply(""); setTax(""); setTotal("");
  };

  const post = async (payload: Record<string, unknown>, success: string) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    const serialized = JSON.stringify(payload);
    if (pendingRequest.current?.payload !== serialized) pendingRequest.current = { payload: serialized, id: newRequestId() };
    try {
      const res = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, requestId: pendingRequest.current.id }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `저장하지 못했습니다. (${res.status})`);
      pendingRequest.current = null;
      setNotice(success);
      if (payload.action === "create") { setAllocations([]); resetSelection(); setReason(""); setEvidence(""); }
      else { setCancelIds([]); setCancelReason(""); }
      await refresh(true);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const save = () => {
    if (!canWrite || !allocations.length || !reason.trim() || !evidence.trim()) return;
    const links: TransactionLinkInput[] = allocations.map(a => ({ relation: mode, left: a.left.ref, right: a.right.ref,
      supply: a.supply, tax: a.tax, total: a.total, expenseAccount: a.expenseAccount || null,
      reason: reason.trim(), evidence: evidence.trim(), expectedLeftHash: a.left.sourceHash, expectedRightHash: a.right.sourceHash }));
    void post({ action: "create", links }, mode === "distinct" ? "별개 거래의 확인 근거를 저장했습니다." : "배부 목록 전체를 저장했습니다. 전표 재생성 및 신고 자료의 대사 결과를 확인하세요.");
  };
  const canCancel = (link: TransactionLink) => !!data?.permissions.manage && (link.relation !== "bank_invoice" || !!data?.permissions.bank) && link.state === "active";
  const staleDraft = allocations.some(a => [a.left, a.right].some(s => {
    const latest = data?.sources.find(r => r.key === s.key);
    return !latest || latest.sourceHash !== s.sourceHash;
  }));
  const stagedSources = [...new Map(allocations.flatMap(a => [a.left, a.right]).map(s => [s.canonicalKey, s])).values()];

  return <div className="space-y-4">
    <section className="cd-card p-4">
      <h2 className="cd-card-title">거래 연결</h2>
      <p className="text-sm cd-text-muted mt-1 mb-3">증빙이 겹치는 공급과 실제 지급·수금을 연결하고, 아직 연결하지 않은 금액을 확인합니다.</p>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="text-xs">조회 시작일<input aria-label="조회 시작일" type="date" className="cd-input block mt-1" value={from} onChange={e => setFrom(e.target.value)} disabled={busy}/></label>
        <label className="text-xs">조회 종료일<input aria-label="조회 종료일" type="date" className="cd-input block mt-1" value={to} onChange={e => setTo(e.target.value)} disabled={busy}/></label>
        <button type="button" className="cd-btn cd-btn-ghost" onClick={() => void refresh()} disabled={busy || loading}>{loading ? "불러오는 중…" : "조회"}</button>
      </div>
      <p className="text-xs cd-text-muted mt-2">기존 확정 수금은 보존하며 해당 수금에 새 계좌 배부를 추가할 수 없습니다. 마감·확정 자료에 영향을 주거나 취소·환불 등 지원하지 않는 거래는 검토 사유와 함께 저장이 제한됩니다. 연결이 있는 거래는 기간 밖의 자료도 함께 표시합니다.</p>
    </section>

    {error && <div role="alert" className="cd-card p-3 text-sm cd-error-text">{error}<div className="mt-1 text-xs">입력한 배부와 사유는 유지됩니다. 자료가 변경된 경우 다시 조회하고 해당 배부를 제거한 뒤 최신 거래로 다시 선택하세요.</div></div>}
    {notice && <div role="status" className="cd-card p-3 text-sm">{notice}</div>}
    {data && !data.permissions.manage && <p className="cd-card p-3 text-sm">조회 전용 권한입니다. 연결·취소는 재무 관리 권한이 필요합니다.</p>}
    {data && mode === "bank_invoice" && !data.permissions.bank && <p className="cd-card p-3 text-sm">계좌 거래를 연결하려면 수금 확정 권한도 필요합니다.</p>}
    {data && data.issues.length > 0 && <details className="cd-card p-3 text-sm"><summary>연결 자료 확인 필요 {data.issues.length}건</summary><ul className="list-disc pl-5 mt-2">{data.issues.map((i, idx) => <li key={idx}>{i.message}</li>)}</ul></details>}

    <section className="cd-card p-4 space-y-3">
      <fieldset disabled={busy || allocations.length > 0} className="flex gap-2 flex-wrap"><legend className="text-sm font-semibold mb-2">연결 방식</legend>{modes.map(([key, label]) => <button key={key} type="button" className="cd-chip" aria-pressed={mode === key} data-active={mode === key || undefined} onClick={() => changeMode(key)}>{label}</button>)}</fieldset>
      <p className="text-sm cd-text-muted">{modes.find(([key]) => key === mode)?.[2]}</p>
      {allocations.length > 0 && <p className="text-xs cd-text-muted">이 배부 목록은 같은 연결 방식으로 한 번에 저장됩니다. 다른 방식은 목록 저장 또는 제거 후 선택하세요.</p>}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <SourcePicker title="기준 거래" rows={leftRows} selected={left?.key ?? null} onSelect={chooseLeft} disabled={busy || loading} blockLegacy={mode === "bank_invoice"}/>
        {left ? <SourcePicker title="연결할 거래" rows={rightRows} selected={right?.key ?? null} onSelect={chooseRight} disabled={busy || loading} blockLegacy={mode === "bank_invoice"}/> : <div className="rounded-xl border border-[var(--cd-border,#ddd)] p-4 text-sm cd-text-muted">기준 거래를 먼저 선택하세요.</div>}
      </div>
      {left && <div className="text-sm"><strong>기준 거래:</strong> {nameOf(left)} {left.ref.kind !== "manual_invoice" && <span className="cd-text-muted">/ 남음 {money(left.residual.total)}</span>}</div>}
      {left && right && <div className="rounded-xl border border-[var(--cd-border,#ddd)] p-3 space-y-2">
        <p className="text-sm"><strong>연결할 거래:</strong> {nameOf(right)} <span className="cd-text-muted">/ 남음 {money(right.residual.total)}</span></p>
        {mode === "card_invoice" && <><p className="text-xs cd-text-muted">증빙에서 확인한 같은 공급의 금액만 원 단위 정수로 입력하세요. 세액은 비율로 자동 계산하지 않습니다. 양쪽 금액 성분이 모두 같으면 전체 연결 또는 별개 거래로 확인해야 합니다.</p><div className="flex gap-2 flex-wrap">
          <label className="text-xs">배부 공급가액<input type="text" inputMode="numeric" className="cd-input block mt-1" value={supply} onChange={e => setSupply(e.target.value)} disabled={busy}/></label>
          <label className="text-xs">배부 세액<input type="text" inputMode="numeric" className="cd-input block mt-1" value={tax} onChange={e => setTax(e.target.value)} disabled={busy}/></label>
          <label className="text-xs">배부 합계<input type="text" inputMode="numeric" className="cd-input block mt-1" value={total} onChange={e => setTotal(e.target.value)} disabled={busy}/></label>
        </div><p className="text-xs cd-text-muted">카드 남은 공급가액 {money(left.residual.supply)} / 세액 {money(left.residual.tax)} · 계산서 남은 공급가액 {money(right.residual.supply)} / 세액 {money(right.residual.tax)}</p></>}
        {mode === "bank_invoice" && <label className="text-xs block">배부 결제금액<input type="text" inputMode="numeric" className="cd-input block mt-1" value={total} onChange={e => setTotal(e.target.value)} disabled={busy}/></label>}
        {mode === "manual_invoice" && <p className="text-sm">전체 공급가액: 수기 매출 {money(left.supply)} / 대표 계산서 {money(right.supply)}. 대표 계산서 세액 {money(right.tax)}·합계 {money(right.total)}를 사용합니다.</p>}
        {mode === "distinct" && <p className="text-sm">두 거래가 별개라는 근거를 등록합니다. 금액을 배부하거나 원천을 제외하지 않습니다.</p>}
        {isPurchase && <label className="text-xs block">매입 비용 계정<select aria-label="매입 비용 계정" className="cd-select block mt-1" value={expenseAccount} onChange={e => setExpenseAccount(e.target.value)} disabled={busy}><option value="">계정을 선택하세요</option>{data?.expenseAccounts.map(a => <option key={a.accountCode} value={a.accountCode}>{a.name}</option>)}</select></label>}
        <button type="button" className="cd-btn cd-btn-ghost" disabled={busy || loading || !canWrite || !amountValid || isPurchase && !expenseAccount} onClick={addAllocation}>배부 목록에 추가</button>
      </div>}

      <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="text-left font-semibold py-2">저장할 배부 {allocations.length}건</caption><thead className="text-left cd-text-muted"><tr><th>기준 → 연결 거래</th><th className="text-right">공급가액</th><th className="text-right">세액</th><th className="text-right">합계</th><th><span className="sr-only">제거</span></th></tr></thead><tbody>{allocations.map((a, index) => <tr key={`${a.left.key}/${a.right.key}`} className="border-t border-[var(--cd-border,#ddd)]"><td className="py-2 pr-2">{nameOf(a.left)}<br/><span className="cd-text-muted">→ {nameOf(a.right)}</span></td><td className="text-right whitespace-nowrap">{mode === "bank_invoice" || mode === "distinct" ? "—" : money(a.supply)}</td><td className="text-right whitespace-nowrap">{mode === "bank_invoice" || mode === "distinct" ? "—" : money(a.tax)}</td><td className="text-right whitespace-nowrap">{mode === "distinct" ? "배부 없음" : money(a.total)}</td><td className="pl-2"><button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" aria-label={`배부 ${index + 1} 제거`} disabled={busy} onClick={() => setAllocations(rows => rows.filter((_, i) => i !== index))}>제거</button></td></tr>)}</tbody></table></div>
      {mode !== "distinct" && mode !== "manual_invoice" && stagedSources.length > 0 && <div className="text-xs cd-text-muted space-y-1" aria-label="배부 후 예상 잔액">{stagedSources.map(s => <p key={s.canonicalKey}>{s.name} · {s.date}: 이번 배부 {money(allocations.filter(a => [a.left.canonicalKey, a.right.canonicalKey].includes(s.canonicalKey)).reduce((sum, a) => sum + a.total, 0))} / 배부 후 남음 {money(s.residual.total - allocations.filter(a => [a.left.canonicalKey, a.right.canonicalKey].includes(s.canonicalKey)).reduce((sum, a) => sum + a.total, 0))}</p>)}</div>}
      {staleDraft && <p role="alert" className="text-sm cd-error-text">선택한 원천이 변경되었거나 조회 범위에 없습니다. 배부를 제거하고 최신 원천으로 다시 선택하세요.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">연결 사유<textarea aria-label="연결 사유" className="cd-input w-full mt-1" rows={2} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} placeholder={mode === "distinct" ? "두 공급이 다른 거래인 이유" : "같은 공급 또는 지급·수금임을 확인한 내용"}/></label>
        <label className="text-sm">증빙 참조<textarea aria-label="증빙 참조" className="cd-input w-full mt-1" rows={2} maxLength={2000} value={evidence} onChange={e => setEvidence(e.target.value)} disabled={busy} placeholder="계약·주문·정산서·영수증의 확인 위치"/></label>
      </div>
      <button type="button" className="cd-btn cd-btn-primary" disabled={busy || loading || !canWrite || !allocations.length || staleDraft || !reason.trim() || !evidence.trim()} onClick={save}>{busy ? "처리 중…" : mode === "distinct" ? "별개 거래 근거 저장" : "배부 목록 전체 저장"}</button>
    </section>

    <section className="cd-card p-4 space-y-3">
      <h2 className="cd-card-title">연결 이력</h2>
      <label className="text-xs block">연결 이력 검색<input type="search" className="cd-input block w-full mt-1" value={historySearch} onChange={e => setHistorySearch(e.target.value)} placeholder="거래처 · 사유 · 증빙"/></label>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left cd-text-muted"><tr><th>선택</th><th>연결 거래</th><th>상태·사유</th><th className="text-right">배부금액</th></tr></thead><tbody>{history.slice(historyOffset, historyOffset + 10).map(link => <tr key={link.id} className="border-t border-[var(--cd-border,#ddd)]"><td className="pr-2"><input type="checkbox" aria-label={`연결 취소 선택: ${nameOf(link.leftSnapshot)} → ${nameOf(link.rightSnapshot)}`} checked={cancelIds.includes(link.id)} disabled={busy || !canCancel(link)} onChange={e => setCancelIds(ids => e.target.checked ? [...ids, link.id] : ids.filter(id => id !== link.id))}/></td><td className="py-2 pr-2">{nameOf(link.leftSnapshot)}<br/><span className="cd-text-muted">→ {nameOf(link.rightSnapshot)}</span><div className="text-xs cd-text-muted">{modeLabel(link.relation)}</div></td><td className="pr-2"><strong className={link.state === "active" && !link.valid ? "text-amber-700" : ""}>{link.state === "cancelled" ? "취소됨" : link.valid ? "연결됨" : "재검토 필요"}</strong><div>{link.reason}</div><div className="text-xs cd-text-muted">증빙: {link.evidence}</div>{link.cancelReason && <div className="text-xs">취소 사유: {link.cancelReason}</div>}{link.issues.map((i, idx) => <div key={idx} className="text-xs text-amber-700">{i.message}</div>)}</td><td className="text-right whitespace-nowrap">{link.relation === "distinct" ? "배부 없음" : money(link.total)}</td></tr>)}</tbody></table></div>
      {!history.length && <p className="text-sm cd-text-muted">표시할 연결 이력이 없습니다.</p>}
      <PaginationControls total={history.length} limit={10} offset={historyOffset} loading={loading || busy} onPageChange={setHistoryOffset}/>
      <label className="text-sm block">취소 사유<textarea aria-label="취소 사유" className="cd-input block w-full mt-1" rows={2} maxLength={2000} value={cancelReason} onChange={e => setCancelReason(e.target.value)} disabled={busy} placeholder="연결을 취소하는 이유를 기록하세요"/></label>
      <button type="button" className="cd-btn cd-btn-ghost" disabled={busy || loading || !cancelIds.length || !cancelReason.trim() || cancelIds.some(id => !data?.links.some(l => l.id === id && canCancel(l)))} onClick={() => void post({ action: "cancel", linkIds: cancelIds, reason: cancelReason.trim() }, "선택한 연결을 취소했습니다. 관련 자료를 다시 대사하세요.")}>선택한 연결 {cancelIds.length}건 취소</button>
    </section>
    <div><button type="button" className="cd-btn cd-btn-ghost" aria-expanded={recognitionReviewOpen} aria-controls="recognition-review-section" disabled={busy} onClick={() => setRecognitionReviewOpen(open => !open)}>{recognitionReviewOpen ? "매입 인식 재검토 닫기" : "매입 인식 재검토 열기"}</button></div>
    {recognitionReviewOpen && <div id="recognition-review-section"><RecognitionReviewPanel from={from} to={to} manage={data?.permissions.manage} onApplied={() => refresh(true)} /></div>}
  </div>;
}
