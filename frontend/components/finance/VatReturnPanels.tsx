"use client";

// 부가세 신고 패널 2종 (accounting-expansion 블루프린트 §5 P5)
// - HometaxPanel: 홈택스 수집 전자(세금)계산서 매입·매출장 — 수집 서비스 신청/수집 실행 + 매입 공제 토글.
//   홈택스 자격증명은 바로빌에 전달만 하고 앱에 저장하지 않는다(신청 폼 안내 문구 포함).
// - VatReturnPanel: 기수 선택 → 신고서 자동 계산 → 저장/확정/신고 자료 엑셀. 확정·제출은 항상 사람 액션(§7 T5).
// - WithholdingPanel: 원천징수이행상황신고 기초자료(P7) — 확정 급여대장 월별 집계 + xlsx.
// FinanceBoard 의 소메뉴 "부가세 신고" 그룹에서 렌더된다(JournalPanels 스타일 관례 동일).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Download, ExternalLink, RefreshCw } from "lucide-react";
import { CdDateInput, isValidDateString } from "@/components/cdash/CdField";
import { VatFollowupReviewPanel } from "./VatFollowupReviewPanel";
import { VatSameSupplyPanel } from "./VatSameSupplyPanel";
import type { VatSameSupplyCalculation, VatSameSupplySelection } from "@/lib/finance/vat-same-supply-types";
import type { VatFollowupApplication } from "@/lib/finance/vat-followup-review-types";
import type { VatFollowupCalculation, VatFollowupSelection } from "@/lib/finance/vat-followup-consumption-types";

const won = (n: number) => n.toLocaleString("ko-KR");
const fmtCorpNum = (v: string) => {
  const d = String(v ?? "").replace(/[^0-9]/g, "");
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : v;
};

interface PeriodOption {
  year: number;
  term: 1 | 2;
  kind: "pre" | "final";
  from: string;
  to: string;
  label: string;
  dueDate: string;
}

const periodKey = (p: { year: number; term: number; kind: string }) => `${p.year}:${p.term}:${p.kind}`;

