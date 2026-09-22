"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Download, FileCheck2, History, RefreshCw, Upload } from "lucide-react";
import { CdDateInput, CdInput, CdSelect, CdTextarea, isValidDateString } from "@/components/cdash/CdField";
import type { FactRevision, SourceCoverage, SubjectRevision, VatFilingScopeResult } from "@/lib/finance/vat-filing-scope";

const ENDPOINT = "/api/finance/vat-filing-basis";
const DOCUMENT_ENDPOINT = "/api/finance/vat-filing-documents";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const labelOf: Record<string, string> = {
  unknown: "미확인", recorded: "기록됨", verified: "증빙 검토 완료", withdrawn: "철회 이력",
  notice: "예정고지", no_notice: "미징수", filing: "과거 신고 접수", payment: "봉인 전 고지 원금 납부",
  preliminary: "예정신고", final: "확정신고", complete: "대사 완료", partial: "일부 대사",
};
const display = (value: unknown) => value === null || value === undefined || value === "" ? "미확인" : typeof value === "number" ? value.toLocaleString("ko-KR") : labelOf[String(value)] ?? String(value);
const apiError = (body: { error?: unknown; message?: unknown }, status: number) => typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : `요청을 처리하지 못했습니다. (${status})`;

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section aria-label={title} className="cd-card p-5 sm:p-6 space-y-4"><header><h2 className="cd-card-title">{title}</h2>{hint && <p className="text-xs cd-text-muted mt-2">{hint}</p>}</header>{children}</section>;
}

function DateField({ label, value, onChange, disabled = false }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <CdDateInput label={label} aria-label={label} value={value} onChange={onChange} disabled={disabled} />;
}

function AmountField({ label, value, onChange, nullable = false }: { label: string; value: string; onChange: (value: string) => void; nullable?: boolean }) {
  return <CdInput aria-label={label} label={label} inputMode="numeric" value={value} onChange={event => onChange(event.target.value)} placeholder={nullable ? "미확인이면 비워두세요" : "원 단위 정수"} />;
}

// Form values remain strings until explicit preview; an empty input is never coerced to zero.
function amountValue(value: string, label: string, nullable = false): number | null {
  if (nullable && !value.trim()) return null;
  if (!/^-?\d+$/.test(value.trim()) || !Number.isSafeInteger(Number(value))) throw new Error(`${label}: 원 단위 정수를 입력하세요.`);
  return Number(value);
}

interface SubjectForm {
  corpNum: string; state: "unknown" | "verified"; effectiveFrom: string; effectiveTo: string;
  mode: "unknown" | "preliminary" | "notice"; entityType: "unknown" | "corporation" | "individual";
  vatRegime: "unknown" | "general" | "simplified" | "exempt"; filingUnit: "unknown" | "single_business_place" | "business_unit" | "consolidated_payment";
  evidenceDocumentId: string;
}
const emptySubject = (): SubjectForm => ({ corpNum: "", state: "unknown", effectiveFrom: "", effectiveTo: "", mode: "unknown", entityType: "unknown", vatRegime: "unknown", filingUnit: "unknown", evidenceDocumentId: "" });

interface DocumentInfo { documentId: string; subjectId: string; fileName: string; contentType: string; sizeBytes: number; evidenceRef: string; evidenceHash: string; createdAt: string }
interface Overview {
  subjects: SubjectRevision[]; subject: SubjectRevision | null; applicableSubject: SubjectRevision | null; subjectRevisions: SubjectRevision[];
  facts: Array<{ fact: FactRevision; consumed: boolean }>; archives: Array<{ snapshotId: string; scopeHash: string; year: number; term: number; kind: string }>;
  scope: VatFilingScopeResult | null; scopeError: { error: string; status: number } | null; permissions: { manage: boolean };
}
interface Preview { previewHash: string; normalizedFact: FactRevision; scope: VatFilingScopeResult; sourceIssues: Array<{ code?: string; sourceId?: string; message?: string; reason?: string }>; canReview: boolean }
interface FactForm {
  kind: "notice" | "no_notice" | "filing" | "payment"; state: "recorded" | "verified" | "withdrawn";
  from: string; to: string; amount: string; evidenceDocumentId: string; externalKey: string;
  documentNumber: string; documentDate: string; previousPeriodSupply: string; previousAdjustedTax: string;
  priorFilingStatus: "unknown" | "none"; priorFilingEvidenceDocumentId: string;
  paymentState: "unknown" | "complete"; paymentEvidenceDocumentId: string;
  noNoticeReason: "below_minimum" | "official_other"; reasonDetail: string;
  filingType: "preliminary" | "final" | "early_refund" | "amended" | "late" | "correction_claim";
  returnType: "preliminary" | "final" | "early_refund";
  sourceReconciliation: "unknown" | "partial" | "complete"; isNilReturn: boolean; nilEvidenceDocumentId: string;
  salesSupply: string; salesTax: string; purchaseSupply: string; purchaseTax: string; claimedTax: string;
  targetNoticeFactId: string;
}
const emptyFact = (year: number, term: number): FactForm => ({ kind: "notice", state: "recorded", from: `${year}-${term === 1 ? "01" : "07"}-01`, to: `${year}-${term === 1 ? "03-31" : "09-30"}`, amount: "", evidenceDocumentId: "", externalKey: "", documentNumber: "", documentDate: "", previousPeriodSupply: "", previousAdjustedTax: "", priorFilingStatus: "unknown", priorFilingEvidenceDocumentId: "", paymentState: "unknown", paymentEvidenceDocumentId: "", noNoticeReason: "below_minimum", reasonDetail: "", filingType: "preliminary", returnType: "preliminary", sourceReconciliation: "unknown", isNilReturn: false, nilEvidenceDocumentId: "", salesSupply: "", salesTax: "", purchaseSupply: "", purchaseTax: "", claimedTax: "", targetNoticeFactId: "" });
const sourceKey = (row: SourceCoverage) => `${row.sourceKind}:${row.sourceId}`;

