import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { applyPresetToTask, listTaskStages } from "@/lib/work-plan/task-stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

// 프리셋을 Task 공정표로 적용(기존 교체).
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { taskId } = await ctx.params;
    const body = (await req.json()) as { presetId?: string };
    if (!body.presetId) {
      return NextResponse.json({ error: "presetId가 필요합니다." }, { status: 400 });
    }
    await applyPresetToTask(taskId, body.presetId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "contract_update",
      targetTable: "work_task_process_stages",
      targetId: taskId,
      after: { presetId: body.presetId },
    });
    return NextResponse.json({ stages: await listTaskStages(taskId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
