"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";

/**
 * 장기근속 포상 패널(급여 항목·설정 → 장기근속 포상, 2026-09-14) — 사규 별표 9 규칙 편집 + 도달 예정자.
 * 휴가비는 근속 도달 월 급여대장에 자동 산정(장기근속휴가수당), 휴가는 그 대장을 확정할 때 특별휴가로 자동 부여된다.
 */

interface Rule {
  years: number;
  leaveDays: number;
  allowanceAmount: number;
  isActive: boolean;
  note: string | null;
}

interface Upcoming {
  employeeId: string;
  name: string;
  years: number;
  hiredAt: string;
  anniversary: string;
  leaveDays: number;
  amount: number;
  granted: boolean;
  paid: "none" | "draft" | "confirmed";
}

type Draft = Rule & { dirty?: boolean; isNew?: boolean };

const fmt = (v: number) => Math.round(v).toLocaleString();

export default function LongevityPanel() {
  const [rules, setRules] = useState<Draft[]>([]);
  const [upcoming, setUpcoming] = useState<Upcoming[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/payroll/longevity", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setRules((d.rules ?? []) as Draft[]);
        setUpcoming(d.upcoming ?? []);
      })
      .catch(() => setMsg("불러오지 못했습니다."));
  }, []);
  useEffect(load, [load]);

  const patch = (years: number, p: Partial<Draft>) =>
    setRules((prev) => prev.map((r) => (r.years === years ? { ...r, ...p, dirty: true } : r)));

  const addRule = () => {
    const next = Math.max(0, ...rules.map((r) => r.years)) + 5;
    setRules((prev) => [...prev, { years: next, leaveDays: 3, allowanceAmount: 1000000, isActive: true, note: null, dirty: true, isNew: true }]);
  };

  const saveAll = async () => {
    const dirty = rules.filter((r) => r.dirty);
    if (!dirty.length) return;
    setBusy(true);
    setMsg(null);
    try {
      for (const r of dirty) {
        const res = await fetch("/api/payroll/longevity", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ years: r.years, leaveDays: r.leaveDays, allowanceAmount: r.allowanceAmount, isActive: r.isActive, note: r.note }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? `${r.years}년 저장 실패`);
      }
      setMsg(`${dirty.length}건 저장했습니다.`);
      load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Draft) => {
    if (r.isNew) {
      setRules((prev) => prev.filter((x) => x.years !== r.years));
      return;
    }
    if (!window.confirm(`근속 ${r.years}년 규칙을 삭제할까요?`)) return;
    await fetch(`/api/payroll/longevity?years=${r.years}`, { method: "DELETE" });
    load();
  };

  const dirtyCount = rules.filter((r) => r.dirty).length;

  return (
    <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-4 px-5 pb-4">
      {/* 규칙 표 */}
      <div className="border cd-border-c rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <div className="text-sm font-bold cd-text">포상 기준(사규 별표 9 · 2026.04.08 개정)</div>
          <span className="text-[11px] cd-text-faint">근속 만 N년 도달 월의 급여대장에 휴가비가 자동 산정되고, 대장 확정 시 특별휴가가 부여됩니다.</span>
          <div className="ml-auto flex items-center gap-2">
            {msg && <span className="text-xs cd-text-faint">{msg}</span>}
            <button type="button" className="cd-btn rounded-xl px-3 py-1.5 text-sm font-semibold flex items-center gap-1" onClick={addRule}>
              <Plus className="w-4 h-4" /> 기준 추가
            </button>
            <button type="button" disabled={busy || !dirtyCount} className="cd-fill-primary text-white rounded-xl px-3 py-1.5 text-sm font-bold flex items-center gap-1 disabled:opacity-40" onClick={saveAll}>
              <Save className="w-4 h-4" /> 저장{dirtyCount ? ` (${dirtyCount})` : ""}
            </button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="cd-table-head">
            <tr className="cd-text-faint text-[11px] border-b cd-border-c">
              <th className="text-left font-semibold p-2 whitespace-nowrap">근속 연수</th>
              <th className="text-right font-semibold p-2 whitespace-nowrap">휴가 부여일수</th>
              <th className="text-right font-semibold p-2 whitespace-nowrap">휴가비(원)</th>
              <th className="text-center font-semibold p-2">적용</th>
              <th className="text-left font-semibold p-2">비고</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.years} className="border-b cd-border-c last:border-0">
                <td className="p-1.5">
                  {r.isNew ? (
                    <input type="number" className="cd-input text-sm text-right" style={{ width: 70 }} value={r.years} min={1}
                      onChange={(e) => setRules((prev) => prev.map((x) => (x === r ? { ...x, years: Number(e.target.value) } : x)))} />
                  ) : (
                    <span className="cd-text font-semibold">{r.years}년</span>
                  )}
                </td>
                <td className="p-1.5 text-right">
                  <input type="number" step="0.5" className="cd-input text-sm text-right" style={{ width: 70 }} value={r.leaveDays} onChange={(e) => patch(r.years, { leaveDays: Number(e.target.value) })} />
                </td>
                <td className="p-1.5 text-right">
                  <input className="cd-input text-sm text-right" style={{ width: 120 }} inputMode="numeric" value={r.allowanceAmount ? fmt(r.allowanceAmount) : ""}
                    onChange={(e) => patch(r.years, { allowanceAmount: Number(e.target.value.replace(/[^\d]/g, "")) })} />
                </td>
                <td className="p-1.5 text-center">
                  <input type="checkbox" checked={r.isActive} onChange={(e) => patch(r.years, { isActive: e.target.checked })} />
                </td>
                <td className="p-1.5">
                  <input className="cd-input text-sm w-full" value={r.note ?? ""} placeholder="근거·개정일" onChange={(e) => patch(r.years, { note: e.target.value })} />
                </td>
                <td className="p-1.5 text-right">
                  <button type="button" className="cd-btn rounded-lg p-1.5" title="삭제" style={{ color: "var(--cd-error)" }} onClick={() => void remove(r)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rules.length && <p className="p-4 text-center text-sm cd-text-faint">등록된 기준이 없습니다(마이그 223 시드 확인).</p>}
      </div>

      {/* 도달자 */}
      <div className="border cd-border-c rounded-2xl p-4">
        <div className="text-sm font-bold cd-text mb-2">도달자 — 최근 6개월 · 향후 12개월</div>
        <table className="w-full text-sm">
          <thead className="cd-table-head">
            <tr className="cd-text-faint text-[11px] border-b cd-border-c">
              <th className="text-left font-semibold p-2">직원</th>
              <th className="text-left font-semibold p-2 whitespace-nowrap">입사일</th>
              <th className="text-left font-semibold p-2 whitespace-nowrap">근속</th>
              <th className="text-left font-semibold p-2 whitespace-nowrap">도달일</th>
              <th className="text-right font-semibold p-2 whitespace-nowrap">휴가비</th>
              <th className="text-right font-semibold p-2 whitespace-nowrap">휴가</th>
              <th className="text-left font-semibold p-2 whitespace-nowrap">휴가비 지급</th>
              <th className="text-left font-semibold p-2 whitespace-nowrap">휴가 부여</th>
            </tr>
          </thead>
          <tbody>
            {upcoming.map((u) => (
              <tr key={`${u.employeeId}-${u.years}`} className="border-b cd-border-c last:border-0">
                <td className="p-2 cd-text font-semibold">{u.name}</td>
                <td className="p-2 cd-text-faint">{u.hiredAt}</td>
                <td className="p-2 cd-text">{u.years}년</td>
                <td className="p-2 cd-text">{u.anniversary}</td>
                <td className="p-2 text-right tabular-nums cd-text">{fmt(u.amount)}</td>
                <td className="p-2 text-right tabular-nums cd-text">{u.leaveDays}일</td>
                <td className="p-2">
                  {u.paid === "confirmed" ? <span className="cd-pill cd-pill-success">확정 대장</span> : u.paid === "draft" ? <span className="cd-pill cd-pill-info">작성 중 대장</span> : <span className="cd-pill cd-pill-idle">{u.anniversary.slice(0, 7)} 대장 생성 시</span>}
                </td>
                <td className="p-2">
                  {u.granted ? <span className="cd-pill cd-pill-success">부여됨</span> : <span className="cd-pill cd-pill-idle">대장 확정 시</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!upcoming.length && <p className="p-4 text-center text-sm cd-text-faint">해당 기간에 근속 기준에 도달하는 직원이 없습니다.</p>}
      </div>
    </div>
  );
}
