"use client";

import { ClipboardList, AlertTriangle } from "lucide-react";
import { HomeCard, HomeRow } from "../HomeCard";
import { useHomeWidget } from "../useHomeWidget";

interface ReboundItem {
  reportId: string;
  subjectLabel: string | null;
  serviceType: string | null;
  reviewerComment: string | null;
  reviewerCommentKind: string | null;
  periodEnd: string;
}
interface ThisWeekItem {
  contractId: string;
  contractTitle: string;
  serviceType: string | null;
  lastReportDate: string | null;
}
interface WorkPlanTodo {
  rebound: { count: number; items: ReboundItem[] };
  thisWeek: { count: number; items: ThisWeekItem[] };
}

const KIND_LABEL: Record<string, string> = {
  supplement: "보완 요구",
  correction: "정정 요청",
  amend: "의견 첨삭",
};

/** H9 — 업무보고 할 일(반려·보완 재작성 + 이번 주 작성 대상). */
export function WorkPlanTodoCard() {
  const w = useHomeWidget<WorkPlanTodo>("/api/home/work-plan-todo");
  if (w.status === "forbidden") return null;
  const data = w.status === "ok" ? w.data : null;
  const reboundCount = data?.rebound.count ?? 0;
  const thisWeekCount = data?.thisWeek.count ?? 0;
  const totalCount = reboundCount + thisWeekCount;

  return (
    <HomeCard
      icon={<ClipboardList className="w-4 h-4" />}
      title="업무보고 할 일"
      count={totalCount}
      accent="#13DEB9"
      href="/work-plan"
      loading={w.status === "loading"}
      error={w.status === "error" ? w.message : undefined}
      empty={w.status === "ok" && totalCount === 0}
      emptyText="처리할 업무보고가 없습니다."
    >
      <div className="flex flex-col gap-3">
        {reboundCount > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-bold flex items-center gap-1" style={{ color: "#FA896B" }}>
              <AlertTriangle className="w-3 h-3" />
              반려·보완 재작성 {reboundCount}건
            </p>
            <ul className="flex flex-col gap-1.5">
              {data?.rebound.items.map((r) => (
                <li key={r.reportId}>
                  <HomeRow href="/work-plan">
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] cd-text truncate">
                        {r.subjectLabel ?? "제목 없음"}
                      </span>
                      {r.reviewerComment && (
                        <span className="block text-[11px] cd-text-faint truncate">{r.reviewerComment}</span>
                      )}
                    </span>
                    {r.reviewerCommentKind && (
                      <span
                        className="text-[10px] rounded px-1.5 py-0.5 shrink-0"
                        style={{ background: "color-mix(in srgb, #FA896B 16%, transparent)", color: "#FA896B" }}
                      >
                        {KIND_LABEL[r.reviewerCommentKind] ?? r.reviewerCommentKind}
                      </span>
                    )}
                  </HomeRow>
                </li>
              ))}
            </ul>
          </div>
        )}
        {thisWeekCount > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-bold cd-text-muted">이번 주 작성 대상 {thisWeekCount}건</p>
            <ul className="flex flex-col gap-1.5">
              {data?.thisWeek.items.map((t) => (
                <li key={t.contractId}>
                  <HomeRow href="/work-plan">
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] cd-text truncate">{t.contractTitle}</span>
                      {t.serviceType && (
                        <span className="block text-[11px] cd-text-faint truncate">{t.serviceType}</span>
                      )}
                    </span>
                    <span className="text-[10px] cd-text-faint shrink-0">
                      {t.lastReportDate ? `최근 ${t.lastReportDate.slice(5)}` : "미보고"}
                    </span>
                  </HomeRow>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </HomeCard>
  );
}
