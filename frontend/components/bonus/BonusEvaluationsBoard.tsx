"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Save, Wand2, X } from "lucide-react";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdModal } from "@/components/cdash/CdModal";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import type { OrganizationEmployeeRow, OrganizationSnapshot } from "@/components/admin/users/types";
import {
  BONUS_CATEGORIES,
  BONUS_EXCLUDED_DEPT_IDS,
  CHANGE_KIND_LABELS,
  DEFAULT_PARTICIPANT_ROLE,
  GRADE_OPTIONS,
  GRADE_WEIGHTS,
  type BonusCategoryKey,
  type BonusEvalRow,
  type BonusSettings,
} from "@/lib/bonus/shared";

interface BoardResponse {
  rows: BonusEvalRow[];
  absoluteGrading: boolean;
  gradeCaps: Record<string, number>;
  isAdmin: boolean;
}

type Draft = Record<string, { pct?: number; grade?: string | null }>;

function fmtAmount(v: number): string {
  return Math.round(v).toLocaleString();
}

function fmtDate(v: string | null): string {
  return v ? v.slice(0, 10) : "-";
}

function key(contractId: string, employeeId: string): string {
  return `${contractId}|${employeeId}`;
}

export default function BonusEvaluationsBoard() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [half, setHalf] = useState<"H1" | "H2">(now.getMonth() < 6 ? "H1" : "H2");
  const [category, setCategory] = useState<BonusCategoryKey>("integrated");
  const [tab, setTab] = useState<"participation" | "grade">("participation");
  const [changeFilter, setChangeFilter] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<BonusEvalRow[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [settingsFull, setSettingsFull] = useState<BonusSettings | null>(null);
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null);
  const [picker, setPicker] = useState<{ contractId: string; slot: "manager" | "participant" } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const period = `${year}-${half}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [board, settings] = await Promise.all([
        fetch(`/api/bonus/evaluations?period=${period}`, { cache: "no-store" }).then((r) => r.json() as Promise<BoardResponse>),
        fetch(`/api/bonus/settings?period=${period}`, { cache: "no-store" }).then((r) => r.json()),
      ]);
      setRows(board.rows ?? []);
      setIsAdmin(Boolean(board.isAdmin));
      setSettingsFull(settings.settings ?? null);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    setDraft({});
    setMsg(null);
    void load();
  }, [load]);

  useEffect(() => {
    fetch("/api/organization", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: OrganizationSnapshot | null) => {
        if (!d) return;
        // 총괄·영업관리본부는 용역별 참여도 산정에서 제외(사용자 확정) — 조직도 후보에서 뺀다.
        setSnapshot({
          ...d,
          departments: d.departments.filter((dept) => !BONUS_EXCLUDED_DEPT_IDS.includes(dept.deptId)),
          employees: d.employees.filter(
            (e) => e.status === "active" && (e.deptId == null || !BONUS_EXCLUDED_DEPT_IDS.includes(e.deptId))
          ),
        });
      })
      .catch(() => setSnapshot(null));
  }, []);

  const yearOptions = useMemo(() => {
    const y = now.getFullYear();
    return [y + 1, y, y - 1, y - 2];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effPct = (r: BonusEvalRow, employeeId: string, fallback: number) =>
    draft[key(r.contractId, employeeId)]?.pct ?? fallback;
  const effGrade = (r: BonusEvalRow, employeeId: string, fallback: string | null) => {
    const d = draft[key(r.contractId, employeeId)];
    return d && "grade" in d ? (d.grade ?? null) : fallback;
  };

  const filtered = useMemo(() => {
    let list = rows.filter((r) => r.category === category);
    if (changeFilter.size) {
      list = list.filter((r) => r.changeKinds.some((k) => changeFilter.has(k)));
    }
    return list;
  }, [rows, category, changeFilter]);

  const maxSlots = useMemo(
    () => Math.max(4, filtered.reduce((acc, r) => Math.max(acc, r.participants.length), 0)),
    [filtered]
  );

  // 절대평가 게이지 — 반기 전체(분류 무관) 등급 분포, draft 반영
  const gradeStats = useMemo(() => {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      for (const p of r.participants) {
        const g = effGrade(r, p.employeeId, p.grade);
        if (!g) continue;
        counts[g] = (counts[g] ?? 0) + 1;
        total += 1;
      }
    }
    return { counts, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, draft]);

  const toggleChangeFilter = (kind: string) =>
    setChangeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const entries = rows.flatMap((r) =>
        r.participants.map((p) => ({
          contractId: r.contractId,
          employeeId: p.employeeId,
          participationPct: effPct(r, p.employeeId, p.participationPct),
          grade: effGrade(r, p.employeeId, p.grade),
        }))
      );
      const res = await fetch("/api/bonus/evaluations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, entries }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "저장에 실패했습니다.");
      setDraft({});
      setMsg("저장되었습니다.");
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveAbsoluteSettings = async (patch: Partial<Pick<BonusSettings, "absoluteGrading" | "gradeCaps">>) => {
    if (!settingsFull) return;
    const next = { ...settingsFull, ...patch };
    setSettingsFull(next);
    try {
      const res = await fetch("/api/bonus/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period,
          applyRate: next.applyRate,
          contribSupportPct: next.contribSupportPct,
          contribExecPct: next.contribExecPct,
          deptHeadRates: next.deptHeadRates,
          absoluteGrading: next.absoluteGrading,
          gradeCaps: next.gradeCaps,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "절대평가 설정 저장 실패");
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  const pickEmployee = async (emp: OrganizationEmployeeRow) => {
    if (!picker) return;
    try {
      const res = await fetch("/api/bonus/participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractId: picker.contractId,
          employeeId: emp.employeeId,
          roleLabel: picker.slot === "manager" ? "관리자" : DEFAULT_PARTICIPANT_ROLE,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "지정에 실패했습니다.");
      if (data.owningDeptFilled) {
        setMsg("관리자 소속 본부로 수행부서를 자동 지정했습니다.");
      }
      setPicker(null);
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  const removeParticipant = async (participationId: string) => {
    try {
      const res = await fetch(`/api/bonus/participants?participationId=${encodeURIComponent(participationId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("참여자 제거에 실패했습니다.");
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  const suggest = async (r: BonusEvalRow) => {
    try {
      const res = await fetch("/api/bonus/evaluations/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, contractId: r.contractId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "제안 계산에 실패했습니다.");
      const map = new Map<string, number>(
        (data.suggestions ?? []).map((s: { employeeId: string; pct: number }) => [s.employeeId, s.pct])
      );
      setDraft((prev) => {
        const next = { ...prev };
        for (const p of r.participants) {
          next[key(r.contractId, p.employeeId)] = {
            ...next[key(r.contractId, p.employeeId)],
            pct: map.get(p.employeeId) ?? 0,
          };
        }
        return next;
      });
      setMsg("기간 가중 배분을 제안했습니다. 필요하면 직접 조정 후 저장하세요.");
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  const periodLabel = `${year}년 ${half === "H1" ? "상반기" : "하반기"}`;

  return (
    <>
      <CdPageHeader
        title="참여도·평점"
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
        {/* 좌측 사이드바 */}
        <aside className="w-60 shrink-0 flex flex-col gap-4 overflow-y-auto scrollbar-hide">
          <section className="cd-card rounded-3xl p-4 cd-reveal delay-1 flex flex-col gap-2">
            <h3 className="text-xs font-bold cd-text-faint">용역 분류</h3>
            {BONUS_CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key)}
                className={`rounded-xl px-3 py-2 text-sm font-semibold border transition ${
                  category === c.key ? "cd-fill-primary text-white border-transparent" : "cd-border-c cd-text"
                }`}
              >
                {c.label}
              </button>
            ))}
          </section>

          <section className="cd-card rounded-3xl p-4 cd-reveal delay-2 flex flex-col gap-2">
            <h3 className="text-xs font-bold cd-text-faint">인력 변동 Sorting</h3>
            {Object.entries(CHANGE_KIND_LABELS).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                onClick={() => toggleChangeFilter(kind)}
                className={`rounded-xl px-3 py-2 text-sm font-semibold border transition ${
                  changeFilter.has(kind) ? "cd-fill-primary text-white border-transparent" : "cd-border-c cd-text"
                }`}
              >
                {label}
              </button>
            ))}
            <p className="text-[10px] leading-relaxed cd-text-faint">
              선택한 변동이 이 반기에 발생한 용역만 표시합니다.
            </p>
          </section>

          <section className="cd-card rounded-3xl p-4 cd-reveal delay-3 flex flex-col gap-2.5">
            <label className="flex items-center gap-2 text-sm font-semibold cd-text">
              <input
                type="checkbox"
                disabled={!isAdmin}
                checked={settingsFull?.absoluteGrading ?? false}
                onChange={(e) => saveAbsoluteSettings({ absoluteGrading: e.target.checked })}
              />
              절대평가 옵션
            </label>
            {GRADE_OPTIONS.map((g) => {
              const cap = settingsFull?.gradeCaps?.[g] ?? 0;
              const count = gradeStats.counts[g] ?? 0;
              const share = gradeStats.total ? (count / gradeStats.total) * 100 : 0;
              const over = (settingsFull?.absoluteGrading ?? false) && cap > 0 && share > cap;
              return (
                <div key={g} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2 text-sm cd-text">
                    <span>평점 : {g}</span>
                    <span className="flex items-center gap-1">
                      <input
                        type="number" min={0} max={100}
                        className="cd-input text-sm text-right" style={{ width: 56 }}
                        disabled={!isAdmin || !(settingsFull?.absoluteGrading ?? false)}
                        value={cap}
                        onChange={(e) =>
                          saveAbsoluteSettings({
                            gradeCaps: { ...(settingsFull?.gradeCaps ?? {}), [g]: Number(e.target.value) },
                          })
                        }
                      />
                      <span className="text-xs cd-text-faint">%</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full border cd-border-c overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, share)}%`,
                        background: over ? "var(--cd-danger, #FA896B)" : "var(--cd-primary, #5D87FF)",
                      }}
                    />
                  </div>
                  <span className={`text-[10px] ${over ? "font-bold" : "cd-text-faint"}`}>
                    {count}건 · {share.toFixed(1)}%{cap > 0 ? ` / 상한 ${cap}%` : ""}
                  </span>
                </div>
              );
            })}
            <p className="text-[10px] leading-relaxed cd-text-faint">
              등급별 최대 부여 비율(전체 평점 부여 건수 대비). 상한 초과 시 저장이 차단됩니다.
            </p>
          </section>
        </aside>

        {/* 우측 탭 카드 */}
        <section className="cd-card rounded-3xl p-4 cd-reveal delay-1 flex-1 min-h-0 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTab("participation")}
              className={`rounded-xl px-4 py-2 text-sm font-semibold border ${
                tab === "participation" ? "cd-fill-primary text-white border-transparent" : "cd-border-c cd-text"
              }`}
            >
              참여도
            </button>
            <button
              type="button"
              onClick={() => setTab("grade")}
              className={`rounded-xl px-4 py-2 text-sm font-semibold border ${
                tab === "grade" ? "cd-fill-primary text-white border-transparent" : "cd-border-c cd-text"
              }`}
            >
              평점
            </button>
            <span className="ml-2 text-xs cd-text-faint">
              {periodLabel} · {BONUS_CATEGORIES.find((c) => c.key === category)?.label} {filtered.length}건
            </span>
            {tab === "grade" && (
              <span className="text-[11px] cd-text-faint">
                가중치: {GRADE_OPTIONS.map((g) => `${g} ${GRADE_WEIGHTS[g]}`).join(" · ")}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              {msg && <span className="text-[11px] cd-text-faint max-w-[380px] truncate" title={msg}>{msg}</span>}
              <button
                type="button"
                disabled={saving || rows.length === 0}
                onClick={save}
                className="rounded-xl px-4 py-2 text-sm text-white cd-fill-primary inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Save className="w-4 h-4" /> {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            {loading ? (
              <div className="p-10 text-center text-sm cd-text-faint">불러오는 중…</div>
            ) : filtered.length === 0 ? (
              <div className="p-10 text-center text-sm cd-text-faint">
                조건에 맞는 용역이 없습니다.
              </div>
            ) : (
              <table className="w-full text-sm" style={{ minWidth: 950 + maxSlots * 126 }}>
                <thead>
                  <tr className="cd-text-faint text-[11px] border-b cd-border-c">
                    <th className="text-left font-semibold p-2.5" style={{ minWidth: 320 }}>용역명</th>
                    <th className="text-left font-semibold p-2.5" style={{ minWidth: 190 }}>발주처</th>
                    <th className="text-left font-semibold p-2.5" style={{ width: 92 }}>계약일</th>
                    <th className="text-left font-semibold p-2.5" style={{ width: 120 }}>본부</th>
                    <th className="text-left font-semibold p-2.5" style={{ width: 112 }}>관리자(부서장)</th>
                    {Array.from({ length: maxSlots }, (_, i) => (
                      <th key={i} className="text-left font-semibold p-2.5" style={{ width: 126 }}>
                        참여자{i + 1}{tab === "participation" ? " · 비율" : " · 평점"}
                      </th>
                    ))}
                    <th className="text-right font-semibold p-2.5" style={{ width: 112 }}>적용대상액</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const pctSum = r.participants.reduce(
                      (acc, p) => acc + effPct(r, p.employeeId, p.participationPct),
                      0
                    );
                    return (
                      <tr key={r.contractId} className="border-b cd-border-c last:border-b-0 align-top">
                        <td className="p-2.5">
                          <span className="block cd-text font-medium">{r.contractTitle}</span>
                          <span className="flex items-center gap-1 flex-wrap mt-0.5">
                            {r.changeKinds.map((k) => (
                              <span key={k} className="text-[10px] font-semibold rounded-md px-1.5 py-0.5 border cd-border-c cd-text-faint">
                                {CHANGE_KIND_LABELS[k] ?? k}
                              </span>
                            ))}
                            {tab === "participation" && r.participants.length > 0 && (
                              <button
                                type="button"
                                onClick={() => suggest(r)}
                                className="text-[10px] font-semibold rounded-md px-1.5 py-0.5 border cd-border-c cd-text inline-flex items-center gap-0.5"
                                title="인력 변동·참여 기간을 가중해 배분을 제안합니다(재조정 가능)"
                              >
                                <Wand2 className="w-3 h-3" /> 제안
                              </button>
                            )}
                          </span>
                        </td>
                        <td className="p-2.5 cd-text">{r.counterpartyName ?? "-"}</td>
                        <td className="p-2.5 cd-text whitespace-nowrap">{fmtDate(r.contractDate)}</td>
                        <td className="p-2.5">
                          {r.owningDeptName ? (
                            <span className="cd-text whitespace-nowrap">{r.owningDeptName}</span>
                          ) : (
                            <span className="text-[11px] font-semibold rounded-lg px-2 py-0.5 border cd-border-c cd-text-faint whitespace-nowrap"
                              title="관리자를 지정하면 관리자 소속 본부로 자동 지정됩니다.">
                              미지정
                            </span>
                          )}
                        </td>
                        <td className="p-2.5">
                          {r.manager ? (
                            <button
                              type="button"
                              className="cd-text underline-offset-2 hover:underline text-left"
                              title="클릭하면 관리자를 교체합니다"
                              onClick={() => setPicker({ contractId: r.contractId, slot: "manager" })}
                            >
                              {r.manager.employeeName}
                              {r.manager.positionName && (
                                <span className="cd-text-faint text-xs"> {r.manager.positionName}</span>
                              )}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setPicker({ contractId: r.contractId, slot: "manager" })}
                              className="text-[11px] font-semibold rounded-lg px-2 py-1 border cd-border-c cd-text-faint inline-flex items-center gap-1"
                            >
                              <Plus className="w-3 h-3" /> 지정
                            </button>
                          )}
                        </td>
                        {Array.from({ length: maxSlots }, (_, i) => {
                          const p = r.participants[i];
                          if (!p) {
                            // 첫 빈 슬롯에만 추가 버튼
                            if (i === r.participants.length) {
                              return (
                                <td key={i} className="p-2.5">
                                  <button
                                    type="button"
                                    onClick={() => setPicker({ contractId: r.contractId, slot: "participant" })}
                                    className="text-[11px] font-semibold rounded-lg px-2 py-1 border cd-border-c cd-text-faint inline-flex items-center gap-1"
                                  >
                                    <Plus className="w-3 h-3" /> 추가
                                  </button>
                                </td>
                              );
                            }
                            return <td key={i} className="p-2.5" />;
                          }
                          return (
                            <td key={i} className="p-2 align-top">
                              <div className="flex items-center gap-1">
                                <span className="cd-text text-[13px] truncate flex-1 min-w-0" title={`${p.employeeName} ${p.positionName ?? ""} (${p.roleLabel})`}>
                                  {p.employeeName}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeParticipant(p.participationId)}
                                  className="cd-text-faint hover:opacity-70 shrink-0"
                                  title="참여자 제거"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                                {tab === "participation" ? (
                                  <>
                                    <input
                                      type="number" min={0} max={100}
                                      className="cd-input text-sm text-right shrink-0"
                                      style={{ width: 46, padding: "4px 4px" }}
                                      value={effPct(r, p.employeeId, p.participationPct)}
                                      onChange={(e) =>
                                        setDraft((prev) => ({
                                          ...prev,
                                          [key(r.contractId, p.employeeId)]: {
                                            ...prev[key(r.contractId, p.employeeId)],
                                            pct: Number(e.target.value),
                                          },
                                        }))
                                      }
                                    />
                                    <span className="text-[11px] cd-text-faint shrink-0">%</span>
                                  </>
                                ) : (
                                  <select
                                    className="cd-select text-sm shrink-0"
                                    style={{ width: 52, padding: "4px 4px" }}
                                    value={effGrade(r, p.employeeId, p.grade) ?? ""}
                                    onChange={(e) =>
                                      setDraft((prev) => ({
                                        ...prev,
                                        [key(r.contractId, p.employeeId)]: {
                                          ...prev[key(r.contractId, p.employeeId)],
                                          grade: e.target.value || null,
                                        },
                                      }))
                                    }
                                  >
                                    <option value="">-</option>
                                    {GRADE_OPTIONS.map((g) => (
                                      <option key={g} value={g}>{g}</option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            </td>
                          );
                        })}
                        <td className="p-2.5 text-right">
                          <span className="cd-text font-semibold whitespace-nowrap">{fmtAmount(r.appliedInPeriod)}</span>
                          {tab === "participation" && r.participants.length > 0 && (
                            <span
                              className="block text-[10px] mt-0.5"
                              style={pctSum !== 100 ? { color: "var(--cd-danger, #FA896B)", fontWeight: 700 } : undefined}
                            >
                              비율 합 {pctSum}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      <CdModal
        open={picker != null}
        onClose={() => setPicker(null)}
        title={picker?.slot === "manager" ? "관리자(부서장) 지정" : "참여자 추가"}
        size="md"
      >
        <div className="flex flex-col gap-2">
          {snapshot ? (
            <OrganizationTree snapshot={snapshot} embedded hideHeader onSelectEmployee={pickEmployee} />
          ) : (
            <p className="text-[12px] cd-text-faint py-6 text-center">조직도를 불러오는 중입니다.</p>
          )}
          <p className="text-[10px] cd-text-faint">
            총괄·영업관리본부 인원은 용역별 참여도 산정 대상이 아니라 표시되지 않습니다.
          </p>
        </div>
      </CdModal>
    </>
  );
}
