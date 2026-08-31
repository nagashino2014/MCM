"use client";

// 내 근태·초과근무(/approval/my-attendance, 전 직원) — 본인 출퇴근·초과근무·경고 현황.
// 관리자용 근태·초과근무 관리(/approval/attendance)는 admin 전용으로 남기고, 여기서는
// /api/approval/attendance/me?full=1 로 본인 것만 본다(모바일 M5 와 같은 API 의 확장).
// 배치: KPI 5카드 → 경고·요구 배너(있을 때만) → 초과근무 추이 차트 → 주별 테이블(클릭=일별 상세).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApexOptions } from "apexcharts";
import { AlertTriangle, ChevronLeft, ChevronRight, Clock3, FileWarning, Flame, MoonStar, Timer } from "lucide-react";
import ApexChart from "@/components/contracts/dashboard/ApexChart";
import { chartPalette } from "@/components/contracts/dashboard/types";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import "@/components/cdash/cdash.css";

interface WeekRow {
  weekStart: string;
  workedMinutes: number;
  overtimeMinutes: number;
  overtimeNightMinutes: number;
  overtimeDayMinutes: number;
  excessMinutes: number;
  daysWorked: number;
  overLimit: boolean;
}

interface DailyRow {
  workDate: string;
  inAt: string | null;
  outAt: string | null;
  workedMinutes: number | null;
  nightMinutes: number | null;
  lateMinutes: number | null;
  isLeaveDay: boolean;
}

interface TrendRow {
  month: string;
  workedMinutes: number;
  overtimeDayMinutes: number;
  overtimeNightMinutes: number;
  excessMinutes: number;
  overLimitWeeks: number;
}

interface MealWarning {
  warningId: string;
  usedOn: string;
  vendor: string | null;
  amount: number | null;
  requiredMinutes: number;
  appliedMinutes: number;
  action: string;
  actionNote: string | null;
}

interface AbsenceRequest {
  requestId: string;
  dateFrom: string;
  dateTo: string;
  note: string | null;
  status: string;
  docId: string | null;
}

