"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, GitCommitHorizontal, MessageSquareText, Pencil, Save, Send, Settings2, ShieldCheck, Undo2, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import ProcessStageSettingModal from "@/components/work-plan/ProcessStageSettingModal";
import StaffingSettingModal from "@/components/work-plan/StaffingSettingModal";
import StructuredNoteEditor from "@/components/work-plan/StructuredNoteEditor";
import IssuePanel from "@/components/work-plan/IssuePanel";
import { MEETING_LABELS, REVIEW_COMMENT_KINDS, REJECTABLE_KINDS, EXEC_DIRECTIVE_KINDS, EXEC_DIRECTIVE_ACTIONABLE } from "@/lib/work-plan/constants";
import type { ContractStageRow } from "@/lib/contracts/process-stages";
import type { ReporterContext, ReportStageRow, ServiceReportDetail } from "@/lib/work-plan/workspace";

type StageStatus = "pending" | "in_progress" | "done";

interface StageWork {
  status: StageStatus;
  progressPct: number;
  plannedDate: string;
  actualDate: string;
}

interface Participant {
  employeeId: string;
  employeeName: string;
  positionName: string | null;
  roleLabel: string;
}

export interface ReportSubject {
  kind: "contract" | "task";
  id: string;
  serviceType: string | null;
  stagesUrl: string;
  participantsUrl: string;
  staffingRoleOptions: string[];
}

const STATUS_OPTIONS: { value: StageStatus; label: string }[] = [
  { value: "pending", label: "예정" },
  { value: "in_progress", label: "진행 중" },
  { value: "done", label: "완료" },
];

function thisWeekRange(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day - 1));
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(monday), end: fmt(friday) };
}

