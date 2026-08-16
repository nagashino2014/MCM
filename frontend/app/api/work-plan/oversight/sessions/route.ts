import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listOversightSessions } from "@/lib/work-plan/oversight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 발표 모드 회차 목록 — 부서별 주간회의·간부간담회 보고 회차(최신순).
export async function GET(req: NextRequest) {
  try {
    await requirePermission("work_plan.view");
    const deptId = new URL(req.url).searchParams.get("dept") ?? "";
    if (!deptId) return NextResponse.json({ sessions: [] });
    return NextResponse.json({ sessions: await listOversightSessions(deptId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
