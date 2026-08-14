"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { PayrollItemDef } from "@/lib/payroll/queries";

/**
 * 수당 지급 규칙 패널 (PL-P4, §6-2 A) — 직원×항목 정액 규칙(기간·지급월 제한).
 * 자격증·주거비·숙박·육아·장기근속·상여금(명절)·학자금상환공제가 주 대상이며,
 * 등록된 규칙은 새 대장 생성 시 귀속월 기준으로 자동 반영된다.
 */

interface RuleRow {
  ruleId: string;
  employeeId: string;
  employeeName?: string;
  itemId: string;
  itemName?: string;
  amount: number;
  validFrom: string | null;
  validTo: string | null;
  payMonths: number[] | null;
  note: string | null;
  isActive: boolean;
}

interface EmployeeOpt {
  employeeId: string;
  employeeName: string;
}

/** 규칙 등록 빈도가 높은 추천 항목(§6-2 A) — 셀렉트 상단 고정 */
const FEATURED_ITEMS = ["cert", "housing", "trip-lodging", "childcare", "longevity", "bonus", "student-loan"];

const fmt = (v: number) => Math.round(v).toLocaleString();

export default function PayrollRulesPanel() {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [items, setItems] = useState<PayrollItemDef[]>([]);
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
  const [draft, setDraft] = useState({
    employeeId: "", itemId: "cert", amount: "", validFrom: "", validTo: "", payMonths: "", note: "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/payroll/rules", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setRules(d.rules ?? []))
      .catch(() => setRules([]));
  }, []);

  useEffect(() => {
    load();
    fetch("/api/payroll/items", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setItems((d.items ?? []).filter((i: PayrollItemDef) => i.isActive)))
      .catch(() => setItems([]));
    fetch("/api/payroll/tax-profiles", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) =>
        setEmployees(
          ((d.profiles ?? []) as Array<{ employeeId: string; employeeName: string }>).map((p) => ({
            employeeId: p.employeeId, employeeName: p.employeeName,
          }))
        )
      )
      .catch(() => setEmployees([]));
  }, [load]);

  const sortedItems = useMemo(() => {
    const featured = FEATURED_ITEMS.map((id) => items.find((i) => i.itemId === id)).filter(
      (i): i is PayrollItemDef => !!i
    );
    const rest = items.filter((i) => !FEATURED_ITEMS.includes(i.itemId));
    return [...featured, ...rest];
  }, [items]);

  const addRule = async () => {
    if (!draft.employeeId || !draft.itemId || !draft.amount) {
      setMsg("직원·항목·금액을 입력하세요.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const payMonths = draft.payMonths
        .split(",").map((s) => Number(s.trim())).filter((n) => n >= 1 && n <= 12);
      const res = await fetch("/api/payroll/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: draft.employeeId,
          itemId: draft.itemId,
          amount: Number(draft.amount),
          validFrom: draft.validFrom || null,
          validTo: draft.validTo || null,
          payMonths: payMonths.length ? payMonths : null,
          note: draft.note || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "저장 실패");
      setDraft((p) => ({ ...p, amount: "", note: "" }));
      load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeRule = async (r: RuleRow) => {
    if (!window.confirm(`${r.employeeName}의 ${r.itemName} 규칙을 삭제할까요?`)) return;
    await fetch(`/api/payroll/rules?ruleId=${encodeURIComponent(r.ruleId)}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 px-5 pb-4">
      {/* 신규 규칙 입력 행 */}
      <div className="flex items-end gap-3 flex-wrap border cd-border-c rounded-2xl px-4 py-3">
        <label className="text-xs cd-text-faint">
          직원
          <select className="cd-select text-sm block mt-0.5" style={{ width: 120 }} value={draft.employeeId} onChange={(e) => setDraft((p) => ({ ...p, employeeId: e.target.value }))}>
            <option value="">선택</option>
            {employees.map((e) => (
              <option key={e.employeeId} value={e.employeeId}>{e.employeeName}</option>
            ))}
          </select>
        </label>
        <label className="text-xs cd-text-faint">
          항목
          <select className="cd-select text-sm block mt-0.5" style={{ width: 150 }} value={draft.itemId} onChange={(e) => setDraft((p) => ({ ...p, itemId: e.target.value }))}>
            {sortedItems.map((i) => (
              <option key={i.itemId} value={i.itemId}>
                {i.name}{i.kind === "deduction" ? " (공제)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs cd-text-faint">
          월 금액(원)
          <input className="cd-input text-sm block mt-0.5 text-right" style={{ width: 120 }} inputMode="numeric"
            value={draft.amount ? Number(draft.amount).toLocaleString() : ""}
            onChange={(e) => setDraft((p) => ({ ...p, amount: e.target.value.replace(/[^\d]/g, "") }))} />
        </label>
        <label className="text-xs cd-text-faint">
          시작(YYYY-MM)
          <input className="cd-input text-sm block mt-0.5" style={{ width: 100 }} placeholder="2026-01" value={draft.validFrom} onChange={(e) => setDraft((p) => ({ ...p, validFrom: e.target.value }))} />
        </label>
        <label className="text-xs cd-text-faint">
          종료(YYYY-MM)
          <input className="cd-input text-sm block mt-0.5" style={{ width: 100 }} placeholder="비우면 계속" value={draft.validTo} onChange={(e) => setDraft((p) => ({ ...p, validTo: e.target.value }))} />
        </label>
        <label className="text-xs cd-text-faint">
          지급월 제한
          <input className="cd-input text-sm block mt-0.5" style={{ width: 90 }} placeholder="예: 1,9" title="명절상여 등 특정 월만 지급 시 콤마 구분(비우면 매월)" value={draft.payMonths} onChange={(e) => setDraft((p) => ({ ...p, payMonths: e.target.value }))} />
        </label>
        <label className="text-xs cd-text-faint flex-1" style={{ minWidth: 140 }}>
          비고
          <input className="cd-input text-sm block mt-0.5 w-full" placeholder="자격증명·자녀명 등" value={draft.note} onChange={(e) => setDraft((p) => ({ ...p, note: e.target.value }))} />
        </label>
        <button type="button" disabled={busy} className="cd-fill-primary text-white rounded-xl px-3.5 py-2 text-sm font-bold flex items-center gap-1 disabled:opacity-40" onClick={addRule}>
          <Plus className="w-4 h-4" /> 규칙 추가
        </button>
        {msg && <span className="text-xs" style={{ color: "var(--cd-error)" }}>{msg}</span>}
      </div>

      {/* 규칙 목록 */}
      <div className="flex-1 min-h-0 overflow-auto border cd-border-c rounded-2xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="cd-text-faint text-[11px] border-b cd-border-c sticky top-0" style={{ background: "var(--cd-card-solid)" }}>
              <th className="text-left font-semibold p-2">직원</th>
              <th className="text-left font-semibold p-2">항목</th>
              <th className="text-right font-semibold p-2">월 금액</th>
              <th className="text-left font-semibold p-2">적용 기간</th>
              <th className="text-left font-semibold p-2">지급월</th>
              <th className="text-left font-semibold p-2">비고</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.ruleId} className="border-b cd-border-c last:border-0">
                <td className="p-2 cd-text font-semibold">{r.employeeName}</td>
                <td className="p-2 cd-text">{r.itemName}</td>
                <td className="p-2 text-right cd-text tabular-nums">{fmt(r.amount)}</td>
                <td className="p-2 cd-text-faint">{r.validFrom ?? "…"} ~ {r.validTo ?? "계속"}</td>
                <td className="p-2 cd-text-faint">{r.payMonths?.length ? `${r.payMonths.join(",")}월` : "매월"}</td>
                <td className="p-2 cd-text-faint">{r.note ?? ""}</td>
                <td className="p-2 text-right">
                  <button type="button" className="cd-btn rounded-lg p-1.5" title="삭제" style={{ color: "var(--cd-error)" }} onClick={() => removeRule(r)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rules.length && <p className="p-6 text-center text-sm cd-text-faint">등록된 규칙이 없습니다. 위에서 추가하세요.</p>}
      </div>
    </div>
  );
}
