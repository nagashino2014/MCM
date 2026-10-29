import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { filterByVisibleProjects, resolveVisibleProjectSet } from "@/lib/auth/scope-guards";
import { loadUserAccess } from "@/lib/auth/rbac";
import { computeBoardStats } from "@/lib/sales/board";
import { listPendingProgressReports, listUpcomingActivities } from "@/lib/sales/queries";
import { listVisibleSalesProjects } from "@/lib/sales/visible-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Salesboard 상단 KPI 띠·하단 영업 현황(W4~W7) 집계(2026-10-29). 목록 필터와 무관하게 '보이는 영업건 전체' 기준.
// 영업건 범위는 목록(/api/sales/projects)과 같고, 담당자 현황의 일정·미보고 수는 다가오는 일정·경과 보고 탭과 같은 모집단이다.
export async function GET() {
  try {
    const ctx = await requirePermission("sales.view");
    const access = await loadUserAccess(ctx.userId);
    const visibleSet = resolveVisibleProjectSet(access, "sales.view");
    const [projects, upcoming, pending] = await Promise.all([
      listVisibleSalesProjects(access),
      listUpcomingActivities(),
      listPendingProgressReports(),
    ]);
    const stats = computeBoardStats(
      projects,
      filterByVisibleProjects(upcoming, visibleSet, (r) => r.projectId),
      filterByVisibleProjects(pending, visibleSet, (r) => r.projectId)
    );
    return NextResponse.json({ stats });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
