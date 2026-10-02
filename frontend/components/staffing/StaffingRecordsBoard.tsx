"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApexOptions } from "apexcharts";
import { Banknote, CalendarRange, Download, Gauge, ListChecks, Percent, Trophy } from "lucide-react";
import { CdBadge } from "@/components/cdash/CdBadge";
import { CdButton } from "@/components/cdash/CdButton";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdTabs } from "@/components/cdash/CdTabs";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import type { OrganizationEmployeeRow, OrganizationSnapshot } from "@/components/admin/users/types";
import ApexChart from "@/components/contracts/dashboard/ApexChart";
import { chartPalette, softCategoryColor } from "@/components/contracts/dashboard/types";
import type { RecordBundleInclude, RecordBundlePackaging, RecordBundleSummary } from "@/lib/staffing/record-bundle";
import type { RecordCategory, StaffRecordDetail, StaffRecordRow } from "@/lib/staffing/records";

/**
 * 수행인력 실적 — 인력별 수행 용역 이력·KPI·증빙 일괄 출력.
 * - 좌: 공용 조직도 트리뷰(열람 범위만큼만 내려온다 — 부서장은 소속 부서)
 * - 우: 인적 요약 → KPI → [담당 계약 리스트(체크)] | [차트 카드(막대 | 종류 비중·세분류 비교 탭) + 다운로드 옵션]
 * 체크한 용역만 증빙으로 내려받는다. 수행기간은 계약기간이 아니라 입사·퇴사·투입 기간을 반영한 값.
 */

// 계약 Dashboard(CATEGORY_META)와 같은 분류 색 — 화면 간 같은 종류는 같은 색
const CATEGORY_ORDER: RecordCategory[] = ["통합허가", "화관법", "HAPs", "ESG 탄소중립", "기타"];
const CATEGORY_COLOR: Record<RecordCategory, string> = {
  통합허가: "#ED7D31",
  화관법: "#FFC000",
  HAPs: "#70AD47",
  "ESG 탄소중립": "#5B9BD5",
  기타: "#7F7F7F",
};

// 범례에 쓰는 종류 축약명
const CATEGORY_SHORT: Record<RecordCategory, string> = {
  통합허가: "통합",
  화관법: "화관법",
  HAPs: "HAPs",
  "ESG 탄소중립": "ESG",
  기타: "기타",
};

// 세분류 파이 색 — 수주/수금/발행 현황(OrdersStatusSection)의 세분류 도넛과 같은 팔레트·같은 순서
const SUBTYPE_PIE_COLORS = ["#FF6B6B", "#F3C16F", "#FFF176", "#B7F59A", "#8FD476", "#B9D8FF", "#D5A9FF", "#E4B4FF"];

// 세분류 범례 축약(기본 4자) — 사용자가 지정한 항목만 줄이고 나머지는 원문 그대로 둔다
const SUBTYPE_SHORT: Record<string, string> = {
  화학사고예방관리계획: "화방계",
  배출저감계획: "배출저감",
  위해관리계획: "위해관리",
  화관법기준: "화관기준",
  판매업허가: "판매업",
  정기점검대응: "정기점검",
  공급망실사: "공급망",
  배출량산정: "배출량",
  배출권관련: "배출권",
  총량제신고: "총량제",
  매체별인허가: "매체별",
};

type BarMode = "month" | "year";
type SideTab = "category" | "duration";

const INCLUDE_OPTIONS: { key: keyof RecordBundleInclude; label: string }[] = [
  { key: "history", label: "수행인력 개별 이력사항" },
  { key: "contract", label: "계약서" },
  { key: "invoice", label: "세금계산서" },
  { key: "certificate", label: "용역수행 실적증명서" },
  { key: "roster", label: "수행인력 명단" },
];

