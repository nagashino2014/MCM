import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { requireIssueScope } from "@/lib/auth/scope-guards";
import { deleteIssue, setIssueResponse } from "@/lib/work-plan/issues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ issueId: string }>;
}

// 부서장 대응방안 입력 + 상태 갱신.
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const { issueId } = await ctx.params;
    const actor = await requireIssueScope("work_plan.edit", issueId); // (2026-10-19 §7.7)
    const body = (await req.json()) as { responsePlan?: string | null; status?: string };
    await setIssueResponse(actor.userId, issueId, body.responsePlan ?? null, body.status ?? "in_progress");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const { issueId } = await ctx.params;
    await requireIssueScope("work_plan.edit", issueId);
    await deleteIssue(issueId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
