"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSignature } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";

/**
 * 상여금 지급 계획 모달(급여대장 → [상여금 지급 계획], 2026-09-14)
 * 사유·귀속월·적용 방식(일괄 동액 / 개별 차등)·대상자를 정하면 지급 명세가 채워진 전자결재 기안(draft)이 만들어지고
 * 기안 화면으로 이동한다(결재선=대표이사 직결). 승인되면 귀속월 상여대장(작성 중)이 자동 생성된다.
 * 성과급은 산정 기준으로 자동 계산되지만 상여(명절 등)는 금액을 정해 주는 옵션만 있으면 된다(사용자 확정).
 */

interface Candidate {
  employeeId: string;
  empNo: string | null;
  name: string;
  deptName: string | null;
  positionName: string | null;
}

const REASONS = ["설 명절 상여", "추석 명절 상여", "하계휴가비", "기타 상여"];
const fmt = (v: number) => Math.round(v).toLocaleString();
const digits = (s: string) => s.replace(/[^\d]/g, "");

export default function BonusPlanModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const now = new Date();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [reason, setReason] = useState(REASONS[0]);
  const [payMonth, setPayMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [mode, setMode] = useState<"uniform" | "individual">("uniform");
  const [uniformAmount, setUniformAmount] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [memos, setMemos] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/payroll/bonus-plan", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const list: Candidate[] = d.candidates ?? [];
        setCandidates(list);
        setSelected(new Set(list.map((c) => c.employeeId)));
      })
      .catch(() => setCandidates([]));
  }, [open]);

  const amountOf = (id: string) => (mode === "uniform" ? Number(digits(uniformAmount)) : Number(digits(amounts[id] ?? "")));
  const total = useMemo(() => [...selected].reduce((a, id) => a + (amountOf(id) || 0), 0), [selected, amounts, uniformAmount, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    if (!/^\d{4}-\d{2}$/.test(payMonth)) return setMsg("지급 귀속월은 YYYY-MM 형식으로 입력하세요.");
    if (!selected.size) return setMsg("대상자를 선택하세요.");
    if (mode === "uniform" && !(Number(digits(uniformAmount)) > 0)) return setMsg("일괄 지급액을 입력하세요.");
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/payroll/bonus-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payMonth,
          reason,
          mode,
          uniformAmount: mode === "uniform" ? Number(digits(uniformAmount)) : undefined,
          targets: [...selected].map((id) => ({ employeeId: id, amount: mode === "individual" ? Number(digits(amounts[id] ?? "")) : undefined, memo: memos[id] || null })),
          note: note || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "기안 생성 실패");
      onClose();
      router.push(String(d.href));
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CdModal
      open={open}
      onClose={onClose}
      title="상여금 지급 계획 기안"
      size="xl"
      closeOnBackdrop={false}
      footer={
        <>
          <span className="mr-auto text-sm cd-text">
            대상 <b>{selected.size}</b>명 · 총 <b>{fmt(total)}</b>원
          </span>
          {msg && <span className="text-xs" style={{ color: "var(--cd-error)" }}>{msg}</span>}
          <button type="button" className="cd-btn rounded-xl px-3 py-2 text-sm font-semibold" onClick={onClose}>취소</button>
          <button type="button" disabled={busy} className="cd-fill-primary text-white rounded-xl px-3.5 py-2 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-40" onClick={submit}>
            <FileSignature className="w-4 h-4" /> 기안 생성
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[11.5px] cd-text-faint">
          사규 별표 4: 상여금은 의무 지급 대상이 아니며 경영 상황·근태·업무 실적에 따라 미지급 또는 증감·차등 지급할 수 있습니다(제51조 — 재직자에 한함).
          기안이 승인되면 지급 귀속월의 상여대장(작성 중)이 자동 생성되고, 급여대장 화면에서 세액을 검토·확정합니다.
        </p>
        <div className="flex items-end gap-3 flex-wrap">
          <label className="text-xs cd-text-faint">
            지급 사유
            <select className="cd-select text-sm block mt-0.5" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="text-xs cd-text-faint">
            지급 귀속월(YYYY-MM)
            <input className="cd-input text-sm block mt-0.5" style={{ width: 110 }} value={payMonth} onChange={(e) => setPayMonth(e.target.value.trim())} />
          </label>
          <div className="text-xs cd-text-faint">
            적용 방식
            <div className="flex rounded-xl border cd-border-c overflow-hidden text-sm font-semibold mt-0.5">
              {(["uniform", "individual"] as const).map((k) => (
                <button key={k} type="button" data-active={mode === k} aria-pressed={mode === k} onClick={() => setMode(k)}
                  className={`cd-choice px-3 py-1.5 transition ${mode === k ? "cd-fill-primary text-white" : "cd-text"}`}>
                  {k === "uniform" ? "일괄 동액" : "개별 차등"}
                </button>
              ))}
            </div>
          </div>
          {mode === "uniform" && (
            <label className="text-xs cd-text-faint">
              일괄 지급액(원)
              <input className="cd-input text-sm block mt-0.5 text-right" style={{ width: 130 }} inputMode="numeric" value={uniformAmount ? fmt(Number(uniformAmount)) : ""} onChange={(e) => setUniformAmount(digits(e.target.value))} />
            </label>
          )}
          <label className="text-xs cd-text-faint flex-1" style={{ minWidth: 160 }}>
            비고
            <input className="cd-input text-sm block mt-0.5 w-full" value={note} onChange={(e) => setNote(e.target.value)} placeholder="지급 근거·특이사항" />
          </label>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold cd-text">대상자(재직자)</span>
          <button type="button" className="cd-btn rounded-lg px-2 py-1 text-[11px] font-semibold" onClick={() => setSelected(new Set(candidates.map((c) => c.employeeId)))}>전체 선택</button>
          <button type="button" className="cd-btn rounded-lg px-2 py-1 text-[11px] font-semibold" onClick={() => setSelected(new Set())}>전체 해제</button>
        </div>
        <div className="max-h-[46vh] overflow-auto border cd-border-c rounded-xl">
          <table className="w-full text-sm">
            <thead className="cd-table-head">
              <tr className="cd-text-faint text-[11px] border-b cd-border-c sticky top-0" style={{ background: "var(--cd-surface)" }}>
                <th className="p-2 w-8" />
                <th className="text-left font-semibold p-2">성명</th>
                <th className="text-left font-semibold p-2">부서</th>
                <th className="text-left font-semibold p-2">직함</th>
                <th className="text-right font-semibold p-2 whitespace-nowrap">지급액(원)</th>
                <th className="text-left font-semibold p-2">비고</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const on = selected.has(c.employeeId);
                return (
                  <tr key={c.employeeId} className="border-b cd-border-c last:border-0" style={on ? undefined : { opacity: 0.5 }}>
                    <td className="p-2 text-center"><input type="checkbox" checked={on} onChange={() => toggle(c.employeeId)} /></td>
                    <td className="p-2 cd-text font-semibold whitespace-nowrap">{c.name}</td>
                    <td className="p-2 cd-text-faint whitespace-nowrap">{c.deptName ?? "-"}</td>
                    <td className="p-2 cd-text-faint whitespace-nowrap">{c.positionName ?? "-"}</td>
                    <td className="p-1.5 text-right">
                      {mode === "uniform" ? (
                        <span className="tabular-nums cd-text">{on && uniformAmount ? fmt(Number(uniformAmount)) : ""}</span>
                      ) : (
                        <input className="cd-input text-sm text-right" style={{ width: 120 }} inputMode="numeric" disabled={!on}
                          value={amounts[c.employeeId] ? fmt(Number(amounts[c.employeeId])) : ""}
                          onChange={(e) => setAmounts((p) => ({ ...p, [c.employeeId]: digits(e.target.value) }))} />
                      )}
                    </td>
                    <td className="p-1.5">
                      <input className="cd-input text-sm w-full" disabled={!on} value={memos[c.employeeId] ?? ""} onChange={(e) => setMemos((p) => ({ ...p, [c.employeeId]: e.target.value }))} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!candidates.length && <p className="p-4 text-center text-sm cd-text-faint">재직자 목록을 불러오는 중입니다.</p>}
        </div>
      </div>
    </CdModal>
  );
}
