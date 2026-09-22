"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface RecognitionItem {
  recognitionId: string; name: string; date: string; total: number;
  sourceKind: string; sourceId: string; valid: boolean; reviewVersion: number; expenseAccount: string | null;
}
interface ReviewList {
  items: RecognitionItem[]; subjects: Array<{ subjectId: string; corpNum: string }>;
  permissions: { manage: boolean };
}
interface ReviewDocument { documentId: string; fileName: string; evidenceHash: string }
interface EntryView { lines: Array<{ accountCode: string; debit: number; credit: number }>; total: number }
interface ReviewPreview {
  status: "ready"; recognitionId: string; currentReviewVersion: number; currentAppliedReviewId: string | null;
  currentProjectionHash: string; currentSourceHash: string; previewHash: string; canApply: boolean; noChange: boolean;
  before: EntryView; after: EntryView; references: { documentName: string; subjectCorpNum: string };
  otherIssues: Array<{ code: string; message: string }>;
}
const ENDPOINT = "/api/finance/recognition-reviews";
const amount = (n: number) => Number.isSafeInteger(n) ? `${n.toLocaleString("ko-KR")}원` : "확인 필요";
const businessNumber = (n: string) => /^\d{10}$/.test(n) ? `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}` : "사업자 확인 필요";
const validHash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const validEntry = (v: EntryView) => v && Number.isSafeInteger(v.total) && v.total >= 0 && Array.isArray(v.lines)
  && v.lines.every(l => typeof l.accountCode === "string" && Number.isSafeInteger(l.debit) && l.debit >= 0 && Number.isSafeInteger(l.credit) && l.credit >= 0);

async function responseBody(res: Response) {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(body?.error || body?.message || "자료를 확인하지 못했습니다. 다시 시도하세요."), { status: res.status });
  if (!body) throw new Error("응답을 확인하지 못했습니다. 다시 시도하세요.");
  return body;
}
function EntryTable({ title, data }: { title: string; data: EntryView }) {
  return <div className="min-w-0 overflow-x-auto"><table className="cd-table w-full text-sm">
    <caption className="text-left font-semibold py-3">{title}</caption>
    <thead><tr><th className="text-left">계정</th><th className="text-right">차변</th><th className="text-right">대변</th></tr></thead>
    <tbody>{data.lines.map((line, index) => <tr key={index} className="h-11"><td>{line.accountCode}</td><td className="text-right whitespace-nowrap tabular-nums">{amount(line.debit)}</td><td className="text-right whitespace-nowrap tabular-nums">{amount(line.credit)}</td></tr>)}</tbody>
    <tfoot><tr className="h-11"><th className="text-left">차변 합계</th><td className="text-right whitespace-nowrap tabular-nums">{amount(data.total)}</td><td /></tr></tfoot>
  </table>{!data.lines.length && <p className="text-sm cd-text-muted">표시할 전표 내역이 없습니다.</p>}</div>;
}

