import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { requireTaskScope } from "@/lib/auth/scope-guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { listTaskStages, saveTaskStages } from "@/lib/work-plan/task-stages";
import type { ContractStageInput } from "@/lib/contracts/process-stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    const { taskId } = await ctx.params;
    await requireTaskScope("work_plan.view", taskId); // Task 담당 부서·생성자 범위(2026-10-19 §7.7)
    return NextResponse.json({ stages: await listTaskStages(taskId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const { taskId } = await ctx.params;
    const actor = await requireTaskScope("work_plan.edit", taskId);
    const body = (await req.json()) as { stages?: ContractStageInput[] };
    const stages = Array.isArray(body.stages) ? body.stages : [];
    await saveTaskStages(taskId, stages);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "contract_update",
      targetTable: "work_task_process_stages",
      targetId: taskId,
      after: { count: stages.length },
    });
    return NextResponse.json({ stages: await listTaskStages(taskId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
