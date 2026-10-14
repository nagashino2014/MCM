import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { sendItemToChat } from "@/lib/todo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

// 메신저로 보내기(§10) — body { roomId, message? }. 텍스트+링크(카드형은 2차).
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { itemId } = await context.params;
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(await sendItemToChat(ctx.userId, itemId, body ?? {}));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
