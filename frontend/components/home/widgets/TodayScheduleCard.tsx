"use client";

import { CalendarClock } from "lucide-react";
import { HomeCard, HomeRow } from "../HomeCard";
import { useHomeWidget } from "../useHomeWidget";

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
        {activities.slice(0, 5).map((a) => (
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
              {a.activityType && (
                <span className="text-[10px] rounded px-1.5 py-0.5 shrink-0 cd-text-muted border cd-border-c">
                  {a.activityType}
                </span>
              )}
            </HomeRow>
          </li>
        ))}
      </ul>
    </HomeCard>
  );
}
