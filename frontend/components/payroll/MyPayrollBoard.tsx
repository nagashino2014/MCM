"use client";

// 내 급여명세서(/payroll/my, 전 직원) — 본인 명세서 수신 확인·미리보기·출력 + 월별/연도별 수령액.
// 급여대장(/payroll)은 관리자용 전 직원 화면이라 개인은 볼 수 없어 신설(2026-09-14 사용자 요청).
// 데이터: /api/payroll/my-statements?year= (확정 대장 본인 행) · /api/payroll/my-statements/summary?year=
// 열람 기록: 미리보기를 열면 /view 로 최초 열람 시각을 남긴다(발행분만 — 관리자 발송 모달 '열람' 열).
// 레이아웃(2026-09-15 디자인 리뷰 3a안): 3열 [KPI 2×2·월별 명세서·수령액 차트(월별/연도별 토글)] [A4 높이 맞춤 뷰어] [연도별 표·항목별 합계].
// 중앙 뷰어 열만 폭 고정(clamp 800~880px), 좌우가 남는 폭을 흡수. 열의 마지막 카드가 flex:1 로 높이를 채운다.
// 데이터·API·계산 로직은 변경 없음. 색은 리뷰 지정값을 쓰되 카드 면·보더는 cd 토큰(다크 모드 보호).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApexOptions } from "apexcharts";
import { Banknote, ChevronLeft, ChevronRight, MinusCircle, PiggyBank, Printer, ReceiptText, TrendingUp } from "lucide-react";
import ApexChart from "@/components/contracts/dashboard/ApexChart";
import { chartPalette } from "@/components/contracts/dashboard/types";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import "@/components/cdash/cdash.css";
import css from "./MyPayrollBoard.module.css";

interface PayslipRow {
  entryId: string;
  payYear: number;
  payMonth: number;
  ledgerKind: string;
  payTotal: number;
  deductionTotal: number;
  netPay: number;
  sentAt: string | null;
  viewedAt: string | null;
}

interface Summary {
  linked: boolean;
  years: number[];
  year: number | null;
  months: Array<{ month: number; payTotal: number; deductionTotal: number; netPay: number; ledgers: number }>;
  totals: { payTotal: number; deductionTotal: number; netPay: number; months: number };
  items: Array<{ itemId: string; name: string; kind: "pay" | "deduction"; amount: number }>;
  yearly: Array<{ year: number; payTotal: number; deductionTotal: number; netPay: number; months: number }>;
}

type ChartMode = "month" | "year";

const won = (v: number) => Math.round(v).toLocaleString("ko-KR");
const KIND_LABEL: Record<string, string> = { salary: "급여", bonus: "상여", intern: "인턴" };
const dt = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const CHART_MODE_KEY = "mcm.my-payroll.chart-mode";

/* 리뷰 지정 색(라이트 기준). 카드 면·보더·페이지 배경은 cd 토큰. */
const C = {
  label: "#6b7280",
  sub: "#9ca3af",
  ink: "#111827",
  body: "#374151",
  accent: "#2f5fe0",
  rowHover: "#f8f9fb",
  rowSelected: "#eef3ff",
  hairline: "#f1f3f5",
  track: "#f1f3f5",
  net: "#7b96ff",
  ded: "#8fd3ff",
  badgeBg: "#fef3c7",
  badgeFg: "#b45309",
};

