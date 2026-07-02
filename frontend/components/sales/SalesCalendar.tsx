"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { ACTIVITY_TYPE_META, SALES_ACTIVITY_TYPE_LABELS, type SalesActivity, type SalesActivityType } from "@/lib/sales/types";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
// 일정 목록의 수행 인원 라벨 — 일정명별.
const ACTOR_SHORT: Partial<Record<SalesActivityType, string>> = {
  telemarketing: "통화",
  email: "송신",
  visit: "방문",
  site_briefing: "참석",
  proposal_meeting: "참석",
  quote: "제출",
  bid: "투찰",
};
const LANE_H = 20; // 바 1개 높이(px)
const MAX_LANES = 3;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dayNum(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

interface ActSpan {
  a: SalesActivity;
  startIso: string;
  endIso: string;
  s: number;
  e: number;
}

/** 영업 스케쥴 월 캘린더 — 색상 바(당일/복수일·겹침 최대 3) + 우측 일정 목록. */
export function SalesCalendar({
  activities,
  canEdit,
  onPickDate,
  onEditActivity,
}: {
  activities: SalesActivity[];
  canEdit: boolean;
  onPickDate: (isoDate: string) => void;
  onEditActivity: (activity: SalesActivity) => void;
}) {
  const now = new Date();
  const [cur, setCur] = useState({ y: now.getFullYear(), m: now.getMonth() });

  const spans = useMemo<ActSpan[]>(() => {
    return activities
      .filter((a) => a.scheduledAt || a.occurredAt)
      .map((a) => {
        const startIso = (a.scheduledAt ?? a.occurredAt ?? a.createdAt).slice(0, 10);
        const endIso = (a.endedAt ?? a.scheduledAt ?? a.occurredAt ?? a.createdAt).slice(0, 10);
        return { a, startIso, endIso, s: dayNum(startIso), e: Math.max(dayNum(endIso), dayNum(startIso)) };
      })
      .sort((x, y) => (x.a.createdAt < y.a.createdAt ? -1 : 1)); // 입력순
  }, [activities]);

  // lane 배정(월 전역, 최대 3). 초과는 -1(overflow).
  const laneOf = useMemo(() => {
    const lanes: Array<Array<{ s: number; e: number }>> = [[], [], []];
    const map = new Map<string, number>();
    for (const it of spans) {
      let placed = -1;
      for (let l = 0; l < MAX_LANES; l++) {
        if (lanes[l].every((iv) => it.e < iv.s || it.s > iv.e)) {
          lanes[l].push({ s: it.s, e: it.e });
          placed = l;
          break;
        }
      }
      map.set(it.a.activityId, placed);
    }
    return map;
  }, [spans]);

  const weeks = useMemo(() => {
    const first = new Date(cur.y, cur.m, 1);
    const start = new Date(cur.y, cur.m, 1 - first.getDay());
    const out: Date[][] = [];
    const cursor = new Date(start);
    for (let w = 0; w < 6; w++) {
      const row: Date[] = [];
      for (let d = 0; d < 7; d++) {
        row.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      out.push(row);
    }
    return out;
  }, [cur]);

  const monthList = useMemo(() => {
    const mStart = dayNum(`${cur.y}-${String(cur.m + 1).padStart(2, "0")}-01`);
    const mEnd = dayNum(ymd(new Date(cur.y, cur.m + 1, 0)));
    return spans.filter((it) => !(it.e < mStart || it.s > mEnd)).sort((x, y) => x.s - y.s);
  }, [spans, cur]);

  const moveMonth = (delta: number) =>
    setCur((c) => {
      const m = c.m + delta;
      return { y: c.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });
  const moveYear = (delta: number) => setCur((c) => ({ ...c, y: c.y + delta }));

  const todayIso = ymd(now);
  const cellH = 28 + MAX_LANES * LANE_H + 8;

  return (
    <div className="flex gap-3 flex-col lg:flex-row mb-4">
      {/* 캘린더 */}
      <div className="cd-card-bg rounded-2xl border cd-border-c p-3 flex-1 min-w-0">
        <div className="flex items-center justify-center gap-2 mb-3">
          <button className="w-9 h-9 rounded-xl border cd-border-c cd-card-bg flex items-center justify-center cd-text-muted hover:text-[color:var(--cd-primary)] hover:border-[color:var(--cd-primary)] transition" onClick={() => moveMonth(-1)} title="이전 달"><ChevronLeft className="w-5 h-5" /></button>
          <div className="flex items-center gap-2 rounded-xl border cd-border-c px-4 py-1.5">
            <div className="flex flex-col">
              <button className="cd-text-faint hover:text-[color:var(--cd-primary)] leading-none" onClick={() => moveYear(1)} title="다음 해"><ChevronUp className="w-4 h-4" /></button>
              <button className="cd-text-faint hover:text-[color:var(--cd-primary)] leading-none" onClick={() => moveYear(-1)} title="이전 해"><ChevronDown className="w-4 h-4" /></button>
            </div>
            <h2 className="cd-text font-extrabold text-base tabular-nums">{cur.y}년 {cur.m + 1}월</h2>
          </div>
          <button className="w-9 h-9 rounded-xl border cd-border-c cd-card-bg flex items-center justify-center cd-text-muted hover:text-[color:var(--cd-primary)] hover:border-[color:var(--cd-primary)] transition" onClick={() => moveMonth(1)} title="다음 달"><ChevronRight className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-7">
          {WEEKDAYS.map((w, i) => (
            <div key={w} className="text-[11px] font-bold text-center py-1" style={{ color: i === 0 ? "#EF4444" : i === 6 ? "#3B82F6" : "var(--cd-faint)" }}>{w}</div>
          ))}
        </div>
        {weeks.map((week, wi) => {
          const weekStart = dayNum(ymd(week[0]));
          const weekEnd = weekStart + 6;
          const segs = spans
            .filter((it) => (laneOf.get(it.a.activityId) ?? -1) >= 0 && !(it.e < weekStart || it.s > weekEnd))
            .map((it) => ({
              it,
              colStart: Math.max(it.s, weekStart) - weekStart,
              colEnd: Math.min(it.e, weekEnd) - weekStart,
              lane: laneOf.get(it.a.activityId) ?? 0,
            }));
          const overflow = new Array(7).fill(0);
          for (const it of spans) {
            if ((laneOf.get(it.a.activityId) ?? -1) !== -1) continue;
            for (let c = 0; c < 7; c++) {
              const dn = weekStart + c;
              if (dn >= it.s && dn <= it.e) overflow[c]++;
            }
          }
          return (
            <div key={wi} className="relative grid grid-cols-7" style={{ minHeight: cellH }}>
              {week.map((day, di) => {
                const iso = ymd(day);
                const inMonth = day.getMonth() === cur.m;
                const dow = day.getDay();
                return (
                  <button
                    key={di}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => canEdit && onPickDate(iso)}
                    className="border text-left p-1 flex flex-col"
                    style={{
                      borderColor: iso === todayIso ? "var(--cd-primary)" : "var(--cd-border)",
                      background: "var(--cd-card)",
                      boxShadow: iso === todayIso ? "inset 0 0 0 2px var(--cd-primary)" : undefined,
                      opacity: inMonth ? 1 : 0.4,
                    }}
                  >
                    <span className="text-[11px] font-bold" style={{ color: dow === 0 ? "#EF4444" : dow === 6 ? "#3B82F6" : "var(--cd-muted)" }}>
                      {day.getDate()}
                    </span>
                    {overflow[di] > 0 && <span className="cd-text-faint text-[9px] mt-auto">+{overflow[di]}</span>}
                  </button>
                );
              })}
              {segs.map(({ it, colStart, colEnd, lane }) => (
                <button
                  key={it.a.activityId}
                  type="button"
                  onClick={() => onEditActivity(it.a)}
                  className="absolute rounded-md text-[11px] px-1.5 truncate text-left font-semibold"
                  style={{
                    left: `calc(${colStart} / 7 * 100% + 2px)`,
                    width: `calc(${colEnd - colStart + 1} / 7 * 100% - 4px)`,
                    top: 26 + lane * LANE_H,
                    height: LANE_H - 3,
                    background: it.a.color ?? ACTIVITY_TYPE_META[it.a.activityType].color,
                    color: "#1f2937",
                  }}
                  title={SALES_ACTIVITY_TYPE_LABELS[it.a.activityType]}
                >
                  {SALES_ACTIVITY_TYPE_LABELS[it.a.activityType]}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* 우측 일정 목록 — 태그 구획 */}
      <div className="cd-card-bg rounded-2xl border cd-border-c p-3 w-full lg:w-[300px] shrink-0">
        <h3 className="cd-text font-extrabold text-sm mb-2">일정 목록</h3>
        <div className="flex flex-col gap-2.5">
          {monthList.map((it) => {
            const color = it.a.color ?? ACTIVITY_TYPE_META[it.a.activityType].color;
            const dLabel = it.startIso.slice(5).replace("-", ".") + (it.endIso !== it.startIso ? ` ~ ${it.endIso.slice(5).replace("-", ".")}` : "");
            const attendeeNames = (it.a.assignees ?? []).filter((a) => a.roleKind === "attendee").map((a) => a.employeeName).filter(Boolean).join(", ");
            const isResult = it.a.activityType === "result";
            const isBid = it.a.activityType === "bid";
            const resultLabel = it.startIso >= todayIso ? "입찰 결과 발표 예정일" : "입찰 결과 발표일";
            const bidDeadline = isBid && it.a.endedAt ? it.a.endedAt.slice(11, 16) : null;
            return (
              <button key={it.a.activityId} type="button" onClick={() => onEditActivity(it.a)}
                className="flex items-center gap-3 w-full text-left rounded-xl border cd-border-c p-3 cd-row-hover"
                style={{ boxShadow: "var(--cd-shadow)" }}>
                <span className="w-8 h-3 rounded-full shrink-0" style={{ background: color }} />
                <span className="cd-text-muted text-xs font-bold shrink-0 tabular-nums">{dLabel}</span>
                <div className="flex-1 min-w-0 text-right">
                  <div className="cd-text text-sm font-bold truncate">{isResult ? resultLabel : SALES_ACTIVITY_TYPE_LABELS[it.a.activityType]}</div>
                  {attendeeNames && <div className="cd-text-faint text-[11px] truncate">{ACTOR_SHORT[it.a.activityType] ?? "참석"}: {attendeeNames}</div>}
                  {bidDeadline && <div className="cd-text-faint text-[11px]">투찰 마감 {bidDeadline}</div>}
                </div>
              </button>
            );
          })}
          {monthList.length === 0 && <div className="cd-text-faint text-xs py-2">이 달 일정이 없습니다.</div>}
        </div>
      </div>
    </div>
  );
}