const PACKAGING_OPTIONS: { key: RecordBundlePackaging; label: string; description: string }[] = [
  { key: "merged", label: "전체를 하나의 PDF로 병합", description: "이력사항 → 용역별 계약서·계산서 → 실적증명서·명단 순서" },
  { key: "perContract", label: "용역 건별로 하나의 PDF (ZIP)", description: "용역마다 계약서·계산서·실적증명서·명단을 한 파일로" },
  { key: "split", label: "항목별로 분리 · 용역 건별 폴더 (ZIP)", description: "폴더마다 계약서·계산서 / 실적증명서·명단을 따로" },
];

const dot = (ymd: string | null) => (ymd ? ymd.replace(/-/g, ".") : "");
const monthsOf = (days: number) => Math.round((days / 30.4375) * 10) / 10;

function periodLabel(row: StaffRecordRow): string {
  if (!row.periodFrom) return "—";
  return `${dot(row.periodFrom)} ~ ${row.ongoing ? "진행중" : dot(row.periodTo)}`;
}

function amountLabel(amount: number): string {
  if (amount >= 100_000_000) return `${(Math.round(amount / 10_000_000) / 10).toLocaleString("ko-KR")}억원`;
  return `${Math.round(amount / 10_000).toLocaleString("ko-KR")}만원`;
}

function tenureLabel(months: number | null): string {
  if (months == null) return "—";
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y > 0 ? `${y}년 ${m}개월` : `${m}개월`;
}

