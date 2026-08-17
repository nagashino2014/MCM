"use client";

// 관리 손익·자금수지 패널 (accounting-expansion 블루프린트 §5 P4)
// - PnlPanel: 월별 손익계산서 — 전표(자동+확정)의 수익·비용 계정을 월 피벗. 표 기반(재무 보드 관례).
// - CashPanel: 자금수지 — 계좌 잔액(원장 실측)·이번 달 입출·미수 잔액 KPI + 월별 실적 6개월·전망 3개월.
//   전망 = 발행 미수×결제주기 학습(유입), 최근 3개월 평균 출금(유출). 마이그 없음(파생 조회, U3·U5).

import { useEffect, useState } from "react";
import { AlertTriangle, Landmark } from "lucide-react";

const won = (n: number) => n.toLocaleString("ko-KR");
/** 백만원 축약(피벗 표의 밀도 완화) 없이 원 단위 유지 — 회계 관리자 화면(정확성 우선). */

// ─────────────────────────────────────────────
// 월별 손익계산서
// ─────────────────────────────────────────────

interface PnlRow {
  accountCode: string;
  name: string;
  acctType: "revenue" | "expense";
  byMonth: number[];
  total: number;
}

interface PnlData {
  year: string;
  rows: PnlRow[];
  revenueByMonth: number[];
  expenseByMonth: number[];
  netByMonth: number[];
  revenueTotal: number;
  expenseTotal: number;
  netTotal: number;
  pendingCount: number;
}

