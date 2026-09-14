"use client";

// 내 휴가 섹션(/approval/my-hr 좌측, 전 직원) — 본인 연차·비연차·특별휴가 현황.
// 내 근태 섹션과 한 화면(MyHrBoard)에 2:3 으로 배치된다(사용자 확정 2026-08-31 — 정보밀도).
// API /api/approval/leave/me — user_id → employee_id 스코프라 본인 것만 온다.
// 배치: KPI 2×2 → 월 캘린더(공휴일·대체휴일 표기, 도트 4유형) → 사용 내역 → 특별휴가.

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck2, CalendarPlus, ChevronLeft, ChevronRight, Gauge, HeartHandshake, Sparkles } from "lucide-react";

interface EntryRow {
  entryId: string;
  entryType: string; // grant|use|adjust
  days: number;
  usedOn: string | null;
  leaveTypeKey: string | null;
  leaveLabel: string | null;
  leaveGroup: string | null;
  deduct: "full" | "half" | null;
  docId: string | null;
  source: "groupware" | "excel" | "manual";
  note: string | null;
}

interface SpecialRemaining {
  kind: string;
  label: string;
  remaining: number;
  unit?: "day" | "hour";
}

interface SpecialEntryRow {
  entryId: string;
  kindLabel: string;
  entryType: "grant" | "use" | "adjust";
  days: number;
  unit?: "day" | "hour";
  effectiveOn: string | null;
  expiresOn: string | null;
  note: string | null;
}

interface Overview {
  year: string;
  employeeId: string | null;
  accrualBasis: "jan1" | "hire_date";
  accrualDate: string | null;
  accrual: number | null;
  granted: number;
  usedAnnual: number;
  remaining: number;
  otherUsed: number;
  entries: EntryRow[];
  special: { remaining: SpecialRemaining[]; entries: SpecialEntryRow[] };
  years: string[];
}

const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 휴가 도트 4유형 — 연차(파랑)·반차(하늘)·경조(주황)·공가 등(녹색).
 * 경조 판정은 카탈로그 그룹명("경조 · 결혼" 등) 접두어.
 */
type DotKind = "annual" | "half" | "family" | "official";
const DOT_COLOR: Record<DotKind, string> = {
  annual: "var(--cd-primary)",
  half: "var(--cd-secondary)",
  family: "var(--cd-warning)",
  official: "var(--cd-success)",
};
const DOT_LABEL: Record<DotKind, string> = { annual: "연차", half: "반차", family: "비연차(경조)", official: "비연차(공가 등)" };

function dotKind(e: EntryRow): DotKind {
  if (e.deduct === "half") return "half";
  if (e.deduct === "full" || e.leaveTypeKey === null) return "annual";
  if ((e.leaveGroup ?? "").startsWith("경조")) return "family";
  return "official";
}