export default function ReportEditor({
  subject,
  reportId,
  reporter,
  metaRow,
  onSaved,
  theme,
  review = false,
  exec = false,
  execResponse = false,
  seqByLabel,
}: {
  subject: ReportSubject;
  reportId: string | null;
  reporter: ReporterContext | null;
  metaRow?: React.ReactNode;
  onSaved: () => void;
  theme: "light" | "dark";
  /** 감독 모드 — 추진내역 하단에 부서장 의견 + 이슈상황 섹션 표시. */
  review?: boolean;
  /** 임원 검토 모드 — 임원 검토 카드(지시 하달). */
  exec?: boolean;
  /** 감독 임원지시 답변 모드 — 임원 지시 배너 + 부서장 답변 + 재보고. */
  execResponse?: boolean;
  /** 신규 작성 시 회차 태그 추정용: 회의종류별 기존 제출 보고 수. */
  seqByLabel?: Record<string, number>;
}) {
  const week = useMemo(() => thisWeekRange(), []);

  const [stages, setStages] = useState<ContractStageRow[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [reportStages, setReportStages] = useState<ReportStageRow[] | null>(null);
  const [asOfStages, setAsOfStages] = useState<ServiceReportDetail["asOfStages"] | null>(null);
  const [stageWork, setStageWork] = useState<Record<number, StageWork>>({});
  const [touched, setTouched] = useState<Set<number>>(new Set());
  const [selectedOrder, setSelectedOrder] = useState<number | null>(null);

  const [periodStart, setPeriodStart] = useState(week.start);
  const [periodEnd, setPeriodEnd] = useState(week.end);
  const [reportDate, setReportDate] = useState("");
  const [meetingLabel, setMeetingLabel] = useState("주간회의");
  const [progressText, setProgressText] = useState("");
  const [planText, setPlanText] = useState("");
  const [reviewerComment, setReviewerComment] = useState("");
  const [reviewKind, setReviewKind] = useState<string>("amend");
  const [loadedSeq, setLoadedSeq] = useState<number | null>(null);
  const [loadedReporter, setLoadedReporter] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  // 임원 검토 / 재보고
  const [execKind, setExecKind] = useState<string>("supplement_request");
  const [execMessage, setExecMessage] = useState("");
  const [directorResponse, setDirectorResponse] = useState("");
  const [execDirective, setExecDirective] = useState<{ kind: string; message: string | null } | null>(null);
  const [reReportCount, setReReportCount] = useState(0);
  const [execBusy, setExecBusy] = useState(false);

  // 제출(기존) 보고는 기본 잠금 → [수정] 클릭 시 편집. 신규는 항상 편집 가능.
  // 임원 검토(exec)는 본문 편집 불가(잠금 고정).
  const [unlocked, setUnlocked] = useState(false);
  const locked = exec ? true : (!!reportId && !unlocked);

  const [showProcessSetting, setShowProcessSetting] = useState(false);
  const [showStaffingSetting, setShowStaffingSetting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadStages = () =>
    fetch(subject.stagesUrl, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setStages(d.stages ?? []))
      .catch(() => setStages([]));

  const loadParticipants = () =>
    fetch(subject.participantsUrl, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setParticipants(d.participants ?? []))
      .catch(() => setParticipants([]));

  useEffect(() => {
    loadStages();
    loadParticipants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject.id]);

  useEffect(() => {
    if (!reportId) {
      setReportStages(null);
      setAsOfStages(null);
      return;
    }
    fetch(`/api/work-plan/report/${reportId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const rep: ServiceReportDetail | undefined = d.report;
        if (!rep) return;
        setPeriodStart(rep.periodStart || week.start);
        setPeriodEnd(rep.periodEnd || week.end);
        setReportDate(rep.reportDate ?? "");
        setMeetingLabel(rep.meetingLabel ?? "주간회의");
        setProgressText(rep.progressText ?? "");
        setPlanText(rep.planText ?? "");
        setReviewerComment(rep.reviewerComment ?? "");
        setReviewKind(rep.reviewerCommentKind ?? "amend");
        setDirectorResponse(rep.directorResponse ?? "");
        setExecDirective(rep.execDirective ?? null);
        setReReportCount(rep.reReportCount ?? 0);
        setLoadedSeq(rep.meetingSeq ?? null);
        setLoadedReporter([rep.deptName, rep.authorName].filter(Boolean).join(" ") || null);
        setReportStages(rep.stages ?? []);
        setAsOfStages(rep.asOfStages ?? []);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  // 공정 작업 상태 시드:
  //  - 신규 보고: 현재 누적 공정표(live) 시드.
  //  - 기존 보고: 그 보고 시점까지의 누적(as-of) 시드 → 이후 회차 진행분이 새어 나오지 않게 한다.
  // touched(배경 채움) = 이 보고에서 직접 기록한 단계만.
  useEffect(() => {
    const init: Record<number, StageWork> = {};
    const asOfMap = asOfStages ? new Map(asOfStages.map((a) => [a.stageOrder, a])) : null;
    for (const s of stages) {
      if (asOfMap) {
        const a = asOfMap.get(s.stageOrder);
        init[s.stageOrder] = a
          ? { status: a.status, progressPct: a.progressPct ?? 0, plannedDate: a.plannedDate ?? "", actualDate: a.actualDate ?? "" }
          : { status: "pending", progressPct: 0, plannedDate: "", actualDate: "" };
      } else {
        init[s.stageOrder] = {
          status: s.status,
          progressPct: s.progressPct ?? 0,
          plannedDate: s.plannedDate ?? "",
          actualDate: s.actualDate ?? "",
        };
      }
    }
    const t = new Set<number>();
    if (reportStages) for (const rs of reportStages) t.add(rs.stageOrder);
    setStageWork(init);
    setTouched(t);
  }, [stages, reportStages, asOfStages]);

  // 진행단계 자동 표시: 현재 진행 중(최상위) → 없으면 가장 최근 완료 단계를 기본 선택.
  useEffect(() => {
    if (selectedOrder != null) return;
    const entries = Object.entries(stageWork).map(([o, w]) => ({ order: Number(o), ...w }));
    if (!entries.length) return;
    const inProg = entries.filter((e) => e.status === "in_progress").sort((a, b) => b.order - a.order)[0];
    const done = entries.filter((e) => e.status === "done").sort((a, b) => b.order - a.order)[0];
    const pick = inProg ?? done;
    if (pick) setSelectedOrder(pick.order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageWork]);

  const selectedStage = stages.find((s) => s.stageOrder === selectedOrder) ?? null;
  const selectedWork: StageWork = selectedOrder != null
    ? stageWork[selectedOrder] ?? { status: "pending", progressPct: 0, plannedDate: "", actualDate: "" }
    : { status: "pending", progressPct: 0, plannedDate: "", actualDate: "" };

  const setStageW = (order: number, patch: Partial<StageWork>) => {
    setStageWork((prev) => ({
      ...prev,
      [order]: { ...(prev[order] ?? { status: "pending", progressPct: 0, plannedDate: "", actualDate: "" }), ...patch },
    }));
    setTouched((prev) => new Set(prev).add(order));
  };

  const stageVisual = (st: ContractStageRow) => {
    const w = stageWork[st.stageOrder];
    const status = w?.status ?? st.status;
    const filled = touched.has(st.stageOrder); // 이번 보고에서 변경/기록한 단계만 배경 채움
    if (status === "done") return { bg: filled ? "var(--cd-success-soft)" : "transparent", line: "var(--cd-success)" };
    if (status === "in_progress") return { bg: filled ? "var(--cd-warning-soft)" : "transparent", line: "var(--cd-warning)" };
    return { bg: "transparent", line: "rgba(93,135,255,0.45)" };
  };

  // 수행인력 표시: 관리자 + 실무자N 포지션 박스.
  const staffSlots = useMemo(() => {
    const managers = participants.filter((p) => p.roleLabel.includes("관리자"));
    const workers = participants.filter((p) => !p.roleLabel.includes("관리자"));
    const slots: { label: string; people: Participant[] }[] = [{ label: "관리자", people: managers }];
    const workerCount = Math.max(4, workers.length);
    for (let i = 0; i < workerCount; i++) slots.push({ label: `실무자${i + 1}`, people: workers[i] ? [workers[i]] : [] });
    return slots;
  }, [participants]);

  const currentStage = useMemo(() => {
    const entries = Object.entries(stageWork).map(([order, w]) => ({ order: Number(order), ...w }));
    const inProg = entries.filter((e) => e.status === "in_progress").sort((a, b) => b.order - a.order)[0];
    const done = entries.filter((e) => e.status === "done").sort((a, b) => b.order - a.order)[0];
    const pick = inProg ?? done;
    if (!pick) return { name: null as string | null, pct: null as number | null };
    const st = stages.find((s) => s.stageOrder === pick.order);
    return { name: st?.stageName ?? null, pct: pick.status === "done" ? 100 : pick.progressPct };
  }, [stageWork, stages]);

  const save = async (target: "draft" | "submitted") => {
    setMsg(null);
    if (!periodStart || !periodEnd) {
      setMsg("보고 기간을 입력하세요.");
      return;
    }
    setSaving(true);
    try {
      // 이번 보고에서 변경한 단계만 기록(델타).
      const stagePayload = Array.from(touched).map((order) => {
        const w = stageWork[order];
        const st = stages.find((s) => s.stageOrder === order);
        return {
          stageOrder: order,
          stageCode: st?.stageCode ?? null,
          stageName: st?.stageName ?? "",
          status: w.status,
          progressPct: w.status === "done" ? 100 : w.progressPct,
          plannedDate: w.plannedDate || null,
          actualDate: w.actualDate || null,
        };
      });
      const res = await fetch("/api/work-plan/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportId: reportId || undefined,
          subjectKind: subject.kind,
          subjectId: subject.id,
          periodStart,
          periodEnd,
          reportDate: reportDate || null,
          meetingLabel: meetingLabel || null,
          progressText: progressText || null,
          planText: planText || null,
          reviewerComment: review ? reviewerComment || "" : undefined,
          fromReview: review,
          currentStageName: currentStage.name,
          currentStagePct: currentStage.pct,
          status: target,
          stages: stagePayload,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error ?? "저장에 실패했습니다.");
      }
      setMsg(target === "submitted" ? "제출되었습니다." : "임시 저장되었습니다.");
      onSaved();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // 부서장 검토: 반려(재보고 대상) | 확인(머징 대상). 의견·분류도 함께 저장.
  const submitReview = async (action: "reject" | "confirm") => {
    if (!reportId) return;
    setReviewing(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/work-plan/report/${reportId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reviewerComment, reviewerCommentKind: reviewKind }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error ?? "처리에 실패했습니다.");
      }
      setMsg(action === "reject" ? "반려되었습니다. (작성자 재보고 대상)" : "확인 완료 — 머징 대상으로 분류되었습니다.");
      onSaved();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setReviewing(false);
    }
  };

  // 임원 지시 하달.
  const submitDirective = async () => {
    if (!reportId) return;
    setExecBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/work-plan/report/${reportId}/directive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: execKind, message: execMessage, contractId: subject.kind === "contract" ? subject.id : null }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.error ?? "지시 하달 실패"); }
      setMsg("지시를 하달했습니다. (부서장 임원지시 목록으로 전달)");
      onSaved();
    } catch (err) { setMsg((err as Error).message); } finally { setExecBusy(false); }
  };

  // 부서장 재보고(임원 지시 답변).
  const submitReReport = async () => {
    if (!reportId) return;
    setExecBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/work-plan/report/${reportId}/re-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directorResponse }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.error ?? "재보고 실패"); }
      setMsg("재보고했습니다. (임원 재보고 목록으로 전달)");
      onSaved();
    } catch (err) { setMsg((err as Error).message); } finally { setExecBusy(false); }
  };

  // 감독 모드(기존 보고)에서는 원 작성자/부서를 우선 표시.
  const reporterText = (review && loadedReporter)
    ? loadedReporter
    : reporter
    ? [reporter.deptName, reporter.positionName, reporter.name].filter(Boolean).join(" ")
    : "—";

  // 회차: 기존 보고=서버 산정값, 신규=회의종류별 기존 제출 수 +1(추정).
  const meetingSeq = reportId ? loadedSeq : (seqByLabel?.[meetingLabel] ?? 0) + 1;

  return (
    <section className="cd-card rounded-3xl p-5 cd-reveal delay-2 flex flex-col min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide flex flex-col gap-4 pr-1">
        {metaRow}

        {/* 헤더 */}
        <div className="rounded-2xl border cd-border-c p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <Field label="보고자 / 부서">
            <div className="cd-input text-sm w-full flex items-center cd-text-muted">{reporterText}</div>
          </Field>
          <Field label="보고 기간">
            <div className="flex items-center gap-1.5">
              <AutoDateInput className="cd-input text-sm flex-1" value={periodStart} onChange={setPeriodStart} disabled={locked} />
              <span className="cd-text-faint text-xs">~</span>
              <AutoDateInput className="cd-input text-sm flex-1" value={periodEnd} onChange={setPeriodEnd} disabled={locked} />
            </div>
          </Field>
          <Field label="회의 종류">
            <select className="cd-select text-sm w-full" value={meetingLabel} onChange={(e) => setMeetingLabel(e.target.value)} disabled={locked}>
              {MEETING_LABELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
              {!MEETING_LABELS.includes(meetingLabel as (typeof MEETING_LABELS)[number]) && meetingLabel && (
                <option value={meetingLabel}>{meetingLabel}</option>
              )}
            </select>
          </Field>
          <Field label="회의일자">
            <div className="flex items-center gap-1.5">
              <AutoDateInput className="cd-input text-sm flex-1 min-w-0" value={reportDate} onChange={setReportDate} disabled={locked} />
              {meetingSeq != null && (
                <span className="shrink-0 text-[11px] font-semibold cd-text-primary cd-tint-primary rounded-lg px-2 py-1.5 whitespace-nowrap">
                  {meetingLabel} {meetingSeq}회차
                </span>
              )}
            </div>
          </Field>
        </div>

        {/* 임원 지시(읽기전용) — 감독 임원지시 답변 모드 */}
        {execResponse && execDirective && (
          <div className="rounded-2xl border p-4" style={{ borderColor: "var(--cd-primary)", background: "var(--cd-tint-primary, rgba(93,135,255,0.08))" }}>
            <p className="text-[11px] font-bold cd-text mb-1 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 cd-text-primary" /> 임원 지시
              <span className="cd-text-faint font-semibold">· {EXEC_DIRECTIVE_KINDS.find((k) => k.value === execDirective.kind)?.label ?? execDirective.kind}</span>
            </p>
            <p className="text-sm cd-text leading-relaxed whitespace-pre-wrap">{execDirective.message}</p>
          </div>
        )}

        {/* 부서장 재보고 답변(읽기전용) — 임원이 재보고 건을 열었을 때 */}
        {exec && directorResponse && (
          <div className="rounded-2xl border p-4" style={{ borderColor: "var(--cd-success)", background: "var(--cd-success-soft)" }}>
            <p className="text-[11px] font-bold cd-text mb-1 flex items-center gap-1.5">
              <MessageSquareText className="w-3.5 h-3.5" /> 부서장 재보고 답변
            </p>
            <p className="text-sm cd-text leading-relaxed whitespace-pre-wrap">{directorResponse}</p>
          </div>
        )}

        {/* 부서장 의견(읽기전용) — 반려/검토된 보고를 작성자가 열었을 때 */}
        {!review && reviewerComment && (
          <div className="rounded-2xl border p-4" style={{ borderColor: "var(--cd-warning)", background: "var(--cd-warning-soft)" }}>
            <p className="text-[11px] font-bold cd-text mb-1 flex items-center gap-1.5">
              <MessageSquareText className="w-3.5 h-3.5" /> 부서장 의견
              {reviewKind && <span className="cd-text-faint font-semibold">· {REVIEW_COMMENT_KINDS.find((k) => k.value === reviewKind)?.label}</span>}
            </p>
            <p className="text-sm cd-text leading-relaxed whitespace-pre-wrap">{reviewerComment}</p>
          </div>
        )}

        {/* 공정표 */}
        <div className="rounded-2xl border cd-border-c p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold cd-text flex items-center gap-2">
              <GitCommitHorizontal className="w-4 h-4 cd-text-primary" /> 공정표
            </h3>
            {!locked && (
              <button
                type="button"
                onClick={() => setShowProcessSetting(true)}
                className="cd-btn cd-btn-ghost rounded-lg px-3 py-1.5 text-xs cd-text-muted inline-flex items-center gap-1 border cd-border-c"
              >
                <Settings2 className="w-3.5 h-3.5" /> 공정표 설정
              </button>
            )}
          </div>
          {stages.length === 0 ? (
            <p className="p-5 text-center text-xs cd-text-faint rounded-xl border cd-border-c">
              공정 단계가 없습니다. [공정표 설정]에서 프리셋을 적용하거나 단계를 추가하세요.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {stages.map((st) => {
                const v = stageVisual(st);
                const active = st.stageOrder === selectedOrder;
                return (
                  <button
                    key={st.stageId}
                    type="button"
                    onClick={() => setSelectedOrder(st.stageOrder)}
                    className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold"
                    style={{
                      background: v.bg,
                      border: `1.5px solid ${v.line}`,
                      color: "var(--cd-text)",
                      ...(active ? { boxShadow: "0 0 0 2px var(--cd-primary)" } : {}),
                    }}
                  >
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: v.line }} />
                    {st.stageName}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 진행단계 */}
        <div className="rounded-2xl border cd-border-c p-4">
          <h3 className="font-bold cd-text mb-3">진행단계</h3>
          {!selectedStage ? (
            <p className="text-xs cd-text-faint">위 공정표에서 단계를 클릭하면 진행 상황을 확인·기록합니다.</p>
          ) : (
            <div className="grid gap-3">
              <p className="text-sm cd-text font-semibold">{selectedStage.stageName}</p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <Field label="상태">
                  <select
                    className="cd-select text-sm w-full"
                    value={selectedWork.status}
                    disabled={locked}
                    onChange={(e) => {
                      const next = e.target.value as StageStatus;
                      setStageW(selectedStage.stageOrder, {
                        status: next,
                        ...(next === "done" ? { progressPct: 100 } : next === "pending" ? { progressPct: 0 } : {}),
                      });
                    }}
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="착수일">
                  <AutoDateInput
                    className="cd-input text-sm w-full"
                    value={selectedWork.plannedDate}
                    onChange={(v) => setStageW(selectedStage.stageOrder, { plannedDate: v })}
                    disabled={locked}
                  />
                </Field>
                <Field label="완료일">
                  <AutoDateInput
                    className="cd-input text-sm w-full"
                    value={selectedWork.actualDate}
                    onChange={(v) => setStageW(selectedStage.stageOrder, { actualDate: v })}
                    disabled={locked}
                  />
                </Field>
                <Field label={`진행율 (단위 ${selectedStage.progressUnitPct}%)`}>
                  <div className="flex flex-col gap-1 pt-1.5">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={selectedStage.progressUnitPct || 10}
                      className="w-full cursor-pointer disabled:opacity-50"
                      style={{ accentColor: "#5d87ff" }}
                      disabled={locked || selectedWork.status !== "in_progress"}
                      value={selectedWork.status === "done" ? 100 : selectedWork.status === "in_progress" ? selectedWork.progressPct : 0}
                      onChange={(e) => setStageW(selectedStage.stageOrder, { progressPct: Number(e.target.value) })}
                    />
                    <span className="text-xs font-bold cd-text-primary text-center">
                      {selectedWork.status === "done" ? 100 : selectedWork.status === "in_progress" ? selectedWork.progressPct : 0}%
                    </span>
                  </div>
                </Field>
              </div>
            </div>
          )}
        </div>

        {/* 수행 인력 */}
        <div className="rounded-2xl border cd-border-c p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold cd-text flex items-center gap-2">
              <UserCog className="w-4 h-4 cd-text-primary" /> 수행 인력
            </h3>
            {!locked && (
              <button
                type="button"
                onClick={() => setShowStaffingSetting(true)}
                className="cd-btn cd-btn-ghost rounded-lg px-3 py-1.5 text-xs cd-text-muted inline-flex items-center gap-1 border cd-border-c"
              >
                <Settings2 className="w-3.5 h-3.5" /> 수행인력 설정
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {staffSlots.map((slot, i) => (
              <div key={i} className="rounded-xl border cd-border-c p-2.5">
                <p className="text-[10px] font-semibold cd-text-faint mb-1">{slot.label}</p>
                {slot.people.length ? (
                  slot.people.map((p) => (
                    <p key={p.employeeId} className="text-xs cd-text truncate">
                      {p.employeeName}
                      {p.positionName ? <span className="cd-text-faint"> {p.positionName}</span> : null}
                    </p>
                  ))
                ) : (
                  <p className="text-xs cd-text-faint">—</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 추진 내역 */}
        <div className="rounded-2xl border cd-border-c p-4">
          <h3 className="font-bold cd-text mb-3">추진 내역</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* label 로 감싸면 클릭이 내부 첫 버튼으로 전달되므로 div 로 감싼다. */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold cd-text-faint">이번 기간</span>
              <StructuredNoteEditor value={progressText} onChange={setProgressText} disabled={locked} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold cd-text-faint">다음 기간</span>
              <StructuredNoteEditor value={planText} onChange={setPlanText} disabled={locked} />
            </div>
          </div>
        </div>

        {/* 부서장 의견 (감독 전용) — 의견 분류 태그 + 입력 */}
        {review && (
          <div className="rounded-2xl border cd-border-c p-4">
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <h3 className="font-bold cd-text flex items-center gap-2">
                <MessageSquareText className="w-4 h-4 cd-text-primary" /> 부서장 의견
              </h3>
              <div className="inline-flex rounded-lg border cd-border-c overflow-hidden text-[11px] font-semibold">
                {REVIEW_COMMENT_KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => setReviewKind(k.value)}
                    className={cn("px-2.5 py-1 border-l first:border-l-0 cd-border-c", reviewKind === k.value ? "cd-fill-primary text-white" : "cd-text-muted cd-row-hover")}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              className="cd-input text-sm w-full min-h-[96px] leading-relaxed"
              placeholder="첨삭·보완 요구·오기 정정 등 부서장 의견을 기재하세요."
              value={reviewerComment}
              onChange={(e) => setReviewerComment(e.target.value)}
            />
          </div>
        )}

        {/* 부서장 답변 (감독 임원지시 답변 모드) */}
        {execResponse && (
          <div className="rounded-2xl border cd-border-c p-4">
            <h3 className="font-bold cd-text mb-3 flex items-center gap-2">
              <MessageSquareText className="w-4 h-4 cd-text-primary" /> 부서장 답변 (시정조치)
            </h3>
            <textarea
              className="cd-input text-sm w-full min-h-[96px] leading-relaxed"
              placeholder="임원 지시에 대한 시정조치·답변을 기재하고 재보고하세요."
              value={directorResponse}
              onChange={(e) => setDirectorResponse(e.target.value)}
            />
          </div>
        )}

        {/* 임원 검토 (임원 검토 모드) */}
        {exec && (
          <div className="rounded-2xl border cd-border-c p-4">
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <h3 className="font-bold cd-text flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 cd-text-primary" /> 임원 검토
              </h3>
              <div className="inline-flex rounded-lg border cd-border-c overflow-hidden text-[11px] font-semibold">
                {EXEC_DIRECTIVE_KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => setExecKind(k.value)}
                    className={cn("px-2.5 py-1 border-l first:border-l-0 cd-border-c", execKind === k.value ? "cd-fill-primary text-white" : "cd-text-muted cd-row-hover")}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              className="cd-input text-sm w-full min-h-[88px] leading-relaxed"
              placeholder="보완 요구·진행 촉구·추가보고 지시 등 임원 검토 의견을 입력하세요."
              value={execMessage}
              onChange={(e) => setExecMessage(e.target.value)}
            />
          </div>
        )}

        {/* 이슈상황 (보고작성·감독 공통) — 용역/Task 단위. 임원/재보고 모드는 숨김 */}
        {!exec && !execResponse && (
          <div className="rounded-2xl border cd-border-c p-4">
            <h3 className="font-bold cd-text mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 cd-error-text" /> 이슈상황
            </h3>
            {subject.kind === "task"
              ? <IssuePanel taskId={subject.id} canRespond={review} />
              : <IssuePanel contractId={subject.id} canRespond={review} />}
          </div>
        )}
      </div>

      {/* 액션 */}
      <div className="flex items-center justify-between gap-3 pt-4 mt-1 border-t cd-border-c">
        <span className="text-xs cd-text-faint">{msg}</span>
        <div className="flex items-center gap-2">
          {exec && reportId && (
            <button
              type="button"
              disabled={execBusy || !EXEC_DIRECTIVE_ACTIONABLE.includes(execKind) || !execMessage.trim()}
              onClick={submitDirective}
              className="rounded-xl px-4 py-2 text-sm text-white cd-fill-primary inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Send className="w-4 h-4" /> {execBusy ? "전송 중…" : "지시 하달"}
            </button>
          )}
          {execResponse && reportId && (
            <button
              type="button"
              disabled={execBusy || reReportCount >= 1}
              onClick={submitReReport}
              title={reReportCount >= 1 ? "재보고는 1회만 가능합니다." : undefined}
              className="rounded-xl px-4 py-2 text-sm text-white inline-flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: "var(--cd-success)" }}
            >
              <Send className="w-4 h-4" /> {execBusy ? "전송 중…" : reReportCount >= 1 ? "재보고 완료" : "재보고"}
            </button>
          )}
          {review && reportId && (
            <>
              <button
                type="button"
                disabled={reviewing || !REJECTABLE_KINDS.includes(reviewKind)}
                onClick={() => submitReview("reject")}
                title={!REJECTABLE_KINDS.includes(reviewKind) ? "'보완 요구'·'오기 정정 요청' 의견일 때 반려할 수 있습니다." : undefined}
                className="cd-btn rounded-xl px-4 py-2 text-sm border inline-flex items-center gap-1.5 disabled:opacity-40"
                style={{ borderColor: "var(--cd-error)", color: "var(--cd-error)" }}
              >
                <Undo2 className="w-4 h-4" /> 반려
              </button>
              <button
                type="button"
                disabled={reviewing}
                onClick={() => submitReview("confirm")}
                className="rounded-xl px-4 py-2 text-sm text-white inline-flex items-center gap-1.5 disabled:opacity-50"
                style={{ background: "var(--cd-success)" }}
              >
                <Check className="w-4 h-4" /> 확인
              </button>
              <span className="w-px h-5 self-center" style={{ background: "var(--cd-border)" }} />
            </>
          )}
          {exec ? null : locked ? (
            <button type="button" onClick={() => setUnlocked(true)} className="rounded-xl px-4 py-2 text-sm text-white cd-fill-primary inline-flex items-center gap-1.5">
              <Pencil className="w-4 h-4" /> 수정
            </button>
          ) : (
            <>
              <button type="button" disabled={saving} onClick={() => save("draft")} className="cd-btn rounded-xl px-4 py-2 text-sm border cd-border-c cd-text-muted inline-flex items-center gap-1.5 disabled:opacity-50">
                <Save className="w-4 h-4" /> 임시 저장
              </button>
              <button type="button" disabled={saving} onClick={() => save("submitted")} className="rounded-xl px-4 py-2 text-sm text-white cd-fill-primary inline-flex items-center gap-1.5 disabled:opacity-50">
                <Send className="w-4 h-4" /> {saving ? "저장 중…" : reportId ? "수정 제출" : "제출"}
              </button>
            </>
          )}
        </div>
      </div>

      {showProcessSetting && (
        <ProcessStageSettingModal
          contractId={subject.id}
          stagesUrl={subject.stagesUrl}
          serviceType={subject.serviceType}
          theme={theme}
          onClose={() => setShowProcessSetting(false)}
          onSaved={() => {
            setShowProcessSetting(false);
            loadStages();
          }}
        />
      )}
      {showStaffingSetting && (
        <StaffingSettingModal
          contractId={subject.id}
          participantsUrl={subject.participantsUrl}
          roleOptions={subject.staffingRoleOptions}
          theme={theme}
          onClose={() => {
            setShowStaffingSetting(false);
            loadParticipants();
          }}
        />
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold cd-text-faint">{label}</span>
      {children}
    </label>
  );
}
