"use client";

import { useMemo } from "react";
import {
  ACTIVITY_TYPE_META,
  SALES_ACTIVITY_TYPE_LABELS,
  SALES_STAGE_LABELS,
  type SalesActivity,
  type SalesActivityType,
  type SalesProject,
} from "@/lib/sales/types";

// 영업활동 진행상황 인포그래픽 파이프라인 순서(전화→미팅→견적→현설→투찰→제안→결과)
const STAGE_FLOW: SalesActivityType[] = ["telemarketing", "visit", "quote", "site_briefing", "bid", "proposal_meeting", "result"];

function whenOf(a: SalesActivity): string {
  return (a.scheduledAt ?? a.occurredAt ?? a.createdAt ?? "").slice(0, 16);
}

const ORDER_TYPE_LABELS: Record<string, string> = { negotiated: "수의계약", limited: "제한경쟁", qualification: "적격심사" };

export interface OrderInfoSummary {
  orderType: string | null;
  participants: string[];
}

export function SalesProgressCard({ project, activities, orderInfo }: { project: SalesProject; activities: SalesActivity[]; orderInfo?: OrderInfoSummary | null }) {
  const info = useMemo(() => {
    const sorted = [...activities].sort((a, b) => whenOf(a).localeCompare(whenOf(b)));
    const registered = new Set(activities.map((a) => a.activityType));

    // 진행 중: 직전 스케쥴에 경과 입력 + 해당 스케쥴 경과 미입력
    let activeType: SalesActivityType | null = null;
    for (let i = 0; i < sorted.length; i++) {
      const prevDone = i === 0 || !!(sorted[i - 1].progressNote && sorted[i - 1].progressNote!.trim());
      const curDone = !!(sorted[i].progressNote && sorted[i].progressNote!.trim());
      if (prevDone && !curDone) {
        activeType = sorted[i].activityType;
        break;
      }
    }

    // 착수일 = 최초 스케쥴 시작일
    const startIso = sorted.length ? whenOf(sorted[0]).slice(0, 10) : null;
    let elapsedDays = 0;
    if (startIso) {
      const [y, m, d] = startIso.split("-").map(Number);
      const start = Date.UTC(y, m - 1, d);
      const now = new Date();
      const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
      elapsedDays = Math.max(0, Math.round((today - start) / 86400000));
    }

    // 활동상세: 일정명별 횟수
    const counts = new Map<SalesActivityType, number>();
    for (const a of activities) counts.set(a.activityType, (counts.get(a.activityType) ?? 0) + 1);

    // 예정 유형: 해당 일정명의 최초 스케쥴 시작일시가 미래(오늘·현재 시각 이후)
    const nowIso = new Date().toISOString();
    const earliestByType = new Map<SalesActivityType, string>();
    for (const a of activities) {
      const w = a.scheduledAt ?? a.occurredAt ?? a.createdAt;
      const cur = earliestByType.get(a.activityType);
      if (!cur || w < cur) earliestByType.set(a.activityType, w);
    }
    const futureTypes = new Set<SalesActivityType>();
    for (const [t, w] of earliestByType) if (w > nowIso) futureTypes.add(t);

    // 투찰정보
    const allQuotes = activities.filter((a) => a.activityType === "quote").flatMap((a) => a.quotes ?? []);
    const allBids = activities.filter((a) => a.activityType === "bid").flatMap((a) => a.bids ?? []);
    const lastQuote = allQuotes.length ? allQuotes[allQuotes.length - 1].amount : null;
    const lastBid = allBids.length ? allBids[allBids.length - 1].amount : null;

    return { registered, activeType, futureTypes, startIso, elapsedDays, counts, quoteCount: allQuotes.length, lastQuote, bidCount: allBids.length, lastBid };
  }, [activities]);

  const flowTags = STAGE_FLOW.filter((t) => info.registered.has(t));
  const detailEntries = Array.from(info.counts.entries());

  return (
    <div className="cd-card-bg rounded-2xl border cd-border-c py-4 w-full h-full min-h-0 overflow-y-auto scrollbar-hide" style={{ paddingLeft: 21, paddingRight: 21 }}>
      <h2 className="cd-text font-extrabold text-sm mb-3">영업활동 진행상황</h2>

      {/* 인포그래픽 파이프라인 */}
      {flowTags.length > 0 ? (
        <div className="relative flex items-center justify-between mb-4">
          <div className="absolute left-1 right-2 top-1/2 -translate-y-1/2 h-2 rounded-full pointer-events-none"
            style={{ background: "linear-gradient(90deg, #FFE9A8, #FDC748)" }} />
          {flowTags.map((t) => {
            const on = info.activeType === t;
            const future = !on && info.futureTypes.has(t);
            const style = on
              ? { background: "#EAF7E1", border: "1.5px solid #7EBA56", color: "#4A7A2E" }
              : future
              ? { background: "var(--cd-card)", border: "1.5px solid var(--cd-primary)", color: "var(--cd-primary)" }
              : { background: "var(--cd-card)", border: "1px solid var(--cd-border)", color: "var(--cd-muted)" };
            return (
              <span key={t} className="relative z-10 rounded-full px-3 py-1 text-xs shrink-0" style={style}>
                {ACTIVITY_TYPE_META[t].short}
              </span>
            );
          })}
          <span className="relative z-10 shrink-0 pointer-events-none"
            style={{ width: 0, height: 0, borderTop: "8px solid transparent", borderBottom: "8px solid transparent", borderLeft: "12px solid #FDC748" }} />
        </div>
      ) : (
        <div className="cd-text-faint text-xs mb-4">등록된 스케쥴이 없습니다.</div>
      )}

      {/* 진행 단계 · 착수일 · 경과기간 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4">
        <div className="rounded-xl border cd-border-c p-3 flex flex-col items-center justify-center">
          <span className="cd-text-faint text-[11px] mb-1">진행 단계</span>
          <span className="cd-text">{SALES_STAGE_LABELS[project.stage]}</span>
        </div>
        <div className="rounded-xl p-3 flex flex-col items-center justify-center" style={{ border: "2px solid #7EBA56" }}>
          <span className="text-[11px] mb-1" style={{ color: "#4A7A2E" }}>현재 활동</span>
          <span style={{ color: "#4A7A2E" }}>{info.activeType ? ACTIVITY_TYPE_META[info.activeType].label : "—"}</span>
        </div>
        <div className="rounded-xl border cd-border-c p-3 flex flex-col gap-1 justify-center">
          <div className="flex justify-between text-[13px]"><span className="cd-text-faint">착수일</span><span className="cd-text">{info.startIso ? info.startIso.replace(/-/g, ".") + "." : "—"}</span></div>
          <div className="flex justify-between text-[13px]"><span className="cd-text-faint">경과기간</span><span className="cd-text">{info.elapsedDays}일</span></div>
        </div>
      </div>

      {/* 활동 상세 */}
      <div className="mb-4">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="w-1 h-3.5 rounded-full" style={{ background: "var(--cd-success)" }} />
          <h3 className="cd-text text-sm">활동 상세</h3>
        </div>
        {detailEntries.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2">
            {detailEntries.map(([t, n]) => (
              <div key={t} className="flex justify-between border-b cd-border-c pb-1 text-[13px]">
                <span className="cd-text-muted">{SALES_ACTIVITY_TYPE_LABELS[t]}</span>
                <span className="cd-text">{n}회</span>
              </div>
            ))}
          </div>
        ) : (
          <span className="cd-text-faint text-xs">활동 내역이 없습니다.</span>
        )}
      </div>

      {/* 투찰 정보 */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <span className="w-1 h-3.5 rounded-full" style={{ background: "var(--cd-primary)" }} />
          <h3 className="cd-text text-sm">투찰 정보</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div className="rounded-xl border cd-border-c p-3 flex flex-col gap-1.5">
            <div className="flex justify-between text-[13px]">
              <span className="cd-text-faint">{info.quoteCount > 1 ? `견적가 (${info.quoteCount}차)` : "견적가 (1차)"}</span>
              <span className="cd-text">{info.lastQuote != null ? `₩${info.lastQuote.toLocaleString()}` : "—"}</span>
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="cd-text-faint">최종 입찰가</span>
              <span className="cd-text">{info.lastBid != null ? `₩${info.lastBid.toLocaleString()}` : "—"}</span>
            </div>
          </div>
          <div className="rounded-xl border cd-border-c p-3 flex flex-col gap-1.5">
            <div className="flex justify-between text-[13px]">
              <span className="cd-text-faint">발주유형</span>
              <span className="cd-text">{orderInfo?.orderType ? ORDER_TYPE_LABELS[orderInfo.orderType] ?? orderInfo.orderType : "—"}</span>
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="cd-text-faint">참여업체</span>
              <span className="cd-text">{orderInfo?.participants?.length ? `${orderInfo.participants.length}개사` : "—"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
