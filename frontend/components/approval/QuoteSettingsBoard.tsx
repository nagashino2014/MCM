"use client";

// 견적 기준 관리(/approval/quote/settings, Q4·Q5) — 권한 approval.manage.
// 탭: ①기준 세트(표준)(세분류별 항목 트리·base_md·요율·특이사항·인자·규모구간 편집 + 역산 시뮬레이터)
//     ①-2 기준 세트(개별)(270 — 같은 편집기를 특정 사업장 전용 세트에. 상단에 전용 세트 보유 사업장 태그 목록)
//     ②노임단가(연도별×등급별, 자동 수집 로그) ③상황 변수 코드
//     ④수주 분석(Q5 — 수주율·상황변수·금액구간 집계 + 시장 보정계수 제안·1클릭 반영).
// 세트 수정은 기존 견적을 훼손하지 않는다(견적서에 산정 당시 스냅샷 박제).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BarChart3, Building2, Calculator, ChevronDown, ChevronRight, Coins, Plus, Save, Search, Settings2, Tag, Trash2, X } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdTabs } from "@/components/cdash/CdTabs";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import { AmountInput } from "@/components/ui/AmountInput";
import { QuoteItemTreeEditor } from "@/components/approval/QuoteItemTreeEditor";
import {
  DEFAULT_MD_GRADES,
  LABOR_GRADES,
  QUOTE_MULTI_SUBTYPE,
  QUOTE_SERVICE_OPTIONS,
  treeRowsToWorkItems,
  workItemsToTreeRows,
  mdSnapUnit,
  sortGrades,
  sumOverCap,
  type QuoteReport,
  type QuoteReportBucket,
  type QuoteTreeRow,
} from "@/lib/quote/types";
import { gradeTotals, mdVectorTotal, reverseAllocate, validateSumConstraint } from "@/lib/quote/rates";
import "@/components/cdash/cdash.css";

type Tab = "sets" | "fsets" | "labor" | "codes" | "report";

interface SetSummary {
  setId: string;
  serviceType: string;
  serviceSubtype: string;
  version: number;
  itemCount: number;
  /** 사업장 전용 세트(270)면 그 사업장. 표준 세트는 null */
  facilityId?: string | null;
  facilityName?: string | null;
}

// 대항목 여부(isParent) — 저장 시 parentIdx 재구성(직전 대항목)
type ItemRow = QuoteTreeRow;

interface FacilityRef {
  facilityId: string;
  name: string;
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
    <div className="rounded-2xl border cd-border-c p-3.5 flex flex-col gap-3 min-w-0">
      <p className="text-[12px] font-semibold cd-text">{title}</p>
      <div className={compact ? "" : "overflow-x-auto"}>
        <table className={`w-full ${fs} border-collapse table-fixed ${compact ? "" : "min-w-[560px]"}`}>
          <colgroup>
            {widths.map((w, i) => (
              <col key={i} style={w ? { width: w } : undefined} />
            ))}
          </colgroup>
          <thead className="cd-table-head">
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
  // 기준 세트(개별) — 사업장 전용 세트 전체, 선택한 사업장, 세트를 아직 만들지 않은 추가 사업장
  const [fsets, setFsets] = useState<SetSummary[]>([]);
  const [facility, setFacility] = useState<FacilityRef | null>(null);
  const [extraFacilities, setExtraFacilities] = useState<FacilityRef[]>([]);
  const [facQ, setFacQ] = useState("");
  const [facItems, setFacItems] = useState<{ facilityId: string; companyName: string; siteAddress?: string | null }[]>([]);
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
    const [res, fres] = await Promise.all([
      fetch("/api/quotes/admin/rate-sets", { cache: "no-store" }),
      fetch("/api/quotes/admin/rate-sets?scope=facility", { cache: "no-store" }),
    ]);
    if (res.ok) setSets((await res.json()).sets ?? []);
    if (fres.ok) setFsets((await fres.json()).sets ?? []);
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

  // 개별 탭은 선택한 사업장의 전용 세트만 본다(사업장 미선택이면 없음)
  const isFacilityTab = tab === "fsets";
  const setOf = useCallback(
    (t: string, s: string) =>
      (isFacilityTab ? fsets.filter((x) => facility != null && x.facilityId === facility.facilityId) : sets).find(
        (x) => x.serviceType === t && x.serviceSubtype === s
      ) ?? null,
    [sets, fsets, isFacilityTab, facility]
  );

