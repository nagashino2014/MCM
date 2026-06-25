import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { createTaskIssue, listTaskIssues, type IssueInput } from "@/lib/work-plan/issues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("work_plan.view");
    const { taskId } = await ctx.params;
    return NextResponse.json({ issues: await listTaskIssues(taskId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("work_plan.edit", { fallbackRoles: ["editor"] });
    const { taskId } = await ctx.params;
    const body = (await req.json()) as IssueInput;
    const issueId = await createTaskIssue(actor.userId, taskId, body);
    return NextResponse.json({ issueId, issues: await listTaskIssues(taskId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
