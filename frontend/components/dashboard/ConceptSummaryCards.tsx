"use client";

import { useEffect, useState } from "react";
import {
  ShieldCheck,
  FlaskConical,
  Wind,
  Leaf,
  Handshake,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * 라운드 2B — `/data/status` 헤더 직하 5장 요약 카드.
 * - "통합허가" 1장만 실측 (총 사업장 + 24h 신규)
 * - 나머지 4장(화관법 / HAPs / ESG / 계약 진행)은 컨셉 더미 — CONCEPT 배지 표시
 * - 디자인 가드: 글래스모피즘 + 단일 hue 그린 포인트, 무지개/보라 금지.
 */

interface KpiData {
  totalFacilities: number;
  recentFacilities24h: number;
}

interface CardSpec {
  label: string;
  icon: LucideIcon;
  /** "실측" | "컨셉" */
  kind: "real" | "concept";
  /** real 카드 — 실측 값 산출 함수 */
  realValue?: (kpi: KpiData | null) => string;
  realHint?: (kpi: KpiData | null) => string;
  /** concept 카드 — 더미 표시 값 */
  conceptValue?: string;
  conceptHint?: string;
  /** 카드 우상단 트렌드 표시(컨셉) */
  conceptTrend?: string;
}

const CARDS: CardSpec[] = [
  {
    label: "통합허가",
    icon: ShieldCheck,
    kind: "real",
    realValue: (k) => (k ? k.totalFacilities.toLocaleString() : "—"),
    realHint: (k) => (k ? `최근 24h ${k.recentFacilities24h.toLocaleString()}건 신규` : "로딩중"),
  },
  {
    label: "화관법",
    icon: FlaskConical,
    kind: "concept",
    conceptValue: "—",
    conceptHint: "유해화학물질 취급사업장",
    conceptTrend: "계약 모듈 연동 예정",
  },
  {
    label: "HAPs",
    icon: Wind,
    kind: "concept",
    conceptValue: "—",
    conceptHint: "유해대기오염물질 사업장",
    conceptTrend: "라운드 2C 이후",
  },
  {
    label: "ESG",
    icon: Leaf,
    kind: "concept",
    conceptValue: "—",
    conceptHint: "지속가능경영 보고서",
    conceptTrend: "외부 데이터 연동 예정",
  },
  {
    label: "계약 진행",
    icon: Handshake,
    kind: "concept",
    conceptValue: "—",
    conceptHint: "영업/계약 진행 단계",
    conceptTrend: "계약 모듈 라운드",
  },
];

export function ConceptSummaryCards({ refreshKey }: { refreshKey?: number }) {
  const [kpi, setKpi] = useState<KpiData | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/dashboard/kpi", { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = (await res.json()) as KpiData;
        if (!cancelled) setKpi(json);
      } catch {
        if (!cancelled) setKpi(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 reveal delay-1">
      {CARDS.map((c, idx) => (
        <ConceptCard key={c.label} card={c} kpi={kpi} index={idx} />
      ))}
    </section>
  );
}

function ConceptCard({
  card,
  kpi,
  index,
}: {
  card: CardSpec;
  kpi: KpiData | null;
  index: number;
}) {
  const Icon = card.icon;
  const isReal = card.kind === "real";
  const value = isReal ? card.realValue?.(kpi) ?? "—" : card.conceptValue ?? "—";
  const hint = isReal ? card.realHint?.(kpi) ?? "" : card.conceptHint ?? "";
  const trend = isReal ? null : card.conceptTrend;

  return (
    <div
      className={
        "relative rounded-2xl p-4 border transition-shadow " +
        (isReal
          ? "bg-gradient-to-br from-primary/15 via-white/70 to-white/40 border-white/70 shadow-sm"
          : "bg-white/55 border-white/60 concept-hatched")
      }
      style={{ animationDelay: 0.05 + index * 0.04 + "s" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon
            className={"w-4 h-4 flex-shrink-0 " + (isReal ? "text-primary" : "text-stone-400")}
          />
          <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500 truncate">
            {card.label}
          </div>
        </div>
        {isReal ? (
          <span className="status-pill status-pill--success" title="실측 데이터">
            <Sparkles className="w-2.5 h-2.5" />
            실측
          </span>
        ) : (
          <span className="status-pill status-pill--warn" title="컨셉 데이터 — 추후 라운드 연동">
            CONCEPT
          </span>
        )}
      </div>

      <div className={"mt-2 text-3xl font-extrabold leading-tight " + (isReal ? "text-stone-900" : "text-stone-400")}>
        {value}
      </div>
      {hint && (
        <div className="text-[10px] text-stone-500 font-medium mt-1 truncate" title={hint}>
          {hint}
        </div>
      )}
      {trend && (
        <div className="text-[10px] mt-2 inline-flex items-center gap-1 text-stone-400 font-medium">
          <TrendingUp className="w-3 h-3" />
          {trend}
        </div>
      )}
    </div>
  );
}
