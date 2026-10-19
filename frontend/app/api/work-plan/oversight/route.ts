import { hasGlobalScope } from "@/lib/auth/rbac";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getReporterContext } from "@/lib/work-plan/workspace";
import { listOversight } from "@/lib/work-plan/oversight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 부서장 감독 화면 — 부서별 용역 진행 현황 카드.
// meetingLabel·periodStart·periodEnd 를 함께 주면 그 발표 회차 시점의 자료로 구성한다.
// 전사 범위가 아니면 dept 파라미터를 무시하고 본인 부서로 강제한다(X-01, 2026-10-19).
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("work_plan.view");
    const params = new URL(req.url).searchParams;
    let deptId = params.get("dept") ?? "";
    if (!(await hasGlobalScope(ctx.userId, "work_plan.view"))) {
      const reporter = await getReporterContext(ctx.userId);
      deptId = reporter.deptId ?? "";
    }
    if (!deptId) return NextResponse.json({ cards: [] });
    const meetingLabel = params.get("meetingLabel") ?? "";
    const periodStart = params.get("periodStart") ?? "";
    const periodEnd = params.get("periodEnd") ?? "";
    const session = meetingLabel && periodStart && periodEnd ? { meetingLabel, periodStart, periodEnd } : undefined;
    return NextResponse.json({ cards: await listOversight(deptId, session) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