export function MyPayrollBoard() {
  const { theme } = useCdashTheme();
  const pal = chartPalette(theme);
  const [year, setYear] = useState<number | null>(null);
  const [rows, setRows] = useState<PayslipRow[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [linked, setLinked] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PayslipRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("month");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const chartBoxRef = useRef<HTMLDivElement>(null);
  const [chartBox, setChartBox] = useState({ w: 0, h: 0 });

  // 차트 모드 — 로컬 저장(선택)
  useEffect(() => {
    try {
      const v = localStorage.getItem(CHART_MODE_KEY);
      if (v === "month" || v === "year") setChartMode(v);
    } catch {
      /* noop */
    }
  }, []);
  const changeMode = (m: ChartMode) => {
    setChartMode(m);
    try {
      localStorage.setItem(CHART_MODE_KEY, m);
    } catch {
      /* noop */
    }
  };

  // 차트 컨테이너 크기 — 카드의 남는 높이를 채우고 막대 폭 상한(56px)을 % 로 환산하기 위해 측정
  useEffect(() => {
    const el = chartBoxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setChartBox({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const load = useCallback(async (y: number | null) => {
    setLoading(true);
    setError(null);
    try {
      const q = y ? `?year=${y}` : "";
      const [a, b] = await Promise.all([
        fetch(`/api/payroll/my-statements${q}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/payroll/my-statements/summary${q}`, { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (a.error) throw new Error(String(a.error));
      setLinked(a.linked !== false);
      setYears(a.years ?? []);
      const list: PayslipRow[] = a.rows ?? [];
      setRows(list);
      setSummary(b.error ? null : b);
      if (!y && a.years?.length) setYear(Number(a.years[0]));
      setSelected((prev) => (prev && list.some((r) => r.entryId === prev.entryId) ? prev : list[0] ?? null));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(year);
  }, [year, load]);

  const open = useCallback(async (r: PayslipRow) => {
    setSelected(r);
    if (r.sentAt && !r.viewedAt) {
      try {
        const res = await fetch(`/api/payroll/my-statements/${r.entryId}/view`, { method: "POST" });
        const d = await res.json();
        if (res.ok && d.viewedAt) {
          setRows((prev) => prev.map((x) => (x.entryId === r.entryId ? { ...x, viewedAt: String(d.viewedAt) } : x)));
        }
      } catch {
        // 열람 기록 실패는 미리보기를 막지 않는다
      }
    }
  }, []);

  // 최초 로드 시 첫 행(최신 월)을 자동 선택했으면 열람 기록도 남긴다
  useEffect(() => {
    if (selected && selected.sentAt && !selected.viewedAt) void open(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.entryId]);

  const print = () => {
    const w = frameRef.current?.contentWindow;
    if (!w) return;
    try {
      w.focus();
      w.print();
    } catch {
      if (selected) window.open(`/api/payroll/my-statements/${selected.entryId}/file`, "_blank", "noopener");
    }
  };

  /** 목록은 최신순 — 이전 월은 한 칸 아래(더 과거), 다음 월은 한 칸 위. 버튼 라벨은 그 행의 월(연도가 다르면 연도 포함). */
  const [prevRow, nextRow] = useMemo(() => {
    if (!selected) return [null, null] as const;
    const i = rows.findIndex((r) => r.entryId === selected.entryId);
    if (i < 0) return [null, null] as const;
    return [i + 1 < rows.length ? rows[i + 1] : null, i > 0 ? rows[i - 1] : null] as const;
  }, [rows, selected]);
  const monthLabel = (r: PayslipRow) =>
    `${selected && r.payYear !== selected.payYear ? `${r.payYear}년 ` : ""}${r.payMonth}월${r.ledgerKind !== "salary" ? ` ${KIND_LABEL[r.ledgerKind] ?? ""}` : ""}`;

  // ── 차트: 월별(실지급+공제 누적) / 연도별(최근 10년, 선택 연도 강조) ──
  const thisYear = new Date().getFullYear();
  const yearlyCats = useMemo(() => Array.from({ length: 10 }, (_, i) => thisYear - 9 + i), [thisYear]);
  const barPct = (n: number) => {
    // 카테고리 1칸 폭 대비 56px 상한 → % (측정 전엔 52%)
    if (!chartBox.w) return "52%";
    const slot = Math.max(1, (chartBox.w - 48) / n);
    return `${Math.max(18, Math.min(60, Math.round((56 / slot) * 100)))}%`;
  };
  const chartHeight = Math.max(200, chartBox.h - 28); // 범례 자리
  const baseOptions = (cats: string[], colors: string[], stacked: boolean, n: number): ApexOptions => ({
    chart: { type: "bar", stacked, toolbar: { show: false }, fontFamily: "inherit", animations: { enabled: false }, parentHeightOffset: 0 },
    plotOptions: { bar: { columnWidth: barPct(n), borderRadius: 4, borderRadiusApplication: "end" } },
    colors,
    dataLabels: { enabled: false },
    grid: { borderColor: pal.grid, strokeDashArray: 3 },
    xaxis: { categories: cats, labels: { style: { colors: pal.muted } }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { style: { colors: pal.muted }, formatter: (v: number) => `${Math.round(v / 10000).toLocaleString("ko-KR")}만` } },
    legend: { position: "bottom", horizontalAlign: "center", labels: { colors: pal.muted }, markers: { size: 5 } },
    tooltip: { y: { formatter: (v: number) => `${won(v)}원` } },
  });
  const monthOptions = useMemo(
    () => baseOptions(Array.from({ length: 12 }, (_, i) => `${i + 1}월`), [C.net, C.ded], true, 12),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pal, chartBox.w]
  );
  const monthSeries = useMemo(
    () => [
      { name: "실지급액", data: (summary?.months ?? []).map((m) => m.netPay) },
      { name: "공제액", data: (summary?.months ?? []).map((m) => m.deductionTotal) },
    ],
    [summary]
  );
  const yearOptions = useMemo(
    () => baseOptions(yearlyCats.map(String), [C.accent, C.net], true, 10),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pal, chartBox.w, yearlyCats]
  );
  const yearSeries = useMemo(() => {
    const by = new Map((summary?.yearly ?? []).map((y) => [y.year, y.netPay]));
    return [
      { name: "올해(진행 중)", data: yearlyCats.map((y) => (y === year ? by.get(y) ?? 0 : 0)) },
      { name: "실지급 합계", data: yearlyCats.map((y) => (y === year ? 0 : by.get(y) ?? 0)) },
    ];
  }, [summary, yearlyCats, year]);

  const t = summary?.totals;
  const avg = t && t.months ? t.netPay / t.months : 0;
  const payItems = (summary?.items ?? []).filter((i) => i.kind === "pay");
  const dedItems = (summary?.items ?? []).filter((i) => i.kind === "deduction");

  return (
    <div className={`cdash cd-fields-white flex h-full min-h-0 flex-col rounded-3xl ${css.page}`} data-theme={theme}>
      <CdPageHeader
        title="내 급여명세서"
        actions={
          <select className="cd-select" value={year ?? ""} onChange={(e) => { setYear(Number(e.target.value) || null); setSelected(null); }} aria-label="연도">
            {years.length === 0 && <option value="">연도</option>}
            {years.map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
        }
      />

      {!linked ? (
        <div className="cd-card p-6 rounded-lg text-sm cd-text-muted">계정에 직원 정보가 연결되어 있지 않아 급여명세서를 조회할 수 없습니다. 관리자에게 문의하세요.</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {error && <div className="cd-error-text text-sm mb-3">{error}</div>}

          <div className={css.grid}>
            {/* ── 좌 열: KPI 2×2 → 월별 명세서 → 수령액 차트(flex:1) ── */}
            <div className={`${css.col} ${css.colLeft}`}>
              <div className={`grid grid-cols-2 gap-4 ${css.kpiCard}`}>
                <Kpi icon={<Banknote className="w-4 h-4" />} label={`${year ?? ""}년 지급 합계`} value={t ? `${won(t.payTotal)}원` : "—"} sub={t ? `${t.months}개월 확정` : ""} />
                <Kpi icon={<MinusCircle className="w-4 h-4" />} label="공제 합계" value={t ? `${won(t.deductionTotal)}원` : "—"} sub="4대보험·세금 등" />
                <Kpi icon={<PiggyBank className="w-4 h-4" />} label="실지급 합계" value={t ? `${won(t.netPay)}원` : "—"} sub="계좌 입금 기준" strong />
                <Kpi icon={<TrendingUp className="w-4 h-4" />} label="월평균 실지급" value={t && t.months ? `${won(avg)}원` : "—"} sub={t ? `${t.months}개월 평균` : ""} />
              </div>

              <Card className={css.monthlyCard} title="월별 명세서" subtitle="행을 누르면 뷰어가 바뀝니다" icon={<ReceiptText className="w-4 h-4" />}>
                <div className="overflow-x-auto">
                  <table className="w-full" style={{ fontSize: 14, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ fontSize: 12, color: C.label }}>
                        <th className="text-left font-semibold py-2 pl-3 pr-2 whitespace-nowrap">귀속월</th>
                        <th className="text-right font-semibold py-2 px-2 whitespace-nowrap">지급</th>
                        <th className="text-right font-semibold py-2 px-2 whitespace-nowrap">공제</th>
                        <th className="text-right font-semibold py-2 px-2 whitespace-nowrap">실지급</th>
                        <th className="text-left font-semibold py-2 px-2 whitespace-nowrap">수신 확인</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const active = selected?.entryId === r.entryId;
                        return (
                          <tr
                            key={r.entryId}
                            className="cursor-pointer"
                            style={{
                              height: 46,
                              borderTop: `1px solid ${C.hairline}`,
                              background: active ? C.rowSelected : undefined,
                              boxShadow: active ? `inset 3px 0 0 ${C.accent}` : undefined,
                            }}
                            onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = C.rowHover; }}
                            onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = ""; }}
                            onClick={() => void open(r)}
                          >
                            <td className="pl-3 pr-2 font-semibold whitespace-nowrap" style={{ color: C.ink }}>
                              {r.payMonth}월{r.ledgerKind !== "salary" ? <span className="cd-pill cd-pill-info ml-1.5">{KIND_LABEL[r.ledgerKind] ?? r.ledgerKind}</span> : null}
                            </td>
                            <td className="px-2 text-right tabular-nums" style={{ color: C.body }}>{won(r.payTotal)}</td>
                            <td className="px-2 text-right tabular-nums" style={{ color: C.label }}>{won(r.deductionTotal)}</td>
                            <td className="px-2 text-right tabular-nums font-bold" style={{ color: C.ink }}>{won(r.netPay)}</td>
                            <td className="px-2 whitespace-nowrap" style={{ fontSize: 12 }}>
                              {r.viewedAt ? (
                                <span style={{ color: "var(--cd-success)" }} title={`발행 ${dt(r.sentAt)}`}>열람 {dt(r.viewedAt)}</span>
                              ) : r.sentAt ? (
                                <span style={{ color: "var(--cd-warning)" }} title={`발행 ${dt(r.sentAt)}`}>발행됨 · 미열람</span>
                              ) : (
                                <span style={{ color: C.sub }}>발행 대기</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!loading && rows.length === 0 && (
                    <p className="p-6 text-center text-sm" style={{ color: C.sub }}>{year ? `${year}년 확정된 급여명세서가 없습니다.` : "확정된 급여명세서가 없습니다."}</p>
                  )}
                </div>
                <div className="mt-2 pt-2" style={{ fontSize: 12, color: C.sub, borderTop: `1px solid ${C.hairline}` }}>
                  확정된 대장 기준 · 발행 후 열람하면 수신 확인이 남습니다
                </div>
              </Card>

              {/* 수령액 차트 — 월별/연도별 토글, 카드가 열의 남는 높이를 채운다 */}
              <Card
                className={`${css.grow} ${css.chartCard}`}
                bodyClassName="flex-1 min-h-0 flex flex-col"
                title={chartMode === "month" ? `${year ?? ""}년 월별 수령액` : "연도별 수령액 추이"}
                subtitle={chartMode === "month" ? "실지급액과 공제액을 쌓아 지급 총액을 보여줍니다" : `${yearlyCats[0]}년 ~ ${thisYear}년 실지급 합계(확정 대장 기준)`}
                right={
                  <div className="flex" style={{ background: C.track, borderRadius: 8, padding: 3 }} role="tablist" aria-label="차트 종류">
                    {([["month", "월별"], ["year", "연도별"]] as const).map(([k, label]) => {
                      const on = chartMode === k;
                      return (
                        <button
                          key={k}
                          type="button"
                          role="tab"
                          aria-selected={on}
                          onClick={() => changeMode(k)}
                          style={{
                            fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 6, lineHeight: 1.2,
                            background: on ? C.ink : "transparent", color: on ? "#fff" : C.label,
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                }
              >
                <div ref={chartBoxRef} className="flex-1 min-h-[200px] min-w-0">
                  {summary && summary.year ? (
                    chartMode === "month" ? (
                      <ApexChart key={`m-${theme}-${summary.year}-${chartBox.w}`} options={monthOptions} series={monthSeries} type="bar" height={chartHeight} />
                    ) : (
                      <ApexChart key={`y-${theme}-${year}-${chartBox.w}`} options={yearOptions} series={yearSeries} type="bar" height={chartHeight} />
                    )
                  ) : (
                    <div className="h-full min-h-[200px] flex items-center justify-center text-sm" style={{ color: C.sub }}>집계할 확정 대장이 없습니다.</div>
                  )}
                </div>
              </Card>
            </div>

            {/* ── 중앙 열: 급여명세서 뷰어(A4 높이 맞춤) ── */}
            <div className={`cd-card rounded-lg ${css.viewerCard}`} style={{ padding: "18px 20px" }}>
              <div className="flex items-center gap-2 mb-3 flex-wrap shrink-0">
                <div className="min-w-0 flex items-center gap-2">
                  <span className="font-bold truncate" style={{ fontSize: 16, color: C.ink }}>
                    {selected ? `${selected.payYear}년 ${selected.payMonth}월분 ${selected.ledgerKind !== "salary" ? (KIND_LABEL[selected.ledgerKind] ?? "") : ""}급여명세서` : "급여명세서 뷰어"}
                  </span>
                  {selected && (
                    <span
                      className="rounded-full px-2 py-0.5 whitespace-nowrap"
                      style={{
                        fontSize: 11, fontWeight: 700,
                        background: selected.viewedAt ? "var(--cd-success-soft, #dcfce7)" : C.badgeBg,
                        color: selected.viewedAt ? "var(--cd-success)" : C.badgeFg,
                      }}
                    >
                      {selected.viewedAt ? `열람 ${dt(selected.viewedAt)}` : selected.sentAt ? "발행됨 · 미열람" : "발행 대기"}
                    </span>
                  )}
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  {/* 이전/다음 월 — 라벨은 이동할 행의 월(예: 6월 선택 시 "5월" / "7월"). 없으면 버튼을 숨긴다. */}
                  {prevRow && (
                    <button type="button" className="cd-btn rounded-lg px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1" title="이전 월 명세서" onClick={() => void open(prevRow)}>
                      <ChevronLeft className="w-3.5 h-3.5" /> {monthLabel(prevRow)}
                    </button>
                  )}
                  {nextRow && (
                    <button type="button" className="cd-btn rounded-lg px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1" title="다음 월 명세서" onClick={() => void open(nextRow)}>
                      {monthLabel(nextRow)} <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button type="button" className="cd-btn rounded-lg px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-40" disabled={!selected} onClick={print}>
                    <Printer className="w-3.5 h-3.5" /> 출력
                  </button>
                </div>
              </div>
              <div className={css.viewerBody}>
                <div className={css.viewerInner}>
                  {selected ? (
                    <div className={css.page4}>
                      <iframe
                        ref={frameRef}
                        key={selected.entryId}
                        title="급여명세서 미리보기"
                        src={`/api/payroll/my-statements/${selected.entryId}/file#toolbar=0&navpanes=0&scrollbar=0&view=Fit`}
                      />
                    </div>
                  ) : (
                    <div className="text-sm text-center px-6" style={{ color: C.sub }}>왼쪽 목록에서 월을 선택하면 명세서가 여기에 표시됩니다.</div>
                  )}
                </div>
              </div>
            </div>

            {/* ── 우 열: 연도별 수령액 표 → 항목별 합계(flex:1) ── */}
            <div className={`${css.col} ${css.colRight}`}>
              <Card className={css.yearlyCard} title="연도별 수령액">
                <table className="w-full" style={{ fontSize: 14, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ fontSize: 12, color: C.label }}>
                      <th className="text-left font-semibold py-1.5 pl-2 pr-1">연도</th>
                      <th className="text-right font-semibold py-1.5 px-1">지급</th>
                      <th className="text-right font-semibold py-1.5 px-1">공제</th>
                      <th className="text-right font-semibold py-1.5 px-1">실지급</th>
                      <th className="text-right font-semibold py-1.5 px-1 whitespace-nowrap">월평균</th>
                      <th className="text-right font-semibold py-1.5 pl-1 pr-2">개월</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(summary?.yearly ?? []).map((y) => {
                      const cur = y.year === year;
                      return (
                        <tr
                          key={y.year}
                          className="cursor-pointer"
                          style={{ height: 40, borderTop: `1px solid ${C.hairline}`, background: cur ? C.rowSelected : undefined }}
                          onClick={() => { setYear(y.year); setSelected(null); }}
                        >
                          <td className="pl-2 pr-1 tabular-nums" style={{ color: C.ink, fontWeight: cur ? 700 : 500 }}>{y.year}</td>
                          <td className="px-1 text-right tabular-nums" style={{ color: C.body }}>{won(y.payTotal)}</td>
                          <td className="px-1 text-right tabular-nums" style={{ color: C.label }}>{won(y.deductionTotal)}</td>
                          <td className="px-1 text-right tabular-nums font-bold" style={{ color: C.ink }}>{won(y.netPay)}</td>
                          <td className="px-1 text-right tabular-nums" style={{ color: C.body }}>{y.months ? won(y.netPay / y.months) : "—"}</td>
                          <td className="pl-1 pr-2 text-right tabular-nums" style={{ color: C.label }}>{y.months}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!(summary?.yearly ?? []).length && <p className="p-3 text-center text-sm" style={{ color: C.sub }}>집계할 연도가 없습니다.</p>}
              </Card>

              <Card className={`${css.grow} ${css.itemsCard}`} title={`${year ?? ""}년 항목별 합계`}>
                <div className="grid grid-cols-2" style={{ gap: 24 }}>
                  <ItemList title="지급" items={payItems} />
                  <ItemList title="공제" items={dedItems} />
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({
  title, subtitle, icon, right, className, bodyClassName, children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`cd-card rounded-lg flex flex-col min-w-0 ${className ?? ""}`} style={{ padding: "18px 20px" }}>
      <div className="flex items-start gap-2 mb-3 shrink-0">
        {icon && <span className="cd-title-icon shrink-0">{icon}</span>}
        <div className="min-w-0">
          <div className="font-bold leading-tight" style={{ fontSize: 16, color: C.ink }}>{title}</div>
          {subtitle && <div className="mt-0.5" style={{ fontSize: 12, color: C.sub }}>{subtitle}</div>}
        </div>
        {right && <div className="ml-auto shrink-0">{right}</div>}
      </div>
      <div className={bodyClassName ?? ""}>{children}</div>
    </div>
  );
}

function Kpi({ icon, label, value, sub, strong }: { icon: React.ReactNode; label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className="cd-card rounded-lg flex items-start gap-3 min-w-0" style={{ padding: "16px 18px" }}>
      <span className="cd-title-icon shrink-0">{icon}</span>
      <div className="min-w-0">
        <div style={{ fontSize: 13, color: C.label }}>{label}</div>
        <div className="font-bold tabular-nums truncate" style={{ fontSize: 24, letterSpacing: "-0.02em", color: strong ? C.accent : C.ink }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: C.sub }}>{sub}</div>}
      </div>
    </div>
  );
}

function ItemList({ title, items }: { title: string; items: Array<{ itemId: string; name: string; amount: number }> }) {
  const total = items.reduce((a, i) => a + i.amount, 0);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between pb-2 mb-1" style={{ borderBottom: `2px solid ${C.ink}` }}>
        <span className="font-bold" style={{ fontSize: 14, color: C.ink }}>{title}</span>
        <span className="font-bold tabular-nums" style={{ fontSize: 20, color: C.ink }}>{won(total)}</span>
      </div>
      {items.map((i) => (
        <div key={i.itemId} className="flex items-center justify-between gap-2" style={{ fontSize: 14, padding: "9px 0", borderBottom: `1px solid ${C.hairline}` }}>
          <span className="truncate" style={{ color: C.body }}>{i.name}</span>
          <span className="tabular-nums whitespace-nowrap" style={{ color: C.ink }}>{won(i.amount)}</span>
        </div>
      ))}
      {!items.length && <div className="py-2" style={{ fontSize: 13, color: C.sub }}>없음</div>}
    </div>
  );
}