// 중복 JSON 키는 JSON.parse의 마지막 값 채택 전에 거절한다. 업로드 원문은 실행하지 않는다.
function readManifest(text: string): SourceCoverage[] {
  let at = 0;
  const space = () => { while (/\s/.test(text[at] ?? "") && at < text.length) at++; };
  const string = () => {
    const start = at++;
    while (at < text.length) { if (text[at] === "\\") { at += 2; continue; } if (text[at++] === '"') return JSON.parse(text.slice(start, at)) as string; }
    throw new Error("JSON 문자열이 끝나지 않았습니다.");
  };
  const value = (depth: number): void => {
    if (depth > 30) throw new Error("JSON 중첩이 너무 깊습니다.");
    space(); const first = text[at];
    if (first === '"') { string(); return; }
    if (first === "{") {
      at++; space(); const keys = new Set<string>(); if (text[at] === "}") { at++; return; }
      while (at < text.length) { space(); if (text[at] !== '"') throw new Error("JSON 객체 키 형식이 올바르지 않습니다."); const key = string(); if (keys.has(key)) throw new Error(`JSON 키가 중복되었습니다: ${key}`); keys.add(key); space(); if (text[at++] !== ":") throw new Error("JSON 객체 형식이 올바르지 않습니다."); value(depth + 1); space(); const end = text[at++]; if (end === "}") return; if (end !== ",") throw new Error("JSON 객체 구분자가 올바르지 않습니다."); }
    } else if (first === "[") {
      at++; space(); if (text[at] === "]") { at++; return; }
      while (at < text.length) { value(depth + 1); space(); const end = text[at++]; if (end === "]") return; if (end !== ",") throw new Error("JSON 배열 구분자가 올바르지 않습니다."); }
    } else { const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at)); if (match) { if (/^[\d-]/.test(match[0]) && /[.eE]/.test(match[0])) throw new Error("명세 금액은 소수·지수 표기 없는 정수로 작성하세요."); at += match[0].length; return; } }
    throw new Error("JSON 값을 읽을 수 없습니다.");
  };
  value(0); space(); if (at !== text.length) throw new Error("JSON 뒤에 불필요한 내용이 있습니다.");
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.length > 50000) throw new Error("명세는 원천 행 배열이며 최대 50,000행까지 지원합니다.");
  const seen = new Set<string>();
  return parsed.map((entry, index) => {
    const r = entry as Record<string, unknown>;
    if (!r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).some(k => !["sourceKind", "sourceId", "canonicalKey", "sourceHash", "direction", "supply", "tax", "claimedTax", "date"].includes(k))) throw new Error(`${index + 1}행: 지원하지 않는 명세 형식입니다.`);
    if (![r.sourceKind, r.sourceId, r.canonicalKey].every(v => typeof v === "string" && v.trim()) || typeof r.sourceHash !== "string" || !/^[a-f0-9]{64}$/i.test(r.sourceHash) || !["sales", "purchase"].includes(String(r.direction)) || ![r.supply, r.tax, r.claimedTax].every(Number.isSafeInteger) || typeof r.date !== "string" || !isValidDateString(r.date)) throw new Error(`${index + 1}행: 원천 식별자·일자·금액 형식을 확인하세요.`);
    const row = r as unknown as SourceCoverage; if ((row.direction === "sales" && row.claimedTax !== 0) || Math.abs(row.claimedTax) > Math.abs(row.tax) || (row.claimedTax !== 0 && Math.sign(row.claimedTax) !== Math.sign(row.tax)) || (row.supply !== 0 && row.tax !== 0 && Math.sign(row.supply) !== Math.sign(row.tax))) throw new Error(`${index + 1}행: 공제액 한도·매출 공제·금액 부호를 확인하세요.`); const key = sourceKey(row); if (seen.has(key)) throw new Error(`${index + 1}행: 원천이 중복되었습니다.`); seen.add(key); return row;
  });
}

