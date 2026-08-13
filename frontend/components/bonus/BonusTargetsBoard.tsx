"use client";

import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import {
  BONUS_CATEGORIES,
  BONUS_TARGET_DEPT_IDS,
  DEFAULT_DEPT_HEAD_ENABLED,
  type BonusCategoryKey,
  type BonusSettings,
  type BonusTargetRow,
} from "@/lib/bonus/shared";

/** 본부장 비율이 비어 있으면 기본 활성 부서(연구소 제외)를 0% 로 깔아준다 — 키 존재 = 활성. */
function withDefaultHeadRates(s: BonusSettings): BonusSettings {
  if (Object.keys(s.deptHeadRates).length > 0) return s;
  return { ...s, deptHeadRates: Object.fromEntries(DEFAULT_DEPT_HEAD_ENABLED.map((id) => [id, 0])) };
}

interface DeptOption {
  deptId: string;
  deptName: string;
}

const DEFAULT_APPLY_RATE = 4;

function fmtAmount(v: number): string {
  return Math.round(v).toLocaleString();
}

function fmtDate(v: string | null): string {
  return v ? v.slice(0, 10) : "-";
}

export default function BonusTargetsBoard() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [half, setHalf] = useState<"H1" | "H2">(now.getMonth() < 6 ? "H1" : "H2");
  const [category, setCategory] = useState<BonusCategoryKey>("integrated");
  const [tab, setTab] = useState<"list" | "costs">("list");
  const [targets, setTargets] = useState<BonusTargetRow[]>([]);
  const [settings, setSettings] = useState<BonusSettings | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [costDrafts, setCostDrafts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const period = `${year}-${half}`;

  useEffect(() => {
    fetch("/api/departments", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const list: DeptOption[] = (d.departments ?? []).filter((dept: DeptOption) =>
          BONUS_TARGET_DEPT_IDS.includes(dept.deptId)
        );
        setDepartments(list);
      })
      .catch(() => setDepartments([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    setMsg(null);
    Promise.all([
      fetch(`/api/bonus/targets?period=${period}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/bonus/settings?period=${period}`, { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([t, s]) => {
        const rows: BonusTargetRow[] = t.targets ?? [];
        setTargets(rows);
        setSettings(s.settings ? withDefaultHeadRates(s.settings) : null);
        setCanEdit(Boolean(s.canEdit));
        setCostDrafts(
          Object.fromEntries(rows.map((row) => [row.contractId, row.salesCostAmount]))
        );
      })
      .catch(() => {
        setTargets([]);
        setSettings(null);
      })
      .finally(() => setLoading(false));
  }, [period]);

  const yearOptions = useMemo(() => {
    const y = now.getFullYear();
    return [y + 1, y, y - 1, y - 2];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () => targets.filter((t) => t.category === category),
    [targets, category]
  );
  const maxStages = useMemo(
    () => filtered.reduce((acc, t) => Math.max(acc, t.stages.length), 0),
    [filtered]
  );

  // 총 지급대상 기준액 = 전체(분류 무관) 반기 적용금액 합 × 적용비율
  const applyRate = settings?.applyRate ?? DEFAULT_APPLY_RATE;
  const totalApplied = useMemo(
    () => targets.reduce((acc, t) => acc + t.appliedInPeriod, 0),
    [targets]
  );
  const totalTarget = (totalApplied * applyRate) / 100;

  const patchSettings = (patch: Partial<BonusSettings>) =>
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));

  const saveSettings = async () => {
    if (!settings) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/bonus/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period,
          applyRate: settings.applyRate,
          contribSupportPct: settings.contribSupportPct,
          contribExecPct: settings.contribExecPct,
          deptHeadRates: settings.deptHeadRates,
          absoluteGrading: settings.absoluteGrading,
          gradeCaps: settings.gradeCaps,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "설정 저장에 실패했습니다.");
      setMsg("설정이 저장되었습니다.");
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const resetSettings = () =>
    patchSettings({
      applyRate: DEFAULT_APPLY_RATE,
      contribSupportPct: 0,
      contribExecPct: 0,
      deptHeadRates: Object.fromEntries(DEFAULT_DEPT_HEAD_ENABLED.map((id) => [id, 0])),
    });

  const saveCosts = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const rows = filtered.map((t) => ({
        contractId: t.contractId,
        salesCostAmount: costDrafts[t.contractId] ?? t.salesCostAmount,
      }));
      const res = await fetch("/api/bonus/costs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "제비용 저장에 실패했습니다.");
      setMsg("제비용이 저장되었습니다.");
      // 영업비용 반영액(netFactor)이 바뀌므로 다시 로드
      const t = await fetch(`/api/bonus/targets?period=${period}`, { cache: "no-store" }).then((r) => r.json());
      setTargets(t.targets ?? []);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const periodLabel = `${year}년 ${half === "H1" ? "상반기" : "하반기"}`;

  return (
    <>
      <CdPageHeader
        title="지급 대상 LIST"
        actions={
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs cd-text-faint whitespace-nowrap">대상 :</span>
            <select className="cd-select text-sm" style={{ minWidth: 100 }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
            <select className="cd-select text-sm" value={half} onChange={(e) => setHalf(e.target.value as "H1" | "H2")}>
              <option value="H1">상반기</option>
              <option value="H2">하반기</option>
            </select>
          </div>
        }
      />

      <div className="flex flex-1 min-h-0 gap-4">
        {/* 좌측 설정 사이드바 */}
        <aside className="w-60 shrink-0 flex flex-col gap-4 overflow-y-auto scrollbar-hide">
          <section className="cd-card rounded-3xl p-4 cd-reveal delay-1 flex flex-col gap-2">
            <h3 className="text-xs font-bold cd-text-faint">용역 분류</h3>
            {BONUS_CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key)}
                className={`rounded-xl px-3 py-2 text-sm font-semibold border transition ${
                  category === c.key
                    ? "cd-fill-primary text-white border-transparent"
                    : "cd-border-c cd-text"
                }`}
              >
                {c.label}
              </button>
            ))}
          </section>

          <section className="cd-card rounded-3xl p-4 cd-reveal delay-2 flex flex-col gap-2.5">
            <h3 className="text-xs font-bold cd-text-faint">연관부서/인원 기여도</h3>
            <label className="flex items-center justify-between gap-2 text-sm cd-text">
              <span>지원/영업</span>
              <span className="flex items-center gap-1">
                <input
                  type="number" min={0} max={100} step={0.5}
                  className="cd-input text-sm text-right" style={{ width: 64 }}
                  disabled={!canEdit}
                  value={settings?.contribSupportPct ?? 0}
                  onChange={(e) => patchSettings({ contribSupportPct: Number(e.target.value) })}
                />
                <span className="text-xs cd-text-faint">%</span>
              </span>
            </label>
            <label className="flex items-center justify-between gap-2 text-sm cd-text">
              <span>임원</span>
              <span className="flex items-center gap-1">
                <input
                  type="number" min={0} max={100} step={0.5}
                  className="cd-input text-sm text-right" style={{ width: 64 }}
                  disabled={!canEdit}
                  value={settings?.contribExecPct ?? 0}
                  onChange={(e) => patchSettings({ contribExecPct: Number(e.target.value) })}
                />
                <span className="text-xs cd-text-faint">%</span>
              </span>
            </label>
            {departments.map((d) => {
              const enabled = settings?.deptHeadRates?.[d.deptId] != null;
              return (
                <label key={d.deptId} className="flex items-center justify-between gap-2 text-sm">
                  <span className={`flex items-center gap-1.5 min-w-0 ${enabled ? "cd-text" : "cd-text-faint"}`}>
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={enabled}
                      title="본부장 비율 적용 여부"
                      onChange={(e) => {
                        const next = { ...(settings?.deptHeadRates ?? {}) };
                        if (e.target.checked) next[d.deptId] = next[d.deptId] ?? 0;
                        else delete next[d.deptId];
                        patchSettings({ deptHeadRates: next });
                      }}
                    />
                    <span className="truncate" title={`${d.deptName} 본부장`}>{d.deptName}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <input
                      type="number" min={0} max={100} step={0.5}
                      className="cd-input text-sm text-right" style={{ width: 64 }}
                      disabled={!canEdit || !enabled}
                      value={settings?.deptHeadRates?.[d.deptId] ?? 0}
                      onChange={(e) =>
                        patchSettings({
                          deptHeadRates: { ...(settings?.deptHeadRates ?? {}), [d.deptId]: Number(e.target.value) },
                        })
                      }
                    />
                    <span className="text-xs cd-text-faint">%</span>
                  </span>
                </label>
              );
            })}
            <p className="text-[10px] leading-relaxed cd-text-faint">
              체크된 본부만 본부장 비율이 적용됩니다. 본부장 행은 해당 본부 용역 풀에서 본부장 비율로 차감·확정됩니다.
            </p>
          </section>

          <section className="cd-card rounded-3xl p-4 cd-reveal delay-3 flex flex-col gap-2">
            <h3 className="text-xs font-bold cd-text-faint">매출액 중 적용 비율</h3>
            <label className="flex items-center justify-between gap-2 text-sm cd-text">
              <span>적용 비율</span>
              <span className="flex items-center gap-1">
                <input
                  type="number" min={0} max={100} step={0.1}
                  className="cd-input text-sm text-right" style={{ width: 64 }}
                  disabled={!canEdit}
                  value={settings?.applyRate ?? DEFAULT_APPLY_RATE}
                  onChange={(e) => patchSettings({ applyRate: Number(e.target.value) })}
                />
                <span className="text-xs cd-text-faint">%</span>
              </span>
            </label>
            <p className="text-[10px] leading-relaxed cd-text-faint">
              통상 3.5~5% 범위에서 경영 상황에 따라 결정합니다.
            </p>
          </section>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!canEdit || saving || !settings}
              onClick={saveSettings}
              className="flex-1 rounded-xl px-3 py-2 text-sm text-white cd-fill-primary inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Save className="w-4 h-4" /> 저장
            </button>
            <button
              type="button"
              disabled={!canEdit || saving}
              onClick={resetSettings}
              className="rounded-xl px-3 py-2 text-sm border cd-border-c cd-text inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <RotateCcw className="w-4 h-4" /> 초기화
            </button>
          </div>
          {msg && <p className="text-[11px] cd-text-faint text-center">{msg}</p>}
        </aside>

        {/* 우측 탭 카드 */}
        <section className="cd-card rounded-3xl p-4 cd-reveal delay-1 flex-1 min-h-0 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTab("list")}
              className={`rounded-xl px-4 py-2 text-sm font-semibold border ${
                tab === "list" ? "cd-fill-primary text-white border-transparent" : "cd-border-c cd-text"
              }`}
            >
              대상 LIST
            </button>
            <button
              type="button"
              onClick={() => setTab("costs")}
              className={`rounded-xl px-4 py-2 text-sm font-semibold border ${
                tab === "costs" ? "cd-fill-primary text-white border-transparent" : "cd-border-c cd-text"
              }`}
            >
              제비용 설정
            </button>
            <span className="ml-2 text-xs cd-text-faint">
              {periodLabel} · {BONUS_CATEGORIES.find((c) => c.key === category)?.label} {filtered.length}건
            </span>
            {tab === "costs" && (
              <button
                type="button"
                disabled={!canEdit || saving || filtered.length === 0}
                onClick={saveCosts}
                className="ml-auto rounded-xl px-4 py-2 text-sm text-white cd-fill-primary inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Save className="w-4 h-4" /> {saving ? "저장 중..." : "제비용 저장"}
              </button>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            {loading ? (
              <div className="p-10 text-center text-sm cd-text-faint">불러오는 중…</div>
            ) : filtered.length === 0 ? (
              <div className="p-10 text-center text-sm cd-text-faint">
                {periodLabel}에 세금계산서를 발행한 {BONUS_CATEGORIES.find((c) => c.key === category)?.label} 용역이 없습니다.
              </div>
            ) : tab === "list" ? (
              <table className="text-sm" style={{ minWidth: 900 + maxStages * 150 }}>
                <thead>
                  <tr className="cd-text-faint text-[11px] border-b cd-border-c">
                    <th className="text-left font-semibold p-2.5" style={{ minWidth: 240 }}>용역명</th>
                    <th className="text-left font-semibold p-2.5" style={{ minWidth: 140 }}>발주처</th>
                    <th className="text-left font-semibold p-2.5" style={{ minWidth: 90 }}>계약일</th>
                    <th className="text-left font-semibold p-2.5" style={{ minWidth: 100 }}>본부</th>
                    {Array.from({ length: maxStages }, (_, i) => (
                      <th key={i} className="text-right font-semibold p-2.5" style={{ minWidth: 150 }}>
                        단계 {i + 1}
                      </th>
                    ))}
                    <th className="text-right font-semibold p-2.5" style={{ minWidth: 120 }}>반기 적용금액</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.contractId} className="border-b cd-border-c last:border-b-0 align-top">
                      <td className="p-2.5">
                        <span className="block cd-text font-medium">{t.contractTitle}</span>
                        <span className="text-[10px] cd-text-faint">{t.serviceType ?? ""}</span>
                      </td>
                      <td className="p-2.5 cd-text">{t.counterpartyName ?? "-"}</td>
                      <td className="p-2.5 cd-text whitespace-nowrap">{fmtDate(t.contractDate)}</td>
                      <td className="p-2.5">
                        {t.owningDeptName ? (
                          <span className="cd-text">{t.owningDeptName}</span>
                        ) : (
                          <span
                            className="text-[11px] font-semibold rounded-lg px-2 py-0.5 border cd-border-c cd-text-faint whitespace-nowrap"
                            title="계약 상세에서 수행 부서를 지정하세요. 참여도·평점 입력과 본부장 비율 차감에 필요합니다."
                          >
                            미지정
                          </span>
                        )}
                      </td>
                      {Array.from({ length: maxStages }, (_, i) => {
                        const s = t.stages[i];
                        if (!s) return <td key={i} className="p-2.5" />;
                        return (
                          <td
                            key={i}
                            className={`p-2.5 text-right ${s.inPeriod ? "cd-tint-primary rounded-lg" : ""}`}
                          >
                            <span className="block text-[10px] cd-text-faint">{s.stageLabel}</span>
                            <span className="block cd-text">{fmtAmount(s.amount)}</span>
                            <span className="block text-[11px] cd-text-faint" title="제비용 반영액">
                              ({fmtAmount(s.netAmount)})
                            </span>
                            <span className="block text-[10px] cd-text-faint">
                              {s.invoiceIssued ? fmtDate(s.issuedAt) : "미발행"}
                            </span>
                          </td>
                        );
                      })}
                      <td className="p-2.5 text-right cd-text font-semibold whitespace-nowrap">
                        {fmtAmount(t.appliedInPeriod)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-sm" style={{ minWidth: 900 }}>
                <thead>
                  <tr className="cd-text-faint text-[11px] border-b cd-border-c">
                    <th className="text-left font-semibold p-2.5">용역명</th>
                    <th className="text-left font-semibold p-2.5" style={{ width: "14%" }}>발주처</th>
                    <th className="text-left font-semibold p-2.5" style={{ width: "10%" }}>계약일</th>
                    <th className="text-right font-semibold p-2.5" style={{ width: "12%" }}>용역금액</th>
                    <th className="text-right font-semibold p-2.5" style={{ width: "13%" }}>외주금액 (자동)</th>
                    <th className="text-right font-semibold p-2.5" style={{ width: "13%" }}>영업비용</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.contractId} className="border-b cd-border-c last:border-b-0">
                      <td className="p-2.5 cd-text">{t.contractTitle}</td>
                      <td className="p-2.5 cd-text">{t.counterpartyName ?? "-"}</td>
                      <td className="p-2.5 cd-text whitespace-nowrap">{fmtDate(t.contractDate)}</td>
                      <td className="p-2.5 text-right cd-text">{fmtAmount(t.contractAmount)}</td>
                      <td
                        className="p-2.5 text-right cd-text"
                        title="계약 신규/변경계약 입력에서 등록한 외주용역 건의 합계입니다. 수정은 계약 관리에서 하세요."
                      >
                        {fmtAmount(t.outsourcingAmount)}
                      </td>
                      <td className="p-2">
                        <input
                          type="number" min={0}
                          className="cd-input text-sm w-full text-right"
                          disabled={!canEdit}
                          value={costDrafts[t.contractId] ?? t.salesCostAmount}
                          onChange={(e) =>
                            setCostDrafts((prev) => ({ ...prev, [t.contractId]: Number(e.target.value) }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex items-center justify-end border-t cd-border-c pt-3">
            <span className="text-sm cd-text-faint mr-2">총 지급대상 기준액 :</span>
            <span className="text-lg font-extrabold cd-text">{fmtAmount(totalTarget)}원</span>
            <span className="text-[11px] cd-text-faint ml-2">
              (전체 분류 반기 적용금액 {fmtAmount(totalApplied)}원 × {applyRate}%)
            </span>
          </div>
        </section>
      </div>
    </>
  );
}
