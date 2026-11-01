import { requireBriefingPermission } from "@/lib/intel/briefing-api-access";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { deleteBriefing, getBriefing } from "@/lib/intel/rag-queries";
import { assertBriefingAccess } from "@/lib/intel/briefing-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ briefingId: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireBriefingPermission("view");
    const { briefingId } = await ctx.params;
    await assertBriefingAccess(briefingId, actor.userId);
    const briefing = await getBriefing(briefingId, actor.userId);
    if (!briefing) return NextResponse.json({ error: "브리핑을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ briefing });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireBriefingPermission("create");
    const { briefingId } = await ctx.params;
    const access = await assertBriefingAccess(briefingId, actor.userId, true);
    if (access.restricted) return NextResponse.json({ error: "정기 발행본은 근거 이력 보존을 위해 삭제할 수 없습니다." }, { status: 409 });
    await deleteBriefing(briefingId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
