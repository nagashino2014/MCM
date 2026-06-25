import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listReboundReports } from "@/lib/work-plan/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 재보고 대상 — 로그인 작성자에게 반려된 보고 목록.
export async function GET() {
  try {
    const ctx = await requirePermission("work_plan.view");
    return NextResponse.json({ reports: await listReboundReports(ctx.userId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
