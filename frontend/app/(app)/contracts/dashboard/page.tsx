"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, CircleDollarSign, FileWarning, RefreshCw, TrendingUp } from "lucide-react";

interface DashboardData {
  kpis: {
    totalContracts: number;
    totalAmount: number;
    issuedAmount: number;
    collectedAmount: number;
    unissuedAmount: number;
    uncollectedAmount: number;
    collectionRate: number;
  };
  byServiceType: Array<{ serviceType: string; count: number; amount: number }>;
  byYear: Array<{ year: string; count: number; amount: number }>;
  uncollected: Array<{
    contractId: string;
    contractTitle: string;
    counterpartyName: string;
    stageLabel: string;
    amount: number;
    invoiceIssuedAt: string | null;
  }>;
}

export default function ContractDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/contracts/dashboard", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      setData((await res.json()) as DashboardData);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const maxServiceAmount = useMemo(
    () => Math.max(...(data?.byServiceType.map((item) => item.amount) ?? [0]), 1),
    [data]
  );
  const maxYearAmount = useMemo(
    () => Math.max(...(data?.byYear.map((item) => item.amount) ?? [0]), 1),
    [data]
  );

  return (
    <div className="flex flex-col gap-6 p-2">
      <section className="rounded-3xl relative overflow-hidden reveal border border-zinc-800/10 bg-[#171914] text-stone-50 shadow-xl">
        <div className="absolute inset-0 opacity-50 bg-[radial-gradient(circle_at_20%_10%,rgba(251,191,36,0.24),transparent_26%),radial-gradient(circle_at_80%_20%,rgba(34,197,94,0.14),transparent_28%)]" />
        <div className="relative z-10 p-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-black tracking-[0.24em] text-amber-300 uppercase">Contract Dashboard</p>
            <h1 className="text-3xl font-black mt-2 mb-3 flex items-center gap-3">
              <BarChart3 className="w-7 h-7 text-amber-300" />
              계약 Dashboard
            </h1>
            <p className="text-stone-300 text-sm max-w-3xl">
              엑셀 Dashboard 시트의 개괄성을 웹으로 이전해 수주, 매출, 미수금, 용역별 흐름을 한눈에 확인합니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={reload} className="rounded-xl px-3 py-2 text-xs font-black bg-amber-300 text-zinc-950 hover:bg-amber-200 flex items-center gap-1">
              <RefreshCw className={"w-3.5 h-3.5 " + (loading ? "animate-spin" : "")} />
              새로고침
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="glass-card rounded-2xl p-6 text-sm text-red-600">
          대시보드 데이터를 불러오지 못했습니다.
          <div className="mt-2 font-mono text-xs">{error}</div>
        </div>
      ) : !data ? (
        <div className="glass-card rounded-2xl p-10 text-center text-sm text-stone-500">계약 대시보드를 불러오는 중입니다.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <Kpi icon={TrendingUp} label="총 수주" value={formatMoney(data.kpis.totalAmount)} sub={`${data.kpis.totalContracts.toLocaleString()}건`} />
            <Kpi icon={CircleDollarSign} label="발행금액" value={formatMoney(data.kpis.issuedAmount)} sub="계산서 발행 기준" />
            <Kpi icon={CircleDollarSign} label="수금금액" value={formatMoney(data.kpis.collectedAmount)} sub={`수금률 ${data.kpis.collectionRate}%`} />
            <Kpi icon={FileWarning} label="미수금" value={formatMoney(data.kpis.uncollectedAmount)} sub="단계별 수금 대기" tone="warning" />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-5">
            <section className="glass-card rounded-3xl p-5 reveal delay-1">
              <h2 className="font-black text-stone-800 mb-4">용역별 수주</h2>
              <div className="grid gap-3">
                {data.byServiceType.map((item) => (
                  <div key={item.serviceType} className="grid grid-cols-[120px_1fr_90px] gap-3 items-center text-sm">
                    <span className="font-bold text-stone-700 truncate">{item.serviceType}</span>
                    <div className="h-8 rounded-full bg-stone-200/80 overflow-hidden">
                      <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.max(4, (item.amount / maxServiceAmount) * 100)}%` }} />
                    </div>
                    <span className="text-right font-mono text-stone-700">{formatMoney(item.amount)}</span>
                  </div>
                ))}
                {data.byServiceType.length === 0 && <p className="text-sm text-stone-500">집계할 계약 데이터가 없습니다.</p>}
              </div>
            </section>

            <section className="glass-card rounded-3xl p-5 reveal delay-2">
              <h2 className="font-black text-stone-800 mb-4">연도별 수주</h2>
              <div className="flex items-end gap-2 h-64">
                {[...data.byYear].reverse().map((item) => (
                  <div key={item.year} className="flex-1 flex flex-col items-center gap-2">
                    <div className="w-full rounded-t-xl bg-[#24251f]" style={{ height: `${Math.max(8, (item.amount / maxYearAmount) * 220)}px` }} />
                    <span className="text-[11px] font-bold text-stone-500">{item.year}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="glass-card rounded-3xl p-5 reveal delay-3">
            <h2 className="font-black text-stone-800 mb-4">미수금 현황</h2>
            <div className="grid gap-2">
              {data.uncollected.map((item) => (
                <Link
                  key={item.contractId + item.stageLabel}
                  href={`/contracts?focus=${encodeURIComponent(item.contractId)}`}
                  className="rounded-2xl border border-stone-200/80 bg-white/60 px-4 py-3 hover:bg-amber-50 grid grid-cols-1 md:grid-cols-[1fr_120px_120px] gap-2 items-center"
                >
                  <div>
                    <p className="font-bold text-sm text-stone-800">{item.contractTitle}</p>
                    <p className="text-xs text-stone-500">{item.counterpartyName} · {item.stageLabel}</p>
                  </div>
                  <span className="text-sm text-stone-600">{item.invoiceIssuedAt ?? "미발행"}</span>
                  <span className="text-right font-black text-stone-900">{formatMoney(item.amount)}</span>
                </Link>
              ))}
              {data.uncollected.length === 0 && <p className="text-sm text-stone-500">미수금 단계가 없습니다.</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  sub: string;
  tone?: "warning";
}) {
  return (
    <div className={"rounded-3xl p-5 border reveal bg-white/70 " + (tone === "warning" ? "border-orange-300" : "border-stone-200/80")}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-black text-stone-500">{label}</span>
        <Icon className={"w-5 h-5 " + (tone === "warning" ? "text-orange-600" : "text-amber-600")} />
      </div>
      <p className="text-2xl font-black text-stone-900 mt-3">{value}</p>
      <p className="text-xs text-stone-500 mt-1">{sub}</p>
    </div>
  );
}

function formatMoney(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return "-";
  if (Math.abs(n) >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, "") + "억";
  if (Math.abs(n) >= 10000) return Math.round(n / 10000).toLocaleString() + "만";
  return n.toLocaleString();
}
