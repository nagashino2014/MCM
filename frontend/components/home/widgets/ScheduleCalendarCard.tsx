"use client";

// 홈 우측 상단 — 월 캘린더 카드(HC-A).
// 좌상단 톱니 '참조 지정' + 연·월 + 오늘 pill + 월 이동, 그 아래 태그 5종(본인·영업·부서·선택·차량).
// 태그를 켠 만큼만 도트/오늘 일정에 반영되며, 켠 태그와 참조 인원은 서버(home_layouts)에 저장된다.
// 데이터원: 영업=/api/sales/schedule, 인적(휴가)·차량=/api/home/calendar (차량은 G6-C에서 연결).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Settings2, X } from "lucide-react";
import { ACTIVITY_TYPE_META, type SalesActivityType } from "@/lib/sales/types";
import { CALENDAR_TAGS, HOME_CALENDAR_H, HOME_TODAY_LIMIT, type CalendarTagKey } from "@/lib/home/widgets";
import { TAG_COLOR, TAG_COLOR_STRONG, TAG_INK } from "@/lib/calendar/types";
import { CalendarRefPickerModal } from "@/components/home/CalendarRefPickerModal";

interface Activity {
  activityId: string;
  projectTitle: string;
  facilityName: string | null;
  activityType: string | null;
  scheduledAt: string | null;
}

interface LeaveEntry {
  entryId: string;
  scope: "self" | "dept" | "refs" | "vehicle";
  employeeId: string;
  name: string;
  positionName: string | null;
  deptName: string | null;
  date: string;
  label: string;
  kind: string;
  days: number;
}

/** 캘린더 격자에 놓이는 항목 — 짧은 태그(격자) + 상세 문구(팝업)를 함께 들고 있다. */
interface CalItem {
  id: string;
  tag: CalendarTagKey;
  date: string;
  time: string | null;
  /** 격자 태그 문구 — 영업은 2자 활동 태그, 인적 일정은 "휴가 : 홍길동". */
  chip: string;
  /** 같은 날 3건 이상일 때 쓰는 압축 라벨 — 영업은 2자 태그, 인적 일정은 성명(3자). */
  short: string;
  /** 팝업 한 줄 — "이재영 부장 연차" 처럼 사람·사유를 풀어 쓴다. */
  detail: string;
  /** 오늘 일정 타임라인용 제목/부가. */
  title: string;
  sub: string | null;
  color: string;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 태그별 대표색은 일정 메뉴와 공용(lib/calendar/types.ts TAG_COLOR) — 파스텔 팔레트 단일 소스.

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** ISO → KST "HH:mm". */
function hhmm(dt: string | null): string | null {
  if (!dt) return null;
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return null;
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}

/** ISO → KST 기준 "YYYY-MM-DD". */
function kstDate(dt: string | null): string | null {
  if (!dt) return null;
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function ScheduleCalendarCard() {
  const today = useMemo(() => new Date(), []);
  const [cur, setCur] = useState(() => ({ y: today.getFullYear(), m: today.getMonth() }));
  const [activities, setActivities] = useState<Activity[]>([]);
  const [leaves, setLeaves] = useState<LeaveEntry[]>([]);
  // 태그는 단일 선택 — 여러 종류를 겹쳐 켜면 격자에 일정이 넘쳐 읽히지 않는다.
  const [tag, setTag] = useState<CalendarTagKey>("self");
  const [refs, setRefs] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [salesDenied, setSalesDenied] = useState(false);
  const [openDay, setOpenDay] = useState<string | null>(null);
  // 공휴일(date → 명칭) — 일요일과 같은 붉은색으로 구분한다. 소스는 /api/home/holidays(서버 캐시).
  const [holidays, setHolidays] = useState<Map<string, string>>(new Map());

  const month = `${cur.y}-${String(cur.m + 1).padStart(2, "0")}`;
  const salesOn = tag === "sales";
  // 차량도 같은 인적 일정 API 를 쓴다(scope=vehicle — 출장신청서 법인차량·직접 예약, G6-C).
  const leaveScope = tag === "self" || tag === "dept" || tag === "refs" || tag === "vehicle" ? tag : "";

  // 저장된 태그·참조 인원 로드.
  useEffect(() => {
    let alive = true;
    fetch("/api/home/layout", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !alive) return;
        // 저장 스키마는 배열이지만 단일 선택이므로 첫 값만 쓴다.
        if (Array.isArray(d.calendarTags) && d.calendarTags.length > 0) setTag(d.calendarTags[0]);
        if (Array.isArray(d.calendarRefs)) setRefs(d.calendarRefs);
      })
      .catch(() => {
        /* 기본값 유지 */
      });
    return () => {
      alive = false;
    };
  }, []);

