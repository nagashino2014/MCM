"use client";

// 영업 발굴 — 투자 프로젝트(F02) 목록과 상세(F03~F07). 계획서 §4.5: 서비스 적합성·추진 단계가 미확인인 후보는
// 확정 순위와 분리해 '정보 보완 필요'로 보여 준다. 공개 근거 점수(최대 85)와 내부 관계 보정(최대 15)은 섞지 않는다.

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarPlus, ExternalLink, Factory, HelpCircle, Layers, Link2, Merge, Pencil, Plus, RefreshCw, Search, Split, Target } from "lucide-react";
import { CdButton, CdCheckbox, CdDateInput, CdDrawer, CdInput, CdModal, CdSelect, CdTable, CdTextarea, useCdToast } from "@/components/cdash";
import { ACTIVITY_TYPES, SALES_ACTIVITY_TYPE_LABELS, type SalesActivityType, type SalesEmployeeOption } from "@/lib/sales/types";
import type { ActionSuggestion, IntelProject, IntelProjectEvent, IntelProjectInput, PublicPriority, ServiceAssessment } from "@/lib/intel/project-intelligence-types";
import type { DiscoveryExtras } from "@/lib/intel/discovery-overview";
import { INTEL_SERVICE_LABELS, INTEL_STAGE_LABELS, formatIntelAmount, intelApi, intelDate, intelSourceLabel, intelTime, jsonBody, safeIntelUrl } from "./intelligence-client";
import { IntelligenceLookup } from "./IntelligenceLookup";
import { SignalCandidatesList } from "./SignalCandidatesList";
import { INTEGRATED_PERMIT_INDUSTRIES } from "@/lib/ieps/integrated-permit-industries";
import { INDUSTRY_LABEL } from "./intel-shared";
import { IntelBar, IntelCard, IntelChips, IntelEmpty, IntelError, IntelNotice, IntelSubhead, IntelTile, stagePillClass } from "./intel-ui-kit";

// 보조 표면 틴트 — BriefingReportView 의 KPI·회사 카드와 같은 톤.
const TINT_BG = "color-mix(in srgb, var(--cd-primary) 5%, var(--cd-card))";

type Signal = { signal_id: string; report_name: string | null; source: string; company_name: string | null; url: string | null; summary: string | null; disclosed_at: string | null };
type BusinessLink = { linkId: string; salesProjectId: string | null; contractId: string | null; title: string | null; serviceCode: string | null; stage?: string | null };
type RecommendedAction = { key: string; title: string; activityType: SalesActivityType; evidenceSignalIds: string[]; defaultAssignee: { employeeId: string; name: string } | null; salesProjectId: string | null; suggestedDate: string; reason: string };
type Detail = { project: IntelProject; signals: Signal[]; events: IntelProjectEvent[]; services: ServiceAssessment[]; priority: PublicPriority | null; links: BusinessLink[]; actions: ActionSuggestion[]; canEdit: boolean; internalContext?: { relationshipPoints: number; maximum: number; reason: string }; manualPriority?: { priority: string; reason: string; actorName: string; updatedAt: string; ruleVersion: string } | null; recommendedActions?: RecommendedAction[] };
type Dialog = "project" | "link" | "action" | "merge" | "split" | "priority" | null;
type ReviewFilter = "confirmed" | "needs_review" | "";
type DetailTab = "summary" | "evidence" | "priority" | "sales";

const PAGE = 50;
const ACTION_STATUS: Record<string, string> = { proposed: "제안", hold: "보류", rejected: "제외", accepted: "채택", planned: "예정", done: "완료", canceled: "취소" };
const AMOUNT_SCOPE: Record<string, string> = { project: "개별 프로젝트", company: "기업 전체", unknown: "범위 미확인" };
const MANUAL_PRIORITY: Record<string, string> = { high: "높음", normal: "보통", low: "낮음" };
const EVENT_TYPE: Record<string, string> = { discovered: "프로젝트 등록", source_update: "근거 자료 갱신", updated: "사실 갱신", stage_changed: "단계 변경", amount_changed: "투자금액 변경", corrected: "정정", merged: "중복 병합", split: "근거 분리" };

// ── 목록·개요 공용 표시 ──

export function PriorityScore({ priority }: { priority?: PublicPriority | null }) {
  if (!priority) return <span className="cd-text-faint">–</span>;
  return (
    <span className="flex items-center gap-2 min-w-0" title={`공개 근거 ${priority.score}/${priority.maximum}점 · 정보 보완 시 최대 ${priority.possibleScore}점`}>
      <IntelBar value={priority.score} max={priority.maximum} height={4} />
      <span className="cd-text text-xs font-extrabold tabular-nums">{priority.score}</span>
    </span>
  );
}

export function ReviewPill({ priority }: { priority?: PublicPriority | null }) {
  return priority && !priority.needsReview ? <span className="cd-pill cd-pill-success">우선 검토</span> : <span className="cd-pill cd-pill-idle">정보 보완</span>;
}

/** 규칙 엔진의 산정 이유에 남은 내부 단계 키를 화면 용어로 바꾼다. */
const plainReason = (text: string) => text.replace(/\b(unknown|mou|announced|approved|permitting|construction|operating|delayed|suspended|canceled)\b/g, (key) => INTEL_STAGE_LABELS[key] ?? key);

function StagePill({ stage }: { stage: string }) {
  return <span className={stagePillClass(stage)}>{INTEL_STAGE_LABELS[stage] ?? stage}</span>;
}

function salesLinkPill(extra?: DiscoveryExtras) {
  if (!extra) return <span className="cd-text-faint">–</span>;
  if (extra.overdueActions) return <span className="cd-pill cd-pill-error">기한 경과 {extra.overdueActions}</span>;
  if (extra.linkCount) return <span className="cd-pill cd-pill-success">연결 {extra.linkCount}{extra.openActions ? ` · 활동 ${extra.openActions}` : ""}</span>;
  return extra.openActions ? <span className="cd-pill cd-pill-info">활동 {extra.openActions}</span> : <span className="cd-text-faint text-xs">미연결</span>;
}

