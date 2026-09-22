"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileCheck2, RefreshCw } from "lucide-react";
import { CdInput, CdSelect, CdTextarea } from "@/components/cdash/CdField";
import type { VatFollowupApplication, VatFollowupPairInput, VatFollowupPreview, VatFollowupPreviewInput } from "@/lib/finance/vat-followup-review-types";
import type { VatFollowupSelection } from "@/lib/finance/vat-followup-consumption-types";
import type { VatFollowupWorkspace, VatFollowupWorkspaceCandidate, VatFollowupWorkspaceRecord } from "@/lib/finance/vat-followup-workspace-types";

const API = "/api/finance/vat-followup-reviews";
const money = (n: number | null | undefined) => n == null ? "미확인" : `${n.toLocaleString("ko-KR")}원`;
const applicationKey = (a: VatFollowupApplication | null | undefined) => a ? [a.subjectId, a.year, a.term, a.kind, a.path, a.basisSnapshotId ?? ""].join(":") : "";
const selectedKey = (revisionId: string, pairKey: string) => `${revisionId}:${pairKey}`;
const states = { recorded: "기록됨 · 미검토", verified: "검토 완료", withdrawn: "철회" };
type Workspace = VatFollowupWorkspace & { permissions: { manage: boolean } };
interface DraftPair { key: string; pair: VatFollowupPairInput }
interface Props {
  application?: VatFollowupApplication | null;
  selection: VatFollowupSelection | null;
  onSelectionChange: (selection: VatFollowupSelection | null) => void;
  onOpenBasis: (id: string) => void;
  calculationEnabled: boolean;
  locked?: boolean;
}
function failure(body: { error?: unknown }, status: number) {
  const detail = typeof body.error === "string" ? body.error : "요청을 처리하지 못했습니다.";
  const guide = status === 503 ? "저장 근거를 검증할 수 없습니다. 다시 조회하고, 계속되면 담당자에게 원문과 필수 저장 구조 확인을 요청하세요."
    : status === 409 ? "원천·증빙·검토 판 또는 확정 상태가 달라졌습니다. 목록을 다시 조회하고 검토하세요."
      : status === 404 ? "선택한 자료를 찾을 수 없습니다. 목록을 다시 조회하세요."
        : status === 403 ? "작업 권한을 확인하세요." : "";
  return [detail, guide].filter(Boolean).join(" ");
}
function inputPair(candidate: VatFollowupWorkspaceCandidate): VatFollowupPairInput | null {
  if (!candidate.cardRef || !candidate.invoiceRef || !candidate.historicalSide || !candidate.past) return null;
  return { card: candidate.cardRef, invoice: candidate.invoiceRef, historicalSide: candidate.historicalSide, past: candidate.past, documentId: "", evidenceLocation: "", reason: "" };
}

