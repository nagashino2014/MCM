"use client";

// 견적 기준 관리(/approval/quote/settings, Q4·Q5) — 권한 approval.manage.
// 탭: ①기준 세트(세분류별 항목 트리·base_md·요율·특이사항·인자·규모구간 편집 + 역산 시뮬레이터)
//     ②노임단가(연도별×등급별, 자동 수집 로그) ③상황 변수 코드
//     ④수주 분석(Q5 — 수주율·상황변수·금액구간 집계 + 시장 보정계수 제안·1클릭 반영).
// 세트 수정은 기존 견적을 훼손하지 않는다(견적서에 산정 당시 스냅샷 박제).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BarChart3, Calculator, ChevronDown, ChevronRight, Coins, Plus, Save, Settings2, Tag, Trash2, X } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import { AmountInput } from "@/components/ui/AmountInput";
import {
  DEFAULT_MD_GRADES,
  LABOR_GRADES,
  QUOTE_SERVICE_OPTIONS,
  mdSnapUnit,
  sortGrades,
  sumOverCap,
  type QuoteReport,
  type QuoteReportBucket,
  type QuoteWorkItem,
} from "@/lib/quote/types";
import { gradeTotals, mdVectorTotal, reverseAllocate, validateSumConstraint } from "@/lib/quote/rates";
import "@/components/cdash/cdash.css";

type Tab = "sets" | "labor" | "codes" | "report";

interface SetSummary {
  setId: string;
  serviceType: string;
  serviceSubtype: string;
  version: number;
  itemCount: number;
}

interface ItemRow {
  label: string;
  isParent: boolean; // 대항목 여부 — 저장 시 parentIdx 재구성(직전 대항목)
  baseMd: Record<string, number>;
}

interface SetDetail {
  setId: string;
  serviceType: string;
  serviceSubtype: string;
  overheadRate: number;
  techFeeRate: number;
  directExpenseRate: number;
  marketAdjust: number;
  /** 이 세트의 기술등급 축(가변, 143). 기술사 추가·특급 제외 등 세분류마다 다르다 */
  grades: string[];
  remarksTemplate: string;
  items: { itemId: string; parentId: string | null; label: string; baseMd: Record<string, number> }[];
  factors: { factorKey: string; label: string; unit: string }[];
  bands: { factorKey: string; minVal: number; maxVal: number | null; coef: number }[];
}

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const pct = (v: number | null) => (v == null ? "-" : `${(v * 100).toFixed(1)}%`);

/** 수주 분석 공용 집계 표(세분류·상황변수·금액구간) */
/**
 * 수주율 집계 표. compact = 2열 그리드에 들어가는 좁은 폭(상황 변수별·금액 구간별) —
 * 고정 최소폭을 두면 가로 스크롤이 생기므로 table-fixed + 비율 열폭 + 축소 타이포로 맞춘다.
 */
