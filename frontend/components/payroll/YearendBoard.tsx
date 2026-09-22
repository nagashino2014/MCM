"use client";

// 연말정산 보드 (블루프린트 P8) — 직원별 총급여·기납부(급여대장 자동) + 공제 입력(간소화 PDF 파싱 포함)
// → 결정세액·환급/추납 계산·확정. admin 전용(급여 §8-4). PayrollLedgerBoard 스타일 관례(cdash).
// 직원 업로드·원본 영수증·자료 묶음은 연계하며, 명세 발송·지급명세서 전자파일의 지원 범위는 별도이다.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Download, FileText, RefreshCw, Stamp, Undo2, Upload } from "lucide-react";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import type { YearendInputs, YearendResult as StoredYearendResult } from "@/lib/finance/yearend";

const won = (n: number) => n.toLocaleString("ko-KR");

interface BreakdownLine {
  label: string;
  amount: number;
  note?: string;
}

interface YearendResult {
  grossPay: number;
  deemedBonus?: number;
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
  ruleEvidence?: StoredYearendResult["ruleEvidence"];
  choice?: StoredYearendResult["choice"];
}

interface SettlementRow {
  employeeId: string;
  name: string;
  deptName: string | null;
  grossPay: number;
  nonTaxablePay: number;
  prepaidTax: number;
  nationalPension: number;
  healthInsurance: number;
  employmentInsurance: number;
  healthEmployment: number;
  monthCount: number;
  status: string;
  inputs: YearendInputs;
  result: YearendResult | null;
}

/** 공제 입력 필드 정의 — 순서대로 2열 그리드 렌더. */
const INPUT_FIELDS: Array<{ key: string; label: string; hint?: string }> = [
  { key: "deemedBonus", label: "인정상여(소득처분·대장 외)", hint: "법인세 소득처분 인정상여 — 총급여에 가산, 원천징수 없음" },
  { key: "deemedBonusWithheld", label: "인정상여 기원천징수 소득세", hint: "소득금액변동통지로 이미 낸 소득세(기납부 가산)" },
  { key: "nationalPensionPaid", label: "국민연금 납부액(간소화)", hint: "간소화·납부확인서 값 — 입력 시 급여대장 공제액 대신 사용" },
  { key: "healthInsurancePaid", label: "건강+장기요양 납부액(간소화)", hint: "공단 고지액(정산분 포함) — 입력 시 급여대장 공제액 대신 사용" },
  { key: "employmentInsurancePaid", label: "고용보험 납부액", hint: "입력 시 급여대장 공제액 대신 사용(세무법인은 대장값 사용)" },
  { key: "dependents", label: "부양가족 수(본인 제외)" },
  { key: "children", label: "자녀세액공제 대상 수" },
  { key: "elderly", label: "경로우대(70세↑) 수" },
  { key: "disabled", label: "장애인 수" },
  { key: "insurancePremium", label: "보장성 보험료" },
  { key: "medicalExpense", label: "의료비 총액" },
  { key: "educationExpense", label: "교육비" },
  { key: "donation", label: "일반 기부금 지출액" },
  { key: "pensionAccount", label: "연금저축+IRP 납입" },
  { key: "monthlyRent", label: "월세 지급액" },
  { key: "cardCredit", label: "신용카드 사용액" },
  { key: "cardCheckCash", label: "직불·현금영수증" },
  { key: "cardTraditionalTransit", label: "전통시장+대중교통" },
  { key: "housingLoanDeduction", label: "주택자금 공제액" },
  { key: "otherIncomeDeduction", label: "기타 소득공제(보정)" },
  { key: "otherTaxCredit", label: "기타 공제세액(지출액 아님)" },
];

const COUNT_KEYS = new Set(["dependents", "children", "elderly", "disabled"]);

/** 직원 셀프 업로드 자료(223 yearend_employee_uploads) — 내 연말정산 화면에서 올린 파일 */
interface UploadRow {
  uploadId: string;
  employeeId: string;
  employeeName?: string;
  kindLabel: string;
  fileName: string;
  sizeBytes: number;
  applied: boolean;
  createdAt: string;
}

