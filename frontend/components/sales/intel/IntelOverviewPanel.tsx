"use client";

// 개요 — 계획서 §3.1 "핵심 변화·우선 검토 후보·필요한 의사결정을 먼저". 조회 전용이며 각 항목은 해당 탭의 상세로 이동한다.

import { useCallback, useEffect, useState } from "react";
import { AlarmClock, Building2, CalendarCheck, FileText, Flame, ListChecks, Target, TrendingUp } from "lucide-react";
import { SALES_ACTIVITY_TYPE_LABELS, type SalesActivityType } from "@/lib/sales/types";
import type { BriefingRun } from "@/lib/intel/briefing-types";
import type { IntelOverview, OverviewEvent } from "@/lib/intel/discovery-overview";
import type { Briefing } from "./intel-shared";
import type { IntelTab } from "./SalesIntelligenceBoard";
import { INTEL_SERVICE_LABELS, INTEL_STAGE_LABELS, formatIntelAmount, intelApi, intelDate, intelTime } from "./intelligence-client";
import { IntelBar, IntelCard, IntelEmpty, IntelError, IntelKpi, IntelTile } from "./intel-ui-kit";

type SharedItem = Briefing & { shareId: string; sharedByName: string | null; sharedAt: string; readAt: string | null };

const EVENT_LABEL: Record<OverviewEvent["kind"], string> = { new: "신규", stage: "단계 변경", amount: "금액 변경", correction: "정정" };

function eventChange(event: OverviewEvent): string {
  if (event.kind === "stage") return `${INTEL_STAGE_LABELS[event.beforeStage ?? "unknown"] ?? "미확인"} → ${INTEL_STAGE_LABELS[event.afterStage ?? "unknown"] ?? event.afterStage}`;
  if (event.kind === "amount") return `${formatIntelAmount(event.beforeAmount)} → ${formatIntelAmount(event.afterAmount)}`;
  if (event.kind === "correction") return "이전 사실 정정";
  return event.afterAmount != null ? `투자금액 ${formatIntelAmount(event.afterAmount)}` : "새 투자 프로젝트";
}

