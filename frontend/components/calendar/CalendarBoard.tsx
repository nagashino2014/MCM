"use client";

// 일정 메뉴(/calendar, G6-C) — 통합 월 캘린더 + 카테고리별 상세 목록.
// 상단 태그 칩(복수 토글, 서버 저장) → 캘린더(카테고리 색 바) → 하단 카테고리별 카드.
// 캘린더 바 클릭 = 하단 해당 카드로 스크롤·강조. 본인 카드의 문서 버튼 = 결재 문서 모달.
// 날짜 셀 클릭 = 일정 추가 메뉴(출장/휴가/교육 기안 + 회의/면접/미팅 직접 등록, 219) — 모바일과 동일 구성.
// 데이터: GET /api/calendar?month&tags (스케줄명은 서버 조립, access 동봉) / 설정: /api/calendar/prefs.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarCog, Users } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdToastProvider, useCdToast } from "@/components/cdash/CdToast";
import { ApprovalDocModal } from "@/components/approval/ApprovalDocModal";
import { ScheduleCalendar } from "@/components/calendar/ScheduleCalendar";
import { CategoryScheduleList } from "@/components/calendar/CategoryScheduleList";
import { CalendarRefsModal } from "@/components/calendar/CalendarRefsModal";
import { DayActionModal } from "@/components/calendar/DayActionModal";
import { CalendarEntryModal } from "@/components/calendar/CalendarEntryModal";
import { MeetingRulesModal } from "@/components/calendar/MeetingRulesModal";
import {
  CALENDAR_TAG_KEYS,
  CALENDAR_TAG_LABELS,
  DEFAULT_CALENDAR_PREFS,
  TAG_COLOR,
  TAG_COLOR_STRONG,
  TAG_INK,
  type CalendarAccess,
  type CalendarEntry,
  type CalendarEntryKind,
  type CalendarEvent,
  type CalendarRefs,
  type CalendarTagKey,
} from "@/lib/calendar/types";
import "@/components/cdash/cdash.css";

interface EntryModalState {
  kind: CalendarEntryKind;
  date: string;
  entry: CalendarEntry | null;
}

export function CalendarBoard() {
  return (
    <CdToastProvider>
      <CalendarBoardInner />
    </CdToastProvider>
  );
}

function CalendarBoardInner() {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const now = new Date();
  const [cur, setCur] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [tags, setTags] = useState<CalendarTagKey[]>([...DEFAULT_CALENDAR_PREFS.tags]);
  const [refs, setRefs] = useState<CalendarRefs>({ ...DEFAULT_CALENDAR_PREFS.refs });
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [salesDenied, setSalesDenied] = useState(false);
  const [access, setAccess] = useState<CalendarAccess>({ meeting: false, interview: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refsModal, setRefsModal] = useState(false);
  const [docId, setDocId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [dayPick, setDayPick] = useState<string | null>(null);
  const [entryModal, setEntryModal] = useState<EntryModalState | null>(null);
  const [rulesModal, setRulesModal] = useState(false);
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
      if (data.access) setAccess({ meeting: data.access.meeting === true, interview: data.access.interview === true });
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

  // 직접 등록 일정(회의·면접·미팅) 상세/편집 모달 — 서버에서 최신 본문(이력서 메타 포함)을 받아 연다.
  const openEntry = useCallback(
    async (entryId: string) => {
      try {
        const res = await fetch(`/api/calendar/entries/${encodeURIComponent(entryId)}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "일정을 불러오지 못했습니다.");
        const entry = data.entry as CalendarEntry;
        setEntryModal({ kind: entry.kind, date: entry.date, entry });
      } catch (err) {
        toast((err as Error).message, "error");
      }
    },
    [toast]
  );

  const onEventClick = (ev: CalendarEvent) => {
    if (ev.entryId) void openEntry(ev.entryId);
    else focusEvent(ev);
  };

  /** 표시 순서는 카탈로그 순서(본인→부서→영업→선택→차량→회의→면접)로 고정한다. */
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
          <div className="flex items-center gap-2">
            {access.meeting && (
              <button
                type="button"
                className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex items-center gap-1.5"
                onClick={() => setRulesModal(true)}
                title="주간회의·간부간담회 등 정기 회의 규칙 설정"
              >
                <CalendarCog className="w-3.5 h-3.5" /> 정기 회의 설정
              </button>
            )}
            <button
              type="button"
              className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex items-center gap-1.5"
              onClick={() => setRefsModal(true)}
            >
              <Users className="w-3.5 h-3.5" /> 선택 대상 지정
              <span className="cd-text-faint">({refsSummary})</span>
            </button>
          </div>
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
              title={
                denied
                  ? "영업 일정 열람 권한이 없습니다."
                  : key === "interview"
                    ? "면접 일정은 참석자·면접 관리자에게만 표시됩니다."
                    : undefined
              }
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
        <span className="text-[11px] cd-text-faint ml-auto hidden sm:inline">날짜 칸을 누르면 일정을 추가할 수 있습니다.</span>
      </div>
      {error && <p className="text-sm cd-error-text">{error}</p>}

      <ScheduleCalendar
        events={events}
        year={cur.y}
        month0={cur.m}
        onMonthChange={(y, m) => setCur({ y, m })}
        onEventClick={onEventClick}
        onDayClick={(iso) => setDayPick(iso)}
        dayClickHint="클릭해 일정 추가"
      />

      <CategoryScheduleList
        ref={listRef}
        tags={orderedTags}
        events={events}
        highlightId={highlightId}
        onOpenDoc={(id) => setDocId(id)}
        onOpenEntry={(id) => void openEntry(id)}
      />

      <CalendarRefsModal open={refsModal} initial={refs} onClose={() => setRefsModal(false)} onSave={saveRefs} />
      {docId && <ApprovalDocModal docId={docId} theme={theme} onClose={() => setDocId(null)} onChanged={load} />}

      <DayActionModal
        date={dayPick}
        access={access}
        onClose={() => setDayPick(null)}
        onPickEntry={(kind, date) => {
          setDayPick(null);
          setEntryModal({ kind, date, entry: null });
        }}
      />
      {entryModal && (
        <CalendarEntryModal
          open
          kind={entryModal.kind}
          date={entryModal.date}
          entry={entryModal.entry}
          access={access}
          onClose={() => setEntryModal(null)}
          onSaved={load}
        />
      )}
      <MeetingRulesModal open={rulesModal} onClose={() => setRulesModal(false)} onSaved={load} />
    </div>
  );
}
