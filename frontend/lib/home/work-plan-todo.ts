/**
 * 홈 대시보드 H9 "업무보고 할 일" 집계.
 * - rebound: 반려·보완 요구된 재작성 건(내 것) — workspace.listReboundReports 재사용(review_status='rejected').
 * - thisWeek: 이번 주(KST 월~금) 아직 보고하지 않은 담당 용역 — listMyServices 의 최근 보고일로 경량 판정.
 */
import { listMyServices, listReboundReports } from "@/lib/work-plan/workspace";

/** 이번 주(KST) 월요일·금요일 날짜(YYYY-MM-DD). 서버(UTC)에서 +9h 보정 후 요일 계산. */
function kstThisWeek(): { monday: string; friday: string } {
  const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
  const dow = nowKst.getUTCDay() || 7; // 0=일 → 7, 1=월 .. 7=일
  const monday = new Date(nowKst);
  monday.setUTCDate(nowKst.getUTCDate() - (dow - 1));
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);
  return { monday: monday.toISOString().slice(0, 10), friday: friday.toISOString().slice(0, 10) };
}

export interface WorkPlanReboundItem {
  reportId: string;
  subjectLabel: string | null;
  serviceType: string | null;
  reviewerComment: string | null;
  reviewerCommentKind: string | null;
  periodEnd: string;
}

export interface WorkPlanThisWeekItem {
  contractId: string;
  contractTitle: string;
  serviceType: string | null;
  lastReportDate: string | null;
}

export interface WorkPlanTodo {
  rebound: { count: number; items: WorkPlanReboundItem[] };
  thisWeek: { count: number; items: WorkPlanThisWeekItem[] };
}

export async function getWorkPlanTodo(userId: string): Promise<WorkPlanTodo> {
  const { monday } = kstThisWeek();
  const [rebound, myServices] = await Promise.all([
    listReboundReports(userId),
    listMyServices(userId),
  ]);

  // 이번 주 작성 대상 = 진행 중(미완료) 담당 용역 중 최근 제출 보고일이 이번 주 월요일 이전인 것.
  const pending = myServices.filter(
    (s) => !s.completed && (!s.lastReportDate || s.lastReportDate < monday)
  );

  return {
    rebound: {
      count: rebound.length,
      items: rebound.slice(0, 5).map((r) => ({
        reportId: r.reportId,
        subjectLabel: r.subjectLabel,
        serviceType: r.serviceType,
        reviewerComment: r.reviewerComment,
        reviewerCommentKind: r.reviewerCommentKind,
        periodEnd: r.periodEnd,
      })),
    },
    thisWeek: {
      count: pending.length,
      items: pending.slice(0, 5).map((s) => ({
        contractId: s.contractId,
        contractTitle: s.contractTitle,
        serviceType: s.serviceType,
        lastReportDate: s.lastReportDate,
      })),
    },
  };
}
