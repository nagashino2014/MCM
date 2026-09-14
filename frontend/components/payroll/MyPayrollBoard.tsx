"use client";

// 내 급여명세서(/payroll/my, 전 직원) — 본인 명세서 수신 확인·미리보기·출력 + 월별/연도별 수령액.
// 급여대장(/payroll)은 관리자용 전 직원 화면이라 개인은 볼 수 없어 신설(2026-09-14 사용자 요청).
// 데이터: /api/payroll/my-statements?year= (확정 대장 본인 행) · /api/payroll/my-statements/summary?year=
// 열람 기록: 미리보기를 열면 /view 로 최초 열람 시각을 남긴다(발행분만 — 관리자 발송 모달 '열람' 열).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApexOptions } from "apexcharts";
import { Banknote, ExternalLink, Eye, MinusCircle, PiggyBank, Printer, ReceiptText, TrendingUp } from "lucide-react";
import ApexChart from "@/components/contracts/dashboard/ApexChart";
import { chartPalette } from "@/components/contracts/dashboard/types";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import "@/components/cdash/cdash.css";

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

const won = (v: number) => Math.round(v).toLocaleString("ko-KR");
const KIND_LABEL: Record<string, string> = { salary: "급여", bonus: "상여", intern: "인턴" };
const dt = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

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
  const frameRef = useRef<HTMLIFrameElement>(null);

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
      setSelected((prev) => (prev && list.some((r) => r.entryId === prev.entryId) ? prev : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(year);
  }, [year, load]);

  const open = async (r: PayslipRow) => {
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
  };

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

  // ── 월별 수령액 차트(실지급 + 공제 누적 = 지급 총액) ──
  const chartOptions = useMemo<ApexOptions>(
    () => ({
      chart: { type: "bar", stacked: true, toolbar: { show: false }, fontFamily: "inherit", animations: { enabled: false }, parentHeightOffset: 0 },
      plotOptions: { bar: { columnWidth: "52%", borderRadius: 4, borderRadiusApplication: "end" } },
      colors: [pal.primary, pal.secondary],
      dataLabels: { enabled: false },
      grid: { borderColor: pal.grid, strokeDashArray: 3 },
      xaxis: { categories: Array.from({ length: 12 }, (_, i) => `${i + 1}월`), labels: { style: { colors: pal.muted } }, axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { labels: { style: { colors: pal.muted }, formatter: (v: number) => `${Math.round(v / 10000)}만` } },
      legend: { labels: { colors: pal.muted } },
      tooltip: { y: { formatter: (v: number) => `${won(v)}원` } },
    }),
    [pal]
  );
  const chartSeries = useMemo(
    () => [
      { name: "실지급액", data: (summary?.months ?? []).map((m) => m.netPay) },
      { name: "공제액", data: (summary?.months ?? []).map((m) => m.deductionTotal) },
    ],
    [summary]
  );

  // ── 연도별 수령액 추이(현재 연도 기준 9년 전까지 10개년, 확정 대장 실지급 합계) ──
  const thisYear = new Date().getFullYear();
  const yearlyCats = useMemo(() => Array.from({ length: 10 }, (_, i) => thisYear - 9 + i), [thisYear]);
  const yearlyOptions = useMemo<ApexOptions>(
    () => ({
      chart: { type: "bar", toolbar: { show: false }, fontFamily: "inherit", animations: { enabled: false }, parentHeightOffset: 0 },
      plotOptions: { bar: { columnWidth: "48%", borderRadius: 4, borderRadiusApplication: "end" } },
      colors: [pal.primary],
      dataLabels: { enabled: false },
      grid: { borderColor: pal.grid, strokeDashArray: 3 },
      xaxis: { categories: yearlyCats.map(String), labels: { style: { colors: pal.muted } }, axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { labels: { style: { colors: pal.muted }, formatter: (v: number) => `${Math.round(v / 10000).toLocaleString("ko-KR")}만` } },
      legend: { show: false },
      tooltip: { y: { formatter: (v: number) => `${won(v)}원` } },
    }),
    [pal, yearlyCats]
  );
  const yearlySeries = useMemo(() => {
    const by = new Map((summary?.yearly ?? []).map((y) => [y.year, y.netPay]));
    return [{ name: "실지급 합계", data: yearlyCats.map((y) => by.get(y) ?? 0) }];
  }, [summary, yearlyCats]);

  const t = summary?.totals;
  const avg = t && t.months ? t.netPay / t.months : 0;
  const payItems = (summary?.items ?? []).filter((i) => i.kind === "pay");
  const dedItems = (summary?.items ?? []).filter((i) => i.kind === "deduction");

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col p-4 md:p-5 rounded-3xl" data-theme={theme}>
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
        <div className="cd-card p-6 rounded-2xl text-sm cd-text-muted">계정에 직원 정보가 연결되어 있지 않아 급여명세서를 조회할 수 없습니다. 관리자에게 문의하세요.</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4">
          {error && <div className="cd-error-text text-sm">{error}</div>}

          {/* KPI — 연간 지급·공제·실지급·월평균 */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <Kpi icon={<Banknote className="w-4 h-4" />} label={`${year ?? ""}년 지급 합계`} value={t ? `${won(t.payTotal)}원` : "—"} sub={t ? `${t.months}개월 확정` : ""} />
            <Kpi icon={<MinusCircle className="w-4 h-4" />} label="공제 합계" value={t ? `${won(t.deductionTotal)}원` : "—"} sub="4대보험·세금 등" />
            <Kpi icon={<PiggyBank className="w-4 h-4" />} label="실지급 합계" value={t ? `${won(t.netPay)}원` : "—"} sub="계좌 입금 기준" strong />
            <Kpi icon={<TrendingUp className="w-4 h-4" />} label="월평균 실지급" value={t && t.months ? `${won(avg)}원` : "—"} sub={t ? `${t.months}개월 평균` : ""} />
          </div>

          <div className="grid grid-cols-1 2xl:grid-cols-5 gap-4">
            {/* 좌 — 명세서 목록 + (아래 여백) 연도별 수령액 추이 */}
            <div className="2xl:col-span-2 min-w-0 flex flex-col gap-4">
            <div className="cd-card p-4 rounded-2xl min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="cd-title-icon"><ReceiptText className="w-4 h-4" /></span>
                <div className="cd-card-title">월별 명세서</div>
                <span className="ml-auto text-[11px] cd-text-faint">확정된 대장 기준 · 발행 후 열람하면 수신 확인이 남습니다</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="cd-table-head">
                    <tr className="cd-text-faint text-[11px] border-b cd-border-c">
                      <th className="text-left font-semibold p-2 whitespace-nowrap">귀속월</th>
                      <th className="text-right font-semibold p-2 whitespace-nowrap">지급</th>
                      <th className="text-right font-semibold p-2 whitespace-nowrap">공제</th>
                      <th className="text-right font-semibold p-2 whitespace-nowrap">실지급</th>
                      <th className="text-left font-semibold p-2 whitespace-nowrap">수신 확인</th>
                      <th className="p-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const active = selected?.entryId === r.entryId;
                      return (
                        <tr
                          key={r.entryId}
                          className="border-b cd-border-c last:border-0 cursor-pointer cd-row-hover"
                          style={active ? { background: "var(--cd-primary-soft)" } : undefined}
                          onClick={() => void open(r)}
                        >
                          <td className="p-2 cd-text font-semibold whitespace-nowrap">
                            {r.payMonth}월{r.ledgerKind !== "salary" ? <span className="cd-pill cd-pill-info ml-1.5">{KIND_LABEL[r.ledgerKind] ?? r.ledgerKind}</span> : null}
                          </td>
                          <td className="p-2 text-right tabular-nums cd-text">{won(r.payTotal)}</td>
                          <td className="p-2 text-right tabular-nums cd-text-muted">{won(r.deductionTotal)}</td>
                          <td className="p-2 text-right tabular-nums cd-text font-semibold">{won(r.netPay)}</td>
                          <td className="p-2 whitespace-nowrap text-xs">
                            {r.viewedAt ? (
                              <span style={{ color: "var(--cd-success)" }} title={`발행 ${dt(r.sentAt)}`}>열람 {dt(r.viewedAt)}</span>
                            ) : r.sentAt ? (
                              <span style={{ color: "var(--cd-warning)" }} title={`발행 ${dt(r.sentAt)}`}>발행됨 · 미열람</span>
                            ) : (
                              <span className="cd-text-faint">발행 대기</span>
                            )}
                          </td>
                          <td className="p-2 text-right whitespace-nowrap">
                            <button type="button" className="cd-btn rounded-lg px-2 py-1 text-[11px] font-bold inline-flex items-center gap-1" onClick={(e) => { e.stopPropagation(); void open(r); }}>
                              <Eye className="w-3 h-3" /> 보기
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!loading && rows.length === 0 && (
                  <p className="p-6 text-center text-sm cd-text-faint">{year ? `${year}년 확정된 급여명세서가 없습니다.` : "확정된 급여명세서가 없습니다."}</p>
                )}
              </div>
            </div>
            <div className="cd-card p-4 rounded-2xl min-w-0 flex-1 flex flex-col">
              <div className="cd-card-title mb-1">연도별 수령액 추이</div>
              <div className="text-[11px] cd-text-faint mb-1">{yearlyCats[0]}년 ~ {thisYear}년 실지급 합계(확정 대장 기준)</div>
              <div className="flex-1 min-h-[220px]">
                <ApexChart key={`yearly-${theme}`} options={yearlyOptions} series={yearlySeries} type="bar" height={230} />
              </div>
            </div>
            </div>

            {/* 우 — 미리보기 + 출력 */}
            <div className="2xl:col-span-3 cd-card p-4 rounded-2xl min-w-0 flex flex-col">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <div className="cd-card-title">
                  {selected ? `${selected.payYear}년 ${selected.payMonth}월분 ${KIND_LABEL[selected.ledgerKind] ?? ""}명세서` : "명세서 미리보기"}
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <button type="button" className="cd-btn rounded-xl px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-40" disabled={!selected} onClick={print}>
                    <Printer className="w-3.5 h-3.5" /> 출력
                  </button>
                  <a
                    className={`cd-btn cd-action rounded-xl px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1 ${selected ? "" : "pointer-events-none opacity-40"}`}
                    href={selected ? `/api/payroll/my-statements/${selected.entryId}/file` : "#"}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> 새 창 · PDF 저장
                  </a>
                </div>
              </div>
              <div className="flex-1 min-h-[520px] rounded-xl border cd-border-c overflow-hidden" style={{ background: "var(--cd-surface)" }}>
                {selected ? (
                  <iframe
                    ref={frameRef}
                    key={selected.entryId}
                    title="급여명세서 미리보기"
                    src={`/api/payroll/my-statements/${selected.entryId}/file#toolbar=0`}
                    className="w-full h-full min-h-[520px]"
                  />
                ) : (
                  <div className="h-full min-h-[520px] flex items-center justify-center text-sm cd-text-faint">왼쪽 목록에서 월을 선택하면 명세서가 여기에 표시됩니다.</div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 2xl:grid-cols-5 gap-4">
            {/* 월별 수령액 추이 */}
            <div className="2xl:col-span-3 cd-card p-4 rounded-2xl min-w-0">
              <div className="cd-card-title mb-1">{year ?? ""}년 월별 수령액</div>
              <div className="text-[11px] cd-text-faint mb-2">실지급액과 공제액을 쌓아 지급 총액을 보여줍니다(같은 달 상여대장 포함).</div>
              {summary && summary.year ? (
                <ApexChart key={`pay-${theme}-${summary.year}`} options={chartOptions} series={chartSeries} type="bar" height={230} />
              ) : (
                <div className="h-[230px] flex items-center justify-center text-sm cd-text-faint">집계할 확정 대장이 없습니다.</div>
              )}
            </div>

            {/* 항목별 연간 합계 + 연도별 비교 */}
            <div className="2xl:col-span-2 flex flex-col gap-4 min-w-0">
              <div className="cd-card p-4 rounded-2xl">
                <div className="cd-card-title mb-2">{year ?? ""}년 항목별 합계</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 text-xs">
                  <ItemList title="지급" items={payItems} />
                  <ItemList title="공제" items={dedItems} muted />
                </div>
              </div>
              <div className="cd-card p-4 rounded-2xl">
                <div className="cd-card-title mb-2">연도별 수령액</div>
                <table className="w-full text-xs">
                  <thead className="cd-table-head">
                    <tr className="cd-text-faint border-b cd-border-c">
                      <th className="text-left font-semibold p-1.5">연도</th>
                      <th className="text-right font-semibold p-1.5">지급</th>
                      <th className="text-right font-semibold p-1.5">공제</th>
                      <th className="text-right font-semibold p-1.5">실지급</th>
                      <th className="text-right font-semibold p-1.5">개월</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(summary?.yearly ?? []).map((y) => (
                      <tr key={y.year} className="border-b cd-border-c last:border-0 cursor-pointer cd-row-hover" style={y.year === year ? { fontWeight: 700 } : undefined} onClick={() => { setYear(y.year); setSelected(null); }}>
                        <td className="p-1.5 cd-text">{y.year}</td>
                        <td className="p-1.5 text-right tabular-nums cd-text">{won(y.payTotal)}</td>
                        <td className="p-1.5 text-right tabular-nums cd-text-muted">{won(y.deductionTotal)}</td>
                        <td className="p-1.5 text-right tabular-nums cd-text">{won(y.netPay)}</td>
                        <td className="p-1.5 text-right tabular-nums cd-text-faint">{y.months}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!(summary?.yearly ?? []).length && <p className="p-3 text-center text-xs cd-text-faint">집계할 연도가 없습니다.</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ icon, label, value, sub, strong }: { icon: React.ReactNode; label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className="cd-card p-3.5 rounded-2xl flex items-start gap-3 min-w-0">
      <span className="cd-title-icon shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] cd-text-faint">{label}</div>
        <div className={`text-lg font-extrabold tabular-nums truncate ${strong ? "" : "cd-text"}`} style={strong ? { color: "var(--cd-primary)" } : undefined}>{value}</div>
        {sub && <div className="text-[10.5px] cd-text-faint">{sub}</div>}
      </div>
    </div>
  );
}

function ItemList({ title, items, muted }: { title: string; items: Array<{ itemId: string; name: string; amount: number }>; muted?: boolean }) {
  const total = items.reduce((a, i) => a + i.amount, 0);
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between border-b cd-border-c pb-1 mb-1 font-bold cd-text">
        <span>{title}</span>
        <span className="tabular-nums">{won(total)}</span>
      </div>
      {items.map((i) => (
        <div key={i.itemId} className="flex items-center justify-between gap-2 py-0.5">
          <span className={`truncate ${muted ? "cd-text-muted" : "cd-text"}`}>{i.name}</span>
          <span className="tabular-nums cd-text whitespace-nowrap">{won(i.amount)}</span>
        </div>
      ))}
      {!items.length && <div className="py-1 cd-text-faint">없음</div>}
    </div>
  );
}
