"use client";

import { Gavel } from "lucide-react";
import { HomeCard, HomeRow } from "../HomeCard";
import { useHomeWidget } from "../useHomeWidget";

interface Bid {
  facilityId: string;
  facilityName: string | null;
  projectId: string;
  projectTitle: string | null;
  orderType: string | null;
  bidEnd: string | null;
  estimatedPrice: number | null;
}

/** 투찰 마감일(YYYY-MM-DD) → D-day. KST 오늘 기준. */
function dday(bidEnd: string | null): { label: string; urgent: boolean } {
  if (!bidEnd) return { label: "-", urgent: false };
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const end = bidEnd.slice(0, 10);
  const diff = Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
  if (Number.isNaN(diff)) return { label: end, urgent: false };
  if (diff === 0) return { label: "D-day", urgent: true };
  if (diff < 0) return { label: `D+${-diff}`, urgent: false };
  return { label: `D-${diff}`, urgent: diff <= 3 };
}

/** H3 — 투찰 마감 임박. */
export function UpcomingBidsCard() {
  const w = useHomeWidget<{ bids: Bid[] }>("/api/sales/upcoming-bids");
  if (w.status === "forbidden") return null;
  const bids = w.status === "ok" ? w.data.bids : [];

  return (
    <HomeCard
      icon={<Gavel className="w-4 h-4" />}
      title="투찰 마감 임박"
      count={bids.length}
      accent="#FA896B"
      href="/sales"
      loading={w.status === "loading"}
      error={w.status === "error" ? w.message : undefined}
      empty={w.status === "ok" && bids.length === 0}
      emptyText="마감 임박한 투찰이 없습니다."
    >
      <ul className="flex flex-col gap-1.5">
        {bids.slice(0, 5).map((b) => {
          const d = dday(b.bidEnd);
          return (
            <li key={b.projectId}>
              <HomeRow href="/sales">
                {/* 글머리 세로 색 바 — 마감 임박(D-3 이내)은 주황, 그 외는 뉴트럴 */}
                <span
                  className="w-1 h-[30px] rounded-[2px] shrink-0"
                  style={{ background: d.urgent ? "#E8705F" : "var(--cd-faint)", opacity: 0.85 }}
                />
                <span
                  className="text-[11px] font-bold rounded px-1.5 py-0.5 shrink-0 w-[52px] text-center tabular-nums"
                  style={
                    d.urgent
                      ? { background: "color-mix(in srgb, #FA896B 16%, transparent)", color: "#FA896B" }
                      : { background: "var(--cd-surface)", color: "var(--cd-muted)" }
                  }
                >
                  {d.label}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] cd-text truncate">
                    {b.projectTitle || b.facilityName || "제목 없음"}
                  </span>
                  <span className="block text-[11px] cd-text-faint truncate">
                    {b.facilityName}
                    {b.orderType ? ` · ${b.orderType}` : ""}
                  </span>
                </span>
                <span className="text-[11px] font-mono cd-text-faint shrink-0 tabular-nums">
                  {b.bidEnd ? b.bidEnd.slice(0, 10) : ""}
                </span>
              </HomeRow>
            </li>
          );
        })}
      </ul>
    </HomeCard>
  );
}