export function RecognitionReviewPanel({ from, to, manage, onApplied }: {
  from: string; to: string; manage?: boolean; onApplied: () => void | Promise<void>;
}) {
  const [list, setList] = useState<ReviewList | null>(null);
  const [documents, setDocuments] = useState<ReviewDocument[]>([]);
  const [recognitionId, setRecognitionId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [location, setLocation] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<ReviewPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const epoch = useRef(0), listEpoch = useRef(0), documentEpoch = useRef(0);
  const inFlight = useRef(false);
  const request = useRef<{ payload: string; requestId: string } | null>(null);
  const invalidate = useCallback(() => {
    epoch.current++; inFlight.current = false; request.current = null;
    setPreview(null); setConfirmed(false); setBusy(null); setError(null); setNotice(null);
  }, []);
  const load = useCallback(async () => {
    invalidate(); const current = ++listEpoch.current;
    setLoading(true); setList(null);
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new Error("조회 시작일과 종료일을 확인하세요.");
      const body = await responseBody(await fetch(`${ENDPOINT}?${new URLSearchParams({ from, to })}`, { cache: "no-store" }));
      if (!Array.isArray(body.items) || !Array.isArray(body.subjects) || typeof body.permissions?.manage !== "boolean") throw new Error("인식 목록을 확인할 수 없습니다. 다시 조회하세요.");
      if (current === listEpoch.current) setList(body);
    } catch (e) { if (current === listEpoch.current) setError(e instanceof Error ? e.message : "목록 조회에 실패했습니다."); }
    finally { if (current === listEpoch.current) setLoading(false); }
  }, [from, to, invalidate]);
  useEffect(() => {
    setRecognitionId(""); setSubjectId(""); setDocumentId(""); setDocuments([]); setLocation(""); setReason("");
    void load();
    return () => { listEpoch.current++; documentEpoch.current++; epoch.current++; inFlight.current = false; };
  }, [load]);
  useEffect(() => { if (manage === false) invalidate(); }, [manage, invalidate]);
  useEffect(() => {
    const current = ++documentEpoch.current;
    setDocumentId(""); setDocuments([]); setDocumentsLoading(!!subjectId);
    if (!subjectId) return;
    void (async () => {
      try {
        const body = await responseBody(await fetch(`${ENDPOINT}?${new URLSearchParams({ subjectId })}`, { cache: "no-store" }));
        if (!Array.isArray(body.documents) || !body.documents.every((d: ReviewDocument) => typeof d.documentId === "string" && typeof d.fileName === "string" && validHash(d.evidenceHash))) throw new Error("보관 문서를 확인할 수 없습니다.");
        if (current === documentEpoch.current) setDocuments(body.documents);
      } catch (e) { if (current === documentEpoch.current) setError(e instanceof Error ? e.message : "증빙 조회에 실패했습니다."); }
      finally { if (current === documentEpoch.current) setDocumentsLoading(false); }
    })();
    return () => { documentEpoch.current++; };
  }, [subjectId]);

  const selected = list?.items.find(i => i.recognitionId === recognitionId);
  const canManage = !!list?.permissions.manage && manage !== false;
  const hasInput = !!selected && !!list?.subjects.some(s => s.subjectId === subjectId) && documents.some(d => d.documentId === documentId) && !!location.trim() && !!reason.trim();
  const input = { recognitionId, subjectId, evidenceDocumentId: documentId, evidenceLocation: location.trim(), reason: reason.trim() };
  const getPreview = async () => {
    if (!canManage || !hasInput || inFlight.current || loading || documentsLoading) return;
    invalidate(); const current = epoch.current; inFlight.current = true; setBusy("preview");
    try {
      const body: ReviewPreview = await responseBody(await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", ...input }) }));
      if (current !== epoch.current) return;
      if (body.status !== "ready" || body.recognitionId !== recognitionId || !Number.isSafeInteger(body.currentReviewVersion) || body.currentReviewVersion < 0
        || !(body.currentAppliedReviewId === null || typeof body.currentAppliedReviewId === "string") || ![body.currentProjectionHash, body.currentSourceHash, body.previewHash].every(validHash)
        || typeof body.canApply !== "boolean" || typeof body.noChange !== "boolean" || !validEntry(body.before) || !validEntry(body.after)
        || typeof body.references?.documentName !== "string" || typeof body.references?.subjectCorpNum !== "string" || !Array.isArray(body.otherIssues)
        || !body.otherIssues.every(i => typeof i.code === "string" && typeof i.message === "string")) throw new Error("변경 전후 자료를 확인하지 못했습니다. 다시 미리보기 하세요.");
      setPreview(body);
    } catch (e) { if (current === epoch.current) setError(e instanceof Error ? e.message : "미리보기에 실패했습니다."); }
    finally { if (current === epoch.current) { inFlight.current = false; setBusy(null); } }
  };
  const apply = async () => {
    if (!canManage || !preview?.canApply || preview.noChange || !confirmed || !hasInput || inFlight.current) return;
    const current = epoch.current;
    const payload = { action: "apply", ...input, expectedReviewVersion: preview.currentReviewVersion, expectedAppliedReviewId: preview.currentAppliedReviewId,
      expectedProjectionHash: preview.currentProjectionHash, expectedSourceHash: preview.currentSourceHash, expectedPreviewHash: preview.previewHash, reviewConfirmed: true };
    const key = JSON.stringify(payload);
    if (request.current?.payload !== key) request.current = { payload: key, requestId: globalThis.crypto.randomUUID() };
    inFlight.current = true; setBusy("apply"); setError(null); setNotice(null);
    try {
      const body = await responseBody(await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, requestId: request.current.requestId }) }));
      if (current !== epoch.current) return;
      if (body.status !== "restored" || body.recognitionId !== recognitionId || !Number.isSafeInteger(body.reviewVersion)) throw new Error("처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 시도하세요.");
      setPreview(null); setConfirmed(false); request.current = null;
      setList(previous => previous && ({ ...previous, items: previous.items.map(item => item.recognitionId === recognitionId ? { ...item, reviewVersion: body.reviewVersion, valid: true } : item) }));
      setNotice(`검토 ${body.reviewVersion}판을 반영하고 대상 전표를 갱신했습니다.`);
      try { await onApplied(); } catch { if (current === epoch.current) setError("반영은 완료했지만 연결 목록을 새로 불러오지 못했습니다. 목록을 다시 조회하세요."); }
    } catch (e) {
      if (current !== epoch.current) return;
      const status = (e as { status?: number }).status;
      if (status === 409 || status === 403) { setPreview(null); setConfirmed(false); request.current = null; }
      setError(`${e instanceof Error ? e.message : "반영에 실패했습니다."}${status === 409 ? " 입력은 유지됩니다. 최신 자료로 다시 미리보기 하세요." : ""}`);
    } finally { if (current === epoch.current) { inFlight.current = false; setBusy(null); } }
  };

  return <section className="cd-card p-4 space-y-4" aria-label="매입 인식 재검토">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="cd-card-title">매입 인식 재검토</h2><button type="button" className="cd-btn cd-btn-ghost" onClick={() => void load()} disabled={!!busy || loading}>인식 목록 다시 조회</button></div>
    <p className="text-sm cd-text-muted">지급 연결이 없는 양수 매입계산서의 기존 인식과 미확정 전표를 증빙으로 다시 확인합니다. {from} ~ {to}</p>
    {loading && <p role="status" className="text-sm">인식 목록을 불러오는 중…</p>}
    {error && <p role="alert" className="text-sm cd-error-text break-words">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {list && !canManage && <p className="text-sm">조회 전용입니다. 미리보기와 반영에는 재무 관리 권한이 필요합니다.</p>}
    {list && !list.items.length && <p className="text-sm cd-text-muted">이 기간에 등록된 인식이 없습니다. 원본 인식이 없는 거래는 여기에서 새로 만들 수 없습니다.</p>}
    <label className="block text-sm">재검토할 매입 인식<select aria-label="재검토할 매입 인식" className="cd-select block w-full mt-1" value={recognitionId} disabled={loading || busy === "apply"} onChange={e => { invalidate(); setRecognitionId(e.target.value); }}><option value="">거래를 선택하세요</option>{list?.items.map(i => <option key={i.recognitionId} value={i.recognitionId}>{i.name || "거래처 미상"} · {i.date} · {amount(i.total)} · {i.valid ? "인식 유효" : "재검토 필요"}</option>)}</select></label>
    {selected && <p className="text-sm cd-text-muted">현재 검토 {selected.reviewVersion}판 · 비용 계정 {selected.expenseAccount || "미지정"}. 취소·음수·지급 연결·확정 자료 등은 반영할 수 있는지 별도 확인합니다.</p>}
    <div className="grid gap-4 md:grid-cols-2">
      <label className="block text-sm">검토 사업자<select aria-label="검토 사업자" className="cd-select block w-full mt-1" value={subjectId} disabled={loading || busy === "apply"} onChange={e => { invalidate(); setSubjectId(e.target.value); }}><option value="">사업자를 선택하세요</option>{list?.subjects.map(s => <option key={s.subjectId} value={s.subjectId}>{businessNumber(s.corpNum)}</option>)}</select></label>
      <label className="block text-sm">보관 증빙<select aria-label="보관 증빙" className="cd-select block w-full mt-1" value={documentId} disabled={!subjectId || documentsLoading || busy === "apply"} onChange={e => { invalidate(); setDocumentId(e.target.value); }}><option value="">{documentsLoading ? "문서를 불러오는 중…" : "문서를 선택하세요"}</option>{documents.map(d => <option key={d.documentId} value={d.documentId}>{d.fileName}</option>)}</select></label>
    </div>
    <p className="text-sm cd-text-muted">새 증빙은 신고 근거 관리에서 먼저 보관하세요.{subjectId && !documentsLoading && !documents.length ? " 선택한 사업자의 보관 문서가 없습니다." : ""}</p>
    <div className="grid gap-4 md:grid-cols-2">
      <label className="block text-sm">증빙 확인 위치<input aria-label="증빙 확인 위치" className="cd-input block w-full mt-1" value={location} maxLength={500} disabled={!canManage || busy === "apply"} onChange={e => { invalidate(); setLocation(e.target.value); }} placeholder="계산서·명세의 쪽과 항목" /></label>
      <label className="block text-sm">재검토 사유<textarea aria-label="재검토 사유" className="cd-input block w-full mt-1" value={reason} rows={3} maxLength={2000} disabled={!canManage || busy === "apply"} onChange={e => { invalidate(); setReason(e.target.value); }} /></label>
    </div>
    <button type="button" className="cd-btn cd-btn-primary" disabled={!canManage || !hasInput || !!busy || loading || documentsLoading} onClick={() => void getPreview()}>{busy === "preview" ? "변경 내용 확인 중…" : "변경 전후 미리보기"}</button>
    {preview && <div className="space-y-4 border-t border-[var(--cd-border)] pt-4" aria-label="인식 재검토 미리보기">
      <p className="text-sm">증빙: {preview.references.documentName} · 사업자 {businessNumber(preview.references.subjectCorpNum)}</p>
      <div className="grid gap-4 md:grid-cols-2"><EntryTable title="반영 전" data={preview.before} /><EntryTable title="반영 후" data={preview.after} /></div>
      {preview.otherIssues.length > 0 && <ul className="text-sm space-y-2" aria-label="추가 확인 사항">{preview.otherIssues.map((i, n) => <li key={n}>{i.message}</li>)}</ul>}
      {preview.noChange ? <p className="text-sm">반영할 변경 사항이 없습니다.</p> : !preview.canApply ? <p role="alert" className="text-sm cd-error-text">현재 자료에는 반영할 수 없습니다. 표시된 사유를 확인하세요.</p> : <>
        <p className="text-sm">반영하면 새 검토 이력과 대상 미확정 전표가 함께 갱신됩니다. 다른 거래의 확인 사항은 별도로 남습니다.</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} disabled={!canManage || !!busy} onChange={e => setConfirmed(e.target.checked)} />증빙과 변경 전후 전표를 확인했습니다.</label>
        <button type="button" className="cd-btn cd-btn-primary" disabled={!canManage || !confirmed || !!busy} onClick={() => void apply()}>{busy === "apply" ? "반영 중…" : "검토 결과 반영"}</button>
      </>}
    </div>}
  </section>;
}