  const persist = (next: { calendarTags?: CalendarTagKey[]; calendarRefs?: string[] }) => {
    fetch("/api/home/layout", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => {
      /* 저장 실패는 화면 동작을 막지 않는다 */
    });
  };

  // 팝업은 바깥 클릭·ESC 로 닫는다(다른 날짜 태그 클릭은 그쪽으로 전환).
  useEffect(() => {
    if (!openDay) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest?.("[data-cal-grid]")) setOpenDay(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenDay(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openDay]);

  const pickTag = (k: CalendarTagKey) => {
    setTag(k);
    setOpenDay(null);
    persist({ calendarTags: [k] });
  };

  // 공휴일 — 보는 연도가 바뀔 때만 다시 가져온다.
  useEffect(() => {
    let alive = true;
    fetch(`/api/home/holidays?year=${cur.y}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !alive || !Array.isArray(d.holidays)) return;
        setHolidays(new Map(d.holidays.map((h: { date: string; name: string }) => [h.date, h.name])));
      })
      .catch(() => {
        /* 침묵 — 색 구분 없이 동작 */
      });
    return () => {
      alive = false;
    };
  }, [cur.y]);

  // 영업 일정.
  useEffect(() => {
    if (!salesOn) {
      setActivities([]);
      return;
    }
    let alive = true;
    fetch(`/api/sales/schedule?month=${month}`, { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 403 || r.status === 401) {
          if (alive) setSalesDenied(true);
          return;
        }
        if (!r.ok) return;
        const d = await r.json();
        if (alive) setActivities(Array.isArray(d.activities) ? d.activities : []);
      })
      .catch(() => {
        /* 위젯은 실패해도 침묵 */
      });
    return () => {
      alive = false;
    };
  }, [month, salesOn]);

  // 인적 일정(휴가) — 본인·부서·선택 중 켜진 하나.
  useEffect(() => {
    if (!leaveScope) {
      setLeaves([]);
      return;
    }
    let alive = true;
    fetch(`/api/home/calendar?month=${month}&scopes=${leaveScope}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && alive) setLeaves(Array.isArray(d.entries) ? d.entries : []);
      })
      .catch(() => {
        /* 침묵 */
      });
    return () => {
      alive = false;
    };
  }, [month, leaveScope]);

  // 두 소스를 캘린더 항목으로 합친다.
  const items = useMemo<CalItem[]>(() => {
    const out: CalItem[] = [];
    for (const a of activities) {
      const date = kstDate(a.scheduledAt);
      if (!date) continue;
      const meta = a.activityType ? ACTIVITY_TYPE_META[a.activityType as SalesActivityType] : undefined;
      out.push({
        id: `a:${a.activityId}`,
        tag: "sales",
        date,
        time: hhmm(a.scheduledAt),
        // 영업은 규정된 2글자 활동 태그 + 업체명("미팅 : 재영물산㈜").
        // 긴 상호는 셀 폭에 맞춰 말줄임(...)되고 전체는 툴팁·팝업에서 확인한다.
        chip: `${meta?.short ?? "영업"}${a.facilityName ? ` : ${a.facilityName}` : ""}`,
        short: meta?.short ?? "영업",
        detail: [a.facilityName, a.projectTitle, meta?.label].filter(Boolean).join(" "),
        title: a.projectTitle,
        sub: a.facilityName,
        color: meta?.color ?? TAG_COLOR.sales,
      });
    }
    for (const l of leaves) {
      // 격자에서는 종류를 2자로 통일("휴가"), 상세 사유(연차/반차 등)는 팝업에서 밝힌다.
      const who = [l.name, l.positionName].filter(Boolean).join(" ");
      out.push({
        id: `l:${l.entryId}`,
        tag: l.scope,
        date: l.date,
        time: null,
        chip: `${l.kind} : ${l.name}`,
        // 압축 모드에서는 성명만 남긴다(종류는 태그 색으로 구분, 전체 문구는 툴팁·팝업에서).
        short: l.name.slice(0, 3),
        detail: `${who} ${l.label}`,
        title: `${l.name} · ${l.label}`,
        sub: l.deptName,
        color: TAG_COLOR[l.scope],
      });
    }
    return out;
  }, [activities, leaves]);

  // 날짜별 항목(격자 태그·팝업 공용).
  const byDay = useMemo(() => {
    const map = new Map<string, CalItem[]>();
    for (const it of items) {
      const list = map.get(it.date) ?? [];
      list.push(it);
      map.set(it.date, list);
    }
    return map;
  }, [items]);

  // 항상 6주 격자로 그린다 — 달마다 5~6주로 바뀌면 카드 높이가 흔들리기 때문(고정 높이 유지).
  const weeks = useMemo(() => {
    const first = new Date(cur.y, cur.m, 1);
    const cursor = new Date(cur.y, cur.m, 1 - first.getDay());
    const out: Date[][] = [];
    for (let w = 0; w < 6; w++) {
      const row: Date[] = [];
      for (let i = 0; i < 7; i++) {
        row.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      out.push(row);
    }
    return out;
  }, [cur]);

  const todayKey = ymd(today);
  const todayList = useMemo(
    () => items.filter((i) => i.date === todayKey).sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99")),
    [items, todayKey]
  );

  const isThisMonth = cur.y === today.getFullYear() && cur.m === today.getMonth();

  return (
    // 팝업이 카드 경계를 넘어 보여야 하므로 overflow 는 열어 둔다(격자는 6주 고정이라 넘칠 일이 없다).
    <section className="cd-card cd-reveal px-4 py-3.5 gap-2 relative" style={{ height: HOME_CALENDAR_H }}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="cd-chip cd-chip-sm shrink-0"
          title="캘린더에 표시할 인원을 지정합니다"
        >
          <Settings2 className="w-3 h-3" />
          참조 지정
          {refs.length > 0 && <span className="font-extrabold cd-text-primary">{refs.length}</span>}
        </button>
        <span className="text-[15px] font-extrabold tracking-[-0.01em] cd-text">
          {cur.y}년 <span className="cd-text-primary">{cur.m + 1}월</span>
        </span>
        {isThisMonth && (
          <span
            className="text-[10.5px] font-bold cd-text-primary rounded-full px-2 py-0.5"
            style={{ background: "var(--cd-primary-soft)" }}
          >
            오늘
          </span>
        )}
        <span className="ml-auto flex gap-1">
          <button
            type="button"
            aria-label="이전 달"
            onClick={() => setCur(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))}
            className="w-[22px] h-[22px] rounded-[7px] border cd-line-c cd-surface-bg inline-flex items-center justify-center cd-text-muted"
          >
            <ChevronLeft className="w-3 h-3" strokeWidth={2.2} />
          </button>
          <button
            type="button"
            aria-label="다음 달"
            onClick={() => setCur(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))}
            className="w-[22px] h-[22px] rounded-[7px] border cd-line-c cd-surface-bg inline-flex items-center justify-center cd-text-muted"
          >
            <ChevronRight className="w-3 h-3" strokeWidth={2.2} />
          </button>
        </span>
      </div>

      {/* 태그 — 단일 선택(라디오). 한 종류만 켜야 격자가 읽힌다. */}
      <div className="flex items-center gap-1 flex-wrap justify-end" role="radiogroup" aria-label="캘린더 표시 종류">
        {CALENDAR_TAGS.map((t) => {
          const active = tag === t.key;
          const disabled = t.key === "sales" && salesDenied;
          return (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => pickTag(t.key)}
              data-active={active || undefined}
              className="cd-chip cd-chip-sm disabled:opacity-40 disabled:cursor-not-allowed"
              title={t.key === "vehicle" ? "법인차량 이용 현황 — 출장신청서 상신·직접 예약 기준" : undefined}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: active ? "currentColor" : TAG_COLOR_STRONG[t.key] }}
              />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-7">
        {WEEKDAYS.map((w, i) => (
          <span
            key={w}
            className="text-center text-[10px] font-bold py-0.5"
            style={{ color: i === 0 ? "var(--cd-error)" : i === 6 ? "var(--cd-secondary)" : "var(--cd-faint)" }}
          >
            {w}
          </span>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} data-cal-grid className="grid grid-cols-7 relative">
          {week.map((day) => {
            const key = ymd(day);
            const inMonth = day.getMonth() === cur.m;
            const isToday = key === todayKey;
            const list = byDay.get(key) ?? [];
            // 일요일·공휴일은 붉은색, 토요일은 옅은 남색(cd 시그널 토큰 — 다크 자동 대응).
            const holiday = holidays.get(key);
            const dow = day.getDay();
            const dayColor = isToday
              ? "#fff"
              : holiday || dow === 0
                ? "var(--cd-error)"
                : dow === 6
                  ? "var(--cd-secondary)"
                  : inMonth
                    ? "var(--cd-body)"
                    : "var(--cd-faint)";
            return (
              // 셀 높이 고정 — 밀집한 날(2열)만 늘어나면 그 주가 높아져 카드 높이가 흔들린다.
              <div key={key} className="h-[70px] overflow-hidden flex flex-col items-center gap-0.5 pt-0.5 px-[1px]">
                <span
                  className="w-[21px] h-[21px] rounded-full inline-flex items-center justify-center text-[11.5px] shrink-0"
                  title={holiday}
                  style={{
                    fontWeight: isToday ? 800 : 500,
                    color: dayColor,
                    background: isToday ? "var(--cd-primary)" : undefined,
                    opacity: inMonth ? 1 : 0.45,
                  }}
                >
                  {day.getDate()}
                </span>
                {/* 휴무일명(법정공휴일·명절·사내 지정) — 날짜 아래 한 줄. 색은 날짜와 같은 붉은색. */}
                {holiday && (
                  <span
                    className="w-full text-[9px] font-bold leading-[11px] text-center truncate shrink-0"
                    style={{ color: "var(--cd-error)", opacity: inMonth ? 1 : 0.45 }}
                    title={holiday}
                  >
                    {holiday}
                  </span>
                )}
                {/* 일정 태그 — 1~2건은 전체 문구 1열, 3건 이상은 2열 압축(성명 3자)으로 최대 4건.
                    건수와 무관하게 압축하면 한산한 날의 정보가 오히려 줄어들기 때문이다.
                    태그를 누르면 그 날짜의 상세를 글머리 팝업으로 편다.
                    휴무일명이 한 줄을 차지하므로 그 날은 표시 건수를 하나 줄인다(셀 높이 고정 유지). */}
                {(() => {
                  const dense = list.length > 2;
                  const cap = (dense ? 4 : 2) - (holiday ? 1 : 0);
                  const rest = list.length - cap;
                  return (
                    <span
                      className={
                        "w-full gap-[2px] items-stretch " + (dense ? "grid grid-cols-2" : "flex flex-col")
                      }
                    >
                      {list.slice(0, cap).map((it) => (
                        <button
                          key={it.id}
                          type="button"
                          onClick={() => setOpenDay(openDay === key ? null : key)}
                          title={it.detail}
                          className="w-full min-w-0 rounded-[4px] px-1 text-[9.5px] font-bold leading-[14px] truncate text-left"
                          style={{
                            // 파스텔 원색 배경 + 진한 잉크(영업 상세 캘린더 방식) — 30% 감쇄는 흐릿하다는 피드백.
                            background: it.color,
                            color: TAG_INK,
                          }}
                        >
                          {dense ? it.short : it.chip}
                        </button>
                      ))}
                      {rest > 0 && (
                        <button
                          type="button"
                          onClick={() => setOpenDay(openDay === key ? null : key)}
                          className="w-full text-[9px] font-bold leading-[12px] cd-text-faint text-left px-1"
                        >
                          +{rest}
                        </button>
                      )}
                    </span>
                  );
                })()}
              </div>
            );
          })}

          {/* 글머리 팝업 — 클릭한 날짜의 상세 사유.
              아래쪽 주(5·6주차)는 위로 펼쳐 카드 밖으로 넘치지 않게 한다. */}
          {openDay && week.some((d) => ymd(d) === openDay) && (
            <div
              className={
                "absolute left-1 z-30 max-w-[320px] rounded-xl border cd-line-c p-2.5 flex flex-col gap-1 " +
                (wi >= 4 ? "bottom-[calc(100%-4px)]" : "top-[calc(100%-4px)]")
              }
              style={{ background: "var(--cd-card-solid)", boxShadow: "var(--cd-shadow-hover)" }}
            >
              <span className="flex items-center gap-2">
                <span className="text-[11.5px] font-extrabold cd-text">{openDay.replace(/-/g, ".")}</span>
                <button
                  type="button"
                  onClick={() => setOpenDay(null)}
                  className="ml-auto cd-text-faint hover:text-[color:var(--cd-text)]"
                  aria-label="닫기"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
              {(byDay.get(openDay) ?? []).map((it) => (
                <span key={it.id} className="flex items-start gap-1.5 text-[11.5px] cd-text-body leading-[1.5]">
                  <span className="w-1.5 h-1.5 rounded-full mt-[5px] shrink-0" style={{ background: it.color }} />
                  <span className="min-w-0">
                    {it.time && <span className="font-bold tabular-nums mr-1">{it.time}</span>}
                    {it.detail}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="h-px mx-0.5 mt-1.5 mb-0.5" style={{ background: "var(--cd-hairline)" }} />

      <div className="flex items-center gap-2 px-0.5 pt-0.5">
        <h2 className="text-[13.5px] font-extrabold cd-text">오늘 일정</h2>
        {todayList.length > 0 && (
          <span
            className="text-[11px] font-extrabold rounded-md px-[7px] py-0.5"
            style={{ background: "var(--cd-secondary-soft)", color: "var(--cd-secondary)" }}
          >
            {todayList.length}
          </span>
        )}
        <Link
          href="/calendar"
          className="ml-auto text-xs font-semibold cd-text-faint hover:text-[color:var(--cd-text)] transition-colors"
        >
          일정 →
        </Link>
      </div>

      {/* 표시 건수를 3건으로 제한해 카드 높이를 고정한다 — 초과분은 건수만 알린다. */}
      <div className="flex flex-col justify-start" style={{ minHeight: 3 * 30 }}>
        {todayList.length === 0 ? (
          <p className="text-[12.5px] cd-text-faint py-2 px-0.5">오늘 표시할 일정이 없습니다.</p>
        ) : (
          <>
            {todayList.slice(0, HOME_TODAY_LIMIT).map((it) => (
              <div key={it.id} className="flex items-center gap-2.5 px-0.5 py-[5px] rounded-lg cd-row-hover">
                <span className="text-xs font-extrabold tabular-nums cd-text-primary w-10 shrink-0">
                  {it.time ?? "종일"}
                </span>
                <span className="w-[3px] h-5 rounded-sm shrink-0" style={{ background: it.color }} />
                <span className="flex-1 min-w-0 text-[12.5px] font-semibold cd-text truncate">{it.title}</span>
                {it.sub && <span className="text-[11px] cd-text-faint shrink-0 truncate max-w-[88px]">{it.sub}</span>}
              </div>
            ))}
            {todayList.length > HOME_TODAY_LIMIT && (
              <p className="text-[11.5px] cd-text-faint px-0.5 pt-0.5">
                외 {todayList.length - HOME_TODAY_LIMIT}건
              </p>
            )}
          </>
        )}
      </div>

      <CalendarRefPickerModal
        open={pickerOpen}
        initial={refs}
        onClose={() => setPickerOpen(false)}
        onSave={(ids) => {
          setRefs(ids);
          setPickerOpen(false);
          // 지정했는데 안 보이는 혼란을 막기 위해 '선택' 태그로 전환한다(단일 선택).
          if (ids.length > 0 && tag !== "refs") {
            setTag("refs");
            persist({ calendarRefs: ids, calendarTags: ["refs"] });
          } else {
            persist({ calendarRefs: ids });
          }
        }}
      />
    </section>
  );
}