  // 전용 세트 보유 사업장(+ 방금 추가해 아직 세트가 없는 사업장) — 개별 탭 상단 태그 목록
  const facilityTags: (FacilityRef & { sets: SetSummary[] })[] = (() => {
    const map = new Map<string, FacilityRef & { sets: SetSummary[] }>();
    for (const s of fsets) {
      if (!s.facilityId) continue;
      const cur = map.get(s.facilityId) ?? { facilityId: s.facilityId, name: s.facilityName ?? s.facilityId, sets: [] };
      cur.sets.push(s);
      map.set(s.facilityId, cur);
    }
    for (const f of extraFacilities) if (!map.has(f.facilityId)) map.set(f.facilityId, { ...f, sets: [] });
    return [...map.values()];
  })();

  const resetEditor = useCallback(() => {
    setSelected(null);
    setDetail(null);
    setRows([]);
    setSimResult(null);
  }, []);

  // 사업장 검색(개별 탭 — 전용 세트를 만들 사업장 추가)
  useEffect(() => {
    if (facQ.trim().length < 2) {
      setFacItems([]);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(() => {
      const params = new URLSearchParams({ q: facQ.trim(), limit: "15", sort: "name" });
      fetch(`/api/facilities?${params.toString()}`, { cache: "no-store", signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setFacItems(Array.isArray(d?.items) ? d.items : []))
        .catch(() => {});
    }, 160);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [facQ]);

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
    setRows(workItemsToTreeRows(d.items));
  }, [setOf]);

  const createSet = useCallback(
    async (copyFromSetId?: string) => {
      if (!selected) return;
      setBusy(true);
      try {
        const res = await fetch("/api/quotes/admin/rate-sets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...selected, copyFromSetId, facilityId: isFacilityTab ? facility?.facilityId : undefined }),
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
    [selected, loadSets, openSet, isFacilityTab, facility]
  );

  // sets 갱신 후 재선택 시 setOf가 새 목록을 보도록 — openSet은 sets 의존
  useEffect(() => {
    if (selected && !detail) {
      const s = setOf(selected.serviceType, selected.serviceSubtype);
      if (s) void openSet(selected.serviceType, selected.serviceSubtype);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sets, fsets, facility]);

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
    const msg = isFacilityTab
      ? `[${facility?.name ?? ""} · ${detail.serviceType} > ${detail.serviceSubtype}] 사업장 전용 기준 세트를 삭제할까요?\n이 사업장은 표준 기준 세트로 동작하게 됩니다.`
      : `[${detail.serviceType} > ${detail.serviceSubtype}] 기준 세트를 삭제할까요?\n이 세분류는 자유 입력형으로 동작하게 됩니다.`;
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      await fetch(`/api/quotes/admin/rate-sets/${encodeURIComponent(detail.setId)}`, { method: "DELETE" });
      setDetail(null);
      setRows([]);
      await loadSets();
    } finally {
      setBusy(false);
    }
  }, [detail, loadSets, isFacilityTab, facility]);

  /** 역산 시뮬레이터 — 현재 편집 중인 트리·요율·최신 노임단가로 즉석 계산 */
  const runSim = useCallback(() => {
    if (!detail) return;
    const price = Number(simPrice.replace(/[^\d]/g, ""));
    if (!price) return alert("견적가를 입력하세요.");
    const items = treeRowsToWorkItems(rows, "sim");
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
            grades: d.grades, // 빠지면 서버가 기본 4종으로 되돌린다(143)
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
          {/* 탭 — 페이지 탭은 공통 밑줄형(UI 기준 §4) */}
          <CdTabs<Tab>
            active={tab}
            onChange={(next) => {
              // 표준·개별 탭은 같은 편집기를 쓰므로 탭을 옮기면 편집 중이던 선택을 비운다
              if (next !== tab && (next === "sets" || next === "fsets" || tab === "sets" || tab === "fsets")) resetEditor();
              setTab(next);
            }}
            items={[
              { key: "sets", label: "기준 세트(표준)", icon: <Settings2 className="w-3.5 h-3.5" /> },
              { key: "fsets", label: "기준 세트(개별)", icon: <Building2 className="w-3.5 h-3.5" /> },
              { key: "labor", label: "노임단가", icon: <Coins className="w-3.5 h-3.5" /> },
              { key: "codes", label: "상황 변수", icon: <Tag className="w-3.5 h-3.5" /> },
              { key: "report", label: "수주 분석", icon: <BarChart3 className="w-3.5 h-3.5" /> },
            ]}
          />

          {/* 기준 세트(개별) 상단 — 전용 세트가 있는 사업장 태그 목록(탭 전체 너비). 사업장 태그 안에 세분류별 세트 태그 */}
          {tab === "fsets" && (
            <div className="rounded-2xl border cd-border-c p-3.5 flex flex-col gap-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[12px] font-semibold cd-text">사업장 전용 기준 세트</p>
                <span className="text-[10.5px] cd-text-faint">
                  전용 세트가 있는 사업장은 견적서 작성 시 표준 세트 대신 적용할 수 있습니다(수신처 사업장 기준).
                </span>
              </div>
              {facilityTags.length === 0 ? (
                <p className="text-[11.5px] cd-text-faint">전용 기준 세트가 설정된 사업장이 없습니다. 아래에서 사업장을 검색해 추가하세요.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {facilityTags.map((f) => {
                    const active = facility?.facilityId === f.facilityId;
                    return (
                      <div
                        key={f.facilityId}
                        className={`rounded-lg border px-2.5 py-1.5 flex items-center gap-1.5 flex-wrap ${active ? "cd-tint-primary border-[color:var(--cd-primary)]" : "cd-border-c"}`}
                      >
                        <button
                          type="button"
                          aria-pressed={active}
                          className="cd-action text-[12px] font-semibold cd-text flex items-center gap-1"
                          onClick={() => {
                            if (!active) resetEditor();
                            setFacility({ facilityId: f.facilityId, name: f.name });
                          }}
                        >
                          <Building2 className="w-3.5 h-3.5 cd-text-primary" /> {f.name}
                        </button>
                        {f.sets.length === 0 ? (
                          <span className="text-[10px] rounded-lg px-1.5 py-0.5 border border-dashed cd-border-c cd-text-faint">세트 없음</span>
                        ) : (
                          f.sets.map((s) => (
                            <button
                              key={s.setId}
                              type="button"
                              className="cd-action text-[10px] rounded-lg px-1.5 py-0.5 border cd-border-c cd-text"
                              title={`${s.serviceType} > ${s.serviceSubtype} — 기준 ${s.itemCount}행`}
                              onClick={() => {
                                // 사업장을 바꾸면 setOf 가 다음 렌더에 갱신되므로 선택만 걸어 두고 세트 로드는 effect 가 한다
                                setFacility({ facilityId: f.facilityId, name: f.name });
                                setDetail(null);
                                setRows([]);
                                setSimResult(null);
                                setSelected({ serviceType: s.serviceType, serviceSubtype: s.serviceSubtype });
                              }}
                            >
                              {s.serviceSubtype}
                            </button>
                          ))
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="relative max-w-[420px]">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 cd-text-faint pointer-events-none" />
                <input
                  className="cd-input w-full text-[12px]"
                  style={{ paddingLeft: 36 }}
                  placeholder="사업장 추가 — 업체명 2자 이상 검색"
                  aria-label="전용 기준 세트를 만들 사업장 검색"
                  value={facQ}
                  onChange={(e) => setFacQ(e.target.value)}
                />
                {facItems.length > 0 && (
                  <ul className="absolute z-20 left-0 right-0 mt-1 rounded-lg border cd-border-c bg-[color:var(--cd-card)] max-h-[240px] overflow-y-auto">
                    {facItems.map((o) => (
                      <li key={o.facilityId}>
                        <button
                          type="button"
                          className="w-full text-left px-3 py-1.5 text-[12px] cd-row-hover flex items-center gap-2"
                          onClick={() => {
                            const ref = { facilityId: o.facilityId, name: o.companyName };
                            setExtraFacilities((prev) => (prev.some((x) => x.facilityId === ref.facilityId) ? prev : [...prev, ref]));
                            resetEditor();
                            setFacility(ref);
                            setFacQ("");
                            setFacItems([]);
                          }}
                        >
                          <span className="cd-text font-semibold whitespace-nowrap">{o.companyName}</span>
                          {o.siteAddress && <span className="cd-text-faint truncate">{o.siteAddress}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {(tab === "sets" || tab === "fsets") && (
            <div className="flex flex-col lg:flex-row gap-4 items-start">
              {/* 좌: 세분류 리스트 */}
              <div className="w-full lg:w-[260px] shrink-0 flex flex-col gap-2.5">
                {QUOTE_SERVICE_OPTIONS.map((g) => (
                  <div key={g.type} className="rounded-2xl border cd-border-c p-2.5">
                    <p className="text-[11px] font-bold cd-text-faint px-1 mb-1">{g.type}</p>
                    <div className="flex flex-col">
                      {/* 개별 탭에는 '복수 업무'도 둔다 — 견적서 작성에서 저장한 사업장 전용 복수 업무 세트 */}
                      {(isFacilityTab ? [...g.subtypes, QUOTE_MULTI_SUBTYPE] : g.subtypes).map((s) => {
                        const has = setOf(g.type, s);
                        const active = selected?.serviceType === g.type && selected?.serviceSubtype === s;
                        return (
                          <button
                            key={s}
                            type="button"
                            className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-left disabled:opacity-50 ${active ? "cd-tint-primary font-semibold" : "cd-row-hover"}`}
                            disabled={isFacilityTab && !facility}
                            onClick={() => void openSet(g.type, s)}
                          >
                            {active ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3 cd-text-faint" />}
                            <span className="flex-1">{s}</span>
                            {has ? (
                              <span className="text-[9.5px] rounded-full px-1.5 py-0.5 cd-tint-primary">기준 {has.itemCount}행</span>
                            ) : (
                              <span className="text-[9.5px] rounded-full px-1.5 py-0.5 border cd-border-c cd-text-faint">{isFacilityTab ? "표준 적용" : "자유입력"}</span>
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
                {isFacilityTab && !facility ? (
                  <p className="text-sm cd-text-faint p-6">위에서 사업장을 선택하거나 검색해 추가하세요. 선택한 사업장의 세분류별 전용 기준 세트를 설정합니다.</p>
                ) : !selected ? (
                  <p className="text-sm cd-text-faint p-6">
                    {isFacilityTab
                      ? `좌측에서 세분류를 선택하세요. [${facility?.name}] 전용 세트가 없는 세분류는 표준 기준 세트로 동작합니다.`
                      : "좌측에서 세분류를 선택하세요. 기준 세트가 없는 세분류는 자유 입력형(품목 직접 입력)으로 동작합니다."}
                  </p>
                ) : !detail ? (
                  <div className="rounded-2xl border border-dashed cd-border-c p-8 flex flex-col items-center gap-3">
                    <p className="text-sm cd-text">
                      {isFacilityTab && <b>{facility?.name} · </b>}
                      <b>{selected.serviceType} &gt; {selected.serviceSubtype}</b> — {isFacilityTab ? "전용 기준 세트가 없습니다(표준 세트 적용)." : "기준 세트가 없습니다(자유 입력형)."}
                    </p>
                    <div className="flex items-center gap-2">
                      <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50" disabled={busy} onClick={() => void createSet()}>
                        <Plus className="w-3.5 h-3.5 inline" /> 빈 세트 생성
                      </button>
                      {sets.length + (isFacilityTab ? fsets.length : 0) > 0 && (
                        <select
                          className="cd-select text-xs"
                          defaultValue=""
                          disabled={busy}
                          onChange={(e) => e.target.value && void createSet(e.target.value)}
                          title="기존 세트를 복제해 시작"
                        >
                          <option value="">기존 세트 복제...</option>
                          {sets.map((s) => (
                            <option key={s.setId} value={s.setId}>{isFacilityTab ? "표준 · " : ""}{s.serviceType} &gt; {s.serviceSubtype}</option>
                          ))}
                          {isFacilityTab &&
                            fsets.map((s) => (
                              <option key={s.setId} value={s.setId}>{s.facilityName} · {s.serviceType} &gt; {s.serviceSubtype}</option>
                            ))}
                        </select>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold cd-text text-sm">{isFacilityTab && facility ? `${facility.name} · ` : ""}{detail.serviceType} &gt; {detail.serviceSubtype}</h3>
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
                    <div className="rounded-2xl border cd-border-c p-3.5 flex flex-col gap-3">
                      <p className="text-[12px] font-semibold cd-text">업무 항목 트리 (별첨1) — 표준 MD = 역산 분배 가중치</p>
                      <QuoteItemTreeEditor
                        grades={detail.grades}
                        rows={rows}
                        onGradesChange={(next) => setDetail((d) => (d ? { ...d, grades: next } : d))}
                        onRowsChange={setRows}
                      />
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
                  <thead className="cd-table-head">
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
                  <div className="rounded-2xl border cd-border-c p-3.5 flex flex-col gap-3">
                    <p className="text-[12px] font-semibold cd-text">시장 보정계수 제안 — 실주 건의 (경쟁 낙찰가 / 자사 견적가) 중앙값 기반</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11.5px] border-collapse min-w-[720px]">
                        <thead className="cd-table-head">
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
