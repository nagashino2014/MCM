"use client";

// 결산 패널 2종 (accounting-expansion 블루프린트 §5 P9)
// - BalanceSheetPanel: 재무상태표(기초 인수 + 당기 발생) + 기초 잔액 입력.
// - ClosingPanel: 결산 점검(확정 대기·가지급/가수 잔액) + 세무조정 후보 + 연차 마감/재개 + 결산 자료 xlsx.
// FinanceBoard 의 소메뉴 "손익·자금" 그룹에서 렌더된다(JournalPanels 스타일 관례 동일).

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Download, Lock, RefreshCw, Undo2 } from "lucide-react";

const won = (n: number) => n.toLocaleString("ko-KR");
const thisYear = () => new Date().getFullYear();

interface BalanceLine {
  accountCode: string;
  name: string;
  acctType: string;
  opening: number;
  movement: number;
  closing: number;
}

interface BalanceSheetData {
  year: number;
  assets: BalanceLine[];
  liabilities: BalanceLine[];
  equity: BalanceLine[];
  netIncome: number;
  assetTotal: number;
  liabilityTotal: number;
  equityTotal: number;
  balanced: boolean;
  hasOpening: boolean;
}

interface ClosingStatusData {
  year: number;
  status: string;
  closedAt: string | null;
  pendingCount: number;
  suspenseOut: number;
  suspenseIn: number;
  balanceSheet: BalanceSheetData;
  snapshotBalanceSheet?: BalanceSheetData | null;
  completeness?: {
    status: "verified" | "incomplete" | "verificationUnavailable";
    canClose: boolean;
    verificationUnavailable: boolean;
    issues: { code: string; sourceId: string; message: string }[];
    checkedAt: string;
    scope: "g03b-r0";
  };
}