export default function YearendBoard() {
  const defaultYear = new Date().getFullYear() - 1; // 귀속연도(직전년) 기본
  const [year, setYear] = useState(defaultYear);
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [otherIncomeType, setOtherIncomeType] = useState("");
  const [otherIncomeReason, setOtherIncomeReason] = useState("");
  const [otherTaxType, setOtherTaxType] = useState("");
  const [otherTaxReason, setOtherTaxReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const originalRef = useRef<HTMLInputElement>(null);

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
    fetch(`/api/payroll/yearend/uploads?year=${year}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setUploads(Array.isArray(data.uploads) ? data.uploads : []))
      .catch(() => setUploads([]));
  }, [year]);
  useEffect(load, [load]);

  /** 세무법인 원본 원천징수영수증 등록 — 개인 열람·증명서 발급 원본이 된다. */
  const uploadOriginal = async (employeeId: string, file: File) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("year", String(year));
      form.append("employeeId", employeeId);
      const res = await fetch("/api/payroll/yearend/uploads", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setNotice("원천징수영수증 원본을 등록했습니다 — 직원 화면과 증명서 발급에 이 파일이 쓰입니다.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (originalRef.current) originalRef.current.value = "";
    }
  };

  const openRow = (r: SettlementRow) => {
    setOpenId(openId === r.employeeId ? null : r.employeeId);
    const d: Record<string, string> = {};
    for (const f of INPUT_FIELDS) {
      const v = r.inputs?.[f.key as keyof YearendInputs];
      if (v != null) d[f.key] = String(v);
    }
    setDraft(d);
    setOtherIncomeType(r.inputs.otherIncomeDeductionType ?? "");
    setOtherIncomeReason(r.inputs.otherIncomeDeductionReason ?? "");
    setOtherTaxType(r.inputs.otherTaxCreditType ?? "");
    setOtherTaxReason(r.inputs.otherTaxCreditReason ?? "");
  };

  const inputsFromDraft = (): YearendInputs => {
    const out: Record<string, number | string> = {};
    for (const f of INPUT_FIELDS) {
      const raw = draft[f.key];
      if (raw == null || raw === "") continue;
      const n = Number(raw.replace(/[^0-9]/g, ""));
      if (Number.isFinite(n) && n > 0) out[f.key] = n;
    }
    if (Number(out.otherIncomeDeduction) > 0) {
      out.otherIncomeDeductionType = otherIncomeType;
      out.otherIncomeDeductionReason = otherIncomeReason.trim();
    }
    if (Number(out.otherTaxCredit) > 0) {
      out.otherTaxCreditType = otherTaxType;
      out.otherTaxCreditReason = otherTaxReason.trim();
    }
    return out as YearendInputs;
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
        const confirmed = await fetch("/api/payroll/yearend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "confirm", year, employeeId }),
        });
        if (!confirmed.ok) {
          const failure = await confirmed.json().catch(() => ({}));
          throw new Error(failure.error ?? "계산은 저장했지만 확정하지 못했습니다. 새로고침 후 확인해 주세요.");
        }
      }
      setNotice(confirmAfter ? "계산·확정했습니다." : "계산했습니다 — 아래 브레이크다운을 확인하세요.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const unconfirm = async (employeeId: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/payroll/yearend", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unconfirm", year, employeeId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "확정을 취소하지 못했습니다.");
      setNotice("확정을 취소했습니다. 변경 내용을 검토한 뒤 다시 확정해 주세요.");
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
      <CdPageHeader title="연말정산" />
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
          <a className="cd-btn cd-action cd-btn-ghost cd-btn-sm" href={`/api/payroll/yearend/bundle?year=${year}`} title="직원 업로드 자료 + 원본 영수증 + 정산 요약 CSV 를 zip 으로 묶습니다(세무대리인 제출용).">
            <Download className="w-3.5 h-3.5" /> 제출 자료 묶음
          </a>
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
            <thead className="cd-table-head">
              <tr className="cd-text-muted text-left">
                <th className="py-1.5 pr-3 font-normal">직원</th>
                <th className="py-1.5 pr-3 font-normal">부서</th>
                <th className="py-1.5 pr-3 font-normal text-right">총급여(과세)</th>
                <th className="py-1.5 pr-3 font-normal text-right">기납부 소득세</th>
                <th className="py-1.5 pr-3 font-normal text-right">결정세액</th>
                <th className="py-1.5 pr-3 font-normal text-right">환급/추납</th>
                <th className="py-1.5 pr-3 font-normal text-right" title="직원이 내 연말정산에서 올린 자료 수">자료</th>
                <th className="py-1.5 font-normal">상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <>
                  <tr key={r.employeeId} className="border-t cd-hairline-row-c cursor-pointer cd-row-hover" onClick={() => openRow(r)}>
                    <td className="py-2 pr-3 whitespace-nowrap font-medium">{r.name}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-xs">{r.deptName ?? "-"}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap" title={r.result?.deemedBonus ? `급여대장 ${won(r.grossPay)} + 인정상여 ${won(r.result.deemedBonus)}` : undefined}>
                      {won(r.result?.deemedBonus ? r.result.grossPay : r.grossPay)}
                      {r.result?.deemedBonus ? <span className="cd-text-muted text-xs"> (인정상여 포함)</span> : null}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{won(r.prepaidTax)}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{r.result ? won(r.result.determinedTax) : "-"}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap font-medium" style={r.result ? { color: r.result.balance < 0 ? "var(--cd-info,#539BFF)" : "var(--cd-danger,#FA896B)" } : undefined}>
                      {r.result ? `${r.result.balance < 0 ? "환급 " : "추납 "}${won(Math.abs(r.result.balance))}` : "-"}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap cd-text-muted">
                      {uploads.filter((u) => u.employeeId === r.employeeId).length || "-"}
                    </td>
                    <td className="py-2 whitespace-nowrap">
                      <span className={`cd-pill ${r.status === "confirmed" ? "cd-pill-success" : r.result ? "cd-pill-info" : "cd-pill-idle"}`}>
                        {r.status === "confirmed" ? "확정" : r.result ? "계산됨" : "미계산"}
                      </span>
                    </td>
                  </tr>
                  {openId === r.employeeId && (
                    <tr key={`${r.employeeId}-detail`} className="border-t cd-hairline-row-c">
                      <td colSpan={8} className="py-3 pl-4">
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <span className="text-sm font-medium mr-auto">
                            {r.status === "confirmed"
                              ? `확정된 계산 결과 — ${r.name}. 변경하려면 확정 취소 후 검토해 주세요.`
                              : `공제 입력 — ${r.name} · 비과세 ${won(r.nonTaxablePay)} · 국민연금 ${won(r.nationalPension)} · 건강/요양 ${won(r.healthInsurance)} · 고용 ${won(r.employmentInsurance)} (급여대장 자동 — 간소화 납부액을 입력하면 대체)`}
                          </span>
                          <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadPdf(e.target.files[0])} />
                          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy || r.status === "confirmed"} onClick={() => fileRef.current?.click()}>
                            <Upload className="w-3.5 h-3.5" /> 간소화 PDF로 채우기
                          </button>
                          <input ref={originalRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadOriginal(r.employeeId, e.target.files[0])} />
                          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy} title="세무법인 원본 원천징수영수증(PDF) 등록 — 직원 열람·증명서 발급 원본" onClick={() => originalRef.current?.click()}>
                            <Stamp className="w-3.5 h-3.5" /> 원천징수영수증 원본 등록
                          </button>
                          {r.result && (
                            <a className="cd-btn cd-action cd-btn-ghost cd-btn-sm" href={`/api/payroll/yearend/withholding?year=${year}&employeeId=${encodeURIComponent(r.employeeId)}`} target="_blank" rel="noreferrer" title="원본이 있으면 원본, 없으면 앱 산출 요약본">
                              <FileText className="w-3.5 h-3.5" /> 영수증 미리보기
                            </a>
                          )}
                          <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={busy || r.status === "confirmed"} onClick={() => void save(r.employeeId)}>
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
                              onClick={() => void unconfirm(r.employeeId)}
                            >
                              <Undo2 className="w-3.5 h-3.5" /> 확정 취소
                            </button>
                          )}
                        </div>
                        {uploads.some((u) => u.employeeId === r.employeeId) && (
                          <div className="mb-3 text-xs border cd-hairline-row-c rounded-lg px-3 py-2">
                            <div className="font-medium mb-1">직원 업로드 자료(내 연말정산)</div>
                            {uploads.filter((u) => u.employeeId === r.employeeId).map((u) => (
                              <div key={u.uploadId} className="flex items-center gap-2 py-0.5">
                                <span className="cd-text-muted whitespace-nowrap">{u.kindLabel}</span>
                                <a className="font-medium truncate" style={{ color: "var(--cd-primary)" }} href={`/api/payroll/yearend/uploads/${u.uploadId}`} target="_blank" rel="noreferrer">{u.fileName}</a>
                                <span className="cd-text-muted whitespace-nowrap">{u.createdAt.slice(0, 10)}</span>
                                <span className="whitespace-nowrap" style={{ color: u.applied ? "var(--cd-success,#13DEB9)" : undefined }}>{u.applied ? "계산 반영" : "보관"}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="grid gap-x-4 gap-y-1.5 mb-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }}>
                          {INPUT_FIELDS.map((f) => (
                            <label key={f.key} className="flex items-center gap-2 text-xs">
                              <span className="cd-text-muted flex-1 truncate" title={f.hint ?? f.label}>{f.label}</span>
                              <input
                                className="cd-input text-right"
                                style={{ width: COUNT_KEYS.has(f.key) ? 56 : 110 }}
                                inputMode="numeric"
                                disabled={busy || r.status === "confirmed"}
                                value={draft[f.key] ?? ""}
                                placeholder="0"
                                onChange={(e) => setDraft((p) => ({ ...p, [f.key]: e.target.value.replace(/[^0-9]/g, "") }))}
                              />
                            </label>
                          ))}
                        </div>
                        {Number(draft.otherIncomeDeduction ?? 0) > 0 && (
                          <fieldset disabled={busy || r.status === "confirmed"} className="border cd-border-c rounded p-3 mb-3 text-xs">
                            <legend>기타 소득공제 근거</legend>
                            <label className="block mb-2">공제 종류
                              <select aria-label="기타 소득공제 종류" className="cd-select ml-2" value={otherIncomeType} onChange={(e) => setOtherIncomeType(e.target.value)}>
                                <option value="">종류를 선택하세요</option>
                                <option value="independent">표준세액공제와 병용 가능(그 밖의 소득공제)</option>
                                <option value="special">표준세액공제와 병용 불가(특별소득공제)</option>
                              </select>
                            </label>
                            <textarea aria-label="기타 소득공제 근거" className="cd-input w-full" value={otherIncomeReason} maxLength={2000}
                              onChange={(e) => setOtherIncomeReason(e.target.value)} placeholder="법정 공제 항목·적격 요건·금액 근거를 5자 이상 입력하세요." />
                            <p className="cd-text-muted mt-1">주택자금 대출 공제는 특별소득공제입니다. 주택마련저축 등 다른 항목과 구분하고 이미 입력한 공제를 중복 포함하지 마세요.</p>
                          </fieldset>
                        )}
                        {Number(draft.otherTaxCredit ?? 0) > 0 && (
                          <fieldset disabled={busy || r.status === "confirmed"} className="border cd-border-c rounded p-3 mb-3 text-xs">
                            <legend>기타 공제세액 근거</legend>
                            <label className="block mb-2">공제 종류
                              <select aria-label="기타 세액공제 종류" className="cd-select ml-2" value={otherTaxType} onChange={(e) => setOtherTaxType(e.target.value)}>
                                <option value="">종류를 선택하세요</option>
                                <option value="politicalDonation">정치자금 기부금 공제세액</option>
                                <option value="hometownDonation">고향사랑 기부금 공제세액</option>
                                <option value="employeeStockDonation">우리사주조합 기부금 공제세액</option>
                                <option value="independent">그 밖의 병용 가능한 공제세액(근거 확인)</option>
                                <option value="special">표준세액공제와 병용 불가한 특별세액공제</option>
                              </select>
                            </label>
                            <textarea aria-label="기타 세액공제 근거" className="cd-input w-full" value={otherTaxReason} maxLength={2000}
                              onChange={(e) => setOtherTaxReason(e.target.value)} placeholder="적용 연도·법정 항목·계산식·한도 확인 근거를 5자 이상 입력하세요." />
                            <p className="cd-text-muted mt-1">지출액이 아닌 계산된 공제세액입니다. 정치자금·고향사랑·우리사주조합 기부금을 일반 기부금에도 중복 입력하지 마세요. 종류별 자격·한도 계산은 별도 확인이 필요합니다.</p>
                          </fieldset>
                        )}
                        {r.result?.choice && (
                          <div className="border cd-border-c rounded p-3 mb-3 text-xs">
                            <p className="font-medium mb-2">공제 적용 비교 — {r.result.choice.selected === "standard" ? "표준세액공제" : "특별공제"} 선택</p>
                            <div className="overflow-x-auto">
                              <table className="w-full text-right">
                                <thead className="cd-table-head"><tr><th className="text-left">적용 방식</th><th>과세표준</th><th>산출세액</th><th>근로소득세액공제</th><th>결정세액</th></tr></thead>
                                <tbody>{(["standard", "special"] as const).map((kind) => {
                                  const c = r.result!.choice!.candidates[kind];
                                  return <tr key={kind}><td className="text-left">{kind === "standard" ? "표준세액공제" : "특별공제"}</td>
                                    <td>{won(c.taxBase)}</td><td>{won(c.calculatedTax)}</td><td>{won(c.earnedTaxCredit)}</td><td>{won(c.determinedTax)}</td></tr>;
                                })}</tbody>
                              </table>
                            </div>
                            <p className="mt-2 cd-text-muted">{r.result.choice.reason} 표준 경로에서는 건강·고용보험료, 주택자금, 특별세액공제와 월세를 적용하지 않습니다. 입력한 자료는 보존됩니다.</p>
                            <p className="mt-1 cd-text-muted">{r.result.ruleEvidence?.targetYear}년 근로소득세액공제·표준공제 선택 규칙 적용. 다른 공제의 연도별 자격·한도와 지방세는 별도 검토 대상입니다.</p>
                          </div>
                        )}
                        {r.result && !r.result.choice && <p className="mb-3 text-xs cd-text-muted">이전 규칙으로 저장된 계산 결과입니다. 확정본은 보존되며, 초안은 현재 규칙으로 다시 계산한 뒤 확정하세요.</p>}
                        {r.result && (
                          <div className="grid gap-4 lg:grid-cols-2 text-xs">
                            <div>
                              <div className="font-medium mb-1 text-sm">
                                과세표준 {won(r.result.taxBase)} · 산출세액 {won(r.result.calculatedTax)}
                              </div>
                              <div className="cd-text-muted mb-1">
                                총급여 {won(r.result.grossPay)}{r.result.deemedBonus ? ` (급여대장 ${won(r.grossPay)} + 인정상여 ${won(r.result.deemedBonus)})` : ""} · 근로소득공제 {won(r.result.earnedIncomeDeduction)} → 근로소득금액 {won(r.result.earnedIncome)}
                              </div>
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
                  <td colSpan={8} className="py-6 text-center cd-text-muted text-sm">귀속 {year}년 확정 급여대장이 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
