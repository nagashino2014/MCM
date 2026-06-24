import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated, requireEditor } from "@/lib/auth/guards";
import { createIssue, listContractIssues, type IssueInput } from "@/lib/work-plan/issues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string }>;
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requireAuthenticated();
    const { contractId } = await ctx.params;
    return NextResponse.json({ issues: await listContractIssues(contractId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { contractId } = await ctx.params;
    const body = (await req.json()) as IssueInput;
    const issueId = await createIssue(actor.userId, contractId, body);
    return NextResponse.json({ issueId, issues: await listContractIssues(contractId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
