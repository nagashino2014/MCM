import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated, requireEditor } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { listTaskParticipants, saveTaskParticipants } from "@/lib/work-plan/task-participants";
import type { ServiceParticipantInput } from "@/lib/staffing/participants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requireAuthenticated();
    const { taskId } = await ctx.params;
    return NextResponse.json({ participants: await listTaskParticipants(taskId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { taskId } = await ctx.params;
    const body = (await req.json()) as { participants?: ServiceParticipantInput[] };
    const participants = Array.isArray(body.participants) ? body.participants : [];
    await saveTaskParticipants(taskId, participants);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "contract_update",
      targetTable: "work_task_participants",
      targetId: taskId,
      after: { count: participants.length },
    });
    return NextResponse.json({ participants: await listTaskParticipants(taskId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
