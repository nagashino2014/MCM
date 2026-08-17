"use client";

// 연말정산 보드 (블루프린트 P8) — 직원별 총급여·기납부(급여대장 자동) + 공제 입력(간소화 PDF 파싱 포함)
// → 결정세액·환급/추납 계산·확정. admin 전용(급여 §8-4). PayrollLedgerBoard 스타일 관례(cdash).
// 직원 대면 플로우(셀프 업로드·명세 발송)와 지급명세서 전자파일은 후속(P8 잔여).

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, RefreshCw, Undo2, Upload } from "lucide-react";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";

const won = (n: number) => n.toLocaleString("ko-KR");

interface BreakdownLine {
  label: string;
  amount: number;
  note?: string;
}

interface YearendResult {
  grossPay: number;
  earnedIncomeDeduction: number;
  earnedIncome: number;
  incomeDeductions: BreakdownLine[];
  incomeDeductionTotal: number;
  taxBase: number;
  calculatedTax: number;
  taxCredits: BreakdownLine[];
  taxCreditTotal: number;
  determinedTax: number;
  prepaidTax: number;
  balance: number;
  localTax: number;
}

interface SettlementRow {
  employeeId: string;
  name: string;
  deptName: string | null;
  grossPay: number;
  nonTaxablePay: number;
  prepaidTax: number;
  nationalPension: number;
  healthEmployment: number;
  monthCount: number;
  status: string;
  inputs: Record<string, number | undefined>;
  result: YearendResult | null;
}

/** 공제 입력 필드 정의 — 순서대로 2열 그리드 렌더. */
const INPUT_FIELDS: Array<{ key: string; label: string; hint?: string }> = [
  { key: "dependents", label: "부양가족 수(본인 제외)" },
  { key: "children", label: "자녀세액공제 대상 수" },
  { key: "elderly", label: "경로우대(70세↑) 수" },
  { key: "disabled", label: "장애인 수" },
  { key: "insurancePremium", label: "보장성 보험료" },
  { key: "medicalExpense", label: "의료비 총액" },
  { key: "educationExpense", label: "교육비" },
  { key: "donation", label: "기부금" },
  { key: "pensionAccount", label: "연금저축+IRP 납입" },
  { key: "monthlyRent", label: "월세 지급액" },
  { key: "cardCredit", label: "신용카드 사용액" },
  { key: "cardCheckCash", label: "직불·현금영수증" },
  { key: "cardTraditionalTransit", label: "전통시장+대중교통" },
  { key: "housingLoanDeduction", label: "주택자금 공제액" },
  { key: "otherIncomeDeduction", label: "기타 소득공제(보정)" },
  { key: "otherTaxCredit", label: "기타 세액공제(보정)" },
];

const COUNT_KEYS = new Set(["dependents", "children", "elderly", "disabled"]);

