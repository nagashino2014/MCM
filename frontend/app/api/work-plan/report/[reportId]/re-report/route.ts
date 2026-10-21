import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { requireReportScope } from "@/lib/auth/scope-guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { submitReReport } from "@/lib/work-plan/workspace";
import { pushReReported } from "@/lib/work-plan/push-notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ reportId: string }>;
}

// 부서장 재보고(임원 지시에 대한 답변). 지시 건마다 1회(답하지 않은 지시가 있어야 함, F-32).
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { reportId } = await ctx.params;
    const actor = await requireReportScope("work_plan.edit", reportId); // (2026-10-19 §7.7)
    const body = (await req.json()) as { directorResponse?: string | null };
    await submitReReport(reportId, body.directorResponse ?? null);
    void pushReReported(reportId); // 지시 임원 앱 푸시(work.report)
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
