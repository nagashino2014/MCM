import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { updateDirectiveStatus } from "@/lib/work-plan/directives";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ directiveId: string }>;
}

// 지시 상태 변경 (부서장 확인/조치완료).
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { directiveId } = await ctx.params;
    const body = (await req.json()) as { status?: string };
    await updateDirectiveStatus(actor.userId, directiveId, body.status ?? "acknowledged");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
