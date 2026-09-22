"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FileText, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { CdDateInput, CdInput, CdSelect, CdTextarea, isValidDateString } from "@/components/cdash/CdField";
import type {
  ReviewMoney, SupplyReviewAllocation, SupplyReviewClaim, SupplyReviewDraft,
  SupplyReviewLine, SupplyReviewMember, SupplyReviewPreview, SupplyReviewRecord,
} from "@/lib/finance/supply-review-types";
import type { VatFilingDocument } from "@/lib/finance/vat-filing-documents";
import { SupplyDocumentPanels } from "./SupplyDocumentPanels";
import { SupplySameReviewPanel } from "./SupplySameReviewPanel";
import { SupplyGroupReviewPanel } from "./SupplyGroupReviewPanel";

const API = "/api/finance/supply-reviews";
const DOCUMENTS = "/api/finance/vat-filing-documents";
type Source = { kind: SupplyReviewMember["kind"]; sourceId: string; name: string; date: string | null; supply: number; tax: number; total: number };
type CReference = { revisionId: string; pairLineNo: number; pairKey: string; claimedSupply: number | null; claimedTax: number; historicalKind: string; historicalSourceId: string };
interface Workspace {
  subjects: Array<{ subjectId: string; label: string }>;
  documents: VatFilingDocument[]; sources: Source[]; cReferences: CReference[];
  records: SupplyReviewRecord[]; canManage: boolean; hasMore: boolean;
  sourcesHasMore?: boolean; nextSourceOffset?: number | null;
}
const EMPTY: Workspace = { subjects: [], documents: [], sources: [], cReferences: [], records: [], canManage: false, hasMore: false };
const kindLabel: Record<SupplyReviewMember["kind"], string> = { card: "카드", hometax: "홈택스 계산서", tax_invoice: "앱 발행 계산서" };
const amount = (value: number) => `${value.toLocaleString("ko-KR")}원`;
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const zero = (): ReviewMoney => ({ supply: 0, tax: 0, total: 0 });
const sourceKey = (source: Pick<Source, "kind" | "sourceId">) => JSON.stringify([source.kind, source.sourceId]);
const cKey = (reference: Pick<CReference, "revisionId" | "pairLineNo">) => JSON.stringify([reference.revisionId, reference.pairLineNo]);
const blank = (subjectId: string): SupplyReviewDraft => ({ schemaVersion: "de0-supply-review-v1", subjectId, title: "", reason: "", lines: [], members: [], allocations: [], claims: [] });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const failure = (data: { error?: string; message?: string }, status: number) => data.error || data.message || `요청을 처리하지 못했습니다 (${status}).`;
const statusLabel = (record: SupplyReviewRecord) => record.state === "withdrawn" ? "철회" : record.assessment.status === "needs_information" ? "정보 보완 필요" : "기록";