/** 기수 목록 + 기본 선택(최근 종료 기수) 로드 공용 훅. */
function usePeriods() {
  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [selected, setSelected] = useState<string>("");
  useEffect(() => {
    let alive = true;
    fetch("/api/finance/vat-return?view=periods", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!alive || !Array.isArray(data.periods)) return;
        setPeriods(data.periods);
        if (data.default) setSelected(periodKey(data.default));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const current = useMemo(() => periods.find((p) => periodKey(p) === selected) ?? null, [periods, selected]);
  return { periods, selected, setSelected, current };
}

function PeriodSelect({ periods, selected, onChange }: { periods: PeriodOption[]; selected: string; onChange: (v: string) => void }) {
  return (
    <select className="cd-select" value={selected} onChange={(e) => onChange(e.target.value)}>
      {periods.map((p) => (
        <option key={periodKey(p)} value={periodKey(p)}>{p.label}</option>
      ))}
    </select>
  );
}

// ─────────────────────────────────────────────
// 원천세 (원천징수이행상황신고 기초자료)
// ─────────────────────────────────────────────

interface WithholdingRow {
  year: number;
  month: number;
  dueDate: string;
  headcount: number;
  payTotal: number;
  incomeTax: number;
  settleIncomeTax: number;
  yearendIncomeTax: number;
  farmTax: number;
  // 사업(A25)·기타(A42) 소득 — 전문가활용비 승인 적재분(FRM-P4)
  bizPayTotal: number;
  bizIncomeTax: number;
  otherPayTotal: number;
  otherIncomeTax: number;
  incomeTaxTotal: number;
  localTax: number;
}

export function WithholdingPanel() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [months, setMonths] = useState<WithholdingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/finance/withholding?year=${year}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!alive) return;
        if (data.error) setError(String(data.error));
        else setMonths(Array.isArray(data.months) ? data.months : []);
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [year]);

  const total = (fn: (m: WithholdingRow) => number) => months.reduce((acc, m) => acc + fn(m), 0);
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const upcoming = months.find((m) => m.dueDate >= today);

  return (
    <div className="cd-card p-4">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <div className="cd-card-title mr-auto">원천세 — 원천징수이행상황신고 기초자료</div>
        <select className="cd-select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[thisYear - 1, thisYear].map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => window.open(`/api/finance/withholding?year=${year}&format=xlsx`, "_blank")}>
          <Download className="w-3.5 h-3.5" /> 집계 엑셀
        </button>
      </div>
      <div className="text-xs cd-text-muted mb-3">
        확정 급여대장 실측 집계입니다 — 홈택스 신고 시 간이세액(A01) 인원·총지급액·소득세로 대사하세요. 신고·납부 기한은 지급월 익월
        10일{upcoming ? ` (다음 기한: ${upcoming.dueDate} — ${upcoming.year}.${String(upcoming.month).padStart(2, "0")}분)` : ""}. 지방소득세는 위택스 별도 신고분입니다.
      </div>
      {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="cd-table-head">
            <tr className="cd-text-muted text-left">
              <th className="py-1.5 pr-3 font-normal">지급월</th>
              <th className="py-1.5 pr-3 font-normal">신고기한</th>
              <th className="py-1.5 pr-3 font-normal text-right">인원</th>
              <th className="py-1.5 pr-3 font-normal text-right">총지급액</th>
              <th className="py-1.5 pr-3 font-normal text-right">간이세액</th>
              <th className="py-1.5 pr-3 font-normal text-right">정산분</th>
              <th className="py-1.5 pr-3 font-normal text-right">연말정산</th>
              <th className="py-1.5 pr-3 font-normal text-right">농특세</th>
              <th className="py-1.5 pr-3 font-normal text-right">사업소득(A25)</th>
              <th className="py-1.5 pr-3 font-normal text-right">기타소득(A42)</th>
              <th className="py-1.5 pr-3 font-normal text-right">소득세 계</th>
              <th className="py-1.5 font-normal text-right">지방소득세</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-t cd-hairline-row-c">
                <td className="py-1.5 pr-3 whitespace-nowrap">{m.year}.{String(m.month).padStart(2, "0")}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{m.dueDate}</td>
                <td className="py-1.5 pr-3 text-right">{m.headcount}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap">{won(m.payTotal)}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap">{won(m.incomeTax)}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap">{m.settleIncomeTax ? won(m.settleIncomeTax) : "-"}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap">{m.yearendIncomeTax ? won(m.yearendIncomeTax) : "-"}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap">{m.farmTax ? won(m.farmTax) : "-"}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap" title={m.bizPayTotal ? `지급액 ${won(m.bizPayTotal)}` : undefined}>{m.bizIncomeTax ? won(m.bizIncomeTax) : "-"}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap" title={m.otherPayTotal ? `지급액 ${won(m.otherPayTotal)}` : undefined}>{m.otherIncomeTax || m.otherPayTotal ? won(m.otherIncomeTax) : "-"}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap font-medium">{won(m.incomeTaxTotal)}</td>
                <td className="py-1.5 text-right whitespace-nowrap">{won(m.localTax)}</td>
              </tr>
            ))}
            {months.length > 0 && (
              <tr className="border-t cd-hairline-row-c font-semibold">
                <td className="py-2 pr-3">합계</td>
                <td className="py-2 pr-3" />
                <td className="py-2 pr-3" />
                <td className="py-2 pr-3 text-right whitespace-nowrap">{won(total((m) => m.payTotal))}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">{won(total((m) => m.incomeTax))}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">{won(total((m) => m.settleIncomeTax))}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">{won(total((m) => m.yearendIncomeTax))}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">{won(total((m) => m.farmTax))}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">{won(total((m) => m.bizIncomeTax))}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">{won(total((m) => m.otherIncomeTax))}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">{won(total((m) => m.incomeTaxTotal))}</td>
                <td className="py-2 text-right whitespace-nowrap">{won(total((m) => m.localTax))}</td>
              </tr>
            )}
            {!loading && months.length === 0 && (
              <tr>
                <td colSpan={12} className="py-6 text-center cd-text-muted text-sm">{year}년 확정 급여대장이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 홈택스 매입·매출장
// ─────────────────────────────────────────────

interface LedgerRow {
  htiId: string | null;
  ntsSendKey: string;
  writeDate: string;
  direction: "sales" | "purchase";
  taxType: number;
  modifyCode: string | null;
  partyCorpNum: string | null;
  partyName: string | null;
  amountTotal: number;
  taxTotal: number;
  totalAmount: number;
  itemName: string | null;
  vatDeductible: number | null;
  excluded: boolean;
  source: string;
}

interface SyncLogRow {
  status: string;
  fetched: number;
  inserted: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const TAX_TYPE_LABEL: Record<number, string> = { 1: "과세", 2: "영세", 3: "면세" };

export function HometaxPanel() {
  const { periods, selected, setSelected, current } = usePeriods();
  const [direction, setDirection] = useState<"purchase" | "sales">("purchase");
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [recentSyncs, setRecentSyncs] = useState<SyncLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 수집 서비스 신청 폼 (자격증명은 서버가 바로빌에 전달만 — 저장·감사로그 기록 안 함)
  const [showRegist, setShowRegist] = useState(false);
  const [loginMethod, setLoginMethod] = useState<"ID" | "CERT">("ID");
  const [hometaxId, setHometaxId] = useState("");
  const [hometaxPwd, setHometaxPwd] = useState("");
  const [jumin7, setJumin7] = useState("");
  // 기간 지정 수집(YYYYMM)
  const [syncFrom, setSyncFrom] = useState("");
  // 바로빌 홈택스 조회는 최근 36개월만 가능하다(2026-08-18 실측: 202309 성공 / 202308 -10148).
  const oldestMonth = useMemo(() => {
    const now = new Date(Date.now() + 9 * 3600 * 1000);
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    d.setUTCMonth(d.getUTCMonth() - 35);
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }, []);

  const loadStatus = useCallback(() => {
    fetch("/api/finance/hometax", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setRecentSyncs(Array.isArray(data.recentSyncs) ? data.recentSyncs : []))
      .catch(() => {});
  }, []);

  const loadLedger = useCallback(() => {
    if (!current) return;
    setLoading(true);
    const params = new URLSearchParams({
      view: "ledger",
      year: String(current.year),
      term: String(current.term),
      kind: current.kind,
      direction,
    });
    fetch(`/api/finance/vat-return?${params}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        setRows(Array.isArray(data.rows) ? data.rows : []);
        setLastSyncedAt(data.lastSyncedAt ?? null);
        if (data.error) setError(String(data.error));
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [current, direction]);

  useEffect(loadStatus, [loadStatus]);
  useEffect(loadLedger, [loadLedger]);

  const post = useCallback(
    async (body: Record<string, unknown>, okMessage: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/finance/hometax", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setNotice(okMessage);
        return data;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const regist = async () => {
    const data = await post(
      {
        action: "regist_scrap",
        loginMethod,
        hometaxId: hometaxId.trim(),
        hometaxPwd,
        shortJuminNum: jumin7.trim(),
      },
      "홈택스 수집 서비스를 신청했습니다. 내일 새벽부터 자동 수집됩니다 — 과거분은 '지금 수집'으로 소급 조회하세요.",
    );
    if (data) {
      setShowRegist(false);
      setHometaxId("");
      setHometaxPwd("");
      setJumin7("");
    }
  };

  const openBarobillRequest = async () => {
    const data = await post({ action: "scrap_request_url" }, "바로빌 신청 페이지를 새 창으로 열었습니다(60초 유효).");
    if (data?.url) window.open(String(data.url), "_blank", "noopener");
  };

  const runSync = async () => {
    const body: Record<string, unknown> = { action: "sync" };
    const digits = syncFrom.replace(/\D/g, "");
    if (digits.length === 6) body.fromMonth = digits;
    const data = await post(body, "수집을 실행했습니다.");
    if (data) {
      const errs = Array.isArray(data.errors) ? data.errors.length : 0;
      const clamped = data.clampedFrom
        ? ` · 요청 ${data.clampedFrom}은 조회 한계를 넘어 ${data.months?.[0] ?? oldestMonth}부터 수집했습니다`
        : "";
      setNotice(
        `수집 완료 — 조회 ${data.fetched ?? 0}건 · 신규 ${data.inserted ?? 0}건${errs ? ` · 오류 ${errs}건(수집 미신청이면 먼저 신청하세요)` : ""}${clamped}`,
      );
      loadStatus();
      loadLedger();
    }
  };

  const setDeductible = async (row: LedgerRow, patch: { vatDeductible?: number | null; excluded?: boolean }) => {
    if (!row.htiId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/finance/vat-return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_deductible", htiId: row.htiId, ...patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      loadLedger();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const totals = useMemo(
    () =>
      rows
        .filter((r) => !r.excluded)
        .reduce(
          (acc, r) => ({ count: acc.count + 1, supply: acc.supply + r.amountTotal, tax: acc.tax + r.taxTotal }),
          { count: 0, supply: 0, tax: 0 },
        ),
    [rows],
  );

  const lastSync = recentSyncs[0] ?? null;

  return (
    <div className="space-y-4">
      {/* 수집 서비스 카드 */}
      <div className="cd-card p-4">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <div className="cd-card-title mr-auto">홈택스 수집 — 전자(세금)계산서 매입·매출</div>
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy} onClick={() => setShowRegist((v) => !v)}>
            수집 서비스 신청
          </button>
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy} onClick={openBarobillRequest}>
            <ExternalLink className="w-3.5 h-3.5" /> 바로빌에서 신청
          </button>
          <input
            type="text"
            inputMode="numeric"
            placeholder="YYYYMM부터"
            className="cd-input"
            style={{ width: 104 }}
            value={syncFrom}
            onChange={(e) => setSyncFrom(e.target.value.replace(/\D/g, "").slice(0, 6))}
            title={`비워 두면 마지막 수집분 이후만 증분 수집합니다. 조회 가능 시작월은 ${oldestMonth} 입니다(바로빌 최근 36개월).`}
          />
          <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={busy} onClick={runSync}>
            <RefreshCw className="w-3.5 h-3.5" /> 지금 수집
          </button>
        </div>
        <div className="text-xs cd-text-muted">
          신청하면 바로빌이 매일 새벽 전날까지의 국세청 전송완료분을 수집해 둡니다. 조회 가능 기간은 최근 36개월({oldestMonth} 이후)이며,
          그보다 과거는 바로빌이 제공하지 않습니다. 마지막 수집:{" "}
          {lastSyncedAt ?? (lastSync ? `${lastSync.startedAt} (${lastSync.status})` : "없음")}
          {lastSync?.error ? ` · 최근 오류: ${lastSync.error}` : ""}
        </div>
        {showRegist && (
          <div className="mt-3 pt-3 border-t cd-border-c space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <select className="cd-select" value={loginMethod} onChange={(e) => setLoginMethod(e.target.value === "CERT" ? "CERT" : "ID")}>
                <option value="ID">홈택스 아이디로 로그인</option>
                <option value="CERT">바로빌 등록 공동인증서</option>
              </select>
              {loginMethod === "ID" && (
                <>
                  <input className="cd-input" style={{ width: 150 }} placeholder="홈택스 아이디" value={hometaxId} onChange={(e) => setHometaxId(e.target.value)} />
                  <input
                    className="cd-input"
                    style={{ width: 150 }}
                    type="password"
                    placeholder="홈택스 비밀번호"
                    value={hometaxPwd}
                    onChange={(e) => setHometaxPwd(e.target.value)}
                  />
                  <input
                    className="cd-input"
                    style={{ width: 130 }}
                    inputMode="numeric"
                    placeholder="주민번호 앞 7자리"
                    value={jumin7}
                    onChange={(e) => setJumin7(e.target.value.replace(/\D/g, "").slice(0, 7))}
                  />
                </>
              )}
              <button
                type="button"
                className="cd-btn cd-btn-primary cd-btn-sm"
                disabled={busy || (loginMethod === "ID" && (!hometaxId.trim() || !hometaxPwd || jumin7.length !== 7))}
                onClick={regist}
              >
                <Check className="w-3.5 h-3.5" /> 신청
              </button>
            </div>
            <div className="text-xs cd-text-muted">
              입력한 홈택스 로그인 정보는 바로빌에 전달만 되고 이 앱에는 저장되지 않습니다. 공동인증서 방식은 바로빌 사이트에 인증서가 먼저 등록되어 있어야
              합니다.
            </div>
          </div>
        )}
      </div>

      {/* 매입·매출장 카드 */}
      <div className="cd-card p-4">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <div className="cd-card-title mr-auto">매입매출장</div>
          <PeriodSelect periods={periods} selected={selected} onChange={setSelected} />
          <button
            type="button"
            className={`cd-chip cd-chip-sm ${direction === "purchase" ? "" : "cd-text-muted"}`}
            data-active={direction === "purchase" || undefined}
            onClick={() => setDirection("purchase")}
          >
            매입
          </button>
          <button
            type="button"
            className={`cd-chip cd-chip-sm ${direction === "sales" ? "" : "cd-text-muted"}`}
            data-active={direction === "sales" || undefined}
            onClick={() => setDirection("sales")}
          >
            매출
          </button>
        </div>
        <div className="text-xs cd-text-muted mb-3">
          {direction === "purchase"
            ? "매입 세금계산서는 증빙을 확인하여 공제·불공제를 선택하세요. 미판정은 공제하지 않으며 신고서 확정이 보류됩니다."
            : "매출은 홈택스 수집분과 앱 발행분(전송완료)이 승인번호 기준으로 합쳐집니다."}
          {" "}합계(제외 건 제외): {totals.count}건 · 공급가액 {won(totals.supply)}원 · 세액 {won(totals.tax)}원
        </div>
        {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
        {notice && <div className="text-sm mb-2" style={{ color: "var(--cd-success,#13DEB9)" }}>{notice}</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="cd-table-head">
              <tr className="cd-text-muted text-left">
                <th className="py-1.5 pr-3 font-normal">작성일</th>
                <th className="py-1.5 pr-3 font-normal">유형</th>
                <th className="py-1.5 pr-3 font-normal">거래처</th>
                <th className="py-1.5 pr-3 font-normal">품목</th>
                <th className="py-1.5 pr-3 font-normal text-right">공급가액</th>
                <th className="py-1.5 pr-3 font-normal text-right">세액</th>
                <th className="py-1.5 pr-3 font-normal text-right">합계</th>
                <th className="py-1.5 font-normal">{direction === "purchase" ? "공제" : "비고"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ntsSendKey} className={`border-t cd-hairline-row-c ${r.excluded ? "opacity-50" : ""}`}>
                  <td className="py-2 pr-3 whitespace-nowrap text-xs">{r.writeDate}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-xs">
                    {TAX_TYPE_LABEL[r.taxType] ?? r.taxType}
                    {r.modifyCode ? <span className="cd-pill cd-pill-warn ml-1">수정</span> : null}
                  </td>
                  <td className="py-2 pr-3 max-w-[220px]">
                    <div className="truncate" title={r.partyName ?? ""}>{r.partyName ?? "-"}</div>
                    <div className="text-xs cd-text-muted">{r.partyCorpNum ? fmtCorpNum(r.partyCorpNum) : ""}</div>
                  </td>
                  <td className="py-2 pr-3 max-w-[180px]"><div className="truncate" title={r.itemName ?? ""}>{r.itemName ?? "-"}</div></td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap">{won(r.amountTotal)}</td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap">{won(r.taxTotal)}</td>
                  <td className="py-2 pr-3 text-right font-medium whitespace-nowrap">{won(r.totalAmount)}</td>
                  <td className="py-2 whitespace-nowrap">
                    {r.direction === "purchase" && r.taxType !== 3 && r.htiId ? (
                      <span className="inline-flex items-center gap-1.5">
                        <select className="cd-select" aria-label={`${r.partyName ?? r.ntsSendKey} 공제 판정`} value={r.vatDeductible == null ? "" : String(r.vatDeductible)} disabled={busy}
                          onChange={e => void setDeductible(r, { vatDeductible: e.target.value === "" ? null : Number(e.target.value) })}>
                          <option value="">미판정</option><option value="1">공제</option><option value="0">불공제</option>
                        </select>
                        <button
                          type="button"
                          className={`cd-chip cd-chip-sm ${r.excluded ? "" : "cd-text-muted"}`}
                          data-active={r.excluded || undefined}
                          disabled={busy}
                          title="신고 대상에서 제외"
                          onClick={() => setDeductible(r, { excluded: !r.excluded })}
                        >
                          제외
                        </button>
                      </span>
                    ) : (
                      <span className="text-xs cd-text-muted">{r.source === "app_issue" ? "앱 발행분" : ""}</span>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center cd-text-muted text-sm">
                    수집된 계산서가 없습니다 — 수집 서비스를 신청했다면 "지금 수집"으로 과거분(YYYYMM부터)을 불러오세요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 부가세 신고서
// ─────────────────────────────────────────────

interface AmountBlock {
  count: number;
  supply: number;
  tax: number;
}

interface PartyRow {
  corpNum: string;
  name: string;
  count: number;
  supply: number;
  tax: number;
}

interface DeemedRentItem {
  depositId: string;
  propertyLabel: string;
  tenantName: string;
  depositAmount: number;
  days: number;
  amount: number;
}

interface RentalDeposit {
  depositId: string;
  propertyLabel: string;
  tenantName: string;
  tenantCorpNum: string | null;
  depositAmount: number;
  dateFrom: string;
  dateTo: string | null;
  memo: string | null;
  isActive: boolean;
}

interface ReturnForm {
  period: PeriodOption;
  sales: { invoiceTaxable: AmountBlock; deemedRent: AmountBlock; invoiceZeroRated: AmountBlock; exemptInvoice: AmountBlock; total: { supply: number; tax: number } };
  deemedRentItems: DeemedRentItem[];
  depositInterestRate: number;
  purchases: { invoiceGeneral: AmountBlock; cardDeductible: AmountBlock; nonDeductible: AmountBlock; invoiceUndecided?: AmountBlock; cardUndecided?: AmountBlock; exemptInvoice: AmountBlock; totalDeductibleTax: number };
  taxDue: number;
  manual: { label: string; key: string; amount: number }[];
  finalTaxDue: number;
  salesByParty: PartyRow[];
  purchasesByParty: PartyRow[];
  cardByMerchant: PartyRow[];
  cardUnclassified: number;
  blockingIssues?: { sourceId: string; reason: string }[];
  sourceEvidence?: { version: string; sourceHash: string };
  followupConsumption?: VatFollowupCalculation;
  sameSupplyConsumption?: VatSameSupplyCalculation;
  filingBasis?: {
    basisSnapshotId: string; scopeHash: string; calculationHash: string; subjectId: string;
    mode: string; noticeDeduction: number;
    verificationStatus?: "complete" | "blocked";
    payment?: { state: string; paidPrincipal: number | null; outstandingPrincipal: number | null };
  };
  duplicateReview?: {
    historyStatus: "complete" | "unavailable";
    historyIssues: string[];
    scope: { from: string; to: string };
    candidateGroups: {
      id: string; partyCorpNum: string | null; partyName: string; reason: string;
      status: "pending" | "resolved"; unresolvedPairCount: number;
      cards: DuplicateReviewSource[]; invoices: DuplicateReviewSource[];
    }[];
  };
  recon: {
    journalSalesCredit: number;
    reportSalesSupply: number;
    salesDiff: number;
    journalVatInDebit: number;
    reportDeductibleTax: number;
    vatInDiff: number;
  };
  warnings: string[];
  generatedAt: string;
}

interface DuplicateReviewSource {
  sourceId: string; date: string; supply: number; tax: number; total: number;
  origin: "current" | "prior_confirmed" | "prior_period_current";
  returnId?: string;
}

function DuplicateReviewPanel({ review }: { review: NonNullable<ReturnForm["duplicateReview"]> }) {
  const pending = review.candidateGroups.filter(group => group.status === "pending");
  const sources = (label: string, rows: DuplicateReviewSource[]) => <div className="overflow-x-auto"><table className="w-full text-sm">
    <caption className="text-left font-semibold">{label} {rows.length}건</caption>
    <thead><tr><th>거래일 · 자료</th><th>신고 범위</th><th className="text-right">공급가액</th><th className="text-right">세액</th></tr></thead>
    <tbody>{rows.map((row, index) => <tr key={`${row.sourceId}:${row.origin}:${index}`}><td>{row.date}<div className="text-xs cd-text-muted">{row.sourceId}</div></td><td>{row.origin === "current" ? "현재 신고" : row.origin === "prior_confirmed" ? "기존 확정 신고" : "다른 신고기간의 현재 자료"}</td><td className="text-right">{won(row.supply)}</td><td className="text-right">{won(row.tax)}</td></tr>)}</tbody>
  </table></div>;
  return <section aria-label="계산서·카드 중복공제 검토" className="mb-3 p-3 rounded border cd-border-c space-y-2">
    <h3 className="font-semibold">계산서·카드 중복공제 검토</h3>
    <p className="text-sm">검토 범위 {review.scope.from} ~ {review.scope.to} · 미해결 거래처 {pending.length}곳</p>
    <p className="text-sm">거래일·금액이 달라도 같은 공급자의 카드와 계산서는 공급 관계를 확인해야 합니다. 아래 금액은 검토 대상이며, 중복 세액으로 확정하거나 자동 차감한 금액이 아닙니다.</p>
    {review.historyStatus === "unavailable" && <div role="alert" className="text-sm cd-error-text">이전 신고 근거를 확인할 수 없어 확정을 보류합니다. {review.historyIssues.join(" / ")}</div>}
    {pending.map(group => <details key={group.id} className="border-t cd-border-c pt-2">
      <summary className="text-sm cursor-pointer">{group.partyName || "거래처 확인 필요"}{group.partyCorpNum ? ` (${fmtCorpNum(group.partyCorpNum)})` : ""} · 카드 {group.cards.length}건 / 계산서 {group.invoices.length}건 · 관계 확인 {group.unresolvedPairCount}건</summary>
      <p className="text-sm">{group.reason}</p>
      {sources("카드", group.cards)}{sources("계산서", group.invoices)}
    </details>)}
    {!!pending.length && <p className="text-sm"><a className="underline" href="/finance?tab=transactionlinks">거래 연결에서 공급 관계와 증빙 확인</a> 후 다시 계산하고 초안을 저장하세요. 연결할 수 없는 거래는 해결 전까지 확정을 보류합니다.</p>}
    {!pending.length && review.historyStatus === "complete" && <p className="text-sm">현재 검토 범위에서 미해결 중복공제 후보가 없습니다.</p>}
  </section>;
}

interface SavedReturn {
  returnId: string;
  periodYear: number;
  periodTerm: number;
  periodKind: string;
  status: string;
  form: ReturnForm;
  confirmedAt: string | null;
  updatedAt: string | null;
  origin: "legacy" | "basis_return";
  basisSnapshotId?: string;
  revision?: number;
  dateFrom: string;
  dateTo: string;
}

interface ReturnBasisOption {
  basisSnapshotId: string; subjectId: string; scopeHash: string; year: number; term: 1 | 2;
  kind: "pre" | "final"; dateFrom: string; dateTo: string; label: string; mode: string;
}

interface ExpenseAlertItem {
  approvedAt: string;
  cardAlias: string;
  storeName: string;
  amountTotal: number;
  reason: string;
}

interface CardReviewRow {
  cardTxnId: string; approvedAt: string; approvalType: string; storeName: string;
  amountTotal: number | null; taxAmount: number | null; vatState: "deductible" | "non_deductible" | "undecided"; issues: string[];
  vatReason: string | null; vatEvidence: string | null; vatDate: string | null;
  originalCardTxnId: string | null; reversalReason: string | null;
}

/** 수집 시 자동분류와 증빙 확인을 구별하며, 검토 후에도 신고서 초안은 다시 저장한다. */
export function CardTaxReviewPanel({ from, to, onSaved, canManage = false }: { from: string; to: string; onSaved: () => void; canManage?: boolean }) {
  const [rows, setRows] = useState<CardReviewRow[]>([]);
  const [selected, setSelected] = useState<CardReviewRow | null>(null);
  const [decision, setDecision] = useState("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [taxDate, setTaxDate] = useState("");
  const [original, setOriginal] = useState("");
  const [reversal, setReversal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadSequence = useRef(0);
  const currentRange = useRef(`${from}:${to}`);
  currentRange.current = `${from}:${to}`;
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const res = await fetch(`/api/finance/vat?${new URLSearchParams({ from, to })}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "카드 검토 목록을 불러오지 못했습니다.");
      if (sequence === loadSequence.current) setRows(data.reviewRows ?? []);
    } catch (err) { if (sequence === loadSequence.current) setError(err instanceof Error ? err.message : String(err)); }
  }, [from, to]);
  useEffect(() => { setSelected(null); setRows([]); setError(null); setNotice(null); void load(); return () => { loadSequence.current++; }; }, [load]);
  const edit = (r: CardReviewRow) => {
    setSelected(r); setDecision(r.vatState === "deductible" ? "1" : r.vatState === "non_deductible" ? "0" : "");
    setReason(r.vatReason ?? ""); setEvidence(r.vatEvidence ?? "");
    setTaxDate(["취소", "부분취소", "환불"].includes(r.approvalType) && !(r.originalCardTxnId && r.reversalReason) ? "" : r.vatDate ?? "");
    setOriginal(r.originalCardTxnId ?? ""); setReversal(r.reversalReason ?? ""); setError(null); setNotice(null);
  };
  const isReversal = !!selected && ["취소", "부분취소", "환불"].includes(selected.approvalType);
  const saveReview = async () => {
    if (!selected || !canManage) return;
    if (taxDate && !isValidDateString(taxDate)) { setError("신고 귀속일을 확인하세요."); return; }
    const requestedRange = currentRange.current;
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/finance/vat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        action: "update", cardTxnId: selected.cardTxnId, vatDeductible: decision === "" ? null : Number(decision),
        vatReason: reason.trim(), vatEvidence: evidence.trim(), vatDate: taxDate || null,
        originalCardTxnId: original.trim() || null, reversalReason: reversal || null,
      }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (requestedRange === currentRange.current) { setSelected(null); setNotice("검토를 저장했습니다. 신고서 초안을 다시 저장한 뒤 확정하세요."); await load(); onSaved(); }
    } catch (err) { if (requestedRange === currentRange.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return <section className="cd-card p-4 space-y-3" aria-label="카드 공제 증빙 검토">
    <h3 className="cd-card-title">카드 공제 증빙 검토</h3>
    <p className="text-xs cd-text-muted">공제·불공제는 사유와 증빙을 확인하여 선택하세요. 과거 자동분류만 있는 건은 미판정입니다. 취소는 원승인 ID와 취소 사유, 증빙에 따른 신고 귀속일이 필요합니다. 거래처가 같다는 이유만으로 계산서와 카드를 중복으로 보지 않습니다.</p>
    {error && <div role="alert" className="cd-error-text text-sm">{error}</div>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <div className="max-h-72 overflow-auto"><table className="w-full text-sm"><thead><tr><th>거래일 / ID</th><th>가맹점 / 유형</th><th>금액 / 세액</th><th>공제 판정 / 보류 사유</th><th>검토</th></tr></thead><tbody>
      {rows.map(r => <tr key={r.cardTxnId} className="border-t cd-hairline-row-c"><td className="p-2">{r.approvedAt}<div className="text-xs select-all">{r.cardTxnId}</div></td><td>{r.storeName}<div>{r.approvalType}</div></td><td>{r.amountTotal == null ? "확인 필요" : won(r.amountTotal)} / {r.taxAmount == null ? "확인 필요" : won(r.taxAmount)}</td><td>{r.issues.length > 0 && r.vatState !== "undecided" ? "재검토" : r.vatState === "deductible" ? "공제" : r.vatState === "non_deductible" ? "불공제" : "미판정"}<div className="text-xs">{r.issues.join(" / ")}</div></td><td><button className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy || !canManage} onClick={() => edit(r)} aria-label={`${r.cardTxnId} 검토`}>검토</button></td></tr>)}
      {!rows.length && <tr><td colSpan={5} className="p-3 text-center cd-text-muted">해당 기간 카드 검토 자료가 없습니다.</td></tr>}
    </tbody></table></div>
    {selected && <fieldset disabled={!canManage || busy} className="space-y-2 border-t cd-border-c pt-3">
      <p className="text-sm">검토 대상: {selected.cardTxnId} · {selected.storeName}</p>
      <div className="flex flex-wrap gap-2">
        <label>공제 판정 <select className="cd-select" value={decision} onChange={e => setDecision(e.target.value)}><option value="">미판정</option><option value="1">공제</option><option value="0">불공제</option></select></label>
        <label>판정 사유 <input className="cd-input" maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <label>증빙 참조 <input className="cd-input" maxLength={1000} placeholder="영수증·검토 문서 번호 또는 보관 위치" value={evidence} onChange={e => setEvidence(e.target.value)} /></label>
      </div>
      <div>
        <CdDateInput label="신고 귀속일" className="max-w-[200px]" value={taxDate} onChange={setTaxDate} disabled={!canManage || busy} />
        <p className="text-xs cd-text-muted">승인은 거래일을 기본으로 표시합니다. 실제 공급 시기와 증빙을 확인하여 신고 귀속일을 정하세요. 취소의 귀속일은 자동으로 확정하지 않습니다.</p>
      </div>
      {isReversal && <div className="flex flex-wrap gap-2">
        <label>원승인 ID <input className="cd-input" value={original} onChange={e => setOriginal(e.target.value)} placeholder="다른 기수 원승인 ID도 입력 가능" /></label>
        <label>취소 사유 <select className="cd-select" value={reversal} onChange={e => setReversal(e.target.value)}><option value="">선택</option><option value="return">반품</option><option value="contract_cancellation">계약 해제</option><option value="price_adjustment">금액 변경</option><option value="original_correction">당초 거래 정정</option></select></label>
      </div>}
      <button className="cd-btn cd-btn-primary cd-btn-sm" disabled={busy || !canManage || (!!taxDate && !isValidDateString(taxDate)) || (decision !== "" && (!reason.trim() || !evidence.trim() || (isReversal && (!original.trim() || !taxDate || !reversal))))} onClick={() => void saveReview()}>검토 저장</button>
      <button className="cd-btn cd-btn-ghost cd-btn-sm ml-2" disabled={busy} onClick={() => setSelected(null)}>닫기</button>
    </fieldset>}
  </section>;
}

export function VatReturnPanel({ requestedBasisSnapshotId = "" }: { requestedBasisSnapshotId?: string } = {}) {
  const { periods } = usePeriods();
  const [bases, setBases] = useState<ReturnBasisOption[]>([]);
  const [basisId, setBasisId] = useState("");
  const [savedId, setSavedId] = useState("");
  const [archive, setArchive] = useState<SavedReturn | null>(null);
  const [computedForm, setForm] = useState<ReturnForm | null>(null);
  const [manual, setManual] = useState<Record<string, number>>({});
  const [followup, setFollowup] = useState<VatFollowupSelection | null>(null);
  const followupRef = useRef(followup); followupRef.current = followup;
  const [sameSupply, setSameSupply] = useState<VatSameSupplySelection | null>(null);
  const sameSupplyRef = useRef(sameSupply); sameSupplyRef.current = sameSupply;
  const [saved, setSaved] = useState<SavedReturn[]>([]);
  const [deposits, setDeposits] = useState<RentalDeposit[]>([]);
  const [depositForm, setDepositForm] = useState({ propertyLabel: "", tenantName: "", depositAmount: "", dateFrom: "" });
  const [alerts, setAlerts] = useState<{ duplicates: ExpenseAlertItem[]; holiday: ExpenseAlertItem[]; lateNight: ExpenseAlertItem[]; verificationIssues?: ExpenseAlertItem[] } | null>(null);
  const [alertOpen, setAlertOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [listsLoading, setListsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const computation = useRef<AbortController | null>(null);
  const [uncertainRequest, setUncertainRequest] = useState(false);
  const [needsRecalculation, setNeedsRecalculation] = useState(false);
  const uncertainRef = useRef(uncertainRequest); uncertainRef.current = uncertainRequest;
  const listSequence = useRef(0);
  const selectionEpoch = useRef(0);
  const pendingRequest = useRef<{ payload: string; requestId: string } | null>(null);
  const postInFlight = useRef(false);
  const handledBasisRequest = useRef("");
  const [completedListSequence, setCompletedListSequence] = useState(0);
  const basis = useMemo(() => bases.find(item => item.basisSnapshotId === basisId) ?? null, [bases, basisId]);
  const context = savedId ? `archive:${savedId}` : `basis:${basisId}:${basis?.scopeHash ?? ""}`;
  const contextRef = useRef(context);
  contextRef.current = context;
  const form = savedId ? archive?.returnId === savedId ? archive.form : null : computedForm;
  const current = form?.period ?? null;
  const savedForCurrent = savedId && archive?.returnId === savedId ? archive : null;
  const collectionPeriod = current ? periods.find(p => periodKey(p) === periodKey(current)) ?? null : null;
  const duplicateReviewBlocked = !form?.duplicateReview || form.duplicateReview.historyStatus !== "complete" || form.duplicateReview.candidateGroups.some(group => group.status === "pending");
  const basisVerified = form?.filingBasis?.verificationStatus === "complete";
  const validCalculation = !!basis && form?.filingBasis?.basisSnapshotId === basis.basisSnapshotId && form.filingBasis.scopeHash === basis.scopeHash && /^[a-f0-9]{64}$/.test(form.filingBasis.calculationHash);
  const followupApplication = useMemo<VatFollowupApplication | null>(() => {
    if (!savedId && basis?.kind === "final") return { subjectId: basis.subjectId, year: basis.year, term: basis.term, kind: "final", path: "basis", basisSnapshotId: basis.basisSnapshotId };
    const a = savedId ? archive?.form.followupConsumption?.application : null;
    return a ? { subjectId: a.subjectId, year: a.year, term: a.term, kind: "final", path: a.path, basisSnapshotId: a.basisSnapshotId } : null;
  }, [basis, savedId, archive]);
  const changeFollowup = useCallback((next: VatFollowupSelection | null) => {
    if (uncertainRef.current) return;
    if (JSON.stringify(followupRef.current) === JSON.stringify(next)) return;
    followupRef.current = next;
    selectionEpoch.current++; computation.current?.abort(); pendingRequest.current = null;
    setForm(null); setError(null); setNotice(null); setFollowup(next);
  }, []);
  const changeSameSupply = useCallback((next: VatSameSupplySelection | null) => {
    if (uncertainRef.current) return;
    if (JSON.stringify(sameSupplyRef.current) === JSON.stringify(next)) return;
    sameSupplyRef.current = next;
    selectionEpoch.current++; computation.current?.abort(); pendingRequest.current = null;
    setForm(null); setError(null); setNotice(null); setNeedsRecalculation(false); setSameSupply(next);
  }, []);
  const responseError = (data: { error?: string }, status: number) => [data.error ?? "신고 자료를 처리하지 못했습니다.", status === 503 ? "보관 근거를 검증할 수 없습니다. 다시 조회하고 담당자에게 원문과 저장 구조 확인을 요청하세요." : status === 409 ? "현재 근거·검토 선택 또는 확정 상태를 다시 조회하세요." : status === 404 ? "선택한 자료가 없습니다. 목록을 다시 조회하세요." : status === 403 ? "작업 권한을 확인하세요." : ""].filter(Boolean).join(" ");

  const loadSaved = useCallback(() => {
    const sequence = ++listSequence.current;
    setListsLoading(true); setListError(null);
    const read = async (view: string) => {
      const response = await fetch(`/api/finance/vat-return?view=${view}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "신고 자료 목록을 불러오지 못했습니다.");
      return data;
    };
    void Promise.allSettled([read("list"), read("bases")]).then(([recordResult, referenceResult]) => {
      if (sequence !== listSequence.current) return;
      if (recordResult.status === "fulfilled" && Array.isArray(recordResult.value.returns)) setSaved(recordResult.value.returns);
      if (referenceResult.status === "fulfilled" && Array.isArray(referenceResult.value.bases)) setBases(referenceResult.value.bases);
      const failed = [recordResult, referenceResult].find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      if (recordResult.status !== "fulfilled" || referenceResult.status !== "fulfilled" || !Array.isArray(recordResult.value.returns) || !Array.isArray(referenceResult.value.bases)) throw new Error("신고 자료 목록 형식을 확인할 수 없습니다.");
      setCanManage(recordResult.value.permissions?.manage === true && referenceResult.value.permissions?.manage === true);
      setCompletedListSequence(sequence);
    }).catch(err => {
      if (sequence === listSequence.current) { setListError(err instanceof Error ? err.message : String(err)); setCanManage(false); }
    }).finally(() => { if (sequence === listSequence.current) setListsLoading(false); });
  }, []);

  const loadDeposits = useCallback(() => {
    fetch("/api/finance/vat-return?view=deposits", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setDeposits(Array.isArray(data.deposits) ? data.deposits : []))
      .catch(() => {});
  }, []);

  const compute = useCallback(() => {
    computation.current?.abort();
    if (!savedId && !basis) { setForm(null); setArchive(null); setLoading(false); return; }
    const controller = new AbortController();
    computation.current = controller;
    const epoch = selectionEpoch.current;
    setLoading(true);
    setForm(null);
    setArchive(null);
    setError(null);
    const params = savedId ? new URLSearchParams({ view: "archive", returnId: savedId }) : new URLSearchParams({
      view: "draft", basisSnapshotId: basis!.basisSnapshotId, expectedScopeHash: basis!.scopeHash, manual: JSON.stringify(manual),
    });
    fetch(savedId ? `/api/finance/vat-return?${params}` : "/api/finance/vat-return", savedId ? { cache: "no-store", signal: controller.signal } : {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: controller.signal,
      body: JSON.stringify({ action: "calculate", basisSnapshotId: basis!.basisSnapshotId, expectedScopeHash: basis!.scopeHash, manual, ...(followup ? { followup } : {}), ...(sameSupply ? { sameSupply } : {}) }),
    })
      .then(async (res) => {
        const result = await res.json();
        if (!res.ok || result.error) throw new Error(responseError(result, res.status));
        if (savedId) {
          if (result.record?.returnId !== savedId || !result.form) throw new Error("조회한 저장본이 일치하지 않습니다.");
        } else if (!result.form || result.form.filingBasis?.basisSnapshotId !== basis!.basisSnapshotId || result.form.filingBasis?.scopeHash !== basis!.scopeHash) throw new Error("조회한 신고 근거가 일치하지 않습니다. 다시 계산하세요.");
        if (!savedId) {
          const returned = result.form?.sameSupplyConsumption as VatSameSupplyCalculation | undefined;
          const selectedKeys = sameSupply?.reviews.map(row => `${row.kind}:${row.caseId}:${row.revisionId}`).sort() ?? [];
          const resultKeys = returned?.plan?.selections.map(row => `${row.kind}:${row.caseId}:${row.revisionId}`).sort() ?? [];
          if (JSON.stringify(selectedKeys) !== JSON.stringify(resultKeys) || returned && returned.plan.subjectId !== sameSupply?.subjectId) throw new Error("선택한 같은 공급 확인판과 계산 결과가 일치하지 않습니다. 다시 계산하세요.");
        }
        return result;
      })
      .then((data) => {
        if (!controller.signal.aborted && epoch === selectionEpoch.current) {
          if (savedId) setArchive(data.record); else setForm(data.form);
          setCanManage(data.permissions?.manage === true);
        }
      })
      .catch((err) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, [savedId, basis, manual, followup, sameSupply]);

  useEffect(() => {
    if (requestedBasisSnapshotId) {
      selectionEpoch.current++; computation.current?.abort(); pendingRequest.current = null;
      setBasisId(""); setSavedId(""); setManual({}); setFollowup(null); setSameSupply(null); sameSupplyRef.current = null; setForm(null); setArchive(null); setAlerts(null); setError(null); setNotice(null);
    }
    loadSaved(); return () => { listSequence.current++; };
  }, [loadSaved, requestedBasisSnapshotId]);
  useEffect(() => {
    if (!requestedBasisSnapshotId || listsLoading || listError || completedListSequence !== listSequence.current || handledBasisRequest.current === requestedBasisSnapshotId) return;
    handledBasisRequest.current = requestedBasisSnapshotId;
    selectionEpoch.current++; computation.current?.abort(); pendingRequest.current = null;
    setSavedId(""); setManual({}); setFollowup(null); setSameSupply(null); sameSupplyRef.current = null; setForm(null); setArchive(null); setAlerts(null); setNotice(null);
    if (!bases.some(item => item.basisSnapshotId === requestedBasisSnapshotId)) {
      setBasisId(""); setError("선택한 봉인 근거가 현재 목록에 없습니다. 신고 근거를 다시 확인하세요.");
      return;
    }
    setBasisId(requestedBasisSnapshotId); setError(null);
  }, [requestedBasisSnapshotId, listsLoading, listError, bases, completedListSequence]);
  useEffect(loadDeposits, [loadDeposits]);
  useEffect(() => { compute(); return () => computation.current?.abort(); }, [compute]);
  useEffect(() => {
    setAlerts(null);
    if (savedId || !collectionPeriod) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ view: "expense", year: String(collectionPeriod.year), term: String(collectionPeriod.term), kind: collectionPeriod.kind });
    fetch(`/api/finance/vat-return?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async res => { const data = await res.json(); if (!res.ok) throw new Error(data.error ?? "경비 점검 조회 실패"); return data; })
      .then(data => { if (!controller.signal.aborted) setAlerts(data.duplicates ? data : null); })
      .catch(() => { if (!controller.signal.aborted) setAlerts(null); });
    return () => controller.abort();
  }, [savedId, collectionPeriod]);

  const post = useCallback(
    async (body: Record<string, unknown>, okMessage: string) => {
      if (!canManage || postInFlight.current) return null;
      if (uncertainRequest && pendingRequest.current?.payload !== JSON.stringify(body)) {
        setError("이전 요청의 결과를 먼저 같은 요청으로 확인하세요. 입력과 요청 번호를 유지합니다."); return null;
      }
      postInFlight.current = true;
      const requestContext = contextRef.current, epoch = selectionEpoch.current;
      if (body.action === "save" || body.action === "confirm") {
        const payload = JSON.stringify(body);
        if (pendingRequest.current?.payload !== payload) pendingRequest.current = { payload, requestId: crypto.randomUUID() };
        body = { ...body, requestId: pendingRequest.current.requestId };
      }
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/finance/vat-return", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if ([400, 403, 404, 409].includes(res.status) && requestContext === contextRef.current && epoch === selectionEpoch.current) {
            pendingRequest.current = null;
            setUncertainRequest(false);
            if (res.status === 409) { setNeedsRecalculation(true); if (!savedId) setForm(null); }
          }
          throw new Error(responseError(data, res.status));
        }
        if ((body.action === "save" && (typeof data.returnId !== "string" || !data.returnId)) ||
          (body.action === "confirm" && (data.ok !== true || data.returnId !== body.returnId))) throw new Error("저장 응답을 확인할 수 없습니다. 같은 요청으로 결과를 확인하세요.");
        pendingRequest.current = null; setUncertainRequest(false); setNeedsRecalculation(false);
        loadSaved();
        if (requestContext !== contextRef.current || epoch !== selectionEpoch.current) return null;
        setNotice(okMessage);
        if (body.action === "save" && typeof data.returnId === "string") { setSavedId(data.returnId); setForm(null); setArchive(null); }
        if (body.action === "confirm") compute();
        return data;
      } catch (err) {
        if (requestContext === contextRef.current && epoch === selectionEpoch.current) { setUncertainRequest(!!pendingRequest.current); setError(err instanceof Error ? err.message : String(err)); }
        return null;
      } finally {
        postInFlight.current = false;
        setBusy(false);
      }
    },
    [loadSaved, canManage, compute, savedId, uncertainRequest],
  );

  const save = () => {
    if (!basis || savedId || !form?.filingBasis || !validCalculation || !canManage) return;
    void post(
      { action: "save", basisSnapshotId: basis.basisSnapshotId, expectedScopeHash: basis.scopeHash, expectedCalculationHash: form.filingBasis.calculationHash, manual, ...(followup ? { followup } : {}), ...(sameSupply ? { sameSupply } : {}) },
      "신고서 초안을 저장했습니다.",
    );
  };

  const changeSelection = (nextBasis: string, nextSaved: string) => {
    if (uncertainRequest) return;
    selectionEpoch.current++; computation.current?.abort(); pendingRequest.current = null;
    setUncertainRequest(false); setNeedsRecalculation(false);
    setBasisId(nextBasis); setSavedId(nextSaved); setManual({}); setFollowup(null); setSameSupply(null); sameSupplyRef.current = null; setForm(null); setArchive(null); setAlerts(null); setError(null); setNotice(null);
  };
  const recalculateKeepingInputs = () => {
    if (busy || uncertainRequest) return;
    if (!savedId) { setNeedsRecalculation(false); compute(); return; }
    const stored = savedForCurrent;
    if (stored?.origin !== "basis_return" || !stored.form.filingBasis) return;
    const storedBasis = stored.form.filingBasis.basisSnapshotId;
    if (!bases.some(row => row.basisSnapshotId === storedBasis)) { setError("저장본의 신고 근거가 목록에 없습니다. 목록을 새로 읽어 확인하세요."); return; }
    selectionEpoch.current++; computation.current?.abort(); pendingRequest.current = null;
    const oldFollowup = stored.form.followupConsumption;
    const restoredFollowup: VatFollowupSelection | null = oldFollowup ? { subjectId: oldFollowup.application.subjectId, pairs: oldFollowup.pairs.map(row => ({ revisionId: row.revisionId, pairKey: row.pairKey })) } : null;
    followupRef.current = restoredFollowup; setFollowup(restoredFollowup);
    const oldSame = stored.form.sameSupplyConsumption;
    const restoredSame: VatSameSupplySelection | null = oldSame ? { version: "vat-same-supply-selection-v1", subjectId: oldSame.plan.subjectId, reviews: oldSame.plan.selections.map(({ kind, caseId, revisionId }) => ({ kind, caseId, revisionId })) } : null;
    sameSupplyRef.current = restoredSame; setSameSupply(restoredSame);
    setBasisId(storedBasis); setSavedId(""); setManual(Object.fromEntries(stored.form.manual.map(row => [row.key, row.amount])));
    setForm(null); setArchive(null); setError(null); setNeedsRecalculation(false);
    setNotice("저장 당시 선택과 수동 항목을 유지해 새로 계산합니다. 기존 저장본은 그대로 남습니다.");
  };

  const downloadXlsx = async () => {
    if (!form) return;
    const epoch = selectionEpoch.current;
    const params = savedId ? new URLSearchParams({ view: "archive", returnId: savedId, format: "xlsx" }) : basis && form.filingBasis ? new URLSearchParams({
      basisSnapshotId: basis.basisSnapshotId, expectedScopeHash: basis.scopeHash,
      expectedCalculationHash: form.filingBasis.calculationHash, manual: JSON.stringify(manual), format: "xlsx",
    }) : null;
    if (!params) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(savedId ? `/api/finance/vat-return?${params}` : "/api/finance/vat-return", savedId ? { cache: "no-store" } : {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ action: "calculate", format: "xlsx", basisSnapshotId: basis!.basisSnapshotId, expectedScopeHash: basis!.scopeHash, expectedCalculationHash: form.filingBasis!.calculationHash, manual, ...(followup ? { followup } : {}), ...(sameSupply ? { sameSupply } : {}) }),
      });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(responseError(data, response.status)); }
      const blob = await response.blob();
      if (epoch !== selectionEpoch.current) return;
      const encodedName = response.headers.get("content-disposition")?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const url = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = url; anchor.download = encodedName ? decodeURIComponent(encodedName) : "부가세신고자료.xlsx";
      anchor.click(); URL.revokeObjectURL(url);
    } catch (err) { if (epoch === selectionEpoch.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  const blockRow = (label: string, b: AmountBlock, taxOverride?: number) => (
    <tr className="border-t cd-hairline-row-c">
      <td className="py-1.5 pr-3">{label}</td>
      <td className="py-1.5 pr-3 text-right">{b.count ? `${b.count}건` : "-"}</td>
      <td className="py-1.5 pr-3 text-right">{won(b.supply)}</td>
      <td className="py-1.5 text-right">{won(taxOverride ?? b.tax)}</td>
    </tr>
  );

  return (
    <div className="space-y-4">
      <div className="cd-card p-4 space-y-3">
        <div className="cd-card-title">신고 근거 · 저장본 선택</div>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-sm">새 계산의 봉인 근거
            <select className="cd-select block mt-1 max-w-full" aria-label="신고 근거 선택" value={savedId ? "" : basisId} disabled={uncertainRequest || busy || listsLoading} onChange={e => changeSelection(e.target.value, "")}>
              <option value="">봉인된 신고 근거를 선택하세요</option>
              {bases.map(item => <option key={item.basisSnapshotId} value={item.basisSnapshotId}>{item.label} · {item.mode === "notice" ? "예정고지" : "예정신고"} · {item.subjectId} · {item.dateFrom}~{item.dateTo}</option>)}
            </select>
          </label>
          <label className="text-sm">저장본 보기
            <select className="cd-select block mt-1 max-w-full" aria-label="신고 저장본 선택" value={savedId} disabled={uncertainRequest || busy || listsLoading} onChange={e => changeSelection("", e.target.value)}>
              <option value="">저장본을 선택하세요</option>
              {saved.map(item => <option key={item.returnId} value={item.returnId}>{item.form?.period.label ?? `${item.periodYear}년 ${item.periodTerm}기`} · {item.origin === "legacy" ? "기존 형식" : `새 형식 ${item.revision ?? 1}판`} · {item.status === "confirmed" ? "내부 확정" : "초안"} · {item.returnId}</option>)}
            </select>
          </label>
          <button className="cd-btn cd-btn-ghost cd-btn-sm" disabled={uncertainRequest || busy || listsLoading} onClick={loadSaved}>목록 새로고침</button>
        </div>
        {listError && <p role="alert" className="text-sm cd-error-text">{listError}</p>}
        {!listsLoading && !listError && !bases.length && <p role="status" className="text-sm cd-text-muted">봉인된 신고 근거가 아직 없습니다. 신고 주체·예정신고 또는 예정고지 자료를 확인해 근거를 준비하세요. 기존 저장본은 별도로 조회할 수 있습니다.</p>}
        <p className="text-xs cd-text-muted">근거 봉인, 신고서 내부 확정, 국세청 접수와 실제 납부는 서로 다른 상태입니다. 이 화면에서 외부 신고 완료를 자동 처리하지 않습니다.</p>
        {!canManage && <p className="text-xs cd-text-muted">조회 권한으로 열었습니다. 신고 자료 저장·검토에는 재무 관리 권한이 필요합니다.</p>}
      </div>
      <VatFollowupReviewPanel application={followupApplication} selection={followup} onSelectionChange={changeFollowup} onOpenBasis={id => changeSelection(id, "")} calculationEnabled={!savedId && basis?.kind === "final" && canManage} locked={busy || uncertainRequest} />
      <VatSameSupplyPanel basis={basis} selection={sameSupply} onSelectionChange={changeSameSupply} calculation={form?.sameSupplyConsumption} archive={savedForCurrent} canManage={canManage} locked={busy || uncertainRequest} onOpenReturn={id => changeSelection("", id)} />
      {!savedId && current && <CardTaxReviewPanel key={`${basisId}:${current.from}:${current.to}`} from={current.from} to={current.to} onSaved={compute} canManage={canManage && !uncertainRequest} />}
      <div className="cd-card p-4">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <div className="cd-card-title mr-auto">부가가치세 신고서 (일반과세자)</div>
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={uncertainRequest || busy || loading || (!basis && !savedId)} onClick={compute}>
            <RefreshCw className="w-3.5 h-3.5" /> {savedId ? "저장본 다시 읽기" : "다시 계산"}
          </button>
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={uncertainRequest || !form || busy || loading} onClick={() => void downloadXlsx()}>
            <Download className="w-3.5 h-3.5" /> {savedId ? "저장본 엑셀" : "계산 미리보기 엑셀"}
          </button>
          <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={uncertainRequest || !canManage || busy || loading || !!savedId || !validCalculation || !!error} onClick={save}>
            {form && (!basisVerified || !!form.blockingIssues?.length || duplicateReviewBlocked) ? "검토용 초안 저장" : "초안 저장"}
          </button>
          {savedForCurrent?.origin === "basis_return" && savedForCurrent.status !== "confirmed" && (
            <button
              type="button"
              className="cd-btn cd-btn-primary cd-btn-sm"
              disabled={uncertainRequest || !canManage || busy || loading || !!error || !basisVerified || !form?.filingBasis || !!form.blockingIssues?.length || duplicateReviewBlocked}
              title="현재 원천을 다시 검증한 뒤 내부 확정합니다. 국세청 제출·접수 확인은 별도입니다."
              onClick={() => void post({ action: "confirm", returnId: savedForCurrent.returnId, expectedCalculationHash: form?.filingBasis?.calculationHash }, "신고서를 내부 확정했습니다. 국세청 접수·납부는 별도입니다.")}
            >
              <Check className="w-3.5 h-3.5" /> 내부 확정
            </button>
          )}
        </div>
        <div className="text-xs cd-text-muted mb-3">
          {current ? `${current.label} · 계산 모집단 ${current.from} ~ ${current.to}${current.dueDate ? ` · 기한 표기 ${current.dueDate}(별도 확인)` : ""}` : "신고 근거 또는 저장본을 선택하세요."}
          {savedForCurrent && (
            <span className={`cd-pill ml-2 ${savedForCurrent.status === "confirmed" ? "cd-pill-success" : "cd-pill-info"}`}>
              {savedForCurrent.status === "confirmed" ? "내부 확정 당시 저장본" : "저장된 초안"}
            </span>
          )}
          {" "}신고서 확정·홈택스 제출은 항상 회계 관리자가 직접 수행합니다. 전환기에는 세무법인 신고 결과와 병행 대사하세요.
        </div>
        {error && <div role="alert" className="cd-error-text text-sm mb-2">{error}</div>}
        {uncertainRequest && <p role="status" className="text-sm cd-text mb-2">처리 결과가 불확실합니다. 새 저장·확정을 만들지 말고 같은 요청으로 결과를 확인하세요.</p>}
        {needsRecalculation && !uncertainRequest && <button type="button" className="cd-btn cd-btn-sm mb-2" disabled={busy || !canManage} onClick={recalculateKeepingInputs}>선택을 유지하고 다시 계산</button>}
        {error && pendingRequest.current && <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm mb-2" disabled={busy || !canManage} onClick={() => {
          const body = JSON.parse(pendingRequest.current!.payload) as Record<string, unknown>;
          void post(body, body.action === "save" ? "신고서 저장 결과를 확인했습니다." : "내부 확정 요청 결과를 확인했습니다.");
        }}>같은 요청 재확인</button>}
        {notice && <div className="text-sm mb-2" style={{ color: "var(--cd-success,#13DEB9)" }}>{notice}</div>}

        {!savedId && form && <p className="text-sm mb-2">현재 계산 미리보기입니다. 초안을 저장하면 고유 저장본을 선택하여 내부 확정할 수 있습니다.</p>}
        {savedForCurrent && <p role="status" className="text-sm mb-2">저장본 {savedForCurrent.returnId}{savedForCurrent.revision ? ` · ${savedForCurrent.revision}판` : ""}을 읽기 전용으로 표시합니다. 현재 원천으로 과거 내용을 바꾸지 않습니다.{savedForCurrent.origin === "legacy" ? " 기존 형식은 조회·출력만 지원합니다." : " 새 계산은 봉인 근거를 다시 선택하세요."}</p>}
        {form?.followupConsumption && <section aria-label="신고에 반영한 별개 공급 검토" className="mb-3 p-4 rounded-xl border cd-border-c space-y-2 text-sm"><h3 className="font-semibold">{savedId ? "저장 당시" : "현재 계산에서"} 반영한 정확한 거래 쌍 {form.followupConsumption.pairs.length}건</h3>{form.followupConsumption.pairs.map(p => <p key={`${p.revisionId}:${p.pairKey}`}>카드 {p.pair.card.partyName} · {p.pair.card.date} / 계산서 {p.pair.invoice.date} — 과거 실제 기공제 {won(p.priorClaimedTax)}원 · 당기 공제 가능 {won(p.currentClaimableTax)}원</p>)}<p className="text-xs cd-text-muted">{savedId ? "저장된 선택을 표시합니다. 현재 유효성 재조회로 과거 저장 내용을 변경하지 않습니다." : "선택한 쌍만 별개 공급 근거로 반영했습니다. 다른 보류 항목은 남을 수 있습니다."} 내부 확정은 국세청 접수·납부와 별도입니다.</p></section>}
        {savedId && form && !form.followupConsumption && <p className="text-xs cd-text-muted mb-3">이 저장본에는 별개 공급 검토 선택이 저장되어 있지 않습니다. 현재 선택을 과거 판에 덧붙이지 않습니다.</p>}
        {form?.followupConsumption && <p className="text-xs cd-text-muted mb-3">같은 당기 원천이 여러 쌍에 표시되어도 신고서에서 한 번만 공제합니다. 아래 신고서의 합계로 확인하며 쌍별 세액을 합산하지 않습니다.</p>}
        {form?.filingBasis && <section aria-label="신고 근거와 예정고지" className="mb-3 p-3 rounded border cd-border-c space-y-1 text-sm">
          <div className="font-semibold">신고 근거 · {form.filingBasis.mode === "notice" ? "예정고지 방식" : "예정신고 방식"}</div>
          <div>주체 {form.filingBasis.subjectId} · 근거 {form.filingBasis.basisSnapshotId}</div>
          <div role="status">{savedId ? "저장 당시" : "현재"} 원천 대사 {basisVerified ? "완료" : "검증 미완료 · 내부 확정 보류"}</div>
          <div>유효 예정고지 차감 <strong>{won(form.filingBasis.noticeDeduction)}원</strong> · 근거에서 확인한 금액이며 수기로 변경할 수 없습니다.</div>
          <div>확인된 납부 원금 {form.filingBasis.payment?.state === "complete" && form.filingBasis.payment.paidPrincipal != null ? `${won(form.filingBasis.payment.paidPrincipal)}원` : "미확인"} · 미납 원금 {form.filingBasis.payment?.state === "complete" && form.filingBasis.payment.outstandingPrincipal != null ? `${won(form.filingBasis.payment.outstandingPrincipal)}원` : "미확인"}</div>
          <p className="text-xs cd-text-muted">실제 납부액과 고지 차감은 별도입니다. 미확인 납부를 0원으로 간주하지 않습니다.</p>
        </section>}
        {!!form?.blockingIssues?.length && <div role="status" className="text-sm mb-3">확정 보류: {form.blockingIssues.length}개 검토 항목이 남았습니다. {form.blockingIssues.slice(0, 5).map(i => `${i.sourceId}: ${i.reason}`).join(" / ")}</div>}
        {form?.duplicateReview && <DuplicateReviewPanel review={form.duplicateReview} />}
        {form && !form.duplicateReview && savedForCurrent?.status !== "confirmed" && <p role="status" className="text-sm mb-3">중복공제 검토 결과를 확인할 수 없습니다. 검증 기능을 확인한 뒤 다시 계산하세요.</p>}
        {form && form.warnings.length > 0 && (
          <div className="mb-3 p-3 rounded border cd-border-c space-y-1">
            {form.warnings.map((w, i) => (
              <div key={i} className="text-sm flex items-start gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "var(--cd-warning,#FFAE1F)" }} />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        {form && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm max-w-[720px]">
              <thead className="cd-table-head">
                <tr className="cd-text-muted text-left">
                  <th className="py-1.5 pr-3 font-normal">구분</th>
                  <th className="py-1.5 pr-3 font-normal text-right">건수</th>
                  <th className="py-1.5 pr-3 font-normal text-right">공급가액</th>
                  <th className="py-1.5 font-normal text-right">세액</th>
                </tr>
              </thead>
              <tbody>
                {blockRow("매출 · 세금계산서 발급분(과세)", form.sales.invoiceTaxable)}
                {form.sales.deemedRent.supply > 0 &&
                  blockRow(`매출 · 기타(간주임대료 ${(form.depositInterestRate * 100).toFixed(1)}%)`, form.sales.deemedRent)}
                {blockRow("매출 · 영세율 세금계산서", form.sales.invoiceZeroRated, 0)}
                {form.sales.exemptInvoice.count > 0 && blockRow("매출 · 면세 계산서(참고)", form.sales.exemptInvoice, 0)}
                <tr className="border-t cd-hairline-row-c font-medium">
                  <td className="py-1.5 pr-3">과세표준 · 매출세액 합계</td>
                  <td className="py-1.5 pr-3" />
                  <td className="py-1.5 pr-3 text-right">{won(form.sales.total.supply)}</td>
                  <td className="py-1.5 text-right">{won(form.sales.total.tax)}</td>
                </tr>
                {blockRow("매입 · 세금계산서 수취분", form.purchases.invoiceGeneral)}
                {blockRow("매입 · 신용카드 수령분(공제)", form.purchases.cardDeductible)}
                {form.purchases.nonDeductible.count > 0 &&
                  blockRow("매입 · 공제받지못할 매입세액(차감)", form.purchases.nonDeductible, -form.purchases.nonDeductible.tax)}
                {!!form.purchases.invoiceUndecided?.count && blockRow("매입 · 계산서 미판정(공제 보류)", form.purchases.invoiceUndecided, -form.purchases.invoiceUndecided.tax)}
                {!!form.purchases.cardUndecided?.count && blockRow("카드 · 미판정(참고, 공제 미포함)", form.purchases.cardUndecided)}
                {form.purchases.exemptInvoice.count > 0 && blockRow("매입 · 면세 계산서(참고)", form.purchases.exemptInvoice, 0)}
                <tr className="border-t cd-hairline-row-c font-medium">
                  <td className="py-1.5 pr-3">매입세액 차감계</td>
                  <td className="py-1.5 pr-3" colSpan={2} />
                  <td className="py-1.5 text-right">{won(form.purchases.totalDeductibleTax)}</td>
                </tr>
                <tr className="border-t cd-hairline-row-c font-semibold">
                  <td className="py-2 pr-3">납부(환급)세액</td>
                  <td className="py-2 pr-3" colSpan={2} />
                  <td className="py-2 text-right" style={form.taxDue < 0 ? { color: "var(--cd-info,#539BFF)" } : undefined}>
                    {won(form.taxDue)}
                  </td>
                </tr>
                {form.filingBasis && <tr className="border-t cd-hairline-row-c"><td className="py-1.5 pr-3">유효 예정고지세액(차감)</td><td colSpan={2} /><td className="py-1.5 text-right">{won(-form.filingBasis.noticeDeduction)}</td></tr>}
                {form.manual.map((f) => (
                  <tr key={f.key} className="border-t cd-hairline-row-c">
                    <td className="py-1.5 pr-3 cd-text-muted">{f.label}</td>
                    <td className="py-1.5 pr-3" colSpan={2} />
                    <td className="py-1.5 text-right">
                      {savedId || !["etaxCredit", "penalty"].includes(f.key) ? <span>{won(f.amount)}</span> : <input
                        type="text"
                        inputMode="numeric"
                        className="cd-input text-right"
                        style={{ width: 130 }}
                        disabled={uncertainRequest || !canManage || busy || loading}
                        value={f.amount ? won(f.amount) : ""}
                        placeholder="0"
                        onChange={(e) => {
                          const n = Number(e.target.value.replace(/[^0-9]/g, "") || 0);
                          selectionEpoch.current++; computation.current?.abort(); pendingRequest.current = null; setForm(null); setError(null);
                          setManual((prev) => ({ ...prev, [f.key]: n }));
                        }}
                      />}
                    </td>
                  </tr>
                ))}
                <tr className="border-t cd-hairline-row-c font-semibold">
                  <td className="py-2 pr-3">차가감 납부할 세액</td>
                  <td className="py-2 pr-3" colSpan={2} />
                  <td className="py-2 text-right">{won(form.finalTaxDue)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 합계표 + 대사 */}
      {form && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="cd-card p-4">
            <div className="cd-card-title mb-2">세금계산서합계표 요약</div>
            <div className="text-xs cd-text-muted mb-2">신고 시 매출처·매입처별 합계표가 함께 제출됩니다 — 전체 목록은 신고 자료 엑셀에 포함.</div>
            {(
              [
                ["매출처", form.salesByParty],
                ["매입처", form.purchasesByParty],
                ["카드 가맹점(수령명세)", form.cardByMerchant],
              ] as Array<[string, PartyRow[]]>
            ).map(([title, list]) => (
              <div key={title} className="mb-3">
                <div className="text-sm font-medium mb-1">
                  {title} {list.length}곳 · 공급가액 {won(list.reduce((a, p) => a + p.supply, 0))}원 · 세액 {won(list.reduce((a, p) => a + p.tax, 0))}원
                </div>
                <div className="text-xs cd-text-muted">
                  {list.slice(0, 5).map((p) => `${p.name}(${won(p.supply)})`).join(" · ") || "-"}
                  {list.length > 5 ? ` 외 ${list.length - 5}곳` : ""}
                </div>
              </div>
            ))}
          </div>
          <div className="cd-card p-4">
            <div className="cd-card-title mb-3">전표 대사 (T3)</div>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-t cd-hairline-row-c">
                  <td className="py-1.5 pr-3">신고 매출(면세 포함)</td>
                  <td className="py-1.5 text-right">{won(form.recon.reportSalesSupply)}</td>
                </tr>
                <tr className="border-t cd-hairline-row-c">
                  <td className="py-1.5 pr-3">전표 매출 계정(411·412)</td>
                  <td className="py-1.5 text-right">{won(form.recon.journalSalesCredit)}</td>
                </tr>
                <tr className="border-t cd-hairline-row-c font-medium">
                  <td className="py-1.5 pr-3">차이</td>
                  <td className="py-1.5 text-right" style={form.recon.salesDiff !== 0 ? { color: "var(--cd-danger,#FA896B)" } : undefined}>
                    {won(form.recon.salesDiff)}
                  </td>
                </tr>
                <tr className="border-t cd-hairline-row-c">
                  <td className="py-1.5 pr-3">신고 매입세액 차감계</td>
                  <td className="py-1.5 text-right">{won(form.recon.reportDeductibleTax)}</td>
                </tr>
                <tr className="border-t cd-hairline-row-c">
                  <td className="py-1.5 pr-3">전표 부가세대급금(135)</td>
                  <td className="py-1.5 text-right">{won(form.recon.journalVatInDebit)}</td>
                </tr>
                <tr className="border-t cd-hairline-row-c font-medium">
                  <td className="py-1.5 pr-3">차이</td>
                  <td className="py-1.5 text-right" style={form.recon.vatInDiff !== 0 ? { color: "var(--cd-danger,#FA896B)" } : undefined}>
                    {won(form.recon.vatInDiff)}
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="text-xs cd-text-muted mt-2">
              차이는 대개 ① 전표에 아직 없는 매출(홈택스 수집분 중 앱 미발행) ② 확정 대기(pending) 전표 ③ 계좌 출금 전표의 부가세 미분리에서 나옵니다.
              전표·장부 탭에서 확정을 진행하면 줄어듭니다.
            </div>
          </div>
        </div>
      )}

      {/* 임대 보증금 — 간주임대료 근거 (부동산임대공급가액명세서) */}
      {!savedId && <div className="cd-card p-4">
        <div className="cd-card-title mb-1">임대 보증금 (간주임대료)</div>
        <div className="text-xs cd-text-muted mb-3">
          보증금 × 임대일수 × 고시 이자율{form ? `(${(form.depositInterestRate * 100).toFixed(1)}%)` : ""}이 과세표준에 자동
          가산됩니다. 보증금·기간이 바뀌면 여기서 수정하세요{deposits.some((d) => d.memo?.includes("역산 시드")) ? " — 시드된 시작일(2026-01-01)은 실제 계약일로 정정해 두면 과거 기수 재계산도 정확해집니다" : ""}.
        </div>
        <div className="overflow-x-auto mb-3">
          <table className="w-full text-sm">
            <thead className="cd-table-head">
              <tr className="cd-text-muted text-left">
                <th className="py-1.5 pr-3 font-normal">물건지</th>
                <th className="py-1.5 pr-3 font-normal">임차인</th>
                <th className="py-1.5 pr-3 font-normal text-right">보증금</th>
                <th className="py-1.5 pr-3 font-normal">기간</th>
                <th className="py-1.5 font-normal">처리</th>
              </tr>
            </thead>
            <tbody>
              {deposits.filter((d) => d.isActive).map((d) => (
                <tr key={d.depositId} className="border-t cd-hairline-row-c">
                  <td className="py-1.5 pr-3">{d.propertyLabel}</td>
                  <td className="py-1.5 pr-3">{d.tenantName}</td>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap">{won(d.depositAmount)}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{d.dateFrom} ~ {d.dateTo ?? "계속"}</td>
                  <td className="py-1.5">
                    <button
                      type="button"
                      className="cd-btn cd-btn-ghost cd-btn-sm"
                      disabled={uncertainRequest || busy || !canManage}
                      title="목록에서 제외(과거 기수 이력은 보존)"
                      onClick={() => void post({ action: "delete_deposit", depositId: d.depositId }, "보증금을 제외했습니다.").then(() => { loadDeposits(); compute(); })}
                    >
                      제외
                    </button>
                  </td>
                </tr>
              ))}
              {deposits.filter((d) => d.isActive).length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center cd-text-muted text-sm">등록된 보증금이 없습니다 — 보증금이 있으면 간주임대료가 신고서에 가산되어야 합니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input className="cd-input" disabled={uncertainRequest || busy || !canManage} style={{ width: 210 }} placeholder="물건지 (예: 골드타워 1201호)" value={depositForm.propertyLabel} onChange={(e) => setDepositForm((p) => ({ ...p, propertyLabel: e.target.value }))} />
          <input className="cd-input" disabled={uncertainRequest || busy || !canManage} style={{ width: 150 }} placeholder="임차인" value={depositForm.tenantName} onChange={(e) => setDepositForm((p) => ({ ...p, tenantName: e.target.value }))} />
          <input className="cd-input text-right" disabled={uncertainRequest || busy || !canManage} style={{ width: 130 }} inputMode="numeric" placeholder="보증금(원)" value={depositForm.depositAmount ? won(Number(depositForm.depositAmount)) : ""} onChange={(e) => setDepositForm((p) => ({ ...p, depositAmount: e.target.value.replace(/[^0-9]/g, "") }))} />
          <CdDateInput className="w-[140px]" disabled={uncertainRequest || busy || !canManage} placeholder="시작일 YYYYMMDD" value={depositForm.dateFrom} onChange={value => setDepositForm(p => ({ ...p, dateFrom: value }))} />
          <button
            type="button"
            className="cd-btn cd-btn-primary cd-btn-sm"
            disabled={uncertainRequest || busy || !canManage || !depositForm.propertyLabel.trim() || !depositForm.tenantName.trim() || !depositForm.depositAmount || !isValidDateString(depositForm.dateFrom)}
            onClick={() => {
              const df = depositForm.dateFrom;
              void post(
                {
                  action: "save_deposit",
                  deposit: {
                    propertyLabel: depositForm.propertyLabel,
                    tenantName: depositForm.tenantName,
                    depositAmount: Number(depositForm.depositAmount),
                    dateFrom: df,
                  },
                },
                "보증금을 등록했습니다.",
              ).then((r) => { if (r) { setDepositForm({ propertyLabel: "", tenantName: "", depositAmount: "", dateFrom: "" }); loadDeposits(); compute(); } });
            }}
          >
            추가
          </button>
        </div>
      </div>}

      {/* 경비 점검 (P5 ⑥) */}
      {alerts && (
        <div className="cd-card p-4">
          <div className="cd-card-title mb-2">경비 점검 — 법인카드</div>
          {collectionPeriod && <p className="text-xs cd-text-muted mb-2">수집 기수 점검 범위 {collectionPeriod.from} ~ {collectionPeriod.to} · 위 신고서의 계산 모집단과 별도입니다.</p>}
          {!!alerts.verificationIssues?.length && <div role="alert" className="cd-alert cd-alert-warn mb-2 text-sm">
            <div>사업자번호 정정 근거를 확인할 수 없는 {alerts.verificationIssues.length}건은 중복 판단을 보류했습니다.</div>
            {alerts.verificationIssues.map((item, i) => <div key={i} className="text-xs mt-1">{item.approvedAt} · {item.cardAlias} · {item.storeName}: {item.reason}</div>)}
          </div>}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            {(
              [
                ["duplicates", "동일 가맹점·금액 중복", alerts.duplicates],
                ["holiday", "휴일 사용", alerts.holiday],
                ["lateNight", "심야 사용(22~06시)", alerts.lateNight],
              ] as Array<[string, string, ExpenseAlertItem[]]>
            ).map(([key, label, list]) => (
              <button
                key={key}
                type="button"
                className={`cd-chip cd-chip-sm ${alertOpen === key ? "" : "cd-text-muted"}`}
                data-active={alertOpen === key || undefined}
                onClick={() => setAlertOpen(alertOpen === key ? null : key)}
              >
                {label} {list.length}건
              </button>
            ))}
          </div>
          {alertOpen && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="cd-table-head">
                  <tr className="cd-text-muted text-left">
                    <th className="py-1.5 pr-3 font-normal">사용일시</th>
                    <th className="py-1.5 pr-3 font-normal">카드</th>
                    <th className="py-1.5 pr-3 font-normal">상호</th>
                    <th className="py-1.5 font-normal text-right">금액</th>
                  </tr>
                </thead>
                <tbody>
                  {(alertOpen === "duplicates" ? alerts.duplicates : alertOpen === "holiday" ? alerts.holiday : alerts.lateNight).map((a, i) => (
                    <tr key={i} className="border-t cd-hairline-row-c">
                      <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{a.approvedAt}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{a.cardAlias}</td>
                      <td className="py-1.5 pr-3">{a.storeName}</td>
                      <td className="py-1.5 text-right whitespace-nowrap">{won(a.amountTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-xs cd-text-muted mt-2">규정 위반 판정이 아니라 점검 후보 목록입니다 — 필요한 건은 부가세 집계 탭에서 제외·불공제 처리하세요.</div>
        </div>
      )}
    </div>
  );
}