function useClosingStatus(year: number) {
  const [data, setData] = useState<ClosingStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setData(null);
    setError(null);
    fetch(`/api/finance/closing?year=${year}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const result = await res.json();
        if (!res.ok || result.error) throw new Error(result.error ?? "결산 점검 결과를 불러오지 못했습니다.");
        if (result.year !== year) throw new Error("조회한 연도의 점검 결과가 일치하지 않습니다. 다시 조회하세요.");
        return result;
      })
      .then((d) => {
        if (!controller.signal.aborted) setData(d);
      })
      .catch((err) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, [year]);
  useEffect(() => { load(); return () => request.current?.abort(); }, [load]);
  return { data: data?.year === year ? data : null, loading, error, load };
}

function CompletenessNotice({ data }: { data: ClosingStatusData }) {
  const check = data.completeness;
  const unavailable = !check || check.verificationUnavailable;
  const incomplete = unavailable || check.status !== "verified";
  return <section aria-label="결산 원천자료 점검" role="status" className="mb-3 p-3 rounded border cd-border-c space-y-2">
    <p className="text-sm font-semibold">{unavailable ? "원천자료 검증 불가" : incomplete ? "원천자료 검토 미완료" : "원천자료 점검 완료"}</p>
    <p className="text-sm">{incomplete
      ? "대차가 일치하거나 확정 대기 전표가 없어도, 아래 검토를 마치기 전에는 새로 마감할 수 없습니다."
      : "연결·인식 근거와 관리 대상 전표의 원천을 점검했습니다. 이 결과만으로 결산·세무 검토 전체가 완료된 것은 아닙니다."}</p>
    {unavailable && <p className="text-sm">점검에 필요한 자료 또는 검증 기능을 사용할 수 없습니다. 담당자가 원인을 해결한 뒤 다시 조회하세요.</p>}
    {!!check?.issues.length && <ul className="text-sm space-y-1">{check.issues.slice(0, 25).map((issue, index) => <li key={`${issue.code}:${issue.sourceId}:${index}`}>{issue.message}{issue.sourceId && <span className="text-xs cd-text-muted"> · 자료 {issue.sourceId}</span>}</li>)}</ul>}
    {(check?.issues.length ?? 0) > 25 && <p className="text-sm">나머지 {check!.issues.length - 25}건은 결산 자료 엑셀에서 확인하세요.</p>}
    {data.status === "closed" && <p className="text-xs cd-text-muted">이미 저장된 마감 자료는 보존됩니다. 위 점검은 현재 원천자료의 상태입니다.</p>}
  </section>;
}

// ─────────────────────────────────────────────
// 재무상태표
// ─────────────────────────────────────────────

export function BalanceSheetPanel() {
  const [year, setYear] = useState(thisYear());
  const { data, loading, error, load } = useClosingStatus(year);
  const [busy, setBusy] = useState(false);
  const [editCode, setEditCode] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const bs = data?.status === "closed" ? data.snapshotBalanceSheet ?? data.balanceSheet : data?.balanceSheet ?? null;

  const saveOpening = async (accountCode: string, amountText: string) => {
    setBusy(true);
    try {
      const amount = Number(amountText.replace(/[^0-9-]/g, "") || 0);
      const res = await fetch("/api/finance/closing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_opening", year, accountCode, amount }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setEditCode(null);
      load();
    } catch {
      // 오류는 상태 패널에서 확인
    } finally {
      setBusy(false);
    }
  };

  const section = (title: string, lines: BalanceLine[], sign: 1 | -1, total: number) => (
    <div className="mb-3">
      <div className="text-sm font-semibold mb-3">{title} — {won(total)}원</div>
      <table className="w-full text-sm">
        <tbody>
          {lines.map((l) => (
            <tr key={l.accountCode} className="border-t cd-hairline-row-c">
              <td className="py-1 pr-3">{l.name} <span className="text-xs cd-text-muted">{l.accountCode}</span></td>
              <td className="py-1 pr-3 text-right whitespace-nowrap text-xs cd-text-muted" style={{ width: 130 }}>
                {editCode === l.accountCode ? (
                  <input
                    className="cd-input text-right"
                    style={{ width: 120 }}
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value.replace(/[^0-9-]/g, ""))}
                    onBlur={() => void saveOpening(l.accountCode, editValue)}
                    onKeyDown={(e) => e.key === "Enter" && void saveOpening(l.accountCode, editValue)}
                  />
                ) : (
                  <button type="button" className="underline-offset-2 hover:underline" disabled={busy} title="기초 잔액 수정(차변+/대변-)" onClick={() => { setEditCode(l.accountCode); setEditValue(String(sign * l.opening || "")); }}>
                    기초 {won(sign * l.opening)}
                  </button>
                )}
              </td>
              <td className="py-1 pr-3 text-right whitespace-nowrap text-xs cd-text-muted" style={{ width: 120 }}>증감 {won(sign * l.movement)}</td>
              <td className="py-1 text-right whitespace-nowrap font-medium" style={{ width: 130 }}>{won(sign * l.closing)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="cd-card p-4">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <div className="cd-card-title mr-auto">재무상태표 — {year}년 말 기준</div>
        <select aria-label="재무상태표 연도" className="cd-select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[thisYear() - 1, thisYear()].map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={loading} onClick={load}>
          <RefreshCw className="w-3.5 h-3.5" /> 새로고침
        </button>
        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => window.open(`/api/finance/closing?year=${year}&format=xlsx`, "_blank")}>
          <Download className="w-3.5 h-3.5" /> 결산 자료 엑셀
        </button>
      </div>
      {bs && !bs.hasOpening && (
        <div className="text-sm mb-2 flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4" style={{ color: "var(--cd-warning,#FFAE1F)" }} />
          기초 잔액이 없어 당기 발생분만 표시합니다. 전기 재무상태표의 계정별 잔액을 인수하고 원천자료 검토를 마쳐야 합니다.
        </div>
      )}
      {error && <div role="alert" className="cd-error-text text-sm mb-2">{error}</div>}
      {data && <CompletenessNotice data={data} />}
      {data?.status === "closed" && <p className="text-sm mb-2">{data.snapshotBalanceSheet ? "재무상태표는 마감 당시 저장본입니다." : "마감 당시 재무상태표 저장본을 확인할 수 없어 현재 장부를 표시합니다."}</p>}
      {bs && (
        <>
          {section("자산", bs.assets, 1, bs.assetTotal)}
          {section("부채", bs.liabilities, -1, bs.liabilityTotal)}
          {section("자본", bs.equity, -1, bs.equityTotal - bs.netIncome)}
          <div className="text-sm border-t cd-hairline-row-c pt-2 space-y-0.5">
            <div className="flex justify-between"><span>당기순이익</span><span className="font-medium">{won(bs.netIncome)}</span></div>
            <div className="flex justify-between font-semibold">
              <span>자산 {won(bs.assetTotal)} = 부채 {won(bs.liabilityTotal)} + 자본 {won(bs.equityTotal)}</span>
              <span style={{ color: bs.balanced ? "var(--cd-success,#13DEB9)" : "var(--cd-danger,#FA896B)" }}>{bs.balanced ? "대차 일치" : `차이 ${won(bs.assetTotal - bs.liabilityTotal - bs.equityTotal)}`}</span>
            </div>
            {!bs.hasOpening && <div className="text-xs cd-text-muted">기초 미인수 상태에서는 차이가 전기이월 몫입니다 — 기초 입력 후 일치해야 정상.</div>}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 결산·세무조정
// ─────────────────────────────────────────────

interface TaxAdjustmentItem {
  rule: string;
  entryDate: string;
  description: string;
  amount: number;
  note: string;
}

export function ClosingPanel() {
  const [year, setYear] = useState(thisYear());
  const { data, loading, error, load } = useClosingStatus(year);
  const [adjustments, setAdjustments] = useState<{ items: TaxAdjustmentItem[]; entertainmentTotal: number; entertainmentLimit: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  useEffect(() => setReopenReason(""), [year]);

  useEffect(() => {
    fetch(`/api/finance/closing?year=${year}&view=adjustments`, { cache: "no-store" })
      .then((res) => res.json())
      .then((d) => setAdjustments(d.items ? d : null))
      .catch(() => setAdjustments(null));
  }, [year, data?.status]);

  const act = async (action: "close" | "reopen", ok: string) => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/finance/closing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, year, ...(action === "reopen" ? { reason: reopenReason } : {}) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setNotice(ok);
      setReopenReason("");
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      load();
    } finally {
      setBusy(false);
    }
  };

  const closed = data?.status === "closed";

  return (
    <div className="cd-card p-4">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <div className="cd-card-title mr-auto">결산 — 연차 마감·세무조정 후보</div>
        <select aria-label="결산 연도" className="cd-select" disabled={busy} value={year} onChange={(e) => { setYear(Number(e.target.value)); setNotice(null); setActionError(null); }}>
          {[thisYear() - 1, thisYear()].map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
        {closed ? (
          <>
            <span className="cd-pill cd-pill-success"><Lock className="w-3 h-3 inline mr-0.5" /> 마감됨 {data?.closedAt?.slice(0, 10)}</span>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy || !reopenReason.trim()} onClick={() => void act("reopen", "마감을 해제했습니다 — 전표와 기초 잔액을 수정할 수 있습니다.")}>
              <Undo2 className="w-3.5 h-3.5" /> 마감 해제
            </button>
          </>
        ) : (
          <button
            type="button"
            className="cd-btn cd-btn-primary cd-btn-sm"
            disabled={busy || loading || !!error || !data?.completeness?.canClose}
            title="마감하면 해당 연도 전표와 기초 잔액의 변경이 잠기고 재무제표 스냅이 보존됩니다"
            onClick={() => void act("close", "연차 마감했습니다 — 재무제표 스냅이 보존되고 전표와 기초 잔액의 변경이 잠깁니다.")}
          >
            <Check className="w-3.5 h-3.5" /> {year}년 마감
          </button>
        )}
        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy || loading} onClick={load}><RefreshCw className="w-3.5 h-3.5" /> 다시 점검</button>
      </div>
      {closed && (
        <label className="block text-sm mb-3">
          마감 해제 사유
          <input className="cd-input mt-1 w-full" value={reopenReason} maxLength={1000} onChange={(event) => setReopenReason(event.target.value)} placeholder="어떤 자료를 수정해야 하는지 입력하세요." disabled={busy} />
        </label>
      )}
      <div className="text-xs cd-text-muted mb-3">
        마감 전 확정 대기 전표, 원천자료 검토 항목과 가지급·가수 잔액을 정리하세요.
        세무조정 후보는 자동 감지 결과이므로 신고 전에 근거와 적용 여부를 검토해야 합니다.
      </div>
      {(error || actionError) && <div role="alert" className="cd-error-text text-sm mb-2">{actionError ?? error}</div>}
      {notice && <div className="text-sm mb-2" style={{ color: "var(--cd-success,#13DEB9)" }}>{notice}</div>}
      {data && <CompletenessNotice data={data} />}

      {data && (
        <div className="flex gap-2 flex-wrap mb-3">
          <span className={`cd-chip cd-chip-sm ${data.pendingCount ? "" : "cd-text-muted"}`}>확정 대기 {data.pendingCount}건</span>
          <span className={`cd-chip cd-chip-sm ${data.suspenseOut ? "" : "cd-text-muted"}`}>가지급금 잔액 {won(data.suspenseOut)}</span>
          <span className={`cd-chip cd-chip-sm ${data.suspenseIn ? "" : "cd-text-muted"}`}>가수금 잔액 {won(data.suspenseIn)}</span>
          {adjustments && (
            <span className="cd-chip cd-chip-sm">
              기업업무추진비 {won(adjustments.entertainmentTotal)} / 한도 {won(adjustments.entertainmentLimit)}
            </span>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="cd-table-head">
            <tr className="cd-text-muted text-left">
              <th className="py-1.5 pr-3 font-normal">규칙</th>
              <th className="py-1.5 pr-3 font-normal">일자</th>
              <th className="py-1.5 pr-3 font-normal">내용</th>
              <th className="py-1.5 pr-3 font-normal text-right">금액</th>
              <th className="py-1.5 font-normal">검토 사항</th>
            </tr>
          </thead>
          <tbody>
            {(adjustments?.items ?? []).map((it, i) => (
              <tr key={i} className="border-t cd-hairline-row-c">
                <td className="py-1.5 pr-3 whitespace-nowrap"><span className="cd-pill cd-pill-warn">{it.rule}</span></td>
                <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{it.entryDate}</td>
                <td className="py-1.5 pr-3 max-w-[280px]"><div className="truncate" title={it.description}>{it.description}</div></td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap font-medium">{won(it.amount)}</td>
                <td className="py-1.5 text-xs cd-text-muted max-w-[300px]"><div className="truncate" title={it.note}>{it.note}</div></td>
              </tr>
            ))}
            {adjustments && adjustments.items.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center cd-text-muted text-sm">감지된 세무조정 후보가 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
