import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { listTaskReports } from "@/lib/work-plan/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

// 보고 Log = 특정 Task의 보고 목록.
export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requireSession();
    const { taskId } = await ctx.params;
    return NextResponse.json({ reports: await listTaskReports(taskId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
