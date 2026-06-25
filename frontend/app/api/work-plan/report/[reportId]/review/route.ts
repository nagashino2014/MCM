import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { setReportReview } from "@/lib/work-plan/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ reportId: string }>;
}

// 부서장 검토 처리(반려/확인) + 의견·분류 저장.
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("work_plan.edit", { fallbackRoles: ["editor"] });
    const { reportId } = await ctx.params;
    const body = (await req.json()) as { action: "reject" | "confirm"; reviewerComment?: string | null; reviewerCommentKind?: string | null };
    if (body.action !== "reject" && body.action !== "confirm") {
      return NextResponse.json({ error: "action 은 reject|confirm 이어야 합니다." }, { status: 400 });
    }
    await setReportReview(reportId, body);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "work_plan_save",
      targetTable: "work_plan_reports",
      targetId: reportId,
      after: { review: body.action, kind: body.reviewerCommentKind ?? null },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
