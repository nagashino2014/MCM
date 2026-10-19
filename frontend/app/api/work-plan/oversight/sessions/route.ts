import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { forcedDeptId } from "@/lib/auth/scope-guards";
import { listOversightSessions } from "@/lib/work-plan/oversight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 발표 모드 회차 목록 — 부서별 주간회의·간부간담회 보고 회차(최신순).
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("work_plan.view");
    // 전사 범위가 아니면 dept 파라미터를 무시하고 본인 부서로 고정(2026-10-19 §7.7)
    const deptId = await forcedDeptId(ctx.userId, "work_plan.view", new URL(req.url).searchParams.get("dept") ?? "");
    if (!deptId) return NextResponse.json({ sessions: [] });
    return NextResponse.json({ sessions: await listOversightSessions(deptId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
