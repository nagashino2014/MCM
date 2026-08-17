"use client";

import Link from "next/link";
import { HomeCard } from "../HomeCard";
import { useHomeWidget } from "../useHomeWidget";

interface FinanceAlerts {
  unclassified: number;
  quarterStart: string;
  reconHigh: number;
  reconReview: number;
  ntsFailed: number;
  journalPending: number;
  taxDeadlines?: Array<{ kind: string; label: string; dueDate: string; dday: number }>;
}

/**
 * 재무 알림(P5) — 손 대야 할 재무 작업 3종을 한 카드에 모은다.
 * 미분류 카드 건(이번 분기) · 수금 대조 대기(고신뢰/검토) · 세금계산서 전송실패.
 * 각 행이 해당 화면으로 바로 가는 딥링크다.
 */
export function FinanceAlertsCard() {
  const w = useHomeWidget<FinanceAlerts>("/api/home/finance-alerts");

  if (w.status === "forbidden") return null;
  const d = w.status === "ok" ? w.data : null;
  const total = d ? d.unclassified + d.reconHigh + d.reconReview + d.ntsFailed + (d.journalPending ?? 0) : 0;

  const rows = d
    ? [
        {
          key: "recon-high",
          label: "수금 대조 — 고신뢰 승인 대기",
          count: d.reconHigh,
          href: "/finance?tab=recon",
          tone: "var(--cd-success)",
          hint: "일괄 승인만 하면 수금 반영",
        },
        {
          key: "recon-review",
          label: "수금 대조 — 검토 필요",
          count: d.reconReview,
          href: "/finance?tab=recon",
          tone: "var(--cd-warning)",
          hint: "합계 매칭 등 확인 후 승인",
        },
        {
          key: "unclassified",
          label: "법인카드 미분류(이번 분기)",
          count: d.unclassified,
          href: "/finance?tab=card",
          tone: "var(--cd-primary)",
          hint: "부가세 집계 전에 계정과목 지정",
        },
        {
          key: "nts-failed",
          label: "세금계산서 국세청 전송실패",
          count: d.ntsFailed,
          href: "/finance?tab=invoice",
          tone: "var(--cd-error)",
          hint: "재발행·바로빌 확인 필요",
        },
        {
          key: "journal-pending",
          label: "전표 확정 필요(계정 미지정)",
          count: d.journalPending ?? 0,
          href: "/finance?tab=journal",
          tone: "var(--cd-secondary)",
          hint: "분개장에서 계정만 지정하면 확정",
        },
      ].filter((r) => r.count > 0)
    : [];

  return (
    <HomeCard
      title="재무 알림"
      count={total}
      accent="var(--cd-primary)"
      href="/finance"
      hrefLabel="재무 보드"
      loading={w.status === "loading"}
      error={w.status === "error" ? "불러오지 못했습니다." : undefined}
      empty={w.status === "ok" && rows.length === 0 && (d?.taxDeadlines ?? []).length === 0}
      emptyText="처리할 재무 작업이 없습니다."
    >
      <div className="flex flex-col gap-1.5">
        {/* 신고·납부 기한 D-day (P7) — D-10 이내만 서버가 내려준다 */}
        {(d?.taxDeadlines ?? []).map((t) => (
          <Link
            key={`${t.kind}-${t.dueDate}`}
            href={t.kind === "vat" ? "/finance?tab=vatreturn" : "/finance?tab=withholding"}
            className="flex items-center gap-2.5 rounded-xl border cd-border-c px-3 py-2 cd-row-hover"
          >
            <span className="text-lg font-bold tabular-nums" style={{ color: t.dday <= 3 ? "var(--cd-error)" : "var(--cd-warning)", minWidth: 34, textAlign: "right" }}>
              {t.dday === 0 ? "오늘" : `D-${t.dday}`}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-semibold cd-text truncate">{t.label}</span>
              <span className="block text-[11px] cd-text-faint truncate">기한 {t.dueDate}</span>
            </span>
          </Link>
        ))}
        {rows.map((r) => (
          <Link
            key={r.key}
            href={r.href}
            className="flex items-center gap-2.5 rounded-xl border cd-border-c px-3 py-2 cd-row-hover"
          >
            <span className="text-lg font-bold tabular-nums" style={{ color: r.tone, minWidth: 34, textAlign: "right" }}>
              {r.count}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-semibold cd-text truncate">{r.label}</span>
              <span className="block text-[11px] cd-text-faint truncate">{r.hint}</span>
            </span>
          </Link>
        ))}
      </div>
    </HomeCard>
  );
}