export function VatFilingBasisPanel({ onOpenBasis }: { onOpenBasis: (snapshotId: string) => void }) {
  const [subjectId, setSubjectId] = useState("");
  const [year, setYear] = useState(2026), [term, setTerm] = useState(1), [kind, setKind] = useState<"preliminary" | "final">("final");
  const [overview, setOverview] = useState<Overview | null>(null), [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [needsReload, setNeedsReload] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [subjectForm, setSubjectForm] = useState<SubjectForm>(emptySubject), [subjectReview, setSubjectReview] = useState(false), [subjectRevisionId, setSubjectRevisionId] = useState("");
  const [subjectBaseVersion, setSubjectBaseVersion] = useState<number | null>(0), [factBaseVersion, setFactBaseVersion] = useState(0);
  const [factForm, setFactForm] = useState<FactForm>(() => emptyFact(2026, 1)), [factId, setFactId] = useState(""), [factRevisionId, setFactRevisionId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null), [factReview, setFactReview] = useState(false), [sourceReview, setSourceReview] = useState(false);
  const [sources, setSources] = useState<SourceCoverage[]>([]), [coverage, setCoverage] = useState<SourceCoverage[]>([]), [coverageName, setCoverageName] = useState("");
  const [sourceIssues, setSourceIssues] = useState<Preview["sourceIssues"]>([]), [claimedInputs, setClaimedInputs] = useState<Record<string, string>>({});
  const [sourceVisible, setSourceVisible] = useState(200), [coverageVisible, setCoverageVisible] = useState(200);
  const [factPeriods, setFactPeriods] = useState<Array<{ from: string; to: string }> | null>(null);
  const [file, setFile] = useState<File | null>(null), [archiveId, setArchiveId] = useState(""), [archive, setArchive] = useState<Record<string, unknown> | null>(null), [sealReview, setSealReview] = useState(false);
  const sequence = useRef(0), controller = useRef<AbortController | null>(null), archiveSequence = useRef(0), factSequence = useRef(0), inFlight = useRef(false);
  const context = `${subjectId}:${year}:${term}:${kind}`, contextRef = useRef(context); contextRef.current = context;
  const request = useRef<{ payload: string; requestId: string } | null>(null), previewRequest = useRef<{ payload: string; requestId: string } | null>(null);
  const uploadInput = useRef<HTMLInputElement | null>(null);
  const uploadRequest = useRef<{ file: File; subjectId: string; requestId: string } | null>(null);
  const canManage = overview?.permissions.manage === true;
  const locked = loading || busy || !canManage;
  const selectedFact = overview?.facts.find(row => row.fact.factId === factId);
  const viewedSubject = overview?.subjectRevisions.find(row => row.revisionId === subjectRevisionId);
  const viewedFact = factRevisionId ? overview?.facts.find(row => row.fact.revisionId === factRevisionId)?.fact : null;
  const selectedScope = overview?.scope;
  const documentByEvidence = (ref: string | null) => documents.find(row => row.evidenceRef === ref)?.documentId ?? "";

  const load = useCallback(async () => {
    const seq = ++sequence.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setLoading(true); setNeedsReload(false); setError(null); setSealReview(false);
    try {
      const query = new URLSearchParams({ view: "overview", year: String(year), term: String(term), kind, ...(subjectId ? { subjectId } : {}) });
      const response = await fetch(`${ENDPOINT}?${query}`, { cache: "no-store", signal: abort.signal }); const data = await response.json();
      if (!response.ok) throw new Error(apiError(data, response.status));
      if (!Array.isArray(data.subjects) || !Array.isArray(data.subjectRevisions) || !Array.isArray(data.facts) || !Array.isArray(data.archives) || typeof data.permissions?.manage !== "boolean" || (subjectId && data.subject?.subjectId !== subjectId)) throw new Error("조회한 신고 주체·근거 목록을 확인할 수 없습니다.");
      let docs: DocumentInfo[] = [];
      if (subjectId) {
        const res = await fetch(`${DOCUMENT_ENDPOINT}?${new URLSearchParams({ subjectId })}`, { cache: "no-store", signal: abort.signal }); const body = await res.json(); if (!res.ok) throw new Error(apiError(body, res.status));
        if (!Array.isArray(body.documents) || body.documents.some((d: DocumentInfo) => d.subjectId !== subjectId)) throw new Error("증빙 문서 주체를 확인할 수 없습니다."); docs = body.documents;
      }
      if (seq === sequence.current && !abort.signal.aborted) { setOverview(data); setDocuments(docs); }
    } catch (e) { if (seq === sequence.current && !abort.signal.aborted) { setError(e instanceof Error ? e.message : String(e)); setNeedsReload(true); setOverview(null); setDocuments([]); } }
    finally { if (seq === sequence.current && !abort.signal.aborted) setLoading(false); }
  }, [subjectId, year, term, kind]);
  useEffect(() => { void load(); return () => { sequence.current++; controller.current?.abort(); archiveSequence.current++; factSequence.current++; }; }, [load]);

  const clearPreview = () => { factSequence.current++; setPreview(null); setFactReview(false); setSourceReview(false); previewRequest.current = null; setSealReview(false); };
  const updateFact = <K extends keyof FactForm>(key: K, value: FactForm[K]) => { setFactForm(old => ({ ...old, [key]: value })); clearPreview(); };
  const updateSubject = <K extends keyof SubjectForm>(key: K, value: SubjectForm[K]) => { setSubjectForm(old => ({ ...old, [key]: value })); setSubjectReview(false); setSealReview(false); };
  const changeContext = (nextSubject: string, nextYear = year, nextTerm = term, nextKind = kind) => {
    setFactPeriods(null);
    sequence.current++; controller.current?.abort(); archiveSequence.current++; contextRef.current = `${nextSubject}:${nextYear}:${nextTerm}:${nextKind}`;
    setSubjectId(nextSubject); setYear(nextYear); setTerm(nextTerm); setKind(nextKind); setOverview(null); setDocuments([]); setSubjectForm(emptySubject()); setSubjectBaseVersion(nextSubject ? null : 0); setSubjectReview(false); setSubjectRevisionId(""); setFactForm(emptyFact(nextYear, nextTerm)); setFactId(""); setFactBaseVersion(0); setFactRevisionId(""); setSources([]); setSourceIssues([]); setCoverage([]); setClaimedInputs({}); setCoverageName(""); setArchiveId(""); setArchive(null); setFile(null); setError(null); setNotice(null); clearPreview(); request.current = null; uploadRequest.current = null;
  };
  const runMutation = async (body: Record<string, unknown>, success: string, fixedId?: string) => {
    if (inFlight.current || !canManage || needsReload) return null;
    const payload = JSON.stringify(body); if (request.current?.payload !== payload || (fixedId && request.current.requestId !== fixedId)) request.current = { payload, requestId: fixedId ?? crypto.randomUUID() };
    const startContext = contextRef.current; inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, requestId: request.current.requestId }) }); const result = await res.json();
      if (startContext !== contextRef.current) return null;
      if (!res.ok) { if ([409, 503, 403].includes(res.status)) { setNeedsReload(true); setSubjectReview(false); setFactReview(false); setSealReview(false); } throw new Error(apiError(result, res.status)); }
      request.current = null; setNotice(success); return result;
    } catch (e) { if (startContext === contextRef.current) setError(e instanceof Error ? e.message : String(e)); return null; }
    finally { inFlight.current = false; setBusy(false); }
  };
  const saveSubject = async () => {
    if (subjectBaseVersion === null) { setError("최신 기준으로 새 판 작성을 먼저 선택하세요."); return; }
    if (!isValidDateString(subjectForm.effectiveFrom) || (subjectForm.effectiveTo && !isValidDateString(subjectForm.effectiveTo))) { setError("주체 적용기간의 날짜를 확인하세요."); return; }
    const result = await runMutation({ action: "save_subject", expectedVersion: subjectBaseVersion, ...(subjectId ? { subjectId } : {}), subject: { ...subjectForm, effectiveTo: subjectForm.effectiveTo || null, evidenceDocumentId: subjectForm.evidenceDocumentId || null }, reviewConfirmed: subjectReview }, "신고 주체 기준을 새 판으로 기록했습니다.");
    if (result) { setSubjectReview(false); setSubjectBaseVersion(result.version); if (!subjectId) { setSubjectId(result.subjectId); contextRef.current = `${result.subjectId}:${year}:${term}:${kind}`; } else await load(); }
  };
  const copyLatestSubject = () => {
    const s = overview?.subject; if (!s) return;
    setSubjectRevisionId(""); setSubjectBaseVersion(s.version); setSubjectForm({ corpNum: s.corpNum, state: s.state, effectiveFrom: s.effectiveFrom, effectiveTo: s.effectiveTo ?? "", mode: s.mode, entityType: s.entityType, vatRegime: s.vatRegime, filingUnit: s.filingUnit, evidenceDocumentId: documentByEvidence(s.evidenceRef) }); setSubjectReview(false);
  };
  const upload = async () => {
    if (!subjectId || !file || locked || inFlight.current) return;
    if (!file.size || file.size > MAX_FILE_BYTES) { setError("증빙 파일은 0바이트보다 크고 10MiB 이하여야 합니다."); return; }
    if (uploadRequest.current?.file !== file || uploadRequest.current.subjectId !== subjectId) uploadRequest.current = { file, subjectId, requestId: crypto.randomUUID() };
    const ctx = contextRef.current; inFlight.current = true; setBusy(true); setError(null);
    try {
      const body = new FormData(); body.set("subjectId", subjectId); body.set("requestId", uploadRequest.current.requestId); body.set("file", file);
      const response = await fetch(DOCUMENT_ENDPOINT, { method: "POST", body }); const result = await response.json();
      if (!response.ok) throw new Error(apiError(result, response.status));
      if (result.subjectId !== subjectId || typeof result.documentId !== "string") throw new Error("저장한 증빙 문서 식별자를 확인할 수 없습니다.");
      if (ctx !== contextRef.current) return; setFile(null); if (uploadInput.current) uploadInput.current.value = ""; uploadRequest.current = null; setNotice("원문 증빙을 보관했습니다. 증빙을 선택한 뒤 내용을 검토하세요."); await load();
    } catch (e) { if (ctx === contextRef.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const download = async (document: DocumentInfo) => {
    setError(null);
    try { const res = await fetch(`${DOCUMENT_ENDPOINT}?${new URLSearchParams({ documentId: document.documentId, subjectId: document.subjectId })}`, { cache: "no-store" }); if (!res.ok) throw new Error(apiError(await res.json(), res.status)); const url = URL.createObjectURL(await res.blob()); const a = window.document.createElement("a"); a.href = url; a.download = document.fileName; a.click(); URL.revokeObjectURL(url); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const buildFact = () => {
    const f = factForm;
    const sourceCoverage = f.kind === "filing" ? coverage.map(row => ({ ...row, claimedTax: amountValue(claimedInputs[sourceKey(row)] ?? String(row.claimedTax), `${row.sourceId} 과거 공제액`) as number })) : [];
    const base = { kind: f.kind, state: f.state, year, term, from: f.from, to: f.to, amount: amountValue(f.amount, "금액", f.state === "recorded"), evidenceDocumentId: f.evidenceDocumentId || null, periodCoverage: f.kind === "filing" ? factPeriods ?? [{ from: f.from, to: f.to }] : [], sourceCoverage };
    const common = { externalKey: factId ? f.externalKey : f.documentNumber.trim(), amountSemantics: "total_replacement" };
    const prior = { priorFilingStatus: f.priorFilingStatus, priorFilingEvidenceDocumentId: f.priorFilingEvidenceDocumentId || null, previousPeriodSupply: amountValue(f.previousPeriodSupply, "직전 과세기간 공급가액", true) };
    let data: Record<string, unknown>;
    if (f.kind === "notice") data = { ...common, ...prior, noticeNumber: f.documentNumber.trim(), noticeDate: f.documentDate, paymentState: f.paymentState, paymentEvidenceDocumentId: f.paymentEvidenceDocumentId || null };
    else if (f.kind === "no_notice") data = { ...common, ...prior, reason: f.noNoticeReason, previousAdjustedTax: amountValue(f.previousAdjustedTax, "직전 조정 납부세액", true), reasonDetail: f.reasonDetail };
    else if (f.kind === "payment") data = { ...common, targetNoticeFactId: f.targetNoticeFactId, paidAt: f.documentDate };
    else data = { ...common, filingType: f.filingType, ...(["amended", "late", "correction_claim"].includes(f.filingType) ? { returnType: f.returnType } : {}), receiptNumber: f.documentNumber.trim(), receiptDate: f.documentDate, sourceReconciliation: f.sourceReconciliation, declaredTotals: [f.salesSupply, f.salesTax, f.purchaseSupply, f.purchaseTax, f.claimedTax].every(v => !v.trim()) ? null : { salesSupply: amountValue(f.salesSupply, "매출 공급가액"), salesTax: amountValue(f.salesTax, "매출세액"), purchaseSupply: amountValue(f.purchaseSupply, "매입 공급가액"), purchaseTax: amountValue(f.purchaseTax, "매입세액"), claimedTax: amountValue(f.claimedTax, "실제 공제세액") }, isNilReturn: f.isNilReturn, nilEvidenceDocumentId: f.nilEvidenceDocumentId || null };
    return { ...base, data };
  };
  const previewFact = async () => {
    if (locked || inFlight.current || !subjectId || selectedFact?.consumed) return;
    const seq = ++factSequence.current, ctx = contextRef.current;
    inFlight.current = true; setError(null); setPreview(null); setFactReview(false); setBusy(true);
    try {
      const fact = buildFact(); if (fact.kind === "filing" && coverage.length > 0 && !sourceReview) throw new Error("선택한 원천과 실제 과거 접수 명세·공제액을 대조했는지 확인하세요.");
      const body = { expectedVersion: factBaseVersion, subjectId, ...(factId ? { factId } : {}), fact };
      const payload = JSON.stringify(body); if (previewRequest.current?.payload !== payload) previewRequest.current = { payload, requestId: crypto.randomUUID() };
      const res = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview_fact", ...body, requestId: previewRequest.current.requestId }) }); const data = await res.json(); if (!res.ok) throw new Error(apiError(data, res.status));
      if (seq !== factSequence.current || ctx !== contextRef.current) return;
      if (typeof data.previewHash !== "string" || data.normalizedFact?.subjectId !== subjectId || !Array.isArray(data.sourceIssues) || typeof data.canReview !== "boolean") throw new Error("조회한 사실 검토 결과가 일치하지 않습니다."); setPreview(data);
    } catch (e) { if (seq === factSequence.current && ctx === contextRef.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const saveFact = async () => {
    if (!preview || !previewRequest.current) return;
    try {
      const fact = buildFact(), body = { expectedVersion: factBaseVersion, subjectId, ...(factId ? { factId } : {}), fact };
      if (previewRequest.current.payload !== JSON.stringify(body)) { setError("입력 내용이 달라졌습니다. 검토 미리보기를 다시 실행하세요."); return; }
      const result = await runMutation({ action: "save_fact", ...body, expectedPreviewHash: preview.previewHash, reviewConfirmed: factReview }, "외부 사실을 새 판으로 보관했습니다. 근거 점검 상태를 확인하세요.", previewRequest.current.requestId);
      if (result) { setFactId(""); setFactBaseVersion(0); setFactForm(emptyFact(year, term)); setFactPeriods(null); setCoverage([]); setClaimedInputs({}); clearPreview(); await load(); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const editFact = (row: { fact: FactRevision; consumed: boolean }, readOnly: boolean) => {
    const f = row.fact;
    if (readOnly || row.consumed || f.kind === "refund" || f.data.amountSemantics !== "total_replacement") { setFactId(f.factId); setFactRevisionId(f.revisionId); clearPreview(); return; }
    if (f.year !== year || f.term !== term) { setError("해당 사실의 연도·기수를 먼저 선택하세요."); return; }
    const data = f.data as unknown as Record<string, unknown>, next = emptyFact(year, term); Object.assign(next, { kind: f.kind, state: f.state, from: f.from, to: f.to, amount: f.amount === null ? "" : String(f.amount), evidenceDocumentId: documentByEvidence(f.evidenceRef), externalKey: data.externalKey, documentDate: data.noticeDate ?? data.receiptDate ?? data.paidAt ?? "", previousPeriodSupply: data.previousPeriodSupply === null ? "" : String(data.previousPeriodSupply ?? ""), previousAdjustedTax: data.previousAdjustedTax === null ? "" : String(data.previousAdjustedTax ?? ""), priorFilingStatus: data.priorFilingStatus ?? "unknown", priorFilingEvidenceDocumentId: documentByEvidence(data.priorFilingEvidenceRef as string | null), paymentState: data.paymentState ?? "unknown", paymentEvidenceDocumentId: documentByEvidence(data.paymentEvidenceRef as string | null), noNoticeReason: data.reason ?? "below_minimum", reasonDetail: data.reasonDetail ?? "", filingType: data.filingType ?? "preliminary", returnType: data.returnType ?? "preliminary", sourceReconciliation: data.sourceReconciliation ?? "unknown", isNilReturn: data.isNilReturn ?? false, nilEvidenceDocumentId: documentByEvidence(data.nilEvidenceRef as string | null), targetNoticeFactId: data.targetNoticeFactId ?? "" });
    const totals = data.declaredTotals as Record<string, number> | null; for (const k of ["salesSupply", "salesTax", "purchaseSupply", "purchaseTax", "claimedTax"] as const) next[k] = totals?.[k] === undefined ? "" : String(totals[k]);
    next.documentNumber = String(data.noticeNumber ?? data.receiptNumber ?? data.externalKey ?? "");
    setFactId(f.factId); setFactBaseVersion(f.version); setFactRevisionId(""); setFactForm(next); setFactPeriods(f.periodCoverage); setCoverage(f.sourceCoverage); setClaimedInputs({}); setCoverageName(""); clearPreview();
  };
  const loadSources = async () => {
    if (!subjectId) return; const ctx = contextRef.current; setBusy(true); setError(null);
    try { const res = await fetch(`${ENDPOINT}?${new URLSearchParams({ view: "sources", subjectId, year: String(year), term: String(term) })}`, { cache: "no-store" }); const data = await res.json(); if (!res.ok) throw new Error(apiError(data, res.status)); if (ctx !== contextRef.current) return; if (!Array.isArray(data.sources) || !Array.isArray(data.issues)) throw new Error("현재 원천 목록을 확인할 수 없습니다."); setSources(data.sources); setSourceVisible(200); setSourceIssues(data.issues); }
    catch (e) { if (ctx === contextRef.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const importCoverage = async (input: File | undefined) => {
    if (!input) return; const seq = ++factSequence.current, ctx = contextRef.current;
    try { if (!input.size || input.size > MAX_FILE_BYTES) throw new Error("명세 JSON은 0바이트보다 크고 10MiB 이하여야 합니다."); const decoded = new TextDecoder("utf-8", { fatal: true }).decode(await input.arrayBuffer()); const values = readManifest(decoded); if (seq !== factSequence.current || ctx !== contextRef.current) return; setCoverage(values); setCoverageVisible(200); setClaimedInputs({}); setCoverageName(input.name); clearPreview(); setNotice("명세를 입력했습니다. 원문 증빙과 실제 과거 공제액을 대조한 후 서버 검토를 실행하세요."); }
    catch (e) { if (ctx === contextRef.current) setError(e instanceof Error ? e.message : String(e)); }
  };
  const loadArchive = async (snapshotId: string) => {
    const seq = ++archiveSequence.current; setArchiveId(snapshotId); setArchive(null); if (!snapshotId) return;
    try { const res = await fetch(`${ENDPOINT}?${new URLSearchParams({ view: "archive", snapshotId })}`, { cache: "no-store" }); const data = await res.json(); if (!res.ok) throw new Error(apiError(data, res.status)); if (seq !== archiveSequence.current) return; if (data.archive?.record?.snapshot_id !== snapshotId || data.archive?.origin !== "basis" || data.archive?.readOnly !== true) throw new Error("조회한 봉인 보관본이 일치하지 않습니다."); setArchive(data.archive); }
    catch (e) { if (seq === archiveSequence.current) setError(e instanceof Error ? e.message : String(e)); }
  };
  const seal = async () => {
    if (!selectedScope || !sealReview) return;
    const result = await runMutation({ action: "seal", subjectId, year, term, kind, expectedScopeHash: selectedScope.scopeHash, reviewConfirmed: true }, "신고 근거를 보관했습니다. 앱 내부확정이나 외부 접수는 별도입니다.");
    if (result) { setSealReview(false); await load(); await loadArchive(result.snapshotId); }
  };
  const docSelect = (label: string, value: string, change: (value: string) => void) => <CdSelect aria-label={label} label={label} value={value} onChange={e => change(e.target.value)}><option value="">증빙 문서를 선택하세요</option>{documents.map(d => <option key={d.documentId} value={d.documentId}>{d.fileName} · {d.createdAt.slice(0, 10)}</option>)}</CdSelect>;
  const factDisabled = locked || needsReload || !!factRevisionId || !!selectedFact?.consumed;

  return <div className="space-y-5" aria-busy={loading || busy}>
    <Section title="신고 근거 · 주체와 대상기간" hint="주체 확인, 외부 자료 검토, 근거 보관, 신고서 내부확정, 실제 접수·납부는 서로 다른 상태입니다.">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <CdSelect aria-label="신고 주체 선택" label="신고 주체 선택" value={subjectId} disabled={busy} onChange={e => changeContext(e.target.value)}><option value="">새 미확인 주체 등록</option>{overview?.subjects.map(s => <option key={s.subjectId} value={s.subjectId}>{s.corpNum || "등록번호 미확인"} · {display(s.state)} · {s.subjectId}</option>)}</CdSelect>
        <CdSelect aria-label="신고 귀속연도" label="신고 귀속연도" value={year} disabled={busy} onChange={e => changeContext(subjectId, Number(e.target.value))}><option value={2025}>2025년</option><option value={2026}>2026년</option></CdSelect>
        <CdSelect aria-label="신고 기수" label="신고 기수" value={term} disabled={busy} onChange={e => changeContext(subjectId, year, Number(e.target.value))}><option value={1}>1기</option><option value={2}>2기</option></CdSelect>
        <CdSelect aria-label="신고 종류" label="신고 종류" value={kind} disabled={busy} onChange={e => changeContext(subjectId, year, term, e.target.value as typeof kind)}><option value="preliminary">예정</option><option value="final">확정</option></CdSelect>
      </div>
      <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy || loading} onClick={() => void load()}><RefreshCw className="w-4 h-4" />현재 근거 다시 조회</button>
      {loading && <p role="status" className="text-sm cd-text-muted">신고 주체와 근거를 확인하고 있습니다.</p>}
      {error && <div role="alert" className="rounded-xl border p-3 text-sm" style={{ color: "var(--cd-error)", borderColor: "var(--cd-error)" }}>{error}</div>}
      {notice && <p role="status" className="text-sm cd-text">{notice}</p>}
      {needsReload && <p className="text-sm cd-text-muted">입력값은 보존했습니다. 현재 근거를 다시 조회하세요. 판이 바뀌었다면 최신 판으로 새 작성을 선택해 다시 대조하세요.</p>}
      {!loading && !canManage && <p className="text-sm cd-text-muted">조회 전용입니다. 증빙 등록과 검토·봉인은 재무 관리 권한이 필요합니다.</p>}
      <p className="text-xs cd-text-muted">봉인 이후 고지 납부, 확정신고 접수·납부, 소비 해제·후행 정정은 이번 화면에서 지원하지 않습니다.</p>
    </Section>

    <Section title="신고 주체 기준" hint="회사 방식은 증빙으로 확인하세요. 적용기간의 기준과 가장 최근 등록한 판을 구분합니다.">
      {overview?.subject && <div className="grid sm:grid-cols-2 gap-3 text-sm"><p>최신 등록판: {overview.subject.version}판 · {overview.subject.effectiveFrom} ~ {overview.subject.effectiveTo || "종료 미지정"}</p><p>선택기간 적용판: {overview.applicableSubject ? `${overview.applicableSubject.version}판 · ${display(overview.applicableSubject.mode)}` : "적용판 미확인"}</p></div>}
      {overview?.subjectRevisions.length ? <div className="flex flex-wrap gap-3 items-end"><CdSelect aria-label="주체 과거판 보기" label="주체 과거판 보기" value={subjectRevisionId} onChange={e => { setSubjectRevisionId(e.target.value); setSubjectReview(false); }} disabled={busy}><option value="">새 판 작성 화면</option>{overview.subjectRevisions.map(s => <option key={s.revisionId} value={s.revisionId}>{s.version}판 · {s.effectiveFrom} · {display(s.state)}</option>)}</CdSelect><button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={locked} onClick={copyLatestSubject}>최신 기준으로 새 판 작성</button></div> : null}
      {viewedSubject ? <div className="rounded-xl border cd-border-c p-4 text-sm space-y-2"><p className="font-semibold">과거 주체 {viewedSubject.version}판 · 읽기 전용</p><p>등록번호 {display(viewedSubject.corpNum)} · {display(viewedSubject.state)} · {display(viewedSubject.mode)}</p><p>적용기간 {viewedSubject.effectiveFrom} ~ {viewedSubject.effectiveTo || "종료 미지정"}</p><details><summary className="cursor-pointer">보관된 주체판 원문</summary><pre className="text-xs whitespace-pre-wrap break-all mt-2">{JSON.stringify(viewedSubject, null, 2)}</pre></details></div> : <fieldset disabled={locked || needsReload} className="space-y-4">
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          <CdInput aria-label="사업자등록번호" label="사업자등록번호" value={subjectForm.corpNum} onChange={e => updateSubject("corpNum", e.target.value)} placeholder="미확인이면 비워두세요" />
          <CdSelect aria-label="주체 검토 상태" label="주체 검토 상태" value={subjectForm.state} onChange={e => updateSubject("state", e.target.value as SubjectForm["state"])}><option value="unknown">미확인</option><option value="verified" disabled={!subjectId}>증빙 검토 완료</option></CdSelect>
          <CdSelect aria-label="예정신고·고지 방식" label="예정신고·고지 방식" value={subjectForm.mode} onChange={e => updateSubject("mode", e.target.value as SubjectForm["mode"])}><option value="unknown">미확인</option><option value="preliminary">예정신고</option><option value="notice">예정고지</option></CdSelect>
          <DateField label="주체 적용 시작일" value={subjectForm.effectiveFrom} onChange={v => updateSubject("effectiveFrom", v)} /><DateField label="주체 적용 종료일" value={subjectForm.effectiveTo} onChange={v => updateSubject("effectiveTo", v)} />
          <CdSelect aria-label="사업자 유형" label="사업자 유형" value={subjectForm.entityType} onChange={e => updateSubject("entityType", e.target.value as SubjectForm["entityType"])}><option value="unknown">미확인</option><option value="corporation">법인</option><option value="individual">개인 · 별도 검토</option></CdSelect>
          <CdSelect aria-label="과세 유형" label="과세 유형" value={subjectForm.vatRegime} onChange={e => updateSubject("vatRegime", e.target.value as SubjectForm["vatRegime"])}><option value="unknown">미확인</option><option value="general">일반과세</option><option value="simplified">간이과세 · 별도 검토</option><option value="exempt">면세 · 별도 검토</option></CdSelect>
          <CdSelect aria-label="신고 단위" label="신고 단위" value={subjectForm.filingUnit} onChange={e => updateSubject("filingUnit", e.target.value as SubjectForm["filingUnit"])}><option value="unknown">미확인</option><option value="single_business_place">단일 사업장</option><option value="business_unit">사업자단위 · 별도 검토</option><option value="consolidated_payment">총괄납부 · 별도 검토</option></CdSelect>
          {docSelect("주체 확인 증빙", subjectForm.evidenceDocumentId, v => updateSubject("evidenceDocumentId", v))}
        </div>
        {!subjectId && <p className="text-xs cd-text-muted">미확인 주체를 먼저 기록한 뒤 아래에서 원문 증빙을 첨부하세요.</p>}
        {subjectForm.state === "verified" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={subjectReview} onChange={e => setSubjectReview(e.target.checked)} />등록번호·적용기간·신고방식을 선택한 원문 증빙과 대조했습니다.</label>}
        <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={subjectBaseVersion === null || (subjectForm.state === "verified" && (!subjectReview || !subjectForm.evidenceDocumentId))} onClick={() => void saveSubject()}>{subjectId ? "주체 기준 새 판 저장" : "미확인 주체 기록"}</button>
      </fieldset>}
    </Section>

    <Section title="원문 증빙 보관" hint="원본 파일은 서버에서 보관하고 지문을 계산합니다. 파일 첨부만으로 접수·검토 완료가 되지는 않습니다.">
      <fieldset disabled={locked || !subjectId || needsReload} className="flex flex-wrap items-end gap-3"><label className="flex flex-col gap-1 text-sm">증빙 파일 · 최대 10MiB<input ref={uploadInput} aria-label="원문 증빙 파일" type="file" onChange={e => { setFile(e.target.files?.[0] ?? null); uploadRequest.current = null; }} /></label><button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={!file} onClick={() => void upload()}><Upload className="w-4 h-4" />원문 증빙 업로드</button></fieldset>
      {!subjectId && <p className="text-sm cd-text-muted">미확인 주체를 먼저 등록해야 증빙을 연결할 수 있습니다.</p>}
      <ul className="divide-y cd-border-c">{documents.map(d => <li key={d.documentId} className="py-3 flex flex-wrap justify-between gap-2 text-sm"><span>{d.fileName} · {d.sizeBytes.toLocaleString("ko-KR")}바이트 · {d.createdAt.slice(0, 10)}</span><button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => void download(d)}><Download className="w-4 h-4" />원문 다운로드</button></li>)}</ul>
      {subjectId && !documents.length && <p className="text-sm cd-text-muted">보관된 원문 증빙이 없습니다.</p>}
    </Section>

    <Section title="봉인 전 외부 사실" hint="과거 접수·고지·미징수와 고지 원금 납부를 기록합니다. 봉인 이후 접수·현금 사건은 별도 후속 기능의 대상입니다.">
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="cd-text-muted"><tr><th className="py-2 pr-3">종류·상태</th><th className="pr-3">기간·금액</th><th className="pr-3">판·사용</th><th>조회</th></tr></thead><tbody>{overview?.facts.map(row => <tr key={row.fact.revisionId} className="border-b cd-border-c last:border-0"><td className="py-3 pr-3">{display(row.fact.kind)} · {display(row.fact.state)}</td><td className="pr-3">{row.fact.from} ~ {row.fact.to}<br />{display(row.fact.amount)}원</td><td className="pr-3">{row.fact.version}판 · {row.consumed ? "봉인에 사용됨" : "소비 없음"}</td><td><button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy} onClick={() => editFact(row, true)}><History className="w-4 h-4" />보관판 보기</button><button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={locked || row.consumed} onClick={() => editFact(row, false)}>새 판 작성</button></td></tr>)}</tbody></table></div>
      <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={locked || !subjectId} onClick={() => { setFactId(""); setFactBaseVersion(0); setFactRevisionId(""); setFactForm(emptyFact(year, term)); setFactPeriods(null); setCoverage([]); setClaimedInputs({}); setCoverageName(""); clearPreview(); }}>새 외부 사실 작성</button>
      {viewedFact ? <div className="rounded-xl border cd-border-c p-4 space-y-2"><p className="font-semibold text-sm">외부 사실 보관판 · 읽기 전용</p><p className="text-sm">{viewedFact.factId} · {viewedFact.version}판</p><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(viewedFact, null, 2)}</pre></div> : <fieldset disabled={factDisabled || !subjectId} className="space-y-4">
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          <CdSelect aria-label="외부 사실 종류" label="외부 사실 종류" value={factForm.kind} disabled={!!factId} onChange={e => { updateFact("kind", e.target.value as FactForm["kind"]); setCoverage([]); }}><option value="notice">예정고지</option><option value="no_notice">미징수</option><option value="filing">과거 신고 접수</option><option value="payment">봉인 전 고지 원금 납부</option></CdSelect>
          <CdSelect aria-label="사실 검토 상태" label="사실 검토 상태" value={factForm.state} onChange={e => updateFact("state", e.target.value as FactForm["state"])}><option value="recorded">기록 보관</option><option value="verified">증빙 검토 완료로 저장</option>{factId && <option value="withdrawn">철회 이력 추가</option>}</CdSelect>
          <CdInput aria-label={factForm.kind === "notice" ? "고지 문서번호" : factForm.kind === "filing" ? "접수번호" : "공식 문서·조회 식별번호"} label={factForm.kind === "notice" ? "고지 문서번호" : factForm.kind === "filing" ? "접수번호" : "공식 문서·조회 식별번호"} value={factForm.documentNumber} disabled={!!factId && !["notice", "filing"].includes(factForm.kind)} onChange={e => updateFact("documentNumber", e.target.value)} hint="요청번호·파일명 대신 실제 문서 식별자를 입력하세요." />
          <DateField label="사실 귀속 시작일" value={factForm.from} onChange={v => updateFact("from", v)} /><DateField label="사실 귀속 종료일" value={factForm.to} onChange={v => updateFact("to", v)} />
          <AmountField label={factForm.kind === "payment" ? "실제 납부 원금" : factForm.kind === "notice" ? "유효 예정고지액" : factForm.kind === "no_notice" ? "미징수 금액 · 0원 명시" : "접수 신고세액"} value={factForm.amount} onChange={v => updateFact("amount", v)} nullable={factForm.state === "recorded"} />
          {docSelect("사실 원문 증빙", factForm.evidenceDocumentId, v => updateFact("evidenceDocumentId", v))}
          {factForm.kind !== "no_notice" && <DateField label={factForm.kind === "payment" ? "실제 납부일" : factForm.kind === "filing" ? "접수일" : "고지일"} value={factForm.documentDate} onChange={v => updateFact("documentDate", v)} />}
          {factForm.kind === "payment" && <CdSelect aria-label="납부 대상 고지" label="납부 대상 고지" value={factForm.targetNoticeFactId} onChange={e => updateFact("targetNoticeFactId", e.target.value)}><option value="">고지를 선택하세요</option>{overview?.facts.filter(r => r.fact.kind === "notice" && !r.consumed).map(r => <option key={r.fact.factId} value={r.fact.factId}>{r.fact.data.externalKey} · {display(r.fact.amount)}원</option>)}</CdSelect>}
        </div>
        {["notice", "no_notice"].includes(factForm.kind) && <div className="grid sm:grid-cols-2 gap-3"><AmountField label="직전 과세기간 공급가액" value={factForm.previousPeriodSupply} onChange={v => updateFact("previousPeriodSupply", v)} nullable /><CdSelect aria-label="예정·조기신고 이력 확인" label="예정·조기신고 이력 확인" value={factForm.priorFilingStatus} onChange={e => updateFact("priorFilingStatus", e.target.value as FactForm["priorFilingStatus"])}><option value="unknown">미확인</option><option value="none">해당 반기에 예정·조기신고 없음 확인</option></CdSelect>{docSelect("예정·조기신고 없음 확인 증빙", factForm.priorFilingEvidenceDocumentId, v => updateFact("priorFilingEvidenceDocumentId", v))}</div>}
        {factForm.kind === "notice" && <div className="grid sm:grid-cols-2 gap-3"><CdSelect aria-label="고지 납부내역 확인 상태" label="고지 납부내역 확인 상태" value={factForm.paymentState} onChange={e => updateFact("paymentState", e.target.value as FactForm["paymentState"])}><option value="unknown">미확인</option><option value="complete">전체 조회·대사 완료 · 납부 완료 아님</option></CdSelect>{docSelect("납부내역 전체 조회 증빙", factForm.paymentEvidenceDocumentId, v => updateFact("paymentEvidenceDocumentId", v))}<p className="text-xs cd-text-muted sm:col-span-2">전체 조회 결과 실제 납부가 0원일 수도 있습니다. 고지 차감액과 현금 납부액은 별도입니다.</p></div>}
        {factForm.kind === "no_notice" && <div className="grid sm:grid-cols-2 gap-3"><CdSelect aria-label="미징수 사유" label="미징수 사유" value={factForm.noNoticeReason} onChange={e => updateFact("noNoticeReason", e.target.value as FactForm["noNoticeReason"])}><option value="below_minimum">기준금액 미만</option><option value="official_other">기타 공식 사유 · 별도 검토</option></CdSelect><AmountField label="직전 조정 납부세액" value={factForm.previousAdjustedTax} onChange={v => updateFact("previousAdjustedTax", v)} nullable /><CdTextarea aria-label="미징수 확인 내용" label="미징수 확인 내용" value={factForm.reasonDetail} onChange={e => updateFact("reasonDetail", e.target.value)} className="sm:col-span-2" /></div>}
        {factForm.kind === "filing" && <div className="space-y-4 rounded-xl border cd-border-c p-4">
          <div className="grid sm:grid-cols-2 gap-3"><CdSelect aria-label="과거 접수 신고유형" label="과거 접수 신고유형" value={factForm.filingType} onChange={e => updateFact("filingType", e.target.value as FactForm["filingType"])}><option value="preliminary">예정신고</option><option value="final">과거 확정신고 · 범위 확인</option><option value="late">기한후 신고</option><option value="amended">수정신고</option><option value="early_refund">조기환급 · 계산 미지원</option><option value="correction_claim">경정청구 · 계산 미지원</option></CdSelect>{["late", "amended", "correction_claim"].includes(factForm.filingType) && <CdSelect aria-label="본래 신고유형" label="본래 신고유형" value={factForm.returnType} onChange={e => updateFact("returnType", e.target.value as FactForm["returnType"])}><option value="preliminary">예정신고</option><option value="final">확정신고</option><option value="early_refund">조기환급</option></CdSelect>}<CdSelect aria-label="기신고 원천 대사 상태" label="기신고 원천 대사 상태" value={factForm.sourceReconciliation} onChange={e => updateFact("sourceReconciliation", e.target.value as FactForm["sourceReconciliation"])}><option value="unknown">명세 미확인</option><option value="partial">일부 대사</option><option value="complete">원문 전체 명세 대사 완료</option></CdSelect></div>
          {factPeriods && <p className="text-xs cd-text-muted">보관된 신고 명세 범위: {factPeriods.map(p => `${p.from} ~ ${p.to}`).join(", ") || "범위 없음"}. 기존 범위를 그대로 대조합니다.</p>}<p className="text-xs cd-text-muted">현재 내부 확정판의 실제 접수 결과를 이 과거 사실로 추가하지 마세요. 신고 후 접수·납부 관리는 아직 제공되지 않습니다. 원천 지문은 현재 목록 또는 파일 명세에서만 가져오며 서버가 다시 검증합니다.</p>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{([['salesSupply','접수 명세 매출 공급가액'],['salesTax','접수 명세 매출세액'],['purchaseSupply','접수 명세 매입 공급가액'],['purchaseTax','접수 명세 매입세액'],['claimedTax','접수 명세 실제 공제세액']] as const).map(([key,label]) => <AmountField key={key} label={label} value={factForm[key]} onChange={v => updateFact(key, v)} />)}</div>
          <label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={factForm.isNilReturn} onChange={e => updateFact("isNilReturn", e.target.checked)} />실제 무실적 신고 근거가 있습니다 · 원천 수집0건과 다름</label>{factForm.isNilReturn && docSelect("무실적 신고 증빙", factForm.nilEvidenceDocumentId, v => updateFact("nilEvidenceDocumentId", v))}
          <div className="flex flex-wrap items-end gap-3"><button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => void loadSources()}>현재 원천 후보 조회</button><label className="flex flex-col gap-1 text-sm">기신고 원천 명세 JSON<input aria-label="기신고 원천 명세 JSON" type="file" accept=".json,application/json" onChange={e => void importCoverage(e.target.files?.[0])} /></label></div>
          {coverageName && <p className="text-xs cd-text-muted">입력한 명세: {coverageName} · {coverage.length}행. 원문 보관은 위 증빙 업로드에서 별도로 연결하세요.</p>}
          {sourceIssues.length > 0 && <ul className="list-disc pl-5 text-sm">{sourceIssues.map((issue, i) => <li key={i}>{issue.message ?? issue.reason ?? issue.code}</li>)}</ul>}
          {sources.length > 0 && <div className="max-h-60 overflow-auto border cd-border-c rounded-xl p-3"><p className="text-xs cd-text-muted mb-2">현재 후보 {sources.length}건 · {Math.min(sourceVisible, sources.length)}건 표시</p>{sources.slice(0,sourceVisible).map(row => <label key={sourceKey(row)} className="flex gap-2 py-2 text-sm"><input type="checkbox" checked={coverage.some(r => sourceKey(r) === sourceKey(row))} onChange={e => { setCoverage(old => e.target.checked ? [...old, { ...row, claimedTax: 0 }] : old.filter(r => sourceKey(r) !== sourceKey(row))); setClaimedInputs(old => ({ ...old, [sourceKey(row)]: row.direction === "sales" ? "0" : "" })); clearPreview(); }} /><span>{row.date} · {row.direction === "sales" ? "매출" : "매입"} · {row.canonicalKey} · 공급 {display(row.supply)} / 세액 {display(row.tax)}</span></label>)}{sourceVisible < sources.length && <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => setSourceVisible(v => v + 200)}>원천 후보 더 보기</button>}</div>}
          {coverage.length > 0 && <div className="max-h-80 overflow-auto"><table className="w-full text-left text-sm"><caption className="text-left font-semibold mb-2">선택 명세 {coverage.length}행 · 실제 과거 공제액</caption><thead className="cd-text-muted"><tr><th className="py-2">원천</th><th>세액</th><th>과거 실제 공제액</th><th /></tr></thead><tbody>{coverage.slice(0,coverageVisible).map(row => <tr key={sourceKey(row)} className="border-b cd-border-c"><td className="py-2 pr-3 break-all">{row.date} · {row.canonicalKey}</td><td className="pr-3">{display(row.tax)}</td><td><input aria-label={`${row.sourceId} 과거 실제 공제액`} className="cd-input" inputMode="numeric" value={claimedInputs[sourceKey(row)] ?? String(row.claimedTax)} disabled={row.direction === "sales"} onChange={e => { setClaimedInputs(old => ({ ...old, [sourceKey(row)]: e.target.value })); clearPreview(); }} /></td><td><button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => { setCoverage(old => old.filter(r => sourceKey(r) !== sourceKey(row))); clearPreview(); }}>제외</button></td></tr>)}</tbody></table>{coverageVisible < coverage.length && <button type="button" className="cd-btn cd-btn-soft cd-btn-sm mt-2" onClick={() => setCoverageVisible(v => v + 200)}>선택 명세 더 보기</button>}</div>}
          <label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={sourceReview} onChange={e => { setSourceReview(e.target.checked); setPreview(null); setFactReview(false); }} />선택/입력 명세를 실제 과거 접수 실적 및 공제액과 대조했습니다. 현재 후보 조회만으로 과거 신고가 입증되지 않음을 확인했습니다.</label>
        </div>}
        <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => void previewFact()}><FileCheck2 className="w-4 h-4" />외부 사실 검토 미리보기</button>
        {preview && <div className="rounded-xl border cd-border-c p-4 space-y-3"><p className="font-semibold text-sm">서버 검토 결과 · {preview.canReview ? "검토 가능" : "검토 보류"}</p><p className="text-sm">{display(preview.normalizedFact.kind)} · {display(preview.normalizedFact.amount)}원 · {preview.normalizedFact.from} ~ {preview.normalizedFact.to}</p>{preview.sourceIssues.length > 0 && <ul className="list-disc pl-5 text-sm">{preview.sourceIssues.map((issue,i) => <li key={i}>{issue.message ?? issue.reason ?? issue.code}</li>)}</ul>}{preview.scope.issues.length > 0 && <ul className="list-disc pl-5 text-sm">{preview.scope.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul>}<p className="text-xs cd-text-muted">근거 범위 점검: {preview.scope.status === "ready" ? "선언 근거 기준 준비됨" : "미확인·미지원 항목 있음"}. 기록 저장과 신고 근거 봉인은 별도입니다.</p>
          {factForm.state !== "recorded" && <label className="flex gap-2 text-sm"><input type="checkbox" checked={factReview} onChange={e => setFactReview(e.target.checked)} />원문·금액·기간·대사 결과를 검토했고 이 판의 검토 상태로 저장합니다.</label>}
          <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={factForm.state !== "recorded" && (!factReview || !preview.canReview)} onClick={() => void saveFact()}>{factForm.state === "recorded" ? "검토 전 사실 기록" : "검토 결과 새 판 저장"}</button>
        </div>}
      </fieldset>}
    </Section>

    <Section title="현재 근거 점검과 봉인" hint="저장된 근거 기준의 기간·고지 차감·소비 계획입니다. 저장하지 않은 입력·미리보기는 봉인에 포함되지 않습니다. 실제 세액·원천 대사는 신고서 계산에서 확인합니다.">
      {overview?.scopeError && <p role="alert" className="text-sm cd-error-text">{overview.scopeError.error}</p>}
      {selectedScope ? <><div className="grid sm:grid-cols-2 gap-3 text-sm"><p>대상기간 {selectedScope.dateFrom} ~ {selectedScope.dateTo}</p><p>적용 주체판 {selectedScope.subjectRevisionId} · {display(selectedScope.mode)}</p><p>유효 고지 차감 {display(selectedScope.noticeDeduction)}원</p><p>확인된 납부 원금 {display(selectedScope.payment.paidPrincipal)}원 · 미납 원금 {display(selectedScope.payment.outstandingPrincipal)}원</p></div><p className="text-xs cd-text-muted">납부내역 확인: {display(selectedScope.payment.state)} · 차감 고지와 실제 납부는 별도입니다.</p>{selectedScope.issues.length > 0 && <ul className="list-disc pl-5 text-sm space-y-1">{selectedScope.issues.map((issue,i) => <li key={i}>{issue.message}</li>)}</ul>}<details className="border cd-border-c rounded-xl p-3"><summary className="cursor-pointer text-sm">사용할 사실·기신고 제외 범위</summary><ul className="mt-3 text-xs space-y-2">{selectedScope.consumptions.map(c => <li key={`${c.factId}:${c.kind}`}>{display(c.kind)} · {c.factId} · {c.revisionId} · {display(c.amount)}원</li>)}</ul><p className="text-sm mt-2">기신고 제외 원천 {selectedScope.excludedSources.length}건 · 기간 전체를 일괄 제외하지 않습니다.</p></details><label className="flex gap-2 text-sm"><input type="checkbox" disabled={locked || needsReload || !selectedScope.canCalculate} checked={sealReview} onChange={e => setSealReview(e.target.checked)} />주체판·기간·고지·원천 명세와 사용할 근거를 확인했습니다. 근거 보관은 외부 접수·납부가 아닙니다.</label><button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={locked || needsReload || selectedScope.status !== "ready" || !selectedScope.canCalculate || !sealReview} onClick={() => void seal()}>신고 근거 보관</button></> : <p className="text-sm cd-text-muted">신고 주체와 실제 증빙을 등록한 뒤 현재 근거를 점검하세요.</p>}
    </Section>

    <Section title="봉인 근거 보관함" hint="선택한 과거 보관본은 읽기 전용입니다. 현재 진단과 보관 당시 값을 섞지 않습니다.">
      <CdSelect aria-label="봉인 근거 선택" label="봉인 근거 선택" value={archiveId} disabled={busy} onChange={e => void loadArchive(e.target.value)}><option value="">보관본을 선택하세요</option>{overview?.archives.map(a => <option key={a.snapshotId} value={a.snapshotId}>{a.year}년 {a.term}기 {display(a.kind)} · {a.snapshotId}</option>)}</CdSelect>
      {archive && <div className="space-y-3"><p className="text-sm font-semibold">근거 보관본 {archiveId} · 읽기 전용 · 세액 신고서 확정 아님</p><details className="rounded-xl border cd-border-c p-3"><summary className="cursor-pointer text-sm">보관 당시 근거 상세</summary><pre className="text-xs whitespace-pre-wrap break-all mt-3">{JSON.stringify(archive.scope, null, 2)}</pre></details><button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy} onClick={() => onOpenBasis(archiveId)}>이 근거로 신고서 계산</button></div>}
    </Section>
  </div>;
}
