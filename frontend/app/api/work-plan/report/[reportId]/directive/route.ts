import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { setExecDirective } from "@/lib/work-plan/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ reportId: string }>;
}

// 임원 지시 하달.
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("work_plan.directive", { fallbackRoles: ["editor"] });
    const { reportId } = await ctx.params;
    const body = (await req.json()) as { kind: string; message?: string | null; contractId?: string | null };
    if (!body.kind) return NextResponse.json({ error: "지시 분류가 필요합니다." }, { status: 400 });
    await setExecDirective(actor.userId, reportId, body);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "work_plan_save",
      targetTable: "work_plan_directives",
      targetId: reportId,
      after: { exec: body.kind },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
