"use client";

// 일정 메뉴(/calendar, G6-C) — 통합 월 캘린더 + 카테고리별 상세 목록.
// 상단 태그 칩(복수 토글, 서버 저장) → 캘린더(카테고리 색 바) → 하단 카테고리별 카드.
// 캘린더 바 클릭 = 하단 해당 카드로 스크롤·강조. 본인 카드의 문서 버튼 = 결재 문서 모달.
// 데이터: GET /api/calendar?month&tags (스케줄명은 서버 조립) / 설정: /api/calendar/prefs.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Users } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { ApprovalDocModal } from "@/components/approval/ApprovalDocModal";
import { ScheduleCalendar } from "@/components/calendar/ScheduleCalendar";
import { CategoryScheduleList } from "@/components/calendar/CategoryScheduleList";
import { CalendarRefsModal } from "@/components/calendar/CalendarRefsModal";
import {
  CALENDAR_TAG_KEYS,
  CALENDAR_TAG_LABELS,
  DEFAULT_CALENDAR_PREFS,
  TAG_COLOR,
  TAG_COLOR_STRONG,
  TAG_INK,
  type CalendarEvent,
  type CalendarRefs,
  type CalendarTagKey,
} from "@/lib/calendar/types";
import "@/components/cdash/cdash.css";

export function CalendarBoard() {
  const { theme } = useCdashTheme();
  const now = new Date();
  const [cur, setCur] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [tags, setTags] = useState<CalendarTagKey[]>([...DEFAULT_CALENDAR_PREFS.tags]);
  const [refs, setRefs] = useState<CalendarRefs>({ ...DEFAULT_CALENDAR_PREFS.refs });
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [salesDenied, setSalesDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refsModal, setRefsModal] = useState(false);
  const [docId, setDocId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 설정 로드(1회) — 이후 태그 토글·선택 대상 변경 시 서버에 저장한다.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/calendar/prefs", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && !cancelled) {
          if (Array.isArray(d.tags) && d.tags.length) setTags(d.tags);
          if (d.refs) setRefs(d.refs);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPrefsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const month = `${cur.y}-${String(cur.m + 1).padStart(2, "0")}`;

  const load = useCallback(async () => {
    if (!prefsLoaded) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ month, tags: tags.join(",") });
      const res = await fetch(`/api/calendar?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "일정을 불러오지 못했습니다.");
      setEvents(data.events ?? []);
      setSalesDenied(data.salesDenied === true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [prefsLoaded, month, tags]);
  useEffect(() => {
    load();
  }, [load]);

  const savePrefs = (patch: { tags?: CalendarTagKey[]; refs?: CalendarRefs }) => {
    fetch("/api/calendar/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
  };

  const toggleTag = (key: CalendarTagKey) => {
    setTags((prev) => {
      const next = prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key];
      savePrefs({ tags: next });
      return next;
    });
  };

  const saveRefs = (next: CalendarRefs) => {
    setRefs(next);
    setRefsModal(false);
    savePrefs({ refs: next });
  };

  // 캘린더 바 클릭 → 하단 해당 카드로 스크롤 + 잠깐 강조.
  const focusEvent = (ev: CalendarEvent) => {
    setHighlightId(ev.id);
    requestAnimationFrame(() => {
      listRef.current?.querySelector(`[data-event-id="${CSS.escape(ev.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    window.setTimeout(() => setHighlightId((prev) => (prev === ev.id ? null : prev)), 2400);
  };

  /** 표시 순서는 카탈로그 순서(본인→부서→영업→선택→차량)로 고정한다. */
  const orderedTags = useMemo(() => CALENDAR_TAG_KEYS.filter((k) => tags.includes(k)), [tags]);

  const refsSummary = refs.all
    ? "전사 전체"
    : [refs.deptIds.length ? `부서 ${refs.deptIds.length}` : null, refs.employeeIds.length ? `개인 ${refs.employeeIds.length}` : null]
        .filter(Boolean)
        .join(" · ") || "미지정";

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-4 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="일정"
        meta={`${month} · ${events.length}건`}
        actions={
          <button
            type="button"
            className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex items-center gap-1.5"
            onClick={() => setRefsModal(true)}
          >
            <Users className="w-3.5 h-3.5" /> 선택 대상 지정
            <span className="cd-text-faint">({refsSummary})</span>
          </button>
        }
      />

      {/* 카테고리 태그 토글(복수) */}
      <div className="flex items-center gap-2 flex-wrap">
        {CALENDAR_TAG_KEYS.map((key) => {
          const on = tags.includes(key);
          const denied = key === "sales" && salesDenied;
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggleTag(key)}
              disabled={denied}
              title={denied ? "영업 일정 열람 권한이 없습니다." : undefined}
              className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-bold transition disabled:opacity-40"
              style={{
                // 켜진 칩: 연한 파스텔 배경 + 진한 대응색 테두리 — 파스텔 테두리는 배경에 묻힌다.
                borderColor: on ? TAG_COLOR_STRONG[key] : "var(--cd-line)",
                background: on ? `color-mix(in srgb, ${TAG_COLOR[key]} 62%, white)` : "transparent",
                color: on ? TAG_INK : "var(--cd-muted)",
              }}
            >
              {/* 도트도 진한 대응색 — 파스텔 도트는 연한 배경 위에서 구분이 안 된다. */}
              <span className="w-2 h-2 rounded-full" style={{ background: TAG_COLOR_STRONG[key] }} />
              {CALENDAR_TAG_LABELS[key]}
            </button>
          );
        })}
        {loading && <span className="text-[11px] cd-text-faint ml-1">불러오는 중…</span>}
      </div>
      {error && <p className="text-sm cd-error-text">{error}</p>}

      <ScheduleCalendar
        events={events}
        year={cur.y}
        month0={cur.m}
        onMonthChange={(y, m) => setCur({ y, m })}
        onEventClick={focusEvent}
      />

      <CategoryScheduleList
        ref={listRef}
        tags={orderedTags}
        events={events}
        highlightId={highlightId}
        onOpenDoc={(id) => setDocId(id)}
      />

      <CalendarRefsModal open={refsModal} initial={refs} onClose={() => setRefsModal(false)} onSave={saveRefs} />
      {docId && <ApprovalDocModal docId={docId} theme={theme} onClose={() => setDocId(null)} onChanged={load} />}
    </div>
  );
}
