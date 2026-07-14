"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ACTIVITY_TYPE_META } from "@/lib/sales/types";
import {
  ActivityTag,
  Empty,
  ErrorBox,
  Loading,
  MobileSheet,
  SheetRow,
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

/** 일정 상세 시트 — 종료된(시작일이 지난) 일정에는 경과 입력 폼 노출(M2). */
function ActivityDetailSheet({
  activity: detail,
  today,
  onClose,
  onSaved,
}: {
  activity: MobileActivity;
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 경과 입력 가능 = 일정 기간이 시작된 것(데스크톱 ScheduleModal 의 기간경과 노출과 같은 취지)
  const canReport = (detail.endedAt ?? detail.scheduledAt).slice(0, 10) <= today;

  const save = async () => {
    if (!note.trim()) {
      setError("경과 내용을 입력하세요.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/sales/activities/${encodeURIComponent(detail.activityId)}/progress`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ progressNote: note.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <MobileSheet title={ACTIVITY_TYPE_META[detail.activityType]?.label ?? "일정 상세"} onClose={onClose}>
      <div className="rounded-xl border cd-border-c px-3 py-1.5">
        <SheetRow label="영업 건" value={detail.projectTitle} />
        <SheetRow label="사업장" value={detail.facilityName ?? "—"} />
        <SheetRow
          label="일시"
          value={`${detail.scheduledAt.slice(0, 10)} ${timeOf(detail.scheduledAt)}${
            detail.endedAt ? ` ~ ${detail.endedAt.slice(0, 10)} ${timeOf(detail.endedAt)}` : ""
          }`.trim()}
        />
        {detail.summary && <SheetRow label="업무 상세" value={detail.summary} />}
      </div>

      {canReport ? (
        <div className="mt-3">
          <h4 className="cd-text-muted text-xs font-bold mb-1.5">경과 입력</h4>
          <textarea
            className="cd-textarea w-full"
            rows={4}
            placeholder="일정 진행 경과를 입력하세요 (입력 시 일정이 종료 처리되고 진행 단계가 갱신됩니다)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && <p className="cd-error-text text-xs mt-1">{error}</p>}
          <button className="cd-btn cd-btn-primary cd-btn-block justify-center mt-2" style={{ height: 44 }} onClick={save} disabled={saving}>
            {saving ? "저장 중…" : "경과 저장"}
          </button>
        </div>
      ) : (
        <p className="cd-text-faint text-xs mt-3">경과는 일정 기간이 지난 뒤 입력할 수 있습니다.</p>
      )}
    </MobileSheet>
  );
}
