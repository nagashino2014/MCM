import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { deleteBriefing, getBriefing } from "@/lib/intel/rag-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ briefingId: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("sales.view");
    const { briefingId } = await ctx.params;
    const briefing = await getBriefing(briefingId);
    if (!briefing) return NextResponse.json({ error: "브리핑을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ briefing });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { briefingId } = await ctx.params;
    await deleteBriefing(briefingId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
