"use client";

// 신규 사업장 검토(F03) — 사업장 마스터와 매칭되지 않은 기업·공장 후보. 목록에서 어느 자료·프로젝트에서 나왔는지 먼저 보이고,
// 상세에서 필드별 근거를 확인한 뒤 기존 사업장 연결·신규 등록·보류·제외한다. 주소·사업자번호를 추정해 채우지 않는다.

import { useCallback, useEffect, useRef, useState } from "react";
import { CdBadge, CdButton, CdCheckbox, CdDateInput, CdInput, CdModal, CdSelect, CdTable, CdTabs, CdTextarea, useCdToast } from "@/components/cdash";
import type { FacilityCandidate } from "@/lib/intel/project-intelligence-types";
import type { CandidateSummary } from "@/lib/intel/discovery-overview";
import { intelApi, intelDate, intelSourceLabel, intelTime, jsonBody, safeIntelUrl } from "./intelligence-client";
import { IntelligenceLookup } from "./IntelligenceLookup";
import type { IntelSignalDetail } from "./intel-shared";

const PAGE = 50;
const STATUS: Record<FacilityCandidate["status"], string> = { new: "미검토", in_review: "검토 중", linked_existing: "기존 연결", registered: "등록", hold: "보류", rejected: "제외" };
const STATUS_TONE: Record<FacilityCandidate["status"], "idle" | "info" | "success" | "warn"> = { new: "info", in_review: "info", linked_existing: "success", registered: "success", hold: "warn", rejected: "idle" };
type StatusFilter = FacilityCandidate["status"] | "";
type ReviewForm = { action: "link" | "register" | "hold" | "reject" | "review"; facilityId: string; companyName: string; siteAddress: string; businessRegistrationNo: string; reason: string; reviewAt: string; allowDuplicateBusinessRegistrationNo: boolean };
const FIELD_LABELS: Record<string, string> = { companyName: "회사명", siteAddress: "사업장 주소", industry: "업종", businessRegistrationNo: "사업자등록번호" };

function CandidateEvidence({ candidate }: { candidate: FacilityCandidate }) {
  const [sources, setSources] = useState<Array<{ id: string; signal?: IntelSignalDetail; error?: string }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let canceled = false; setLoading(true); setSources([]);
    const ids = Array.isArray(candidate.evidence.signalIds) ? [...new Set(candidate.evidence.signalIds.filter((id): id is string => typeof id === "string"))].slice(0, 20) : [];
    void Promise.all(ids.map(async (id) => { try { return { id, signal: (await intelApi<{ signal: IntelSignalDetail }>(`/api/sales/intel/signals/${encodeURIComponent(id)}`)).signal }; } catch (error) { return { id, error: (error as Error).message }; } })).then((result) => { if (!canceled) { setSources(result); setLoading(false); } });
    return () => { canceled = true; };
  }, [candidate]);
  const fields = candidate.evidence.fields && typeof candidate.evidence.fields === "object" ? Object.entries(candidate.evidence.fields as Record<string, unknown>).filter(([key]) => key in FIELD_LABELS) : [];
  return <>
    {fields.length > 0 && <section>
      <h3 className="intel-section mb-3">필드별 근거</h3>
      <CdTable bare rows={fields} rowKey={([key]) => key} columns={[
        { key: "label", header: "항목", widthClass: "w-32", render: ([key]) => FIELD_LABELS[key] },
        { key: "value", header: "수집된 값", render: ([, raw]) => { const field = raw && typeof raw === "object" ? raw as { value?: unknown } : {}; return typeof field.value === "string" ? field.value : <span className="cd-text-muted">미확인</span>; } },
        { key: "state", header: "확인", widthClass: "w-28", render: ([, raw]) => (raw as { confirmed?: boolean })?.confirmed === true ? <CdBadge tone="success">확인</CdBadge> : <CdBadge tone="idle">확인 필요</CdBadge> },
      ]} />
    </section>}
    <section>
      <h3 className="intel-section mb-3">수집 근거</h3>
      {loading ? <p className="intel-prose cd-text-muted">근거를 불러오는 중…</p> : sources.length ? <ul className="intel-rows border-b cd-border-c">{sources.map(({ id, signal, error }) => (
        <li className="py-3" key={id}>{error ? <p className="intel-error">근거 조회: {error}</p> : <>
          {safeIntelUrl(signal?.url) ? <a className="intel-link" href={safeIntelUrl(signal?.url)!} target="_blank" rel="noopener noreferrer">{signal?.reportName ?? "수집 자료"}</a> : <p className="font-medium">{signal?.reportName ?? "수집 자료"}</p>}
          <p className="intel-table cd-text-muted mt-1">{intelSourceLabel(signal?.source)} · {intelDate(signal?.disclosedAt)}</p>
          {signal?.summary && <p className="intel-compact cd-text-muted mt-2">{signal.summary}</p>}
        </>}</li>
      ))}</ul> : <p className="intel-prose cd-text-muted">연결된 수집 근거가 없습니다. 사업장 등록 전에 회사명과 주소를 직접 확인하세요.</p>}
    </section>
  </>;
}

