"use client";

import { CalendarClock } from "lucide-react";
import { HomeCard, HomeRow } from "../HomeCard";
import { useHomeWidget } from "../useHomeWidget";
import { ACTIVITY_TYPE_META, type SalesActivityType } from "@/lib/sales/types";

interface Activity {
  activityId: string;
  projectId: string;
  projectTitle: string;
  facilityName: string | null;
  activityType: string | null;
  scheduledAt: string | null;
  endedAt: string | null;
  summary: string | null;
}

/** 날짜 문자열 → "M/D(요일) HH:mm" (KST 기준 표시). */
function fmt(dt: string | null): string {
  if (!dt) return "-";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return dt;
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const dow = ["일", "월", "화", "수", "목", "금", "토"][kst.getUTCDay()];
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}(${dow}) ${hh}:${mm}`;
}

/** H1 — 오늘·이번 주 내 영업 일정. */
export function TodayScheduleCard() {
  const w = useHomeWidget<{ activities: Activity[] }>("/api/sales/upcoming-activities");
  if (w.status === "forbidden") return null;
  const activities = w.status === "ok" ? w.data.activities : [];

  return (
    <HomeCard
      icon={<CalendarClock className="w-4 h-4" />}
      title="오늘·이번 주 일정"
      count={activities.length}
      accent="#5D87FF"
      href="/sales"
      loading={w.status === "loading"}
      error={w.status === "error" ? w.message : undefined}
      empty={w.status === "ok" && activities.length === 0}
      emptyText="예정된 일정이 없습니다."
    >
      <ul className="flex flex-col gap-1.5">
        {activities.slice(0, 5).map((a) => {
          const meta = a.activityType
            ? ACTIVITY_TYPE_META[a.activityType as SalesActivityType]
            : undefined;
          return (
            <li key={a.activityId}>
              <HomeRow href="/sales">
                <span className="text-[11px] font-mono cd-text-faint shrink-0 w-[104px] tabular-nums">
                  {fmt(a.scheduledAt)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] cd-text truncate">{a.projectTitle}</span>
                  {a.facilityName && (
                    <span className="block text-[11px] cd-text-faint truncate">{a.facilityName}</span>
                  )}
                </span>
                {meta && (
                  <span
                    className="text-[11px] rounded-full px-2 py-0.5 shrink-0"
                    style={{ background: meta.color, color: "#1f2937" }}
                  >
                    {meta.short}
                  </span>
                )}
              </HomeRow>
            </li>
          );
        })}
      </ul>
    </HomeCard>
  );
}
