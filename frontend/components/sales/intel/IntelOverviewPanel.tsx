"use client";

// 개요 — 계획서 §3.1 "핵심 변화·우선 검토 후보·필요한 의사결정을 먼저". 조회 전용이며 각 행은 해당 탭의 상세로 이동한다.

import { useCallback, useEffect, useState } from "react";
import { CdBadge, CdButton } from "@/components/cdash";
import { SALES_ACTIVITY_TYPE_LABELS, type SalesActivityType } from "@/lib/sales/types";
import type { BriefingRun } from "@/lib/intel/briefing-types";
import type { IntelOverview, OverviewEvent } from "@/lib/intel/discovery-overview";
import type { Briefing } from "./intel-shared";
import type { IntelTab } from "./SalesIntelligenceBoard";
import { INTEL_STAGE_LABELS, formatIntelAmount, intelApi, intelDate, intelTime } from "./intelligence-client";
import { PriorityScore, ReviewPill } from "./ProjectIntelligencePanel";

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

  const overdue = data?.actions.filter((action) => action.overdue).length ?? 0;
  const published = runs.filter((run) => run.status === "published").slice(0, 5);
  const unread = shared.filter((item) => !item.readAt);

  return (
    <div className="intel-stack">
      {error && <div className="intel-error" role="alert">{error}</div>}

      <section className="cd-card" aria-label="요약">
        <div className="intel-stat-strip">
          <div className="intel-stat"><span className="intel-table cd-text-muted">우선 검토 프로젝트</span><strong>{loading ? "–" : (data?.totals.confirmed ?? 0).toLocaleString()}</strong></div>
          <div className="intel-stat"><span className="intel-table cd-text-muted">정보 보완 필요</span><strong>{loading ? "–" : (data?.totals.needsReview ?? 0).toLocaleString()}</strong></div>
          <div className="intel-stat"><span className="intel-table cd-text-muted">기한 경과 활동</span><strong className={overdue ? "is-warn" : undefined}>{loading ? "–" : overdue.toLocaleString()}</strong></div>
          <div className="intel-stat"><span className="intel-table cd-text-muted">미검토 신규 사업장</span><strong>{loading ? "–" : (data?.totals.newCandidates ?? 0).toLocaleString()}</strong></div>
        </div>
      </section>

      <div className="intel-grid-2">
        <section className="cd-card">
          <div className="intel-card-head">
            <div><h2 className="intel-section">중요 변화</h2><span className="intel-table cd-text-muted">최근 14일</span></div>
          </div>
          {data && data.events.length > 0 ? (
            <ul className="intel-rows">
              {data.events.map((event) => (
                <li key={event.eventId}>
                  <button type="button" className="intel-row-item" onClick={() => onNavigate("discovery", { projectId: event.projectId })}>
                    <div className="intel-row-main">
                      <p className="intel-row-title">{event.projectTitle}</p>
                      <p className="intel-row-meta">{eventChange(event)} · {[event.companyName, event.region].filter(Boolean).join(" · ") || "기업 미확인"} · {intelDate(event.discoveredAt)} 확인</p>
                    </div>
                    <div className="intel-row-side"><CdBadge tone={event.important ? "warn" : "idle"}>{EVENT_LABEL[event.kind]}</CdBadge></div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="intel-empty">
              <p>{loading ? "불러오는 중…" : "새로운 주요 변동이 없습니다."}</p>
              {!loading && !!data?.baselineProjects && <p className="intel-table mt-1">기존 자료 초기 분석으로 정리한 프로젝트 {data.baselineProjects.toLocaleString()}건은 중요 변화 알림에서 제외했습니다.</p>}
            </div>
          )}
        </section>

        <section className="cd-card">
          <div className="intel-card-head">
            <div><h2 className="intel-section">내 후속 활동</h2><span className="intel-table cd-text-muted">담당 또는 등록한 활동</span></div>
          </div>
          {data && data.actions.length > 0 ? (
            <ul className="intel-rows">
              {data.actions.map((action) => (
                <li key={action.actionId}>
                  <button type="button" className="intel-row-item" onClick={() => onNavigate("discovery", { projectId: action.projectId })}>
                    <div className="intel-row-main">
                      <p className="intel-row-title">{action.title}</p>
                      <p className="intel-row-meta">{action.projectTitle} · {SALES_ACTIVITY_TYPE_LABELS[action.activityType as SalesActivityType] ?? action.activityType} · {action.scheduledAt ? `예정 ${intelDate(action.scheduledAt)}` : "예정일 미정"}</p>
                    </div>
                    <div className="intel-row-side">
                      {action.overdue ? <CdBadge tone="error">기한 경과</CdBadge>
                        : action.status === "accepted" ? <CdBadge tone="info">예정</CdBadge>
                        : <CdBadge tone="idle">{action.status === "hold" ? "보류" : "검토 대기"}</CdBadge>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="intel-empty">{loading ? "불러오는 중…" : "진행 중인 후속 활동이 없습니다. 영업 발굴의 프로젝트 상세에서 권장 활동을 채택하면 여기에 모입니다."}</p>
          )}
        </section>

        <section className="cd-card">
          <div className="intel-card-head">
            <div><h2 className="intel-section">우선 검토 후보</h2><span className="intel-table cd-text-muted">공개 근거 점수 순</span></div>
            <CdButton size="sm" variant="ghost" onClick={() => onNavigate("discovery")}>전체 보기</CdButton>
          </div>
          {data && data.top.length > 0 ? (
            <ul className="intel-rows">
              {data.top.map((project) => (
                <li key={project.projectId}>
                  <button type="button" className="intel-row-item" onClick={() => onNavigate("discovery", { projectId: project.projectId })}>
                    <div className="intel-row-main">
                      <p className="intel-row-title">{project.title}</p>
                      <p className="intel-row-meta">{[project.companyName ?? "기업 미확인", project.region ?? "지역 미확인", formatIntelAmount(project.amount, project.currency)].join(" · ")}</p>
                    </div>
                    <div className="intel-row-side"><PriorityScore priority={project.priority} /><ReviewPill priority={project.priority} /></div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="intel-empty">{loading ? "불러오는 중…" : "평가된 투자 프로젝트가 없습니다."}</p>
          )}
        </section>

        <section className="cd-card">
          <div className="intel-card-head">
            <div><h2 className="intel-section">최근 브리핑</h2>{unread.length > 0 && <span className="intel-table cd-text-muted">공유받은 미열람 {unread.length}건</span>}</div>
            <CdButton size="sm" variant="ghost" onClick={() => onNavigate("briefing")}>브리핑 열기</CdButton>
          </div>
          {published.length + unread.length > 0 ? (
            <ul className="intel-rows">
              {unread.slice(0, 3).map((item) => (
                <li key={item.shareId}>
                  <button type="button" className="intel-row-item" onClick={() => onNavigate("briefing", { view: "ask", briefingId: item.briefingId })}>
                    <div className="intel-row-main">
                      <p className="intel-row-title">{item.question}</p>
                      <p className="intel-row-meta">{item.sharedByName ?? "알 수 없음"} 님 공유 · {intelTime(item.sharedAt)}</p>
                    </div>
                    <div className="intel-row-side"><CdBadge tone="info">미열람</CdBadge></div>
                  </button>
                </li>
              ))}
              {published.map((run) => (
                <li key={run.runId}>
                  <button type="button" className="intel-row-item" onClick={() => onNavigate("briefing", { runId: run.runId })}>
                    <div className="intel-row-main">
                      <p className="intel-row-title">{run.profileName}</p>
                      <p className="intel-row-meta">{run.trigger === "scheduled" ? "정기" : "수동"} 발행 · {intelTime(run.scheduledFor)}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="intel-empty">{loading ? "불러오는 중…" : "발행된 브리핑이 없습니다. 관심 설정에서 관심 분야를 등록하세요."}</p>
          )}
        </section>
      </div>
    </div>
  );
}
