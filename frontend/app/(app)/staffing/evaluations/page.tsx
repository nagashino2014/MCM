"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Save, Star } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdThemeToggle } from "@/components/cdash/CdThemeToggle";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import type { EvaluationRow } from "@/lib/staffing/evaluations";
import "@/components/cdash/cdash.css";

export default function EvaluationsPage() {
  const { theme, toggleTheme } = useCdashTheme();
  const now = new Date();
  const [departments, setDepartments] = useState<{ deptId: string; deptName: string }[]>([]);
  const [deptId, setDeptId] = useState("");
  const [year, setYear] = useState(now.getFullYear());
  const [half, setHalf] = useState(now.getMonth() < 6 ? "H1" : "H2");
  const [rows, setRows] = useState<EvaluationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/departments", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const list = d.departments ?? [];
        setDepartments(list);
        if (list.length && !deptId) setDeptId(list[0].deptId);
      })
      .catch(() => setDepartments([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!deptId) return;
    setLoading(true);
    setMsg(null);
    fetch(`/api/staffing/evaluations?dept=${encodeURIComponent(deptId)}&year=${year}&half=${half}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setRows(d.rows ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [deptId, year, half]);

  const yearOptions = useMemo(() => {
    const y = now.getFullYear();
    return [y + 1, y, y - 1, y - 2];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (i: number, patch: Partial<EvaluationRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/staffing/evaluations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          half,
          rows: rows.map((r) => ({
            contractId: r.contractId,
            employeeId: r.employeeId,
            participationPct: r.participationPct,
            rating: r.rating,
            ratingMemo: r.ratingMemo,
          })),
        }),
      });
      if (!res.ok) throw new Error("평점 저장에 실패했습니다.");
      setMsg("저장되었습니다.");
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<Star className="w-5 h-5" />}
        eyebrow="Staffing · Evaluation"
        title="반기 참여도·평점"
        subtitle="부서 용역별 수행인력의 반기 참여도와 평점(0~5)을 입력합니다. 성과급 산정의 기준 데이터입니다."
        actions={<CdThemeToggle theme={theme} onToggle={toggleTheme} />}
      />

      <section className="cd-card rounded-3xl p-4 cd-reveal delay-1 flex items-center gap-2 flex-wrap">
        <select className="cd-select text-sm" value={deptId} onChange={(e) => setDeptId(e.target.value)}>
          {departments.map((d) => (
            <option key={d.deptId} value={d.deptId}>{d.deptName}</option>
          ))}
        </select>
        <select className="cd-select text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
        <select className="cd-select text-sm" value={half} onChange={(e) => setHalf(e.target.value)}>
          <option value="H1">상반기</option>
          <option value="H2">하반기</option>
        </select>
        <span className="text-xs cd-text-faint">{rows.length}명</span>
        <div className="ml-auto flex items-center gap-2">
          {msg && <span className="text-[11px] cd-text-faint">{msg}</span>}
          <button type="button" disabled={saving || rows.length === 0} onClick={save} className="rounded-xl px-4 py-2 text-sm text-white cd-fill-primary inline-flex items-center gap-1.5 disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </section>

      <section className="cd-card rounded-3xl p-2 cd-reveal delay-2 flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        {loading ? (
          <div className="p-10 text-center text-sm cd-text-faint">불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm cd-text-faint">
            이 부서 용역에 수행인력이 없습니다. (계약 상세 › 공정표/수행인력에서 인력을 지정하세요.)
          </div>
        ) : (
          <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr className="cd-text-faint text-[11px] border-b cd-border-c">
                <th className="text-left font-semibold p-2.5" style={{ width: "34%" }}>용역</th>
                <th className="text-left font-semibold p-2.5" style={{ width: "18%" }}>인원 (역할)</th>
                <th className="text-left font-semibold p-2.5" style={{ width: "12%" }}>참여도(%)</th>
                <th className="text-left font-semibold p-2.5" style={{ width: "12%" }}>평점(0~5)</th>
                <th className="text-left font-semibold p-2.5" style={{ width: "24%" }}>코멘트</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.contractId}-${r.employeeId}`} className="border-b cd-border-c last:border-b-0">
                  <td className="p-2.5 align-middle">
                    <span className="block truncate cd-text">{r.contractTitle}</span>
                    {r.finalized && <span className="text-[10px] cd-text-faint">마감됨</span>}
                  </td>
                  <td className="p-2.5 align-middle">
                    <span className="cd-text">{r.employeeName}</span>
                    <span className="cd-text-faint text-xs"> {r.roleLabel}</span>
                  </td>
                  <td className="p-2">
                    <input type="number" min={0} max={110} className="cd-input text-sm w-full" value={r.participationPct} onChange={(e) => update(i, { participationPct: Number(e.target.value) })} />
                  </td>
                  <td className="p-2">
                    <input type="number" min={0} max={5} step={0.5} className="cd-input text-sm w-full" value={r.rating} onChange={(e) => update(i, { rating: Number(e.target.value) })} />
                  </td>
                  <td className="p-2">
                    <input className="cd-input text-sm w-full" value={r.ratingMemo ?? ""} onChange={(e) => update(i, { ratingMemo: e.target.value })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
