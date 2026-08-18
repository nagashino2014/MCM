"use client";

// 부가세 신고 패널 2종 (accounting-expansion 블루프린트 §5 P5)
// - HometaxPanel: 홈택스 수집 전자(세금)계산서 매입·매출장 — 수집 서비스 신청/수집 실행 + 매입 공제 토글.
//   홈택스 자격증명은 바로빌에 전달만 하고 앱에 저장하지 않는다(신청 폼 안내 문구 포함).
// - VatReturnPanel: 기수 선택 → 신고서 자동 계산 → 저장/확정/신고 자료 엑셀. 확정·제출은 항상 사람 액션(§7 T5).
// - WithholdingPanel: 원천징수이행상황신고 기초자료(P7) — 확정 급여대장 월별 집계 + xlsx.
// FinanceBoard 의 소메뉴 "부가세 신고" 그룹에서 렌더된다(JournalPanels 스타일 관례 동일).

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Download, ExternalLink, RefreshCw, Undo2 } from "lucide-react";

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
          <thead>
            <tr className="cd-text-muted text-left">
              <th className="py-1.5 pr-3 font-normal">지급월</th>
              <th className="py-1.5 pr-3 font-normal">신고기한</th>
              <th className="py-1.5 pr-3 font-normal text-right">인원</th>
              <th className="py-1.5 pr-3 font-normal text-right">총지급액</th>
              <th className="py-1.5 pr-3 font-normal text-right">간이세액</th>
              <th className="py-1.5 pr-3 font-normal text-right">정산분</th>
              <th className="py-1.5 pr-3 font-normal text-right">연말정산</th>
              <th className="py-1.5 pr-3 font-normal text-right">농특세</th>
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
                <td className="py-2 pr-3 text-right whitespace-nowrap">{won(total((m) => m.incomeTaxTotal))}</td>
                <td className="py-2 text-right whitespace-nowrap">{won(total((m) => m.localTax))}</td>
              </tr>
            )}
            {!loading && months.length === 0 && (
              <tr>
                <td colSpan={10} className="py-6 text-center cd-text-muted text-sm">{year}년 확정 급여대장이 없습니다.</td>
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
            ? "매입 세금계산서는 기본 공제로 집계됩니다 — 접대비성 매입·비영업용 승용차 관련 등은 '불공제'로 지정하세요."
            : "매출은 홈택스 수집분과 앱 발행분(전송완료)이 승인번호 기준으로 합쳐집니다."}
          {" "}합계(제외 건 제외): {totals.count}건 · 공급가액 {won(totals.supply)}원 · 세액 {won(totals.tax)}원
        </div>
        {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
        {notice && <div className="text-sm mb-2" style={{ color: "var(--cd-success,#13DEB9)" }}>{notice}</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
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
                        <button
                          type="button"
                          className={`cd-chip cd-chip-sm ${r.vatDeductible === 0 ? "" : "cd-text-muted"}`}
                          data-active={r.vatDeductible === 0 || undefined}
                          disabled={busy}
                          title="매입세액 불공제(접대비성·비영업용 승용차 등)"
                          onClick={() => setDeductible(r, { vatDeductible: r.vatDeductible === 0 ? null : 0 })}
                        >
                          불공제
                        </button>
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
  purchases: { invoiceGeneral: AmountBlock; cardDeductible: AmountBlock; nonDeductible: AmountBlock; exemptInvoice: AmountBlock; totalDeductibleTax: number };
  taxDue: number;
  manual: { label: string; key: string; amount: number }[];
  finalTaxDue: number;
  salesByParty: PartyRow[];
  purchasesByParty: PartyRow[];
  cardByMerchant: PartyRow[];
  cardUnclassified: number;
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

interface SavedReturn {
  returnId: string;
  periodYear: number;
  periodTerm: number;
  periodKind: string;
  status: string;
  form: ReturnForm;
  confirmedAt: string | null;
  updatedAt: string | null;
}

interface ExpenseAlertItem {
  approvedAt: string;
  cardAlias: string;
  storeName: string;
  amountTotal: number;
  reason: string;
}

export function VatReturnPanel() {
  const { periods, selected, setSelected, current } = usePeriods();
  const [form, setForm] = useState<ReturnForm | null>(null);
  const [manual, setManual] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState<SavedReturn[]>([]);
  const [deposits, setDeposits] = useState<RentalDeposit[]>([]);
  const [depositForm, setDepositForm] = useState({ propertyLabel: "", tenantName: "", depositAmount: "", dateFrom: "" });
  const [alerts, setAlerts] = useState<{ duplicates: ExpenseAlertItem[]; holiday: ExpenseAlertItem[]; lateNight: ExpenseAlertItem[] } | null>(null);
  const [alertOpen, setAlertOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSaved = useCallback(() => {
    fetch("/api/finance/vat-return?view=list", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setSaved(Array.isArray(data.returns) ? data.returns : []))
      .catch(() => {});
  }, []);

  const loadDeposits = useCallback(() => {
    fetch("/api/finance/vat-return?view=deposits", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setDeposits(Array.isArray(data.deposits) ? data.deposits : []))
      .catch(() => {});
  }, []);

  const compute = useCallback(() => {
    if (!current) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      year: String(current.year),
      term: String(current.term),
      kind: current.kind,
      manual: JSON.stringify(manual),
    });
    fetch(`/api/finance/vat-return?${params}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(String(data.error));
        else setForm(data.form ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [current, manual]);

  useEffect(loadSaved, [loadSaved]);
  useEffect(loadDeposits, [loadDeposits]);
  useEffect(compute, [compute]);
  useEffect(() => {
    if (!current) return;
    const params = new URLSearchParams({ view: "expense", year: String(current.year), term: String(current.term), kind: current.kind });
    fetch(`/api/finance/vat-return?${params}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setAlerts(data.duplicates ? data : null))
      .catch(() => setAlerts(null));
  }, [current]);

  const post = useCallback(
    async (body: Record<string, unknown>, okMessage: string) => {
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
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setNotice(okMessage);
        loadSaved();
        return data;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [loadSaved],
  );

  const save = () => {
    if (!current) return;
    void post(
      { action: "save", year: current.year, term: current.term, kind: current.kind, manual },
      "신고서 초안을 저장했습니다.",
    );
  };

  const savedForCurrent = useMemo(
    () => (current ? saved.find((s) => periodKey({ year: s.periodYear, term: s.periodTerm, kind: s.periodKind }) === periodKey(current)) ?? null : null),
    [saved, current],
  );

  const downloadXlsx = () => {
    if (!current) return;
    const params = new URLSearchParams({
      year: String(current.year),
      term: String(current.term),
      kind: current.kind,
      manual: JSON.stringify(manual),
      format: "xlsx",
    });
    window.open(`/api/finance/vat-return?${params}`, "_blank");
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
      <div className="cd-card p-4">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <div className="cd-card-title mr-auto">부가가치세 신고서 (일반과세자)</div>
          <PeriodSelect periods={periods} selected={selected} onChange={setSelected} />
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy || loading} onClick={compute}>
            <RefreshCw className="w-3.5 h-3.5" /> 다시 계산
          </button>
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={!form} onClick={downloadXlsx}>
            <Download className="w-3.5 h-3.5" /> 신고 자료 엑셀
          </button>
          <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={busy || !form} onClick={save}>
            초안 저장
          </button>
          {savedForCurrent && savedForCurrent.status !== "confirmed" && (
            <button
              type="button"
              className="cd-btn cd-btn-primary cd-btn-sm"
              disabled={busy}
              title="확정해도 국세청 제출은 별도입니다 — 홈택스 제출 후 관리 표시용"
              onClick={() => void post({ action: "confirm", returnId: savedForCurrent.returnId }, "신고서를 확정했습니다.")}
            >
              <Check className="w-3.5 h-3.5" /> 확정
            </button>
          )}
          {savedForCurrent?.status === "confirmed" && (
            <button
              type="button"
              className="cd-btn cd-btn-ghost cd-btn-sm"
              disabled={busy}
              onClick={() => void post({ action: "unconfirm", returnId: savedForCurrent.returnId }, "확정을 되돌렸습니다.")}
            >
              <Undo2 className="w-3.5 h-3.5" /> 확정 취소
            </button>
          )}
        </div>
        <div className="text-xs cd-text-muted mb-2">
          {current ? `과세기간 ${current.from} ~ ${current.to} · 신고·납부 기한 ${current.dueDate}` : ""}
          {savedForCurrent && (
            <span className={`cd-pill ml-2 ${savedForCurrent.status === "confirmed" ? "cd-pill-success" : "cd-pill-info"}`}>
              {savedForCurrent.status === "confirmed" ? "확정됨" : "초안 저장됨"}
            </span>
          )}
          {" "}신고서 확정·홈택스 제출은 항상 회계 관리자가 직접 수행합니다. 전환기에는 세무법인 신고 결과와 병행 대사하세요.
        </div>
        {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
        {notice && <div className="text-sm mb-2" style={{ color: "var(--cd-success,#13DEB9)" }}>{notice}</div>}

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
              <thead>
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
                {form.manual.map((f) => (
                  <tr key={f.key} className="border-t cd-hairline-row-c">
                    <td className="py-1.5 pr-3 cd-text-muted">{f.label}</td>
                    <td className="py-1.5 pr-3" colSpan={2} />
                    <td className="py-1.5 text-right">
                      <input
                        type="text"
                        inputMode="numeric"
                        className="cd-input text-right"
                        style={{ width: 130 }}
                        value={f.amount ? won(f.amount) : ""}
                        placeholder="0"
                        onChange={(e) => {
                          const n = Number(e.target.value.replace(/[^0-9]/g, "") || 0);
                          setManual((prev) => ({ ...prev, [f.key]: n }));
                        }}
                      />
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
            <div className="cd-card-title mb-2">전표 대사 (T3)</div>
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
      <div className="cd-card p-4">
        <div className="cd-card-title mb-1">임대 보증금 (간주임대료)</div>
        <div className="text-xs cd-text-muted mb-3">
          보증금 × 임대일수 × 고시 이자율{form ? `(${(form.depositInterestRate * 100).toFixed(1)}%)` : ""}이 과세표준에 자동
          가산됩니다. 보증금·기간이 바뀌면 여기서 수정하세요{deposits.some((d) => d.memo?.includes("역산 시드")) ? " — 시드된 시작일(2026-01-01)은 실제 계약일로 정정해 두면 과거 기수 재계산도 정확해집니다" : ""}.
        </div>
        <div className="overflow-x-auto mb-3">
          <table className="w-full text-sm">
            <thead>
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
                      disabled={busy}
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
          <input className="cd-input" style={{ width: 210 }} placeholder="물건지 (예: 골드타워 1201호)" value={depositForm.propertyLabel} onChange={(e) => setDepositForm((p) => ({ ...p, propertyLabel: e.target.value }))} />
          <input className="cd-input" style={{ width: 150 }} placeholder="임차인" value={depositForm.tenantName} onChange={(e) => setDepositForm((p) => ({ ...p, tenantName: e.target.value }))} />
          <input className="cd-input text-right" style={{ width: 130 }} inputMode="numeric" placeholder="보증금(원)" value={depositForm.depositAmount ? won(Number(depositForm.depositAmount)) : ""} onChange={(e) => setDepositForm((p) => ({ ...p, depositAmount: e.target.value.replace(/[^0-9]/g, "") }))} />
          <input className="cd-input" style={{ width: 120 }} inputMode="numeric" placeholder="시작일 YYYYMMDD" value={depositForm.dateFrom} onChange={(e) => setDepositForm((p) => ({ ...p, dateFrom: e.target.value.replace(/[^0-9]/g, "").slice(0, 8) }))} />
          <button
            type="button"
            className="cd-btn cd-btn-primary cd-btn-sm"
            disabled={busy || !depositForm.propertyLabel.trim() || !depositForm.tenantName.trim() || !depositForm.depositAmount || depositForm.dateFrom.length !== 8}
            onClick={() => {
              const df = depositForm.dateFrom;
              void post(
                {
                  action: "save_deposit",
                  deposit: {
                    propertyLabel: depositForm.propertyLabel,
                    tenantName: depositForm.tenantName,
                    depositAmount: Number(depositForm.depositAmount),
                    dateFrom: `${df.slice(0, 4)}-${df.slice(4, 6)}-${df.slice(6)}`,
                  },
                },
                "보증금을 등록했습니다.",
              ).then((r) => { if (r) { setDepositForm({ propertyLabel: "", tenantName: "", depositAmount: "", dateFrom: "" }); loadDeposits(); compute(); } });
            }}
          >
            추가
          </button>
        </div>
      </div>

      {/* 경비 점검 (P5 ⑥) */}
      {alerts && (
        <div className="cd-card p-4">
          <div className="cd-card-title mb-2">경비 점검 — 법인카드</div>
          <div className="flex items-center gap-2 flex-wrap mb-2">
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
                <thead>
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
