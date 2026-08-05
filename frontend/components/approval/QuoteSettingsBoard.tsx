"use client";

// 견적 기준 관리(/approval/quote/settings, Q4) — 권한 approval.manage.
// 탭: ①기준 세트(세분류별 항목 트리·base_md·요율·특이사항·인자·규모구간 편집 + 역산 시뮬레이터)
//     ②노임단가(연도별×등급별, 자동 수집 로그) ③상황 변수 코드.
// 세트 수정은 기존 견적을 훼손하지 않는다(견적서에 산정 당시 스냅샷 박제).

import { useCallback, useEffect, useState } from "react";
import { Calculator, ChevronDown, ChevronRight, Coins, Plus, Save, Settings2, Tag, Trash2, X } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import {
  LABOR_GRADES,
  MD_GRADES,
  QUOTE_SERVICE_OPTIONS,
  mdSnapUnit,
  sumOverCap,
  type QuoteWorkItem,
} from "@/lib/quote/types";
import { gradeTotals, mdVectorTotal, reverseAllocate, validateSumConstraint } from "@/lib/quote/rates";
import "@/components/cdash/cdash.css";

type Tab = "sets" | "labor" | "codes";

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
  remarksTemplate: string;
  items: { itemId: string; parentId: string | null; label: string; baseMd: Record<string, number> }[];
  factors: { factorKey: string; label: string; unit: string }[];
  bands: { factorKey: string; minVal: number; maxVal: number | null; coef: number }[];
}

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

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
    setDetail(d);
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

  const editRate = (key: "overheadRate" | "techFeeRate" | "directExpenseRate" | "marketAdjust", pct: boolean, value: string) => {
    if (!detail) return;
    const n = Number(value);
    setDetail({ ...detail, [key]: pct ? (isNaN(n) ? 0 : n / 100) : isNaN(n) ? 1 : n });
  };

  return (
    <div className="cdash cd-fields-white min-h-screen" data-theme={theme}>
      <div className="px-5 md:px-8 py-6 max-w-[1500px] mx-auto flex flex-col gap-5">
        <CdPageHeader title="견적 기준 관리" />
        <div className="cd-card rounded-3xl p-5 flex flex-col gap-4 min-h-0">
          {/* 탭 */}
          <div className="flex items-end gap-1 px-1 -mb-1">
            {(
              [
                ["sets", "기준 세트", Settings2],
                ["labor", "노임단가", Coins],
                ["codes", "상황 변수", Tag],
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
                    <div className="rounded-2xl border cd-border-c p-3.5 flex items-center gap-4 flex-wrap text-[12px]">
                      <label className="flex items-center gap-1.5">제경비율
                        <input className="cd-input w-16 text-right" value={String(Math.round(detail.overheadRate * 100))} onChange={(e) => editRate("overheadRate", true, e.target.value)} />%
                      </label>
                      <label className="flex items-center gap-1.5">기술료율
                        <input className="cd-input w-16 text-right" value={String(Math.round(detail.techFeeRate * 100))} onChange={(e) => editRate("techFeeRate", true, e.target.value)} />%
                      </label>
                      <label className="flex items-center gap-1.5">직접경비율
                        <input className="cd-input w-16 text-right" value={String(Math.round(detail.directExpenseRate * 100))} onChange={(e) => editRate("directExpenseRate", true, e.target.value)} />%
                      </label>
                      <label className="flex items-center gap-1.5" title="정방향 표준가 가이드에 적용되는 시장 보정계수">시장 보정계수
                        <input className="cd-input w-16 text-right" value={String(detail.marketAdjust)} onChange={(e) => editRate("marketAdjust", false, e.target.value)} />
                      </label>
                    </div>

                    {/* 항목 트리(base_md) */}
                    <div className="rounded-2xl border cd-border-c p-3.5 flex flex-col gap-2">
                      <p className="text-[12px] font-semibold cd-text">업무 항목 트리 (별첨1) — 표준 MD = 역산 분배 가중치</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11.5px] border-collapse min-w-[640px]">
                          <thead>
                            <tr>
                              <th className="border cd-border-c px-2 py-1.5 text-left cd-text-faint font-semibold w-16">대항목</th>
                              <th className="border cd-border-c px-2 py-1.5 text-left cd-text-faint font-semibold">항목명</th>
                              {MD_GRADES.map((g) => (
                                <th key={g} className="border cd-border-c px-2 py-1.5 cd-text-faint font-semibold w-20">{g}</th>
                              ))}
                              <th className="border cd-border-c w-9" />
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
                                {MD_GRADES.map((g) => (
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
                        <input className="cd-input w-44 text-right text-sm" inputMode="numeric" placeholder="견적가 (예: 38000000)" value={simPrice} onChange={(e) => setSimPrice(e.target.value.replace(/[^\d]/g, ""))} />
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
                          {MD_GRADES.map((g) => (
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
                            <input
                              className="w-full bg-transparent text-right outline-none px-1"
                              value={laborYears[y].rates[g] != null ? String(laborYears[y].rates[g]) : ""}
                              onChange={(e) =>
                                setLaborYears((prev) => ({
                                  ...prev,
                                  [y]: { ...prev[y], rates: { ...prev[y].rates, [g]: Number(e.target.value.replace(/[^\d]/g, "")) || 0 } },
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
                <div key={i} className="flex items-center gap-2">
                  <input className="cd-input w-36 font-mono text-[12px]" value={c.code} placeholder="코드" onChange={(e) => setCodes((prev) => prev.map((x, xi) => (xi === i ? { ...x, code: e.target.value } : x)))} />
                  <input className="cd-input flex-1 text-sm" value={c.label} placeholder="라벨" onChange={(e) => setCodes((prev) => prev.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)))} />
                  <label className="flex items-center gap-1 text-[11.5px] cd-text-faint">
                    <input type="checkbox" checked={c.enabled} onChange={(e) => setCodes((prev) => prev.map((x, xi) => (xi === i ? { ...x, enabled: e.target.checked } : x)))} /> 사용
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
        </div>
      </div>
    </div>
  );
}
