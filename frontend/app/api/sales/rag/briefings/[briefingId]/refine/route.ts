import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { refineBriefing } from "@/lib/intel/rag-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface RouteContext {
  params: Promise<{ briefingId: string }>;
}

// 브리핑 추가 분석(보강). body: { instruction: string }
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { briefingId } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { instruction?: string };
    const instruction = (body.instruction ?? "").trim();
    if (!instruction) return NextResponse.json({ error: "추가 분석 요청 내용을 입력하세요." }, { status: 400 });
    const briefing = await refineBriefing(briefingId, instruction, actor.userId || null);
    return NextResponse.json({ briefing });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
