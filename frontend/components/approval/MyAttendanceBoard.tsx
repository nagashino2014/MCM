"use client";

// 내 근태·초과근무 섹션(/approval/my-hr 우측, 전 직원) — 본인 출퇴근·초과근무·수당·경고 현황.
// 내 휴가 섹션과 한 화면(MyHrBoard)에 2:3 으로 배치된다(사용자 확정 2026-08-31 — 정보밀도).
// API /api/approval/attendance/me?full=1 — 월별 추이·지각·식대 경고·결근 요구·수당 기준까지 온다.
// 배치: KPI 3×2(6개, 전월 초과근무수당 포함) → 경고 배너 → 2:3 분할
//       [좌: 초과근무 추이 + 초과근무수당 추이 / 우: 주별 테이블 + 주별 수당(우상단 시급 기준액)].

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApexOptions } from "apexcharts";
import { AlertTriangle, Banknote, ChevronLeft, ChevronRight, Clock3, FileWarning, Flame, MoonStar, Timer } from "lucide-react";
import ApexChart from "@/components/contracts/dashboard/ApexChart";
import { chartPalette, type CdTheme } from "@/components/contracts/dashboard/types";

interface WeekRow {
  weekStart: string;
  workedMinutes: number;
  overtimeMinutes: number;
  overtimeNightMinutes: number;
  overtimeDayMinutes: number;
  excessMinutes: number;
  daysWorked: number;
  overLimit: boolean;
  estimatedPay: number | null;
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
  estimatedPay: number | null;
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

interface PayBasis {
  hourlyWage: number | null;
  rateDay: number;
  rateNight: number;
  divisorHours: number;
  /** 초과근무수당 산정 제외자 — 수당을 표시하지 않는다(test 토글은 admin 한정). */
  excluded: boolean;
  canTest: boolean;
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
  pay: PayBasis | null;
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

export function MyAttendanceSection({ theme }: { theme: CdTheme }) {
  const router = useRouter();
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<MeResponse | null>(null);
  const [openWeek, setOpenWeek] = useState<string | null>(null);
  const [daily, setDaily] = useState<Record<string, DailyRow[]>>({});
  const [loading, setLoading] = useState(true);
  // 산정 제외자의 수당 강제 표시(admin 전용 test 토글 — 산정 기능 동작 확인용).
  const [testPay, setTestPay] = useState(false);

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

  // 전월(실제 달력 기준) — "전월 초과근무수당" KPI 는 선택 월과 무관하게 고정이다.
  const prevMonthKey = useMemo(() => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const kpi = useMemo(() => {
    const weeks = data?.weeks ?? [];
    const latest = weeks[0];
    const trendOfMonth = data?.trend.find((t) => t.month === month);
    const lateOfMonth = data?.lateMonthly.find((t) => t.month === month);
    const prevPay = data?.trend.find((t) => t.month === prevMonthKey)?.estimatedPay ?? null;
    return {
      latestWeek: latest ? { start: latest.weekStart, worked: latest.workedMinutes } : null,
      otDay: trendOfMonth?.overtimeDayMinutes ?? weeks.reduce((a, w) => a + w.overtimeDayMinutes, 0),
      otNight: trendOfMonth?.overtimeNightMinutes ?? weeks.reduce((a, w) => a + w.overtimeNightMinutes, 0),
      lateDays: lateOfMonth?.lateDays ?? 0,
      overWeeks: trendOfMonth?.overLimitWeeks ?? weeks.filter((w) => w.overLimit).length,
      prevPay,
    };
  }, [data, month, prevMonthKey]);

  const pendingAbsence = (data?.absenceRequests ?? []).filter((r) => r.status === "pending");
  const yearWarnings = data?.mealWarnings ?? [];
  const pay = data?.pay ?? null;
  const limits = data?.limits;
  // 산정 제외자는 수당을 숨긴다(admin 이 test 토글을 켠 동안만 표시).
  const hidePay = Boolean(pay?.excluded) && !testPay;

  const pal = chartPalette(theme);
  const baseBarOptions = useCallback(
    (categories: string[], yFormatter: (v: number) => string, tooltipFormatter: (v: number) => string): ApexOptions => ({
      chart: { type: "bar", stacked: true, toolbar: { show: false }, fontFamily: "inherit", animations: { enabled: false }, parentHeightOffset: 0 },
      plotOptions: { bar: { columnWidth: "52%", borderRadius: 4, borderRadiusApplication: "end" } },
      colors: [pal.primary, pal.secondary],
      dataLabels: { enabled: false },
      grid: { borderColor: pal.grid, strokeDashArray: 3 },
      xaxis: { categories, labels: { style: { colors: pal.muted } }, axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { labels: { style: { colors: pal.muted }, formatter: yFormatter } },
      legend: { labels: { colors: pal.muted } },
      tooltip: { y: { formatter: tooltipFormatter } },
    }),
    [pal]
  );

  const trendCategories = (data?.trend ?? []).map((t) => `${Number(t.month.slice(5, 7))}월`);
  const trendOptions = useMemo(
    () => baseBarOptions(trendCategories, (v) => `${Math.round(v / 60)}h`, (v) => hm(v)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, baseBarOptions]
  );
  const trendSeries = useMemo(
    () => [
      { name: "연장(1.5배)", data: (data?.trend ?? []).map((t) => t.overtimeDayMinutes) },
      { name: "야간(2.0배)", data: (data?.trend ?? []).map((t) => t.overtimeNightMinutes) },
    ],
    [data]
  );

  // 수당 추이 — 통상시급으로 환산한 월별 예상 수당(연장/야간 분리, 서버 규칙과 동일 산식).
  const payOptions = useMemo(
    () =>
      baseBarOptions(
        trendCategories,
        (v) => `${Math.round(v / 10000)}만`,
        (v) => `${Math.round(v).toLocaleString("ko-KR")}원`
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, baseBarOptions]
  );
  const paySeries = useMemo(() => {
    const wage = pay?.hourlyWage;
    if (wage == null || !pay) return [];
    return [
      { name: "연장수당", data: (data?.trend ?? []).map((t) => Math.round((wage * pay.rateDay * t.overtimeDayMinutes) / 60)) },
      { name: "야간수당", data: (data?.trend ?? []).map((t) => Math.round((wage * pay.rateNight * t.overtimeNightMinutes) / 60)) },
    ];
  }, [data, pay]);

  return (
    <div className="flex flex-col gap-4 min-w-0 2xl:h-full 2xl:min-h-0">
      {/* 섹션 타이틀 + 연·월 탐색 */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[15px] font-extrabold cd-text">내 근태·초과근무</div>
        <div className="flex items-center gap-1">
          <select
            className="cd-select"
            style={{ width: 88 }}
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
          <select className="cd-select" style={{ width: 78 }} value={month ?? ""} onChange={(e) => setMonth(e.target.value)}>
            {monthsOfYear.map((m) => (
              <option key={m} value={m}>{Number(m.slice(5, 7))}월</option>
            ))}
          </select>
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={monthIdx <= 0} onClick={() => setMonth(months[monthIdx - 1])}>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* KPI 3×2 — 6개(전월 초과근무수당 포함) */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { icon: Clock3, label: "최근 주 근무", value: kpi.latestWeek ? hm(kpi.latestWeek.worked) : "—", sub: kpi.latestWeek ? `${kpi.latestWeek.start} 주` : null },
          { icon: Timer, label: "월 연장(1.5배)", value: hm(kpi.otDay), sub: null },
          { icon: MoonStar, label: "월 야간(2.0배)", value: hm(kpi.otNight), sub: null },
          { icon: AlertTriangle, label: "월 지각", value: `${kpi.lateDays}일`, sub: null },
          { icon: Flame, label: "12h 초과 주", value: `${kpi.overWeeks}주`, sub: limits ? `주 연장한도 ${hm(limits.weeklyOvertimeLimitMinutes)}` : null },
          {
            icon: Banknote,
            label: "전월 초과근무수당",
            value: hidePay ? "—" : kpi.prevPay != null ? `${Math.round(kpi.prevPay).toLocaleString("ko-KR")}원` : "—",
            sub: pay?.excluded
              ? `산정 제외 대상${testPay ? ` · test 표시 중 (${Number(prevMonthKey.slice(5, 7))}월분)` : ""}`
              : `${Number(prevMonthKey.slice(5, 7))}월분${pay?.hourlyWage == null ? " · 근로계약 미등록" : ""}`,
          },
        ].map((k) => (
          <div key={k.label} className="cd-card p-4 rounded-2xl">
            <div className="flex items-center gap-2 text-xs cd-text-muted mb-1.5">
              <k.icon className="w-3.5 h-3.5" /> {k.label}
            </div>
            <div className="text-lg font-extrabold cd-text tabular-nums">{loading && !data ? "…" : k.value}</div>
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

      {/* 1행: 추이 차트 2개(같은 너비) / 2행: 주별 근무·초과근무 + 주별 초과근무수당(같은 너비, 남은 높이 채움 — 메뉴 바 하단 정렬) */}
      <div className="flex flex-col gap-4 2xl:flex-1 2xl:min-h-0">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0 shrink-0">
          <div className="cd-card p-4 rounded-2xl min-w-0">
            <div className="cd-card-title mb-1">초과근무 추이 (최근 12개월)</div>
            {(data?.trend ?? []).length === 0 ? (
              <div className="text-sm cd-text-muted py-6 text-center">근태 기록이 없습니다.</div>
            ) : (
              <ApexChart key={`t-${theme}`} options={trendOptions} series={trendSeries} type="bar" height={190} />
            )}
          </div>
          <div className="cd-card p-4 rounded-2xl min-w-0">
            <div className="cd-card-title mb-1">초과근무수당 추이 (최근 12개월)</div>
            {hidePay ? (
              <div className="text-sm cd-text-muted py-6 text-center">초과근무수당 산정 제외 대상입니다.</div>
            ) : pay?.hourlyWage == null ? (
              <div className="text-sm cd-text-muted py-6 text-center">근로계약(임금)이 등록되지 않아 수당을 계산할 수 없습니다.</div>
            ) : (data?.trend ?? []).length === 0 ? (
              <div className="text-sm cd-text-muted py-6 text-center">근태 기록이 없습니다.</div>
            ) : (
              <ApexChart key={`p-${theme}`} options={payOptions} series={paySeries} type="bar" height={190} />
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0 2xl:flex-1 2xl:min-h-0">
          {/* 주별 근무·초과근무 — 카드는 남은 높이를 채우고 행 목록만 스크롤(스크롤바 숨김) */}
          <div className="cd-card p-4 rounded-2xl min-w-0 flex flex-col min-h-[220px]">
            <div className="cd-card-title mb-2 shrink-0">주별 근무 · 초과근무{month ? ` — ${year}년 ${Number(month.slice(5, 7))}월` : ""}</div>
            <div className="grid grid-cols-[1fr_0.9fr_0.9fr_0.9fr_1.2fr_0.9fr] gap-2 text-[11px] cd-text-faint px-1 pb-1 shrink-0">
              <span>주 시작일</span>
              <span className="text-right">실근무</span>
              <span className="text-right">연장(1.5배)</span>
              <span className="text-right">야간(2.0배)</span>
              <span>주 52h 게이지</span>
              <span className="text-right">12h 초과</span>
            </div>
            <div className="2xl:flex-1 2xl:min-h-0 2xl:overflow-y-auto scrollbar-hide">
            {(data?.weeks ?? []).map((w) => {
              const limit = limits?.weeklyLimitMinutes ?? 3120;
              const pct = Math.min(100, (w.workedMinutes / limit) * 100);
              const open = openWeek === w.weekStart;
              return (
                <div key={w.weekStart} className="border-t cd-hairline-row-c">
                  <button
                    type="button"
                    onClick={() => void toggleWeek(w.weekStart)}
                    className="w-full grid grid-cols-[1fr_0.9fr_0.9fr_0.9fr_1.2fr_0.9fr] gap-2 items-center px-1 py-2 text-[12.5px] cd-row-hover rounded-lg text-left"
                  >
                    <span className="tabular-nums cd-text font-medium">{w.weekStart} 주</span>
                    <span className="tabular-nums text-right cd-text">{hm(w.workedMinutes)}</span>
                    <span className="tabular-nums text-right cd-text-muted">{hm(w.overtimeDayMinutes)}</span>
                    <span className="tabular-nums text-right cd-text-muted">{hm(w.overtimeNightMinutes)}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--cd-hairline)" }}>
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${pct}%`, background: w.overLimit ? "var(--cd-error)" : "var(--cd-primary)" }}
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
                          <div key={d.workDate} className="grid grid-cols-[1.1fr_0.8fr_0.8fr_0.9fr_0.9fr_0.9fr] gap-2 text-[12px] py-1 border-t cd-hairline-row-c items-center">
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

          {/* 주별 초과근무수당 — 우상단에 시급·1.5배·2.0배 기준액 */}
          <div className="cd-card p-4 rounded-2xl min-w-0 flex flex-col min-h-[220px]">
            <div className="flex items-start justify-between gap-3 mb-2 flex-wrap shrink-0">
              <div className="cd-card-title flex items-center gap-1.5">
                주별 초과근무수당
                {pay?.excluded && pay.canTest && (
                  <button
                    type="button"
                    className="cd-chip cd-chip-sm"
                    data-active={testPay}
                    title="산정 제외자 수당 표시(관리자 test — 산정 기능 동작 확인용)"
                    onClick={() => setTestPay((v) => !v)}
                  >
                    test
                  </button>
                )}
                {pay?.excluded && <span className="cd-pill cd-pill-idle">산정 제외</span>}
              </div>
              <div className="text-[11px] cd-text-muted text-right leading-relaxed">
                {hidePay ? (
                  <span className="cd-text-faint">산정 제외 대상 — 수당을 표시하지 않습니다</span>
                ) : pay?.hourlyWage != null ? (
                  <>
                    <span className="mr-2">
                      시간당 임금 <b className="cd-text tabular-nums">{pay.hourlyWage.toLocaleString("ko-KR")}원</b>
                      <span className="cd-text-faint"> (통상임금 ÷ {pay.divisorHours}h)</span>
                    </span>
                    <span className="mr-2">
                      연장({pay.rateDay}배) <b className="cd-text tabular-nums">{Math.round(pay.hourlyWage * pay.rateDay).toLocaleString("ko-KR")}원</b>
                    </span>
                    <span>
                      야간({pay.rateNight}배) <b className="cd-text tabular-nums">{Math.round(pay.hourlyWage * pay.rateNight).toLocaleString("ko-KR")}원</b>
                    </span>
                  </>
                ) : (
                  <span className="cd-text-faint">근로계약(임금) 미등록 — 수당 계산 불가</span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-[1fr_0.9fr_0.9fr_1.1fr] gap-2 text-[11px] cd-text-faint px-1 pb-1 shrink-0">
              <span>주 시작일</span>
              <span className="text-right">연장(1.5배)</span>
              <span className="text-right">야간(2.0배)</span>
              <span className="text-right">발생 수당</span>
            </div>
            <div className="2xl:flex-1 2xl:min-h-0 2xl:overflow-y-auto scrollbar-hide">
            {(data?.weeks ?? []).map((w) => (
              <div key={w.weekStart} className="grid grid-cols-[1fr_0.9fr_0.9fr_1.1fr] gap-2 items-center px-1 py-1.5 text-[12.5px] border-t cd-hairline-row-c">
                <span className="tabular-nums cd-text">{w.weekStart} 주</span>
                <span className="tabular-nums text-right cd-text-muted">{hm(w.overtimeDayMinutes)}</span>
                <span className="tabular-nums text-right cd-text-muted">{hm(w.overtimeNightMinutes)}</span>
                <span className="tabular-nums text-right font-bold cd-text">
                  {!hidePay && w.estimatedPay != null ? `${Math.round(w.estimatedPay).toLocaleString("ko-KR")}원` : "—"}
                </span>
              </div>
            ))}
            {!loading && (data?.weeks ?? []).length === 0 && (
              <div className="text-sm cd-text-muted py-5 text-center">이 달의 근태 기록이 없습니다.</div>
            )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
