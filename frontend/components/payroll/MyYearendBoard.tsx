"use client";

// 내 연말정산(/payroll/my-yearend, 전 직원) — 자료 업로드(공제신고서 엑셀·홈택스 간소화 PDF) + 정산 결과 요약
// + 근로소득 원천징수영수증 PDF 뷰어 + 발급 신청(증명신청서 기안으로 prefill 연결).
// 관리자 연말정산(/payroll/yearend)은 전 직원 화면이라 개인은 볼 수 없어 신설(2026-09-14 사용자 요청).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, FileSpreadsheet, FileText, Printer, Stamp, Trash2, Upload } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdHelp } from "@/components/cdash/CdHelp";
import "@/components/cdash/cdash.css";

interface UploadRow {
  uploadId: string;
  kind: "simplified_pdf" | "deduction_form" | "other";
  kindLabel: string;
  fileName: string;
  sizeBytes: number;
  applied: boolean;
  createdAt: string;
}

interface BreakdownLine {
  label: string;
  amount: number;
  note?: string;
}

interface YearRow {
  year: number;
  status: "none" | "draft" | "confirmed";
  monthCount: number;
  grossPay: number;
  nonTaxablePay: number;
  prepaidTax: number;
  inputs: Record<string, number | undefined>;
  result: {
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
  } | null;
  hasOriginalPdf: boolean;
  originalPdfName: string | null;
  uploads: UploadRow[];
}