function getDownloadFileName(disposition: string | null): string | null {
  const match = disposition?.match(/filename\*=UTF-8''([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function summaryMessage(s: RecordBundleSummary, include: RecordBundleInclude): string {
  const notes: string[] = [];
  if (include.contract && s.missingContractDoc) notes.push(`계약서 미등록 ${s.missingContractDoc}건`);
  if (include.invoice && s.missingInvoice) notes.push(`세금계산서 없음 ${s.missingInvoice}건`);
  if (include.certificate && s.missingCertificate) notes.push(`실적증명서 날인본 미첨부 ${s.missingCertificate}건`);
  if (include.roster && s.missingRoster) notes.push(`수행인력 명단 없음 ${s.missingRoster}건`);
  if (s.unreadable) notes.push(`읽지 못한 파일 ${s.unreadable}개`);
  const fallback = include.history && s.historyFallback ? " · 이력사항은 표준 양식 변환에 실패해 간이 양식으로 대체했습니다" : "";
  return (notes.length ? `${s.contracts}건 생성 완료 — 제외: ${notes.join(", ")}` : `${s.contracts}건 생성 완료`) + fallback;
}

/** 'YYYY-MM' 구간 [from, to] 가 그 달과 겹치는지 — 수행 중이던 용역 수 집계용. */
function overlaps(row: StaffRecordRow, from: string, to: string, today: string): boolean {
  if (!row.periodFrom) return false;
  return row.periodFrom <= to && (row.periodTo ?? today) >= from;
}

export default function StaffingRecordsBoard() {
  const { theme } = useCdashTheme();
  const pal = chartPalette(theme);
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StaffRecordDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [barMode, setBarMode] = useState<BarMode>("month");
  const [sideTab, setSideTab] = useState<SideTab>("category");
  // 종류별 비중에서 고른 대분류 — 그 종류의 세분류 비중 파이를 오른쪽에 편다
  const [drill, setDrill] = useState<RecordCategory | null>(null);
  const [include, setInclude] = useState<RecordBundleInclude>({
    history: true, contract: true, invoice: true, certificate: true, roster: true,
  });
  const [packaging, setPackaging] = useState<RecordBundlePackaging>("merged");
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/staffing/records", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "조직 정보를 불러오지 못했습니다.");
        setSnapshot(d.snapshot ?? null);
        setCounts(d.counts ?? {});
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const pickEmployee = useCallback((emp: OrganizationEmployeeRow) => {
    setSelectedId(emp.employeeId);
    setLoading(true);
    setError(null);
    setDownloadMsg(null);
    setDrill(null);
    fetch(`/api/staffing/records?employeeId=${encodeURIComponent(emp.employeeId)}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "실적을 불러오지 못했습니다.");
        const next = d as StaffRecordDetail;
        setDetail(next);
        setChecked(new Set(next.rows.map((row) => row.contractId)));
      })
      .catch((err: Error) => {
        setDetail(null);
        setChecked(new Set());
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => detail?.rows ?? [], [detail]);
  const today = useMemo(() => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10), []);

  const kpi = useMemo(() => {
    const withPeriod = rows.filter((r) => r.periodDays != null);
    const withPct = rows.filter((r) => r.participationPct != null);
    const total = rows.reduce((acc, r) => acc + (r.amount ?? 0), 0);
    return {
      count: rows.length,
      avgMonths: withPeriod.length ? monthsOf(withPeriod.reduce((a, r) => a + (r.periodDays ?? 0), 0) / withPeriod.length) : null,
      periodCount: withPeriod.length,
      total,
      avgPct: withPct.length ? Math.round((withPct.reduce((a, r) => a + (r.participationPct ?? 0), 0) / withPct.length) * 10) / 10 : null,
      pctCount: withPct.length,
    };
  }, [rows]);

  // ── 막대: 그 달/그 해에 수행 중이던 용역 수 ──
  const bar = useMemo(() => {
    if (barMode === "month") {
      const cats: string[] = [];
      const data: number[] = [];
      const base = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
      for (let i = 11; i >= 0; i--) {
        const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
        const ym = d.toISOString().slice(0, 7);
        const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
        cats.push(`${ym.slice(2, 4)}.${ym.slice(5, 7)}`);
        data.push(rows.filter((r) => overlaps(r, `${ym}-01`, last, today)).length);
      }
      return { cats, data };
    }
    const years = rows.filter((r) => r.periodFrom).map((r) => Number(r.periodFrom!.slice(0, 4)));
    const thisYear = Number(today.slice(0, 4));
    const first = years.length ? Math.min(...years) : thisYear;
    const cats: string[] = [];
    const data: number[] = [];
    for (let y = first; y <= thisYear; y++) {
      cats.push(String(y));
      data.push(rows.filter((r) => overlaps(r, `${y}-01-01`, `${y}-12-31`, today)).length);
    }
    return { cats, data };
  }, [rows, barMode, today]);

  const axisLabel = { style: { colors: pal.muted, fontSize: "12px" } };
  const barOptions: ApexOptions = useMemo(
    () => ({
      chart: { type: "bar", toolbar: { show: false }, fontFamily: "inherit", animations: { enabled: false }, parentHeightOffset: 0 },
      plotOptions: { bar: { columnWidth: "56%", borderRadius: 4, borderRadiusApplication: "end" } },
      colors: [pal.primary],
      dataLabels: { enabled: false },
      grid: { borderColor: pal.grid, strokeDashArray: 3 },
      xaxis: { categories: bar.cats, labels: { ...axisLabel, rotate: -45, hideOverlappingLabels: true }, axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { labels: { ...axisLabel, formatter: (v: number) => String(Math.round(v)) }, forceNiceScale: true, min: 0 },
      tooltip: { theme, y: { formatter: (v: number) => `${v}건` } },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bar.cats, theme]
  );

  // ── 파이: 종류별 건수 비중 ──
  const pie = useMemo(() => {
    const items = CATEGORY_ORDER.map((c) => ({ label: c, count: rows.filter((r) => r.category === c).length })).filter((i) => i.count > 0);
    return { labels: items.map((i) => i.label), series: items.map((i) => i.count), colors: items.map((i) => CATEGORY_COLOR[i.label]) };
  }, [rows]);
  const pieOptions: ApexOptions = useMemo(
    () => ({
      chart: {
        type: "pie",
        fontFamily: "inherit",
        animations: { enabled: false },
        events: {
          // 조각 클릭 = 그 종류의 세분류 비중 펼침(같은 조각을 다시 누르면 접음). 아래 종류 버튼과 같은 동작.
          dataPointSelection: (_e, _ctx, cfg) => {
            const picked = pie.labels[cfg?.dataPointIndex ?? -1];
            if (picked) setDrill((prev) => (prev === picked ? null : picked));
          },
        },
      },
      labels: pie.labels,
      colors: pie.colors,
      stroke: { width: 1, colors: [pal.surface] },
      // 누른 조각이 진하게 변하는 선택 효과를 끈다 — 선택 표시는 옆 범례의 배경으로만
      states: { active: { filter: { type: "none" } } },
      plotOptions: { pie: { expandOnClick: false } },
      dataLabels: { enabled: true, formatter: (v: number) => `${Math.round(v)}%`, dropShadow: { enabled: false } },
      legend: { show: false },
      tooltip: { theme, y: { formatter: (v: number) => `${v}건` } },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pie.labels, theme]
  );

  // ── 세분류 파이: 고른 종류 안에서 세분류별 건수 비중 ──
  const subPie = useMemo(() => {
    if (!drill) return { labels: [] as string[], series: [] as number[], colors: [] as string[], total: 0 };
    const bySubtype = new Map<string, number>();
    for (const r of rows) {
      if (r.category !== drill) continue;
      const key = r.serviceSubtype || "미분류";
      bySubtype.set(key, (bySubtype.get(key) ?? 0) + 1);
    }
    const items = [...bySubtype.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
    return {
      labels: items.map(([label]) => label),
      series: items.map(([, count]) => count),
      colors: items.map((_, i) => softCategoryColor(SUBTYPE_PIE_COLORS[i % SUBTYPE_PIE_COLORS.length], 0.08)),
      total: items.reduce((acc, [, count]) => acc + count, 0),
    };
  }, [rows, drill]);
  const subPieOptions: ApexOptions = useMemo(
    () => ({
      chart: { type: "pie", fontFamily: "inherit", animations: { enabled: false } },
      labels: subPie.labels,
      colors: subPie.colors,
      stroke: { width: 1, colors: [pal.surface] },
      states: { active: { filter: { type: "none" } } },
      plotOptions: { pie: { expandOnClick: false } },
      dataLabels: { enabled: false },
      legend: { show: false },
      tooltip: { theme, y: { formatter: (v: number) => `${v}건` } },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subPie.labels, theme]
  );

  // ── 세분류별 평균 수행기간: 개인 vs 전사 ──
  const durations = useMemo(() => (detail?.subtypeDurations ?? []).slice(0, 7), [detail]);
  const durationOptions: ApexOptions = useMemo(
    () => ({
      chart: { type: "bar", toolbar: { show: false }, fontFamily: "inherit", animations: { enabled: false }, parentHeightOffset: 0 },
      plotOptions: { bar: { horizontal: true, barHeight: "62%", borderRadius: 3, borderRadiusApplication: "end" } },
      colors: [pal.primary, pal.accent], // 개인 = 파랑, 전사 평균 = 주황(한눈에 갈리게)
      dataLabels: { enabled: false },
      grid: { borderColor: pal.grid, strokeDashArray: 3 },
      xaxis: { categories: durations.map((d) => d.label), labels: { ...axisLabel, formatter: (v: string) => `${v}` }, axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { labels: { style: { colors: pal.muted, fontSize: "12px" }, maxWidth: 130 } },
      legend: { position: "bottom", labels: { colors: pal.muted }, fontSize: "12px", markers: { size: 5 } },
      tooltip: { theme, shared: true, intersect: false, y: { formatter: (v: number) => `${v}개월` } },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [durations, theme]
  );
  const durationSeries = useMemo(
    () => [
      { name: `${detail?.profile.name ?? "개인"} 평균`, data: durations.map((d) => monthsOf(d.personAvgDays)) },
      { name: "전사 평균", data: durations.map((d) => (d.companyAvgDays != null ? monthsOf(d.companyAvgDays) : 0)) },
    ],
    [durations, detail]
  );

  const allChecked = rows.length > 0 && checked.size === rows.length;
  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const noneIncluded = !Object.values(include).some(Boolean);
  const download = async () => {
    if (!detail || checked.size === 0 || noneIncluded) return;
    setDownloading(true);
    setDownloadMsg(null);
    try {
      const res = await fetch("/api/staffing/records/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: detail.profile.employeeId, contractIds: [...checked], include, packaging }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "증빙 생성에 실패했습니다.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = getDownloadFileName(res.headers.get("Content-Disposition")) ?? "수행실적 증빙";
      a.click();
      URL.revokeObjectURL(url);
      const raw = res.headers.get("X-Record-Summary");
      setDownloadMsg({
        ok: true,
        text: raw ? summaryMessage(JSON.parse(decodeURIComponent(raw)) as RecordBundleSummary, include) : "생성 완료",
      });
    } catch (err) {
      setDownloadMsg({ ok: false, text: (err as Error).message });
    } finally {
      setDownloading(false);
    }
  };

  const profile = detail?.profile ?? null;

  return (
    <>
      <CdPageHeader
        title="수행인력 실적"
        meta={profile ? `${profile.name} · 수행 용역 ${rows.length}건` : undefined}
        help="수행기간은 계약기간이 아니라 그 인력이 실제로 참여한 기간입니다. 시작일은 계약 시작일·입사일·투입일 중 가장 늦은 날, 종료일은 계약 종료일(완료 건)·퇴사일·투입 종료일 중 가장 이른 날로 계산하며, 종료 근거가 없으면 진행중으로 표시합니다. 참여도는 성과급 반기 평가에 입력된 값의 평균입니다."
      />

      <div className="flex flex-1 min-h-0 gap-4">
        <aside className="w-72 shrink-0 min-h-0 cd-reveal">
          <OrganizationTree
            snapshot={snapshot}
            fillHeight
            allowResignedView
            selectedEmployeeId={selectedId}
            onSelectEmployee={pickEmployee}
            employeeBadge={(e) => counts[e.employeeId] ?? 0}
            hideDeptCount
          />
        </aside>

        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto flex flex-col gap-4">
          {error && <p className="cd-error-text text-sm" role="alert">{error}</p>}

          {/* 인적 요약 */}
          <section className="cd-card rounded-lg px-5 py-4" aria-label="선택 인력">
            {profile ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3">
                <Field label="성명">
                  {profile.name}
                  {profile.status === "inactive" && <CdBadge tone="idle" className="ml-2">퇴사{profile.resignedAt ? ` ${dot(profile.resignedAt)}` : ""}</CdBadge>}
                </Field>
                <Field label="직급">{profile.positionName || "—"}</Field>
                <Field label="소속">{profile.deptName || "—"}</Field>
                <Field label="근속연수">
                  {tenureLabel(profile.tenureMonths)}
                  {profile.hiredAt && <span className="ml-2 text-xs font-normal cd-text-faint">입사 {dot(profile.hiredAt)}</span>}
                </Field>
              </div>
            ) : (
              <p className="text-sm cd-text-faint">{loading ? "불러오는 중…" : "좌측 조직도에서 인력을 선택하세요."}</p>
            )}
          </section>

          {/* KPI */}
          <section className="grid grid-cols-2 lg:grid-cols-5 gap-4" aria-label="수행 실적 요약">
            <Kpi icon={<ListChecks className="w-4 h-4" />} label="총 수행 용역" value={profile ? `${kpi.count}건` : "—"} />
            <Kpi
              icon={<CalendarRange className="w-4 h-4" />}
              label="평균 수행 기간"
              value={kpi.avgMonths != null ? `${kpi.avgMonths}개월` : "—"}
              sub={profile && kpi.periodCount !== kpi.count ? `기간 산정 ${kpi.periodCount}건 기준` : undefined}
            />
            <Kpi icon={<Banknote className="w-4 h-4" />} label="수행 용역 계약 총액" value={profile ? amountLabel(kpi.total) : "—"} sub="부가세 별도 계약금액 합" />
            <Kpi
              icon={<Percent className="w-4 h-4" />}
              label="평균 참여도"
              value={kpi.avgPct != null ? `${kpi.avgPct}%` : "—"}
              sub={profile ? (kpi.pctCount ? `참여도 입력 ${kpi.pctCount}건 기준` : "입력된 참여도 없음") : undefined}
            />
            <Kpi icon={<Trophy className="w-4 h-4" />} label="성과지수" value="—" sub="산식 확정 후 제공" />
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,117fr)_minmax(0,83fr)] gap-4">
            {/* 담당 계약 리스트 — 우측 열 높이에 맞추고 내부만 스크롤 */}
            <section className="cd-card rounded-lg flex flex-col min-h-[440px] min-w-0">
              <div className="flex items-center gap-2 px-4 pt-4 pb-3">
                <h2 className="text-base font-semibold cd-text">담당 계약</h2>
                <span className="text-xs cd-text-faint tabular-nums">{checked.size} / {rows.length}건 선택</span>
                <div className="ml-auto flex gap-1.5">
                  <CdButton size="sm" disabled={rows.length === 0 || allChecked} onClick={() => setChecked(new Set(rows.map((r) => r.contractId)))}>전체 선택</CdButton>
                  <CdButton size="sm" disabled={checked.size === 0} onClick={() => setChecked(new Set())}>전체 해제</CdButton>
                </div>
              </div>
              <div className="relative flex-1 min-h-0">
                <div className="absolute inset-0 overflow-auto border-t cd-border-c">
                  <table className="cd-table">
                    <thead className="sticky top-0 z-[1]">
                      <tr>
                        <th className="w-9"><span className="sr-only">선택</span></th>
                        <th>계약명 / 발주처</th>
                        <th className="text-right whitespace-nowrap">계약금액</th>
                        <th className="whitespace-nowrap">수행기간</th>
                        <th className="text-right whitespace-nowrap">참여도</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.contractId} aria-selected={checked.has(r.contractId)} className="cursor-pointer" onClick={() => toggle(r.contractId)}>
                          <td>
                            <input
                              type="checkbox"
                              checked={checked.has(r.contractId)}
                              onChange={() => toggle(r.contractId)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`${r.contractTitle} 선택`}
                            />
                          </td>
                          <td className="min-w-0">
                            <p className="cd-text font-semibold leading-snug">{r.contractTitle}</p>
                            <p className="mt-0.5 cd-text-faint">
                              {r.clientName || "발주처 미등록"}
                              <span className="mx-1.5">·</span>
                              {r.category}{r.serviceSubtype ? `-${r.serviceSubtype}` : ""}
                              {r.roleLabel && <><span className="mx-1.5">·</span>{r.roleLabel}</>}
                            </p>
                          </td>
                          <td className="text-right tabular-nums whitespace-nowrap">{r.amount != null ? r.amount.toLocaleString("ko-KR") : "—"}</td>
                          <td className="tabular-nums whitespace-nowrap">
                            {periodLabel(r)}
                            {r.periodDays != null && <p className="cd-text-faint">{monthsOf(r.periodDays)}개월</p>}
                          </td>
                          <td className="text-right tabular-nums whitespace-nowrap">{r.participationPct != null ? `${r.participationPct}%` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length === 0 && (
                    <p className="p-6 text-sm cd-text-faint">
                      {loading ? "불러오는 중…" : profile ? "수행인력으로 등록된 용역이 없습니다. 계약 관리의 수행인력 지정에서 등록하면 여기에 표시됩니다." : "인력을 선택하면 담당 계약이 표시됩니다."}
                    </p>
                  )}
                </div>
              </div>
            </section>

            <div className="flex flex-col gap-4 min-w-0">
              {/* 차트 카드 — 위: 수행 용역 수 막대 / 아래: 종류 비중·세분류 비교 탭 */}
              <section className="cd-card rounded-lg p-4 gap-5 min-w-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-2 min-h-[36px]">
                    <h2 className="text-base font-semibold cd-text">수행 용역 수</h2>
                    <CdTabs<BarMode>
                      className="ml-auto"
                      variant="pill"
                      items={[{ key: "month", label: "월별" }, { key: "year", label: "연도별" }]}
                      active={barMode}
                      onChange={setBarMode}
                    />
                  </div>
                  <p className="text-xs cd-text-faint mb-1">{barMode === "month" ? "최근 12개월, 그 달에 수행 중이던 용역" : "그 해에 수행 중이던 용역"}</p>
                  <div className="h-[250px]">
                    {rows.length > 0 ? (
                      <ApexChart key={`bar-${barMode}-${theme}-${selectedId}`} options={barOptions} series={[{ name: "수행 용역", data: bar.data }]} type="bar" height={250} />
                    ) : (
                      <ChartEmpty />
                    )}
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="mb-2 min-h-[36px] flex items-end">
                    <CdTabs<SideTab>
                      items={[{ key: "category", label: "종류별 비중" }, { key: "duration", label: "세분류 평균 수행기간" }]}
                      active={sideTab}
                      onChange={setSideTab}
                    />
                  </div>
                  <p className="text-xs cd-text-faint mb-1">
                    {sideTab === "category" ? "수행 용역 종류별 건수 비중 · 종류를 누르면 세분류 비중을 펼칩니다" : "세분류별 평균 수행기간(개월) — 개인 / 전사"}
                  </p>
                  <div className="min-h-[250px]">
                    {rows.length === 0 ? (
                      <ChartEmpty />
                    ) : sideTab === "category" ? (
                      <>
                      <div className="flex items-center">
                        {/* 종류 파이 — 세분류를 펴면 왼쪽 절반으로 물러난다 */}
                        <div
                          className="min-w-0 flex items-center gap-2 transition-[width] duration-300 ease-out [&_.apexcharts-canvas]:outline-none [&_svg]:outline-none"
                          style={{ width: drill ? "50%" : "100%" }}
                        >
                          <div className="flex-1 min-w-0">
                            <ApexChart key={`pie-${theme}-${selectedId}`} options={pieOptions} series={pie.series} type="pie" height={220} />
                          </div>
                          {/* 종류 범례 = 세분류 펼침 버튼(조각 클릭과 같은 동작, 키보드 조작용) */}
                          <div className="shrink-0 flex flex-col gap-0.5">
                            {pie.labels.map((label, i) => (
                              <button
                                key={label}
                                type="button"
                                className={`flex items-center gap-1.5 px-2 py-1 text-[11px] leading-tight cd-text-muted ${drill === label ? "cd-tint-primary" : ""}`}
                                aria-pressed={drill === label}
                                aria-label={`${label} ${pie.series[i]}건 — 세분류 비중 ${drill === label ? "접기" : "펼치기"}`}
                                onClick={() => setDrill((prev) => (prev === label ? null : label))}
                              >
                                <span aria-hidden="true" className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: pie.colors[i] }} />
                                {CATEGORY_SHORT[label]}
                                <span className="ml-auto pl-1.5 tabular-nums cd-text-faint">{pie.series[i]}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        {drill && (
                          <div className="w-1/2 min-w-0 pl-3 border-l cd-border-c [&_.apexcharts-canvas]:outline-none [&_svg]:outline-none">
                            <div className="flex items-center gap-2 min-h-[32px]">
                              <h3 className="text-sm font-semibold cd-text truncate">{drill} 세분류</h3>
                              <CdButton size="sm" className="ml-auto" onClick={() => setDrill(null)}>접기</CdButton>
                            </div>
                            <ApexChart key={`sub-${theme}-${selectedId}-${drill}`} options={subPieOptions} series={subPie.series} type="pie" height={188} />
                          </div>
                        )}
                      </div>
                      {/* 세분류 범례 — 차트 하단 전체 폭 4열(좁은 칸에서 글자가 잘리지 않게) */}
                      {drill && (
                        <ul className="mt-2 pt-2 border-t cd-border-c grid grid-cols-4 gap-x-3 gap-y-1 text-[11px] leading-tight" aria-label={`${drill} 세분류 비중`}>
                          {subPie.labels.map((label, i) => (
                            <li key={label} className="flex items-center gap-1 min-w-0" title={`${label} ${subPie.series[i]}건`}>
                              <span aria-hidden="true" className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: subPie.colors[i] }} />
                              <span className="truncate cd-text-muted">{SUBTYPE_SHORT[label] ?? label}</span>
                              <span className="ml-auto tabular-nums cd-text-faint">{Math.round((subPie.series[i] / subPie.total) * 100)}%</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      </>
                    ) : durations.length > 0 ? (
                      <ApexChart key={`dur-${theme}-${selectedId}`} options={durationOptions} series={durationSeries} type="bar" height={250} />
                    ) : (
                      <ChartEmpty text="수행기간을 산정할 수 있는 용역이 없습니다." />
                    )}
                  </div>
                </div>
              </section>

              {/* 다운로드 옵션 */}
              <section className="cd-card rounded-lg p-4 min-w-0" aria-label="증빙 다운로드 옵션">
                <h2 className="text-base font-semibold cd-text mb-3">증빙 다운로드</h2>
                <div className="grid grid-cols-1 gap-5">
                  <fieldset>
                    <legend className="text-xs font-semibold cd-text-muted mb-2">포함할 서류</legend>
                    <div className="flex flex-col gap-2">
                      {INCLUDE_OPTIONS.map((o) => (
                        <label key={o.key} className="flex items-center gap-2 text-sm cd-text cursor-pointer">
                          <input
                            type="checkbox"
                            checked={include[o.key]}
                            onChange={(e) => setInclude((prev) => ({ ...prev, [o.key]: e.target.checked }))}
                          />
                          {o.label}
                        </label>
                      ))}
                    </div>
                    <p className="mt-2 text-xs cd-text-faint">
                      이력사항에는 체크한 용역만 실립니다. 실적증명서는 직인 날인본이 첨부된 용역만 포함됩니다.
                    </p>
                  </fieldset>
                  <fieldset>
                    <legend className="text-xs font-semibold cd-text-muted mb-2">파일 구성</legend>
                    <div className="flex flex-col gap-2">
                      {PACKAGING_OPTIONS.map((o) => (
                        <label key={o.key} className="flex items-start gap-2 text-sm cd-text cursor-pointer">
                          <input
                            type="radio"
                            name="record-packaging"
                            className="mt-1"
                            checked={packaging === o.key}
                            onChange={() => setPackaging(o.key)}
                          />
                          <span>
                            {o.label}
                            <span className="block text-xs cd-text-faint">{o.description}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <CdButton
                    variant="primary"
                    icon={<Download className="w-4 h-4" />}
                    loading={downloading}
                    disabled={!detail || checked.size === 0 || noneIncluded}
                    onClick={download}
                  >
                    선택 {checked.size}건 다운로드
                  </CdButton>
                  {noneIncluded && <span className="cd-error-text text-xs">포함할 서류를 하나 이상 선택하세요.</span>}
                  {!noneIncluded && detail && checked.size === 0 && <span className="cd-error-text text-xs">담당 계약에서 용역을 체크하세요.</span>}
                  {downloadMsg && (
                    <span className={downloadMsg.ok ? "text-xs cd-text-muted" : "cd-error-text text-xs"} role="status">{downloadMsg.text}</span>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs cd-text-faint">{label}</p>
      <p className="mt-0.5 text-base font-bold cd-text truncate">{children}</p>
    </div>
  );
}

function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="cd-card rounded-lg px-4 py-3.5 min-w-0">
      <div className="flex items-center gap-1.5 text-xs cd-text-muted">
        <span className="cd-text-faint">{icon}</span>
        {label}
      </div>
      <p className="mt-1.5 text-[22px] font-bold leading-tight tabular-nums cd-text truncate">{value}</p>
      <p className="mt-0.5 text-xs cd-text-faint truncate min-h-[16px]">{sub ?? ""}</p>
    </div>
  );
}

function ChartEmpty({ text = "표시할 수행 용역이 없습니다." }: { text?: string }) {
  return <div className="h-full min-h-[250px] flex items-center justify-center text-sm cd-text-faint">{text}</div>;
}