interface MeResponse {
  weeks: WeekRow[];
  week: string | null;
  daily: DailyRow[];
  limits: { weeklyStandardMinutes: number; weeklyLimitMinutes: number; weeklyOvertimeLimitMinutes: number };
  months: string[];
  trend: TrendRow[];
  lateMonthly: Array<{ month: string; lateDays: number; lateMinutes: number }>;
  mealWarnings: MealWarning[];
  absenceRequests: AbsenceRequest[];
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const hm = (min: number | null | undefined) => {
  const v = Math.max(0, Math.round(min ?? 0));
  const h = Math.floor(v / 60);
  const m = v % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};
const hhmm = (iso: string | null) => (iso ? iso.slice(11, 16) : "—");
const MEAL_ACTION_LABEL: Record<string, string> = { warning: "경고", no_pay: "불지급", clawback: "급여 차감" };

export function MyAttendanceBoard() {
  const { theme } = useCdashTheme();
  const router = useRouter();
  const [month, setMonth] = useState<string | null>(null); // null = 최근 주 8개(초기 로드로 목록 파악)
  const [data, setData] = useState<MeResponse | null>(null);
  const [openWeek, setOpenWeek] = useState<string | null>(null);
  const [daily, setDaily] = useState<Record<string, DailyRow[]>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (m: string | null) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ full: "1" });
      if (m) qs.set("month", m);
      const res = await fetch(`/api/approval/attendance/me?${qs}`, { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as MeResponse;
      setData(d);
      setOpenWeek(null);
      // 첫 로드에서 월 미지정이면 최신 월로 고정해 연/월 탐색 상태를 맞춘다.
      if (!m && d.months.length) setMonth(d.months[0]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(month);
  }, [month, load]);

  const toggleWeek = async (weekStart: string) => {
    if (openWeek === weekStart) {
      setOpenWeek(null);
      return;
    }
    setOpenWeek(weekStart);
    if (!daily[weekStart]) {
      const qs = new URLSearchParams({ week: weekStart });
      if (month) qs.set("month", month);
      const res = await fetch(`/api/approval/attendance/me?${qs}`, { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        setDaily((prev) => ({ ...prev, [weekStart]: d.daily ?? [] }));
      }
    }
  };

  const months = data?.months ?? [];
  const monthIdx = month ? months.indexOf(month) : -1;
  const years = useMemo(() => [...new Set(months.map((m) => m.slice(0, 4)))], [months]);
  const year = (month ?? months[0] ?? "").slice(0, 4);
  const monthsOfYear = useMemo(() => months.filter((m) => m.startsWith(year)).sort(), [months, year]);

  // KPI — 선택 월 집계 + 최근 주.
  const kpi = useMemo(() => {
    const weeks = data?.weeks ?? [];
    const latest = weeks[0];
    const trendOfMonth = data?.trend.find((t) => t.month === month);
    const lateOfMonth = data?.lateMonthly.find((t) => t.month === month);
    return {
      latestWeek: latest ? { start: latest.weekStart, worked: latest.workedMinutes } : null,
      otDay: trendOfMonth?.overtimeDayMinutes ?? weeks.reduce((a, w) => a + w.overtimeDayMinutes, 0),
      otNight: trendOfMonth?.overtimeNightMinutes ?? weeks.reduce((a, w) => a + w.overtimeNightMinutes, 0),
      lateDays: lateOfMonth?.lateDays ?? 0,
      overWeeks: trendOfMonth?.overLimitWeeks ?? weeks.filter((w) => w.overLimit).length,
    };
  }, [data, month]);

  const pendingAbsence = (data?.absenceRequests ?? []).filter((r) => r.status === "pending");
  const yearWarnings = data?.mealWarnings ?? [];

  const pal = chartPalette(theme);
  const trendOptions = useMemo<ApexOptions>(
    () => ({
      chart: { type: "bar", stacked: true, toolbar: { show: false }, fontFamily: "inherit", animations: { enabled: false }, parentHeightOffset: 0 },
      plotOptions: { bar: { columnWidth: "52%", borderRadius: 4, borderRadiusApplication: "end" } },
      colors: [pal.primary, pal.secondary],
      dataLabels: { enabled: false },
      grid: { borderColor: pal.grid, strokeDashArray: 3 },
      xaxis: {
        categories: (data?.trend ?? []).map((t) => `${Number(t.month.slice(5, 7))}월`),
        labels: { style: { colors: pal.muted } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: { labels: { style: { colors: pal.muted }, formatter: (v: number) => `${Math.round(v / 60)}h` } },
      legend: { labels: { colors: pal.muted } },
      tooltip: { y: { formatter: (v: number) => hm(v) } },
    }),
    [data, pal]
  );
  const trendSeries = useMemo(
    () => [
      { name: "연장(1.5배)", data: (data?.trend ?? []).map((t) => t.overtimeDayMinutes) },
      { name: "야간(2.0배)", data: (data?.trend ?? []).map((t) => t.overtimeNightMinutes) },
    ],
    [data]
  );

  const limits = data?.limits;

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="내 근태·초과근무"
        meta={month ? `${year}년 ${Number(month.slice(5, 7))}월` : undefined}
        actions={
          <div className="flex items-center gap-1.5">
            <select
              className="cd-select"
              style={{ width: 92 }}
              value={year}
              onChange={(e) => {
                const ms = months.filter((m) => m.startsWith(e.target.value));
                if (ms.length) setMonth(ms[0]);
              }}
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
            <button
              type="button"
              className="cd-btn cd-btn-ghost cd-btn-sm"
              disabled={monthIdx < 0 || monthIdx >= months.length - 1}
              onClick={() => setMonth(months[monthIdx + 1])}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <select className="cd-select" style={{ width: 84 }} value={month ?? ""} onChange={(e) => setMonth(e.target.value)}>
              {monthsOfYear.map((m) => (
                <option key={m} value={m}>{Number(m.slice(5, 7))}월</option>
              ))}
            </select>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={monthIdx <= 0} onClick={() => setMonth(months[monthIdx - 1])}>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        }
      />

      {/* KPI 5카드 */}
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        {[
          { icon: Clock3, label: "최근 주 근무", value: kpi.latestWeek ? hm(kpi.latestWeek.worked) : "—", sub: kpi.latestWeek ? `${kpi.latestWeek.start} 주` : null },
          { icon: Timer, label: "월 연장(1.5배)", value: hm(kpi.otDay), sub: null },
          { icon: MoonStar, label: "월 야간(2.0배)", value: hm(kpi.otNight), sub: null },
          { icon: AlertTriangle, label: "월 지각", value: `${kpi.lateDays}일`, sub: null },
          { icon: Flame, label: "12h 초과 주", value: `${kpi.overWeeks}주`, sub: limits ? `주 연장한도 ${hm(limits.weeklyOvertimeLimitMinutes)}` : null },
        ].map((k) => (
          <div key={k.label} className="cd-card p-4 rounded-2xl">
            <div className="flex items-center gap-2 text-xs cd-text-muted mb-1.5">
              <k.icon className="w-3.5 h-3.5" /> {k.label}
            </div>
            <div className="text-xl font-extrabold cd-text tabular-nums">{loading && !data ? "…" : k.value}</div>
            {k.sub && <div className="text-[11px] cd-text-faint mt-1">{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* 경고·요구 배너 — 해당 있을 때만 */}
      {(yearWarnings.length > 0 || pendingAbsence.length > 0) && (
        <div className="rounded-2xl border p-3.5 space-y-2" style={{ borderColor: "var(--cd-warning)", background: "var(--cd-warning-soft)" }}>
          {yearWarnings.length > 0 && (
            <div className="text-sm">
              <div className="flex items-center gap-1.5 font-bold cd-text mb-1">
                <AlertTriangle className="w-4 h-4" /> 초과근무 식대 경고 {yearWarnings.length}건 ({year}년)
              </div>
              <div className="grid gap-1">
                {yearWarnings.slice(0, 5).map((w) => (
                  <div key={w.warningId} className="flex items-center gap-2 text-xs cd-text-muted flex-wrap">
                    <span className="tabular-nums cd-text">{w.usedOn}</span>
                    {w.vendor && <span>{w.vendor}</span>}
                    {w.amount != null && <span className="tabular-nums">{Math.round(w.amount).toLocaleString("ko-KR")}원</span>}
                    <span>초과근무 신청 {hm(w.appliedMinutes)} / 기준 {hm(w.requiredMinutes)}</span>
                    <span className="cd-pill cd-pill-warn">{MEAL_ACTION_LABEL[w.action] ?? w.action}</span>
                    {w.actionNote && <span className="cd-text-faint">{w.actionNote}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {pendingAbsence.length > 0 && (
            <div className="text-sm">
              <div className="flex items-center gap-1.5 font-bold cd-text mb-1">
                <FileWarning className="w-4 h-4" /> 결근사유서 제출 요구 {pendingAbsence.length}건
              </div>
              <div className="grid gap-1">
                {pendingAbsence.map((r) => (
                  <div key={r.requestId} className="flex items-center gap-2 text-xs cd-text-muted flex-wrap">
                    <span className="tabular-nums cd-text">
                      {r.dateFrom}
                      {r.dateTo !== r.dateFrom ? ` ~ ${r.dateTo}` : ""}
                    </span>
                    {r.note && <span>{r.note}</span>}
                    <button
                      type="button"
                      className="cd-btn cd-btn-primary cd-btn-sm ml-1"
                      onClick={() => router.push("/approval/draft?formId=frm-absence-statement")}
                    >
                      작성하러 가기
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 초과근무 추이(최근 12개월) */}
      <div className="cd-card p-4 rounded-2xl">
        <div className="cd-card-title mb-1">초과근무 추이 (최근 12개월)</div>
        {(data?.trend ?? []).length === 0 ? (
          <div className="text-sm cd-text-muted py-6 text-center">근태 기록이 없습니다.</div>
        ) : (
          <ApexChart key={theme} options={trendOptions} series={trendSeries} type="bar" height={200} />
        )}
      </div>

      {/* 주별 테이블 (클릭 = 일별 상세) */}
      <div className="cd-card p-4 rounded-2xl">
        <div className="cd-card-title mb-2">주별 근무 · 초과근무{month ? ` — ${year}년 ${Number(month.slice(5, 7))}월` : ""}</div>
        <div className="grid grid-cols-[1fr_0.9fr_0.9fr_0.9fr_1.3fr_0.9fr] gap-2 text-[11px] cd-text-faint px-1 pb-1">
          <span>주 시작일</span>
          <span className="text-right">실근무</span>
          <span className="text-right">연장(1.5배)</span>
          <span className="text-right">야간(2.0배)</span>
          <span>주 52h 게이지</span>
          <span className="text-right">12h 초과</span>
        </div>
        {(data?.weeks ?? []).map((w) => {
          const limit = limits?.weeklyLimitMinutes ?? 3120;
          const pct = Math.min(100, (w.workedMinutes / limit) * 100);
          const open = openWeek === w.weekStart;
          return (
            <div key={w.weekStart} className="border-t cd-hairline-row-c">
              <button type="button" onClick={() => void toggleWeek(w.weekStart)} className="w-full grid grid-cols-[1fr_0.9fr_0.9fr_0.9fr_1.3fr_0.9fr] gap-2 items-center px-1 py-2 text-[13px] cd-row-hover rounded-lg text-left">
                <span className="tabular-nums cd-text font-medium">{w.weekStart} 주</span>
                <span className="tabular-nums text-right cd-text">{hm(w.workedMinutes)}</span>
                <span className="tabular-nums text-right cd-text-muted">{hm(w.overtimeDayMinutes)}</span>
                <span className="tabular-nums text-right cd-text-muted">{hm(w.overtimeNightMinutes)}</span>
                <span className="flex items-center gap-1.5">
                  <span className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--cd-hairline)" }}>
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${pct}%`, background: w.overLimit ? "var(--cd-error, #ef4444)" : "var(--cd-primary)" }}
                    />
                  </span>
                  <span className="text-[10px] cd-text-faint tabular-nums w-8">{Math.round(pct)}%</span>
                </span>
                <span className="text-right">
                  {w.overLimit ? <span className="cd-pill cd-pill-error">초과 {hm(w.excessMinutes)}</span> : <span className="cd-pill cd-pill-idle">—</span>}
                </span>
              </button>
              {open && (
                <div className="mx-1 mb-2 rounded-xl border cd-border-c p-2">
                  <div className="grid grid-cols-[1.1fr_0.8fr_0.8fr_0.9fr_0.9fr_0.9fr] gap-2 text-[11px] cd-text-faint pb-1">
                    <span>날짜</span>
                    <span>출근</span>
                    <span>퇴근</span>
                    <span className="text-right">실근무</span>
                    <span className="text-right">야간</span>
                    <span className="text-right">지각</span>
                  </div>
                  {(daily[w.weekStart] ?? []).map((d) => {
                    const dt = new Date(d.workDate + "T00:00:00");
                    return (
                      <div key={d.workDate} className="grid grid-cols-[1.1fr_0.8fr_0.8fr_0.9fr_0.9fr_0.9fr] gap-2 text-[12.5px] py-1 border-t cd-hairline-row-c items-center">
                        <span className="tabular-nums cd-text">
                          {d.workDate.slice(5)} ({WEEKDAYS[dt.getDay()]}){d.isLeaveDay && <span className="cd-pill cd-pill-info ml-1">휴가</span>}
                        </span>
                        <span className="tabular-nums cd-text-muted">{hhmm(d.inAt)}</span>
                        <span className="tabular-nums cd-text-muted">{hhmm(d.outAt)}</span>
                        <span className="tabular-nums text-right cd-text">{d.workedMinutes != null ? hm(d.workedMinutes) : "—"}</span>
                        <span className="tabular-nums text-right cd-text-muted">{d.nightMinutes ? hm(d.nightMinutes) : "—"}</span>
                        <span className="tabular-nums text-right">
                          {d.lateMinutes ? <span className="cd-pill cd-pill-warn">{d.lateMinutes}분</span> : <span className="cd-text-faint">—</span>}
                        </span>
                      </div>
                    );
                  })}
                  {(daily[w.weekStart] ?? []).length === 0 && <div className="text-xs cd-text-muted py-2 text-center">불러오는 중…</div>}
                </div>
              )}
            </div>
          );
        })}
        {!loading && (data?.weeks ?? []).length === 0 && (
          <div className="text-sm cd-text-muted py-6 text-center">이 달의 근태 기록이 없습니다.</div>
        )}
      </div>
    </div>
  );
}