export default function YearendBoard() {
  const defaultYear = new Date().getFullYear() - 1; // 귀속연도(직전년) 기본
  const [year, setYear] = useState(defaultYear);
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/payroll/yearend?year=${year}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(String(data.error));
        else setRows(Array.isArray(data.rows) ? data.rows : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [year]);
  useEffect(load, [load]);

  const openRow = (r: SettlementRow) => {
    setOpenId(openId === r.employeeId ? null : r.employeeId);
    const d: Record<string, string> = {};
    for (const f of INPUT_FIELDS) {
      const v = r.inputs?.[f.key];
      if (v != null) d[f.key] = String(v);
    }
    setDraft(d);
  };

  const inputsFromDraft = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const f of INPUT_FIELDS) {
      const raw = draft[f.key];
      if (raw == null || raw === "") continue;
      const n = Number(raw.replace(/[^0-9]/g, ""));
      if (Number.isFinite(n) && n > 0) out[f.key] = n;
    }
    return out;
  };

  const save = async (employeeId: string, confirmAfter = false) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/payroll/yearend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", year, employeeId, inputs: inputsFromDraft() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (confirmAfter) {
        await fetch("/api/payroll/yearend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "confirm", year, employeeId }),
        });
      }
      setNotice(confirmAfter ? "계산·확정했습니다." : "계산했습니다 — 아래 브레이크다운을 확인하세요.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const uploadPdf = async (file: File) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/payroll/yearend", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const parsed = (data.inputs ?? {}) as Record<string, number>;
      setDraft((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(parsed)) if (v > 0) next[k] = String(v);
        return next;
      });
      setNotice(`간소화 PDF에서 ${Object.keys(parsed).length}개 항목을 채웠습니다${data.personName ? ` (대상자: ${data.personName})` : ""} — 값을 확인 후 계산하세요.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const totals = rows.reduce(
    (acc, r) => ({
      determined: acc.determined + (r.result?.determinedTax ?? 0),
      balance: acc.balance + (r.result?.balance ?? 0),
      done: acc.done + (r.result ? 1 : 0),
    }),
    { determined: 0, balance: 0, done: 0 },
  );

  return (
    <>
      <CdPageHeader title="연말정산" subtitle="" />
      <div className="cd-card p-4">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <div className="cd-card-title mr-auto">귀속 {year}년 — 직원별 정산</div>
          <select className="cd-select" value={year} onChange={(e) => { setYear(Number(e.target.value)); setOpenId(null); }}>
            {[defaultYear - 1, defaultYear, defaultYear + 1].map((y) => (
              <option key={y} value={y}>귀속 {y}년</option>
            ))}
          </select>
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={loading} onClick={load}>
            <RefreshCw className="w-3.5 h-3.5" /> 새로고침
          </button>
        </div>
        <div className="text-xs cd-text-muted mb-3">
          총급여(과세)·기납부 소득세·국민연금·건강/고용보험료는 확정 급여대장에서 자동 집계됩니다. 직원을 클릭해 간소화 PDF를
          올리거나 공제 값을 입력하고 계산하세요. 계산 완료 {totals.done}/{rows.length}명 · 환급(-)/추납(+) 합계 {won(totals.balance)}원.
          전환기에는 세무법인 정산 결과와 병행 대사하세요(§7).
        </div>
        {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
        {notice && <div className="text-sm mb-2" style={{ color: "var(--cd-success,#13DEB9)" }}>{notice}</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="cd-text-muted text-left">
                <th className="py-1.5 pr-3 font-normal">직원</th>
                <th className="py-1.5 pr-3 font-normal">부서</th>
                <th className="py-1.5 pr-3 font-normal text-right">총급여(과세)</th>
                <th className="py-1.5 pr-3 font-normal text-right">기납부 소득세</th>
                <th className="py-1.5 pr-3 font-normal text-right">결정세액</th>
                <th className="py-1.5 pr-3 font-normal text-right">환급/추납</th>
                <th className="py-1.5 font-normal">상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <>
                  <tr key={r.employeeId} className="border-t cd-hairline-row-c cursor-pointer cd-row-hover" onClick={() => openRow(r)}>
                    <td className="py-2 pr-3 whitespace-nowrap font-medium">{r.name}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-xs">{r.deptName ?? "-"}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{won(r.grossPay)}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{won(r.prepaidTax)}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{r.result ? won(r.result.determinedTax) : "-"}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap font-medium" style={r.result ? { color: r.result.balance < 0 ? "var(--cd-info,#539BFF)" : "var(--cd-danger,#FA896B)" } : undefined}>
                      {r.result ? `${r.result.balance < 0 ? "환급 " : "추납 "}${won(Math.abs(r.result.balance))}` : "-"}
                    </td>
                    <td className="py-2 whitespace-nowrap">
                      <span className={`cd-pill ${r.status === "confirmed" ? "cd-pill-success" : r.result ? "cd-pill-info" : "cd-pill-idle"}`}>
                        {r.status === "confirmed" ? "확정" : r.result ? "계산됨" : "미계산"}
                      </span>
                    </td>
                  </tr>
                  {openId === r.employeeId && (
                    <tr key={`${r.employeeId}-detail`} className="border-t cd-hairline-row-c">
                      <td colSpan={7} className="py-3 pl-4">
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <span className="text-sm font-medium mr-auto">
                            공제 입력 — {r.name} · 비과세 {won(r.nonTaxablePay)} · 국민연금 {won(r.nationalPension)} · 건강/고용 {won(r.healthEmployment)} (자동)
                          </span>
                          <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadPdf(e.target.files[0])} />
                          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                            <Upload className="w-3.5 h-3.5" /> 간소화 PDF로 채우기
                          </button>
                          <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={busy} onClick={() => void save(r.employeeId)}>
                            계산
                          </button>
                          {r.status !== "confirmed" ? (
                            <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={busy || !r.result} onClick={() => void save(r.employeeId, true)}>
                              <Check className="w-3.5 h-3.5" /> 계산·확정
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="cd-btn cd-btn-ghost cd-btn-sm"
                              disabled={busy}
                              onClick={async () => {
                                await fetch("/api/payroll/yearend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "unconfirm", year, employeeId: r.employeeId }) });
                                load();
                              }}
                            >
                              <Undo2 className="w-3.5 h-3.5" /> 확정 취소
                            </button>
                          )}
                        </div>
                        <div className="grid gap-x-4 gap-y-1.5 mb-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }}>
                          {INPUT_FIELDS.map((f) => (
                            <label key={f.key} className="flex items-center gap-2 text-xs">
                              <span className="cd-text-muted flex-1 truncate" title={f.label}>{f.label}</span>
                              <input
                                className="cd-input text-right"
                                style={{ width: COUNT_KEYS.has(f.key) ? 56 : 110 }}
                                inputMode="numeric"
                                value={draft[f.key] ?? ""}
                                placeholder="0"
                                onChange={(e) => setDraft((p) => ({ ...p, [f.key]: e.target.value.replace(/[^0-9]/g, "") }))}
                              />
                            </label>
                          ))}
                        </div>
                        {r.result && (
                          <div className="grid gap-4 lg:grid-cols-2 text-xs">
                            <div>
                              <div className="font-medium mb-1 text-sm">
                                과세표준 {won(r.result.taxBase)} · 산출세액 {won(r.result.calculatedTax)}
                              </div>
                              <div className="cd-text-muted mb-1">근로소득공제 {won(r.result.earnedIncomeDeduction)} → 근로소득금액 {won(r.result.earnedIncome)}</div>
                              {r.result.incomeDeductions.map((l, i) => (
                                <div key={i} className="flex justify-between gap-2">
                                  <span className="cd-text-muted truncate">{l.label}{l.note ? ` (${l.note})` : ""}</span>
                                  <span className="whitespace-nowrap">{won(l.amount)}</span>
                                </div>
                              ))}
                            </div>
                            <div>
                              <div className="font-medium mb-1 text-sm">
                                결정세액 {won(r.result.determinedTax)} · 기납부 {won(r.result.prepaidTax)} →{" "}
                                <span style={{ color: r.result.balance < 0 ? "var(--cd-info,#539BFF)" : "var(--cd-danger,#FA896B)" }}>
                                  {r.result.balance < 0 ? "환급" : "추납"} {won(Math.abs(r.result.balance))}
                                </span>{" "}
                                (지방소득세 {won(Math.abs(r.result.localTax))} 별도)
                              </div>
                              {r.result.taxCredits.map((l, i) => (
                                <div key={i} className="flex justify-between gap-2">
                                  <span className="cd-text-muted truncate">{l.label}{l.note ? ` (${l.note})` : ""}</span>
                                  <span className="whitespace-nowrap">{won(l.amount)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center cd-text-muted text-sm">귀속 {year}년 확정 급여대장이 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
