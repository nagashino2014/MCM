"use client";

// 일정 메뉴(G6-C) 월 캘린더 — SalesCalendar 의 6주 격자·레인 배정을 복제 확장한 통합판.
// 원본과 달리 셀 클릭 등록이 없고(조회 전용), 바 색은 카테고리(TAG_COLOR)로 구분하며,
// 바 클릭은 하단 카테고리 목록의 해당 카드로 연결된다(onEventClick).
// 복수 태그 동시 표시로 밀도가 높아 레인을 3→4로 늘렸다. 초과분은 셀 하단 "+N".

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { TAG_COLOR, TAG_INK, type CalendarEvent } from "@/lib/calendar/types";
import type { OffDay } from "@/lib/hr/holidays";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const LANE_H = 20; // 바 1개 높이(px)
const MAX_LANES = 4;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dayNum(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

interface EventSpan {
  ev: CalendarEvent;
  s: number;
  e: number;
}

export function ScheduleCalendar({
  events,
  year,
  month0,
  onMonthChange,
  onEventClick,
  onDayClick,
  holidayRev = 0,
}: {
  events: CalendarEvent[];
  /** 표시 연도 — 데이터 로드가 월 단위라 부모가 소유한다. */
  year: number;
  /** 0-based 월 */
  month0: number;
  onMonthChange: (year: number, month0: number) => void;
  onEventClick: (ev: CalendarEvent) => void;
  /** 날짜 셀 클릭(휴무일 지정 화면에서 사용). 없으면 조회 전용. */
  onDayClick?: (iso: string, holiday: OffDay | null) => void;
  /** 값이 바뀌면 휴무일을 다시 불러온다(지정·해제 후 갱신용). */
  holidayRev?: number;
}) {
  const now = new Date();
  const [openMenu, setOpenMenu] = useState<null | "year" | "month">(null);
  // 휴무일(법정공휴일·근로자의 날·사내 지정) — 붉은 날짜 + 휴무일명. 소스는 /api/home/holidays 단일 창구.
  const [offDays, setOffDays] = useState<Map<string, OffDay>>(new Map());

  useEffect(() => {
    let alive = true;
    fetch(`/api/home/holidays?year=${year}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !alive || !Array.isArray(d.holidays)) return;
        setOffDays(new Map((d.holidays as OffDay[]).map((h) => [h.date, h])));
      })
      .catch(() => {
        /* 침묵 — 휴무일 표시 없이 동작 */
      });
    return () => {
      alive = false;
    };
  }, [year, holidayRev]);

  useEffect(() => {
    if (!openMenu) return;
    const h = () => setOpenMenu(null);
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [openMenu]);

  const yearOptions = useMemo(() => {
    const base = now.getFullYear();
    return Array.from({ length: 7 }, (_, i) => base - 3 + i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const goToday = () => {
    onMonthChange(now.getFullYear(), now.getMonth());
    setOpenMenu(null);
  };

  const spans = useMemo<EventSpan[]>(
    () =>
      events
        .filter((ev) => ev.startDate)
        .map((ev) => ({ ev, s: dayNum(ev.startDate), e: Math.max(dayNum(ev.endDate || ev.startDate), dayNum(ev.startDate)) }))
        .sort((x, y) => x.s - y.s || x.ev.id.localeCompare(y.ev.id)),
    [events]
  );

  // lane 배정(월 전역, 최대 4). 초과는 -1(overflow) — 셀 하단 "+N".
  const laneOf = useMemo(() => {
    const lanes: Array<Array<{ s: number; e: number }>> = Array.from({ length: MAX_LANES }, () => []);
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
      map.set(it.ev.id, placed);
    }
    return map;
  }, [spans]);

  const weeks = useMemo(() => {
    const first = new Date(year, month0, 1);
    const start = new Date(year, month0, 1 - first.getDay());
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
  }, [year, month0]);

  const moveMonth = (delta: number) => {
    const m = month0 + delta;
    onMonthChange(year + Math.floor(m / 12), ((m % 12) + 12) % 12);
  };

  const todayIso = ymd(now);
  const cellH = 28 + MAX_LANES * LANE_H + 8;

  return (
    <div className="cd-card-bg rounded-2xl border cd-border-c p-3 min-w-0">
      <div className="relative flex items-center justify-between mb-3">
        {/* 좌측 연·월 타이틀 그룹 + 오늘 */}
        <div className="relative flex items-center gap-1">
          <button type="button" onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === "year" ? null : "year"); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl hover:bg-[color:var(--cd-surface)] transition">
            <span className="cd-text font-extrabold text-[18px] tracking-tight tabular-nums leading-none">{year}년</span>
            <ChevronDown className={`w-3.5 h-3.5 cd-text-faint transition-transform ${openMenu === "year" ? "rotate-180" : ""}`} />
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === "month" ? null : "month"); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl hover:bg-[color:var(--cd-surface)] transition">
            <span className="font-extrabold text-[18px] tracking-tight leading-none" style={{ color: "var(--cd-primary)" }}>{month0 + 1}월</span>
            <ChevronDown className={`w-3.5 h-3.5 cd-text-faint transition-transform ${openMenu === "month" ? "rotate-180" : ""}`} />
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); goToday(); }}
            className="ml-1 px-3 py-1 rounded-full text-xs font-bold border cd-border-c cd-text-muted hover:text-[color:var(--cd-primary)] hover:border-[color:var(--cd-primary)] transition">오늘</button>

          {openMenu === "year" && (
            <div className="absolute left-0 z-30 cd-card-bg border cd-border-c rounded-2xl overflow-y-auto scrollbar-hide" style={{ top: 48, width: 160, maxHeight: 244, boxShadow: "0 16px 40px rgba(30,42,55,.16)" }} onClick={(e) => e.stopPropagation()}>
              {yearOptions.map((y) => {
                const sel = y === year;
                return (
                  <button key={y} type="button" onClick={() => { onMonthChange(y, month0); setOpenMenu(null); }}
                    className="block w-full text-left px-4 py-2.5 text-sm cd-row-hover"
                    style={sel ? { background: "var(--cd-primary-soft)", color: "var(--cd-primary)", fontWeight: 800 } : { color: "var(--cd-text)" }}>{y}년</button>
                );
              })}
            </div>
          )}
          {openMenu === "month" && (
            <div className="absolute z-30 cd-card-bg border cd-border-c rounded-2xl p-2.5" style={{ top: 48, left: 96, width: 232, boxShadow: "0 16px 40px rgba(30,42,55,.16)" }} onClick={(e) => e.stopPropagation()}>
              <div className="grid grid-cols-3 gap-1.5">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                  const sel = m === month0 + 1;
                  return (
                    <button key={m} type="button" onClick={() => { onMonthChange(year, m - 1); setOpenMenu(null); }}
                      className="py-2.5 rounded-lg text-sm font-semibold transition"
                      style={sel ? { background: "var(--cd-primary)", color: "#fff", fontWeight: 800 } : { background: "var(--cd-surface)", color: "var(--cd-muted)" }}>{m}월</button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button type="button" onClick={() => moveMonth(-1)} title="이전 달"
            className="w-10 h-10 rounded-xl border cd-border-c cd-card-bg flex items-center justify-center cd-text-muted hover:text-[color:var(--cd-primary)] hover:border-[color:var(--cd-primary)] hover:bg-[color:var(--cd-surface)] transition active:scale-95"><ChevronLeft className="w-[18px] h-[18px]" /></button>
          <button type="button" onClick={() => moveMonth(1)} title="다음 달"
            className="w-10 h-10 rounded-xl border cd-border-c cd-card-bg flex items-center justify-center cd-text-muted hover:text-[color:var(--cd-primary)] hover:border-[color:var(--cd-primary)] hover:bg-[color:var(--cd-surface)] transition active:scale-95"><ChevronRight className="w-[18px] h-[18px]" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className="text-[11px] text-center py-1" style={{ color: i === 0 ? "#EF4444" : i === 6 ? "#3B82F6" : "var(--cd-faint)" }}>{w}</div>
        ))}
      </div>
      {weeks.map((week, wi) => {
        const weekStart = dayNum(ymd(week[0]));
        const weekEnd = weekStart + 6;
        const segs = spans
          .filter((it) => (laneOf.get(it.ev.id) ?? -1) >= 0 && !(it.e < weekStart || it.s > weekEnd))
          .map((it) => ({
            it,
            colStart: Math.max(it.s, weekStart) - weekStart,
            colEnd: Math.min(it.e, weekEnd) - weekStart,
            lane: laneOf.get(it.ev.id) ?? 0,
          }));
        const overflow = new Array(7).fill(0);
        for (const it of spans) {
          if ((laneOf.get(it.ev.id) ?? -1) !== -1) continue;
          for (let c = 0; c < 7; c++) {
            const dn = weekStart + c;
            if (dn >= it.s && dn <= it.e) overflow[c]++;
          }
        }
        return (
          <div key={wi} className="relative grid grid-cols-7" style={{ minHeight: cellH }}>
            {week.map((day, di) => {
              const iso = ymd(day);
              const inMonth = day.getMonth() === month0;
              const dow = day.getDay();
              const off = offDays.get(iso) ?? null;
              const clickable = !!onDayClick;
              return (
                <div
                  key={di}
                  className={`border text-left p-1 flex flex-col ${clickable ? "cursor-pointer hover:bg-[color:var(--cd-surface)] transition-colors" : ""}`}
                  onClick={clickable ? () => onDayClick(iso, off) : undefined}
                  title={clickable ? `${iso} — 클릭해 휴무일 지정` : off?.name}
                  style={{
                    borderColor: iso === todayIso ? "var(--cd-primary)" : "var(--cd-border)",
                    background: "var(--cd-card)",
                    boxShadow: iso === todayIso ? "inset 0 0 0 2px var(--cd-primary)" : undefined,
                    opacity: inMonth ? 1 : 0.4,
                  }}
                >
                  {/* 휴무일(법정공휴일·사내 지정)은 일요일과 같은 붉은색 + 휴무일명 표기 */}
                  <span className="flex items-baseline gap-1 min-w-0">
                    <span className="text-[11px] shrink-0" style={{ color: off || dow === 0 ? "#EF4444" : dow === 6 ? "#3B82F6" : "var(--cd-muted)" }}>
                      {day.getDate()}
                    </span>
                    {off && (
                      <span className="text-[9.5px] font-bold truncate" style={{ color: "#EF4444" }}>{off.name}</span>
                    )}
                  </span>
                  {overflow[di] > 0 && <span className="cd-text-faint text-[9px] mt-auto">+{overflow[di]}</span>}
                </div>
              );
            })}
            {segs.map(({ it, colStart, colEnd, lane }) => (
              <button
                key={it.ev.id}
                type="button"
                onClick={() => onEventClick(it.ev)}
                className="absolute rounded-md text-[11px] px-1.5 truncate text-left font-semibold"
                style={{
                  left: `calc(${colStart} / 7 * 100% + 2px)`,
                  width: `calc(${colEnd - colStart + 1} / 7 * 100% - 4px)`,
                  top: 26 + lane * LANE_H,
                  height: LANE_H - 3,
                  // 파스텔 원색 배경 + 진한 잉크 — SalesCalendar 바와 동일 방식(color-mix 는 흐려진다).
                  background: TAG_COLOR[it.ev.tag],
                  color: TAG_INK,
                }}
                title={it.ev.title}
              >
                {it.ev.title}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
