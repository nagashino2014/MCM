import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getReporterContext, listConfirmedReports } from "@/lib/work-plan/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Merging 대상 — 부서장이 확인한 보고 목록. non-admin 은 본인 부서로 강제.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("work_plan.view");
    const paramDept = new URL(req.url).searchParams.get("dept") ?? "";
    let deptId = paramDept;
    if (ctx.role !== "admin") {
      const reporter = await getReporterContext(ctx.userId);
      deptId = reporter.deptId ?? "";
    }
    if (!deptId) return NextResponse.json({ reports: [] });
    return NextResponse.json({ reports: await listConfirmedReports(deptId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
