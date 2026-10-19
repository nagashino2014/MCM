import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { filterByVisibleProjects, resolveVisibleProjectSet } from "@/lib/auth/scope-guards";
import { loadUserAccess } from "@/lib/auth/rbac";
import { listActivitiesByMonth } from "@/lib/sales/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 월 단위 일정 조회(모바일 캘린더용). ?month=YYYY-MM
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("sales.view");
    // 가시 영업건(sales.view 범위: 전사 / 담당 부서·부서원 관계자 / 본인 관계자)만(2026-10-19 §7.7)
    const visibleProjects = resolveVisibleProjectSet(await loadUserAccess(ctx.userId), "sales.view");
    const month = new URL(req.url).searchParams.get("month") ?? "";
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "month=YYYY-MM 형식이 필요합니다." }, { status: 400 });
    }
    const activities = filterByVisibleProjects(await listActivitiesByMonth(month), visibleProjects, (r) => r.projectId);
    return NextResponse.json({ activities });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
