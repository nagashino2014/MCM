"use client";

// 신규 사업장 검토(F03) — 사업장 마스터와 매칭되지 않은 기업·공장 후보. 목록에서 어느 자료·프로젝트에서 나왔는지 먼저 보이고,
// 상세에서 필드별 근거를 확인한 뒤 기존 사업장 연결·신규 등록·보류·제외한다. 주소·사업자번호를 추정해 채우지 않는다.

import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, ExternalLink, RefreshCw } from "lucide-react";
import { CdButton, CdCheckbox, CdDateInput, CdInput, CdModal, CdSelect, CdTextarea, useCdToast } from "@/components/cdash";
import type { FacilityCandidate } from "@/lib/intel/project-intelligence-types";
import type { CandidateSummary } from "@/lib/intel/discovery-overview";
import { intelApi, intelDate, intelSourceLabel, intelTime, jsonBody, safeIntelUrl } from "./intelligence-client";
import { IntelligenceLookup } from "./IntelligenceLookup";
import type { IntelSignalDetail } from "./intel-shared";
import { IntelCard, IntelChips, IntelEmpty, IntelError, IntelSubhead, IntelTile } from "./intel-ui-kit";

const PAGE = 50;
const STATUS: Record<FacilityCandidate["status"], string> = { new: "미검토", in_review: "검토 중", linked_existing: "기존 연결", registered: "등록", hold: "보류", rejected: "제외" };
const STATUS_PILL: Record<FacilityCandidate["status"], string> = { new: "cd-pill-info", in_review: "cd-pill-info", linked_existing: "cd-pill-success", registered: "cd-pill-success", hold: "cd-pill-warn", rejected: "cd-pill-idle" };
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
      <IntelSubhead>필드별 근거</IntelSubhead>
      <div className="flex flex-col">
        {fields.map(([key, raw]) => {
          const field = raw && typeof raw === "object" ? raw as { value?: unknown; confirmed?: boolean } : {};
          return (
            <div key={key} className="flex items-center gap-2 py-1.5 border-b cd-border-c last:border-b-0 text-sm">
              <span className="cd-text-muted text-xs font-bold shrink-0" style={{ width: 96 }}>{FIELD_LABELS[key]}</span>
              <span className="cd-text flex-1 min-w-0">{typeof field.value === "string" ? field.value : <span className="cd-text-faint">미확인</span>}</span>
              <span className={`cd-pill ${field.confirmed === true ? "cd-pill-success" : "cd-pill-idle"}`}>{field.confirmed === true ? "확인" : "확인 필요"}</span>
            </div>
          );
        })}
      </div>
    </section>}
    <section>
      <IntelSubhead>수집 근거</IntelSubhead>
      {loading ? <IntelEmpty>근거를 불러오는 중…</IntelEmpty> : sources.length ? <div className="flex flex-col gap-1.5">{sources.map(({ id, signal, error }) => (
        <IntelTile key={id}>{error ? <span className="cd-error-text text-sm">근거 조회: {error}</span> : <>
          <div className="flex items-center gap-1.5 flex-wrap"><span className="cd-pill cd-pill-outline">{intelSourceLabel(signal?.source)}</span><span className="cd-text-faint text-[11px]">{intelDate(signal?.disclosedAt)}</span></div>
          {safeIntelUrl(signal?.url) ? <a className="cd-text text-sm font-bold mt-1 inline-flex items-center gap-1 hover:underline" href={safeIntelUrl(signal?.url)!} target="_blank" rel="noopener noreferrer">{signal?.reportName ?? "수집 자료"}<ExternalLink className="w-3 h-3 cd-text-faint" /></a> : <p className="cd-text text-sm font-bold mt-1">{signal?.reportName ?? "수집 자료"}</p>}
          {signal?.summary && <p className="cd-text-muted text-xs mt-1 leading-relaxed">{signal.summary}</p>}
        </>}</IntelTile>
      ))}</div> : <IntelEmpty>연결된 수집 근거가 없습니다. 사업장 등록 전에 회사명과 주소를 직접 확인하세요.</IntelEmpty>}
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
    <div className="flex flex-col gap-4 min-w-0">
      {error && <IntelError>{error}</IntelError>}
      <IntelCard icon={Building2} tone="var(--cd-warning)" title="신규 사업장 후보" count={total.toLocaleString()}
        desc="수집 자료의 기업·공장이 등록된 사업장과 매칭되지 않은 후보입니다. 등록 전에도 브리핑과 영업 발굴에 나타납니다."
        actions={<button className="cd-btn cd-btn-ghost cd-btn-sm" title="새로고침" disabled={loading} onClick={() => void reload()}><RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /></button>}>
        <div className="mb-3">
          <IntelChips active={status} onChange={(key) => { setStatus(key); setOffset(0); }} items={[
            { key: "new" as StatusFilter, label: "미검토" },
            { key: "in_review" as StatusFilter, label: "검토 중" },
            { key: "hold" as StatusFilter, label: "보류" },
            { key: "linked_existing" as StatusFilter, label: "기존 연결" },
            { key: "registered" as StatusFilter, label: "등록" },
            { key: "rejected" as StatusFilter, label: "제외" },
            { key: "" as StatusFilter, label: "전체" },
          ]} />
        </div>
        {candidates.length ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
            {candidates.map((candidate) => {
              const s = summaries[candidate.candidateId];
              return (
                <IntelTile key={candidate.candidateId} onClick={() => open(candidate)}>
                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                    <span className="cd-text text-sm font-bold truncate">{candidate.companyName}</span>
                    <span className={`cd-pill ${STATUS_PILL[candidate.status]}`}>{STATUS[candidate.status]}</span>
                    {s?.firstSource && <span className="cd-pill cd-pill-outline">{intelSourceLabel(s.firstSource)}</span>}
                    {s && s.evidenceCount > 1 && <span className="cd-pill cd-pill-idle">근거 {s.evidenceCount}건</span>}
                    {s?.projectId && <span className="cd-pill cd-pill-secondary" title={s.projectTitle ?? undefined}>프로젝트 연결</span>}
                  </div>
                  <p className="cd-text-muted text-[11px] truncate mt-1">{s?.firstTitle ?? "연결된 근거 없음"}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="cd-text-faint text-[11px] truncate flex-1 min-w-0">{candidate.siteAddress ?? "주소 미확인"}{s?.firstDate ? ` · ${intelDate(s.firstDate)}` : ""}{candidate.reviewAt ? ` · 재검토 ${intelDate(candidate.reviewAt)}` : ""}</p>

                  </div>
                </IntelTile>
              );
            })}
          </div>
        ) : (
          <IntelEmpty>{loading ? "불러오는 중…" : status === "new" ? "검토할 신규 사업장 후보가 없습니다." : "해당 상태의 후보가 없습니다."}</IntelEmpty>
        )}
        <div className="flex items-center justify-between gap-3 flex-wrap mt-3">
          <span className="cd-text-faint text-xs">{total ? `${(offset + 1).toLocaleString()}–${Math.min(total, offset + PAGE).toLocaleString()} / 총 ${total.toLocaleString()}건` : "0건"}</span>
          <div className="flex gap-1.5">
            <button className="cd-btn cd-btn-ghost cd-btn-sm" disabled={!offset || loading} onClick={() => setOffset(Math.max(0, offset - PAGE))}>이전</button>
            <button className="cd-btn cd-btn-ghost cd-btn-sm" disabled={offset + PAGE >= total || loading} onClick={() => setOffset(offset + PAGE)}>다음</button>
          </div>
        </div>
      </IntelCard>

      <CdModal open={selected !== null} onClose={() => !busy && setSelected(null)} title={selected ? `${selected.companyName} · 사업장 후보 검토` : "사업장 후보 검토"} size="lg" closeOnBackdrop={false} footer={<><CdButton disabled={busy} onClick={() => setSelected(null)}>닫기</CdButton>{writable && <CdButton variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "저장 중…" : "검토 저장"}</CdButton>}</>}>
        {selected && <div className="intel-ui flex flex-col gap-4">
          {reviewError && <IntelError>{reviewError}</IntelError>}
          <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
            <dt className="cd-text-muted">상태</dt><dd><span className={`cd-pill ${STATUS_PILL[selected.status]}`}>{STATUS[selected.status]}</span>{selected.reason ? ` ${selected.reason}` : ""}</dd>
            <dt className="cd-text-muted">주소</dt><dd className="cd-text">{selected.siteAddress ?? "미확인"}</dd>
            <dt className="cd-text-muted">업종</dt><dd className="cd-text">{selected.industry ?? "미확인"}</dd>
            {summary?.projectId && <><dt className="cd-text-muted">투자 프로젝트</dt><dd><button type="button" className="text-left font-bold hover:underline" style={{ color: "var(--cd-primary)" }} onClick={() => { setSelected(null); onOpenProject(summary.projectId!); }}>{summary.projectTitle}</button></dd></>}
            <dt className="cd-text-muted">후보 생성</dt><dd className="cd-text">{intelTime(selected.createdAt)}</dd>
          </dl>
          <CandidateEvidence candidate={selected} />
          {writable ? <fieldset disabled={busy} className="intel-form border-t cd-border-c pt-4">
            <IntelSubhead>검토 결과</IntelSubhead>
            <CdSelect label="처리" value={form.action} onChange={(event) => setForm({ ...form, action: event.target.value as ReviewForm["action"] })}><option value="review">검토 시작</option><option value="link">기존 사업장 연결</option><option value="register">새 사업장 등록</option><option value="hold">보류</option><option value="reject">제외</option></CdSelect>
            {form.action === "link" && <IntelligenceLookup kind="facility" label="연결할 사업장" value={form.facilityId} onChange={(value) => setForm({ ...form, facilityId: value })} />}
            {form.action === "register" && <><CdInput required label="확인한 회사명" value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })} /><CdInput required label="확인한 사업장 주소" value={form.siteAddress} onChange={(event) => setForm({ ...form, siteAddress: event.target.value })} /><CdInput label="사업자등록번호" value={form.businessRegistrationNo} onChange={(event) => setForm({ ...form, businessRegistrationNo: event.target.value })} /><CdCheckbox label="같은 사업자등록번호를 가진 별도 공장임을 확인했습니다" checked={form.allowDuplicateBusinessRegistrationNo} onChange={(event) => setForm({ ...form, allowDuplicateBusinessRegistrationNo: event.target.checked })} /></>}
            <CdTextarea label="검토 사유" required={["hold", "reject"].includes(form.action)} rows={3} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
            {form.action === "hold" && <CdDateInput label="재검토일" required value={form.reviewAt} onChange={(value) => setForm({ ...form, reviewAt: value })} />}
          </fieldset> : !canEdit ? <p className="cd-text-muted text-xs">검토 결과를 저장하려면 영업 수정 권한이 필요합니다.</p> : null}
        </div>}
      </CdModal>
    </div>
  );
}
