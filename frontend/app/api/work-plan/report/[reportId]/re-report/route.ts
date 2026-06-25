import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { submitReReport } from "@/lib/work-plan/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ reportId: string }>;
}

// 부서장 재보고(임원 지시에 대한 답변). 재보고 1회 제한.
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("work_plan.edit", { fallbackRoles: ["editor"] });
    const { reportId } = await ctx.params;
    const body = (await req.json()) as { directorResponse?: string | null };
    await submitReReport(reportId, body.directorResponse ?? null);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "work_plan_save",
      targetTable: "work_plan_reports",
      targetId: reportId,
      after: { reReport: true },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