const won = (v: number) => Math.round(v).toLocaleString("ko-KR");
const kb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`);

export function MyYearendBoard() {
  const { theme } = useCdashTheme();
  const router = useRouter();
  const [years, setYears] = useState<YearRow[]>([]);
  const [linked, setLinked] = useState(true);
  const [year, setYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [issueYear, setIssueYear] = useState<number | null>(null);
  const [pdfNonce, setPdfNonce] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const xlsInput = useRef<HTMLInputElement>(null);
  const otherInput = useRef<HTMLInputElement>(null);

  const defaultYear = new Date().getFullYear() - 1;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetch("/api/payroll/my-yearend", { cache: "no-store" }).then((r) => r.json());
      if (d.error) throw new Error(String(d.error));
      setLinked(d.linked !== false);
      const list: YearRow[] = d.years ?? [];
      setYears(list);
      setYear((prev) => prev ?? (list.some((y) => y.year === defaultYear) ? defaultYear : list[0]?.year ?? defaultYear));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [defaultYear]);
  useEffect(() => {
    void load();
  }, [load]);

  const cur = useMemo(() => years.find((y) => y.year === year) ?? null, [years, year]);
  const yearOptions = useMemo(() => {
    const set = new Set<number>(years.map((y) => y.year));
    set.add(defaultYear);
    set.add(defaultYear + 1);
    return [...set].sort((a, b) => b - a);
  }, [years, defaultYear]);
  useEffect(() => {
    if (issueYear == null && year != null) setIssueYear(year);
  }, [year, issueYear]);

  const upload = async (kind: UploadRow["kind"], file: File | undefined) => {
    if (!file || !year) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("year", String(year));
      form.append("kind", kind);
      const res = await fetch("/api/payroll/my-yearend", { method: "POST", body: form });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setNotice(String(d.message ?? "업로드했습니다."));
      await load();
      setPdfNonce((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      for (const ref of [pdfInput, xlsInput, otherInput]) if (ref.current) ref.current.value = "";
    }
  };

  const remove = async (u: UploadRow) => {
    if (!window.confirm(`${u.fileName} 파일을 삭제할까요?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/payroll/my-yearend/uploads/${u.uploadId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "삭제 실패");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const print = () => {
    const w = frameRef.current?.contentWindow;
    try {
      w?.focus();
      w?.print();
    } catch {
      if (year) window.open(`/api/payroll/my-yearend/withholding?year=${year}`, "_blank", "noopener");
    }
  };

  /** 발급 신청 → 증명신청서 기안(원천징수영수증 체크·귀속연도 자동 입력). 결재선은 기안 화면에서 지정. */
  const requestIssue = () => {
    const y = issueYear ?? year;
    if (!y) return;
    const prefill = encodeURIComponent(
      JSON.stringify({ cert_kinds: ["원천징수영수증"], target_year: String(y), copies: "1", purpose: `${y}년 귀속 근로소득 원천징수영수증 발급` })
    );
    router.push(`/approval/draft?formId=frm-certificate-request&prefill=${prefill}`);
  };

  const hasReceipt = !!cur && (cur.hasOriginalPdf || !!cur.result);
  const r = cur?.result ?? null;

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="내 연말정산"
        help={
          <CdHelp label="내 연말정산 사용법">
            <p>① 귀속연도를 고르고 <b>홈택스 간소화 자료(PDF)</b>와 <b>소득·세액공제신고서(엑셀)</b>를 올립니다. 파일은 회사가 보관해 세무대리인 제출 자료로 묶이고, 읽어 낸 값은 앱의 연말정산 계산에 바로 쓰입니다.</p>
            <p>② 정산이 계산·확정되면 아래에 결정세액과 환급/추납액이 표시되고 <b>원천징수영수증</b>을 열람·출력할 수 있습니다. 세무대리인 원본이 등록되면 원본이 우선 표시됩니다.</p>
            <p>③ 직인본 발급이 필요하면 연도를 고르고 <b>발급 신청</b>을 누르세요 — 증명신청서에 원천징수영수증과 귀속연도가 채워진 채 열립니다. 승인되면 개인문서함으로 전달됩니다.</p>
          </CdHelp>
        }
        actions={
          <select className="cd-select" value={year ?? ""} onChange={(e) => setYear(Number(e.target.value))} aria-label="귀속연도">
            {yearOptions.map((y) => (
              <option key={y} value={y}>귀속 {y}년</option>
            ))}
          </select>
        }
      />

      {!linked ? (
        <div className="cd-card p-6 rounded-2xl text-sm cd-text-muted">계정에 직원 정보가 연결되어 있지 않아 연말정산을 조회할 수 없습니다. 관리자에게 문의하세요.</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4">
          {error && <div className="cd-error-text text-sm">{error}</div>}
          {notice && <div className="text-sm" style={{ color: "var(--cd-success,#13DEB9)" }}>{notice}</div>}

          <div className="grid grid-cols-1 2xl:grid-cols-5 gap-4">
            {/* 좌 — 자료 업로드 + 정산 결과 */}
            <div className="2xl:col-span-2 flex flex-col gap-4 min-w-0">
              <div className="cd-card p-4 rounded-2xl">
                <div className="flex items-center gap-2 mb-1">
                  <span className="cd-title-icon"><Upload className="w-4 h-4" /></span>
                  <div className="cd-card-title">{year}년 귀속 자료 업로드</div>
                  <span className={`ml-auto cd-pill ${cur?.status === "confirmed" ? "cd-pill-success" : cur?.status === "draft" ? "cd-pill-info" : "cd-pill-idle"}`}>
                    {cur?.status === "confirmed" ? "정산 확정" : cur?.status === "draft" ? (cur.result ? "계산됨" : "자료 수집 중") : "급여대장 대기"}
                  </span>
                </div>
                <p className="text-[11.5px] cd-text-faint mb-3">
                  간소화 PDF는 보험료·의료비·교육비·기부금·신용카드 등을 자동으로 읽고, 공제신고서 엑셀은 부양가족 명부를 읽습니다. 정산 확정 전까지 다시 올리면 새 값으로 갱신됩니다.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input ref={pdfInput} type="file" accept="application/pdf" className="hidden" onChange={(e) => void upload("simplified_pdf", e.target.files?.[0])} />
                  <input ref={xlsInput} type="file" accept=".xlsx,.xlsm,.xls" className="hidden" onChange={(e) => void upload("deduction_form", e.target.files?.[0])} />
                  <input ref={otherInput} type="file" className="hidden" onChange={(e) => void upload("other", e.target.files?.[0])} />
                  <button type="button" disabled={busy || !year} className="cd-btn rounded-xl px-3 py-2.5 text-sm font-semibold flex items-center gap-2 justify-center disabled:opacity-40" onClick={() => pdfInput.current?.click()}>
                    <FileText className="w-4 h-4" /> 홈택스 간소화 자료(PDF)
                  </button>
                  <button type="button" disabled={busy || !year} className="cd-btn rounded-xl px-3 py-2.5 text-sm font-semibold flex items-center gap-2 justify-center disabled:opacity-40" onClick={() => xlsInput.current?.click()}>
                    <FileSpreadsheet className="w-4 h-4" /> 소득·세액공제신고서(엑셀)
                  </button>
                  <button type="button" disabled={busy || !year} className="cd-btn rounded-xl px-3 py-2 text-xs font-semibold flex items-center gap-2 justify-center md:col-span-2 disabled:opacity-40" onClick={() => otherInput.current?.click()}>
                    <Upload className="w-3.5 h-3.5" /> 기타 증빙(월세 계약서·기부금 영수증 등)
                  </button>
                </div>
                <div className="mt-3">
                  {(cur?.uploads ?? []).length === 0 ? (
                    <p className="text-xs cd-text-faint py-2">올린 자료가 없습니다.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="cd-table-head">
                        <tr className="cd-text-faint border-b cd-border-c">
                          <th className="text-left font-semibold p-1.5">종류</th>
                          <th className="text-left font-semibold p-1.5">파일</th>
                          <th className="text-left font-semibold p-1.5 whitespace-nowrap">올린 날</th>
                          <th className="text-left font-semibold p-1.5">반영</th>
                          <th className="p-1.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {(cur?.uploads ?? []).map((u) => (
                          <tr key={u.uploadId} className="border-b cd-border-c last:border-0">
                            <td className="p-1.5 whitespace-nowrap cd-text">{u.kindLabel}</td>
                            <td className="p-1.5 min-w-0">
                              <a className="font-semibold truncate inline-block max-w-[200px] align-bottom" style={{ color: "var(--cd-primary)" }} href={`/api/payroll/my-yearend/uploads/${u.uploadId}`} target="_blank" rel="noreferrer" title={u.fileName}>
                                {u.fileName}
                              </a>
                              <span className="cd-text-faint ml-1">{kb(u.sizeBytes)}</span>
                            </td>
                            <td className="p-1.5 whitespace-nowrap cd-text-faint">{u.createdAt.slice(0, 10)}</td>
                            <td className="p-1.5 whitespace-nowrap">
                              {u.applied ? <span style={{ color: "var(--cd-success)" }}>계산 반영</span> : <span className="cd-text-faint">보관</span>}
                            </td>
                            <td className="p-1.5 text-right">
                              <button type="button" className="cd-btn rounded-lg p-1" title="삭제" style={{ color: "var(--cd-error)" }} disabled={busy} onClick={() => void remove(u)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <div className="cd-card p-4 rounded-2xl">
                <div className="cd-card-title mb-2">{year}년 귀속 정산 결과</div>
                {!cur || cur.status === "none" ? (
                  <p className="text-sm cd-text-faint">{year}년 확정 급여대장이 아직 없어 집계할 수 없습니다.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                      <Stat label="총급여(과세)" value={`${won(r?.grossPay ?? cur.grossPay)}원`} sub={`${cur.monthCount}개월 · 비과세 ${won(cur.nonTaxablePay)}원`} />
                      <Stat label="기납부 소득세" value={`${won(cur.prepaidTax)}원`} sub="매월 원천징수 합계" />
                      <Stat label="결정세액" value={r ? `${won(r.determinedTax)}원` : "미계산"} sub={r ? `산출세액 ${won(r.calculatedTax)} − 세액공제 ${won(r.taxCreditTotal)}` : "자료 업로드 후 관리자 계산"} />
                      <Stat
                        label={r ? (r.balance < 0 ? "환급 예상" : "추가 납부 예상") : "환급/추납"}
                        value={r ? `${won(Math.abs(r.balance))}원` : "—"}
                        sub={r ? `지방소득세 ${won(Math.abs(r.localTax))}원 별도` : ""}
                        tone={r ? (r.balance < 0 ? "info" : "danger") : undefined}
                      />
                    </div>
                    {r && (
                      <div className="grid gap-3 md:grid-cols-2 text-[11.5px]">
                        <div>
                          <div className="font-bold cd-text border-b cd-border-c pb-1 mb-1">소득공제 · 과세표준 {won(r.taxBase)}</div>
                          {r.incomeDeductions.map((l, i) => (
                            <div key={i} className="flex justify-between gap-2 py-0.5">
                              <span className="cd-text-muted truncate">{l.label}</span>
                              <span className="tabular-nums whitespace-nowrap">{won(l.amount)}</span>
                            </div>
                          ))}
                        </div>
                        <div>
                          <div className="font-bold cd-text border-b cd-border-c pb-1 mb-1">세액공제</div>
                          {r.taxCredits.map((l, i) => (
                            <div key={i} className="flex justify-between gap-2 py-0.5">
                              <span className="cd-text-muted truncate">{l.label}</span>
                              <span className="tabular-nums whitespace-nowrap">{won(l.amount)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* 우 — 원천징수영수증 뷰어 + 발급 신청 */}
            <div className="2xl:col-span-3 cd-card p-4 rounded-2xl min-w-0 flex flex-col">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <div className="cd-card-title">근로소득 원천징수영수증</div>
                {cur?.hasOriginalPdf ? (
                  <span className="cd-pill cd-pill-success" title={cur.originalPdfName ?? ""}>세무대리인 원본</span>
                ) : hasReceipt ? (
                  <span className="cd-pill cd-pill-info">앱 산출 요약본{cur?.status !== "confirmed" ? " · 미확정" : ""}</span>
                ) : null}
                <div className="ml-auto flex items-center gap-1.5 flex-wrap">
                  <button type="button" className="cd-btn rounded-xl px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-40" disabled={!hasReceipt} onClick={print}>
                    <Printer className="w-3.5 h-3.5" /> 출력
                  </button>
                  <a
                    className={`cd-btn cd-action rounded-xl px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1 ${hasReceipt ? "" : "pointer-events-none opacity-40"}`}
                    href={hasReceipt && year ? `/api/payroll/my-yearend/withholding?year=${year}` : "#"}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> 새 창 · PDF 저장
                  </a>
                </div>
              </div>
              <div className="flex-1 min-h-[480px] rounded-xl border cd-border-c overflow-hidden" style={{ background: "var(--cd-surface)" }}>
                {hasReceipt && year ? (
                  <iframe
                    ref={frameRef}
                    key={`${year}-${pdfNonce}`}
                    title="원천징수영수증 미리보기"
                    src={`/api/payroll/my-yearend/withholding?year=${year}&v=${pdfNonce}#toolbar=0`}
                    className="w-full h-full min-h-[480px]"
                  />
                ) : (
                  <div className="h-full min-h-[480px] flex items-center justify-center text-sm cd-text-faint text-center px-6">
                    {loading ? "불러오는 중…" : `${year}년 귀속 정산 결과가 아직 없습니다. 자료를 올리면 관리자가 계산·확정한 뒤 영수증이 표시됩니다.`}
                  </div>
                )}
              </div>

              {/* 발급 신청 — 귀속연도 선택 + 버튼 → 증명신청서 기안(prefill) */}
              <div className="mt-3 border cd-border-c rounded-xl px-3 py-2.5 flex items-center gap-2 flex-wrap">
                <span className="cd-title-icon"><Stamp className="w-4 h-4" /></span>
                <div className="text-xs cd-text min-w-0">
                  <div className="font-bold">직인본 발급 신청</div>
                  <div className="cd-text-faint">증명신청서가 원천징수영수증·귀속연도가 채워진 채 열립니다. 승인되면 개인문서함으로 전달됩니다.</div>
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <label className="text-[11px] cd-text-faint">
                    발급 희망 연도
                    <select className="cd-select text-sm block mt-0.5" value={issueYear ?? year ?? ""} onChange={(e) => setIssueYear(Number(e.target.value))}>
                      {yearOptions.map((y) => (
                        <option key={y} value={y}>귀속 {y}년</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="cd-fill-primary text-white rounded-xl px-3.5 py-2 text-sm font-bold inline-flex items-center gap-1.5 self-end" onClick={requestIssue}>
                    <CheckCircle2 className="w-4 h-4" /> 발급 신청
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "info" | "danger" }) {
  const color = tone === "info" ? "var(--cd-info,#539BFF)" : tone === "danger" ? "var(--cd-danger,#FA896B)" : undefined;
  return (
    <div className="border cd-border-c rounded-xl px-3 py-2 min-w-0">
      <div className="text-[11px] cd-text-faint">{label}</div>
      <div className="text-base font-extrabold tabular-nums truncate cd-text" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="text-[10.5px] cd-text-faint truncate">{sub}</div>}
    </div>
  );
}
