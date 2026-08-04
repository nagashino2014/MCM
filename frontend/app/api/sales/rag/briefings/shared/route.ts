import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listSharedBriefings, markShareRead } from "@/lib/intel/rag-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 내가 공유받은 브리핑 목록
export async function GET(req: NextRequest) {
  try {
    const actor = await requirePermission("sales.view");
    if (!actor.userId) return NextResponse.json({ briefings: [] });
    const limitRaw = Number(req.nextUrl.searchParams.get("limit"));
    const briefings = await listSharedBriefings(
      actor.userId,
      Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined
    );
    return NextResponse.json({ briefings });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 공유받은 브리핑 열람 마킹. body: { briefingId }
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("sales.view");
    const body = (await req.json().catch(() => ({}))) as { briefingId?: string };
    if (!actor.userId || !body.briefingId) {
      return NextResponse.json({ error: "briefingId가 필요합니다." }, { status: 400 });
    }
    await markShareRead(body.briefingId, actor.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
