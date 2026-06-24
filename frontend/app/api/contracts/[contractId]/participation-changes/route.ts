import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated, requireEditor } from "@/lib/auth/guards";
import { createChange, listContractChanges, type ChangeInput } from "@/lib/staffing/changes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string }>;
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requireAuthenticated();
    const { contractId } = await ctx.params;
    return NextResponse.json({ changes: await listContractChanges(contractId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { contractId } = await ctx.params;
    const body = (await req.json()) as ChangeInput;
    if (!body.employeeId || !body.changeKind || !body.effectiveOn) {
      return NextResponse.json({ error: "인원·변동유형·발효일은 필수입니다." }, { status: 400 });
    }
    const changeId = await createChange(actor.userId, contractId, body);
    return NextResponse.json({ changeId, changes: await listContractChanges(contractId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
