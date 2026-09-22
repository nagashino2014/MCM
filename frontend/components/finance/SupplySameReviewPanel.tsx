"use client";
import { readSameConflictDiagnostics, type SameConflictDiagnostics } from "@/lib/finance/supply-same-diagnostics";

import { useCallback, useEffect, useRef, useState } from "react";
import { CdSelect } from "@/components/cdash/CdField";
import { CdHelp } from "@/components/cdash/CdHelp";
import type { SupplyReviewRecord } from "@/lib/finance/supply-review-types";
import type { SupplySameDraft, SupplySamePreview } from "@/lib/finance/supply-same-types";

const API = "/api/finance/supply-same-reviews", DOCUMENTS = "/api/finance/supply-documents", REVIEWS = "/api/finance/supply-reviews";
type Money = { supply: number; tax: number; total: number };
type DocumentRow = { documentId: string; portionId: string; version: number; latestObservation: Money & { date: string; approvalNumber: string | null } };
type Observation = { observationId: string; version: number; reviewRevisionId: string; createdAt: string; summary: Money & { date: string } };
type Evidence = { documentId: string; evidenceHash: string; fileName: string };
type SameRecord = { caseId: string; revisionId: string; previousRevisionId: string | null; version: number; state: "verified_same" | "withdrawn"; draft: SupplySameDraft; preview: SupplySamePreview; createdAt: string; withdrawalReason: string | null; financialUseSupported: false };
type SameList = { records: SameRecord[]; hasMore: boolean; nextCursor: string | null; canManage: boolean };
function checkedList(value: SameList): SameList {
  if (!value || !Array.isArray(value.records) || typeof value.hasMore !== "boolean" || value.hasMore !== (typeof value.nextCursor === "string" && value.nextCursor.length > 0) || !value.hasMore && value.nextCursor !== null) throw Error("확인 이력 페이지를 읽을 수 없습니다.");
  return value;
}
type Workspace = { records: SupplyReviewRecord[]; documents: Evidence[]; canManage: boolean; hasMore: boolean };
type Pending = { action: "verify" | "withdraw"; [key: string]: unknown };
const refBlank = () => ({ documentId: "", portionId: "", observationId: "" });
const blank = (subjectId: string): SupplySameDraft => ({ subjectId, reviewRevisionId: "", left: refBlank(), right: refBlank(), reason: "", evidence: { documentId: "", evidenceHash: "", location: "" } });
const won = (n: number) => Number.isSafeInteger(n) ? `${n.toLocaleString("ko-KR")}원` : "확인 필요";
const normalized = (value: unknown): string => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(normalized).join(",")}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${normalized((value as Record<string, unknown>)[key])}`).join(",")}}`;
class ApiError extends Error { constructor(message: string, readonly status: number, readonly diagnostics: SameConflictDiagnostics | null) { super(message); } }
async function json(url: string, body?: object) {
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const value = await response.json();
  if (!response.ok) {
    const diagnostics = readSameConflictDiagnostics(value, response.status, (body as { action?: string } | undefined)?.action);
    const hasNewCode = value !== null && typeof value === "object" && Object.hasOwn(value, "code");
    const legacyMessage = typeof value?.error === "string" ? value.error : typeof value?.message === "string" ? value.message : `요청 실패 (${response.status})`;
    throw new ApiError(diagnostics?.error || (response.status === 409 && hasNewCode ? "동일 공급 확인 근거를 다시 확인하세요." : legacyMessage), response.status, diagnostics);
  }
  return value;
}
const stateLabel = (state: SameRecord["state"]) => state === "verified_same" ? "동일 공급 확인" : "철회";
function Amounts({ value }: { value: Money }) {
  return <dl className="grid gap-2 text-sm sm:grid-cols-3">{(["supply", "tax", "total"] as const).map(field => <div key={field} className="flex flex-wrap justify-between gap-2 rounded-lg border cd-border-c p-3"><dt className="cd-text-muted">{{ supply: "공급가액", tax: "세액", total: "합계" }[field]}</dt><dd className="tabular-nums cd-text">{won(value[field])}</dd></div>)}</dl>;
}

