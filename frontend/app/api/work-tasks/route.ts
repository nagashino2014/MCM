import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { forcedDeptId } from "@/lib/auth/scope-guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { createTask } from "@/lib/work-plan/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Task 생성.
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("work_plan.edit", { fallbackRoles: ["editor"] });
    const body = (await req.json()) as { taskName?: string; categoryId?: string | null; startedAt?: string | null; owningDeptId?: string | null };
    const taskId = await createTask(actor.userId, {
      taskName: body.taskName ?? "",
      categoryId: body.categoryId ?? null,
      startedAt: body.startedAt ?? null,
      // 전사 범위가 아니면 요청 부서를 무시하고 본인 부서로(2026-10-19 §7.7)
      owningDeptId: (await forcedDeptId(actor.userId, "work_plan.edit", body.owningDeptId ?? null)) || null,
    });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "contract_create",
      targetTable: "work_tasks",
      targetId: taskId,
      after: { taskName: body.taskName, categoryId: body.categoryId },
    });
    return NextResponse.json({ taskId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
