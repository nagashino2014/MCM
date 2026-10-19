import { hasGlobalScope } from "@/lib/auth/rbac";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getReporterContext } from "@/lib/work-plan/workspace";
import { listConsolidatedReports } from "@/lib/work-plan/merge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 부서 통합 보고 목록(임원 검토). 전사 범위가 아니면 dept 파라미터를 무시하고 본인 부서로 강제(X-01, 2026-10-19).
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("work_plan.view");
    let deptId = new URL(req.url).searchParams.get("dept") ?? "";
    if (!(await hasGlobalScope(ctx.userId, "work_plan.view"))) {
      const reporter = await getReporterContext(ctx.userId);
      deptId = reporter.deptId ?? "";
    }
    if (!deptId) return NextResponse.json({ reports: [] });
    return NextResponse.json({ reports: await listConsolidatedReports(deptId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
