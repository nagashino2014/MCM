"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";

/**
 * 출장 여비 패널(급여 항목·설정 → 출장 여비, 2026-09-15) — 국내여비기준표의 숙박출장수당 구간(직급 서열 하한 × 일 단가)
 * 편집 + 최근 3개월~다음 달 인원별 산정 내역(승인된 숙박 출장보고서 기준)과 대장 반영 상태. LongevityPanel 과 같은 골격.
 */

interface Rule {
  rankFrom: number;
  label: string;
  dailyAmount: number;
  isActive: boolean;
  note: string | null;
}

interface Trip {
  reportDocNo: string | null;
  requestDocNo: string | null;
  title: string;
  from: string;
  to: string;
  days: number;
  dailyAmount: number;
  amount: number;
}

interface Upcoming {
  employeeId: string;
  name: string;
  positionName: string | null;
  payYear: number;
  payMonth: number;
  days: number;
  amount: number;
  trips: Trip[];
  pendingReports: number;
  paid: "none" | "draft" | "confirmed";
}

type Draft = Rule & { dirty?: boolean; isNew?: boolean };

const fmt = (v: number) => Math.round(v).toLocaleString();

export default function TripAllowancePanel() {
  const [rules, setRules] = useState<Draft[]>([]);
  const [upcoming, setUpcoming] = useState<Upcoming[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/payroll/trip-allowance", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setRules((d.rules ?? []) as Draft[]);
        setUpcoming(d.upcoming ?? []);
      })
      .catch(() => setMsg("불러오지 못했습니다."));
  }, []);
  useEffect(load, [load]);

  const patch = (rankFrom: number, p: Partial<Draft>) =>
    setRules((prev) => prev.map((r) => (r.rankFrom === rankFrom ? { ...r, ...p, dirty: true } : r)));

  const addRule = () => {
    const next = Math.max(0, ...rules.map((r) => r.rankFrom)) + 10;
    setRules((prev) => [...prev, { rankFrom: next, label: "", dailyAmount: 30000, isActive: true, note: null, dirty: true, isNew: true }]);
  };

  const saveAll = async () => {
    const dirty = rules.filter((r) => r.dirty);
    if (!dirty.length) return;
    setBusy(true);
    setMsg(null);
    try {
      for (const r of dirty) {
        const res = await fetch("/api/payroll/trip-allowance", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rankFrom: r.rankFrom, label: r.label, dailyAmount: r.dailyAmount, isActive: r.isActive, note: r.note }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? `${r.label} 저장 실패`);
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
      setRules((prev) => prev.filter((x) => x.rankFrom !== r.rankFrom));
      return;
    }
    if (!window.confirm(`'${r.label}' 구간을 삭제할까요?`)) return;
    await fetch(`/api/payroll/trip-allowance?rankFrom=${r.rankFrom}`, { method: "DELETE" });
    load();
  };

  const dirtyCount = rules.filter((r) => r.dirty).length;

  return (
    <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-4 px-5 pb-4">
      {/* 규칙 표 */}
      <div className="border cd-border-c rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <div className="text-sm font-bold cd-text">숙박출장수당 기준(국내여비기준표)</div>
          <span className="text-[11px] cd-text-faint">
            직급 서열(rank_order) 하한 이상에 적용 — 부장 70 · 전문위원 65 · 차장 60 · 과장 50. 승인된 숙박 출장보고서의 출장기간 일수 × 단가가 급여대장(전월 26일~금월 25일)에 자동 산정됩니다.
          </span>
          <div className="ml-auto flex items-center gap-2">
            {msg && <span className="text-xs cd-text-faint">{msg}</span>}
            <button type="button" className="cd-btn rounded-xl px-3 py-1.5 text-sm font-semibold flex items-center gap-1" onClick={addRule}>
              <Plus className="w-4 h-4" /> 구간 추가
            </button>
            <button type="button" disabled={busy || !dirtyCount} className="cd-fill-primary text-white rounded-xl px-3 py-1.5 text-sm font-bold flex items-center gap-1 disabled:opacity-40" onClick={saveAll}>
              <Save className="w-4 h-4" /> 저장{dirtyCount ? ` (${dirtyCount})` : ""}
            </button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="cd-table-head">
            <tr className="cd-text-faint text-[11px] border-b cd-border-c">
              <th className="text-right font-semibold p-2 whitespace-nowrap">직급 서열 하한</th>
              <th className="text-left font-semibold p-2 whitespace-nowrap">구간 이름</th>
              <th className="text-right font-semibold p-2 whitespace-nowrap">일 단가(원)</th>
              <th className="text-center font-semibold p-2">적용</th>
              <th className="text-left font-semibold p-2">비고</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.rankFrom} className="border-b cd-border-c last:border-0">
                <td className="p-1.5 text-right">
                  {r.isNew ? (
                    <input type="number" className="cd-input text-sm text-right" style={{ width: 80 }} value={r.rankFrom} min={0}
                      onChange={(e) => setRules((prev) => prev.map((x) => (x === r ? { ...x, rankFrom: Number(e.target.value) } : x)))} />
                  ) : (
                    <span className="cd-text font-semibold tabular-nums">{r.rankFrom} 이상</span>
                  )}
                </td>
                <td className="p-1.5">
                  <input className="cd-input text-sm" style={{ width: 140 }} value={r.label} placeholder="예: 부장 이상" onChange={(e) => patch(r.rankFrom, { label: e.target.value })} />
                </td>
                <td className="p-1.5 text-right">
                  <input className="cd-input text-sm text-right" style={{ width: 110 }} inputMode="numeric" value={r.dailyAmount ? fmt(r.dailyAmount) : ""}
                    onChange={(e) => patch(r.rankFrom, { dailyAmount: Number(e.target.value.replace(/[^\d]/g, "")) })} />
                </td>
                <td className="p-1.5 text-center">
                  <input type="checkbox" checked={r.isActive} onChange={(e) => patch(r.rankFrom, { isActive: e.target.checked })} />
                </td>
                <td className="p-1.5">
                  <input className="cd-input text-sm w-full" value={r.note ?? ""} placeholder="근거·개정일" onChange={(e) => patch(r.rankFrom, { note: e.target.value })} />
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
        {!rules.length && <p className="p-4 text-center text-sm cd-text-faint">등록된 기준이 없습니다(마이그 224 시드 확인).</p>}
      </div>

      {/* 산정 내역 */}
      <div className="border cd-border-c rounded-2xl p-4">
        <div className="text-sm font-bold cd-text mb-2">산정 내역 — 최근 3개월 · 다음 달(승인된 숙박 출장보고서 기준)</div>
        <table className="w-full text-sm">
          <thead className="cd-table-head">
            <tr className="cd-text-faint text-[11px] border-b cd-border-c">
              <th className="text-left font-semibold p-2 whitespace-nowrap">귀속월</th>
              <th className="text-left font-semibold p-2">직원</th>
              <th className="text-left font-semibold p-2 whitespace-nowrap">직급</th>
              <th className="text-left font-semibold p-2">출장</th>
              <th className="text-right font-semibold p-2 whitespace-nowrap">일수</th>
              <th className="text-right font-semibold p-2 whitespace-nowrap">수당</th>
              <th className="text-left font-semibold p-2 whitespace-nowrap">대장 반영</th>
            </tr>
          </thead>
          <tbody>
            {upcoming.map((u) => (
              <tr key={`${u.employeeId}-${u.payYear}-${u.payMonth}`} className="border-b cd-border-c last:border-0 align-top">
                <td className="p-2 cd-text whitespace-nowrap">{u.payYear}-{String(u.payMonth).padStart(2, "0")}</td>
                <td className="p-2 cd-text font-semibold">{u.name}</td>
                <td className="p-2 cd-text-faint whitespace-nowrap">{u.positionName ?? "-"}</td>
                <td className="p-2">
                  {u.trips.map((t, i) => (
                    <div key={i} className="text-[12px] cd-text">
                      <span className="font-mono text-[11px] cd-text-faint mr-1">{t.reportDocNo ?? "-"}</span>
                      {t.title} <span className="cd-text-faint">{t.from} ~ {t.to} · {t.days}일 × {fmt(t.dailyAmount)}</span>
                    </div>
                  ))}
                  {u.pendingReports > 0 && (
                    <div className="text-[11px]" style={{ color: "var(--cd-warning)" }}>결재 진행 중 보고서 {u.pendingReports}건 — 승인 후 반영</div>
                  )}
                </td>
                <td className="p-2 text-right tabular-nums cd-text">{u.days}일</td>
                <td className="p-2 text-right tabular-nums cd-text">{fmt(u.amount)}</td>
                <td className="p-2">
                  {u.paid === "confirmed" ? <span className="cd-pill cd-pill-success">확정 대장</span> : u.paid === "draft" ? <span className="cd-pill cd-pill-info">작성 중 대장</span> : <span className="cd-pill cd-pill-idle">대장 생성 시</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!upcoming.length && <p className="p-4 text-center text-sm cd-text-faint">해당 기간에 산정 대상 숙박 출장이 없습니다.</p>}
      </div>
    </div>
  );
}
