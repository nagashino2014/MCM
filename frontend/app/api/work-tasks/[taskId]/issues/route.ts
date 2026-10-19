import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { requireTaskScope } from "@/lib/auth/scope-guards";
import { createTaskIssue, listTaskIssues, type IssueInput } from "@/lib/work-plan/issues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    const { taskId } = await ctx.params;
    await requireTaskScope("work_plan.view", taskId); // Task 담당 부서·생성자 범위(2026-10-19 §7.7)
    return NextResponse.json({ issues: await listTaskIssues(taskId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { taskId } = await ctx.params;
    const actor = await requireTaskScope("work_plan.edit", taskId);
    const body = (await req.json()) as IssueInput;
    const issueId = await createTaskIssue(actor.userId, taskId, body);
    return NextResponse.json({ issueId, issues: await listTaskIssues(taskId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