export function SupplySameReviewPanel({ subjectId, canManage: parentManage }: { subjectId: string; canManage: boolean }) {
  const [draft, setDraft] = useState<SupplySameDraft>(() => blank(subjectId));
  const [workspace, setWorkspace] = useState<Workspace>({ records: [], documents: [], canManage: false, hasMore: false });
  const [records, setRecords] = useState<SameRecord[]>([]), [hasMore, setHasMore] = useState(false);
  const [caseCursor, setCaseCursor] = useState<string | null>(null), [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]), [documentsMore, setDocumentsMore] = useState(false);
  const [observations, setObservations] = useState<{ left: Observation[]; right: Observation[] }>({ left: [], right: [] });
  const [historyMore, setHistoryMore] = useState({ left: false, right: false });
  const [original, setOriginal] = useState<SameRecord | null>(null), [history, setHistory] = useState<SameRecord[]>([]), [caseMore, setCaseMore] = useState(false);
  const [preview, setPreview] = useState<SupplySamePreview | null>(null), [withdrawalReason, setWithdrawalReason] = useState("");
  const [healthy, setHealthy] = useState(false), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [manage, setManage] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorDiagnostics, setErrorDiagnostics] = useState<SameConflictDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null), [uncertain, setUncertain] = useState(false);
  const alive = useRef(true), generation = useRef(0), loadSequence = useRef(0), inFlight = useRef(false), pending = useRef<Pending | null>(null), sideSequence = useRef({ left: 0, right: 0 });
  const caseList = useRef<HTMLElement | null>(null);
  const subject = useRef(subjectId); subject.current = subjectId;
  const canManage = parentManage && manage && workspace.canManage;
  const disabled = busy || loading || !healthy || uncertain;
  const latestReviews = [...new Map([...workspace.records].sort((a, b) => a.version - b.version).map(row => [row.caseId, row])).values()].filter(row => row.state === "recorded");
  // The server returns one latest revision per case in case-created order. Revision numbers are local to each case.
  const latest = records;
  const existingCase = !original && draft.left.portionId && draft.right.portionId ? latest.find(row => normalized([row.draft.left.portionId, row.draft.right.portionId].sort()) === normalized([draft.left.portionId, draft.right.portionId].sort())) : null;
  const caseExists = preview?.issues.some(issue => issue.code === "same_case_exists") || errorDiagnostics?.issues.some(issue => issue.code === "same_case_exists");
  const clearPreview = () => { generation.current++; setErrorDiagnostics(null); setPreview(null); setNotice(null); pending.current = null; setUncertain(false); };
  const change = (update: (value: SupplySameDraft) => SupplySameDraft) => { clearPreview(); setDraft(update); };
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current, captured = subjectId; setLoading(true); setHealthy(false); setError(null); setErrorDiagnostics(null);
    try {
      const query = new URLSearchParams({ subjectId: captured });
      const [list, basis, docs] = await Promise.all([json(`${API}?${query}`), json(`${REVIEWS}?${query}`), json(`${DOCUMENTS}?${query}`)]) as [SameList, Workspace, { documents: DocumentRow[]; hasMore: boolean }];
      checkedList(list);
      if (!Array.isArray(list.records) || !Array.isArray(basis.records) || !Array.isArray(basis.documents) || !Array.isArray(docs.documents) || typeof list.canManage !== "boolean") throw Error("관계 확인 자료를 다시 조회하세요.");
      if (!alive.current || sequence !== loadSequence.current || captured !== subject.current) return false;
      setRecords(list.records); setHasMore(list.hasMore); setCaseCursor(list.nextCursor); setWorkspace(basis); setDocuments(docs.documents); setDocumentsMore(!!docs.hasMore); setManage(list.canManage); setHealthy(true); return true;
    } catch (cause) { if (alive.current && sequence === loadSequence.current) { setError(cause instanceof Error ? cause.message : String(cause)); setHealthy(false); setPreview(null); } return false; }
    finally { if (alive.current && sequence === loadSequence.current) setLoading(false); }
  }, [subjectId]);
  useEffect(() => { alive.current = true; setDraft(blank(subjectId)); setOriginal(null); setHistory([]); setPreview(null); setUncertain(false); setNotice(null); pending.current = null; setObservations({ left: [], right: [] }); void load(); return () => { alive.current = false; generation.current++; loadSequence.current++; sideSequence.current.left++; sideSequence.current.right++; }; }, [subjectId, load]);
  const run = async (work: (epoch: number) => Promise<void>) => {
    if (inFlight.current) return; const epoch = generation.current; inFlight.current = true; setBusy(true); setError(null); setErrorStatus(null); setErrorDiagnostics(null); setNotice(null);
    try { await work(epoch); } catch (cause) { if (alive.current && epoch === generation.current) { setError(cause instanceof Error ? cause.message : String(cause)); setErrorDiagnostics(cause instanceof ApiError ? cause.diagnostics : null); setErrorStatus(cause instanceof ApiError ? cause.status : null); } }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  const loadObservations = async (side: "left" | "right", documentId: string) => {
    const sequence = ++sideSequence.current[side], captured = subjectId;
    setObservations(value => ({ ...value, [side]: [] }));
    if (!documentId) return;
    const list = await json(`${DOCUMENTS}?${new URLSearchParams({ subjectId: captured, documentId })}`);
    if (!Array.isArray(list.history) || !list.documents?.some((row: DocumentRow) => row.documentId === documentId)) throw Error("선택한 문서의 관측을 확인할 수 없습니다.");
    if (!alive.current || sequence !== sideSequence.current[side] || captured !== subject.current) return;
    setObservations(value => ({ ...value, [side]: list.history })); setHistoryMore(value => ({ ...value, [side]: !!list.historyHasMore }));
  };
  const chooseDocument = (side: "left" | "right", documentId: string) => {
    const row = documents.find(item => item.documentId === documentId); change(value => ({ ...value, [side]: { documentId, portionId: row?.portionId || "", observationId: "" } }));
    void run(async () => { await loadObservations(side, documentId); });
  };
  const reset = () => { clearPreview(); setDraft(blank(subjectId)); setOriginal(null); setHistory([]); setWithdrawalReason(""); setObservations({ left: [], right: [] }); setError(null); };
  const openWork = async (caseId: string, preserveDraft: boolean, epoch: number) => {
    setPreview(null); setHistory([]); const list = checkedList(await json(`${API}?${new URLSearchParams({ subjectId, caseId })}`));
    if (!alive.current || epoch !== generation.current) return;
    if (!list.records.length || list.records.some(row => row.caseId !== caseId || row.draft.subjectId !== subjectId || row.financialUseSupported !== false)) throw Error("확인 이력을 읽을 수 없습니다.");
    const sorted = [...list.records].sort((a, b) => b.version - a.version), row = sorted[0];
    if (preserveDraft && normalized([row.draft.left.portionId, row.draft.right.portionId].sort()) !== normalized([draft.left.portionId, draft.right.portionId].sort())) throw Error("작성 중인 문서와 기존 관계를 대조할 수 없습니다.");
    setOriginal(row); if (!preserveDraft) setDraft(structuredClone(row.draft)); setHistory(sorted); setCaseMore(list.hasMore); setHistoryCursor(list.nextCursor); setWithdrawalReason(""); pending.current = null; setUncertain(false);
    const next = preserveDraft ? draft : row.draft;
    await Promise.all([loadObservations("left", next.left.documentId), loadObservations("right", next.right.documentId)]);
  };
  const open = (caseId: string, preserveDraft = false) => void run(epoch => openWork(caseId, preserveDraft, epoch));
  const findExisting = () => void run(async epoch => {
    const params = new URLSearchParams({ view: "resolve", subjectId, kind: "same", portionIds: JSON.stringify([draft.left.portionId, draft.right.portionId].sort()) });
    const value = await json(`/api/finance/vat-same-supply?${params}`);
    if (!alive.current || epoch !== generation.current) return;
    if (!value.record || typeof value.record.caseId !== "string") throw Error("이 문서 조합의 기존 관계를 찾을 수 없습니다. 목록과 원천 문서를 다시 확인하세요.");
    await openWork(value.record.caseId, true, epoch);
  });
  const moreCases = () => void run(async epoch => {
    if (!caseCursor) return;
    const value = checkedList(await json(`${API}?${new URLSearchParams({ subjectId, cursor: caseCursor })}`));
    if (!alive.current || epoch !== generation.current) return;
    setRecords(old => [...old, ...value.records.filter(row => !old.some(item => item.caseId === row.caseId))]); setHasMore(value.hasMore); setCaseCursor(value.nextCursor);
  });
  const moreHistory = () => void run(async epoch => {
    if (!original || !historyCursor) return;
    const value = checkedList(await json(`${API}?${new URLSearchParams({ subjectId, caseId: original.caseId, cursor: historyCursor })}`));
    if (value.records.some(row => row.caseId !== original.caseId || row.draft.subjectId !== subjectId)) throw Error("선택한 관계의 이력이 아닙니다.");
    if (!alive.current || epoch !== generation.current) return;
    setHistory(old => [...old, ...value.records.filter(row => !old.some(item => item.revisionId === row.revisionId))]); setCaseMore(value.hasMore); setHistoryCursor(value.nextCursor);
  });
  const recoverLatest = () => void run(async epoch => {
    if (!original) return;
    const value = checkedList(await json(`${API}?${new URLSearchParams({ subjectId, caseId: original.caseId })}`));
    if (!alive.current || epoch !== generation.current) return;
    const rows = value.records.slice().sort((a, b) => b.version - a.version), row = rows[0];
    if (!row || row.caseId !== original.caseId || normalized([row.draft.left.portionId, row.draft.right.portionId].sort()) !== normalized([draft.left.portionId, draft.right.portionId].sort())) throw Error("최신 사건과 작성 중 문서 조합을 대조할 수 없습니다.");
    setOriginal(row); setHistory(rows); setCaseMore(value.hasMore); setHistoryCursor(value.nextCursor); setPreview(null); pending.current = null; setUncertain(false);
    await Promise.all([loadObservations("left", draft.left.documentId), loadObservations("right", draft.right.documentId)]);
    if (alive.current && epoch === generation.current) setNotice("작성 중 입력은 유지하고 최신 확인판을 불러왔습니다. 최신 상태를 확인한 뒤 확인 또는 철회를 다시 선택하세요.");
  });
  const input = () => ({ draft, caseId: original?.caseId ?? null, expectedVersion: original?.version ?? 0, expectedRevisionId: original?.revisionId ?? null });
  const check = () => void run(async epoch => {
    if (!canManage || !healthy) return; setPreview(null); pending.current = null; setUncertain(false);
    const request = input(), result = await json(API, { action: "preview", ...request }) as SupplySamePreview;
    if (!alive.current || epoch !== generation.current) return;
    if (result.financialUseSupported !== false || result.schemaVersion !== "de1b-whole-preview-v1" || !Array.isArray(result.issues) || !Array.isArray(result.timeDiagnostics) || typeof result.canVerify !== "boolean" || normalized(result.draft) !== normalized(request.draft)) throw Error("입력과 현재 진단을 대조할 수 없습니다. 다시 확인하세요.");
    setPreview(result);
  });
  const save = (action: "verify" | "withdraw", retry = false) => void run(async epoch => {
    if (!canManage || !healthy) return;
    if (!retry) {
      if (action === "verify") { if (!preview?.canVerify) return; pending.current = { action, ...input(), expectedPreviewHash: preview.previewHash, requestId: `ssr-${crypto.randomUUID()}` }; }
      else { if (!original || original.state !== "verified_same" || !withdrawalReason.trim()) return; pending.current = { action, subjectId, caseId: original.caseId, expectedVersion: original.version, expectedRevisionId: original.revisionId, reason: withdrawalReason.trim(), requestId: `ssr-${crypto.randomUUID()}` }; }
    }
    const body = pending.current; if (!body) return;
    try {
      const result = await json(API, body);
      if (!alive.current || epoch !== generation.current) return;
      if (typeof result.caseId !== "string" || typeof result.revisionId !== "string" || !Number.isSafeInteger(result.version) || !["verified_same", "withdrawn"].includes(result.state) || result.financialUseSupported !== false) throw Error("응답을 확인할 수 없습니다. 같은 요청으로 결과를 다시 확인하세요.");
      pending.current = null; setUncertain(false); setPreview(null); setOriginal(null); setHistory([]); setDraft(blank(subjectId)); setObservations({ left: [], right: [] });
      const loaded = await load(); if (alive.current && epoch === generation.current) setNotice(`${result.replayed ? "이미 처리된 결과를 확인했습니다." : result.state === "withdrawn" ? "철회 판을 남겼습니다." : "두 문서 전체의 동일 공급 관계를 확인했습니다."} ${result.version}판이며 전표·부가세에는 반영되지 않습니다.${loaded ? "" : " 저장은 완료됐지만 목록을 읽지 못했습니다."}`);
    } catch (cause) { if (alive.current && epoch === generation.current) { if (cause instanceof ApiError && [400, 403, 404, 409].includes(cause.status)) { pending.current = null; setUncertain(false); setPreview(null); } else setUncertain(true); } throw cause; }
  });
  const download = () => {
    if (!history.length || !healthy) return;
    const blob = new Blob([JSON.stringify({ financialUseSupported: false, historicalRecords: history, hasMore: caseMore }, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = "동일공급_확인기록.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="cd-card space-y-4 p-4" aria-label="문서 전체의 동일 공급 확인">
    <div className="flex flex-wrap justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="text-base font-semibold cd-text">문서 전체의 동일 공급 확인</h3><CdHelp label="동일 공급 확인 도움말"><p>등록된 두 문서의 정확한 관측과 증빙을 대조해 별도 확인판을 남깁니다. 금액이 같다는 사실만으로 같은 공급이 되지는 않습니다.</p><p className="mt-2">문서 일부 분할과 여러 카드의 합산 대응은 지원하지 않습니다. 확인과 철회는 분개·공제·납부에 반영되지 않습니다.</p></CdHelp></div><p className="text-sm cd-text-muted mt-1">두 문서 전체의 관계를 증빙으로 확인합니다.</p></div><span className="cd-pill cd-pill-idle">관계 확인 기록</span></div>
    <p className="text-sm cd-text">문서 등록은 현재 거래의 유효성이나 공제 여부 확인을 뜻하지 않습니다.</p>
    <p className="text-sm cd-text-muted">전체 문서 두 건만 지원합니다. 부분 분할·여러 문서 합산은 별도 검토가 필요합니다.</p>
    <div className="flex flex-wrap gap-2"><button type="button" className="cd-btn cd-btn-sm" disabled={busy || loading || uncertain} onClick={() => { clearPreview(); void load(); }}>확인 자료 새로 조회</button>{canManage && <button type="button" className="cd-btn cd-btn-sm" disabled={disabled} onClick={reset}>새 관계 작성</button>}</div>
    {caseExists && <aside className="space-y-2 rounded-lg border cd-border-c p-3 text-sm cd-text" aria-label="기존 동일 공급 관계 찾기"><p>이미 확인한 관계입니다. 기존 사건의 최신판을 열면 작성 중인 사유와 문서 선택을 유지합니다.</p>{existingCase ? <button type="button" className="cd-btn cd-btn-sm" disabled={disabled} onClick={() => open(existingCase.caseId, true)}>이 문서 조합의 기존 관계 열기</button> : <><button type="button" className="cd-btn cd-btn-sm" disabled={disabled} onClick={findExisting}>이 문서 조합의 기존 관계 찾기</button><button type="button" className="cd-btn cd-btn-sm" disabled={disabled} onClick={() => caseList.current?.scrollIntoView({ block: "start", behavior: "smooth" })}>기존 관계 목록에서 찾기</button></>}</aside>}
    {error && <div role="alert" className="text-sm cd-error-text rounded-lg border cd-border-c p-3">{error}{errorDiagnostics && errorDiagnostics.issues.length > 0 && <ul className="mt-2 list-disc pl-5 space-y-1">{errorDiagnostics.issues.map((issue, index) => <li key={`${issue.code}:${index}`}>{issue.message}</li>)}</ul>}{errorDiagnostics?.issuesTruncated && <p className="mt-2">저장 거절 사유 중 {errorDiagnostics.issues.length}개를 표시합니다(전체 {errorDiagnostics.totalIssueCount}개).</p>}<p className="mt-1">{uncertain ? "저장 결과가 불확실합니다. 아래에서 같은 요청의 결과를 다시 확인하세요." : errorStatus === 403 ? "이 작업 권한이 있는 담당자에게 확인하세요." : errorDiagnostics?.nextAction === "reload_latest" ? "입력은 유지됩니다. 최신 확인판을 불러온 뒤 철회를 다시 선택하세요." : "입력은 유지됩니다. 최신 근거로 미리보기를 다시 확인하세요."}</p>{original && !uncertain && errorStatus !== 403 && <button type="button" className="cd-btn cd-btn-sm mt-2" disabled={busy || loading} onClick={recoverLatest}>입력을 유지하고 최신 확인판 불러오기</button>}</div>}{notice && <p role="status" className="text-sm cd-text">{notice}</p>}
    {!healthy && <p className="text-sm cd-text-muted">{loading ? "확인 자료를 읽고 있습니다." : "자료 조회가 완료되어야 작업할 수 있습니다."}</p>}
    {canManage && healthy ? <div className="space-y-4">
      {original && <p className="text-sm cd-text">{stateLabel(original.state)} {original.version}판 이후로 작성합니다. 문서 조합은 유지하고 최신 근거를 다시 확인합니다.</p>}
      <CdSelect label="공급 근거 기록" value={draft.reviewRevisionId} disabled={disabled} onChange={event => change(value => ({ ...value, reviewRevisionId: event.target.value }))}><option value="">최신 기록 선택</option>{draft.reviewRevisionId && !latestReviews.some(row => row.revisionId === draft.reviewRevisionId) && <option value={draft.reviewRevisionId}>이 관계에 보관된 원천 기록</option>}{latestReviews.map(row => <option key={row.revisionId} value={row.revisionId}>{row.draft.title || "제목 없음"} · {row.version}판</option>)}</CdSelect>
      <div className="grid gap-4 md:grid-cols-2">{(["left", "right"] as const).map((side, index) => <fieldset key={side} className="min-w-0 space-y-3 rounded-lg border cd-border-c p-3"><legend className="px-1 text-sm cd-text">{index + 1}번 문서 전체</legend><CdSelect label={`${index + 1}번 등록 문서`} value={draft[side].documentId} disabled={disabled || !!original} onChange={event => chooseDocument(side, event.target.value)}><option value="">문서 선택</option>{draft[side].documentId && !documents.some(row => row.documentId === draft[side].documentId) && <option value={draft[side].documentId}>이 관계에 보관된 문서</option>}{documents.map(row => <option key={row.documentId} value={row.documentId}>{row.latestObservation.approvalNumber || `관리번호 ${row.documentId.slice(-8)}`} · {row.latestObservation.date} · {won(row.latestObservation.total)}</option>)}</CdSelect><CdSelect label={`${index + 1}번 관측 판`} value={draft[side].observationId} disabled={disabled || !draft[side].documentId} onChange={event => change(value => ({ ...value, [side]: { ...value[side], observationId: event.target.value } }))}><option value="">관측 선택</option>{draft[side].observationId && !observations[side].some(row => row.observationId === draft[side].observationId) && <option value={draft[side].observationId}>이 관계에 보관된 관측</option>}{observations[side].map(row => <option key={row.observationId} value={row.observationId}>{row.version}판 · {row.summary.date} · {won(row.summary.total)}</option>)}</CdSelect>{historyMore[side] && <p className="text-sm cd-text-muted">최근 관측100건만 표시합니다.</p>}</fieldset>)}</div>
      {(workspace.hasMore || documentsMore) && <p className="text-sm cd-text-muted">최근 기록·문서100건에서 선택합니다. 현재 목록은 전체 거래가 아닙니다.</p>}
      <CdSelect label="동일 공급 증빙" value={draft.evidence.documentId} disabled={disabled} onChange={event => { const selected = workspace.documents.find(row => row.documentId === event.target.value); change(value => ({ ...value, evidence: { ...value.evidence, documentId: selected?.documentId || "", evidenceHash: selected?.evidenceHash || "" } })); }}><option value="">보관한 증빙 선택</option>{workspace.documents.map(row => <option key={row.documentId} value={row.documentId}>{row.fileName}</option>)}</CdSelect>
      <p className="text-sm cd-text-muted">새 증빙은 공급 근거 기록의 증빙 보관에서 먼저 올려 주세요.</p>
      <label className="block space-y-1 text-sm cd-text"><span>증빙의 확인 위치</span><input className="cd-input w-full" value={draft.evidence.location} disabled={disabled} maxLength={1000} placeholder="예: 거래명세서 2쪽 전체" onChange={event => change(value => ({ ...value, evidence: { ...value.evidence, location: event.target.value } }))} /></label>
      <label className="block space-y-1 text-sm cd-text"><span>동일 공급 판단 이유</span><textarea aria-label="동일 공급 판단 이유" className="cd-input w-full min-h-24" value={draft.reason} disabled={disabled} maxLength={2000} onChange={event => change(value => ({ ...value, reason: event.target.value }))} /></label>
      <button type="button" className={`cd-btn ${preview?.canVerify ? "" : "cd-btn-primary"}`} disabled={disabled} onClick={check}>현재 근거 다시 확인</button>
      {preview && <section aria-label="현재 근거 진단" className="space-y-3 rounded-lg border cd-border-c p-4"><h4 className="font-semibold cd-text">{preview.canVerify ? "동일 공급 확인 준비" : "정보 보완 필요"}</h4><p className="text-sm cd-text-muted">지금 조회한 근거의 진단입니다. 저장 전 다시 대조하며, 전표·부가세에는 반영하지 않습니다.</p>{preview.left && <div className="space-y-2"><p className="text-sm cd-text">1번 문서</p><Amounts value={preview.left} /></div>}{preview.right && <div className="space-y-2"><p className="text-sm cd-text">2번 문서</p><Amounts value={preview.right} /></div>}{preview.issues.length > 0 && <ul className="list-disc pl-5 text-sm cd-text">{preview.issues.map((issue, index) => <li key={`${issue.code}:${index}`}>{issue.message}</li>)}</ul>}{preview.timeDiagnostics.map((diagnostic, index) => <p key={index} className="text-sm cd-text">승인일시 근거 {index + 1}: {diagnostic.status === "matched" ? "승인일시 일치" : diagnostic.status === "conflict" ? "저장값과 불일치" : "확인 불가"}{!diagnostic.evidenceSufficient ? " · 근거 보완 필요" : ""}</p>)}{preview.canVerify && <button type="button" className="cd-btn cd-btn-primary" disabled={disabled} onClick={() => save("verify")}>증빙과 두 문서를 확인하고 동일 공급으로 기록</button>}</section>}
      {original?.state === "verified_same" && <div className="space-y-2 rounded-lg border cd-border-c p-3"><label className="block space-y-1 text-sm cd-text"><span>철회 이유</span><textarea aria-label="철회 이유" className="cd-input w-full min-h-20" disabled={disabled} value={withdrawalReason} maxLength={2000} onChange={event => setWithdrawalReason(event.target.value)} /></label><p className="text-sm cd-text-muted">확인판을 철회해도 이전 이력은 남습니다. 전표나 부가세를 취소하는 작업은 아닙니다.</p><button type="button" className="cd-btn" disabled={disabled || !withdrawalReason.trim()} onClick={() => save("withdraw")}>관계 확인 철회</button></div>}
      {uncertain && <div className="space-y-2"><p className="text-sm cd-text">저장 응답을 확인하지 못했습니다. 새 요청을 만들지 말고 같은 요청의 결과를 확인하세요.</p><button type="button" className="cd-btn cd-btn-primary" disabled={busy || loading || !healthy} onClick={() => save(pending.current?.action || "verify", true)}>같은 {pending.current?.action === "withdraw" ? "철회" : "확인"} 요청 재확인</button></div>}
    </div> : healthy && <p className="text-sm cd-text-muted">조회 권한으로 확인 이력을 읽습니다. 새 관계 확인과 철회는 관리 담당자가 진행합니다.</p>}
    {healthy && <section ref={caseList} className="space-y-3" aria-label="동일 공급 확인 목록"><h4 className="text-base font-semibold cd-text">관계 확인 이력</h4>{latest.length ? <div className="relative overflow-x-auto rounded-lg border cd-border-c"><table className="cd-table w-full text-xs"><thead><tr><th className="text-left">저장 당시 상태</th><th className="text-left">이유</th><th className="text-left">판</th><th className="text-left">보기</th></tr></thead><tbody>{latest.map(row => <tr key={row.caseId} className="h-11"><td className="p-3 whitespace-nowrap">{stateLabel(row.state)}</td><td className="p-3 min-w-[140px] max-w-[280px]"><span className="block truncate max-w-[260px]">{row.draft.reason}</span></td><td className="p-3 whitespace-nowrap">{row.version}판</td><td className="p-3"><button type="button" className="cd-btn cd-btn-sm whitespace-nowrap" disabled={disabled} onClick={() => open(row.caseId)}>이력 보기</button></td></tr>)}</tbody></table></div> : <p className="text-sm cd-text-muted">아직 관계 확인 이력이 없습니다.</p>}{hasMore && <button type="button" className="cd-btn cd-btn-sm" disabled={disabled} onClick={moreCases}>이전 관계 더 보기</button>}</section>}
    {healthy && history.length > 0 && <section aria-label="저장 당시 확인판" className="space-y-3 rounded-lg border cd-border-c p-4"><div className="flex flex-wrap justify-between gap-2"><h4 className="font-semibold cd-text">저장 당시 확인판</h4><button type="button" className="cd-btn cd-btn-sm" onClick={download}>확인 기록 내려받기</button></div><p className="text-sm cd-text-muted">아래는 당시 보관된 판단입니다. 현재 원천의 유효성이나 금융 적용 가능 여부를 보증하지 않습니다.</p>{history.map(row => <article className="border-t cd-border-c pt-3 space-y-2" key={row.revisionId}><p className="text-sm cd-text">{row.version}판 · {stateLabel(row.state)} · {new Date(row.createdAt).toLocaleString("ko-KR")}</p><p className="text-sm cd-text break-words">{row.state === "withdrawn" ? row.withdrawalReason : row.draft.reason}</p>{row.preview.left && <div className="space-y-1"><p className="text-sm cd-text-muted">당시 1번 문서</p><Amounts value={row.preview.left} /></div>}{row.preview.right && <div className="space-y-1"><p className="text-sm cd-text-muted">당시 2번 문서</p><Amounts value={row.preview.right} /></div>}<p className="text-sm cd-text-muted">이 확인 기록 자체는 금융 작업이 아닙니다. 신고서의 실제 사용 내역은 별도로 확인하세요.</p></article>)}{caseMore && <button type="button" className="cd-btn cd-btn-sm" disabled={disabled} onClick={moreHistory}>이전 확인판 더 보기</button>}</section>}
  </section>;
}
