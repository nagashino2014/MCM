"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { CdSelect } from "@/components/cdash/CdField";
import { CdHelp } from "@/components/cdash/CdHelp";
import type { SupplyReviewMember, SupplyReviewRecord } from "@/lib/finance/supply-review-types";
import type { SupplyDocumentPreview, SupplyDocumentInput as SupplyDocumentPreviewInput, SupplyDocumentRegisterInput, SupplyDocumentResult as SupplyDocumentRegisterResult } from "@/lib/finance/supply-document-types";

const API = "/api/finance/supply-documents";
const REVIEWS = "/api/finance/supply-reviews";
type Source = { kind: SupplyReviewMember["kind"]; sourceId: string; name: string; date: string | null; supply: number; tax: number; total: number };
type Summary = { date: string | null; direction: string | null; approvalNumber: string | null; supply: number; tax: number; total: number };
type DocumentRow = { documentId: string; portionId: string; version: number; observationCount: number; latestObservation: Summary };
type Observation = { observationId: string; version: number; reviewRevisionId: string; createdAt: string; summary: Summary };
type DocumentList = { documents: DocumentRow[]; canManage: boolean; hasMore: boolean; history?: Observation[]; historyHasMore?: boolean };
type ReviewList = { records: SupplyReviewRecord[]; sources: Source[]; hasMore: boolean; canManage: boolean };
const EMPTY: ReviewList = { records: [], sources: [], hasMore: false, canManage: false };
const kindLabel: Record<SupplyReviewMember["kind"], string> = { card: "카드 승인", hometax: "홈택스 계산서", tax_invoice: "앱 발행 계산서" };
const key = (member: Pick<SupplyReviewMember, "kind" | "sourceId">) => JSON.stringify([member.kind, member.sourceId]);
const won = (value: number) => Number.isSafeInteger(value) ? `${value.toLocaleString("ko-KR")}원` : "금액 확인 필요";
const message = (data: { error?: string; message?: string }, status: number) => data.error || data.message || `요청을 처리하지 못했습니다 (${status}).`;
class ResponseError extends Error { constructor(text: string, readonly status: number) { super(text); } }
async function json(url: string, body?: object) {
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new ResponseError(message(data, response.status), response.status);
  return data;
}
function Amounts({ value }: { value: Summary }) {
  return <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
    {(["supply", "tax", "total"] as const).map(name => <div key={name} className="flex flex-wrap justify-between gap-2 rounded-lg border cd-border-c p-3"><dt className="cd-text-muted">{{ supply: "공급가액", tax: "세액", total: "합계" }[name]}</dt><dd className="font-medium tabular-nums cd-text">{won(value[name])}</dd></div>)}
  </dl>;
}

