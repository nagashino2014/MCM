import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { requireTaskScope } from "@/lib/auth/scope-guards";
import { listTaskReports } from "@/lib/work-plan/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

// 보고 Log = 특정 Task의 보고 목록.
export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    const { taskId } = await ctx.params;
    await requireTaskScope("work_plan.view", taskId); // Task 담당 부서·생성자 범위(2026-10-19 §7.7)
    return NextResponse.json({ reports: await listTaskReports(taskId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
