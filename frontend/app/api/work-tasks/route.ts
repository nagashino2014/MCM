import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { createTask } from "@/lib/work-plan/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Task 생성.
export async function POST(req: NextRequest) {
  try {
    const actor = await requireEditor();
    const body = (await req.json()) as { taskName?: string; categoryId?: string | null; startedAt?: string | null; owningDeptId?: string | null };
    const taskId = await createTask(actor.userId, {
      taskName: body.taskName ?? "",
      categoryId: body.categoryId ?? null,
      startedAt: body.startedAt ?? null,
      owningDeptId: body.owningDeptId ?? null,
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
