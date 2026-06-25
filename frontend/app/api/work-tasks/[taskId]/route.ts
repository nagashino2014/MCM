import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { deleteTask, getTask } from "@/lib/work-plan/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("work_plan.view");
    const { taskId } = await ctx.params;
    const task = await getTask(taskId);
    if (!task) return NextResponse.json({ error: "Task를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ task });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// Task 완전 삭제. (남용 방지를 위한 계정별 권한 제한은 후속 RBAC 단계에서 적용 예정)
export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("work_plan.edit", { fallbackRoles: ["editor"] });
    const { taskId } = await ctx.params;
    await deleteTask(taskId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "contract_delete",
      targetTable: "work_tasks",
      targetId: taskId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
