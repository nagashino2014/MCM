"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, History, RefreshCw, Upload } from "lucide-react";
import { CdDateInput, CdInput, CdSelect, CdTextarea, isValidDateString } from "@/components/cdash/CdField";
import type { VatPostEventInput, VatPostEventRecord, VatPostKind, VatPostOverview, VatPostPreview, VatPostPreviewInput, VatPostState, VatPostTarget, VatPostTargetRef } from "@/lib/finance/vat-filing-post-types";

const ENDPOINT = "/api/finance/vat-filing-post-events";
const DOCUMENTS = "/api/finance/vat-filing-documents";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const labels: Record<string, string> = { receipt: "신고 접수", payment: "실제 납부", reconciliation: "납부 내역 대사", other: "상계·환급 등", recorded: "기록됨", verified: "검토 완료", withdrawn: "철회", unreviewed: "미검토", matched: "입력 금액 대사 일치", mismatch: "차이 있음", unsupported: "별도 확인 필요", offset: "상계", refund: "환급" };
const money = (n: number | null | undefined) => n === null || n === undefined ? "미확인" : `${n.toLocaleString("ko-KR")}원`;
const targetKey = (t: VatPostTargetRef) => `${t.kind}:${t.id}`;
const targetLabel = (t: VatPostTarget) => `${t.year}년 ${t.term}기 ${t.kind === "notice" ? "예정고지" : `${t.periodKind === "preliminary" ? "예정" : "확정"} · 앱 확정판`} · 보관 ${t.id.slice(-6)}`;
const errorMessage = (b: { error?: unknown; message?: unknown }, status: number) => {
  const detail = typeof b.error === "string" ? b.error : typeof b.message === "string" ? b.message : "";
  const guidance = status === 503 ? "저장된 신고·소비 근거를 검증할 수 없습니다. 다시 조회하고, 계속되면 담당자에게 보관 원문과 필수 저장 구조 확인을 요청하세요."
    : status === 409 ? "다른 기록이나 근거와 충돌합니다. 현재 기록을 다시 조회한 뒤 입력 내용을 재검토하세요."
      : status === 404 ? "선택한 자료를 찾을 수 없습니다. 목록을 다시 조회하세요."
        : status === 403 ? "이 작업의 권한을 확인할 수 없습니다. 담당자에게 접근 권한을 확인하세요." : "";
  return [detail, guidance].filter(Boolean).join(" ") || `요청을 처리하지 못했습니다. (${status})`;
};
interface DocumentInfo { documentId: string; subjectId: string; fileName: string; sizeBytes: number; createdAt: string }
interface Overview extends VatPostOverview { permissions: { manage: boolean } }
interface Form {
  kind: VatPostKind; state: VatPostState; officialKey: string; evidenceDocumentId: string; occurredAt: string; reason: string; sharedB1FactId: string;
  target: string; declaredTax: string; actualTotal: string; additionalCharges: string; otherAmount: string; unallocatedAmount: string;
  allocations: Array<{ target: string; amount: string }>; throughDate: string; observedPaidTotal: string; category: "offset" | "refund" | "other"; otherTotal: string;
}
const emptyForm = (): Form => ({ kind: "receipt", state: "recorded", officialKey: "", evidenceDocumentId: "", occurredAt: "", reason: "", sharedB1FactId: "", target: "", declaredTax: "", actualTotal: "", additionalCharges: "0", otherAmount: "0", unallocatedAmount: "0", allocations: [], throughDate: "", observedPaidTotal: "", category: "offset", otherTotal: "" });
const numberText = (v: number | null | undefined) => v === null || v === undefined ? "" : String(v);
function amount(text: string, label: string, nullable = false, signed = false): number | null {
  if (nullable && !text.trim()) return null;
  if (!/^-?\d+$/.test(text.trim()) || !Number.isSafeInteger(Number(text)) || (!signed && Number(text) < 0)) throw new Error(`${label}: ${signed ? "" : "0 이상의 "}원 단위 정수를 입력하세요.`);
  return Number(text);
}
function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section aria-label={title} className="cd-card p-5 sm:p-6 space-y-4"><header><h2 className="cd-card-title">{title}</h2>{hint && <p className="text-xs cd-text-muted mt-2 leading-relaxed">{hint}</p>}</header>{children}</section>;
}
function AmountField({ label, value, onChange, nullable = false, disabled = false }: { label: string; value: string; onChange: (s: string) => void; nullable?: boolean; disabled?: boolean }) {
  return <CdInput label={label} aria-label={label} inputMode="numeric" value={value} disabled={disabled} onChange={e => onChange(e.target.value)} placeholder={nullable ? "미확인이면 비워두세요" : "원 단위 정수"} />;
}
function formFromRecord(record: VatPostEventRecord): Form {
  const e = record.event, p = e.payment, r = e.receipt, c = e.reconciliation, o = e.other;
  return { ...emptyForm(), kind: e.kind, state: e.state, officialKey: e.officialKey ?? "", evidenceDocumentId: e.evidenceDocumentId, occurredAt: e.occurredAt, reason: e.reason, sharedB1FactId: e.sharedB1FactId ?? "", target: r ? targetKey(r.target) : c ? targetKey(c.target) : o?.target ? targetKey(o.target) : "", declaredTax: numberText(r?.declaredTax), actualTotal: numberText(p?.actualTotal), additionalCharges: numberText(p?.additionalCharges ?? 0), otherAmount: numberText(p?.otherAmount ?? 0), unallocatedAmount: numberText(p?.unallocatedAmount ?? 0), allocations: p?.allocations.map(a => ({ target: targetKey(a.target), amount: String(a.amount) })) ?? [], throughDate: c?.throughDate ?? "", observedPaidTotal: numberText(c?.observedPaidTotal), category: o?.category ?? "offset", otherTotal: numberText(o?.amount) };
}
function EventAmounts({ event, targets }: { event: VatPostEventInput; targets: VatPostTarget[] }) {
  const name = (ref: VatPostTargetRef) => { const t = targets.find(t => targetKey(t) === targetKey(ref)); return t ? targetLabel(t) : `${ref.kind === "notice" ? "고지" : "확정판"} · ${ref.id}`; };
  return <div className="text-sm space-y-2" aria-label="기록 금액·대상 상세">
    {event.receipt && <><p>접수 대상: {name(event.receipt.target)}</p><p>접수 문서 신고세액: {money(event.receipt.declaredTax)}</p></>}
    {event.payment && <><p>실제 납부 총액: {money(event.payment.actualTotal)}</p><p>추가 가산금액 {money(event.payment.additionalCharges)} · 기타 {money(event.payment.otherAmount)} · 미배부 {money(event.payment.unallocatedAmount)}</p>{event.payment.allocations.map(a => <p key={targetKey(a.target)}>배부: {name(a.target)} · {money(a.amount)}</p>)}{!event.payment.allocations.length && <p>대상 배부 없음</p>}{event.payment.actualTotal === 0 && !event.payment.allocations.length && <p role="note" className="cd-text-muted">0원·배부 없는 기록입니다. 입력 금액이 일치해도 세금 납부 완료를 뜻하지 않습니다.</p>}</>}
    {event.reconciliation && <><p>대사 대상: {name(event.reconciliation.target)}</p><p>기준일 {event.reconciliation.throughDate} · 확인한 납부 누계 {money(event.reconciliation.observedPaidTotal)}</p></>}
    {event.other && <><p>{labels[event.other.category] ?? "기타"} 원문 금액: {money(event.other.amount)}</p><p>{event.other.target ? `대상: ${name(event.other.target)}` : "연결 대상 없음"}</p></>}
  </div>;
}