export function PnlPanel() {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [data, setData] = useState<PnlData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setError(null);
      try {
        const res = await fetch(`/api/finance/management?view=pnl&year=${year}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? "손익을 불러오지 못했습니다.");
        if (alive) setData(body);
      } catch (err) {
        if (alive) setError((err as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [year]);

  const months = Array.from({ length: 12 }, (_, i) => i);
  const section = (label: string, type: "revenue" | "expense", totals: number[], total: number) => (
    <>
      <tr className="font-medium" style={{ background: "var(--cd-tint-primary, rgba(93,135,255,.06))" }}>
        <td className="py-1.5 pr-3">{label}</td>
        {months.map((m) => (
          <td key={m} className="py-1.5 pr-3 text-right whitespace-nowrap">{totals[m] ? won(totals[m]) : ""}</td>
        ))}
        <td className="py-1.5 text-right whitespace-nowrap">{won(total)}</td>
      </tr>
      {(data?.rows ?? [])
        .filter((r) => r.acctType === type)
        .map((r) => (
          <tr key={r.accountCode} className="border-t cd-hairline-row-c">
            <td className="py-1.5 pr-3 pl-4 whitespace-nowrap">
              <span className="cd-text-faint text-xs mr-1.5">{r.accountCode}</span>
              {r.name}
            </td>
            {months.map((m) => (
              <td key={m} className="py-1.5 pr-3 text-right whitespace-nowrap text-xs">{r.byMonth[m] ? won(r.byMonth[m]) : ""}</td>
            ))}
            <td className="py-1.5 text-right whitespace-nowrap font-medium">{won(r.total)}</td>
          </tr>
        ))}
    </>
  );

  return (
    <div className="cd-card p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="cd-card-title mr-auto">월별 손익계산서(관리용 — 전표 발생 기준)</div>
        <select className="cd-select" value={year} onChange={(e) => setYear(e.target.value)}>
          {[0, 1, 2].map((d) => {
            const y = String(now.getFullYear() - d);
            return (
              <option key={y} value={y}>{y}년</option>
            );
          })}
        </select>
      </div>
      <div className="text-xs cd-text-muted mb-3 flex items-center gap-2 flex-wrap">
        자동·확정 전표만 집계됩니다.
        {data && data.pendingCount > 0 && (
          <span className="cd-pill cd-pill-warn">
            <AlertTriangle className="w-3 h-3" /> 확정 필요 {data.pendingCount}건 미포함 — 분개장에서 확정할수록 정확해집니다
          </span>
        )}
      </div>
      {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="cd-text-muted text-left">
              <th className="py-1.5 pr-3 font-normal">계정과목</th>
              {months.map((m) => (
                <th key={m} className="py-1.5 pr-3 font-normal text-right">{m + 1}월</th>
              ))}
              <th className="py-1.5 font-normal text-right">연간</th>
            </tr>
          </thead>
          <tbody>
            {data && section("수익", "revenue", data.revenueByMonth, data.revenueTotal)}
            {data && section("비용", "expense", data.expenseByMonth, data.expenseTotal)}
            {data && (
              <tr className="border-t-2 cd-hairline-row-c font-bold">
                <td className="py-2 pr-3">당기 손익</td>
                {months.map((m) => (
                  <td
                    key={m}
                    className="py-2 pr-3 text-right whitespace-nowrap"
                    style={data.netByMonth[m] < 0 ? { color: "var(--cd-error,#FA896B)" } : undefined}
                  >
                    {data.netByMonth[m] ? won(data.netByMonth[m]) : ""}
                  </td>
                ))}
                <td className="py-2 text-right whitespace-nowrap" style={data.netTotal < 0 ? { color: "var(--cd-error,#FA896B)" } : undefined}>
                  {won(data.netTotal)}
                </td>
              </tr>
            )}
            {data && data.rows.length === 0 && (
              <tr>
                <td colSpan={14} className="py-6 text-center cd-text-muted text-sm">
                  전표가 없습니다 — 전표·장부 &gt; 분개장에서 "재생성"을 먼저 실행하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 자금수지
// ─────────────────────────────────────────────

interface CashData {
  totalBalance: number;
  balances: Array<{ accountId: string; bankName: string; alias: string | null; balance: number; asOf: string }>;
  today: { date: string; inflow: number; outflow: number };
  thisMonth: { inflow: number; outflow: number };
  receivableTotal: number;
  receivableCount: number;
  avgMonthlyOut: number;
  monthly: Array<{ month: string; inflow: number; outflow: number; net: number; forecast: boolean; endBalance: number | null }>;
  note: string;
}

export function CashPanel() {
  const [data, setData] = useState<CashData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/finance/management?view=cash", { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? "자금수지를 불러오지 못했습니다.");
        if (alive) setData(body);
      } catch (err) {
        if (alive) setError((err as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const kpi = (label: string, value: string, sub?: string, tone?: string) => (
    <div className="border cd-border-c rounded-2xl px-4 py-3 min-w-[180px]">
      <div className="text-xs cd-text-muted mb-1">{label}</div>
      <div className="text-lg font-bold whitespace-nowrap" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub && <div className="text-[11px] cd-text-faint mt-0.5">{sub}</div>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="cd-card p-4">
        <div className="cd-card-title mb-3">자금 현황(자금일보)</div>
        {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
        {data && (
          <>
            <div className="flex gap-3 flex-wrap mb-4">
              {kpi("현재 예금 잔액", `${won(data.totalBalance)}원`, `기준: 계좌 원장 최종 거래`)}
              {kpi("오늘 입금 / 출금", `${won(data.today.inflow)} / ${won(data.today.outflow)}`, data.today.date)}
              {kpi("이번 달 입금 / 출금", `${won(data.thisMonth.inflow)} / ${won(data.thisMonth.outflow)}`)}
              {kpi("발행 미수 잔액", `${won(data.receivableTotal)}원`, `${data.receivableCount}건 — 수금 예정 유입`, "var(--cd-primary,#5D87FF)")}
            </div>
            <div className="flex gap-2 flex-wrap">
              {data.balances.map((b) => (
                <span key={b.accountId} className="inline-flex items-center gap-1.5 border cd-border-c rounded-xl px-3 py-1.5 text-sm">
                  <Landmark className="w-3.5 h-3.5 cd-text-muted" />
                  {b.alias ?? b.bankName}
                  <b className="ml-1">{won(b.balance)}원</b>
                  <span className="text-[10px] cd-text-faint">({b.asOf})</span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="cd-card p-4">
        <div className="cd-card-title mb-3">월별 자금수지 — 실적 6개월 + 전망 3개월</div>
        {data && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="cd-text-muted text-left">
                    <th className="py-1.5 pr-3 font-normal">월</th>
                    <th className="py-1.5 pr-3 font-normal text-right">유입</th>
                    <th className="py-1.5 pr-3 font-normal text-right">유출</th>
                    <th className="py-1.5 pr-3 font-normal text-right">순수지</th>
                    <th className="py-1.5 font-normal text-right">기말 예상 잔액</th>
                  </tr>
                </thead>
                <tbody>
                  {data.monthly.map((m) => (
                    <tr key={m.month} className="border-t cd-hairline-row-c">
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {m.month}
                        {m.forecast && <span className="ml-1.5 cd-pill cd-pill-info">전망</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-right whitespace-nowrap">{won(m.inflow)}</td>
                      <td className="py-1.5 pr-3 text-right whitespace-nowrap">{won(m.outflow)}</td>
                      <td
                        className="py-1.5 pr-3 text-right whitespace-nowrap font-medium"
                        style={m.net < 0 ? { color: "var(--cd-error,#FA896B)" } : { color: "var(--cd-success,#13DEB9)" }}
                      >
                        {won(m.net)}
                      </td>
                      <td className="py-1.5 text-right whitespace-nowrap font-medium">
                        {m.endBalance != null ? won(m.endBalance) : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[11px] cd-text-faint mt-2">{data.note}</div>
          </>
        )}
      </div>
    </div>
  );
}
