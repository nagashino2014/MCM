"use client";

// 개인 경비 정산(FRM-P6, 203) — 승인된 지출결의서(개인)·출장보고서의 개인 증빙 행을
// 월 1회 일괄 정산한다. 미정산 현황(인별) → [일괄 정산 실행] → 이력에서 CMS 생성·부가세 자료 발송.
// 이체 실행은 담당자가 KB 기업뱅킹에서 수동(CMS 파일 업로드) — 앱은 파일 생성·이력까지.
// G-8(2026-10-20): 경비 환급 화면을 폐지하고 개인 경비 이체 경로를 이 정산 하나로 모았다. 불지급 식대 합계·
// 급여 차감 표시와, 정산 범위 밖 과거 지출(조회 전용)을 함께 보여 준다.

import { useCallback, useEffect, useState } from "react";
import { Banknote, ChevronDown, ChevronRight, Download, FileSpreadsheet, ListTree, Mail, Play, TriangleAlert } from "lucide-react";
import { CdHelp } from "@/components/cdash/CdHelp";
import { CdModal } from "@/components/cdash/CdModal";

interface UnsettledItem {
  rowRef: string;
  docId: string;
  docNo: string | null;
  formId: string;
  employeeId: string | null;
  employeeName: string | null;
  usedOn: string | null;
  vendor: string | null;
  category: string | null;
  amount: number;
  detail: string | null;
  /** 식대 급여 차감 처분 — 정산에 포함, 회수는 급여대장 '식대환수' 공제 */
  mealDeduct?: boolean;
}
interface OutOfScopeRow {
  docId: string;
  docNo: string | null;
  formId: string;
  employeeName: string | null;
  completedAt: string | null;
  usedOn: string | null;
  vendor: string | null;
  amount: number;
  kind: "manual" | "shop";
}
interface PersonTotal {
  employeeId: string | null;
  employeeName: string;
  positionName: string | null;
  bankCode: string | null;
  bankAccount: string | null;
  amount: number;
  count: number;
}
interface SettlementRow {
  settlementId: string;
  settledOn: string;
  periodFrom: string | null;
  periodTo: string | null;
  totalAmount: number;
  itemCount: number;
  personCount: number;
  cmsFileKey: string | null;
  vatBundleSentAt: string | null;
  vatBundleSentTo: string | null;
  note: string | null;
}
interface TrendRow {
  month: string;
  amount: number;
  count: number;
}

const comma = (n: number) => n.toLocaleString("ko-KR");
const FORM_LABEL: Record<string, string> = {
  "frm-expense-report": "지출결의서(법인카드)",
  "frm-expense-personal": "지출결의서(개인)",
  "frm-biz-trip-report": "출장보고서",
};