function Section({ title, hint, children, action }: { title: string; hint: string; children: ReactNode; action?: ReactNode }) {
  return <section className="rounded-2xl border cd-border-c p-4 space-y-4">
    <div className="flex flex-wrap justify-between items-start gap-3"><div><h3 className="font-semibold cd-text">{title}</h3><p className="text-xs cd-text-muted mt-1">{hint}</p></div>{action}</div>
    {children}
  </section>;
}
function Add({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled: boolean }) {
  return <button type="button" className="cd-btn cd-btn-sm inline-flex items-center gap-1" onClick={onClick} disabled={disabled}><Plus size={15} />{children}</button>;
}
function Remove({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return <button type="button" className="cd-btn cd-btn-sm inline-flex items-center gap-1" aria-label={label} onClick={onClick} disabled={disabled}><Trash2 size={14} />삭제</button>;
}
function Money({ value, onChange, disabled, taxOnly = false, taxLocked = false }: { value: ReviewMoney; onChange: (value: ReviewMoney) => void; disabled: boolean; taxOnly?: boolean; taxLocked?: boolean }) {
  return <div className={`grid gap-3 ${taxOnly ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
    {(["supply", "tax", ...(taxOnly ? [] : ["total"])] as Array<keyof ReviewMoney>).map(key => <CdInput key={key} label={{ supply: "공급가액 (원)", tax: "세액 (원)", total: "합계 (원)" }[key]} type="number" step="1" value={value[key]} disabled={disabled || (taxLocked && key === "tax")} onChange={event => onChange({ ...value, [key]: Number(event.target.value) })} />)}
  </div>;
}

/** 기록과 진단만 제공한다. 이 화면에서 작성한 금액은 장부·신고 계산에 적용하지 않는다. */
export function SupplyReviewPanel() {
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY);
  const [subjectId, setSubjectId] = useState("");
  const [draft, setDraft] = useState<SupplyReviewDraft>(() => blank(""));
  const [original, setOriginal] = useState<SupplyReviewRecord | null>(null);
  const [preview, setPreview] = useState<SupplyReviewPreview | null>(null);
  const [history, setHistory] = useState<SupplyReviewRecord[]>([]);
  const [resumeWithdrawn, setResumeWithdrawn] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceChoice, setSourceChoice] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [recordFilter, setRecordFilter] = useState("");
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [sameOpen, setSameOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const epoch = useRef(0), listSequence = useRef(0), inFlight = useRef(false);
  const scope = useRef(subjectId); scope.current = subjectId;
  const pending = useRef<{ payload: string; requestId: string } | null>(null);
  const uploadRequest = useRef<{ file: File; subjectId: string; requestId: string } | null>(null);
  const readOnly = !workspace.canManage || (original?.state === "withdrawn" && !resumeWithdrawn);
  const disabled = busy || loading || !subjectId || readOnly;
  const clearEditor = (subject: string) => {
    epoch.current++; setDraft(blank(subject)); setOriginal(null); setPreview(null); setHistory([]);
    setWithdrawReason(""); setResumeWithdrawn(false); setSourceChoice(""); pending.current = null;
  };
  const change = (next: SupplyReviewDraft) => {
    epoch.current++; setDraft(next); setPreview(null); pending.current = null; setNotice(null);
  };
  const patchLine = (lineId: string, patch: Partial<SupplyReviewLine>) => change({ ...draft, lines: draft.lines.map(row => row.lineId === lineId ? { ...row, ...patch } : row) });
  const patchMember = (memberId: string, patch: Partial<SupplyReviewMember>) => change({ ...draft, members: draft.members.map(row => row.memberId === memberId ? { ...row, ...patch } : row) });
  const patchAllocation = (allocationId: string, patch: Partial<SupplyReviewAllocation>) => change({ ...draft, allocations: draft.allocations.map(row => row.allocationId === allocationId ? { ...row, ...patch } : row) });
  const patchClaim = (claimId: string, patch: Partial<SupplyReviewClaim>) => change({ ...draft, claims: draft.claims.map(row => row.claimId === claimId ? { ...row, ...patch } : row) });
  const load = useCallback(async (subject: string, appendSources = false, offset = 0) => {
    const sequence = ++listSequence.current;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams(); if (subject) params.set("subjectId", subject); if (appendSources) params.set("sourceOffset", String(offset));
      const response = await fetch(`${API}?${params}`, { cache: "no-store" });
      const data = await response.json(); if (!response.ok) throw Error(failure(data, response.status));
      if (sequence !== listSequence.current || scope.current !== subject) return;
      if (!Array.isArray(data.subjects) || !Array.isArray(data.records) || !Array.isArray(data.sources) || typeof data.canManage !== "boolean") throw Error("공급 근거 목록을 확인할 수 없습니다. 다시 조회하세요.");
      setWorkspace(previous => ({ ...EMPTY, ...data, sources: appendSources ? [...new Map([...previous.sources, ...data.sources].map((row: Source) => [sourceKey(row), row])).values()] : data.sources }));
    } catch (cause) { if (sequence === listSequence.current && scope.current === subject) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (sequence === listSequence.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(subjectId); return () => { listSequence.current++; }; }, [load, subjectId]);
  useEffect(() => () => { epoch.current++; }, []);
  const chooseSubject = (next: string) => { scope.current = next; setSubjectId(next); setWorkspace(previous => ({ ...EMPTY, subjects: previous.subjects })); clearEditor(next); setNotice(null); setFile(null); uploadRequest.current = null; };
  const openRecord = async (record: SupplyReviewRecord) => {
    const generation = ++epoch.current;
    setOriginal(record); setDraft(clone(record.draft)); setPreview(null); setHistory([]); setError(null); setNotice(null); setWithdrawReason(""); setResumeWithdrawn(false); pending.current = null;
    try {
      const response = await fetch(`${API}?${new URLSearchParams({ caseId: record.caseId })}`, { cache: "no-store" });
      const data = await response.json(); if (!response.ok) throw Error(failure(data, response.status));
      if (generation === epoch.current) setHistory(Array.isArray(data.history) ? [...data.history].sort((a: SupplyReviewRecord, b: SupplyReviewRecord) => b.version - a.version) : []);
    } catch (cause) { if (generation === epoch.current) setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const post = async (body: object) => {
    const response = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json(); if (!response.ok) throw Error(failure(data, response.status)); return data;
  };
  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const requestPreview = () => void run(async () => {
    if (disabled) return;
    if (draft.lines.some(line => (line.dateFrom && !isValidDateString(line.dateFrom)) || (line.dateTo && !isValidDateString(line.dateTo)))) throw Error("공급 기간을 올바른 날짜로 입력하세요.");
    const generation = epoch.current;
    setPreview(null);
    const result = await post({ action: "preview", caseId: original?.caseId ?? null, draft }) as SupplyReviewPreview;
    if (generation !== epoch.current) return;
    if (!result.previewHash || !result.assessment || result.assessment.canApply !== false || result.assessment.consumptionSupported !== false || result.draft?.subjectId !== subjectId) throw Error("기록 전용 미리보기를 확인할 수 없습니다. 다시 조회하세요.");
    if (original && (result.currentRevisionId !== original.revisionId || result.currentVersion !== original.version)) throw Error("다른 판이 저장되어 있습니다. 목록을 새로 조회하고 최신 기록을 연 뒤 다시 검토하세요. 입력 내용은 유지했습니다.");
    setPreview(result);
  });
  const save = () => void run(async () => {
    if (disabled || !preview) return;
    const body = { action: "save", caseId: preview.caseId, draft: preview.draft, expectedRevisionId: preview.currentRevisionId, expectedVersion: preview.currentVersion, expectedPreviewHash: preview.previewHash };
    const payload = JSON.stringify(body);
    if (pending.current?.payload !== payload) pending.current = { payload, requestId: crypto.randomUUID() };
    const result = await post({ ...body, requestId: pending.current.requestId });
    await load(subjectId); clearEditor(subjectId); setNotice(`${result.replayed ? "이미 저장된" : "새"} 기록 ${result.version}판을 확인했습니다. 전표와 부가세 금액은 바뀌지 않습니다.`);
  });
  const withdraw = () => void run(async () => {
    if (disabled || !original) return;
    if (!withdrawReason.trim()) throw Error("철회 사유를 입력하세요.");
    const body = { action: "withdraw", caseId: original.caseId, expectedRevisionId: original.revisionId, expectedVersion: original.version, reason: withdrawReason.trim() };
    const payload = JSON.stringify(body); if (pending.current?.payload !== payload) pending.current = { payload, requestId: crypto.randomUUID() };
    await post({ ...body, requestId: pending.current.requestId });
    await load(subjectId); clearEditor(subjectId); setNotice("철회 기록을 남겼습니다. 이전 판은 이력에서 확인할 수 있습니다.");
  });
  const upload = () => void run(async () => {
    if (disabled || !file) return;
    if (!file.size || file.size > 10 * 1024 * 1024) throw Error("증빙은 비어 있지 않은 10 MiB 이하 파일이어야 합니다.");
    if (uploadRequest.current?.file !== file || uploadRequest.current?.subjectId !== subjectId) uploadRequest.current = { file, subjectId, requestId: crypto.randomUUID() };
    const body = new FormData(); body.set("subjectId", subjectId); body.set("requestId", uploadRequest.current.requestId); body.set("file", file);
    const response = await fetch(DOCUMENTS, { method: "POST", body }); const data = await response.json();
    if (!response.ok) throw Error(failure(data, response.status));
    setFile(null); uploadRequest.current = null; setPreview(null); await load(subjectId); setNotice("증빙을 보관했습니다. 해당 공급·수정 관계·기공제 항목에서 증빙을 선택하세요.");
  });
  const download = (document: VatFilingDocument) => void run(async () => {
    const response = await fetch(`${DOCUMENTS}?${new URLSearchParams({ subjectId, documentId: document.documentId })}`, { cache: "no-store" });
    if (!response.ok) throw Error(failure(await response.json(), response.status));
    const url = URL.createObjectURL(await response.blob()); const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = document.fileName; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const memberName = (memberId: string) => {
    const row = draft.members.find(member => member.memberId === memberId);
    const source = row && workspace.sources.find(candidate => sourceKey(candidate) === sourceKey(row));
    return row ? `${kindLabel[row.kind]} · ${source?.name || row.sourceId}` : "원천 선택";
  };
  const documentSelect = (value: string | null, onChange: (value: string | null) => void) => <CdSelect label="증빙" value={value ?? ""} disabled={disabled} onChange={event => onChange(event.target.value || null)}><option value="">증빙 미선택</option>{value && !workspace.documents.some(document => document.documentId === value) && <option value={value}>현재 목록에 없는 기존 증빙</option>}{workspace.documents.map(document => <option key={document.documentId} value={document.documentId}>{document.fileName}</option>)}</CdSelect>;
  const lineSelect = (value: string, onChange: (value: string) => void) => <CdSelect label="대상 공급" value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="">공급 선택</option>{draft.lines.map((line, index) => <option key={line.lineId} value={line.lineId}>{index + 1}. {line.description || "내용 미입력"}</option>)}</CdSelect>;
  const memberSelect = (value: string, onChange: (value: string) => void) => <CdSelect label="대상 원천" value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="">원천 선택</option>{draft.members.map(member => <option key={member.memberId} value={member.memberId}>{memberName(member.memberId)}</option>)}</CdSelect>;
  const filteredSources = workspace.sources.filter(source => `${kindLabel[source.kind]} ${source.name} ${source.date ?? ""}`.toLowerCase().includes(sourceFilter.toLowerCase()));
  const addMember = () => {
    const source = workspace.sources.find(row => sourceKey(row) === sourceChoice); if (!source) return;
    if (draft.members.some(row => sourceKey(row) === sourceChoice)) { setError("이미 추가한 원천입니다. 같은 원천은 여러 공급에 나누어 배부할 수 있습니다."); return; }
    change({ ...draft, members: [...draft.members, { memberId: id("member"), kind: source.kind, sourceId: source.sourceId, correction: { isCorrection: false, reason: "", originalApprovalNumber: null, originalMemberId: null, referenceStatus: "not_provided", role: "unknown", documentId: null, evidenceLocation: "" } }] }); setSourceChoice("");
  };
  const shownRecords = workspace.records.filter(record => record.draft.title.toLowerCase().includes(recordFilter.toLowerCase()));

  return <section className="space-y-4" aria-label="공급 근거 기록">
    <div className="rounded-2xl border cd-border-c p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold cd-text text-lg">공급 근거 기록</h2><p className="text-sm cd-text-muted mt-1">실제 공급, 원천 증빙, 수정 관계와 이미 공제한 금액의 근거를 함께 정리합니다.</p></div><span className="cd-pill cd-pill-idle">기록 전용</span></div>
      <p className="text-sm rounded-xl p-3 cd-tint-primary">이 화면의 기록과 미리보기는 전표·결산·부가세 계산을 변경하지 않습니다. 금액 차이와 보완할 정보를 확인하는 단계입니다.</p>
      <div className="flex flex-wrap items-end gap-3"><CdSelect className="min-w-0 flex-1" label="신고 주체" value={subjectId} disabled={busy} onChange={event => chooseSubject(event.target.value)}><option value="">주체 선택</option>{workspace.subjects.map(subject => <option key={subject.subjectId} value={subject.subjectId}>{subject.label}</option>)}</CdSelect><button type="button" className="cd-btn inline-flex items-center gap-1" disabled={busy || loading} onClick={() => void load(subjectId)}><RefreshCw size={15} />새로 조회</button></div>
    </div>
    {error && <p className="rounded-xl border cd-border-c p-3 text-sm cd-error-text" role="alert">{error}</p>}
    {notice && <p className="rounded-xl border cd-border-c p-3 text-sm cd-text" role="status">{notice}</p>}
    {loading && <p className="text-sm cd-text-muted" role="status">자료를 조회하고 있습니다.</p>}
    {!subjectId ? <p className="text-sm cd-text-muted p-4">신고 주체를 선택하면 기존 기록과 원천 자료가 표시됩니다.</p> : <>
      <button type="button" className="cd-btn" aria-expanded={documentsOpen} aria-controls="supply-document-registration" disabled={busy || loading} onClick={() => setDocumentsOpen(value => !value)}>{documentsOpen ? "문서 등록 닫기" : "문서 전체 등록 열기"}</button>
      {documentsOpen && <div id="supply-document-registration"><SupplyDocumentPanels key={subjectId} subjectId={subjectId} canManage={workspace.canManage} /></div>}
        <button type="button" className="cd-btn" aria-expanded={sameOpen} aria-controls="supply-same-verification" disabled={busy || loading} onClick={() => setSameOpen(value => !value)}>{sameOpen ? "동일 공급 확인 닫기" : "동일 공급 확인 열기"}</button>
        {sameOpen && <div id="supply-same-verification"><SupplySameReviewPanel key={subjectId} subjectId={subjectId} canManage={workspace.canManage} /></div>}
        <button type="button" className="cd-btn" aria-expanded={groupOpen} aria-controls="supply-group-verification" disabled={busy || loading} onClick={() => setGroupOpen(value => !value)}>{groupOpen ? "여러 문서 대응 닫기" : "여러 문서 전체 대응 열기"}</button>
        {groupOpen && <div id="supply-group-verification"><SupplyGroupReviewPanel key={subjectId} subjectId={subjectId} canManage={workspace.canManage} /></div>}
      <Section title="저장된 기록" hint="이전 판은 보존됩니다. 수정하려면 최신 기록을 열어 미리보기를 다시 확인하세요." action={<Add disabled={busy || loading || !workspace.canManage} onClick={() => { clearEditor(subjectId); setNotice(null); }}>새 기록</Add>}>
        <CdInput label="기록 제목 찾기" type="search" value={recordFilter} onChange={event => setRecordFilter(event.target.value)} />
        <div className="space-y-2">{shownRecords.map(record => <button key={record.caseId} type="button" disabled={busy} onClick={() => void openRecord(record)} className="w-full rounded-xl border cd-border-c p-3 text-left flex flex-wrap justify-between gap-2"><span className="font-semibold cd-text break-words">{record.draft.title || "제목 없음"}</span><span className="text-xs cd-text-muted">{statusLabel(record)} · {record.version}판 · {new Date(record.createdAt).toLocaleString("ko-KR")}</span></button>)}{!shownRecords.length && <p className="text-sm cd-text-muted">표시할 기록이 없습니다.</p>}</div>
        {workspace.records.length >= 100 && <p className="text-xs cd-text-muted">최근 기록 최대 100건을 표시합니다.</p>}
      </Section>
      {!workspace.canManage && <p className="text-sm cd-text-muted">조회 권한으로 열었습니다. 기록의 작성·수정·철회는 담당자가 진행합니다.</p>}
      <Section title={original ? `${original.version}판 · ${statusLabel(original)}` : "새 공급 기록"} hint="금액과 증빙이 부족한 상태도 기록으로 남길 수 있습니다. 보완 사항은 미리보기에 표시됩니다.">
        <CdInput label="기록 제목" value={draft.title} maxLength={200} disabled={disabled} onChange={event => change({ ...draft, title: event.target.value })} />
        <CdTextarea label="검토 사유와 설명" value={draft.reason} disabled={disabled} onChange={event => change({ ...draft, reason: event.target.value })} />
        {!!history.length && <details><summary className="text-sm cd-text-muted cursor-pointer">판 이력 {history.length}건</summary><div className="space-y-2 mt-3">{history.map(record => <div key={record.revisionId} className="text-sm border cd-border-c rounded-xl p-3"><div className="flex justify-between flex-wrap gap-2"><span>{record.version}판 · {statusLabel(record)}</span><time>{new Date(record.createdAt).toLocaleString("ko-KR")}</time></div><p className="cd-text-muted mt-1">{record.withdrawalReason || record.draft.reason}</p><p className="text-xs cd-text-muted mt-1">공급 {amount(record.assessment.lineTotals.supply)} · 세액 {amount(record.assessment.lineTotals.tax)}</p></div>)}</div></details>}
        {original?.withdrawalReason && <p className="text-sm cd-text-muted">철회 사유: {original.withdrawalReason}</p>}
        {original?.state === "withdrawn" && workspace.canManage && !resumeWithdrawn && <button type="button" className="cd-btn" disabled={busy || loading} onClick={() => { epoch.current++; setResumeWithdrawn(true); setPreview(null); pending.current = null; setNotice("철회 판을 보존하고 같은 기록의 다음 판을 작성합니다. 미리보기 후 저장하세요."); }}>철회 기록 이어 작성</button>}
      </Section>
      <Section title="1. 실제 공급" hint="월 합계 증빙이라도 실제 제공한 공급의 기간과 금액을 나누어 기록하세요. 선급·일부 제공 상태도 표시합니다." action={<Add disabled={disabled} onClick={() => change({ ...draft, lines: [...draft.lines, { lineId: id("line"), description: "", dateFrom: "", dateTo: "", fulfillment: "unknown", documentId: null, evidenceLocation: "", ...zero() }] })}>공급 추가</Add>}>
        {draft.lines.map((line, index) => <fieldset key={line.lineId} className="rounded-xl border cd-border-c p-3 space-y-3"><legend className="px-1 text-sm font-semibold">공급 {index + 1}</legend>
          <CdInput label="공급 내용" value={line.description} disabled={disabled} onChange={event => patchLine(line.lineId, { description: event.target.value })} />
          <div className="grid gap-3 sm:grid-cols-3"><CdDateInput label="공급 시작일" value={line.dateFrom} disabled={disabled} onChange={value => patchLine(line.lineId, { dateFrom: value })} /><CdDateInput label="공급 종료일" value={line.dateTo} disabled={disabled} onChange={value => patchLine(line.lineId, { dateTo: value })} /><CdSelect label="제공 상태" value={line.fulfillment} disabled={disabled} onChange={event => patchLine(line.lineId, { fulfillment: event.target.value as SupplyReviewLine["fulfillment"] })}><option value="unknown">확인 필요</option><option value="completed">제공 완료</option><option value="partial">일부 제공</option><option value="advance">선급</option></CdSelect></div>
          <Money value={line} disabled={disabled} onChange={value => patchLine(line.lineId, value)} />
          <div className="grid gap-3 sm:grid-cols-2">{documentSelect(line.documentId, documentId => patchLine(line.lineId, { documentId }))}<CdInput label="증빙의 확인 위치" placeholder="예: 2쪽 계약 내용, 납품일자" value={line.evidenceLocation} disabled={disabled} onChange={event => patchLine(line.lineId, { evidenceLocation: event.target.value })} /></div>
          <Remove label={`공급 ${index + 1} 삭제`} disabled={disabled} onClick={() => change({ ...draft, lines: draft.lines.filter(row => row.lineId !== line.lineId), allocations: draft.allocations.filter(row => row.lineId !== line.lineId), claims: draft.claims.filter(row => row.lineId !== line.lineId) })} />
        </fieldset>)}{!draft.lines.length && <p className="text-sm cd-text-muted">실제 공급을 추가하세요.</p>}
      </Section>
      <Section title="2. 원천과 수정 관계" hint="카드와 계산서 원본을 선택합니다. 수정 증빙이면 원 승인번호와 수정 사유를 별도로 기록하세요.">
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] items-end"><CdInput label="원천 찾기" value={sourceFilter} disabled={disabled} onChange={event => setSourceFilter(event.target.value)} placeholder="거래처·일자" /><CdSelect label="원천 선택" value={sourceChoice} disabled={disabled} onChange={event => setSourceChoice(event.target.value)}><option value="">선택하세요</option>{filteredSources.map(source => <option key={sourceKey(source)} value={sourceKey(source)}>{kindLabel[source.kind]} · {source.name} · {source.date ?? "일자 없음"} · {amount(source.total)}</option>)}</CdSelect><Add disabled={disabled || !sourceChoice} onClick={addMember}>원천 추가</Add></div>
        {workspace.sourcesHasMore && <button type="button" className="cd-btn cd-btn-sm" disabled={busy || loading} onClick={() => void load(subjectId, true, workspace.nextSourceOffset ?? workspace.sources.length)}>원천 더 불러오기</button>}
        {draft.members.map((member, index) => <fieldset key={member.memberId} className="rounded-xl border cd-border-c p-3 space-y-3"><legend className="px-1 text-sm font-semibold">원천 {index + 1}</legend><p className="text-sm cd-text break-all">{memberName(member.memberId)}</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={member.correction.isCorrection} disabled={disabled} onChange={event => patchMember(member.memberId, { correction: { ...member.correction, isCorrection: event.target.checked } })} />수정 증빙입니다</label>
          {member.correction.isCorrection && <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2"><CdInput label="수정 사유" value={member.correction.reason} disabled={disabled} onChange={event => patchMember(member.memberId, { correction: { ...member.correction, reason: event.target.value } })} /><CdInput label="원 계산서 승인번호" value={member.correction.originalApprovalNumber ?? ""} disabled={disabled} onChange={event => patchMember(member.memberId, { correction: { ...member.correction, originalApprovalNumber: event.target.value || null } })} /></div>
            <div className="grid gap-3 sm:grid-cols-3"><CdSelect label="원 증빙 수집 상태" value={member.correction.referenceStatus} disabled={disabled} onChange={event => patchMember(member.memberId, { correction: { ...member.correction, referenceStatus: event.target.value as SupplyReviewMember["correction"]["referenceStatus"] } })}><option value="not_provided">제시되지 않음</option><option value="not_collected">아직 수집하지 않음</option><option value="unresolved">관계 확인 필요</option><option value="declared">참조 관계 기록</option></CdSelect><CdSelect label="이 기록 안의 원 증빙" value={member.correction.originalMemberId ?? ""} disabled={disabled} onChange={event => patchMember(member.memberId, { correction: { ...member.correction, originalMemberId: event.target.value || null } })}><option value="">미선택</option>{draft.members.filter(row => row.memberId !== member.memberId).map(row => <option key={row.memberId} value={row.memberId}>{memberName(row.memberId)}</option>)}</CdSelect><CdSelect label="수정 증빙의 역할" value={member.correction.role} disabled={disabled} onChange={event => patchMember(member.memberId, { correction: { ...member.correction, role: event.target.value as SupplyReviewMember["correction"]["role"] } })}><option value="unknown">확인 필요</option><option value="reversal">원 증빙 반전</option><option value="replacement">대체 증빙</option><option value="delta">차액 증빙</option></CdSelect></div>
            <div className="grid gap-3 sm:grid-cols-2">{documentSelect(member.correction.documentId, documentId => patchMember(member.memberId, { correction: { ...member.correction, documentId } }))}<CdInput label="수정 관계의 확인 위치" value={member.correction.evidenceLocation} disabled={disabled} onChange={event => patchMember(member.memberId, { correction: { ...member.correction, evidenceLocation: event.target.value } })} /></div>
          </div>}
          <Remove label={`원천 ${index + 1} 삭제`} disabled={disabled} onClick={() => change({ ...draft, members: draft.members.filter(row => row.memberId !== member.memberId).map(row => row.correction.originalMemberId === member.memberId ? { ...row, correction: { ...row.correction, originalMemberId: null, referenceStatus: "unresolved" as const } } : row), allocations: draft.allocations.filter(row => row.memberId !== member.memberId), claims: draft.claims.filter(row => row.memberId !== member.memberId) })} />
        </fieldset>)}
      </Section>
      <Section title="3. 공급별 금액 배부" hint="원천 금액 중 각 공급에 해당하는 부분을 적습니다. 이 배부는 검토 기록이며 장부 연결을 만들지 않습니다." action={<Add disabled={disabled || !draft.lines.length || !draft.members.length} onClick={() => change({ ...draft, allocations: [...draft.allocations, { allocationId: id("allocation"), lineId: draft.lines[0].lineId, memberId: draft.members[0].memberId, ...zero() }] })}>배부 추가</Add>}>
        {draft.allocations.map((allocation, index) => <fieldset key={allocation.allocationId} className="rounded-xl border cd-border-c p-3 space-y-3"><legend className="px-1 text-sm font-semibold">배부 {index + 1}</legend><div className="grid gap-3 sm:grid-cols-2">{memberSelect(allocation.memberId, memberId => patchAllocation(allocation.allocationId, { memberId }))}{lineSelect(allocation.lineId, lineId => patchAllocation(allocation.allocationId, { lineId }))}</div><Money value={allocation} disabled={disabled} onChange={value => patchAllocation(allocation.allocationId, value)} /><Remove label={`배부 ${index + 1} 삭제`} disabled={disabled} onClick={() => change({ ...draft, allocations: draft.allocations.filter(row => row.allocationId !== allocation.allocationId) })} /></fieldset>)}
        {!draft.allocations.length && <p className="text-sm cd-text-muted">공급과 원천을 선택한 뒤 배부 금액을 입력하세요.</p>}
      </Section>
      <Section title="4. 이미 공제한 부분" hint="신고 접수본 등 외부 증빙 또는 기존 후행 검토의 실제 반영 쌍을 참조합니다. 기록한 잔액은 추가 공제로 계산하지 않습니다." action={<Add disabled={disabled || !draft.lines.length || !draft.members.length} onClick={() => change({ ...draft, claims: [...draft.claims, { claimId: id("claim"), lineId: draft.lines[0].lineId, memberId: draft.members[0].memberId, origin: "external", reference: "", claimedSupply: 0, claimedTax: 0, coverage: "unknown", documentId: null, evidenceLocation: "", cReference: null }] })}>기공제 근거 추가</Add>}>
        {draft.claims.map((claim, index) => <fieldset key={claim.claimId} className="rounded-xl border cd-border-c p-3 space-y-3"><legend className="px-1 text-sm font-semibold">기공제 근거 {index + 1}</legend><div className="grid gap-3 sm:grid-cols-2">{memberSelect(claim.memberId, memberId => patchClaim(claim.claimId, { memberId }))}{lineSelect(claim.lineId, lineId => patchClaim(claim.claimId, { lineId }))}</div>
          <div className="grid gap-3 sm:grid-cols-2"><CdSelect label="기공제 근거 종류" value={claim.origin} disabled={disabled} onChange={event => patchClaim(claim.claimId, { origin: event.target.value as SupplyReviewClaim["origin"], cReference: null })}><option value="external">외부 신고 증빙</option><option value="c_consumption">기존 후행 검토 반영 쌍</option></CdSelect><CdSelect label="포함 범위" value={claim.coverage} disabled={disabled} onChange={event => patchClaim(claim.claimId, { coverage: event.target.value as SupplyReviewClaim["coverage"] })}><option value="unknown">확인 필요</option><option value="partial">일부 포함</option><option value="exact">해당 부분 일치</option></CdSelect></div>
          {claim.origin === "c_consumption" && <CdSelect label="후행 검토 반영 쌍" value={claim.cReference ? cKey(claim.cReference) : ""} disabled={disabled} onChange={event => { const reference = workspace.cReferences.find(row => cKey(row) === event.target.value); patchClaim(claim.claimId, { cReference: reference ? { revisionId: reference.revisionId, pairLineNo: reference.pairLineNo } : null, ...(reference ? { ...(reference.claimedSupply === null ? {} : { claimedSupply: reference.claimedSupply }), claimedTax: reference.claimedTax } : {}) }); }}><option value="">반영된 쌍을 선택하세요</option>{claim.cReference && !workspace.cReferences.some(reference => cKey(reference) === cKey(claim.cReference!)) && <option value={cKey(claim.cReference)}>현재 목록에서 확인되지 않은 기존 참조</option>}{workspace.cReferences.map(reference => <option key={cKey(reference)} value={cKey(reference)}>{reference.historicalSourceId} · 쌍 {reference.pairLineNo} · 기공제 세액 {amount(reference.claimedTax)} · {reference.revisionId}</option>)}</CdSelect>}
          {claim.origin === "c_consumption" && <p className="text-xs cd-text-muted">기공제 공급가액은 별도로 확인해 입력하세요. 선택한 쌍의 기공제 세액 안에서 이 공급에 해당하는 부분만 기록하며, 공급가액을 세액 비율로 환산하지 않습니다.</p>}
          <Money value={{ supply: claim.claimedSupply, tax: claim.claimedTax, total: 0 }} taxOnly disabled={disabled}  onChange={value => patchClaim(claim.claimId, { claimedSupply: value.supply, claimedTax: value.tax })} />
          <CdInput label="신고·접수 등 참조 번호" value={claim.reference} disabled={disabled} onChange={event => patchClaim(claim.claimId, { reference: event.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2">{documentSelect(claim.documentId, documentId => patchClaim(claim.claimId, { documentId }))}<CdInput label="기공제 부분의 확인 위치" value={claim.evidenceLocation} disabled={disabled} onChange={event => patchClaim(claim.claimId, { evidenceLocation: event.target.value })} /></div><Remove label={`기공제 근거 ${index + 1} 삭제`} disabled={disabled} onClick={() => change({ ...draft, claims: draft.claims.filter(row => row.claimId !== claim.claimId) })} />
        </fieldset>)}{!draft.claims.length && <p className="text-sm cd-text-muted">기공제 근거를 아직 입력하지 않았습니다. 빈 목록이 미공제를 증명하지는 않습니다.</p>}
      </Section>
      <Section title="증빙 보관함" hint="보관한 파일을 위 항목에서 선택하세요. 파일 보관은 내용의 진위나 세무 판단을 확인하는 절차가 아닙니다.">
        <div className="flex flex-wrap items-end gap-3"><CdInput label="증빙 파일 (10 MiB 이하)" type="file" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv,.json" disabled={disabled} onChange={event => { setFile(event.target.files?.[0] ?? null); uploadRequest.current = null; }} /><button type="button" className="cd-btn inline-flex items-center gap-1" disabled={disabled || !file} onClick={upload}><Upload size={15} />증빙 보관</button></div>
        <div className="flex flex-wrap gap-2">{workspace.documents.map(document => <button key={document.documentId} type="button" className="cd-btn cd-btn-sm inline-flex items-center gap-1 max-w-full" disabled={busy} onClick={() => download(document)}><FileText size={14} /><span className="truncate">{document.fileName}</span></button>)}</div>
      </Section>
      <Section title="기록 전 미리보기" hint="미리보기 뒤 입력을 바꾸면 다시 검토해야 합니다. 정보가 부족한 항목도 삭제하지 않고 기록할 수 있습니다.">
        <button type="button" className="cd-btn cd-btn-primary" disabled={disabled} onClick={requestPreview}>기록 미리보기</button>
        {preview && <div className="space-y-3" aria-label="공급 근거 미리보기"><p className="font-semibold cd-text">{preview.assessment.status === "needs_information" ? "정보 보완 필요" : "기록"}</p><div className="grid gap-3 sm:grid-cols-2"><p className="text-sm cd-text">공급가액 {amount(preview.assessment.lineTotals.supply)} · 세액 {amount(preview.assessment.lineTotals.tax)}</p><p className="text-sm cd-text">기공제 기록: 공급가액 {amount(preview.assessment.claimedTotals.supply)} · 세액 {amount(preview.assessment.claimedTotals.tax)}</p></div>
          {!!preview.assessment.memberTotals.length && <div className="space-y-2">{preview.assessment.memberTotals.map(member => <p key={member.memberId} className="text-xs cd-text-muted break-words">{memberName(member.memberId)} — {preview.basis.sources?.find(source => source.memberId === member.memberId)?.found === true ? `원천 ${amount(member.total)} / 배부 ${amount(member.allocated.total)} / 미배부 ${amount(member.remaining.total)}` : "원천 미확인 — 원천 금액과 미배부 금액을 확인할 수 없습니다."}</p>)}</div>}
          {preview.assessment.issues.length ? <ul className="list-disc pl-5 space-y-1 text-sm cd-text-muted">{preview.assessment.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul> : <p className="text-sm cd-text-muted">현재 기록에서 추가 보완 항목이 표시되지 않았습니다. 세무상 공제 여부를 판정한 것은 아닙니다.</p>}
          <p className="text-xs cd-text-muted">추가 공제액을 산출하지 않으며, 저장해도 전표·신고서는 바뀌지 않습니다.</p><button type="button" className="cd-btn cd-btn-primary" disabled={disabled} onClick={save}>근거 기록 저장</button>
        </div>}
      </Section>
      {original && original.state !== "withdrawn" && workspace.canManage && <Section title="기록 철회" hint="이전 기록을 지우지 않고 철회 사유를 새 판으로 남깁니다."><CdTextarea label="철회 사유" value={withdrawReason} disabled={busy || loading} onChange={event => { setWithdrawReason(event.target.value); pending.current = null; }} /><button type="button" className="cd-btn" disabled={disabled || !withdrawReason.trim()} onClick={withdraw}>철회 기록 남기기</button></Section>}
    </>}
  </section>;
}
