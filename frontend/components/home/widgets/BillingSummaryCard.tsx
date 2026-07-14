"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Wallet } from "lucide-react";
import { HomeCard } from "../HomeCard";
import { useHomeWidget } from "../useHomeWidget";

interface Kpi {
  count: number;
  amount: number;
}
interface BillingSummary {
  since: string;
  issued: Kpi;
  collected: Kpi;
  unpaid: Kpi;
}

/** 금액 축약: 억/만 단위. */
function fmtMoney(n: number): string {
  if (!n || n <= 0) return "0";
  const eok = Math.floor(n / 1e8);
  const man = Math.round((n - eok * 1e8) / 1e4);
  if (eok > 0) return man > 0 ? `${eok}억 ${man.toLocaleString("ko-KR")}만` : `${eok}억`;
  if (man > 0) return `${man.toLocaleString("ko-KR")}만`;
  return Math.round(n).toLocaleString("ko-KR");
}

function KpiTile({
  label,
  kpi,
  color,
  href,
}: {
  label: string;
  kpi: Kpi;
  color: string;
  href?: string;
}) {
  const inner: ReactNode = (
    <>
      <span className="text-[11px] font-semibold" style={{ color }}>
        {label}
      </span>
      <span className="text-[15px] font-extrabold cd-text tabular-nums leading-tight mt-1">
        {fmtMoney(kpi.amount)}
      </span>
      <span className="text-[11px] cd-text-faint tabular-nums">{kpi.count}건</span>
    </>
  );
  const cls = "flex flex-col rounded-lg border cd-border-c px-3 py-2.5";
  if (href) {
    return (
      <Link href={href} className={cls + " hover:bg-[color:var(--cd-surface)] transition-colors"}>
        {inner}
      </Link>
    );
  }
  return <div className={cls}>{inner}</div>;
}

/** H7 — 최근 2개월 발행/수금/미수금 KPI. 수금·미수금 클릭 시 billing 해당 탭. */
export function BillingSummaryCard() {
  const w = useHomeWidget<BillingSummary>("/api/home/billing-summary");
  if (w.status === "forbidden") return null;
  const d = w.status === "ok" ? w.data : null;
  const zero: Kpi = { count: 0, amount: 0 };

  return (
    <HomeCard
      icon={<Wallet className="w-4 h-4" />}
      title="수금/발행 요약"
      accent="#539BFF"
      href="/contracts/billing"
      loading={w.status === "loading"}
      error={w.status === "error" ? w.message : undefined}
    >
      <div className="flex flex-col gap-2">
        <p className="text-[11px] cd-text-faint">최근 2개월 기준</p>
        <div className="grid grid-cols-3 gap-2">
          <KpiTile label="발행" kpi={d?.issued ?? zero} color="#5D87FF" />
          <KpiTile
            label="수금"
            kpi={d?.collected ?? zero}
            color="#13DEB9"
            href="/contracts/billing?tab=collections"
          />
          <KpiTile
            label="미수금"
            kpi={d?.unpaid ?? zero}
            color="#FA896B"
            href="/contracts/billing?tab=uncollected"
          />
        </div>
      </div>
    </HomeCard>
  );
}
