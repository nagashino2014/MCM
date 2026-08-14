"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, X } from "lucide-react";

/**
 * 신규 급여대장 생성 모달 (PL-P4, §4-1·§6-2 C)
 * 귀속 연월 선택 → EDI CSV 업로드(건강보험·연금, 종류 자동 감지) → 미리보기 → draft 생성.
 * 공제는 EDI 고지액 + 산식(고용·소득세·지방세), 지급은 전월 복사 + 수당 규칙 + 초과근무 자동.
 */

interface EdiStatus {
  nhis: { uploaded: boolean; count: number; sourceFile: string | null };
  nps: { uploaded: boolean; count: number; sourceFile: string | null };
}

interface PreviewEntry {
  employeeId: string;
  name: string;
  deptName: string | null;
  positionName: string | null;
  payTotal: number;
  deductionTotal: number;
  netPay: number;
  warnings: string[];
}

interface Preview {
  baseLedger: { payYear: number; payMonth: number } | null;
  ediReady: { nhis: boolean; nps: boolean };
  entries: PreviewEntry[];
}

const fmt = (v: number) => Math.round(v).toLocaleString();

export default function LedgerCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (year: number, month: number) => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [edi, setEdi] = useState<EdiStatus | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadEdi = useCallback(() => {
    fetch(`/api/payroll/edi?year=${year}&month=${month}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setEdi)
      .catch(() => setEdi(null));
  }, [year, month]);

  useEffect(() => {
    setPreview(null);
    loadEdi();
  }, [loadEdi]);

  const uploadEdi = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setMsg(null);
    try {
      for (const f of files) {
        const form = new FormData();
        form.append("file", f);
        form.append("year", String(year));
        form.append("month", String(month));
        const res = await fetch("/api/payroll/edi", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(`${f.name}: ${data.error ?? "업로드 실패"}`);
        const label = data.insurer === "nps" ? "연금" : "건강보험";
        setMsg(
          `${label} ${data.saved}명 반영(매칭 ${data.matched})` +
            (data.unmatched?.length ? ` · 미매칭: ${data.unmatched.join(", ")}` : "") +
            (data.ltcRate ? ` · 장기요양 요율 ${data.ltcRate}% 자동 반영` : "")
        );
      }
      loadEdi();
      setPreview(null);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const doPreview = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/payroll/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", year, month }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "미리보기 실패");
      setPreview(data);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doCreate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/payroll/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", year, month }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "생성 실패");
      onCreated(year, month);
    } catch (err) {
      setMsg((err as Error).message);
      setBusy(false);
    }
  };

  const warnCount = preview?.entries.filter((e) => e.warnings.length).length ?? 0;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center p-6 pt-12" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.35)" }} />
      <div
        className="cd-solid-bg relative z-10 w-full max-w-3xl max-h-[86vh] rounded-3xl p-5 flex flex-col gap-3"
        style={{ boxShadow: "var(--cd-shadow)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h3 className="text-base font-extrabold cd-text">새 급여대장 생성</h3>
          <button type="button" className="cd-btn rounded-xl p-1.5" onClick={onClose} aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-end gap-3 flex-wrap">
          <label className="text-xs cd-text-faint">
            귀속 연도
            <select className="cd-select text-sm block mt-0.5" style={{ width: 92 }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[now.getFullYear() + 1, now.getFullYear(), now.getFullYear() - 1].map((y) => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
          </label>
          <label className="text-xs cd-text-faint">
            월
            <select className="cd-select text-sm block mt-0.5" style={{ width: 76 }} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{m}월</option>
              ))}
            </select>
          </label>
          {/* EDI 상태 + 업로드 */}
          <div className="border cd-border-c rounded-2xl px-3.5 py-2 text-xs flex items-center gap-3" style={{ background: "var(--cd-card-solid)" }}>
            {(
              [
                ["nhis", "건강·요양"],
                ["nps", "국민연금"],
              ] as const
            ).map(([k, label]) => (
              <span key={k} className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: edi?.[k]?.uploaded ? "var(--cd-success)" : "var(--cd-faint)" }}
                />
                <span className="cd-text">{label}</span>
                <span className="cd-text-faint">{edi?.[k]?.uploaded ? `${edi[k].count}명` : "미업로드"}</span>
              </span>
            ))}
            <label className="cd-btn rounded-xl px-2.5 py-1.5 text-xs font-semibold flex items-center gap-1 cursor-pointer">
              <FileUp className="w-3.5 h-3.5" /> EDI CSV 업로드
              <input ref={fileRef} type="file" accept=".csv" multiple className="hidden" onChange={(e) => uploadEdi(e.target.files)} />
            </label>
          </div>
          <button type="button" disabled={busy} className="cd-btn rounded-xl px-3.5 py-2 text-sm font-semibold" onClick={doPreview}>
            미리보기
          </button>
          <button
            type="button"
            disabled={busy || !preview}
            className="cd-fill-primary text-white rounded-xl px-3.5 py-2 text-sm font-bold disabled:opacity-40"
            onClick={doCreate}
          >
            대장 생성
          </button>
        </div>
        {msg && <p className="text-xs" style={{ color: "var(--cd-warning)" }}>{msg}</p>}
        {preview && (
          <>
            <p className="text-xs cd-text-faint">
              기준(전월) 대장: {preview.baseLedger ? `${preview.baseLedger.payYear}년 ${preview.baseLedger.payMonth}월분` : "없음"} ·
              대상 {preview.entries.length}명{warnCount ? ` · 확인 필요 ${warnCount}명` : ""}
              {!preview.ediReady.nhis || !preview.ediReady.nps
                ? " · ⚠ EDI 미업로드 보험이 있어 국민연금·건강·요양이 비어 있을 수 있습니다(업로드 후 다시 미리보기)."
                : ""}
            </p>
            <div className="flex-1 min-h-0 overflow-auto border cd-border-c rounded-2xl">
              <table className="w-full text-xs">
                <thead>
                  <tr className="cd-text-faint border-b cd-border-c sticky top-0" style={{ background: "var(--cd-card-solid)" }}>
                    <th className="text-left font-semibold p-2">성명</th>
                    <th className="text-left font-semibold p-2">부서</th>
                    <th className="text-right font-semibold p-2">지급합계</th>
                    <th className="text-right font-semibold p-2">공제합계</th>
                    <th className="text-right font-semibold p-2">차인지급액</th>
                    <th className="text-left font-semibold p-2">확인 필요</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.entries.map((e) => (
                    <tr key={e.employeeId} className="border-b cd-border-c last:border-0">
                      <td className="p-2 cd-text font-semibold whitespace-nowrap">{e.name}</td>
                      <td className="p-2 cd-text whitespace-nowrap">{e.deptName ?? "-"}</td>
                      <td className="p-2 text-right cd-text tabular-nums">{fmt(e.payTotal)}</td>
                      <td className="p-2 text-right cd-text tabular-nums">{fmt(e.deductionTotal)}</td>
                      <td className="p-2 text-right font-bold tabular-nums" style={{ color: "var(--cd-primary)" }}>{fmt(e.netPay)}</td>
                      <td className="p-2" style={{ color: "var(--cd-warning)" }}>{e.warnings.join(" / ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] cd-text-faint">
              생성 후 월별 대장 화면에서 셀 단위 수정이 가능하며(작성 중 상태), [확정]하면 편집이 잠깁니다.
              초과근무수당은 전월 26일~금월 25일 근태 기준 자동 산정, 연차수당·성과급 등 변동 항목은 수기 입력입니다.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
