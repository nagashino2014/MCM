"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { SalesActivity } from "@/lib/sales/types";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function dateKey(a: SalesActivity): string | null {
  const d = a.occurredAt ?? a.scheduledAt;
  return d ? d.slice(0, 10) : null;
}

/** 월 그리드 + 날짜칸 활동 마커. 셀 클릭 시 해당 날짜로 예정 활동 추가. */
export function SalesCalendar({
  activities,
  canEdit,
  onPickDate,
}: {
  activities: SalesActivity[];
  canEdit: boolean;
  onPickDate: (isoDate: string) => void;
}) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });

  const byDate = useMemo(() => {
    const map = new Map<string, SalesActivity[]>();
    for (const a of activities) {
      const k = dateKey(a);
      if (!k) continue;
      const list = map.get(k) ?? [];
      list.push(a);
      map.set(k, list);
    }
    return map;
  }, [activities]);

  const cells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const out: Array<{ iso: string; day: number } | null> = [];
    for (let i = 0; i < startDow; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      out.push({ iso, day: d });
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [cursor]);

  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const move = (delta: number) => {
    setCursor((c) => {
      const m = c.m + delta;
      return { y: c.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });
  };

  return (
    <div className="cd-card-bg rounded-xl border cd-border-c p-3 mb-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="cd-text font-extrabold text-sm">{cursor.y}년 {cursor.m + 1}월</h2>
        <div className="flex items-center gap-1">
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => move(-1)}><ChevronLeft className="w-4 h-4" /></button>
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setCursor({ y: now.getFullYear(), m: now.getMonth() })}>오늘</button>
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => move(1)}><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="cd-text-faint text-[11px] font-bold text-center py-1">{w}</div>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <div key={i} />;
          const list = byDate.get(cell.iso) ?? [];
          const isToday = cell.iso === todayIso;
          return (
            <button
              key={i}
              type="button"
              disabled={!canEdit}
              onClick={() => canEdit && onPickDate(cell.iso)}
              className={`rounded-lg border min-h-[58px] p-1 text-left transition ${isToday ? "cd-tint-primary" : "cd-border-c"} ${canEdit ? "cd-listitem" : ""}`}
              style={{ borderColor: isToday ? "var(--cd-primary)" : "var(--cd-border)" }}
            >
              <span className={`text-[11px] font-bold ${isToday ? "cd-text-primary" : "cd-text-muted"}`}>{cell.day}</span>
              <div className="flex flex-col gap-0.5 mt-0.5">
                {list.slice(0, 2).map((a) => (
                  <span
                    key={a.activityId}
                    className="text-[9px] leading-tight rounded px-1 truncate"
                    style={{
                      background: a.status === "planned" ? "var(--cd-primary-soft)" : "var(--cd-success-soft)",
                      color: a.status === "planned" ? "var(--cd-primary)" : "var(--cd-success)",
                    }}
                  >
                    {a.summary || a.activityType}
                  </span>
                ))}
                {list.length > 2 && <span className="cd-text-faint text-[9px]">+{list.length - 2}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