export function MyLeaveSection() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear));
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [calMonth, setCalMonth] = useState(new Date().getMonth() + 1);
  // 공휴일(date → 명칭) — 홈 캘린더와 같은 소스(/api/home/holidays: 법정+사내 지정+대체휴일 병합).
  const [holidays, setHolidays] = useState<Map<string, string>>(new Map());

  const load = useCallback(async (y: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/approval/leave/me?year=${y}`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(year);
    setCalMonth(year === String(thisYear) ? new Date().getMonth() + 1 : 12);
  }, [year, load, thisYear]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/home/holidays?year=${year}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d || !Array.isArray(d.holidays)) return;
        setHolidays(new Map(d.holidays.map((h: { date: string; name: string }) => [h.date, h.name])));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [year]);

  const usesByMonth = useMemo(() => {
    const uses = (data?.entries ?? []).filter((e) => e.entryType === "use" && e.usedOn);
    const map = new Map<string, EntryRow[]>();
    for (const e of uses) {
      const m = e.usedOn!.slice(0, 7);
      (map.get(m) ?? map.set(m, []).get(m)!).push(e);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([month, rows]) => ({
        month,
        rows: rows.sort((a, b) => (a.usedOn! < b.usedOn! ? 1 : -1)),
        days: rows.reduce((acc, r) => acc + (r.deduct !== null || r.leaveTypeKey === null ? r.days : 0), 0),
      }));
  }, [data]);

  const usesByDate = useMemo(() => {
    const map = new Map<string, EntryRow[]>();
    for (const e of (data?.entries ?? []).filter((x) => x.entryType === "use" && x.usedOn)) {
      (map.get(e.usedOn!) ?? map.set(e.usedOn!, []).get(e.usedOn!)!).push(e);
    }
    return map;
  }, [data]);

  const yearOptions = useMemo(() => {
    const set = new Set([String(thisYear), ...(data?.years ?? [])]);
    return [...set].sort().reverse();
  }, [data, thisYear]);

  const remainPct = data && data.granted > 0 ? Math.max(0, Math.min(100, (data.remaining / data.granted) * 100)) : 0;

  const kpis = data
    ? [
        { icon: CalendarPlus, label: "발생 연차", value: `${fmtDays(data.granted)}일`, sub: data.accrual != null ? `규정 발생 ${fmtDays(data.accrual)}일` : null },
        {
          icon: CalendarCheck2,
          label: "연차 발생일",
          value: data.accrualDate ?? "—",
          sub: data.accrualBasis === "jan1" ? "회계연도(1/1) 기준" : "입사일 기준",
        },
        { icon: HeartHandshake, label: "사용 연차", value: `${fmtDays(data.usedAnnual)}일`, sub: data.otherUsed > 0 ? `연차 외 ${fmtDays(data.otherUsed)}일` : null },
        { icon: Gauge, label: "잔여 연차", value: `${fmtDays(data.remaining)}일`, sub: null, gauge: remainPct },
      ]
    : [];

  // 캘린더 그리드 — 주 단위(홈 캘린더와 같은 7열, 앞뒤는 빈 칸).
  const calCells = useMemo(() => {
    const y = Number(year);
    const first = new Date(y, calMonth - 1, 1);
    const daysInMonth = new Date(y, calMonth, 0).getDate();
    const lead = first.getDay();
    const cells: Array<{ date: string; day: number; dow: number } | null> = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= daysInMonth; d += 1) {
      cells.push({
        date: `${year}-${String(calMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
        day: d,
        dow: (lead + d - 1) % 7,
      });
    }
    return cells;
  }, [year, calMonth]);

  const todayKey = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-4 min-w-0">
      {/* 섹션 타이틀 + 연도 탐색 */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-[15px] font-extrabold cd-text">내 휴가</div>
        <div className="flex items-center gap-1">
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setYear((y) => String(Number(y) - 1))}>
            <ChevronLeft className="w-4 h-4" />
          </button>
          <select className="cd-select" style={{ width: 92 }} value={year} onChange={(e) => setYear(e.target.value)}>
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
          <button
            type="button"
            className="cd-btn cd-btn-ghost cd-btn-sm"
            disabled={Number(year) >= thisYear}
            onClick={() => setYear((y) => String(Number(y) + 1))}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!loading && data && !data.employeeId && (
        <div className="cd-card p-4 text-sm cd-text-muted">계정에 직원 정보가 연결되어 있지 않습니다. 관리자에게 문의하세요.</div>
      )}

      {/* KPI 2×2 */}
      <div className="grid grid-cols-2 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="cd-card p-4 rounded-2xl">
            <div className="flex items-center gap-2 text-xs cd-text-muted mb-1.5">
              <k.icon className="w-3.5 h-3.5" /> {k.label}
            </div>
            <div className="text-lg font-extrabold cd-text tabular-nums">{k.value}</div>
            {"gauge" in k && k.gauge !== undefined ? (
              <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--cd-hairline)" }}>
                <div className="h-full rounded-full cd-grad-fill" style={{ width: `${k.gauge}%` }} />
              </div>
            ) : (
              k.sub && <div className="text-[11px] cd-text-faint mt-1">{k.sub}</div>
            )}
          </div>
        ))}
        {loading && kpis.length === 0 &&
          Array.from({ length: 4 }, (_, i) => <div key={i} className="cd-card p-4 rounded-2xl h-[88px] animate-pulse" />)}
      </div>

      {/* 월 캘린더 — 공휴일·대체휴일 붉은 표기(홈 캘린더 관례), 도트 4유형 */}
      <div className="cd-card p-4 rounded-2xl">
        <div className="flex items-center justify-between mb-2">
          <div className="cd-card-title">
            {year}년 {calMonth}월
          </div>
          <div className="flex items-center gap-1">
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={calMonth <= 1} onClick={() => setCalMonth((m) => m - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={calMonth >= 12} onClick={() => setCalMonth((m) => m + 1)}>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 mb-0.5">
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
        <div className="grid grid-cols-7">
          {calCells.map((c, i) =>
            c === null ? (
              <div key={`x${i}`} className="h-[58px]" />
            ) : (
              (() => {
                const uses = usesByDate.get(c.date) ?? [];
                const holiday = holidays.get(c.date);
                const isToday = c.date === todayKey;
                const kinds = [...new Set(uses.map(dotKind))];
                const dayColor = isToday
                  ? "#fff"
                  : holiday || c.dow === 0
                    ? "var(--cd-error)"
                    : c.dow === 6
                      ? "var(--cd-secondary)"
                      : "var(--cd-body)";
                return (
                  <div
                    key={c.date}
                    className="h-[58px] overflow-hidden flex flex-col items-center gap-0.5 pt-0.5 px-[1px]"
                    title={[holiday, ...uses.map((u) => u.leaveLabel ?? "연차")].filter(Boolean).join(", ") || undefined}
                  >
                    <span
                      className="w-[21px] h-[21px] rounded-full inline-flex items-center justify-center text-[11.5px] shrink-0"
                      style={{
                        fontWeight: isToday ? 800 : 500,
                        color: dayColor,
                        background: isToday ? "var(--cd-primary)" : undefined,
                      }}
                    >
                      {c.day}
                    </span>
                    {holiday && (
                      <span className="text-[8.5px] leading-tight truncate max-w-full" style={{ color: "var(--cd-error)" }}>
                        {holiday}
                      </span>
                    )}
                    {kinds.length > 0 && (
                      <span className="flex justify-center gap-0.5">
                        {kinds.map((k) => (
                          <span key={k} className="w-1.5 h-1.5 rounded-full" style={{ background: DOT_COLOR[k] }} />
                        ))}
                      </span>
                    )}
                  </div>
                );
              })()
            )
          )}
        </div>
        <div className="flex items-center gap-2.5 mt-2 text-[10.5px] cd-text-faint flex-wrap">
          {(Object.keys(DOT_COLOR) as DotKind[]).map((k) => (
            <span key={k} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: DOT_COLOR[k] }} /> {DOT_LABEL[k]}
            </span>
          ))}
        </div>
      </div>

      {/* 사용 내역 — 행이 짧아 한 열이면 여백이 많이 남는다 → 월 그룹을 2열로 흘린다. */}
      <div className="cd-card p-4 rounded-2xl">
        <div className="cd-card-title mb-2">사용 내역</div>
        {usesByMonth.length === 0 && <div className="text-sm cd-text-muted py-5 text-center">{year}년 휴가 사용 내역이 없습니다.</div>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5">
          {usesByMonth.map((g) => (
            <div key={g.month} className="mb-3 last:mb-0 min-w-0">
              <div className="flex items-center gap-2 text-xs font-bold cd-text-muted mb-1">
                {Number(g.month.slice(5, 7))}월
                <span className="cd-text-faint font-medium">연차 차감 {fmtDays(g.days)}일</span>
              </div>
              {g.rows.map((e) => {
                const d = new Date(e.usedOn! + "T00:00:00");
                const kind = dotKind(e);
                return (
                  <div key={e.entryId} className="flex items-center gap-2 text-[12.5px] py-1.5 border-t cd-hairline-row-c">
                    <span className="tabular-nums cd-text w-[84px] shrink-0">
                      {e.usedOn!.slice(5)} ({WEEKDAYS[d.getDay()]})
                    </span>
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: DOT_COLOR[kind] }} />
                      <span className="cd-text truncate">{e.leaveLabel ?? "연차"}</span>
                    </span>
                    <span className="tabular-nums cd-text-muted ml-auto shrink-0">
                      {kind === "annual" || kind === "half" ? `${fmtDays(e.days)}일 차감` : "차감 없음"}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 특별휴가 — 부여·이력이 있을 때만 */}
      {data && (data.special.remaining.length > 0 || data.special.entries.length > 0) && (
        <div className="cd-card p-4 rounded-2xl">
          <div className="flex items-center gap-2 text-sm font-bold cd-text mb-2 flex-wrap">
            <Sparkles className="w-4 h-4" /> 특별휴가
            {data.special.remaining.map((r) => (
              <span key={r.kind} className="cd-pill cd-pill-info">
                {r.label} 잔여 {fmtDays(r.remaining)}{r.unit === "hour" ? "시간" : "일"}
              </span>
            ))}
            {data.special.remaining.length === 0 && <span className="cd-pill cd-pill-idle">잔여 없음</span>}
          </div>
          <div className="grid gap-1">
            {data.special.entries.slice(0, 8).map((e) => (
              <div key={e.entryId} className="flex items-center gap-2 text-xs border-t cd-hairline-row-c pt-1.5 first:border-t-0 first:pt-0 flex-wrap">
                <span className={`cd-pill ${e.entryType === "use" ? "cd-pill-warn" : "cd-pill-success"}`}>
                  {e.entryType === "use" ? "사용" : e.entryType === "grant" ? "부여" : "조정"}
                </span>
                <span className="cd-text font-medium">{e.kindLabel}</span>
                <span className="tabular-nums">{fmtDays(e.days)}{e.unit === "hour" ? "시간" : "일"}</span>
                <span className="cd-text-faint">{e.effectiveOn ?? ""}</span>
                {e.expiresOn && <span className="cd-text-faint">~ {e.expiresOn} 만료</span>}
                {e.note && <span className="cd-text-faint truncate">{e.note}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