export function VatFilingPostPanel() {
  const [subjectId, setSubjectId] = useState("");
  const [subjects, setSubjects] = useState<Array<{ subjectId: string; corpNum?: string }>>([]);
  const [overview, setOverview] = useState<Overview | null>(null), [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [needsReload, setNeedsReload] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(emptyForm), [eventId, setEventId] = useState(""), [baseVersion, setBaseVersion] = useState(0);
  const [viewedRevision, setViewedRevision] = useState(""), [preview, setPreview] = useState<VatPostPreview | null>(null), [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const contextRef = useRef(subjectId); contextRef.current = subjectId;
  const sequence = useRef(0), controller = useRef<AbortController | null>(null), editSequence = useRef(0), inFlight = useRef(false);
  const previewRequest = useRef<{ payload: string; body: VatPostPreviewInput } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null), uploadRequest = useRef<{ subjectId: string; file: File; requestId: string } | null>(null);
  const canManage = overview?.permissions.manage === true, locked = loading || busy || !canManage || !subjectId;
  const targets = overview?.targets ?? [];
  const targetMap = useMemo(() => new Map(targets.map(t => [targetKey(t), t])), [targets]);
  const latest = useMemo(() => {
    const rows = new Map<string, VatPostEventRecord>();
    for (const r of overview?.events ?? []) if (!rows.has(r.eventId) || rows.get(r.eventId)!.version < r.version) rows.set(r.eventId, r);
    return [...rows.values()];
  }, [overview]);
  const viewed = overview?.events.find(e => e.revisionId === viewedRevision);
  const editorStale = !!eventId && latest.some(r => r.eventId === eventId && r.version !== baseVersion);
  const selectedTarget = targetMap.get(form.target);

  const invalidate = () => { editSequence.current++; setPreview(null); setReviewConfirmed(false); previewRequest.current = null; };
  const update = <K extends keyof Form>(key: K, value: Form[K]) => { setForm(f => ({ ...f, [key]: value })); invalidate(); };
  const resetEditor = () => { setForm(emptyForm()); setEventId(""); setBaseVersion(0); setViewedRevision(""); invalidate(); setNotice(null); };
  const load = useCallback(async () => {
    const seq = ++sequence.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setLoading(true); setError(null); setReviewConfirmed(false); setPreview(null); editSequence.current++; previewRequest.current = null;
    try {
      const response = await fetch(`${ENDPOINT}?${new URLSearchParams({ view: "overview", ...(subjectId ? { subjectId } : {}) })}`, { signal: abort.signal, cache: "no-store" });
      const data = await response.json(); if (!response.ok) throw new Error(errorMessage(data, response.status));
      if (!Array.isArray(data.subjects) || !Array.isArray(data.targets) || !Array.isArray(data.events) || !Array.isArray(data.issues) || typeof data.permissions?.manage !== "boolean" || (subjectId && data.subjectId !== subjectId) || data.targets.some((t: VatPostTarget) => t.subjectId !== data.subjectId) || data.events.some((e: VatPostEventRecord) => e.subjectId !== data.subjectId)) throw new Error("신고 주체와 접수·납부 목록을 확인할 수 없습니다.");
      let docs: DocumentInfo[] = [];
      if (subjectId) {
        const response = await fetch(`${DOCUMENTS}?${new URLSearchParams({ subjectId })}`, { signal: abort.signal, cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(errorMessage(body, response.status));
        if (!Array.isArray(body.documents) || body.documents.some((d: DocumentInfo) => d.subjectId !== subjectId)) throw new Error("증빙 문서의 주체를 확인할 수 없습니다."); docs = body.documents;
      }
      if (seq === sequence.current && !abort.signal.aborted) { setOverview(data); setSubjects(data.subjects); setDocuments(docs); setNeedsReload(false); }
    } catch (e) { if (seq === sequence.current && !abort.signal.aborted) { setError(e instanceof Error ? e.message : String(e)); setNeedsReload(true); setOverview(null); setDocuments([]); } }
    finally { if (seq === sequence.current && !abort.signal.aborted) setLoading(false); }
  }, [subjectId]);
  useEffect(() => { void load(); return () => { sequence.current++; controller.current?.abort(); editSequence.current++; }; }, [load]);
  const selectSubject = (id: string) => {
    contextRef.current = id; sequence.current++; controller.current?.abort(); setSubjectId(id); setOverview(null); setDocuments([]); setFile(null); uploadRequest.current = null;
    if (fileInput.current) fileInput.current.value = ""; resetEditor(); setNeedsReload(false); setError(null);
  };
  const editRecord = (record: VatPostEventRecord, withdraw = false) => {
    if (locked) return;
    setForm({ ...formFromRecord(record), ...(withdraw ? { state: "withdrawn" as const, reason: "" } : {}) });
    setEventId(record.eventId); setBaseVersion(record.version); setViewedRevision(""); invalidate(); setError(null); setNotice(null);
  };
  const selectReference = (factId: string) => {
    const candidate = overview?.referenceCandidates.find(r => r.factId === factId);
    setForm(f => ({ ...f, sharedB1FactId: factId, ...(candidate ? { officialKey: candidate.officialKey, evidenceDocumentId: candidate.evidenceDocumentId ?? "", ...(f.kind === "receipt" ? { declaredTax: numberText(candidate.amount) } : { actualTotal: numberText(candidate.amount), allocations: [], additionalCharges: "0", otherAmount: "0", unallocatedAmount: "0" }) } : {}) })); invalidate();
  };
  const makeInput = (): VatPostPreviewInput => {
    if (!isValidDateString(form.occurredAt)) throw new Error("원문상 일자를 확인하세요.");
    if (!documents.some(d => d.documentId === form.evidenceDocumentId)) throw new Error("이 주체에 보관한 원문 증빙을 선택하세요.");
    if (!form.reason.trim()) throw new Error("기록·정정 사유를 입력하세요.");
    const findTarget = (key: string) => { const t = targetMap.get(key); if (!t) throw new Error("저장된 고지·확정판 대상을 선택하세요."); return { kind: t.kind, id: t.id }; };
    const event: VatPostEventInput = { kind: form.kind, state: form.state, officialKey: form.officialKey.trim() || null, evidenceDocumentId: form.evidenceDocumentId, occurredAt: form.occurredAt, reason: form.reason.trim(), sharedB1FactId: form.sharedB1FactId || null };
    if (form.kind === "receipt") event.receipt = { target: findTarget(form.target), declaredTax: amount(form.declaredTax, "접수 문서 신고세액", true, true) };
    if (form.kind === "payment") {
      const seen = new Set<string>();
      event.payment = { actualTotal: amount(form.actualTotal, "실제 납부 총액", true), additionalCharges: amount(form.additionalCharges, "추가 가산금액")!, otherAmount: amount(form.otherAmount, "기타 납부액")!, unallocatedAmount: amount(form.unallocatedAmount, "미배부액")!, allocations: form.allocations.map(row => {
        if (seen.has(row.target)) throw new Error("같은 대상은 한 번만 배부하세요."); seen.add(row.target);
        const target = findTarget(row.target), value = amount(row.amount, "대상 배부액")!;
        if (value <= 0) throw new Error("대상 배부액은 0원보다 커야 합니다. 배부하지 않는 행은 삭제하세요.");
        if (targetMap.get(row.target)!.targetAmount <= 0 && value > 0) throw new Error("0원·환급 확정판에는 납부액을 배부할 수 없습니다.");
        return { target, amount: value };
      }) };
    }
    if (form.kind === "reconciliation") { if (!isValidDateString(form.throughDate)) throw new Error("대사 기준일을 확인하세요."); event.reconciliation = { target: findTarget(form.target), throughDate: form.throughDate, observedPaidTotal: amount(form.observedPaidTotal, "확인한 납부 누계", true) }; }
    if (form.kind === "other") event.other = { category: form.category, amount: amount(form.otherTotal, "원문 금액", true), target: form.target ? findTarget(form.target) : null };
    const payload = JSON.stringify({ subjectId, eventId: eventId || null, expectedVersion: baseVersion, event });
    if (previewRequest.current?.payload !== payload) previewRequest.current = { payload, body: { subjectId, eventId: eventId || null, expectedVersion: baseVersion, event, requestId: crypto.randomUUID() } };
    return previewRequest.current.body;
  };
  const previewEvent = async () => {
    if (locked || inFlight.current || needsReload || editorStale) return;
    const context = contextRef.current, seq = editSequence.current; inFlight.current = true; setBusy(true); setError(null); setNotice(null); setPreview(null); setReviewConfirmed(false);
    try {
      const body = makeInput(); const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", ...body }) }); const result = await response.json();
      if (context !== contextRef.current || seq !== editSequence.current) return;
      if (!response.ok) { if ([403, 409, 503].includes(response.status)) setNeedsReload(true); throw new Error(errorMessage(result, response.status)); }
      if (!result.previewHash || result.normalized?.requestId !== body.requestId || result.normalized?.subjectId !== subjectId || result.normalized?.expectedVersion !== baseVersion || typeof result.canReview !== "boolean") throw new Error("검토 결과와 입력한 주체·판을 확인할 수 없습니다.");
      setPreview(result);
    } catch (e) { if (context === contextRef.current && seq === editSequence.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const saveEvent = async () => {
    if (locked || inFlight.current || needsReload || editorStale || !preview || !previewRequest.current || (form.state !== "recorded" && (!preview.canReview || !reviewConfirmed))) return;
    const context = contextRef.current; inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", ...previewRequest.current.body, expectedPreviewHash: preview.previewHash, reviewConfirmed }) }); const result = await response.json();
      if (context !== contextRef.current) return;
      if (!response.ok) { if ([403, 409, 503].includes(response.status)) { setNeedsReload(true); setPreview(null); setReviewConfirmed(false); } throw new Error(errorMessage(result, response.status)); }
      setNotice(`접수·납부 ${result.version}판을 보관했습니다.`);
      setViewedRevision(result.revisionId); setEventId(result.eventId); setBaseVersion(result.version); invalidate(); await load();
    } catch (e) { if (context === contextRef.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const upload = async () => {
    if (locked || inFlight.current || !file) return;
    if (file.size < 1 || file.size > MAX_FILE_BYTES) { setError("원문 증빙은 1바이트 이상 10MiB 이하 파일로 선택하세요."); return; }
    const context = contextRef.current;
    if (uploadRequest.current?.file !== file || uploadRequest.current.subjectId !== subjectId) uploadRequest.current = { subjectId, file, requestId: crypto.randomUUID() };
    const body = new FormData(); body.set("subjectId", subjectId); body.set("requestId", uploadRequest.current.requestId); body.set("file", file);
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch(DOCUMENTS, { method: "POST", body }); const result = await response.json(); if (context !== contextRef.current) return;
      if (!response.ok) throw new Error(errorMessage(result, response.status));
      if (result.subjectId !== subjectId || !result.documentId) throw new Error("보관한 증빙의 주체를 확인할 수 없습니다.");
      setDocuments(rows => [...rows.filter(d => d.documentId !== result.documentId), result]); update("evidenceDocumentId", result.documentId); setNotice("원문 증빙을 보관했습니다."); setFile(null); uploadRequest.current = null; if (fileInput.current) fileInput.current.value = "";
    } catch (e) { if (context === contextRef.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const documentLink = (id: string) => `${DOCUMENTS}?${new URLSearchParams({ subjectId, documentId: id })}`;
  const allocationTotal = form.allocations.reduce((sum, r) => sum + (/^\d+$/.test(r.amount) ? Number(r.amount) : 0), 0);

  return <div className="space-y-6 cd-text" aria-label="신고 후 접수·납부 관리">
    <Section title="신고 후 접수·납부" hint="실제 접수·납부 증빙을 저장된 고지·앱 확정판과 대조합니다. 이 기록은 신고 근거, 계산 세액, 저장된 확정판을 변경하지 않습니다.">
      <p className="text-xs cd-text-muted">대사 일치는 입력한 기록과 보관 금액의 일치입니다. 외부 접수·완납을 자동 인증하지 않습니다. 확정판 조회는 저장된 계산·소비 근거를 확인하며, 당시 검토 증빙 원문을 매번 새로 인증했다는 뜻은 아닙니다.</p>
      <div className="flex flex-wrap gap-3 items-end"><div className="flex-1 min-w-64"><CdSelect label="접수·납부 주체 선택" aria-label="접수·납부 주체 선택" value={subjectId} onChange={e => selectSubject(e.target.value)} disabled={busy}><option value="">주체를 선택하세요</option>{subjects.map(s => <option key={s.subjectId} value={s.subjectId}>{s.corpNum || "등록번호 미확인"} · 주체 {s.subjectId.slice(-6)}</option>)}</CdSelect></div><button type="button" className="cd-btn cd-btn-ghost" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={16} />현재 기록 다시 조회</button></div>
      {!loading && !canManage && <p className="text-sm cd-text-muted">조회 전용입니다. 대상·이력·원문은 볼 수 있으며 입력과 저장은 할 수 없습니다.</p>}
      {!loading && overview?.subjects.length === 0 && <p className="text-sm cd-text-muted">신고 근거에서 주체를 먼저 등록하세요.</p>}
      {error && <div role="alert" className="rounded-xl p-3 text-sm" style={{ background: "var(--cd-error-soft)", color: "var(--cd-error)" }}>{error}</div>}
      {notice && <p role="status" className="text-sm" style={{ color: "var(--cd-primary)" }}>{notice}</p>}
      {(needsReload || editorStale) && <p className="text-sm" style={{ color: "var(--cd-warning)" }}>입력은 보존했습니다. 현재 기록을 다시 조회하고, 변경된 판은 최신 기록에서 새 판으로 작성한 뒤 다시 검토하세요.</p>}
      {overview?.issues.map((i, n) => <p key={n} className="text-sm cd-text-muted">{i.message}</p>)}
    </Section>
    {subjectId && <>
      <Section title="저장된 고지·확정판" hint="고지액과 확정판 납부액은 서로 다른 기준입니다. 확정판 납부액에는 기존 가산세가 포함됩니다. 확정판의 기초 배부는 앱 기록이며 실제 납부 여부는 사후 증빙으로 확인합니다. 알려진 잔액은 확인한 금액과 배부 기록을 기준으로 계산합니다.">
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="cd-text-muted"><tr>{["대상·기간", "저장 금액", "기초 납부·배부 기록", "사후 배부", "알려진 잔액"].map(t => <th className="text-left p-3 border-b cd-border-c whitespace-nowrap" key={t}>{t}</th>)}</tr></thead><tbody>{targets.map(t => <tr key={targetKey(t)}><td className="p-3 border-b cd-border-c"><p>{targetLabel(t)}</p><p className="text-xs cd-text-muted">{t.dateFrom} ~ {t.dateTo}</p><p className="text-xs cd-text-muted">{t.kind === "notice" ? "고지 원금" : "확정판 납부액 · 기존 가산세 포함"}</p></td><td className="p-3 border-b cd-border-c whitespace-nowrap">{money(t.targetAmount)}{t.targetAmount < 0 && <p className="text-xs cd-text-muted">환급액 · 접수 대사 가능</p>}</td><td className="p-3 border-b cd-border-c whitespace-nowrap">{money(t.baselinePaid)}<p className="text-xs cd-text-muted">{t.kind === "notice" ? t.baselineComplete ? "봉인 당시 확인 범위 대사 완료" : "봉인 당시 확인 범위 미완료" : "기초 배부 기록 · 사후 납부 기록에서 확인"}</p></td><td className="p-3 border-b cd-border-c whitespace-nowrap">{money(t.allocatedAfter)}</td><td className="p-3 border-b cd-border-c whitespace-nowrap">{money(t.remainingKnown)}</td></tr>)}</tbody></table></div>
        {!targets.length && <p className="text-sm cd-text-muted">선택 가능한 봉인 고지·확정판이 없습니다. 원문 증빙은 먼저 보관할 수 있습니다.</p>}
      </Section>
      <Section title="원문 증빙" hint="PDF·이미지·JSON·CSV·XLSX, 최대 10MiB. 증빙 파일은 원문 그대로 보관하고 저장된 문서를 선택합니다.">
        <div className="flex flex-wrap gap-3 items-end"><div className="flex-1 min-w-56"><label className="text-sm cd-text-muted block mb-2" htmlFor="vat-post-document">접수·납부 원문 파일</label><input id="vat-post-document" ref={fileInput} type="file" aria-label="접수·납부 원문 파일" accept=".pdf,.jpg,.jpeg,.png,.json,.csv,.xlsx" disabled={locked} onChange={e => { setFile(e.target.files?.[0] ?? null); uploadRequest.current = null; }} className="block w-full text-sm" /></div><button type="button" className="cd-btn cd-btn-ghost" disabled={locked || !file} onClick={() => void upload()}><Upload size={16} />원문 보관</button></div>
        <div className="flex flex-wrap gap-3">{documents.map(d => <a key={d.documentId} className="cd-btn cd-btn-ghost text-xs" href={documentLink(d.documentId)}><Download size={14} />{d.fileName}</a>)}</div>
      </Section>
      <Section title="접수·납부 기록 이력" hint="과거 판은 읽기 전용입니다. 정정·철회는 최신 판을 바탕으로 검토한 새 판으로 보관합니다.">
        <button type="button" className="cd-btn cd-btn-primary" disabled={locked} onClick={resetEditor}>새 접수·납부 기록 작성</button>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr>{["종류·공식번호", "판·상태", "원문상 일자", "보기·새 판"].map(t => <th key={t} className="text-left p-3 border-b cd-border-c whitespace-nowrap">{t}</th>)}</tr></thead><tbody>{(overview?.events ?? []).map(r => <tr key={r.revisionId}><td className="p-3 border-b cd-border-c">{labels[r.event.kind]}<p className="text-xs cd-text-muted">{r.event.officialKey ?? "공식번호 미확인"}</p></td><td className="p-3 border-b cd-border-c">{r.version}판 · {labels[r.event.state]}<p className="text-xs cd-text-muted">{labels[r.matchStatus]}{r.referenceOnly ? " · 기존 납부 참고" : ""}</p></td><td className="p-3 border-b cd-border-c whitespace-nowrap">{r.event.occurredAt}</td><td className="p-3 border-b cd-border-c"><div className="flex flex-wrap gap-2"><button type="button" className="cd-btn cd-btn-ghost" aria-label={`${r.revisionId} 보관판 보기`} onClick={() => { setViewedRevision(r.revisionId); invalidate(); }}><History size={14} />보관판</button>{latest.find(l => l.eventId === r.eventId)?.revisionId === r.revisionId && <><button type="button" className="cd-btn cd-btn-ghost" aria-label={`${r.eventId} 최신판 정정`} disabled={locked} onClick={() => editRecord(r)}>새 판 작성</button>{r.event.state !== "withdrawn" && <button type="button" className="cd-btn cd-btn-ghost" aria-label={`${r.eventId} 철회 작성`} disabled={locked} onClick={() => editRecord(r, true)}>철회 작성</button>}</>}</div></td></tr>)}</tbody></table></div>
        {viewed && <div className="rounded-xl border cd-border-c p-4 space-y-3"><h3 className="font-semibold">접수·납부 {viewed.version}판 · 읽기 전용</h3><p className="text-sm">{labels[viewed.event.state]} · {labels[viewed.matchStatus]}{viewed.referenceOnly ? " · 기존 문서 참고, 새 현금·배부 합산 제외" : ""}</p><p className="text-xs cd-text-muted">기록자 {viewed.actorUserId} · 등록 시각 {viewed.createdAt}</p><EventAmounts event={viewed.event} targets={targets} /><p className="text-sm">사유: {viewed.event.reason}</p><a className="cd-btn cd-btn-ghost" href={documentLink(viewed.event.evidenceDocumentId)}><Download size={14} />이 판 원문 다운로드</a>{viewed.issues.map((i, n) => <p key={n} className="text-sm">{i.message}</p>)}<details><summary className="cursor-pointer text-sm">보관한 기록 상세</summary><pre className="mt-3 text-xs whitespace-pre-wrap break-all">{JSON.stringify(viewed.event, null, 2)}</pre></details></div>}
      </Section>
      {!viewedRevision && <Section title={eventId ? `접수·납부 새 판 작성 · 기준 ${baseVersion}판` : "접수·납부 새 기록"} hint="기록됨은 원문 보관 상태이며 검토 완료·납부 대사와 다릅니다. 금액이 미확인이면 비워두고, 확인된 0원은 0을 입력하세요.">
        <fieldset disabled={locked} className="space-y-4 min-w-0">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <CdSelect label="접수·납부 기록 종류" aria-label="접수·납부 기록 종류" value={form.kind} disabled={!!eventId} onChange={e => { setForm({ ...emptyForm(), kind: e.target.value as VatPostKind, evidenceDocumentId: form.evidenceDocumentId }); invalidate(); }}><option value="receipt">신고 접수</option><option value="payment">실제 납부</option><option value="reconciliation">납부 내역 대사</option><option value="other">상계·환급 등</option></CdSelect>
            <CdSelect label="기록 검토 상태" aria-label="기록 검토 상태" value={form.state} onChange={e => update("state", e.target.value as VatPostState)}><option value="recorded">기록됨 · 미검토</option><option value="verified">검토 완료</option>{eventId && <option value="withdrawn">철회</option>}</CdSelect>
            <CdSelect label="접수·납부 증빙 선택" aria-label="접수·납부 증빙 선택" value={form.evidenceDocumentId} onChange={e => update("evidenceDocumentId", e.target.value)}><option value="">원문 증빙을 선택하세요</option>{documents.map(d => <option key={d.documentId} value={d.documentId}>{d.fileName} · {d.documentId}</option>)}</CdSelect>
            <CdInput label="공식 접수·납부 번호" aria-label="공식 접수·납부 번호" value={form.officialKey} maxLength={300} onChange={e => update("officialKey", e.target.value)} placeholder="원문에 기재된 번호" />
            <CdDateInput label="접수·납부 원문상 일자" aria-label="접수·납부 원문상 일자" value={form.occurredAt} onChange={v => update("occurredAt", v)} />
            {(form.kind === "payment" || form.kind === "receipt") && <CdSelect label="기존 신고 근거의 동일 문서 참고" aria-label="기존 신고 근거의 동일 문서 참고" value={form.sharedB1FactId} disabled={!!eventId} onChange={e => selectReference(e.target.value)}><option value="">새로운 접수·납부 문서</option>{overview?.referenceCandidates.filter(r => r.kind === (form.kind === "receipt" ? "filing" : "payment")).map(r => <option key={r.factId} value={r.factId}>{r.label} · {money(r.amount)}</option>)}{form.sharedB1FactId && !overview?.referenceCandidates.some(r => r.factId === form.sharedB1FactId) && <option value={form.sharedB1FactId}>이 판의 기존 문서 참고 · {form.sharedB1FactId}</option>}</CdSelect>}
          </div>
          <CdTextarea label="기록·정정 사유" aria-label="기록·정정 사유" rows={3} maxLength={2000} value={form.reason} onChange={e => update("reason", e.target.value)} />
          {form.kind !== "payment" && <CdSelect label="저장된 고지·확정판 선택" aria-label="저장된 고지·확정판 선택" value={form.target} onChange={e => update("target", e.target.value)}><option value="">{form.kind === "other" ? "대상 없음 · 별도 확인" : "대상을 선택하세요"}</option>{targets.map(t => <option key={targetKey(t)} value={targetKey(t)}>{targetLabel(t)} · {money(t.targetAmount)}</option>)}</CdSelect>}
          {selectedTarget && form.kind !== "payment" && <p className="text-sm cd-text-muted">선택한 저장 금액 {money(selectedTarget.targetAmount)} · {selectedTarget.kind === "return" ? "확정판 납부액(기존 가산세 포함)" : "고지 원금"}. 현재 원천을 다시 계산한 금액이 아닙니다.</p>}
          {form.kind === "receipt" && <AmountField label="접수 문서 신고세액" value={form.declaredTax} onChange={v => update("declaredTax", v)} nullable />}
          {form.kind === "payment" && <div className="space-y-4">
            <p className="text-sm cd-text-muted">연체 납부도 원문상 일자로 기록합니다. 실제 납부 총액을 대상 배부·추가 가산금액·기타·미배부액으로 구분하세요. 확정판에 이미 포함된 가산세를 추가 가산금액에 다시 넣지 마세요.</p>
            {form.sharedB1FactId && <p className="text-sm" style={{ color: "var(--cd-primary)" }}>이미 봉인된 납부의 참고 기록입니다. 같은 현금·배부를 다시 합산하지 않습니다.</p>}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><AmountField label="실제 납부 총액" value={form.actualTotal} onChange={v => update("actualTotal", v)} nullable disabled={!!form.sharedB1FactId} /><AmountField label="추가 가산금액" value={form.additionalCharges} onChange={v => update("additionalCharges", v)} disabled={!!form.sharedB1FactId} /><AmountField label="기타 납부액" value={form.otherAmount} onChange={v => update("otherAmount", v)} disabled={!!form.sharedB1FactId} /><AmountField label="미배부액" value={form.unallocatedAmount} onChange={v => update("unallocatedAmount", v)} disabled={!!form.sharedB1FactId} /></div>
            {form.allocations.map((r, i) => <div key={i} className="grid gap-3 md:grid-cols-[1fr_180px_auto] items-end rounded-xl border cd-border-c p-3"><CdSelect label={`배부 ${i + 1} 대상`} aria-label={`배부 ${i + 1} 대상`} value={r.target} onChange={e => update("allocations", form.allocations.map((a, n) => n === i ? { ...a, target: e.target.value } : a))}><option value="">납부 대상을 선택하세요</option>{targets.filter(t => t.targetAmount > 0).map(t => <option key={targetKey(t)} value={targetKey(t)}>{targetLabel(t)} · 잔액 {money(t.remainingKnown)}</option>)}</CdSelect><AmountField label={`배부 ${i + 1} 금액`} value={r.amount} onChange={v => update("allocations", form.allocations.map((a, n) => n === i ? { ...a, amount: v } : a))} /><button type="button" className="cd-btn cd-btn-ghost" aria-label={`배부 ${i + 1} 삭제`} onClick={() => update("allocations", form.allocations.filter((_, n) => i !== n))}>삭제</button></div>)}
            <div className="flex flex-wrap gap-3 items-center"><button type="button" className="cd-btn cd-btn-ghost" disabled={!!form.sharedB1FactId || form.allocations.length >= 100} onClick={() => update("allocations", [...form.allocations, { target: "", amount: "" }])}>납부 대상 배부 추가</button><p className="text-sm cd-text-muted">입력한 대상 배부 합계 {money(allocationTotal)} · 최종 일치 여부는 검토 미리보기에서 확인합니다.</p></div>
          </div>}
          {form.kind === "reconciliation" && <div className="grid gap-4 md:grid-cols-2"><CdDateInput label="대사 기준일" aria-label="대사 기준일" value={form.throughDate} onChange={v => update("throughDate", v)} /><AmountField label="확인한 납부 누계" value={form.observedPaidTotal} onChange={v => update("observedPaidTotal", v)} nullable /></div>}
          {form.kind === "other" && <div className="grid gap-4 md:grid-cols-2"><CdSelect label="기타 원문 종류" aria-label="기타 원문 종류" value={form.category} onChange={e => update("category", e.target.value as Form["category"])}><option value="offset">상계</option><option value="refund">환급</option><option value="other">기타</option></CdSelect><AmountField label="원문 금액" value={form.otherTotal} onChange={v => update("otherTotal", v)} nullable /><p className="text-sm cd-text-muted md:col-span-2">원문을 보관합니다. 이 기록으로 납부 배부액이나 기존 신고세액을 자동 변경하지 않습니다.</p></div>}
          <button type="button" className="cd-btn cd-btn-primary" disabled={locked || needsReload || editorStale} onClick={() => void previewEvent()}>접수·납부 검토 미리보기</button>
        </fieldset>
        {preview && <div className="rounded-xl border cd-border-c p-4 space-y-3" aria-label="접수·납부 검토 결과"><h3 className="font-semibold">검토 결과 · {labels[preview.matchStatus]}</h3><EventAmounts event={preview.normalized.event} targets={preview.targets} />{preview.referenceOnly && <p className="text-sm">기존 문서 참고 · 새 현금·배부 합산 제외</p>}{preview.issues.map((i, n) => <p key={n} className="text-sm" style={{ color: "var(--cd-warning)" }}>{i.message}</p>)}<p className="text-sm cd-text-muted">저장할 상태: {labels[form.state]} · {baseVersion + 1}판</p>{!preview.canReview && <p className="text-sm cd-text-muted">검토 완료로 저장할 수 없는 사유가 있습니다. 원문 기록 상태로 보관하거나 입력을 확인하세요.</p>}<label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={reviewConfirmed} disabled={locked || !preview.canReview} onChange={e => setReviewConfirmed(e.target.checked)} />원문·대상·금액·배부와 대사 결과를 확인했고 선택한 상태로 저장합니다.</label><button type="button" className="cd-btn cd-btn-primary" disabled={locked || needsReload || editorStale || (form.state !== "recorded" && (!preview.canReview || !reviewConfirmed))} onClick={() => void saveEvent()}>{form.state === "recorded" ? "미검토 기록 보관" : form.state === "withdrawn" ? "검토한 철회 판 보관" : "검토 완료 판 보관"}</button></div>}
      </Section>}
    </>}
  </div>;
}
