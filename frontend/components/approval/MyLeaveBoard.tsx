"use client";

// 내 휴가(/approval/my-leave, 전 직원) — 본인 연차·비연차·특별휴가 현황.
// 관리자용 직원별 휴가 관리(/approval/leave)는 admin 전용으로 남기고, 여기서는 본인 것만 본다
// (API /api/approval/leave/me — user_id → employee_id 스코프).
// 배치: KPI 4카드 → 특별휴가(있을 때만) → 좌 사용 내역(월별 그룹) / 우 월 캘린더.

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck2, CalendarPlus, ChevronLeft, ChevronRight, Gauge, HeartHandshake, Sparkles } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import "@/components/cdash/cdash.css";

interface EntryRow {
  entryId: string;
  entryType: string; // grant|use|adjust
  days: number;
  usedOn: string | null;
  leaveTypeKey: string | null;
  leaveLabel: string | null;
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
const SOURCE_LABEL: Record<string, string> = { groupware: "그룹웨어", excel: "엑셀", manual: "수기" };

export function MyLeaveBoard() {
  const { theme } = useCdashTheme();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear));
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  // 캘린더 표시 월(1~12) — 기본 이번 달, 과거 연도는 12월.
  const [calMonth, setCalMonth] = useState(new Date().getMonth() + 1);

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

  // 사용 내역(use)만 월별로 묶는다 — 최신 월부터.
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

  // 캘린더용: 날짜 → 사용 엔트리
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

  // 캘린더 그리드(선택 월)
  const calCells = useMemo(() => {
    const y = Number(year);
    const first = new Date(y, calMonth - 1, 1);
    const daysInMonth = new Date(y, calMonth, 0).getDate();
    const lead = first.getDay();
    const cells: Array<{ date: string; day: number } | null> = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= daysInMonth; d += 1) {
      cells.push({ date: `${year}-${String(calMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`, day: d });
    }
    return cells;
  }, [year, calMonth]);

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="내 휴가"
        meta={data ? `${year}년 잔여 ${fmtDays(data.remaining)}일` : undefined}
        actions={
          <div className="flex items-center gap-1.5">
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setYear((y) => String(Number(y) - 1))}>
              <ChevronLeft className="w-4 h-4" />
            </button>
            <select className="cd-select" style={{ width: 96 }} value={year} onChange={(e) => setYear(e.target.value)}>
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
        }
      />

      {!loading && data && !data.employeeId && (
        <div className="cd-card p-4 text-sm cd-text-muted">계정에 직원 정보가 연결되어 있지 않습니다. 관리자에게 문의하세요.</div>
      )}

      {/* KPI 4카드 */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="cd-card p-4 rounded-2xl">
            <div className="flex items-center gap-2 text-xs cd-text-muted mb-1.5">
              <k.icon className="w-3.5 h-3.5" /> {k.label}
            </div>
            <div className="text-xl font-extrabold cd-text tabular-nums">{k.value}</div>
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
          Array.from({ length: 4 }, (_, i) => <div key={i} className="cd-card p-4 rounded-2xl h-[92px] animate-pulse" />)}
      </div>

      {/* 특별휴가 — 부여·잔여가 있을 때만 */}
      {data && (data.special.remaining.length > 0 || data.special.entries.length > 0) && (
        <div className="cd-card p-4 rounded-2xl">
          <div className="flex items-center gap-2 text-sm font-bold cd-text mb-2">
            <Sparkles className="w-4 h-4" /> 특별휴가
            <span className="flex items-center gap-1.5 ml-2">
              {data.special.remaining.map((r) => (
                <span key={r.kind} className="cd-pill cd-pill-info">
                  {r.label} 잔여 {fmtDays(r.remaining)}{r.unit === "hour" ? "시간" : "일"}
                </span>
              ))}
              {data.special.remaining.length === 0 && <span className="cd-pill cd-pill-idle">잔여 없음</span>}
            </span>
          </div>
          <div className="grid gap-1">
            {data.special.entries.slice(0, 8).map((e) => (
              <div key={e.entryId} className="flex items-center gap-2 text-xs border-t cd-hairline-row-c pt-1.5 first:border-t-0 first:pt-0">
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

      {/* 좌: 사용 내역 / 우: 월 캘린더 */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 flex-1 min-h-0">
        <div className="xl:col-span-7 cd-card p-4 rounded-2xl overflow-y-auto">
          <div className="cd-card-title mb-2">사용 내역</div>
          {usesByMonth.length === 0 && <div className="text-sm cd-text-muted py-6 text-center">{year}년 휴가 사용 내역이 없습니다.</div>}
          {usesByMonth.map((g) => (
            <div key={g.month} className="mb-3">
              <div className="flex items-center gap-2 text-xs font-bold cd-text-muted mb-1">
                {Number(g.month.slice(5, 7))}월
                <span className="cd-text-faint font-medium">연차 차감 {fmtDays(g.days)}일</span>
              </div>
              {g.rows.map((e) => {
                const d = new Date(e.usedOn! + "T00:00:00");
                const isAnnual = e.deduct !== null || e.leaveTypeKey === null;
                return (
                  <div key={e.entryId} className="flex items-center gap-2 text-[13px] py-1.5 border-t cd-hairline-row-c">
                    <span className="tabular-nums cd-text w-24 shrink-0">
                      {e.usedOn!.slice(5)} ({WEEKDAYS[d.getDay()]})
                    </span>
                    <span className={`cd-pill ${isAnnual ? "cd-pill-info" : "cd-pill-success"}`}>{e.leaveLabel ?? "연차"}</span>
                    <span className="tabular-nums cd-text-muted">{isAnnual ? `${fmtDays(e.days)}일 차감` : "차감 없음"}</span>
                    <span className="cd-text-faint text-[11px] ml-auto">{SOURCE_LABEL[e.source]}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="xl:col-span-5 cd-card p-4 rounded-2xl">
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
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] cd-text-faint mb-1">
            {WEEKDAYS.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calCells.map((c, i) =>
              c === null ? (
                <div key={`x${i}`} />
              ) : (
                (() => {
                  const uses = usesByDate.get(c.date) ?? [];
                  const hasAnnual = uses.some((u) => u.deduct !== null || u.leaveTypeKey === null);
                  const hasOther = uses.some((u) => u.leaveTypeKey !== null && u.deduct === null);
                  return (
                    <div
                      key={c.date}
                      className={`rounded-lg border py-1.5 text-center text-[12px] tabular-nums ${uses.length ? "cd-tint-primary cd-border-c font-bold" : "cd-border-c"}`}
                      title={uses.map((u) => u.leaveLabel ?? "연차").join(", ") || undefined}
                    >
                      <div className="cd-text">{c.day}</div>
                      <div className="flex justify-center gap-0.5 h-1.5 mt-0.5">
                        {hasAnnual && <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--cd-primary)" }} />}
                        {hasOther && <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--cd-success)" }} />}
                      </div>
                    </div>
                  );
                })()
              )
            )}
          </div>
          <div className="flex items-center gap-3 mt-2 text-[11px] cd-text-faint">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: "var(--cd-primary)" }} /> 연차(차감)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: "var(--cd-success)" }} /> 비연차(경조·공가 등)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