/** The workspace supplies choices; preview/save and calculation revalidate them on the server. */
export function VatFollowupReviewPanel({ application = null, selection, onSelectionChange, onOpenBasis, calculationEnabled, locked = false }: Props) {
  const [browsed, setBrowsed] = useState<VatFollowupApplication | null>(application);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [needsReload, setNeedsReload] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [page, setPage] = useState(1), [recordPage, setRecordPage] = useState(1), [search, setSearch] = useState("");
  const [draftPairs, setDraftPairs] = useState<DraftPair[]>([]), [state, setState] = useState<"recorded" | "verified">("recorded");
  const [reviewId, setReviewId] = useState(""), [version, setVersion] = useState(0), [withdrawId, setWithdrawId] = useState("");
  const [withdrawReason, setWithdrawReason] = useState(""), [preview, setPreview] = useState<VatFollowupPreview | null>(null), [confirmed, setConfirmed] = useState(false);
  const sequence = useRef(0), editEpoch = useRef(0), inFlight = useRef(false), abort = useRef<AbortController | null>(null);
  const pending = useRef<{ payload: string; input: VatFollowupPreviewInput } | null>(null);
  const withdrawalRequest = useRef<{ payload: string; requestId: string } | null>(null);
  const selectionCallback = useRef(onSelectionChange); selectionCallback.current = onSelectionChange;
  const requestedKey = applicationKey(application), scopeKey = applicationKey(browsed);
  const context = useRef(scopeKey); context.current = scopeKey;
  const disabled = locked || loading || busy || needsReload || workspace?.permissions.manage !== true;
  const canSelect = calculationEnabled && requestedKey === scopeKey && browsed?.path === "basis" && !disabled;
  const chosen = useMemo(() => new Set(selection?.pairs.map(p => selectedKey(p.revisionId, p.pairKey)) ?? []), [selection]);
  const invalidate = useCallback(() => { editEpoch.current++; setPreview(null); setConfirmed(false); pending.current = null; }, []);
  const resetEditor = useCallback(() => { invalidate(); setDraftPairs([]); setReviewId(""); setVersion(0); setState("recorded"); setWithdrawId(""); setWithdrawReason(""); withdrawalRequest.current = null; }, [invalidate]);
  const load = useCallback(async (clearSelection = true) => {
    const seq = ++sequence.current; abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    setLoading(true); setError(null); invalidate(); if (clearSelection) selectionCallback.current(null);
    const params = new URLSearchParams({ page: String(page), pageSize: "50", recordPage: String(recordPage), recordPageSize: "10" });
    if (browsed) for (const [k, v] of Object.entries(browsed)) if (v != null) params.set(k, String(v));
    try {
      const response = await fetch(`${API}?${params}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json(); if (!response.ok) throw new Error(failure(body, response.status));
      if (body.integrationMode !== "explicit_selection" || !Array.isArray(body.records) || !Array.isArray(body.candidates) || !Array.isArray(body.applications) || !Array.isArray(body.documents) || !Array.isArray(body.consumptions) || typeof body.permissions?.manage !== "boolean" || applicationKey(body.application) !== scopeKey) throw new Error("검토 목록의 적용 범위를 확인할 수 없습니다. 다시 조회하세요.");
      if (seq === sequence.current && !controller.signal.aborted) { setWorkspace(body); setNeedsReload(false); }
    } catch (e) { if (seq === sequence.current && !controller.signal.aborted) { setError(e instanceof Error ? e.message : String(e)); setWorkspace(null); setNeedsReload(true); } }
    finally { if (seq === sequence.current && !controller.signal.aborted) setLoading(false); }
  }, [scopeKey, browsed, page, recordPage, invalidate]);
  useEffect(() => {
    sequence.current++; abort.current?.abort(); setBrowsed(application); setPage(1); setRecordPage(1); setWorkspace(null); resetEditor(); setNotice(null); selectionCallback.current(null);
    // The semantic application key prevents changes of object identity from clearing user input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedKey, resetEditor]);
  useEffect(() => { void load(false); return () => { sequence.current++; abort.current?.abort(); }; }, [load]);

  const changeScope = (key: string) => {
    const next = workspace?.applications.find(a => applicationKey(a.application) === key)?.application ?? null;
    sequence.current++; abort.current?.abort(); setBrowsed(next); setPage(1); setRecordPage(1); resetEditor(); setNotice(null); selectionCallback.current(null);
  };
  const begin = (c: VatFollowupWorkspaceCandidate) => {
    const pair = inputPair(c); if (disabled || !workspace?.canCreateReview || !c.canStartReview || !pair) return;
    resetEditor(); setDraftPairs([{ key: c.pairKey, pair }]); setNotice(null);
  };
  const edit = (r: VatFollowupWorkspaceRecord) => {
    if (disabled || !workspace?.canCreateReview || !r.latest || r.consumed) return;
    resetEditor(); setReviewId(r.reviewId); setVersion(r.version); setState(r.payload.state === "verified" ? "verified" : "recorded");
    setDraftPairs(r.payload.pairs.map(p => ({ key: p.pairKey, pair: {
      card: { kind: "card", id: p.card.id, expectedSourceHash: p.card.sourceHash }, invoice: { kind: "hometax", id: p.invoice.id, expectedSourceHash: p.invoice.sourceHash }, historicalSide: p.historicalSide,
      past: p.past.origin === "legacy" ? { origin: "legacy", returnId: p.past.legacyReturnId!, expectedArchiveHash: p.past.archiveHash } : { origin: "basis", basisSnapshotId: p.past.basisSnapshotId!, factRevisionId: p.past.factRevisionId!, expectedScopeHash: p.past.scopeHash! },
      documentId: p.document.documentId, evidenceLocation: p.evidenceLocation, reason: p.reason,
    } })));
  };
  const updatePair = (index: number, patch: Partial<VatFollowupPairInput>) => { setDraftPairs(rows => rows.map((r, i) => i === index ? { ...r, pair: { ...r.pair, ...patch } } : r)); invalidate(); };
  const requestPreview = async () => {
    if (disabled || inFlight.current || !browsed) return;
    const epoch = editEpoch.current, requestContext = context.current;
    let errorEpoch = epoch;
    setError(null); setNotice(null);
    try {
      if (!draftPairs.length || draftPairs.some(r => !r.pair.documentId || !r.pair.evidenceLocation.trim() || !r.pair.reason.trim())) throw new Error("각 거래 쌍의 증빙·확인 위치·별개 공급 사유를 입력하세요.");
      const body = { reviewId: reviewId || null, expectedVersion: version, application: browsed, state, pairs: draftPairs.map(r => r.pair) };
      const payload = JSON.stringify(body);
      if (pending.current?.payload !== payload) pending.current = { payload, input: { ...body, requestId: crypto.randomUUID() } };
      inFlight.current = true; setBusy(true);
      const response = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", ...pending.current.input }) });
      const data = await response.json(); if (!response.ok) { if (requestContext === context.current && epoch === editEpoch.current && [403, 404, 409, 503].includes(response.status)) { setNeedsReload(true); selectionCallback.current(null); invalidate(); errorEpoch = editEpoch.current; } throw new Error(failure(data, response.status)); }
      if (!data.normalized || data.normalized.requestId !== pending.current?.input.requestId || applicationKey(data.normalized.application) !== requestContext || !data.payload || !Array.isArray(data.issues) || typeof data.canReview !== "boolean") throw new Error("검토 미리보기의 요청과 적용 범위를 확인할 수 없습니다. 다시 조회하세요.");
      if (epoch === editEpoch.current && requestContext === context.current) { setPreview(data); setConfirmed(false); }
    } catch (e) { if (requestContext === context.current && errorEpoch === editEpoch.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const save = async () => {
    if (disabled || inFlight.current || !preview || (state === "verified" && (!preview.canReview || !confirmed))) return;
    const epoch = editEpoch.current, requestContext = context.current;
    let errorEpoch = epoch;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", ...preview.normalized, expectedPreviewHash: preview.previewHash, reviewConfirmed: confirmed }) });
      const data = await response.json(); if (!response.ok) { if (requestContext === context.current && epoch === editEpoch.current && [403, 404, 409, 503].includes(response.status)) { setNeedsReload(true); selectionCallback.current(null); invalidate(); errorEpoch = editEpoch.current; } throw new Error(failure(data, response.status)); }
      if (requestContext !== context.current || epoch !== editEpoch.current) return;
      resetEditor(); setNotice(`검토 ${data.version}판을 보관했습니다. 계산에 적용하려면 유효한 거래 쌍을 직접 선택하세요.`); await load();
    } catch (e) { if (requestContext === context.current && errorEpoch === editEpoch.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const withdraw = async () => {
    const row = workspace?.records.find(r => r.revisionId === withdrawId);
    if (disabled || inFlight.current || !row?.canWithdraw || !withdrawReason.trim()) return;
    const requestContext = context.current, epoch = editEpoch.current;
    const body = { reviewId: row.reviewId, expectedVersion: row.version, reason: withdrawReason.trim() }, payload = JSON.stringify(body);
    if (withdrawalRequest.current?.payload !== payload) withdrawalRequest.current = { payload, requestId: crypto.randomUUID() };
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "withdraw", ...body, requestId: withdrawalRequest.current.requestId }) });
      const data = await response.json(); if (!response.ok) { if (requestContext === context.current && epoch === editEpoch.current && [403, 404, 409, 503].includes(response.status)) { setNeedsReload(true); selectionCallback.current(null); } throw new Error(failure(data, response.status)); }
      if (requestContext !== context.current || epoch !== editEpoch.current) return;
      resetEditor(); setNotice("철회 판을 보관했습니다. 이전 판과 증빙은 유지됩니다."); await load();
    } catch (e) { if (requestContext === context.current && epoch === editEpoch.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const toggle = (r: VatFollowupWorkspaceRecord, pairKey: string, checked: boolean) => {
    if (!canSelect || !r.canSelect || !r.pairSelections.find(p => p.pairKey === pairKey)?.canSelect || !browsed) return;
    const pairs = (selection?.pairs ?? []).filter(p => !(p.revisionId === r.revisionId && p.pairKey === pairKey));
    if (checked) pairs.push({ revisionId: r.revisionId, pairKey });
    selectionCallback.current(pairs.length ? { subjectId: browsed.subjectId, pairs } : null);
  };
  const download = async (documentId: string) => {
    if (!browsed || busy) return;
    setError(null); const requestContext = context.current;
    try {
      const response = await fetch(`/api/finance/vat-filing-documents?${new URLSearchParams({ subjectId: browsed.subjectId, documentId })}`, { cache: "no-store" });
      if (!response.ok) throw new Error(failure(await response.json().catch(() => ({})), response.status));
      const blob = await response.blob(); if (requestContext !== context.current) return;
      const name = workspace?.documents.find(d => d.documentId === documentId)?.fileName ?? "검토증빙";
      const url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
    } catch (e) { if (requestContext === context.current) setError(e instanceof Error ? e.message : String(e)); }
  };
  const visibleCandidates = workspace?.candidates.filter(c => !search || `${c.card.partyName} ${c.invoice.partyName} ${c.card.date} ${c.invoice.date} ${c.officialIdentifiers.join(" ")}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const canEditCandidate = (c: VatFollowupWorkspaceCandidate) => c.canStartReview || (!!reviewId && workspace?.records.some(r => r.reviewId === reviewId && r.latest && !r.consumed && r.payload.pairs.some(p => p.pairKey === c.pairKey)) === true && c.issues.every(i => i.code === "vat_followup_existing_review") && !!inputPair(c));
  const refreshPair = (index: number, c: VatFollowupWorkspaceCandidate) => {
    const fresh = inputPair(c); if (!fresh || !canEditCandidate(c) || disabled) return;
    setDraftPairs(rows => rows.map((r, n) => n === index ? { key: c.pairKey, pair: { ...fresh, documentId: r.pair.documentId, evidenceLocation: r.pair.evidenceLocation, reason: r.pair.reason } } : r)); invalidate();
  };
  const availableAddition = workspace?.candidates.find(c => c.canStartReview && !draftPairs.some(p => p.key === c.pairKey));
  return <section aria-label="과거·당기 별개 공급 검토" className="cd-card p-5 sm:p-6 space-y-5">
    <header className="flex flex-wrap gap-3 items-center"><h2 className="cd-card-title mr-auto"><FileCheck2 size={18} className="inline mr-2" />과거·당기 별개 공급 검토</h2><button type="button" className="cd-btn cd-btn-ghost" disabled={busy || loading || locked} onClick={() => void load()}><RefreshCw size={16} />검토 목록 다시 조회</button></header>
    <p className="text-sm cd-text-muted">과거에 공제한 공급과 당기 공급이 실제로 별개인지 증빙으로 확인합니다. 검토를 저장하는 것과 신고 계산에 적용하는 것은 별도이며, 선택한 카드·계산서 쌍만 반영합니다.</p>
    <CdSelect label="검토 원장 적용 범위" aria-label="검토 원장 적용 범위" disabled={busy || loading || locked} value={scopeKey} onChange={e => changeScope(e.target.value)}><option value="">조회할 신고 주체·기간을 선택하세요</option>{workspace?.applications.map(a => <option key={applicationKey(a.application)} value={applicationKey(a.application)}>{a.label} · {a.corpNum ?? "번호 미확인"}{a.readOnlyCalculation ? " · 계산 조회 전용" : ""}</option>)}</CdSelect>
    {browsed?.path === "legacy" && <p className="text-sm cd-text-muted">기존 형식의 기록 조회입니다. 이 경로에서 새 신고 저장·확정은 지원하지 않습니다.</p>}
    {browsed?.path === "basis" && scopeKey !== requestedKey && <button className="cd-btn cd-btn-ghost" disabled={busy || locked || !browsed.basisSnapshotId} onClick={() => onOpenBasis(browsed.basisSnapshotId!)}>이 근거로 새 계산 열기</button>}
    {!loading && workspace?.permissions.manage !== true && <p className="text-sm cd-text-muted">조회 전용입니다. 검토 작성·철회·계산 선택은 재무 관리 권한이 필요합니다.</p>}
    {error && <div role="alert" className="cd-error-text text-sm">{error}</div>}{notice && <p role="status" className="text-sm">{notice}</p>}
    {loading && <p role="status" className="text-sm cd-text-muted">검토 근거를 불러오는 중입니다.</p>}
    {workspace?.issues.map((i, n) => <p key={n} role="status" className="text-sm cd-text-muted">{i.message}</p>)}
    {browsed && workspace && <>
      <section aria-label="보관 검토 원장" className="space-y-3"><h3 className="font-semibold">보관 검토 원장</h3>
        <p role="status" className="text-sm">새 계산에 선택한 거래 쌍 {chosen.size}건 · 최종 미해결 건수는 아래 신고 계산 결과에서 확인하세요.</p>
        <p className="text-xs cd-text-muted">같은 당기 원천이 여러 쌍에 표시되어도 신고서에서는 한 번만 공제합니다. 쌍별 표시 금액을 합산하지 않으며 최종 세액은 신고 계산에서 확인합니다.</p>
        {!calculationEnabled && <p className="text-xs cd-text-muted">새 계산의 확정 신고 근거를 선택하면 유효한 쌍을 적용할 수 있습니다. 저장본에 새 선택을 덧붙이지 않습니다.</p>}
        {workspace.records.map(r => <article key={r.revisionId} className="rounded-xl border cd-border-c p-4 space-y-3" aria-label={`검토 ${r.reviewId} ${r.version}판`}>
          <header className="flex flex-wrap gap-2 items-center"><strong className="font-semibold">검토 {r.version}판</strong><span className="cd-pill cd-pill-info">{states[r.payload.state]}</span>{!r.latest && <span className="cd-pill">이전 판</span>}{r.consumed ? <span className="cd-pill cd-pill-success">신고 확정에 사용됨</span> : <span className={`cd-pill ${r.currentValid ? "cd-pill-success" : "cd-pill-warn"}`}>{r.verificationStatus === "unavailable" ? "현재 검증 불가" : r.currentValid ? "현재 근거 유효" : "현재 근거 재검토"}</span>}</header>
          <p className="text-xs cd-text-muted">검토 기록 {r.createdAt} · {r.reviewedBy ? `검토자 ${r.reviewedBy}` : "검토자 확인 전"}</p>
          {r.selectionUnavailableReason && <p className="text-sm cd-text-muted">{r.selectionUnavailableReason}</p>}
          {r.currentIssues.map((i, n) => <p className="text-sm cd-text-muted" key={n}>{i.message}</p>)}
          {r.payload.pairs.map(pair => { const p = r.pairSelections.find(p => p.pairKey === pair.pairKey); return <div key={pair.pairKey} className="border-t cd-border-c pt-3 space-y-2">
            <label className="flex gap-2 items-start text-sm"><input type="checkbox" aria-label={`${r.revisionId} ${pair.pairKey} 계산에 선택`} checked={chosen.has(selectedKey(r.revisionId, pair.pairKey))} disabled={!canSelect || !r.canSelect || !p?.canSelect || (chosen.size >= 100 && !chosen.has(selectedKey(r.revisionId, pair.pairKey)))} onChange={e => toggle(r, pair.pairKey, e.target.checked)} /><span>카드 {pair.card.partyName} · {pair.card.date} ↔ 계산서 {pair.invoice.partyName} · {pair.invoice.date}</span></label>
            <p className="text-sm">과거 실제 기공제 <strong>{money(p?.priorClaimedTax ?? pair.past.claim.claimedTax)}</strong> · 당기 공제 가능 <strong>{money(p?.currentClaimableTax)}</strong></p>
            <p className="text-xs cd-text-muted">카드 원천 세액 {money(pair.card.tax)} · 계산서 원천 세액 {money(pair.invoice.tax)} · 원천 세액과 실제 기공제액은 다를 수 있습니다.</p>
            <p className="text-sm">{p?.pastLabel ?? "과거 보관 근거"} · 공식 식별자 {p?.officialIdentifiers.join(" · ") || "확인되지 않음"}</p>
            <p className="text-sm">증빙 위치: {pair.evidenceLocation} · 사유: {pair.reason}</p>
            <p className="text-xs cd-text-muted">당시 근거: {pair.past.evidenceVerification === "server_document_verified" ? "서버 보관 문서 확인" : pair.past.evidenceVerification === "legacy_internal_snapshot_only" ? "내부 신고 저장본" : "선언형 참조 · 검토 미완료"}. 현재 원문 재인증 완료를 뜻하지 않습니다.</p>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy} onClick={() => void download(pair.document.documentId)}><Download size={14} />{p?.documentFileName || "검토 증빙 다운로드"}</button>
            {p?.selectionUnavailableReason && <p className="text-xs cd-text-muted">{p.selectionUnavailableReason}</p>}
          </div>; })}
          {workspace.consumptions.filter(c => c.reviewId === r.reviewId && c.revisionId === r.revisionId).map(c => <p key={`${c.returnId}:${c.pairKey}`} className="text-sm">사용한 신고 저장본 {c.returnId}{c.confirmationId ? ` · 내부 확정 ${c.confirmationId}` : ""} · {c.path === "basis" ? "근거 기반" : "기존 형식"}</p>)}
          {r.consumed && <p className="text-sm cd-text-muted">사용된 검토는 철회할 수 없습니다. 세액 정정이 필요하면 사용한 신고와 원문을 담당자가 확인해야 합니다.</p>}
          {r.latest && !r.consumed && <div className="flex flex-wrap gap-2"><button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={disabled || !workspace.canCreateReview} onClick={() => edit(r)}>검토 새 판 작성</button>{r.canWithdraw && <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={disabled} onClick={() => { resetEditor(); setWithdrawId(r.revisionId); }}>이 검토 철회 작성</button>}</div>}
        </article>)}
        {!workspace.records.length && <p className="text-sm cd-text-muted">보관한 검토가 없습니다.</p>}
        <div className="flex items-center gap-3"><button className="cd-btn cd-btn-ghost cd-btn-sm" disabled={loading || busy || recordPage <= 1} onClick={() => setRecordPage(p => p - 1)}>이전 검토 판</button><span className="text-sm">검토 {workspace.recordTotal}판 · {recordPage} / {Math.max(1, Math.ceil(workspace.recordTotal / workspace.recordPageSize))}쪽</span><button className="cd-btn cd-btn-ghost cd-btn-sm" disabled={loading || busy || recordPage * workspace.recordPageSize >= workspace.recordTotal} onClick={() => setRecordPage(p => p + 1)}>다음 검토 판</button></div>
      </section>
      {withdrawId && <section aria-label="검토 철회" className="rounded-xl border cd-border-c p-4 space-y-3"><CdTextarea label="검토 철회 사유" aria-label="검토 철회 사유" value={withdrawReason} maxLength={2000} onChange={e => { setWithdrawReason(e.target.value); withdrawalRequest.current = null; }} disabled={disabled} /><button className="cd-btn cd-btn-primary" disabled={disabled || !withdrawReason.trim()} onClick={() => void withdraw()}>사유를 확인하고 철회 판 보관</button></section>}
      <section aria-label="새 검토 후보" className="space-y-3"><h3 className="font-semibold">새 검토 후보</h3><p className="text-xs cd-text-muted">후보 {workspace.candidateTotal}쌍 · 같은 공급자라는 이유만으로 별개 거래나 중복 공제로 확정하지 않습니다.</p><CdInput label="현재 페이지 후보 검색" aria-label="현재 페이지 후보 검색" placeholder="거래처·일자·공식 식별자" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="overflow-x-auto"><table className="w-full min-w-[740px] text-sm"><thead><tr>{["카드 / 계산서", "과거 근거·식별자", "과거 기공제 / 당기 가능", "검토"].map(t => <th key={t} className="text-left p-3 border-b cd-border-c">{t}</th>)}</tr></thead><tbody>{visibleCandidates.map(c => <tr key={c.pairKey}><td className="p-3 border-b cd-border-c">{c.card.partyName} · 카드 {c.card.date}<br />계산서 {c.invoice.date}</td><td className="p-3 border-b cd-border-c">{c.pastLabel}<p className="text-xs cd-text-muted">{c.officialIdentifiers.join(" · ") || "공식 식별자 미확인"}</p></td><td className="p-3 border-b cd-border-c">{money(c.priorClaimedTax)} / {money(c.currentClaimableTax)}</td><td className="p-3 border-b cd-border-c"><button className="cd-btn cd-btn-ghost cd-btn-sm" aria-label={`${c.pairKey} 검토 작성`} disabled={disabled || !workspace.canCreateReview || !c.canStartReview} onClick={() => begin(c)}>검토 작성</button>{c.issues.map((i, n) => <p key={n} className="text-xs cd-text-muted">{i.message}</p>)}</td></tr>)}</tbody></table></div>
        {!visibleCandidates.length && <p className="text-sm cd-text-muted">현재 페이지에 표시할 후보가 없습니다.</p>}
        <div className="flex items-center gap-3"><button className="cd-btn cd-btn-ghost cd-btn-sm" disabled={loading || busy || page <= 1} onClick={() => setPage(p => p - 1)}>이전 후보</button><span className="text-sm">{page} / {Math.max(1, Math.ceil(workspace.candidateTotal / workspace.candidatePageSize))}쪽</span><button className="cd-btn cd-btn-ghost cd-btn-sm" disabled={loading || busy || page * workspace.candidatePageSize >= workspace.candidateTotal} onClick={() => setPage(p => p + 1)}>다음 후보</button></div>
      </section>
      {!!draftPairs.length && <section aria-label="별개 공급 검토 작성" className="border-t cd-border-c pt-5 space-y-4"><h3 className="font-semibold">{reviewId ? `검토 새 판 작성 · 기준 ${version}판` : "별개 공급 검토 작성"}</h3><p className="text-xs cd-text-muted">같은 공급의 중복 증빙을 별개 거래로 입력하면 안 됩니다. 선행 신고와 실제 공급 증빙을 확인하고, 지원되지 않는 관계는 보류하세요.</p>
        <fieldset disabled={disabled} className="space-y-4 min-w-0"><CdSelect label="별개 공급 검토 상태" aria-label="별개 공급 검토 상태" value={state} onChange={e => { setState(e.target.value as "recorded" | "verified"); invalidate(); }}><option value="recorded">기록됨 · 미검토</option><option value="verified">검토 완료</option></CdSelect>
          {draftPairs.map((row, i) => <div key={`${i}:${row.key}`} className="rounded-xl border cd-border-c p-4 space-y-3"><CdSelect label={`검토 ${i + 1} 거래 쌍`} aria-label={`검토 ${i + 1} 거래 쌍`} value={row.key} onChange={e => { const c = workspace.candidates.find(c => c.pairKey === e.target.value), pair = c && inputPair(c); if (!pair) return; setDraftPairs(rows => rows.map((r, n) => n === i ? { key: c!.pairKey, pair: { ...pair, documentId: r.pair.documentId, reason: r.pair.reason, evidenceLocation: r.pair.evidenceLocation } } : r)); invalidate(); }}>
            {!workspace.candidates.some(c => c.pairKey === row.key && canEditCandidate(c)) && <option value={row.key}>보관판의 거래 쌍 · 최신 근거 재검토 필요</option>}{workspace.candidates.filter(c => canEditCandidate(c) && (!draftPairs.some((r, n) => n !== i && r.key === c.pairKey))).map(c => <option key={c.pairKey} value={c.pairKey}>{c.card.partyName} · 카드 {c.card.date} / 계산서 {c.invoice.date} · 과거 {money(c.priorClaimedTax)} / 당기 {money(c.currentClaimableTax)}</option>)}</CdSelect>
            {workspace.candidates.some(c => c.pairKey === row.key && canEditCandidate(c)) && <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => refreshPair(i, workspace.candidates.find(c => c.pairKey === row.key)!)}>검토 {i + 1} 최신 원천·과거 참조로 다시 불러오기</button>}
            <CdSelect label={`검토 ${i + 1} 증빙`} aria-label={`검토 ${i + 1} 증빙`} value={row.pair.documentId} onChange={e => updatePair(i, { documentId: e.target.value })}><option value="">보관한 원문을 선택하세요</option>{workspace.documents.map(d => <option key={d.documentId} value={d.documentId}>{d.fileName}</option>)}</CdSelect>
            <CdInput label={`검토 ${i + 1} 증빙 확인 위치`} aria-label={`검토 ${i + 1} 증빙 확인 위치`} maxLength={1000} value={row.pair.evidenceLocation} onChange={e => updatePair(i, { evidenceLocation: e.target.value })} placeholder="페이지·항목·공급 일자 등" />
            <CdTextarea label={`검토 ${i + 1} 별개 공급 사유`} aria-label={`검토 ${i + 1} 별개 공급 사유`} rows={2} maxLength={2000} value={row.pair.reason} onChange={e => updatePair(i, { reason: e.target.value })} />
            <button className="cd-btn cd-btn-ghost cd-btn-sm" disabled={draftPairs.length <= 1} onClick={() => { setDraftPairs(rows => rows.filter((_, n) => i !== n)); invalidate(); }}>검토 {i + 1} 제거</button>
          </div>)}
          <div className="flex flex-wrap gap-3"><button className="cd-btn cd-btn-ghost" disabled={!availableAddition || draftPairs.length >= 100} onClick={() => { const pair = availableAddition && inputPair(availableAddition); if (pair) { setDraftPairs(rows => [...rows, { key: availableAddition!.pairKey, pair }]); invalidate(); } }}>현재 페이지의 거래 쌍 추가</button><button className="cd-btn cd-btn-primary" onClick={() => void requestPreview()}>별개 공급 검토 미리보기</button><button className="cd-btn cd-btn-ghost" onClick={resetEditor}>작성 닫기</button></div>
        </fieldset>
        {!workspace.documents.length && <p className="text-sm cd-text-muted">이 주체의 보관 증빙이 없습니다. 신고 근거 또는 접수·납부 화면에서 원문을 보관한 뒤 목록을 다시 조회하세요.</p>}
        {preview && <div aria-label="별개 공급 검토 결과" className="rounded-xl border cd-border-c p-4 space-y-3"><h4 className="font-semibold">{preview.canReview ? "검토 완료로 보관 가능" : "검토 미완료 · 기록 보관만 가능"}</h4>{preview.issues.map((i, n) => <p className="text-sm cd-text-muted" key={n}>{i.message}</p>)}<p className="text-sm">검토 저장의 세액 변경 {money(preview.taxDelta)} · 계산에 적용할 쌍은 저장 후 별도로 선택합니다.</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={disabled || !preview.canReview} onChange={e => setConfirmed(e.target.checked)} />과거 기공제 명세와 당기 공급, 정확한 거래 쌍·증빙·사유를 확인했습니다.</label><button className="cd-btn cd-btn-primary" disabled={disabled || (state === "verified" && (!preview.canReview || !confirmed))} onClick={() => void save()}>{state === "verified" ? "검토 완료 판 보관" : "미검토 판 보관"}</button></div>}
      </section>}
    </>}
  </section>;
}