/** Source identity registration only. No approval, splitting, journal or VAT write action. */
export function SupplyDocumentPanels({ subjectId, canManage: parentCanManage }: { subjectId: string; canManage: boolean }) {
  const [workspace, setWorkspace] = useState<ReviewList>(EMPTY);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [documentsHasMore, setDocumentsHasMore] = useState(false);
  const [listCanManage, setListCanManage] = useState(false);
  const [revisionId, setRevisionId] = useState("");
  const [sourceKey, setSourceKey] = useState("");
  const [preview, setPreview] = useState<SupplyDocumentPreview | null>(null);
  const [result, setResult] = useState<SupplyDocumentRegisterResult | null>(null);
  const [history, setHistory] = useState<{ documentId: string; rows: Observation[]; hasMore: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [healthy, setHealthy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const epoch = useRef(0), listSequence = useRef(0), alive = useRef(true), inFlight = useRef(false);
  const pending = useRef<SupplyDocumentRegisterInput | null>(null);
  const subject = useRef(subjectId); subject.current = subjectId;
  const canManage = parentCanManage && workspace.canManage && listCanManage;
  const latest = [...new Map(workspace.records.filter(record => record.subjectId === subjectId).sort((a, b) => a.version - b.version).map(record => [record.caseId, record])).values()];
  const availableRecords = latest.filter(record => record.state === "recorded");
  const record = availableRecords.find(row => row.revisionId === revisionId);
  const members = record ? [...new Map(record.draft.members.map(member => [key(member), member])).values()] : [];
  const selectedMember = members.find(member => key(member) === sourceKey);
  const input: SupplyDocumentPreviewInput | null = record && selectedMember ? { subjectId, reviewRevisionId: record.revisionId, sourceKind: selectedMember.kind, sourceId: selectedMember.sourceId } : null;

  const discardPreview = () => { epoch.current++; setPreview(null); pending.current = null; setUncertain(false); setNotice(null); setResult(null); };
  const load = useCallback(async () => {
    const sequence = ++listSequence.current, capturedSubject = subjectId;
    setLoading(true); setHealthy(false); setError(null); setPreview(null);
    try {
      const query = new URLSearchParams({ subjectId: capturedSubject });
      const [reviews, list] = await Promise.all([json(`${REVIEWS}?${query}`), json(`${API}?${query}`)]) as [ReviewList, DocumentList];
      if (!Array.isArray(reviews.records) || !Array.isArray(reviews.sources) || !Array.isArray(list.documents) || typeof list.canManage !== "boolean" || typeof reviews.canManage !== "boolean") throw Error("문서 등록 자료를 확인할 수 없습니다. 다시 조회하세요.");
      if (!alive.current || sequence !== listSequence.current || subject.current !== capturedSubject) return false;
      setWorkspace(reviews); setDocuments(list.documents); setDocumentsHasMore(!!list.hasMore); setListCanManage(list.canManage); setHealthy(true); return true;
    } catch (cause) {
      if (alive.current && sequence === listSequence.current && subject.current === capturedSubject) { setError(cause instanceof Error ? cause.message : String(cause)); setHealthy(false); setPreview(null); }
      return false;
    } finally { if (alive.current && sequence === listSequence.current) setLoading(false); }
  }, [subjectId]);
  useEffect(() => { alive.current = true; setWorkspace(EMPTY); setDocuments([]); setRevisionId(""); setSourceKey(""); setPreview(null); setResult(null); setHistory(null); setNotice(null); setUncertain(false); pending.current = null; void load(); return () => { alive.current = false; epoch.current++; listSequence.current++; }; }, [load]);
  const run = async (work: (generation: number) => Promise<void>) => {
    if (inFlight.current) return;
    const generation = epoch.current;
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    try { await work(generation); }
    catch (cause) { if (alive.current && generation === epoch.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  const checkPreview = () => void run(async generation => {
    if (!input || !canManage || !healthy) return;
    pending.current = null; setUncertain(false); setPreview(null); setResult(null);
    const value = await json(API, { action: "preview", ...input }) as SupplyDocumentPreview;
    if (!alive.current || generation !== epoch.current) return;
    if (value.subjectId !== input.subjectId || value.reviewRevisionId !== input.reviewRevisionId || value.source.kind !== input.sourceKind || value.source.id !== input.sourceId || typeof value.canRegister !== "boolean" || !Array.isArray(value.issues) || !Number.isSafeInteger(value.version) || typeof value.previewHash !== "string") throw Error("선택한 원천과 미리보기 결과가 일치하지 않습니다. 자료를 다시 조회하세요.");
    setPreview(value);
  });
  const register = (retry = false) => void run(async generation => {
    if (!canManage || !healthy || !input || !preview?.canRegister) return;
    if (!retry) pending.current = { ...input, expectedPreviewHash: preview.previewHash, expectedVersion: preview.version, requestId: `sdr-${crypto.randomUUID()}` };
    const value = pending.current; if (!value) return;
    try {
      const saved = await json(API, { action: "register", ...value }) as SupplyDocumentRegisterResult;
      if (!alive.current || generation !== epoch.current) return;
      if (typeof saved.documentId !== "string" || typeof saved.portionId !== "string" || !Number.isSafeInteger(saved.version)) throw Error("등록 응답을 확인할 수 없습니다. 같은 요청으로 결과를 다시 확인하세요.");
      pending.current = null; setUncertain(false); setPreview(null); setResult(saved);
      const loaded = await load();
      if (alive.current && generation === epoch.current) setNotice(`${saved.replayed ? "이미 처리된 등록 결과를 확인했습니다." : saved.version === 1 ? "문서 전체를 등록했습니다." : "같은 문서에 원천 관측을 추가했습니다."} ${saved.version}판입니다.${loaded ? "" : " 등록은 완료됐지만 목록을 새로 읽지 못했습니다."}`);
    } catch (cause) {
      if (alive.current && generation === epoch.current) {
        if (cause instanceof ResponseError) { pending.current = null; setUncertain(false); setPreview(null); }
        else setUncertain(true);
      }
      throw cause;
    }
  });
  const openHistory = (documentId: string) => void run(async generation => {
    setHistory(null);
    const list = await json(`${API}?${new URLSearchParams({ subjectId, documentId })}`) as DocumentList;
    if (!alive.current || generation !== epoch.current) return;
    if (!Array.isArray(list.history) || !Array.isArray(list.documents) || !list.documents.some(row => row.documentId === documentId)) throw Error("선택한 문서의 관측 이력을 확인할 수 없습니다.");
    setHistory({ documentId, rows: list.history, hasMore: !!list.historyHasMore });
  });
  const label = (member: SupplyReviewMember) => {
    const source = workspace.sources.find(row => key(row) === key(member));
    const stored = record?.basis.sources?.find(row => row.kind === member.kind && row.sourceId === member.sourceId);
    return `${kindLabel[member.kind]} · ${source?.name || stored?.partyName || member.sourceId}`;
  };

  return <section className="cd-card space-y-4 p-4" aria-label="문서 전체 등록">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="text-base font-semibold cd-text">문서 전체 등록</h3><CdHelp label="문서 전체 등록 도움말"><p>저장된 공급 기록에서 계산서 또는 카드 승인 한 건의 전체를 선택합니다. 같은 문서는 같은 식별자를 유지하며, 다시 확인한 원천은 새 관측으로 남깁니다.</p><p className="mt-2">명세별 분할이나 공급 승인 단계는 제공하지 않습니다. 등록한 금액이 전표나 부가세에 반영되지는 않습니다.</p></CdHelp></div><p className="text-sm cd-text-muted mt-1">원천 문서의 식별과 확인 이력을 보관합니다.</p></div><span className="cd-pill cd-pill-idle">문서 등록 전용</span></div>
    <p className="text-sm cd-text">이 등록은 전표·결산·부가세 계산을 변경하지 않습니다.</p>
        <p className="text-sm cd-text-muted">문서 등록은 현재 거래의 유효성이나 공제 여부 확인을 뜻하지 않습니다.</p>
    <div className="flex flex-wrap justify-between gap-3 items-center"><p className="text-sm cd-text-muted">{loading ? "문서 자료를 조회하고 있습니다." : healthy ? `등록 문서 ${documents.length}건` : "자료를 다시 조회해야 합니다."}</p><button type="button" className="cd-btn cd-btn-sm inline-flex items-center gap-1" disabled={busy || loading} onClick={() => { discardPreview(); setHistory(null); void load(); }}><RefreshCw size={15} />문서 자료 새로 조회</button></div>
    {error && <div role="alert" className="text-sm cd-error-text rounded-lg border cd-border-c p-3">{error}{!uncertain && <p className="mt-1">선택한 기록과 문서는 유지됩니다. 최신 자료로 미리보기를 다시 확인하세요.</p>}</div>}
    {notice && <p role="status" className="text-sm cd-text rounded-lg border cd-border-c p-3">{notice}</p>}
    {result && <dl aria-label="문서 등록 결과" className="text-sm space-y-1"><div><dt className="inline cd-text-muted">문서 관리번호: </dt><dd className="inline">{result.documentId.slice(-8)}</dd></div><div><dt className="inline cd-text-muted">관측 판: </dt><dd className="inline">{result.version}판</dd></div></dl>}
    {canManage ? <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><CdSelect label="등록 근거 기록" value={revisionId} disabled={busy || loading || !healthy || uncertain} onChange={event => { discardPreview(); setRevisionId(event.target.value); setSourceKey(""); }}><option value="">최신 기록 선택</option>{availableRecords.map(row => <option key={row.revisionId} value={row.revisionId}>{row.draft.title || "제목 없음"} · {row.version}판</option>)}</CdSelect><CdSelect label="등록할 원천 문서" value={sourceKey} disabled={busy || loading || !healthy || !record || uncertain} onChange={event => { discardPreview(); setSourceKey(event.target.value); }}><option value="">기록 안의 문서 선택</option>{members.map(member => <option key={key(member)} value={key(member)}>{label(member)}</option>)}</CdSelect></div>
      {healthy && !availableRecords.length && <p className="text-sm cd-text-muted">등록에 사용할 최신 기록이 없습니다. 먼저 공급 근거를 저장하세요. 철회한 기록은 선택할 수 없습니다.</p>}
      {record && !members.length && <p className="text-sm cd-text-muted">이 기록에 원천 문서가 없습니다. 공급 기록에 원천을 추가하고 새 판으로 저장하세요.</p>}
      {workspace.hasMore && <p className="text-sm cd-text-muted">최근 기록 100건에서 선택합니다. 찾는 기록이 없으면 공급 근거 목록을 확인하세요.</p>}
      <button type="button" className={`cd-btn ${preview?.canRegister ? "" : "cd-btn-primary"}`} disabled={busy || loading || !healthy || !input || uncertain} onClick={checkPreview}>문서 등록 미리보기</button>
      {preview && <section aria-label="문서 등록 미리보기 결과" className="space-y-3 rounded-lg border cd-border-c p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold cd-text">{preview.canRegister ? "문서 전체 등록 검토" : "정보 보완 필요"}</h4><span className="cd-pill cd-pill-idle">문서 전체</span></div>
        {preview.observation && <><p className="text-sm cd-text-muted">원천 일자 {preview.observation.date || "확인 필요"}{preview.observation.approvalNumber ? ` · 승인번호 ${preview.observation.approvalNumber}` : ""}</p><Amounts value={preview.observation} /></>}
        <p className="text-sm cd-text-muted">{preview.version > 0 ? `기존 문서의 ${preview.version}판 이후에 새 원천 관측을 남깁니다.` : "새 문서의 첫 관측으로 등록합니다."} 금액은 수집한 원천을 기준으로 표시합니다.</p>

        {!!preview.issues.length && <ul className="list-disc pl-5 text-sm cd-text space-y-1">{preview.issues.map((issue, index) => <li key={`${issue.code}:${index}`}>{issue.message}</li>)}</ul>}
        {preview.canRegister && !uncertain && <button type="button" className="cd-btn cd-btn-primary" disabled={busy || loading || !healthy} onClick={() => register()}>문서 전체 등록</button>}
      </section>}
      {uncertain && <div className="space-y-2 rounded-lg border cd-border-c p-3"><p className="text-sm cd-text">등록 응답이 확인되지 않았습니다. 새 등록을 만들기 전에 같은 요청의 결과를 확인하세요.</p><button type="button" className="cd-btn cd-btn-primary" disabled={busy || loading || !healthy} onClick={() => register(true)}>같은 등록 요청 재확인</button></div>}
    </div> : healthy && <p className="text-sm cd-text-muted">조회 권한으로 열었습니다. 문서 등록은 재무 관리 담당자가 진행합니다.</p>}
    {healthy && <section className="space-y-3" aria-label="등록 문서 목록"><h4 className="text-base font-semibold cd-text">등록된 문서</h4>{documents.length ? <div className="relative overflow-x-auto rounded-lg border cd-border-c"><table className="cd-table w-full text-xs"><thead><tr><th className="text-left">원천 문서</th><th className="text-left">원천 일자</th><th className="text-right">합계</th><th className="text-right">관측</th><th className="text-left">이력</th></tr></thead><tbody>{documents.map(row => <tr key={row.documentId} className="h-11"><td className="min-w-[136px] max-w-[220px] p-3"><span className="block max-w-[196px] truncate" title={row.documentId}>{row.latestObservation.approvalNumber || `관리번호 ${row.documentId.slice(-8)}`}</span><p className="cd-text-muted">문서 전체</p></td><td className="whitespace-nowrap p-3">{row.latestObservation.date || "확인 필요"}</td><td className="text-right tabular-nums whitespace-nowrap p-3">{won(row.latestObservation.total)}</td><td className="text-right whitespace-nowrap p-3">{row.version}판</td><td className="p-3"><button type="button" className="cd-btn cd-btn-sm whitespace-nowrap" aria-label={`${row.documentId} 관측 이력`} disabled={busy || loading} onClick={() => openHistory(row.documentId)}>이력</button></td></tr>)}</tbody></table></div> : <p className="text-sm cd-text-muted">등록된 문서가 없습니다.</p>}{documentsHasMore && <p className="text-sm cd-text-muted">최근 등록 문서를 표시합니다. 전체 목록을 표시한 것은 아닙니다.</p>}</section>}
    {history && healthy && <section aria-label="문서 관측 이력" className="space-y-3 rounded-lg border cd-border-c p-4"><div className="flex flex-wrap justify-between items-center gap-2"><h4 className="text-base font-semibold cd-text">관측 이력</h4><button type="button" className="cd-btn cd-btn-sm" onClick={() => setHistory(null)}>이력 닫기</button></div><details className="text-sm cd-text-muted"><summary className="cursor-pointer">문서 관리 정보</summary><p className="break-all select-all mt-2">{history.documentId}</p></details>{history.rows.map(row => <article key={row.observationId} className="border-t cd-border-c pt-3 space-y-2"><div className="flex flex-wrap justify-between gap-2 text-sm"><span>{row.version}판 · 원천 일자 {row.summary.date || "확인 필요"}</span><time className="cd-text-muted">{new Date(row.createdAt).toLocaleString("ko-KR")}</time></div><Amounts value={row.summary} /></article>)}{history.hasMore && <p className="text-sm cd-text-muted">최근 관측 100건을 표시합니다. 이전 관측은 보존됩니다.</p>}</section>}
  </section>;
}
