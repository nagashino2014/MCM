"use client";

import { ClipboardCheck } from "lucide-react";
import { HomeCard, HomeRow } from "../HomeCard";
import { useHomeWidget } from "../useHomeWidget";
import type { FilingSummary } from "@/lib/filings/types";
import { FILING_KIND_LABEL, FILING_TRIGGER_LABEL } from "@/lib/filings/types";

const ACCENT = "#FA896B";

/** 홈 위젯 — 대외 신고 대기(IEPS 기술인력·대행 실적, ETIS 기술자). 기한 초과는 붉게, 임박은 주황으로. */
export function FilingQueueCard() {
  const w = useHomeWidget<FilingSummary>("/api/filings/summary");
  if (w.status === "forbidden") return null;
  const data = w.status === "ok" ? w.data : null;
  const items = data?.items ?? [];

  return (
    <HomeCard
      icon={<ClipboardCheck className="w-4 h-4" />}
      title="대외 신고 대기"
      count={data?.pending}
      accent={data && data.overdue > 0 ? ACCENT : "#FFAE1F"}
      href="/contracts/filings"
      loading={w.status === "loading"}
      error={w.status === "error" ? w.message : undefined}
      empty={data != null && items.length === 0}
      emptyText="신고할 항목이 없습니다."
    >
      {data && (data.overdue > 0 || data.dueSoon > 0) && (
        <p className="text-[11px] cd-text-muted mb-1.5 px-2">
          {data.overdue > 0 && <span style={{ color: ACCENT }} className="font-bold mr-2">기한 초과 {data.overdue}건</span>}
          {data.dueSoon > 0 && <span style={{ color: "#FFAE1F" }} className="font-bold">기한 임박 {data.dueSoon}건</span>}
        </p>
      )}
      <ul className="flex flex-col gap-1.5">
        {items.map((f) => {
          const overdue = f.daysLeft != null && f.daysLeft < 0;
          const soon = !overdue && f.daysLeft != null && f.daysLeft <= 7;
          const color = overdue ? ACCENT : soon ? "#FFAE1F" : "#539BFF";
          return (
            <li key={f.filingId}>
              <HomeRow href={`/contracts/filings?open=${encodeURIComponent(f.filingId)}`}>
                <span className="w-1 h-[30px] rounded-[2px] shrink-0" style={{ background: color, opacity: 0.85 }} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] cd-text truncate">{f.title}</span>
                  <span className="block text-[11px] cd-text-faint truncate">
                    {FILING_KIND_LABEL[f.filingKind]} · {FILING_TRIGGER_LABEL[f.triggerKind] ?? f.triggerKind}
                    {f.subtitle ? ` · ${f.subtitle}` : ""}
                  </span>
                </span>
                <span
                  className="text-[10px] font-bold rounded-full px-2 py-0.5 shrink-0"
                  style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
                >
                  {f.daysLeft == null ? "기한 없음" : overdue ? `${-f.daysLeft}일 초과` : f.daysLeft === 0 ? "오늘" : `D-${f.daysLeft}`}
                </span>
              </HomeRow>
            </li>
          );
        })}
      </ul>
    </HomeCard>
  );
}
