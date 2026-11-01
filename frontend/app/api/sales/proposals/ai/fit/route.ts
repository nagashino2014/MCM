import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { proposalAi } from "@/lib/proposal/ai/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

// POST: AI 제안이 쪽을 넘칠 때 문구 줄이기 { items: [{ key, text, maxChars }], subject } → 줄인 글(실패 시 규칙 축약)
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as { items?: unknown; subject?: unknown };
    const items = Array.isArray(body.items) ? (body.items as Array<{ key: string; text: string; maxChars: number }>) : [];
    if (!items.length) return NextResponse.json({ error: "줄일 글이 없습니다." }, { status: 400 });
    const result = await proposalAi.fit(items, { userId: actor.userId, subject: typeof body.subject === "string" ? body.subject : "proposal" });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
