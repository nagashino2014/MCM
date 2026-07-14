"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ACTIVITY_TYPE_META } from "@/lib/sales/types";
import {
  ActivityDetailSheet,
  ActivityTag,
  Empty,
  ErrorBox,
  Loading,
  kstToday,
  timeOf,
  type MobileActivity,
} from "./mobile-shared";

// 모바일 일정 — 상단 월 미니 캘린더(일정 색점 마커) + 하단 선택일 일정 리스트 + 상세 시트.
// /api/sales/schedule?month=YYYY-MM (월 전체, 과거 포함).

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function MobileSchedule() {
  const today = kstToday();
  const [month, setMonth] = useState(today.slice(0, 7)); // YYYY-MM
  const [selected, setSelected] = useState(today); // YYYY-MM-DD
  const [activities, setActivities] = useState<MobileActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<MobileActivity | null>(null);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sales/schedule?month=${m}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      const data = await res.json();
      setActivities(Array.isArray(data.activities) ? data.activities : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(month);
  }, [month, load]);

  // 날짜별 그룹(색점 마커·리스트 공용)
  const byDay = useMemo(() => {
    const map = new Map<string, MobileActivity[]>();
    for (const a of activities) {
      const day = a.scheduledAt.slice(0, 10);
      const list = map.get(day) ?? [];
      list.push(a);
      map.set(day, list);
    }
    return map;
  }, [activities]);

  // 월 그리드 셀(앞 공백 + 말일까지)
  const cells = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = first.getUTCDay();
    const out: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(`${month}-${String(d).padStart(2, "0")}`);
    return out;
  }, [month]);

  const moveMonth = (delta: number) => {
    const [y, m] = month.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
    setMonth(next);
    setSelected(`${next}-01` <= today && today <= `${next}-31` ? today : `${next}-01`);
  };

  const dayList = byDay.get(selected) ?? [];

  return (
    <div className="flex flex-col gap-3">
      {/* 월 미니 캘린더 */}
      <div className="cd-card-bg border cd-border-c rounded-2xl px-3 pt-3 pb-2">
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="cd-text text-sm font-extrabold">
            {month.slice(0, 4)}년 {Number(month.slice(5, 7))}월
          </span>
          <div className="flex items-center gap-1">
            {month !== today.slice(0, 7) && (
              <button
                className="cd-btn cd-btn-ghost cd-btn-sm text-xs"
                onClick={() => {
                  setMonth(today.slice(0, 7));
                  setSelected(today);
                }}
              >
                오늘
              </button>
            )}
            <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => moveMonth(-1)} aria-label="이전 달">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => moveMonth(1)} aria-label="다음 달">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 text-center">
          {WEEKDAYS.map((w, i) => (
            <div key={w} className="text-[11px] font-bold py-1" style={{ color: i === 0 ? "var(--cd-error)" : "var(--cd-faint)" }}>
              {w}
            </div>
          ))}
          {cells.map((day, i) => {
            if (!day) return <div key={`lead-${i}`} />;
            const dots = (byDay.get(day) ?? []).slice(0, 3);
            const isSelected = day === selected;
            const isToday = day === today;
            return (
              <button
                key={day}
                className="flex flex-col items-center justify-start rounded-xl py-1"
                style={{
                  minHeight: 44,
                  background: isSelected ? "var(--cd-primary-soft)" : undefined,
                  outline: isToday && !isSelected ? "1px solid var(--cd-primary)" : undefined,
                  outlineOffset: -1,
                }}
                onClick={() => setSelected(day)}
              >
                <span
                  className="text-[13px] tabular-nums"
                  style={{
                    fontWeight: isSelected || isToday ? 800 : 500,
                    color: isSelected ? "var(--cd-primary)" : "var(--cd-text)",
                  }}
                >
                  {Number(day.slice(8, 10))}
                </span>
                <span className="flex gap-0.5 mt-0.5" style={{ minHeight: 5 }}>
                  {dots.map((a, j) => (
                    <span
                      key={j}
                      className="rounded-full"
                      style={{ width: 5, height: 5, background: ACTIVITY_TYPE_META[a.activityType]?.color ?? "var(--cd-faint)" }}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {error && <ErrorBox message={error} />}

      {/* 선택일 일정 리스트 */}
      <section>
        <h2 className="cd-text-muted text-xs font-bold mb-1.5 px-1">
          {selected.slice(5, 10).replace("-", "/")} ({WEEKDAYS[new Date(`${selected}T00:00:00Z`).getUTCDay()]}) 일정 {dayList.length}건
        </h2>
        {loading ? (
          <Loading />
        ) : dayList.length === 0 ? (
          <Empty label="선택한 날짜에 일정이 없습니다." />
        ) : (
          <div className="flex flex-col gap-2">
            {dayList.map((a) => (
              <button
                key={a.activityId}
                className="cd-card-bg border cd-border-c rounded-2xl px-3.5 py-3 flex items-center gap-2.5 text-left"
                onClick={() => setDetail(a)}
              >
                <ActivityTag type={a.activityType} />
                <div className="flex-1 min-w-0">
                  <div className="cd-text text-sm font-bold truncate">{a.projectTitle}</div>
                  <div className="cd-text-faint text-xs truncate">
                    {[timeOf(a.scheduledAt) || null, a.facilityName].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 cd-text-faint shrink-0" />
              </button>
            ))}
          </div>
        )}
      </section>

      {detail && (
        <ActivityDetailSheet
          activity={detail}
          today={today}
          onClose={() => setDetail(null)}
          onSaved={() => {
            setDetail(null);
            load(month);
          }}
        />
      )}
    </div>
  );
}
