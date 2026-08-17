"use client";

// 결산 패널 2종 (accounting-expansion 블루프린트 §5 P9)
// - BalanceSheetPanel: 재무상태표(기초 인수 + 당기 발생) + 기초 잔액 입력.
// - ClosingPanel: 결산 점검(확정 대기·가지급/가수 잔액) + 세무조정 후보 + 연차 마감/재개 + 결산 자료 xlsx.
// FinanceBoard 의 소메뉴 "손익·자금" 그룹에서 렌더된다(JournalPanels 스타일 관례 동일).

import { useCallback, useEffect, useState } from "react";
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
}

function useClosingStatus(year: number) {
  const [data, setData] = useState<ClosingStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/finance/closing?year=${year}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((d) => {
        if (d.error) setError(String(d.error));
        else setData(d);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [year]);
  useEffect(load, [load]);
  return { data, loading, error, load };
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

  const bs = data?.balanceSheet ?? null;

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
      <div className="text-sm font-semibold mb-1">{title} — {won(total)}원</div>
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
        <select className="cd-select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
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
          기초 잔액이 없습니다 — 당기 발생분만 표시 중. 세무법인 전기(전년도) 재무상태표의 계정별 잔액을 "기초" 클릭으로 입력하면 완전한 재무상태표가 됩니다.
        </div>
      )}
      {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
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
        body: JSON.stringify({ action, year }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setNotice(ok);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const closed = data?.status === "closed";

  return (
    <div className="cd-card p-4">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <div className="cd-card-title mr-auto">결산 — 연차 마감·세무조정 후보</div>
        <select className="cd-select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[thisYear() - 1, thisYear()].map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
        {closed ? (
          <>
            <span className="cd-pill cd-pill-success"><Lock className="w-3 h-3 inline mr-0.5" /> 마감됨 {data?.closedAt?.slice(0, 10)}</span>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy} onClick={() => void act("reopen", "마감을 해제했습니다 — 전표 재생성이 다시 가능합니다.")}>
              <Undo2 className="w-3.5 h-3.5" /> 마감 해제
            </button>
          </>
        ) : (
          <button
            type="button"
            className="cd-btn cd-btn-primary cd-btn-sm"
            disabled={busy || loading}
            title="마감하면 해당 연도 전표 재생성이 잠기고 재무제표 스냅이 보존됩니다"
            onClick={() => void act("close", "연차 마감했습니다 — 재무제표 스냅이 보존되고 전표 재생성이 잠깁니다.")}
          >
            <Check className="w-3.5 h-3.5" /> {year}년 마감
          </button>
        )}
      </div>
      <div className="text-xs cd-text-muted mb-3">
        마감 전 점검: 확정 대기 전표와 가지급·가수 잔액을 정리하세요(확정 대기가 남아 있으면 마감이 거부됩니다 — T3).
        세무조정 후보는 자동 감지이며 최종 판단은 신고 시 검토합니다. 법인세 조정·신고는 첫 사이클 세무사 검토 병행(§5 P9-⑤).
      </div>
      {(error || actionError) && <div className="cd-error-text text-sm mb-2">{actionError ?? error}</div>}
      {notice && <div className="text-sm mb-2" style={{ color: "var(--cd-success,#13DEB9)" }}>{notice}</div>}

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
          <thead>
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