export function IntelOverviewPanel({ onNavigate }: { onNavigate: (tab: IntelTab, extra?: Record<string, string>) => void }) {
  const [data, setData] = useState<IntelOverview | null>(null);
  const [runs, setRuns] = useState<BriefingRun[]>([]);
  const [shared, setShared] = useState<SharedItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [overview, runList, sharedList] = await Promise.all([
        intelApi<IntelOverview>("/api/sales/intel/overview"),
        intelApi<{ runs: BriefingRun[] }>("/api/sales/rag/runs").catch(() => ({ runs: [] as BriefingRun[] })),
        intelApi<{ briefings: SharedItem[] }>("/api/sales/rag/briefings/shared?limit=20").catch(() => ({ briefings: [] as SharedItem[] })),
      ]);
      setData(overview); setRuns(runList.runs); setShared(sharedList.briefings); setError("");
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const v = (n: number | undefined) => (loading ? "—" : (n ?? 0).toLocaleString());
  const overdue = data?.actions.filter((action) => action.overdue).length ?? 0;
  const published = runs.filter((run) => run.status === "published").slice(0, 5);
  const unread = shared.filter((item) => !item.readAt);

  return (
    <div className="flex flex-col gap-4 min-w-0">
      {error && <IntelError>{error}</IntelError>}

      <div className="grid gap-3 grid-cols-2 xl:grid-cols-4" role="group" aria-label="영업 발굴 요약">
        <IntelKpi icon={Target} color="var(--cd-primary)" label="우선 검토 프로젝트" value={v(data?.totals.confirmed)} sub="서비스·단계 확인" onClick={() => onNavigate("discovery", { review: "confirmed" })} />
        <IntelKpi icon={ListChecks} color="var(--cd-secondary)" label="정보 보완 필요" value={v(data?.totals.needsReview)} sub="확정 순위와 분리" onClick={() => onNavigate("discovery", { review: "needs_review" })} />
        <IntelKpi icon={AlarmClock} color={overdue ? "var(--cd-error)" : "var(--cd-success)"} label="기한 경과 활동" value={loading ? "—" : overdue} sub={`진행 중 ${data?.actions.length ?? 0}건`} />
        <IntelKpi icon={Building2} color="var(--cd-warning)" label="미검토 신규 사업장" value={v(data?.totals.newCandidates)} sub="마스터 미등록" onClick={() => onNavigate("candidates")} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <IntelCard icon={Flame} tone="var(--cd-warning)" title="중요 변화" desc="최근 14일 새로 확인된 신규·단계 변경·금액 변경·정정" count={data?.events.length || undefined}>
          {data && data.events.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {data.events.map((event) => (
                <IntelTile key={event.eventId} onClick={() => onNavigate("discovery", { projectId: event.projectId })}>
                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                    <span className="cd-text text-sm font-bold truncate">{event.projectTitle}</span>
                    <span className={`cd-pill ${event.important ? "cd-pill-warn" : "cd-pill-idle"}`}>{EVENT_LABEL[event.kind]}</span>
                  </div>
                  <p className="cd-text text-xs mt-1">{eventChange(event)}</p>
                  <p className="cd-text-faint text-[11px] mt-0.5">{[event.companyName, event.region].filter(Boolean).join(" · ") || "기업 미확인"} · {intelDate(event.discoveredAt)} 확인</p>
                </IntelTile>
              ))}
            </div>
          ) : (
            <IntelEmpty>
              {loading ? "불러오는 중…" : <>새로운 주요 변동이 없습니다.{!!data?.baselineProjects && <span className="block text-[11px] mt-1">기존 자료 초기 분석 프로젝트 {data.baselineProjects.toLocaleString()}건은 중요 변화에서 제외했습니다.</span>}</>}
            </IntelEmpty>
          )}
        </IntelCard>

        <IntelCard icon={CalendarCheck} title="내 후속 활동" desc="내가 담당하거나 등록한 영업 활동" count={data?.actions.length || undefined}>
          {data && data.actions.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {data.actions.map((action) => (
                <IntelTile key={action.actionId} onClick={() => onNavigate("discovery", { projectId: action.projectId })} style={action.overdue ? { borderColor: "color-mix(in srgb, var(--cd-error) 40%, var(--cd-card))" } : undefined}>
                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                    <span className="cd-text text-sm font-bold truncate">{action.title}</span>
                    {action.overdue ? <span className="cd-pill cd-pill-error">기한 경과</span>
                      : action.status === "accepted" ? <span className="cd-pill cd-pill-info">예정</span>
                      : <span className="cd-pill cd-pill-idle">{action.status === "hold" ? "보류" : "검토 대기"}</span>}
                    <span className="cd-pill cd-pill-outline">{SALES_ACTIVITY_TYPE_LABELS[action.activityType as SalesActivityType] ?? action.activityType}</span>
                  </div>
                  <p className="cd-text-muted text-[11px] truncate mt-1">{action.projectTitle}</p>
                  <p className="cd-text-faint text-[11px] mt-0.5">{action.scheduledAt ? `예정 ${intelDate(action.scheduledAt)}` : "예정일 미정"}</p>
                </IntelTile>
              ))}
            </div>
          ) : (
            <IntelEmpty>{loading ? "불러오는 중…" : "진행 중인 후속 활동이 없습니다. 영업 발굴의 프로젝트 상세에서 권장 활동을 채택하면 여기에 모입니다."}</IntelEmpty>
          )}
        </IntelCard>

        <IntelCard icon={TrendingUp} title="우선 검토 후보" desc="공개 근거 점수 높은 순 (최대 85점)"
          actions={<button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => onNavigate("discovery")}>전체 보기</button>}>
          {data && data.top.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {data.top.map((project) => (
                <IntelTile key={project.projectId} onClick={() => onNavigate("discovery", { projectId: project.projectId })}>
                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                    <span className="cd-text text-sm font-bold truncate">{project.companyName ?? "기업 미확인"}</span>
                    {project.priority && !project.priority.needsReview ? <span className="cd-pill cd-pill-success">우선 검토</span> : <span className="cd-pill cd-pill-idle">정보 보완</span>}
                    {project.extras.services.map((code) => <span key={code} className="cd-pill cd-pill-outline">{INTEL_SERVICE_LABELS[code] ?? code}</span>)}
                  </div>
                  <p className="cd-text-muted text-[11px] truncate mt-1">{project.title}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <IntelBar value={project.priority?.score ?? 0} max={project.priority?.maximum ?? 85} height={4} />
                    <span className="cd-text text-xs font-extrabold tabular-nums">{project.priority?.score ?? "–"}</span>
                    <span className="cd-text-faint text-[11px] shrink-0">{formatIntelAmount(project.amount, project.currency)}</span>
                  </div>
                </IntelTile>
              ))}
            </div>
          ) : (
            <IntelEmpty>{loading ? "불러오는 중…" : "평가된 투자 프로젝트가 없습니다."}</IntelEmpty>
          )}
        </IntelCard>

        <IntelCard icon={FileText} title="최근 브리핑" desc="정기 발행본과 공유받은 보고서" count={unread.length ? `새 공유 ${unread.length}건` : undefined}
          actions={<button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => onNavigate("briefing")}>브리핑 열기</button>}>
          {published.length + unread.length > 0 ? (
            <div className="flex flex-col">
              {unread.slice(0, 3).map((item) => (
                <button key={item.shareId} className="flex items-center gap-2 py-2 border-b cd-border-c last:border-b-0 min-w-0 text-left cd-row-hover rounded-lg px-1" onClick={() => onNavigate("briefing", { view: "ask", briefingId: item.briefingId })}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate cd-text font-bold">{item.question}</p>
                    <p className="cd-text-faint text-[11px]">{item.sharedByName ?? "알 수 없음"} 님이 공유 · {intelTime(item.sharedAt)}</p>
                  </div>
                  <span className="cd-pill cd-pill-info shrink-0">읽지 않음</span>
                </button>
              ))}
              {published.map((run) => (
                <button key={run.runId} className="flex items-center gap-2 py-2 border-b cd-border-c last:border-b-0 min-w-0 text-left cd-row-hover rounded-lg px-1" onClick={() => onNavigate("briefing", { runId: run.runId })}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate cd-text">{run.profileName}</p>
                    <p className="cd-text-faint text-[11px]">{run.trigger === "scheduled" ? "정기" : "수동"} 발행 · {intelTime(run.scheduledFor)}</p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <IntelEmpty>{loading ? "불러오는 중…" : "발행된 브리핑이 없습니다. 관심 설정에서 관심 분야를 등록하세요."}</IntelEmpty>
          )}
        </IntelCard>
      </div>
    </div>
  );
}
