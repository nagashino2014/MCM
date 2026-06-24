import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { deleteChange } from "@/lib/staffing/changes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ changeId: string }>;
}

export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    await requireEditor();
    const { changeId } = await ctx.params;
    await deleteChange(changeId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