function BucketTable({ title, buckets, compact = false }: { title: string; buckets: QuoteReportBucket[]; compact?: boolean }) {
  const fs = compact ? "text-[10.5px]" : "text-[11.5px]";
  const pad = compact ? "px-1.5 py-1" : "px-2 py-1.5";
  // 구분 / 건수 / 수주 / 실주 / 수주율 / 견적 총액 / 낙찰가 갭
  const widths = compact
    ? ["26%", "8%", "8%", "8%", "12%", "24%", "14%"]
    : [undefined, "56px", "56px", "56px", "80px", "112px", "96px"];
  return (
    <div className="rounded-2xl border cd-border-c p-3.5 flex flex-col gap-2 min-w-0">
      <p className="text-[12px] font-semibold cd-text">{title}</p>
      <div className={compact ? "" : "overflow-x-auto"}>
        <table className={`w-full ${fs} border-collapse table-fixed ${compact ? "" : "min-w-[560px]"}`}>
          <colgroup>
            {widths.map((w, i) => (
              <col key={i} style={w ? { width: w } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className={`border cd-border-c ${pad} text-left cd-text-faint font-semibold`}>구분</th>
              <th className={`border cd-border-c ${pad} cd-text-faint font-semibold`}>건수</th>
              <th className={`border cd-border-c ${pad} cd-text-faint font-semibold`}>수주</th>
              <th className={`border cd-border-c ${pad} cd-text-faint font-semibold`}>실주</th>
              <th className={`border cd-border-c ${pad} cd-text-faint font-semibold`}>수주율</th>
              <th className={`border cd-border-c ${pad} cd-text-faint font-semibold`}>견적 총액</th>
              <th className={`border cd-border-c ${pad} cd-text-faint font-semibold`} title="실주 건 (경쟁 낙찰가 / 자사 견적가) 중앙값 - 1">
                낙찰가 갭
              </th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.key}>
                <td className={`border cd-border-c ${pad} cd-text truncate`} title={b.label}>{b.label}</td>
                <td className={`border cd-border-c ${pad} text-center cd-text`}>{b.total}</td>
                <td className={`border cd-border-c ${pad} text-center cd-text`}>{b.won}</td>
                <td className={`border cd-border-c ${pad} text-center cd-text`}>{b.lost}</td>
                <td className={`border cd-border-c ${pad} text-center font-semibold cd-text`}>{pct(b.winRate)}</td>
                <td className={`border cd-border-c ${pad} text-right font-mono cd-text-faint tabular-nums`}>{won(b.quotedAmount)}</td>
                <td className={`border cd-border-c ${pad} text-center cd-text-faint`} title={`표본 ${b.lostGapSamples}건`}>
                  {b.lostGapPct != null ? `${(b.lostGapPct * 100).toFixed(1)}%${compact ? "" : ` (${b.lostGapSamples})`}` : "-"}
                </td>
              </tr>
            ))}
            {buckets.length === 0 && (
              <tr>
                <td colSpan={7} className={`border cd-border-c ${pad} py-4 text-center cd-text-faint`}>집계 대상이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function QuoteSettingsBoard() {
  const { theme } = useCdashTheme();
  const [tab, setTab] = useState<Tab>("sets");
  const [sets, setSets] = useState<SetSummary[]>([]);
  const [selected, setSelected] = useState<{ serviceType: string; serviceSubtype: string } | null>(null);
  const [detail, setDetail] = useState<SetDetail | null>(null);
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [laborYears, setLaborYears] = useState<Record<string, { rates: Record<string, number>; sourceNote: string }>>({});
  const [syncLog, setSyncLog] = useState<{ year: string; triedDate: string; ok: boolean; sourceUrl: string | null; detail: string | null }[]>([]);
  const [laborRates, setLaborRates] = useState<Record<string, number>>({});
  const [codes, setCodes] = useState<{ code: string; label: string; enabled: boolean }[]>([]);
  // 시뮬레이터
  const [simPrice, setSimPrice] = useState("");
  const [simResult, setSimResult] = useState<{ totalMd: number; totals: Record<string, number>; sum: number; over: number; cap: number; ok: boolean } | null>(null);
  // 수주 분석(Q5)
  const [report, setReport] = useState<QuoteReport | null>(null);
  const [reportRange, setReportRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [reportLoading, setReportLoading] = useState(false);

  const loadSets = useCallback(async () => {
    const res = await fetch("/api/quotes/admin/rate-sets", { cache: "no-store" });
    if (res.ok) setSets((await res.json()).sets ?? []);
  }, []);

  const loadLabor = useCallback(async () => {
    const res = await fetch("/api/quotes/admin/labor-rates", { cache: "no-store" });
    if (res.ok) {
      const d = await res.json();
      setLaborYears(d.years ?? {});
      setSyncLog(d.syncLog ?? []);
      const latest = Object.keys(d.years ?? {}).sort().pop();
      if (latest) setLaborRates(d.years[latest].rates);
    }
  }, []);

  useEffect(() => {
    void loadSets();
    void loadLabor();
    fetch("/api/quotes/admin/situation-codes", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.codes && setCodes(d.codes))
      .catch(() => {});
  }, [loadSets, loadLabor]);

  const setOf = useCallback(
    (t: string, s: string) => sets.find((x) => x.serviceType === t && x.serviceSubtype === s) ?? null,
    [sets]
  );

  /** 세트 상세 로드 → 편집 행으로 평탄화(대항목 플래그) */
  const openSet = useCallback(async (serviceType: string, serviceSubtype: string) => {
    setSelected({ serviceType, serviceSubtype });
    setDetail(null);
    setRows([]);
    setSimResult(null);
    const summary = setOf(serviceType, serviceSubtype);
    if (!summary) return; // 세트 없음 — 생성 버튼 노출
    const res = await fetch(`/api/quotes/admin/rate-sets/${encodeURIComponent(summary.setId)}`, { cache: "no-store" });
    if (!res.ok) return alert("세트를 불러오지 못했습니다.");
    const d = (await res.json()).set as SetDetail;
    setDetail({ ...d, grades: d.grades?.length ? sortGrades(d.grades) : [...DEFAULT_MD_GRADES] });
    const parentIds = new Set(d.items.map((i) => i.parentId).filter(Boolean));
    setRows(d.items.map((i) => ({ label: i.label, isParent: parentIds.has(i.itemId), baseMd: i.baseMd })));
  }, [setOf]);

  const createSet = useCallback(
    async (copyFromSetId?: string) => {
      if (!selected) return;
      setBusy(true);
      try {
        const res = await fetch("/api/quotes/admin/rate-sets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...selected, copyFromSetId }),
        });
        if (!res.ok) throw new Error((await res.json())?.error ?? "생성 실패");
        await loadSets();
        await openSet(selected.serviceType, selected.serviceSubtype);
      } catch (err) {
        alert((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [selected, loadSets, openSet]
  );

  // sets 갱신 후 재선택 시 setOf가 새 목록을 보도록 — openSet은 sets 의존
  useEffect(() => {
    if (selected && !detail) {
      const s = setOf(selected.serviceType, selected.serviceSubtype);
      if (s) void openSet(selected.serviceType, selected.serviceSubtype);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sets]);

  /**
   * 기술등급 추가/제외 — 제외 시 그 등급의 MD를 남은 등급에 현재 비율대로 재분배해
   * 행별 MD 합계를 보존한다(남은 값이 모두 0이면 균등 분배). 추가 시에는 빈 열로 시작한다.
   */
  const toggleGrade = useCallback(
    (grade: string) => {
      if (!detail) return;
      const on = detail.grades.includes(grade);
      const next = on ? detail.grades.filter((g) => g !== grade) : sortGrades([...detail.grades, grade]);
      if (!next.length) {
        alert("기술등급은 최소 1개 이상이어야 합니다.");
        return;
      }
      setDetail({ ...detail, grades: next });
      if (!on) return; // 추가는 값 이동 없음
      setRows((prev) =>
        prev.map((r) => {
          const moving = r.baseMd[grade] ?? 0;
          const md: Record<string, number> = {};
          for (const g of next) if (r.baseMd[g]) md[g] = r.baseMd[g];
          if (moving > 0) {
            // 분배 눈금: 기존 값이 모두 정수인 세트는 정수, 0.5 가 섞인 소액 세트는 0.5 단위
            // (사용자 확정 2026-08-07 — 가중치에 소수점이 길게 남지 않게 한다)
            const values = [...Object.values(md), moving];
            const unit = values.every((v) => Number.isInteger(v)) ? 1 : 0.5;
            const target = Object.values(md).reduce((a: number, b: number) => a + b, 0) + moving;
            const base = next.reduce((acc: number, g: string) => acc + (md[g] ?? 0), 0);
            if (base > 0) {
              for (const g of next) if (md[g]) md[g] = Math.round((md[g] + (moving * md[g]) / base) / unit) * unit;
            } else {
              const each = Math.round(moving / next.length / unit) * unit;
              for (const g of next) md[g] = each;
            }
            // 스냅 잔차는 가장 큰 셀이 흡수해 행 합계를 보존한다
            const snapped = next.reduce((acc: number, g: string) => acc + (md[g] ?? 0), 0);
            const diff = Math.round((target - snapped) / unit) * unit;
            if (diff !== 0) {
              const top = next.filter((g) => md[g] != null).sort((a, b) => (md[b] ?? 0) - (md[a] ?? 0))[0];
              if (top) md[top] = Math.max(unit, Math.round((md[top] + diff) / unit) * unit);
            }
          }
          return { ...r, baseMd: md };
        })
      );
    },
    [detail]
  );

  const saveSet = useCallback(async () => {
    if (!detail) return;
    setBusy(true);
    try {
      // 편집 행 → parentIdx 재구성(세부항목은 직전 대항목에 소속)
      let lastParent = -1;
      const items = rows.map((r, i) => {
        if (r.isParent) lastParent = i;
        return { label: r.label, baseMd: r.baseMd, parentIdx: r.isParent ? null : lastParent >= 0 ? lastParent : null };
      });
      const res = await fetch(`/api/quotes/admin/rate-sets/${encodeURIComponent(detail.setId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          overheadRate: detail.overheadRate,
          techFeeRate: detail.techFeeRate,
          directExpenseRate: detail.directExpenseRate,
          marketAdjust: detail.marketAdjust,
          grades: detail.grades,
          remarksTemplate: detail.remarksTemplate,
          items,
          factors: detail.factors,
          bands: detail.bands,
        }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? "저장 실패");
      alert("저장되었습니다. (기존 견적서는 산정 당시 스냅샷이 유지됩니다)");
      await loadSets();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [detail, rows, loadSets]);

  const deleteSet = useCallback(async () => {
    if (!detail) return;
    if (!confirm(`[${detail.serviceType} > ${detail.serviceSubtype}] 기준 세트를 삭제할까요?\n이 세분류는 자유 입력형으로 동작하게 됩니다.`)) return;
    setBusy(true);
    try {
      await fetch(`/api/quotes/admin/rate-sets/${encodeURIComponent(detail.setId)}`, { method: "DELETE" });
      setDetail(null);
      setRows([]);
      await loadSets();
    } finally {
      setBusy(false);
    }
  }, [detail, loadSets]);

  /** 역산 시뮬레이터 — 현재 편집 중인 트리·요율·최신 노임단가로 즉석 계산 */
  const runSim = useCallback(() => {
    if (!detail) return;
    const price = Number(simPrice.replace(/[^\d]/g, ""));
    if (!price) return alert("견적가를 입력하세요.");
    let lastParent = -1;
    const items: QuoteWorkItem[] = rows.map((r, i) => {
      if (r.isParent) lastParent = i;
      return {
        itemId: `sim-${i}`,
        parentId: r.isParent ? null : lastParent >= 0 ? `sim-${lastParent}` : null,
        label: r.label,
        sort: i,
        baseMd: r.baseMd,
      };
    });
    const res = reverseAllocate({
      price,
      items,
      rates: {
        overheadRate: detail.overheadRate,
        techFeeRate: detail.techFeeRate,
        directExpenseRate: detail.directExpenseRate,
        laborRates,
        laborYear: "",
      },
    });
    const totals = gradeTotals(res.mdMatrix);
    const check = validateSumConstraint(price, res.amounts.sum);
    setSimResult({
      totalMd: mdVectorTotal(totals),
      totals: totals as Record<string, number>,
      sum: res.amounts.sum,
      over: check.over,
      cap: check.cap,
      ok: check.ok,
    });
  }, [detail, rows, simPrice, laborRates]);

  const saveLaborYear = useCallback(
    async (year: string) => {
      const data = laborYears[year];
      if (!data) return;
      setBusy(true);
      try {
        const res = await fetch("/api/quotes/admin/labor-rates", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year, rates: data.rates, sourceNote: data.sourceNote }),
        });
        if (!res.ok) throw new Error((await res.json())?.error ?? "저장 실패");
        alert(`${year}년 단가가 저장되었습니다.`);
        await loadLabor();
      } catch (err) {
        alert((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [laborYears, loadLabor]
  );

  const saveCodes = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/quotes/admin/situation-codes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? "저장 실패");
      alert("상황 변수 코드가 저장되었습니다.");
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [codes]);

  /** 수주 분석 리포트 로드 — 기간(YYYY-MM) 미지정이면 전체 */
  const loadReport = useCallback(async () => {
    setReportLoading(true);
    try {
      const qs = new URLSearchParams();
      if (reportRange.from) qs.set("from", reportRange.from);
      if (reportRange.to) qs.set("to", reportRange.to);
      const res = await fetch(`/api/quotes/report?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json())?.error ?? "조회 실패");
      setReport((await res.json()).report as QuoteReport);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setReportLoading(false);
    }
  }, [reportRange]);

  useEffect(() => {
    if (tab === "report" && !report) void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  /** 제안된 시장 보정계수를 해당 세트에 반영 — 상세를 받아 계수만 바꿔 되돌린다(PUT은 통째 교체) */
  const applySuggestion = useCallback(
    async (setId: string, value: number) => {
      if (!confirm(`시장 보정계수를 ${value} 로 반영할까요?\n(정방향 표준가 가이드에만 적용되며 기존 견적서는 영향 없음)`)) return;
      setBusy(true);
      try {
        const cur = await fetch(`/api/quotes/admin/rate-sets/${encodeURIComponent(setId)}`, { cache: "no-store" });
        if (!cur.ok) throw new Error("세트를 불러오지 못했습니다.");
        const d = (await cur.json()).set as SetDetail;
        const idOf = new Map(d.items.map((i, idx) => [i.itemId, idx]));
        const items = d.items.map((i) => ({
          label: i.label,
          baseMd: i.baseMd,
          parentIdx: i.parentId != null ? idOf.get(i.parentId) ?? null : null,
        }));
        const res = await fetch(`/api/quotes/admin/rate-sets/${encodeURIComponent(setId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            overheadRate: d.overheadRate,
            techFeeRate: d.techFeeRate,
            directExpenseRate: d.directExpenseRate,
            marketAdjust: value,
            remarksTemplate: d.remarksTemplate,
            items,
            factors: d.factors,
            bands: d.bands,
          }),
        });
        if (!res.ok) throw new Error((await res.json())?.error ?? "반영 실패");
        alert("반영되었습니다.");
        await loadSets();
        await loadReport();
      } catch (err) {
        alert((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [loadSets, loadReport]
  );

  const editRate = (key: "overheadRate" | "techFeeRate" | "directExpenseRate" | "marketAdjust", pct: boolean, value: string) => {
    if (!detail) return;
    const n = Number(value);
    setDetail({ ...detail, [key]: pct ? (isNaN(n) ? 0 : n / 100) : isNaN(n) ? 1 : n });
  };

  return (
    // h-full 을 두면 세분류 목록(50여 항목)이 카드 높이를 넘어 밖으로 삐져나온다 → 콘텐츠 높이를 따른다
    <div className="cdash cd-fields-white flex min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      {/* 폭은 공문 작성(1032px, 전자결재 작성 양식 273mm)·견적서 작성과 동일 */}
      <div className="flex flex-col gap-5 min-h-0 w-full max-w-[1032px]">
        <CdPageHeader
          title="견적 기준 관리"
          actions={
            <Link
              href="/approval/quote"
              className="cd-btn rounded-xl border cd-border-c px-3 py-2 text-[13px] flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" /> 견적서 작성으로
            </Link>
          }
        />
        <div className="cd-card rounded-3xl p-5 flex flex-col gap-4 min-h-0">
          {/* 탭 */}
          <div className="flex items-end gap-1 px-1 -mb-1">
            {(
              [
                ["sets", "기준 세트", Settings2],
                ["labor", "노임단가", Coins],
                ["codes", "상황 변수", Tag],
                ["report", "수주 분석", BarChart3],
              ] as const
            ).map(([t, label, Icon]) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-t-xl px-4 py-2 text-sm font-semibold border-b-2 flex items-center gap-1.5 ${
                  tab === t ? "cd-text-primary border-current cd-tint-primary" : "cd-text-faint border-transparent cd-row-hover"
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          {tab === "sets" && (
            <div className="flex flex-col lg:flex-row gap-4 items-start">
              {/* 좌: 세분류 리스트 */}
              <div className="w-full lg:w-[260px] shrink-0 flex flex-col gap-2.5">
                {QUOTE_SERVICE_OPTIONS.map((g) => (
                  <div key={g.type} className="rounded-2xl border cd-border-c p-2.5">
                    <p className="text-[11px] font-bold cd-text-faint px-1 mb-1">{g.type}</p>
                    <div className="flex flex-col">
                      {g.subtypes.map((s) => {
                        const has = setOf(g.type, s);
                        const active = selected?.serviceType === g.type && selected?.serviceSubtype === s;
                        return (
                          <button
                            key={s}
                            type="button"
                            className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-left ${active ? "cd-tint-primary font-semibold" : "cd-row-hover"}`}
                            onClick={() => void openSet(g.type, s)}
                          >
                            {active ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3 cd-text-faint" />}
                            <span className="flex-1">{s}</span>
                            {has ? (
                              <span className="text-[9.5px] rounded-full px-1.5 py-0.5 cd-tint-primary">기준 {has.itemCount}행</span>
                            ) : (
                              <span className="text-[9.5px] rounded-full px-1.5 py-0.5 border cd-border-c cd-text-faint">자유입력</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* 우: 편집기 */}
              <div className="flex-1 min-w-0 w-full">
                {!selected ? (
                  <p className="text-sm cd-text-faint p-6">좌측에서 세분류를 선택하세요. 기준 세트가 없는 세분류는 자유 입력형(품목 직접 입력)으로 동작합니다.</p>
                ) : !detail ? (
                  <div className="rounded-2xl border border-dashed cd-border-c p-8 flex flex-col items-center gap-3">
                    <p className="text-sm cd-text">
                      <b>{selected.serviceType} &gt; {selected.serviceSubtype}</b> — 기준 세트가 없습니다(자유 입력형).
                    </p>
                    <div className="flex items-center gap-2">
                      <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50" disabled={busy} onClick={() => void createSet()}>
                        <Plus className="w-3.5 h-3.5 inline" /> 빈 세트 생성
                      </button>
                      {sets.length > 0 && (
                        <select
                          className="cd-select text-xs"
                          defaultValue=""
                          disabled={busy}
                          onChange={(e) => e.target.value && void createSet(e.target.value)}
                          title="기존 세트를 복제해 시작"
                        >
                          <option value="">기존 세트 복제...</option>
                          {sets.map((s) => (
                            <option key={s.setId} value={s.setId}>{s.serviceType} &gt; {s.serviceSubtype}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold cd-text text-sm">{detail.serviceType} &gt; {detail.serviceSubtype}</h3>
                      <span className="text-[10.5px] cd-text-faint">수정해도 기존 견적서의 산정 스냅샷은 유지됩니다</span>
                      <div className="ml-auto flex items-center gap-2">
                        <button type="button" className="cd-btn rounded-lg border cd-border-c px-2.5 py-1.5 text-[11px] cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" disabled={busy} onClick={() => void deleteSet()}>
                          <Trash2 className="w-3 h-3 inline" /> 세트 삭제
                        </button>
                        <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50" disabled={busy} onClick={() => void saveSet()}>
                          <Save className="w-3.5 h-3.5 inline" /> {busy ? "저장 중..." : "저장"}
                        </button>
                      </div>
                    </div>

                    {/* 요율 기본값 */}
                    {/* 요율 4종 — 입력 박스 기준 2열 정렬(라벨 길이가 달라도 입력이 한 줄에 맞도록) */}
                    <div className="rounded-2xl border cd-border-c p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5 text-[12px]">
                      {(
                        [
                          ["제경비 요율", "overheadRate", true, Math.round(detail.overheadRate * 100)],
                          ["기술료 요율", "techFeeRate", true, Math.round(detail.techFeeRate * 100)],
                          ["직접경비 요율", "directExpenseRate", true, Math.round(detail.directExpenseRate * 100)],
                          ["시장 보정계수", "marketAdjust", false, detail.marketAdjust],
                        ] as const
                      ).map(([label, key, isPct, value]) => (
                        <label key={key} className="flex items-center justify-between gap-3" title={key === "marketAdjust" ? "정방향 표준가 가이드에 적용되는 시장 보정계수" : undefined}>
                          <span className="whitespace-nowrap cd-text">{label}</span>
                          <span className="flex items-center gap-1 shrink-0">
                            <input
                              className="cd-input w-20 text-right px-1.5"
                              value={String(value)}
                              onChange={(e) => editRate(key, isPct, e.target.value)}
                            />
                            <span className="w-3 text-left cd-text-faint">{isPct ? "%" : ""}</span>
                          </span>
                        </label>
                      ))}
                    </div>

                    {/* 항목 트리(base_md) */}
                    <div className="rounded-2xl border cd-border-c p-3.5 flex flex-col gap-2">
                      <p className="text-[12px] font-semibold cd-text">업무 항목 트리 (별첨1) — 표준 MD = 역산 분배 가중치</p>
                      {/* 기술등급 축(가변) — 등급을 빼면 그 MD를 남은 등급에 비율대로 재분배한다 */}
                      <div className="flex items-center gap-2 flex-wrap text-[11.5px]">
                        <span className="cd-text-faint">기술등급</span>
                        {(LABOR_GRADES as readonly string[]).map((g) => {
                          const on = detail.grades.includes(g);
                          return (
                            <button
                              key={g}
                              type="button"
                              className={`rounded-lg px-2.5 py-1 border ${on ? "cd-tint-primary border-[color:var(--cd-primary)] cd-text" : "cd-border-c cd-text-faint"}`}
                              onClick={() => toggleGrade(g)}
                            >
                              {g}
                            </button>
                          );
                        })}
                        <span className="text-[10.5px] cd-text-faint">
                          등급 제외 시 해당 MD는 남은 등급에 비율대로 재분배됩니다(합계 보존).
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        {/* 등급 열은 개수와 무관하게 총폭 고정(40%)을 균등 분할 — 3열이든 5열이든 표 폭이 같다 */}
                        <table className="w-full text-[11.5px] border-collapse min-w-[640px] table-fixed">
                          <colgroup>
                            <col style={{ width: "56px" }} />
                            <col />
                            {detail.grades.map((g) => (
                              <col key={g} style={{ width: `${40 / detail.grades.length}%` }} />
                            ))}
                            <col style={{ width: "36px" }} />
                          </colgroup>
                          <thead>
                            <tr>
                              <th className="border cd-border-c px-2 py-1.5 text-left cd-text-faint font-semibold">대항목</th>
                              <th className="border cd-border-c px-2 py-1.5 text-left cd-text-faint font-semibold">항목명</th>
                              {detail.grades.map((g) => (
                                <th key={g} className="border cd-border-c px-2 py-1.5 cd-text-faint font-semibold">{g}</th>
                              ))}
                              <th className="border cd-border-c" />
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r, i) => (
                              <tr key={i} className={r.isParent ? "cd-tint-primary/40" : ""}>
                                <td className="border cd-border-c px-2 py-0.5 text-center">
                                  <input type="checkbox" checked={r.isParent} onChange={(e) => setRows((prev) => prev.map((x, xi) => (xi === i ? { ...x, isParent: e.target.checked } : x)))} />
                                </td>
                                <td className="border cd-border-c px-1 py-0.5">
                                  <input
                                    className={`w-full bg-transparent outline-none px-1 ${r.isParent ? "font-semibold" : "pl-4"}`}
                                    value={r.label}
                                    onChange={(e) => setRows((prev) => prev.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)))}
                                  />
                                </td>
                                {detail.grades.map((g) => (
                                  <td key={g} className="border cd-border-c px-1 py-0.5 text-center">
                                    {r.isParent ? (
                                      <span className="cd-text-faint text-[10px]">소계</span>
                                    ) : (
                                      <input
                                        className="w-full bg-transparent text-center outline-none"
                                        value={String(r.baseMd[g] ?? "")}
                                        placeholder="0"
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          setRows((prev) =>
                                            prev.map((x, xi) => {
                                              if (xi !== i) return x;
                                              const md = { ...x.baseMd };
                                              if (v === "" || Number(v) === 0) delete md[g];
                                              else md[g] = Number(v) || 0;
                                              return { ...x, baseMd: md };
                                            })
                                          );
                                        }}
                                      />
                                    )}
                                  </td>
                                ))}
                                <td className="border cd-border-c text-center">
                                  <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" onClick={() => setRows((prev) => prev.filter((_, xi) => xi !== i))}>
                                    <X className="w-3 h-3" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-1.5 text-[11.5px] cd-text-faint" onClick={() => setRows((prev) => [...prev, { label: "", isParent: false, baseMd: {} }])}>
                          ＋ 행 추가
                        </button>
                        <span className="text-[10.5px] cd-text-faint">세부항목은 위쪽의 가장 가까운 대항목에 소속됩니다. 대항목 MD는 자동 소계.</span>
                      </div>
                    </div>

                    {/* 특이사항 템플릿 */}
                    <div className="rounded-2xl border cd-border-c p-3.5 flex flex-col gap-1.5">
                      <p className="text-[12px] font-semibold cd-text">특이사항 기본 문구 (작성 화면 프리필)</p>
                      <textarea className="cd-input text-[12px] min-h-[76px]" value={detail.remarksTemplate} onChange={(e) => setDetail({ ...detail, remarksTemplate: e.target.value })} />
                    </div>

                    {/* 시뮬레이터 */}
                    <div className="rounded-2xl border cd-border-c p-3.5 flex flex-col gap-2">
                      <p className="text-[12px] font-semibold cd-text flex items-center gap-1.5">
                        <Calculator className="w-3.5 h-3.5 cd-text-primary" /> 역산 시뮬레이터 — 편집 중인 기준·최신 노임단가로 즉석 검증
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <AmountInput className="cd-input w-44 text-right text-sm" placeholder="견적가 (예: 38,000,000)" value={simPrice} onChange={(v) => setSimPrice(v)} />
                        <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold" onClick={runSim}>
                          역산 실행
                        </button>
                        {simPrice && (
                          <span className="text-[11px] cd-text-faint">
                            스냅 {mdSnapUnit(Number(simPrice))}MD · 초과폭 상한 {won(sumOverCap(Number(simPrice)))}원
                          </span>
                        )}
                      </div>
                      {simResult && (
                        <div className="flex items-center gap-3 flex-wrap text-[12px] cd-text">
                          <span>총 <b>{simResult.totalMd}MD</b></span>
                          {detail.grades.map((g) => (
                            <span key={g}>{g} <b>{simResult.totals[g] ?? 0}</b></span>
                          ))}
                          <span>합계 <b>{won(simResult.sum)}</b>원</span>
                          {simResult.ok ? (
                            <span className="text-[11px] rounded-full px-2 py-0.5 cd-tint-primary">제약 OK (초과 {won(simResult.over)}원 &lt; {won(simResult.cap)}원)</span>
                          ) : (
                            <span className="text-[11px] rounded-full px-2 py-0.5 border border-[color:var(--cd-danger,#FA896B)] text-[color:var(--cd-danger,#FA896B)]">⚠ 제약 위반</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "labor" && (
            <div className="flex flex-col gap-4 max-w-[880px]">
              <div className="overflow-x-auto">
                <table className="w-full text-[12px] border-collapse min-w-[640px]">
                  <thead>
                    <tr>
                      <th className="border cd-border-c px-2 py-1.5 cd-text-faint font-semibold w-20">연도</th>
                      {LABOR_GRADES.map((g) => (
                        <th key={g} className="border cd-border-c px-2 py-1.5 cd-text-faint font-semibold">{g}(원/일)</th>
                      ))}
                      <th className="border cd-border-c w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(laborYears).sort().reverse().map((y) => (
                      <tr key={y}>
                        <td className="border cd-border-c px-2 py-1 text-center font-mono">{y}</td>
                        {LABOR_GRADES.map((g) => (
                          <td key={g} className="border cd-border-c px-1 py-0.5">
                            <AmountInput
                              className="w-full bg-transparent text-right outline-none px-1"
                              value={laborYears[y].rates[g] != null ? laborYears[y].rates[g] : ""}
                              placeholder=""
                              onChange={(v) =>
                                setLaborYears((prev) => ({
                                  ...prev,
                                  [y]: { ...prev[y], rates: { ...prev[y].rates, [g]: Number(v) || 0 } },
                                }))
                              }
                            />
                          </td>
                        ))}
                        <td className="border cd-border-c text-center">
                          <button type="button" className="text-[11px] cd-text-primary font-semibold disabled:opacity-50" disabled={busy} onClick={() => void saveLaborYear(y)}>
                            저장
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-1.5 text-[11.5px] cd-text-faint self-start"
                onClick={() => {
                  const y = window.prompt("추가할 연도(YYYY)를 입력하세요.", String(new Date().getFullYear() + 1));
                  if (y && /^\d{4}$/.test(y) && !laborYears[y]) setLaborYears((prev) => ({ ...prev, [y]: { rates: {}, sourceNote: "" } }));
                }}
              >
                ＋ 연도 추가
              </button>
              <div className="rounded-2xl border cd-border-c p-3.5">
                <p className="text-[12px] font-semibold cd-text mb-1.5">자동 수집 로그 — 매년 1월 당해 연도 확보까지 하루 1회 시도</p>
                {syncLog.length === 0 ? (
                  <p className="text-[11.5px] cd-text-faint">아직 자동 수집 시도 이력이 없습니다.</p>
                ) : (
                  syncLog.map((l, i) => (
                    <p key={i} className="text-[11.5px] cd-text-faint">
                      {l.triedDate} · {l.year}년 · {l.ok ? <span className="cd-text-primary font-semibold">성공</span> : "실패"}
                      {l.sourceUrl ? ` · ${l.sourceUrl}` : ""}{l.detail ? ` · ${l.detail}` : ""}
                    </p>
                  ))
                )}
              </div>
            </div>
          )}

          {tab === "codes" && (
            <div className="flex flex-col gap-2.5 max-w-[560px]">
              {codes.map((c, i) => (
                // .cd-input 은 width:100% 라 폭은 인라인으로 못박는다(그러지 않으면 코드 칸이 라벨 칸을 밀어낸다)
                <div key={i} className="flex items-center gap-2">
                  <input className="cd-input font-mono text-[12px] shrink-0" style={{ width: "9rem" }} value={c.code} placeholder="코드" onChange={(e) => setCodes((prev) => prev.map((x, xi) => (xi === i ? { ...x, code: e.target.value } : x)))} />
                  <input className="cd-input text-sm flex-1 min-w-0" style={{ width: "auto" }} value={c.label} placeholder="라벨" onChange={(e) => setCodes((prev) => prev.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)))} />
                  <label className="flex items-center gap-1 text-[11.5px] cd-text-faint whitespace-nowrap shrink-0">
                    <input type="checkbox" className="shrink-0" checked={c.enabled} onChange={(e) => setCodes((prev) => prev.map((x, xi) => (xi === i ? { ...x, enabled: e.target.checked } : x)))} /> 사용
                  </label>
                  <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" onClick={() => setCodes((prev) => prev.filter((_, xi) => xi !== i))}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <button type="button" className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-1.5 text-[11.5px] cd-text-faint" onClick={() => setCodes((prev) => [...prev, { code: "", label: "", enabled: true }])}>
                  ＋ 코드 추가
                </button>
                <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50" disabled={busy} onClick={() => void saveCodes()}>
                  <Save className="w-3.5 h-3.5 inline" /> 저장
                </button>
              </div>
            </div>
          )}

          {tab === "report" && (
            <div className="flex flex-col gap-4">
              {/* 기간 필터 */}
              {/* 기간 = 시작·종료 월 2칸. .cd-input 은 width:100% 라 폭을 명시해야 한 줄에 나란히 선다 */}
              <div className="flex items-center gap-2 flex-wrap text-[12px]">
                <span className="cd-text whitespace-nowrap">기간</span>
                <AutoDateInput
                  mode="month"
                  className="cd-input text-[12px] shrink-0"
                  style={{ width: "9rem" }}
                  value={reportRange.from}
                  onChange={(next) => setReportRange((r) => ({ ...r, from: next }))}
                />
                <span className="cd-text-faint">~</span>
                <AutoDateInput
                  mode="month"
                  className="cd-input text-[12px] shrink-0"
                  style={{ width: "9rem" }}
                  value={reportRange.to}
                  onChange={(next) => setReportRange((r) => ({ ...r, to: next }))}
                />
                <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={reportLoading} onClick={() => void loadReport()}>
                  {reportLoading ? "조회 중..." : "조회"}
                </button>
                <span className="text-[11px] cd-text-faint">발송(또는 생성) 완료된 견적만 집계 · 수주율 모수 = 수주+실주(중단·진행 중 제외)</span>
              </div>

              {!report ? (
                <p className="text-sm cd-text-faint">{reportLoading ? "조회 중입니다." : "조회 결과가 없습니다."}</p>
              ) : (
                <>
                  {/* KPI */}
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
                    {(
                      [
                        ["견적 건수", `${report.kpi.total}건`, `진행 중 ${report.kpi.pending} · 중단 ${report.kpi.dropped}`],
                        ["결과 확정", `${report.kpi.decided}건`, `수주 ${report.kpi.won} · 실주 ${report.kpi.lost}`],
                        ["수주율(건)", pct(report.kpi.winRate), report.kpi.decided ? `모수 ${report.kpi.decided}건` : "표본 없음"],
                        ["수주율(금액)", pct(report.kpi.amountWinRate), `수주 ${won(report.kpi.wonAmount)}원`],
                        ["견적 총액", `${won(report.kpi.quotedAmount)}원`, "VAT 별도"],
                        ["평균 결정 소요", report.kpi.avgDecideDays != null ? `${report.kpi.avgDecideDays}일` : "-", "견적일→결과 확정일"],
                      ] as const
                    ).map(([label, value, hint]) => (
                      <div key={label} className="rounded-2xl border cd-border-c p-3 flex flex-col gap-0.5">
                        <span className="text-[10.5px] cd-text-faint">{label}</span>
                        <span className="text-[16px] font-bold cd-text">{value}</span>
                        <span className="text-[10px] cd-text-faint">{hint}</span>
                      </div>
                    ))}
                  </div>

                  {/* 세분류별 */}
                  <BucketTable title="세분류별 수주율" buckets={report.bySubtype} />

                  {/* 상황 변수별 · 금액 구간별 */}
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <BucketTable title="상황 변수별 수주율 — 한 건에 여러 코드가 붙으면 중복 집계" buckets={report.bySituation} compact />
                    <BucketTable title="금액 구간별 수주율" buckets={report.byAmountBand} compact />
                  </div>

                  {/* 보정계수 제안 */}
                  <div className="rounded-2xl border cd-border-c p-3.5 flex flex-col gap-2">
                    <p className="text-[12px] font-semibold cd-text">시장 보정계수 제안 — 실주 건의 (경쟁 낙찰가 / 자사 견적가) 중앙값 기반</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11.5px] border-collapse min-w-[720px]">
                        <thead>
                          <tr>
                            <th className="border cd-border-c px-2 py-1.5 text-left cd-text-faint font-semibold">세분류</th>
                            <th className="border cd-border-c px-2 py-1.5 cd-text-faint font-semibold w-20">표본</th>
                            <th className="border cd-border-c px-2 py-1.5 cd-text-faint font-semibold w-24">현재 계수</th>
                            <th className="border cd-border-c px-2 py-1.5 cd-text-faint font-semibold w-24">제안 계수</th>
                            <th className="border cd-border-c px-2 py-1.5 text-left cd-text-faint font-semibold">근거</th>
                            <th className="border cd-border-c w-20" />
                          </tr>
                        </thead>
                        <tbody>
                          {report.suggestions.map((s) => (
                            <tr key={`${s.serviceType}/${s.serviceSubtype}`}>
                              <td className="border cd-border-c px-2 py-1.5 cd-text">{s.serviceType} · {s.serviceSubtype}</td>
                              <td className="border cd-border-c px-2 py-1.5 text-center cd-text-faint">{s.samples}</td>
                              <td className="border cd-border-c px-2 py-1.5 text-center cd-text">{s.currentAdjust ?? "-"}</td>
                              <td className="border cd-border-c px-2 py-1.5 text-center font-semibold cd-text-primary">{s.suggestAdjust ?? "-"}</td>
                              <td className="border cd-border-c px-2 py-1.5 cd-text-faint">{s.reason}</td>
                              <td className="border cd-border-c px-2 py-1 text-center">
                                {s.setId && s.suggestAdjust != null && (
                                  <button
                                    type="button"
                                    className="cd-btn rounded-lg border cd-border-c px-2 py-1 text-[10.5px] disabled:opacity-50"
                                    disabled={busy}
                                    onClick={() => void applySuggestion(s.setId as string, s.suggestAdjust as number)}
                                  >
                                    반영
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                          {report.suggestions.length === 0 && (
                            <tr>
                              <td colSpan={6} className="border cd-border-c px-2 py-4 text-center cd-text-faint">집계할 견적이 없습니다.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