/** 이력에서 의미 있는 변화만 앞세우고, 근거 문서만 다시 확인한 기록은 접는다. */
function eventSummary(event: IntelProjectEvent): string | null {
  const before = event.before ?? {}, after = event.after ?? {};
  const parts: string[] = [];
  if (after.stage != null && before.stage !== after.stage) parts.push(`단계 ${INTEL_STAGE_LABELS[String(before.stage ?? "unknown")] ?? "미확인"} → ${INTEL_STAGE_LABELS[String(after.stage)] ?? after.stage}`);
  if (after.amount != null && Number(before.amount ?? NaN) !== Number(after.amount)) parts.push(`금액 ${formatIntelAmount(before.amount == null ? null : Number(before.amount))} → ${formatIntelAmount(Number(after.amount))}`);
  return parts.length ? parts.join(" · ") : null;
}

export function ProjectIntelligencePanel({ canEdit, initialProjectId, initialReview }: { canEdit: boolean; initialProjectId?: string | null; initialReview?: string | null }) {
  const { toast } = useCdToast();
  const [view, setView] = useState<"projects" | "signals">("projects");
  const [signalCount, setSignalCount] = useState<number | undefined>(undefined);
  const [projects, setProjects] = useState<IntelProject[]>([]);
  const [extras, setExtras] = useState<Record<string, DiscoveryExtras>>({});
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [reviewState, setReviewState] = useState<ReviewFilter>(initialReview === "confirmed" || initialReview === "needs_review" ? initialReview : "");
  const [stageFilter, setStageFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("summary");
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [showInsufficient, setShowInsufficient] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [employees, setEmployees] = useState<SalesEmployeeOption[]>([]);
  const [projectForm, setProjectForm] = useState<IntelProjectInput>({ title: "" });
  const [creating, setCreating] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [eventType, setEventType] = useState("updated");
  const [occurredAt, setOccurredAt] = useState("");
  const [linkMode, setLinkMode] = useState<"sales" | "contract" | "create">("sales");
  const [targetId, setTargetId] = useState("");
  const [serviceCode, setServiceCode] = useState("integrated_permit");
  const [ownerId, setOwnerId] = useState("");
  const [scopeKey, setScopeKey] = useState("");
  const [salesTitle, setSalesTitle] = useState("");
  const [priorityChoice, setPriorityChoice] = useState("normal");
  const [reason, setReason] = useState("");
  const [splitTitle, setSplitTitle] = useState("");
  const [chosenSignals, setChosenSignals] = useState<string[]>([]);
  const [mergeQuery, setMergeQuery] = useState("");
  const [mergeOptions, setMergeOptions] = useState<IntelProject[]>([]);
  const [action, setAction] = useState<ActionSuggestion | null>(null);
  const [actionDecision, setActionDecision] = useState("accept");
  const [unlink, setUnlink] = useState<BusinessLink | null>(null);
  const [actionTitle, setActionTitle] = useState("");
  const [activityType, setActivityType] = useState<SalesActivityType>("visit");
  const [scheduledAt, setScheduledAt] = useState("");
  const [scheduledTime, setScheduledTime] = useState("09:00");
  const [endedAt, setEndedAt] = useState("");
  const [endedTime, setEndedTime] = useState("10:00");
  const [actionEvidence, setActionEvidence] = useState<string[]>([]);
  const keys = useRef(new Map<string, string>());

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset), q: query, sortByPriority: "true" });
      if (reviewState) params.set("reviewState", reviewState);
      if (stageFilter) params.set("types", stageFilter);
      if (serviceFilter) params.set("serviceCodes", serviceFilter);
      const data = await intelApi<{ projects: IntelProject[]; total: number; extras?: Record<string, DiscoveryExtras> }>(`/api/sales/intel/projects?${params}`);
      setProjects(data.projects); setTotal(data.total); setExtras(data.extras ?? {}); setError("");
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [offset, query, reviewState, stageFilter, serviceFilter]);
  const open = useCallback(async (id: string, tab?: DetailTab) => {
    try {
      setDetail(await intelApi<Detail>(`/api/sales/intel/projects/${encodeURIComponent(id)}`));
      if (tab) setDetailTab(tab);
      setError("");
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (initialProjectId) { setDetailTab("summary"); void open(initialProjectId); } }, [initialProjectId, open]);

  async function loadEmployees() { try { setEmployees((await intelApi<{ employees: SalesEmployeeOption[] }>("/api/sales/employees")).employees); } catch (e) { setFormError((e as Error).message); } }
  function startDialog(kind: Dialog) { setDialog(kind); setFormError(""); setReason(""); setTargetId(""); setOwnerId(""); }
  function editProject(isNew: boolean) {
    setCreating(isNew); setProjectForm(isNew ? { title: "", currency: "KRW", stage: "unknown", amountScope: "project" } : { ...detail!.project });
    setConfirmed(false); setOccurredAt(""); setEventType("updated"); startDialog("project");
  }
  function beginAction(value?: ActionSuggestion) {
    setAction(value ?? null); setActionTitle(value?.title ?? ""); setActivityType(value?.activityType ?? "visit"); setScheduledAt(value?.scheduledAt?.slice(0, 10) ?? ""); setScheduledTime(value?.scheduledAt?.slice(11, 16) || "09:00"); setActionDecision("accept"); startDialog("action"); setOwnerId(value?.assigneeEmployeeId ?? ""); setTargetId(value?.salesProjectId ?? ""); void loadEmployees();
    setEndedAt(value?.endedAt?.slice(0, 10) ?? ""); setEndedTime(value?.endedAt?.slice(11, 16) || "10:00"); setActionEvidence(value?.evidenceSignalIds ?? detail?.signals.map((signal) => signal.signal_id) ?? []);
  }
  function beginRecommended(value: RecommendedAction) { beginAction(); setActionTitle(value.title); setActivityType(value.activityType); setScheduledAt(value.suggestedDate); setEndedAt(value.suggestedDate); setOwnerId(value.defaultAssignee?.employeeId ?? ""); setTargetId(value.salesProjectId ?? ""); setActionEvidence(value.evidenceSignalIds); }
  async function mutate(path: string, payload: Record<string, unknown>, method = "POST") {
    const fingerprint = JSON.stringify([path, payload]);
    if (!keys.current.has(fingerprint)) keys.current.set(fingerprint, crypto.randomUUID());
    return intelApi<{ project?: IntelProject }>(path, { method, ...jsonBody({ ...payload, requestKey: keys.current.get(fingerprint) }) });
  }
  async function saveDialog() {
    setBusy(true); setFormError("");
    try {
      let openedId = detail?.project.projectId;
      const path = `/api/sales/intel/projects/${openedId}`;
      if (dialog === "project") {
        const data = await mutate(creating ? "/api/sales/intel/projects" : path, { ...projectForm, ...(creating ? {} : { version: detail!.project.version, confirmed, eventType, occurredAt: occurredAt || undefined }) }, creating ? "POST" : "PATCH");
        openedId = data.project?.projectId ?? openedId;
      } else if (dialog === "link") {
        const owner = employees.find((employee) => employee.employeeId === ownerId);
        await mutate(`${path}/links`, { version: detail!.project.version, ...(linkMode === "create" ? { createSales: { title: salesTitle, serviceCode, ownerEmployeeId: ownerId, ownerDeptId: owner?.deptId, scopeKey, priority: priorityChoice } } : linkMode === "sales" ? { salesProjectId: targetId } : { contractId: targetId }) });
      } else if (dialog === "action") {
        const dateTime = scheduledAt ? `${scheduledAt}T${scheduledTime}:00` : undefined;
        const endTime = ["telemarketing", "email", "quote"].includes(activityType) ? dateTime : endedAt ? `${endedAt}T${endedTime}:00` : undefined;
        await mutate(action ? `/api/sales/intel/actions/${action.actionId}` : "/api/sales/intel/actions", action ? { action: actionDecision, version: action.version, salesProjectId: targetId || undefined, assigneeEmployeeId: ownerId || undefined, scheduledAt: dateTime, endedAt: endTime, reason } : { projectId: openedId, title: actionTitle, activityType, assigneeEmployeeId: ownerId || undefined, scheduledAt: dateTime, endedAt: endTime, salesProjectId: targetId || undefined, evidenceSignalIds: actionEvidence }, action ? "PATCH" : "POST");
      } else if (dialog === "priority") {
        await mutate(`${path}/priority`, { version: detail!.project.version, priority: priorityChoice, reason });
      } else if (dialog === "merge") {
        const source = mergeOptions.find((project) => project.projectId === targetId);
        await mutate(`${path}/merge`, { sourceId: targetId, version: detail!.project.version, sourceVersion: source?.version, reason });
      } else if (dialog === "split") await mutate(`${path}/split`, { version: detail!.project.version, title: splitTitle, signalIds: chosenSignals, reason });
      setDialog(null); await reload(); if (openedId) await open(openedId); toast("변경 내용을 저장했습니다.", "success");
    } catch (e) { setFormError((e as Error).message); } finally { setBusy(false); }
  }
  async function sync() {
    setBusy(true); setError("");
    try { const data = await intelApi<{ created: number; updated: number }>("/api/sales/intel/projects/sync", { method: "POST", ...jsonBody({ mode: "initial_backfill", limit: 200 }) }); await reload(); toast(`프로젝트를 정리했습니다. 신규 ${data.created}건 · 갱신 ${data.updated}건`, "success"); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function unlinkBusiness() {
    if (!detail || !unlink) return;
    setBusy(true); setFormError("");
    try { await mutate(`/api/sales/intel/projects/${detail.project.projectId}/links/${unlink.linkId}`, { reason }, "DELETE"); setUnlink(null); await open(detail.project.projectId); await reload(); toast("연결을 해제했습니다. 영업건·계약은 보존됩니다.", "success"); }
    catch (e) { setFormError((e as Error).message); } finally { setBusy(false); }
  }
  async function reassess() { if (!detail) return; setBusy(true); try { await mutate(`/api/sales/intel/projects/${detail.project.projectId}/assessments`, {}); await open(detail.project.projectId); await reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  /** 병합 대상은 현재 쪽이 아니라 전체 프로젝트에서 찾는다. */
  async function searchMerge() {
    try {
      const data = await intelApi<{ projects: IntelProject[] }>(`/api/sales/intel/projects?limit=30&sortByPriority=false&q=${encodeURIComponent(mergeQuery)}`);
      setMergeOptions(data.projects.filter((project) => project.projectId !== detail?.project.projectId)); setTargetId("");
    } catch (e) { setFormError((e as Error).message); }
  }
  function applyFilter(next: () => void) { next(); setOffset(0); }

  const writable = canEdit && detail?.canEdit;
  const p = detail?.project;
  const possible = detail?.services.filter((service) => service.status === "possible") ?? [];
  const insufficient = detail?.services.filter((service) => service.status !== "possible") ?? [];
  const meaningfulEvents = detail?.events.filter((event) => event.eventType !== "source_update" || eventSummary(event)) ?? [];
  const hiddenEvents = (detail?.events.length ?? 0) - meaningfulEvents.length;
  const missingPriority = detail?.priority?.components.filter((component) => component.points === null) ?? [];

  return (
    <div className="flex flex-col gap-4 min-w-0">
      {error && <IntelError>{error}</IntelError>}
      <IntelCard
        icon={view === "projects" ? Factory : Target}
        title={view === "projects" ? "투자 프로젝트" : "수집 신호 후보"}
        count={view === "projects" ? total.toLocaleString() : signalCount}
        desc={view === "projects" ? "여러 출처의 같은 투자를 묶은 단위입니다. 공개 근거 점수(최대 85점) 높은 순으로 보여 줍니다." : "사업장이 매칭되고 확정·후보 등급이며 아직 영업건이 없는 개별 신호입니다. 눌러서 영업건으로 전환합니다."}
        actions={<>
          <IntelChips items={[{ key: "projects" as const, label: "투자 프로젝트" }, { key: "signals" as const, label: "수집 신호 후보" }]} active={view} onChange={setView} />
          {view === "projects" && <>
            <button className="cd-btn cd-btn-ghost cd-btn-sm" title="새로고침" onClick={() => void reload()} disabled={loading}><RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /></button>
            {canEdit && <>
              <button className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy} onClick={() => void sync()}><Layers className="w-3.5 h-3.5" />수집 신호 정리</button>
              <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={() => editProject(true)}><Plus className="w-3.5 h-3.5" />프로젝트 추가</button>
            </>}
          </>}
        </>}
      >
        {view === "signals" ? <SignalCandidatesList canEdit={canEdit} onCount={setSignalCount} /> : <>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <IntelChips active={reviewState} onChange={(key) => applyFilter(() => setReviewState(key))} items={[
              { key: "" as ReviewFilter, label: "전체" },
              { key: "confirmed" as ReviewFilter, label: "우선 검토" },
              { key: "needs_review" as ReviewFilter, label: "정보 보완 필요" },
            ]} />
            <span className="flex-1" />
            <select className="cd-select" style={{ width: "auto" }} aria-label="추진 단계" value={stageFilter} onChange={(event) => applyFilter(() => setStageFilter(event.target.value))}>
              <option value="">단계 전체</option>
              {Object.entries(INTEL_STAGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select className="cd-select" style={{ width: "auto" }} aria-label="검토 가능 서비스" value={serviceFilter} onChange={(event) => applyFilter(() => setServiceFilter(event.target.value))}>
              <option value="">서비스 전체</option>
              {Object.entries(INTEL_SERVICE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <form className="flex items-center gap-1.5 rounded-xl border cd-border-c px-2 py-1" onSubmit={(event) => { event.preventDefault(); applyFilter(() => setQuery(search.trim())); }}>
              <Search className="w-3.5 h-3.5 cd-text-faint" />
              <input className="bg-transparent outline-none cd-text text-sm w-44" aria-label="기업·프로젝트 검색" placeholder="기업·프로젝트 검색" value={search} onChange={(event) => setSearch(event.target.value)} />
              <button type="submit" className="cd-btn cd-btn-ghost cd-btn-sm">검색</button>
            </form>
          </div>
          {reviewState === "needs_review" && <p className="cd-text-muted text-xs mb-2">서비스 적합성이나 추진 단계가 확인되지 않아 확정 순위에서 분리한 후보입니다. 상세에서 부족한 항목을 확인하세요.</p>}
          <div className="rounded-xl border cd-border-c overflow-hidden">
            <CdTable
              bare
              loading={loading}
              rows={projects}
              rowKey={(project) => project.projectId}
              onRowClick={(project) => { setDetailTab("summary"); setShowAllEvents(false); setShowInsufficient(false); void open(project.projectId); }}
              empty={query || stageFilter || serviceFilter || reviewState ? "조건에 맞는 투자 프로젝트가 없습니다." : "정리된 투자 프로젝트가 없습니다. 수집 신호 정리를 실행하세요."}
              columns={[
                { key: "title", header: "투자 프로젝트", render: (project) => <><div className="flex items-center gap-1.5 min-w-0 flex-wrap"><span className="cd-text text-sm font-bold">{project.companyName ?? "기업 미확인"}</span><ReviewPill priority={project.priority} /></div><p className="cd-text-muted text-[11px] mt-0.5">{project.title}</p><p className="cd-text-faint text-[11px]">{project.region ?? "지역 미확인"}</p></> },
                { key: "stage", header: "추진 단계", widthClass: "w-24", render: (project) => <StagePill stage={project.stage} /> },
                { key: "amount", header: "투자금액", align: "right", widthClass: "w-32", render: (project) => <span className={`tabular-nums ${project.amount === null ? "cd-text-faint" : "cd-text font-bold"}`}>{formatIntelAmount(project.amount, project.currency)}</span> },
                { key: "services", header: "검토 가능 서비스", render: (project) => { const codes = extras[project.projectId]?.services ?? []; return codes.length ? <div className="flex gap-1 flex-wrap">{codes.map((code) => <span key={code} className="cd-pill cd-pill-outline">{INTEL_SERVICE_LABELS[code] ?? code}</span>)}</div> : <span className="cd-text-faint text-xs">판단 자료 부족</span>; } },
                { key: "sales", header: "영업 연결", widthClass: "w-32", render: (project) => salesLinkPill(extras[project.projectId]) },
                { key: "priority", header: "공개 근거 점수", widthClass: "w-40", render: (project) => <PriorityScore priority={project.priority} /> },
              ]}
            />
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap mt-3">
            <span className="cd-text-faint text-xs">{total ? `${(offset + 1).toLocaleString()}–${Math.min(total, offset + PAGE).toLocaleString()} / 총 ${total.toLocaleString()}건 · 점수 높은 순` : "0건"}</span>
            <div className="flex gap-1.5">
              <button className="cd-btn cd-btn-ghost cd-btn-sm" disabled={!offset || loading} onClick={() => setOffset(Math.max(0, offset - PAGE))}>이전</button>
              <button className="cd-btn cd-btn-ghost cd-btn-sm" disabled={offset + PAGE >= total || loading} onClick={() => setOffset(offset + PAGE)}>다음</button>
            </div>
          </div>
        </>}
      </IntelCard>

      <CdDrawer open={detail !== null} onClose={() => !dialog && !unlink && setDetail(null)} title={p?.title ?? "투자 프로젝트"} widthClass="max-w-4xl">
        {detail && p && <div className="flex flex-col gap-4 min-w-0">
          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="cd-text text-[15px] font-extrabold">{p.companyName ?? "기업 미확인"}</span>
              {p.region && <span className="cd-pill cd-pill-idle">{p.region}</span>}
              {p.industry && <span className="cd-pill cd-pill-outline">{INDUSTRY_LABEL[p.industry] ?? p.industry}</span>}
              <ReviewPill priority={detail.priority} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
              {[
                { label: "추진 단계", value: <StagePill stage={p.stage} /> },
                { label: `투자금액 · ${AMOUNT_SCOPE[p.amountScope] ?? "범위 미확인"}`, value: <span className="cd-text text-lg font-extrabold">{formatIntelAmount(p.amount, p.currency)}</span> },
                { label: "공개 근거 점수", value: <span className="cd-text text-lg font-extrabold">{detail.priority ? <>{detail.priority.score}<span className="cd-text-faint text-xs font-bold"> / {detail.priority.maximum}</span></> : "–"}</span> },
                { label: "영업·계약 연결", value: <span className="cd-text text-lg font-extrabold">{detail.links.length ? `${detail.links.length}건` : <span className="cd-text-faint text-sm">없음</span>}</span> },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border cd-border-c px-3 py-2" style={{ background: TINT_BG }}>
                  <p className="cd-text-muted text-[11px] font-bold">{item.label}</p>
                  <div className="mt-1">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
          {writable && <div className="flex flex-wrap gap-1.5">
            <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={() => { startDialog("link"); setLinkMode("sales"); setScopeKey(""); setSalesTitle(p.title); setPriorityChoice(detail.manualPriority?.priority ?? "normal"); void loadEmployees(); }}><Link2 className="w-3.5 h-3.5" />영업·계약 연결</button>
            <button className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => beginAction()}><CalendarPlus className="w-3.5 h-3.5" />후속 활동 등록</button>
            <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => editProject(false)}><Pencil className="w-3.5 h-3.5" />사실 수정</button>
            <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => { startDialog("merge"); setMergeQuery(p.companyName ?? ""); setMergeOptions([]); }}><Merge className="w-3.5 h-3.5" />중복 병합</button>
            <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => { startDialog("split"); setChosenSignals([]); setSplitTitle(""); }}><Split className="w-3.5 h-3.5" />근거 분리</button>
          </div>}

          <IntelChips active={detailTab} onChange={setDetailTab} items={[
            { key: "summary" as DetailTab, label: "개요" },
            { key: "evidence" as DetailTab, label: `근거·이력 ${detail.signals.length}` },
            { key: "priority" as DetailTab, label: "서비스·우선순위" },
            { key: "sales" as DetailTab, label: `영업·활동 ${detail.links.length + detail.actions.length}` },
          ]} />

          {detailTab === "summary" && <div className="flex flex-col gap-4">
            {p.publicSummary && (
              <div className="rounded-xl px-4 py-3" style={{ background: TINT_BG, borderLeft: "3px solid var(--cd-primary)" }}>
                <p className="cd-text text-sm leading-relaxed">{p.publicSummary}</p>
              </div>
            )}
            <section>
              <IntelSubhead>확인된 사실</IntelSubhead>
              <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
                <dt className="cd-text-muted">기업</dt><dd className="cd-text">{p.companyName ?? "미확인"}</dd>
                <dt className="cd-text-muted">사업장</dt><dd className="cd-text">{p.facilityId ? "등록된 사업장과 연결됨" : <span className="cd-warn-text">사업장 미확인 — 영업건을 만들려면 먼저 사업장을 연결합니다.</span>}</dd>
                <dt className="cd-text-muted">추진 단계</dt><dd><StagePill stage={p.stage} /></dd>
                <dt className="cd-text-muted">투자금액</dt><dd className="cd-text">{formatIntelAmount(p.amount, p.currency)}{p.amount != null ? ` (${AMOUNT_SCOPE[p.amountScope] ?? "범위 미확인"})` : ""}</dd>
                <dt className="cd-text-muted">예정 기간</dt><dd className="cd-text">{p.expectedStartAt || p.expectedEndAt ? `${intelDate(p.expectedStartAt)} ~ ${intelDate(p.expectedEndAt)}` : "미확인"}</dd>
                <dt className="cd-text-muted">근거 자료</dt><dd className="cd-text">{detail.signals.length}건 · 최근 갱신 {intelTime(p.updatedAt)}</dd>
              </dl>
            </section>
            <section>
              <IntelSubhead>서비스 관련 가능성</IntelSubhead>
              {possible.length ? <div className="flex flex-col gap-1.5">{possible.map((service) => (
                <IntelTile key={service.serviceCode}>
                  <div className="flex items-center gap-1.5"><span className="cd-text text-sm font-bold">{service.label}</span><span className="cd-pill cd-pill-success">검토 가능</span></div>
                  <p className="cd-text-muted text-xs mt-1 leading-relaxed">{service.rationale}</p>
                </IntelTile>
              ))}</div> : <IntelEmpty>공개 근거로 판단할 수 있는 서비스가 없습니다. 법적 적용 여부는 담당자 확인이 필요합니다.</IntelEmpty>}
            </section>
            <section>
              <IntelSubhead>추가 확인사항</IntelSubhead>
              {possible.some((service) => service.questions.length) || missingPriority.length ? <ul className="flex flex-col gap-1.5">
                {possible.flatMap((service) => service.questions.map((question, index) => <li key={`${service.serviceCode}:${index}`} className="flex gap-2 text-sm cd-text"><HelpCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--cd-primary)" }} />{question}</li>))}
                {missingPriority.map((component) => <li key={component.key} className="flex gap-2 text-sm cd-text"><HelpCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--cd-warning)" }} />{component.label}: {plainReason(component.reason)}</li>)}
              </ul> : <IntelEmpty>추가로 확인할 항목이 없습니다.</IntelEmpty>}
            </section>
            {!!detail.recommendedActions?.length && <section>
              <IntelSubhead>권장 활동</IntelSubhead>
              <div className="flex flex-col gap-1.5">{detail.recommendedActions.map((suggestion) => (
                <IntelTile key={suggestion.key}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap"><span className="cd-text text-sm font-bold">{suggestion.title}</span><span className="cd-pill cd-pill-outline">{SALES_ACTIVITY_TYPE_LABELS[suggestion.activityType] ?? suggestion.activityType}</span></div>
                      <p className="cd-text-faint text-[11px] mt-1">권장 기한 {suggestion.suggestedDate} · {suggestion.defaultAssignee?.name ?? "담당자 지정 필요"}</p>
                    </div>
                    {writable && <button className="cd-btn cd-btn-soft cd-btn-sm shrink-0" onClick={() => beginRecommended(suggestion)}>검토 등록</button>}
                  </div>
                </IntelTile>
              ))}</div>
            </section>}
          </div>}

          {detailTab === "evidence" && <div className="flex flex-col gap-4">
            <section>
              <IntelSubhead>근거 자료</IntelSubhead>
              {detail.signals.length ? <div className="flex flex-col gap-1.5">{detail.signals.map((signal) => (
                <IntelTile key={signal.signal_id}>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="cd-pill cd-pill-outline">{intelSourceLabel(signal.source)}</span>
                    <span className="cd-text-faint text-[11px]">{intelDate(signal.disclosed_at)}</span>
                  </div>
                  {safeIntelUrl(signal.url)
                    ? <a href={safeIntelUrl(signal.url)} target="_blank" rel="noopener noreferrer" className="cd-text text-sm font-bold mt-1 inline-flex items-center gap-1 hover:underline">{signal.report_name ?? signal.company_name ?? "근거 자료"}<ExternalLink className="w-3 h-3 cd-text-faint" /></a>
                    : <p className="cd-text text-sm font-bold mt-1">{signal.report_name ?? signal.company_name ?? "근거 자료"}</p>}
                  {signal.summary && <p className="cd-text-muted text-xs mt-1 leading-relaxed">{signal.summary}</p>}
                </IntelTile>
              ))}</div> : <IntelEmpty>열람할 수 있는 근거 자료가 없습니다.</IntelEmpty>}
            </section>
            <section>
              <IntelSubhead right={hiddenEvents > 0 && <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setShowAllEvents(!showAllEvents)}>{showAllEvents ? "주요 변화만 보기" : `근거 갱신 ${hiddenEvents}건 함께 보기`}</button>}>변화 이력</IntelSubhead>
              <ol className="flex flex-col">
                {(showAllEvents ? detail.events : meaningfulEvents).map((event) => (
                  <li key={event.eventId} className="relative pl-5 pb-3 last:pb-0">
                    <span className="absolute left-1 top-1.5 w-2 h-2 rounded-full" style={{ background: eventSummary(event) ? "var(--cd-primary)" : "var(--cd-border)" }} />
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="cd-text text-sm font-bold">{EVENT_TYPE[event.eventType] ?? "사실 갱신"}</span>
                      {event.correctsEventId && <span className="cd-pill cd-pill-warn">정정</span>}
                      {event.mode === "initial_backfill" && <span className="cd-pill cd-pill-idle">기존 자료 초기 분석</span>}
                    </div>
                    <p className="cd-text-muted text-xs mt-0.5">{eventSummary(event) ?? "단계·금액 변화 없음"}</p>
                    <p className="cd-text-faint text-[11px]">발생 {intelDate(event.occurredAt)} · 확인 {intelTime(event.discoveredAt)}</p>
                  </li>
                ))}
              </ol>
            </section>
          </div>}

          {detailTab === "priority" && <div className="flex flex-col gap-4">
            <section>
              <IntelSubhead right={writable && <div className="flex gap-1.5"><button className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy} onClick={() => void reassess()}>다시 평가</button><button className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => { startDialog("priority"); setPriorityChoice(detail.manualPriority?.priority ?? "normal"); setReason(detail.manualPriority?.reason ?? ""); }}>내 우선순위</button></div>}>공개 근거 우선순위</IntelSubhead>
              {detail.priority ? <>
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="cd-text text-2xl font-extrabold">{detail.priority.score}</span>
                  <span className="cd-text-muted text-sm">/ {detail.priority.maximum}점 · 정보 보완 시 최대 {detail.priority.possibleScore}점</span>
                  <span className="cd-text-faint text-xs ml-auto">근거 신뢰도 {detail.priority.confidence === "confirmed" ? "확정" : detail.priority.confidence === "candidate" ? "후보" : "미확인"}</span>
                </div>
                <IntelBar value={detail.priority.score} max={detail.priority.maximum} />
                <div className="flex flex-col mt-3">
                  {detail.priority.components.map((component) => (
                    <div key={component.key} className="flex items-center gap-2 py-1.5 border-b cd-border-c last:border-b-0">
                      <span className="cd-text text-xs font-bold shrink-0" style={{ width: 96 }}>{component.label}</span>
                      <IntelBar value={component.points ?? 0} max={component.maximum} height={4} />
                      <span className="cd-text-muted text-[11px] shrink-0 tabular-nums" style={{ minWidth: 56, textAlign: "right" }}>{component.points === null ? "정보 부족" : `${component.points} / ${component.maximum}`}</span>
                      <span className="cd-text-faint text-[11px] flex-[2] min-w-0 truncate" title={plainReason(component.reason)}>{plainReason(component.reason)}</span>
                    </div>
                  ))}
                </div>
                <p className="cd-text-faint text-[11px] mt-2">규칙 {detail.priority.ruleVersion}</p>
              </> : <IntelEmpty>아직 평가하지 않았습니다.</IntelEmpty>}
              {detail.manualPriority && <IntelNotice><span className="font-bold">내 검토 우선순위 {MANUAL_PRIORITY[detail.manualPriority.priority] ?? detail.manualPriority.priority}</span> · {detail.manualPriority.reason}<span className="block cd-text-faint text-[11px] mt-0.5">{detail.manualPriority.actorName} · {intelTime(detail.manualPriority.updatedAt)} · 공개 점수·공유 브리핑에는 반영하지 않음</span></IntelNotice>}
              {detail.internalContext && <p className="cd-text-muted text-xs mt-2">내 열람 범위의 관계 보정 {detail.internalContext.relationshipPoints}/{detail.internalContext.maximum}점 — {detail.internalContext.reason}</p>}
            </section>
            <section>
              <IntelSubhead>서비스 수요 가설</IntelSubhead>
              <div className="flex flex-col gap-1.5">{[...possible, ...(showInsufficient ? insufficient : [])].map((service) => (
                <IntelTile key={service.serviceCode}>
                  <div className="flex items-center gap-1.5"><span className="cd-text text-sm font-bold">{service.label}</span>{service.status === "possible" ? <span className="cd-pill cd-pill-success">검토 가능</span> : <span className="cd-pill cd-pill-idle">판단 자료 부족</span>}</div>
                  <p className="cd-text-muted text-xs mt-1 leading-relaxed">{service.rationale}</p>
                  {service.questions.length > 0 && <ul className="mt-1.5 flex flex-col gap-0.5">{service.questions.map((question, index) => <li key={index} className="cd-text text-xs">· {question}</li>)}</ul>}
                </IntelTile>
              ))}</div>
              {insufficient.length > 0 && <button className="cd-btn cd-btn-ghost cd-btn-sm mt-2" onClick={() => setShowInsufficient(!showInsufficient)}>{showInsufficient ? "판단 자료 부족 항목 접기" : `판단 자료 부족 ${insufficient.length}건 보기`}</button>}
              <p className="cd-text-faint text-[11px] mt-2">공개 근거 기준 가설입니다. 법적 의무 여부를 자동으로 확정하지 않습니다.</p>
            </section>
          </div>}

          {detailTab === "sales" && <div className="flex flex-col gap-4">
            <section>
              <IntelSubhead>연결된 영업·계약</IntelSubhead>
              {detail.links.length ? <div className="flex flex-col gap-1.5">{detail.links.map((link) => (
                <IntelTile key={link.linkId}>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <a className="cd-text text-sm font-bold hover:underline" href={link.salesProjectId ? `/sales/${encodeURIComponent(link.salesProjectId)}` : `/contracts/${encodeURIComponent(link.contractId!)}`}>{link.title ?? (link.salesProjectId ? "영업건" : "계약")}</a>
                        <span className="cd-pill cd-pill-idle">{link.salesProjectId ? "영업건" : "계약"}</span>
                        {link.serviceCode && <span className="cd-pill cd-pill-outline">{INTEL_SERVICE_LABELS[link.serviceCode] ?? link.serviceCode}</span>}
                      </div>
                    </div>
                    {writable && <button className="cd-btn cd-btn-ghost cd-btn-sm shrink-0" onClick={() => { setUnlink(link); setReason(""); setFormError(""); }}>연결 해제</button>}
                  </div>
                </IntelTile>
              ))}</div> : <IntelEmpty>현재 열람 범위에 연결된 영업·계약이 없습니다.</IntelEmpty>}
            </section>
            <section>
              <IntelSubhead>후속 활동</IntelSubhead>
              {detail.actions.length ? <div className="flex flex-col gap-1.5">{detail.actions.map((item) => {
                const overdue = item.activityStatus === "planned" && !!(item.endedAt ?? item.scheduledAt) && Date.parse(`${item.endedAt ?? item.scheduledAt}+09:00`) < Date.now();
                return (
                  <IntelTile key={item.actionId}>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="cd-text text-sm font-bold">{item.title}</span>
                          {overdue ? <span className="cd-pill cd-pill-error">기한 경과</span> : <span className={`cd-pill ${item.status === "accepted" ? "cd-pill-info" : "cd-pill-idle"}`}>{ACTION_STATUS[item.activityStatus ?? item.status] ?? item.status}</span>}
                          <span className="cd-pill cd-pill-outline">{SALES_ACTIVITY_TYPE_LABELS[item.activityType] ?? item.activityType}</span>
                        </div>
                        <p className="cd-text-faint text-[11px] mt-0.5">{item.scheduledAt ? `예정 ${intelDate(item.scheduledAt)}` : "예정일 미정"}</p>
                      </div>
                      {item.status === "accepted" && item.salesProjectId
                        ? <a className="cd-btn cd-btn-ghost cd-btn-sm shrink-0" href={`/sales/${encodeURIComponent(item.salesProjectId)}`}>영업건 보기</a>
                        : writable && item.status !== "rejected" ? <button className="cd-btn cd-btn-soft cd-btn-sm shrink-0" onClick={() => beginAction(item)}>검토</button> : null}
                    </div>
                  </IntelTile>
                );
              })}</div> : <IntelEmpty>등록된 후속 활동이 없습니다. 개요의 권장 활동을 검토 등록하거나 후속 활동을 등록하세요.</IntelEmpty>}
            </section>
          </div>}
        </div>}
      </CdDrawer>

      <CdModal open={dialog !== null} onClose={() => !busy && setDialog(null)} title={dialog === "priority" ? "내 검토 우선순위 조정" : dialog === "project" ? creating ? "프로젝트 추가" : "공개 사실 수정" : dialog === "link" ? "영업·계약 연결" : dialog === "action" ? "후속 활동 검토" : dialog === "merge" ? "중복 프로젝트 병합" : "프로젝트 근거 분리"} size="lg" closeOnBackdrop={false} footer={<><CdButton disabled={busy} onClick={() => setDialog(null)}>취소</CdButton><CdButton variant="primary" disabled={busy} onClick={() => void saveDialog()}>{busy ? "저장 중…" : "저장"}</CdButton></>}>
        <div className="intel-ui intel-form">
          {formError && <div className="intel-error" role="alert">{formError}</div>}
          {dialog === "priority" && <><p className="intel-prose cd-text-muted">본인의 검토 순서를 기록합니다. 공개 근거 점수와 공유 브리핑에는 반영하지 않습니다.</p><CdSelect label="우선순위" value={priorityChoice} onChange={(event) => setPriorityChoice(event.target.value)}><option value="high">높음</option><option value="normal">보통</option><option value="low">낮음</option></CdSelect><CdTextarea label="조정 사유" required value={reason} onChange={(event) => setReason(event.target.value)} /></>}
          {dialog === "project" && <>
            <CdInput label="프로젝트명" required value={projectForm.title} onChange={(event) => setProjectForm({ ...projectForm, title: event.target.value })} />
            <CdInput label="기업명" value={projectForm.companyName ?? ""} onChange={(event) => setProjectForm({ ...projectForm, companyName: event.target.value })} />
            <IntelligenceLookup kind="facility" label="사업장" value={projectForm.facilityId ?? ""} onChange={(id) => setProjectForm({ ...projectForm, facilityId: id || null })} />
            <div className="grid sm:grid-cols-2 gap-4">
              <CdSelect label="업종" value={projectForm.industry ?? ""} onChange={(event) => setProjectForm({ ...projectForm, industry: event.target.value })}><option value="">미확인</option>{INTEGRATED_PERMIT_INDUSTRIES.map((industry) => <option key={industry.id} value={industry.id}>{industry.label}</option>)}</CdSelect>
              <CdInput label="지역" value={projectForm.region ?? ""} onChange={(event) => setProjectForm({ ...projectForm, region: event.target.value })} />
              <CdSelect label="추진 단계" value={projectForm.stage ?? "unknown"} onChange={(event) => setProjectForm({ ...projectForm, stage: event.target.value as IntelProject["stage"] })}>{Object.entries(INTEL_STAGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</CdSelect>
              <CdInput label={`투자금액 (${projectForm.currency === "KRW" || !projectForm.currency ? "억원" : projectForm.currency})`} type="number" min={0} step="any" value={projectForm.amount == null ? "" : projectForm.currency === "KRW" || !projectForm.currency ? projectForm.amount / 1e8 : projectForm.amount} onChange={(event) => setProjectForm({ ...projectForm, amount: event.target.value ? Math.round(Number(event.target.value) * (projectForm.currency === "KRW" || !projectForm.currency ? 1e8 : 1)) : null })} />
              <CdSelect label="통화" value={projectForm.currency ?? "KRW"} onChange={(event) => setProjectForm({ ...projectForm, currency: event.target.value })}>{["KRW", "USD", "EUR", "JPY", "CNY"].map((currency) => <option key={currency}>{currency}</option>)}</CdSelect>
              <CdSelect label="투자금액 범위" value={projectForm.amountScope ?? "project"} onChange={(event) => setProjectForm({ ...projectForm, amountScope: event.target.value })}><option value="project">개별 프로젝트</option><option value="company">기업 전체</option><option value="unknown">범위 미확인</option></CdSelect>
            </div>
            <div className="grid sm:grid-cols-2 gap-4"><CdDateInput label="예정 시작일" value={projectForm.expectedStartAt ?? ""} onChange={(value) => setProjectForm({ ...projectForm, expectedStartAt: value || null })} /><CdDateInput label="예정 종료일" value={projectForm.expectedEndAt ?? ""} onChange={(value) => setProjectForm({ ...projectForm, expectedEndAt: value || null })} /></div>
            <CdTextarea label="공개 근거 요약" rows={4} value={projectForm.publicSummary ?? ""} onChange={(event) => setProjectForm({ ...projectForm, publicSummary: event.target.value })} />
            {!creating && <><CdSelect label="변경 유형" value={eventType} onChange={(event) => setEventType(event.target.value)}><option value="updated">사실 갱신</option><option value="stage_changed">단계 변경</option><option value="amount_changed">투자금액 변경</option><option value="corrected">정정</option></CdSelect><CdDateInput label="사건 발생일" value={occurredAt} onChange={setOccurredAt} /><CdCheckbox label="공개 근거로 확인한 변화입니다" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /></>}
          </>}
          {dialog === "link" && <><CdSelect label="연결 방법" value={linkMode} onChange={(event) => { setLinkMode(event.target.value as typeof linkMode); setTargetId(""); }}><option value="sales">기존 영업건 연결</option><option value="contract">기존 계약 연결</option><option value="create">새 영업건 생성</option></CdSelect>{linkMode === "create" ? <><CdInput label="영업건명" required value={salesTitle} onChange={(event) => setSalesTitle(event.target.value)} /><CdSelect label="영업 우선순위" value={priorityChoice} onChange={(event) => setPriorityChoice(event.target.value)}><option value="high">높음</option><option value="normal">보통</option><option value="low">낮음</option></CdSelect><CdSelect label="서비스" value={serviceCode} onChange={(event) => setServiceCode(event.target.value)}>{Object.entries(INTEL_SERVICE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</CdSelect><CdInput label="용역 범위" required placeholder="예: 아산 2공장 통합허가" value={scopeKey} onChange={(event) => setScopeKey(event.target.value)} /><CdSelect label="영업 담당자" required value={ownerId} onChange={(event) => setOwnerId(event.target.value)}><option value="">선택하세요</option>{employees.map((employee) => <option key={employee.employeeId} value={employee.employeeId}>{employee.name} · {employee.deptName ?? "부서 미지정"}</option>)}</CdSelect><p className="intel-table cd-text-muted">예상 용역금액은 비워 둡니다. 외부 투자금액을 복사하지 않습니다.</p>{!detail?.project.facilityId && <p className="intel-error">새 영업건을 만들려면 먼저 사실 수정에서 사업장을 연결해야 합니다.</p>}</> : <IntelligenceLookup key={linkMode} kind={linkMode} label={linkMode === "sales" ? "영업건" : "계약"} value={targetId} onChange={setTargetId} />}</>}
          {dialog === "action" && <>
            {action ? <><p className="font-medium">{action.title}</p><CdSelect label="처리" value={actionDecision} onChange={(event) => setActionDecision(event.target.value)}><option value="accept">채택 · 예정 활동 생성</option><option value="hold">보류</option><option value="reject">제외</option></CdSelect></> : <><CdInput label="활동 제목" required value={actionTitle} onChange={(event) => setActionTitle(event.target.value)} /><CdSelect label="활동 유형" value={activityType} onChange={(event) => setActivityType(event.target.value as SalesActivityType)}>{ACTIVITY_TYPES.filter((type) => type.code !== "result").map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}</CdSelect></>}
            {(!action || actionDecision === "accept") && <><IntelligenceLookup kind="sales" label="영업건" value={targetId} onChange={setTargetId} /><CdSelect label="담당자" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}><option value="">선택하세요</option>{employees.map((employee) => <option key={employee.employeeId} value={employee.employeeId}>{employee.name}</option>)}</CdSelect><div className="grid sm:grid-cols-2 gap-4"><CdDateInput label="예정일" value={scheduledAt} onChange={(value) => { setScheduledAt(value); if (!endedAt) setEndedAt(value); }} /><CdInput label="예정 시각 (KST)" type="time" value={scheduledTime} onChange={(event) => setScheduledTime(event.target.value)} />{!["telemarketing", "email", "quote"].includes(activityType) && <><CdDateInput label="종료일" required value={endedAt} onChange={setEndedAt} /><CdInput label="종료 시각 (KST)" type="time" value={endedTime} onChange={(event) => setEndedTime(event.target.value)} /></>}</div><p className="intel-table cd-text-muted">채택하면 영업건에 예정 활동으로 등록됩니다. 메일 연락 활동은 실제 메일을 보내지 않습니다.</p></>}
            {action && actionDecision !== "accept" && <CdTextarea label="사유" required rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />}
          </>}
          {dialog === "merge" && <>
            <p className="intel-prose">선택한 프로젝트의 근거를 현재 프로젝트로 합칩니다. 같은 기업의 별도 공장·별도 투자이면 합치지 말고 분리해 관리하세요.</p>
            <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); void searchMerge(); }}><CdInput className="flex-1 min-w-0" label="합칠 프로젝트 검색" value={mergeQuery} onChange={(event) => setMergeQuery(event.target.value)} /><CdButton type="submit">검색</CdButton></form>
            <CdSelect label="합칠 프로젝트" value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">{mergeOptions.length ? "선택하세요" : "먼저 검색하세요"}</option>{mergeOptions.map((project) => <option key={project.projectId} value={project.projectId}>{project.title} · {project.companyName ?? "기업 미확인"} · {formatIntelAmount(project.amount, project.currency)}</option>)}</CdSelect>
            <CdTextarea label="병합 근거" required value={reason} onChange={(event) => setReason(event.target.value)} />
          </>}
          {dialog === "split" && <><CdInput label="분리할 프로젝트명" required value={splitTitle} onChange={(event) => setSplitTitle(event.target.value)} /><div className="intel-list">{detail?.signals.map((signal) => <CdCheckbox key={signal.signal_id} label={`${signal.report_name ?? signal.signal_id} · ${intelSourceLabel(signal.source)}`} checked={chosenSignals.includes(signal.signal_id)} onChange={(event) => setChosenSignals(event.target.checked ? [...chosenSignals, signal.signal_id] : chosenSignals.filter((id) => id !== signal.signal_id))} />)}</div><CdTextarea label="분리 근거" required value={reason} onChange={(event) => setReason(event.target.value)} /></>}
        </div>
      </CdModal>
      <CdModal open={unlink !== null} onClose={() => !busy && setUnlink(null)} title="영업·계약 연결 해제" footer={<><CdButton disabled={busy} onClick={() => setUnlink(null)}>취소</CdButton><CdButton variant="danger" disabled={busy} onClick={() => void unlinkBusiness()}>연결 해제</CdButton></>}><div className="intel-ui intel-form"><p className="intel-prose">{unlink?.title ?? "선택한 항목"}의 프로젝트 연결만 해제합니다. 실제 영업건·계약과 확정된 활동은 보존됩니다.</p>{formError && <p className="intel-error" role="alert">{formError}</p>}<CdTextarea label="해제 사유" required value={reason} onChange={(event) => setReason(event.target.value)} /></div></CdModal>
    </div>
  );
}