export function ExpenseSettlementPanel() {
  const [items, setItems] = useState<UnsettledItem[]>([]);
  const [persons, setPersons] = useState<PersonTotal[]>([]);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [withheld, setWithheld] = useState<{ count: number; amount: number }>({ count: 0, amount: 0 });
  const [outOfScope, setOutOfScope] = useState<OutOfScopeRow[]>([]);
  const [outOpen, setOutOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ items: UnsettledItem[]; persons: PersonTotal[] } | null>(null);
  // 인별 미정산 상세 모달(2026-08-26 사용자 요청) — 지급대상액 옆 [상세] 태그로 연다.
  const [personDetail, setPersonDetail] = useState<PersonTotal | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [unsettledRes, listRes, trendRes] = await Promise.all([
        fetch("/api/finance/expense-settlement", { cache: "no-store" }),
        fetch("/api/finance/expense-settlement?view=list", { cache: "no-store" }),
        fetch(`/api/finance/expense-settlement?trend=${new Date().getFullYear()}`, { cache: "no-store" }),
      ]);
      const unsettled = await unsettledRes.json();
      const list = await listRes.json();
      const trendData = await trendRes.json();
      if (!unsettledRes.ok) throw new Error(unsettled?.error ?? "조회 실패");
      setItems(unsettled.items ?? []);
      setPersons(unsettled.persons ?? []);
      setWithheld(unsettled.withheld ?? { count: 0, amount: 0 });
      setOutOfScope(unsettled.outOfScope ?? []);
      setSettlements(list.settlements ?? []);
      setTrend(trendData.trend ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (settlementId: string) => {
    if (openId === settlementId) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(settlementId);
    setDetail(null);
    const res = await fetch(`/api/finance/expense-settlement?settlementId=${settlementId}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setDetail({ items: data.items ?? [], persons: data.persons ?? [] });
  };

  const act = async (body: Record<string, unknown>, busyKey: string, confirmMsg?: string): Promise<Record<string, unknown> | null> => {
    if (confirmMsg && !confirm(confirmMsg)) return null;
    setBusy(busyKey);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/finance/expense-settlement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "처리 실패");
      return data as Record<string, unknown>;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const runNow = async () => {
    const data = await act(
      { action: "run" },
      "run",
      `미정산 ${items.length}건(${comma(items.reduce((a, i) => a + i.amount, 0))}원, ${persons.length}명)을 일괄 정산할까요?\n정산 후 이력에서 CMS 파일을 생성할 수 있습니다.`
    );
    if (data) {
      setNotice("일괄 정산이 완료되었습니다. 아래 이력에서 CMS 생성·부가세 자료 발송을 진행하세요.");
      await load();
    }
  };

  const makeCms = async (settlementId: string) => {
    const data = await act({ action: "cms", settlementId }, `cms-${settlementId}`);
    if (data) {
      const warnings = Array.isArray(data.warnings) ? (data.warnings as string[]) : [];
      setNotice(
        `CMS 파일이 생성되었습니다: ${String(data.fileName ?? "")}` + (warnings.length ? `\n⚠ ${warnings.join(" / ")}` : "")
      );
      await load();
    }
  };

  const sendVat = async (settlementId: string) => {
    const toEmail = prompt("부가세 자료를 받을 세무사 메일 주소를 입력하세요.");
    if (!toEmail?.trim()) return;
    const data = await act({ action: "vat-send", settlementId, toEmail: toEmail.trim() }, `vat-${settlementId}`);
    if (data) {
      setNotice("부가세 자료(지출결의서(개인)·출장보고서 개인 지출 내역·영수증 묶음)를 발송했습니다.");
      await load();
    }
  };

  const unsettledTotal = items.reduce((a, i) => a + i.amount, 0);
  const noAccount = persons.filter((p) => !p.bankCode || !p.bankAccount);
  const trendMax = Math.max(1, ...trend.map((t) => t.amount));

  return (
    <div className="flex flex-col gap-4">
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["미정산 건수", `${items.length}건`],
          ["미정산 금액", `${comma(unsettledTotal)}원`],
          ["대상 인원", `${persons.length}명`],
          ["최근 정산일", settlements[0]?.settledOn ?? "-"],
        ].map(([label, value]) => (
          <div key={label} className="cd-card border cd-border-c p-4">
            <p className="text-[11px] cd-text-faint">{label}</p>
            <p className="text-[18px] font-bold cd-text mt-1">{value}</p>
          </div>
        ))}
      </div>

      {(error || notice) && (
        <div className="rounded-lg border cd-border-c px-3 py-2 text-[12px] whitespace-pre-line" style={{ color: error ? "var(--cd-error,#FA896B)" : undefined }}>
          {error ?? notice}
        </div>
      )}

      {/* 미정산 현황(인별) */}
      <div className="cd-card border cd-border-c p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[13px] font-bold cd-text flex items-center gap-1.5">
            <Banknote className="w-4 h-4" /> 미정산 개인 지출 (인별)<CdHelp topic="finance.expsettle" />
          </p>
          <button
            type="button"
            className="cd-btn cd-btn-primary cd-btn-sm ml-auto"
            disabled={busy === "run" || items.length === 0}
            onClick={() => void runNow()}
          >
            <Play className="w-3.5 h-3.5" /> 일괄 정산 실행
          </button>
        </div>
        {noAccount.length > 0 && (
          <p className="text-[11.5px] flex items-center gap-1.5" style={{ color: "var(--cd-warning,#FFAE1F)" }}>
            <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
            계좌 미등록: {noAccount.map((p) => p.employeeName).join(", ")} — 사용자 등록/수정의 인사관리 탭에서 은행코드·계좌번호를 등록하면 CMS에 자동 기입됩니다.
          </p>
        )}
        {withheld.count > 0 && (
          <p className="text-[11.5px] cd-text-muted">
            근태 관리의 식대 경고에서 불지급 처분한 {withheld.count}건({comma(withheld.amount)}원)은 정산에서 제외됩니다.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr>
                {["성명", "직급", "건수", "지급대상액", "은행코드", "계좌번호"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left cd-surface-bg cd-text font-bold whitespace-nowrap border-b cd-border-c">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center cd-text-faint">불러오는 중…</td></tr>
              ) : persons.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center cd-text-faint">미정산 지출 건이 없습니다.</td></tr>
              ) : (
                persons.map((p) => (
                  <tr key={p.employeeId ?? p.employeeName} className="border-b cd-border-c last:border-b-0">
                    <td className="px-3 py-[11.5px] cd-text whitespace-nowrap">{p.employeeName}</td>
                    <td className="px-3 py-[11.5px] cd-text-muted whitespace-nowrap">{p.positionName ?? "-"}</td>
                    <td className="px-3 py-[11.5px] cd-text whitespace-nowrap">{p.count}건</td>
                    <td className="px-3 py-[11.5px] whitespace-nowrap text-right">
                      <span className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          className="rounded-full border cd-border-c px-2 py-0.5 text-[10.5px] cd-text-muted hover:cd-tint-primary inline-flex items-center gap-1"
                          title="지출 항목별 내역 보기"
                          onClick={() => setPersonDetail(p)}
                        >
                          <ListTree className="w-3 h-3" /> 상세
                        </button>
                        <span className="cd-text font-bold">{comma(p.amount)}원</span>
                      </span>
                    </td>
                    <td className="px-3 py-[11.5px] cd-text-muted whitespace-nowrap">{p.bankCode ?? <span style={{ color: "var(--cd-warning,#FFAE1F)" }}>미등록</span>}</td>
                    <td className="px-3 py-[11.5px] cd-text-muted whitespace-nowrap">{p.bankAccount ?? "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 정산 범위 밖 과거 지출(G-8) — 직접 입력이 막히기 전 승인분. 조회만, 이체는 은행에서 개별 처리 */}
      {outOfScope.length > 0 && (
        <div className="cd-card border cd-border-c p-4 flex flex-col gap-3">
          <button type="button" className="cd-action text-[13px] font-bold cd-text flex items-center gap-1.5 text-left" onClick={() => setOutOpen((v) => !v)}>
            {outOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <TriangleAlert className="w-4 h-4" style={{ color: "var(--cd-warning,#FFAE1F)" }} /> 정산 범위 밖 과거 지출 {outOfScope.length}건 ·{" "}
            {comma(outOfScope.reduce((a, r) => a + r.amount, 0))}원
          </button>
          <p className="text-[11.5px] cd-text-muted">
            직접 입력이 막히기 전에 승인된 출장보고서의 수기 행과 지출결의서(법인카드)의 카드 외 행입니다. 일괄 정산에 넣지 않습니다 —
            법인카드 사용분을 손으로 적은 행일 수 있으니 원본 문서를 확인하고, 개인 지출이 맞으면 은행에서 개별 이체하세요.
          </p>
          {outOpen && (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr>
                    {["결재 종결일", "기안자", "문서", "사용일", "상호", "금액", "구분"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left cd-surface-bg cd-text font-bold whitespace-nowrap border-b cd-border-c">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {outOfScope.map((r, i) => (
                    <tr key={`${r.docId}-${i}`} className="border-b cd-border-c last:border-b-0">
                      <td className="px-3 py-[11.5px] cd-text-muted whitespace-nowrap">{r.completedAt ?? "-"}</td>
                      <td className="px-3 py-[11.5px] cd-text whitespace-nowrap">{r.employeeName ?? "-"}</td>
                      <td className="px-3 py-[11.5px] cd-text-faint whitespace-nowrap">{(FORM_LABEL[r.formId] ?? r.formId) + (r.docNo ? ` · ${r.docNo}` : "")}</td>
                      <td className="px-3 py-[11.5px] cd-text whitespace-nowrap">{r.usedOn ?? "-"}</td>
                      <td className="px-3 py-[11.5px] cd-text">{r.vendor ?? "-"}</td>
                      <td className="px-3 py-[11.5px] cd-text font-bold whitespace-nowrap text-right">{comma(r.amount)}원</td>
                      <td className="px-3 py-[11.5px] cd-text-faint whitespace-nowrap">{r.kind === "shop" ? "카드 미매칭 전표" : "수기"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 정산 이력 */}
      <div className="cd-card border cd-border-c p-4 flex flex-col gap-3">
        <p className="text-[13px] font-bold cd-text flex items-center gap-1.5">
          <FileSpreadsheet className="w-4 h-4" /> 정산 이력
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr>
                {["", "정산일", "대상 기간", "건수", "인원", "총액", "CMS", "부가세 자료", "메모"].map((h, i) => (
                  <th key={i} className="px-3 py-2 text-left cd-surface-bg cd-text font-bold whitespace-nowrap border-b cd-border-c">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {settlements.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-6 text-center cd-text-faint">정산 이력이 없습니다.</td></tr>
              ) : (
                settlements.map((s) => (
                  <SettlementRowView
                    key={s.settlementId}
                    row={s}
                    open={openId === s.settlementId}
                    detail={openId === s.settlementId ? detail : null}
                    busy={busy}
                    onToggle={() => void openDetail(s.settlementId)}
                    onCms={() => void makeCms(s.settlementId)}
                    onVat={() => void sendVat(s.settlementId)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 월별 추이(정산 완료 기준) */}
      <div className="cd-card border cd-border-c p-4 flex flex-col gap-3">
        <p className="text-[13px] font-bold cd-text">{new Date().getFullYear()}년 월별 개인 지출 추이</p>
        {trend.length === 0 ? (
          <p className="text-[12px] cd-text-faint">정산 완료 데이터가 쌓이면 표시됩니다.</p>
        ) : (
          <div className="flex items-end gap-2 h-32">
            {trend.map((t) => (
              <div key={t.month} className="flex flex-col items-center gap-1 flex-1 min-w-0" title={`${t.month}: ${comma(t.amount)}원 (${t.count}건)`}>
                <span className="text-[10px] cd-text-faint">{comma(t.amount)}</span>
                <div className="w-full max-w-[36px] rounded-t cd-fill-primary" style={{ height: `${Math.max(4, (t.amount / trendMax) * 90)}px` }} />
                <span className="text-[10px] cd-text-muted">{t.month.slice(5)}월</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 인별 미정산 상세 모달 — 지출결의서·출장보고서 지출내역 행 그대로(2026-08-26) */}
      <CdModal
        open={personDetail != null}
        onClose={() => setPersonDetail(null)}
        size="xl"
        title={personDetail ? `${personDetail.employeeName} 미정산 지출 내역 — ${comma(personDetail.amount)}원 (${personDetail.count}건)` : ""}
      >
        {personDetail && (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr>
                  {["사용일시", "분류", "상호", "금액", "지출 목적", "출처"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left cd-surface-bg cd-text font-bold whitespace-nowrap border-b cd-border-c">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items
                  .filter((i) => (i.employeeId ?? i.employeeName ?? "unknown") === (personDetail.employeeId ?? personDetail.employeeName))
                  .map((i) => (
                    <tr key={i.rowRef} className="border-b cd-border-c last:border-b-0">
                      <td className="px-3 py-[11.5px] cd-text whitespace-nowrap">{i.usedOn ?? "-"}</td>
                      <td className="px-3 py-[11.5px] cd-text-muted whitespace-nowrap">{i.category ?? "-"}</td>
                      <td className="px-3 py-[11.5px] cd-text whitespace-nowrap">{i.vendor ?? "-"}</td>
                      <td className="px-3 py-[11.5px] cd-text font-bold whitespace-nowrap text-right">
                        {comma(i.amount)}원
                        {i.mealDeduct && (
                          <span className="ml-1.5 text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: "var(--cd-warning,#FFAE1F)", color: "#fff" }} title="급여대장 '식대환수' 공제로 회수됩니다">
                            급여 차감
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-[11.5px] cd-text-muted">{i.detail ?? "-"}</td>
                      <td className="px-3 py-[11.5px] cd-text-faint whitespace-nowrap">
                        {(FORM_LABEL[i.formId] ?? i.formId) + (i.docNo ? ` · ${i.docNo}` : "")}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </CdModal>
    </div>
  );
}

function SettlementRowView({
  row: s,
  open,
  detail,
  busy,
  onToggle,
  onCms,
  onVat,
}: {
  row: SettlementRow;
  open: boolean;
  detail: { items: UnsettledItem[]; persons: PersonTotal[] } | null;
  busy: string | null;
  onToggle: () => void;
  onCms: () => void;
  onVat: () => void;
}) {
  return (
    <>
      <tr className="border-b cd-border-c">
        <td className="px-2 py-[11.5px] w-7">
          <button type="button" className="cd-text-faint" onClick={onToggle} title="내역 펼치기">
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </td>
        <td className="px-3 py-[11.5px] cd-text whitespace-nowrap">{s.settledOn}</td>
        <td className="px-3 py-[11.5px] cd-text-muted whitespace-nowrap">
          {s.periodFrom ?? "-"} ~ {s.periodTo ?? "-"}
        </td>
        <td className="px-3 py-[11.5px] cd-text whitespace-nowrap">{s.itemCount}건</td>
        <td className="px-3 py-[11.5px] cd-text whitespace-nowrap">{s.personCount}명</td>
        <td className="px-3 py-[11.5px] cd-text font-bold whitespace-nowrap text-right">{comma(s.totalAmount)}원</td>
        <td className="px-3 py-[11.5px] whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5">
            <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy === `cms-${s.settlementId}`} onClick={onCms}>
              <FileSpreadsheet className="w-3.5 h-3.5" /> {s.cmsFileKey ? "재생성" : "CMS 생성"}
            </button>
            {s.cmsFileKey && (
              <a className="cd-btn cd-btn-soft cd-btn-sm" href={`/api/finance/expense-settlement/download?settlementId=${s.settlementId}`}>
                <Download className="w-3.5 h-3.5" /> 다운로드
              </a>
            )}
          </span>
        </td>
        <td className="px-3 py-[11.5px] whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5">
            <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy === `vat-${s.settlementId}`} onClick={onVat}>
              <Mail className="w-3.5 h-3.5" /> {busy === `vat-${s.settlementId}` ? "생성·발송 중…" : "부가세 자료 발송"}
            </button>
            {s.vatBundleSentAt && (
              <span className="text-[10.5px] cd-text-faint">
                {s.vatBundleSentAt.slice(0, 10)} → {s.vatBundleSentTo}
              </span>
            )}
          </span>
        </td>
        <td className="px-3 py-[11.5px] cd-text-muted">{s.note ?? "-"}</td>
      </tr>
      {open && (
        <tr className="border-b cd-border-c">
          <td colSpan={9} className="px-4 py-3 cd-surface-bg">
            {!detail ? (
              <p className="text-[12px] cd-text-faint">불러오는 중…</p>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-[11.5px] cd-text-faint">
                  인별: {detail.persons.map((p) => `${p.employeeName} ${comma(p.amount)}원(${p.count}건)`).join(" · ")}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11.5px]">
                    <thead className="cd-table-head">
                      <tr>
                        {["성명", "문서", "양식", "사용일", "분류", "상호", "금액", "지출 목적"].map((h) => (
                          <th key={h} className="px-2 py-1.5 text-left cd-text font-bold whitespace-nowrap border-b cd-border-c">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.items.map((i) => (
                        <tr key={i.rowRef} className="border-b cd-border-c last:border-b-0">
                          <td className="px-2 py-1.5 cd-text whitespace-nowrap">{i.employeeName ?? "-"}</td>
                          <td className="px-2 py-1.5 cd-text-muted whitespace-nowrap">{i.docNo ?? "-"}</td>
                          <td className="px-2 py-1.5 cd-text-muted whitespace-nowrap">{FORM_LABEL[i.formId] ?? i.formId}</td>
                          <td className="px-2 py-1.5 cd-text-muted whitespace-nowrap">{i.usedOn ?? "-"}</td>
                          <td className="px-2 py-1.5 cd-text-muted whitespace-nowrap">{i.category ?? "-"}</td>
                          <td className="px-2 py-1.5 cd-text whitespace-nowrap">{i.vendor ?? "-"}</td>
                          <td className="px-2 py-1.5 cd-text whitespace-nowrap text-right">{comma(i.amount)}원</td>
                          <td className="px-2 py-1.5 cd-text-muted">{i.detail ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