export function FacilityCandidatesPanel({ canEdit, onOpenProject }: { canEdit: boolean; onOpenProject: (projectId: string) => void }) {
  const { toast } = useCdToast();
  const [candidates, setCandidates] = useState<FacilityCandidate[]>([]);
  const [summaries, setSummaries] = useState<Record<string, CandidateSummary>>({});
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<StatusFilter>("new");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [selected, setSelected] = useState<FacilityCandidate | null>(null);
  const [form, setForm] = useState<ReviewForm>({ action: "review", facilityId: "", companyName: "", siteAddress: "", businessRegistrationNo: "", reason: "", reviewAt: "", allowDuplicateBusinessRegistrationNo: false });
  const keys = useRef(new Map<string, string>());
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await intelApi<{ candidates: FacilityCandidate[]; total: number; summaries?: Record<string, CandidateSummary> }>(`/api/sales/intel/candidates?limit=${PAGE}&offset=${offset}${status ? `&status=${status}` : ""}`);
      setCandidates(data.candidates); setTotal(data.total); setSummaries(data.summaries ?? {}); setError("");
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [offset, status]);
  useEffect(() => { void reload(); }, [reload]);
  function open(candidate: FacilityCandidate) { setSelected(candidate); setReviewError(""); setForm({ action: candidate.status === "new" ? "review" : "link", facilityId: candidate.facilityId ?? "", companyName: candidate.companyName, siteAddress: candidate.siteAddress ?? "", businessRegistrationNo: candidate.businessRegistrationNo ?? "", reason: candidate.reason ?? "", reviewAt: candidate.reviewAt?.slice(0, 10) ?? "", allowDuplicateBusinessRegistrationNo: false }); }
  async function save() {
    if (!selected) return;
    const payload = { ...form, version: selected.version };
    const fingerprint = JSON.stringify([selected.candidateId, payload]);
    if (!keys.current.has(fingerprint)) keys.current.set(fingerprint, crypto.randomUUID());
    setBusy(true); setReviewError("");
    try { await intelApi(`/api/sales/intel/candidates/${selected.candidateId}`, { method: "PATCH", ...jsonBody({ ...payload, requestKey: keys.current.get(fingerprint) }) }); setSelected(null); await reload(); toast("사업장 검토 결과를 저장했습니다.", "success"); }
    catch (e) { setReviewError((e as Error).message); } finally { setBusy(false); }
  }
  const writable = canEdit && selected && !["linked_existing", "registered"].includes(selected.status);
  const summary = selected ? summaries[selected.candidateId] : undefined;

  return (
    <div className="intel-stack">
      {error && <div className="intel-error" role="alert">{error}</div>}
      <section className="cd-card">
        <div className="intel-card-head">
          <div><h2 className="intel-section">신규 사업장 후보</h2><span className="intel-table cd-text-muted">{total.toLocaleString()}건</span></div>
        </div>
        <div className="intel-toolbar">
          <CdTabs variant="pill" active={status} onChange={(key) => { setStatus(key); setOffset(0); }} items={[
            { key: "new" as StatusFilter, label: "미검토" },
            { key: "in_review" as StatusFilter, label: "검토 중" },
            { key: "hold" as StatusFilter, label: "보류" },
            { key: "linked_existing" as StatusFilter, label: "기존 연결" },
            { key: "registered" as StatusFilter, label: "등록" },
            { key: "rejected" as StatusFilter, label: "제외" },
            { key: "" as StatusFilter, label: "전체" },
          ]} />
        </div>
        <p className="intel-table cd-text-muted px-5 pb-3">수집 자료의 기업·공장이 등록된 사업장과 매칭되지 않은 후보입니다. 등록 전에도 브리핑과 영업 발굴에 나타납니다.</p>
        <CdTable
          bare
          loading={loading}
          rows={candidates}
          rowKey={(candidate) => candidate.candidateId}
          onRowClick={open}
          empty={status === "new" ? "검토할 신규 사업장 후보가 없습니다." : "해당 상태의 후보가 없습니다."}
          columns={[
            { key: "company", header: "회사 · 사업장", render: (candidate) => <><p className="font-medium">{candidate.companyName}</p><p className="intel-table cd-text-muted">{candidate.siteAddress ?? "주소 미확인"}</p></> },
            { key: "evidence", header: "근거 자료", render: (candidate) => { const s = summaries[candidate.candidateId]; return s?.firstTitle ? <><p className="intel-compact">{s.firstTitle}</p><p className="intel-table cd-text-muted">{intelSourceLabel(s.firstSource)} · {intelDate(s.firstDate)}{s.evidenceCount > 1 ? ` · 외 ${s.evidenceCount - 1}건` : ""}</p></> : <span className="cd-text-muted">근거 없음</span>; } },
            { key: "project", header: "투자 프로젝트", widthClass: "w-28", render: (candidate) => { const s = summaries[candidate.candidateId]; return s?.projectId ? <button type="button" className="intel-link intel-compact text-left" onClick={(event) => { event.stopPropagation(); onOpenProject(s.projectId!); }} title={s.projectTitle ?? undefined}>프로젝트 보기</button> : <span className="cd-text-muted">–</span>; } },
            { key: "status", header: "상태", widthClass: "w-28", render: (candidate) => <CdBadge tone={STATUS_TONE[candidate.status]}>{STATUS[candidate.status]}</CdBadge> },
            { key: "date", header: "재검토일", widthClass: "w-28", render: (candidate) => candidate.reviewAt ? intelDate(candidate.reviewAt) : <span className="cd-text-muted">–</span> },
          ]}
        />
        <div className="intel-card-foot">
          <span className="intel-table cd-text-muted">{total ? `${(offset + 1).toLocaleString()}–${Math.min(total, offset + PAGE).toLocaleString()} / 총 ${total.toLocaleString()}건` : "0건"}</span>
          <div className="flex gap-2"><CdButton size="sm" disabled={!offset || loading} onClick={() => setOffset(Math.max(0, offset - PAGE))}>이전</CdButton><CdButton size="sm" disabled={offset + PAGE >= total || loading} onClick={() => setOffset(offset + PAGE)}>다음</CdButton></div>
        </div>
      </section>

      <CdModal open={selected !== null} onClose={() => !busy && setSelected(null)} title={selected ? `${selected.companyName} · 사업장 후보 검토` : "사업장 후보 검토"} size="lg" closeOnBackdrop={false} footer={<><CdButton disabled={busy} onClick={() => setSelected(null)}>닫기</CdButton>{writable && <CdButton variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "저장 중…" : "검토 저장"}</CdButton>}</>}>
        {selected && <div className="intel-ui intel-stack">
          {reviewError && <div role="alert" className="intel-error">{reviewError}</div>}
          <dl className="intel-dl">
            <dt>상태</dt><dd><CdBadge tone={STATUS_TONE[selected.status]}>{STATUS[selected.status]}</CdBadge>{selected.reason ? ` ${selected.reason}` : ""}</dd>
            <dt>주소</dt><dd>{selected.siteAddress ?? "미확인"}</dd>
            <dt>업종</dt><dd>{selected.industry ?? "미확인"}</dd>
            {summary?.projectId && <><dt>투자 프로젝트</dt><dd><button type="button" className="intel-link text-left" onClick={() => { setSelected(null); onOpenProject(summary.projectId!); }}>{summary.projectTitle}</button></dd></>}
            <dt>후보 생성</dt><dd>{intelTime(selected.createdAt)}</dd>
          </dl>
          <CandidateEvidence candidate={selected} />
          {writable ? <fieldset disabled={busy} className="intel-form intel-subsection">
            <h3 className="intel-section">검토 결과</h3>
            <CdSelect label="처리" value={form.action} onChange={(event) => setForm({ ...form, action: event.target.value as ReviewForm["action"] })}><option value="review">검토 시작</option><option value="link">기존 사업장 연결</option><option value="register">새 사업장 등록</option><option value="hold">보류</option><option value="reject">제외</option></CdSelect>
            {form.action === "link" && <IntelligenceLookup kind="facility" label="연결할 사업장" value={form.facilityId} onChange={(value) => setForm({ ...form, facilityId: value })} />}
            {form.action === "register" && <><CdInput required label="확인한 회사명" value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })} /><CdInput required label="확인한 사업장 주소" value={form.siteAddress} onChange={(event) => setForm({ ...form, siteAddress: event.target.value })} /><CdInput label="사업자등록번호" value={form.businessRegistrationNo} onChange={(event) => setForm({ ...form, businessRegistrationNo: event.target.value })} /><CdCheckbox label="같은 사업자등록번호를 가진 별도 공장임을 확인했습니다" checked={form.allowDuplicateBusinessRegistrationNo} onChange={(event) => setForm({ ...form, allowDuplicateBusinessRegistrationNo: event.target.checked })} /></>}
            <CdTextarea label="검토 사유" required={["hold", "reject"].includes(form.action)} rows={3} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
            {form.action === "hold" && <CdDateInput label="재검토일" required value={form.reviewAt} onChange={(value) => setForm({ ...form, reviewAt: value })} />}
          </fieldset> : !canEdit ? <p className="intel-table cd-text-muted">검토 결과를 저장하려면 영업 수정 권한이 필요합니다.</p> : null}
        </div>}
      </CdModal>
    </div>
  );
}
