import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { forcedDeptId } from "@/lib/auth/scope-guards";
import { listDeptTasks } from "@/lib/work-plan/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 부서 감독 — 부서 Task 카드. non-admin 은 dept 파라미터 무시하고 본인 부서로 강제.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("work_plan.view");
    const paramDept = new URL(req.url).searchParams.get("dept") ?? "";
    let deptId = paramDept;
    // 전사면 요청 부서 그대로, 아니면 허용 부서(주 소속 + 겸직, 300) 안의 요청 부서 — 밖이면 주 소속
    deptId = await forcedDeptId(ctx.userId, "work_plan.view", deptId);
    if (!deptId) return NextResponse.json({ tasks: [] });
    return NextResponse.json({ tasks: await listDeptTasks(deptId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
