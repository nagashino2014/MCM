import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { ChatAccessError, markRead } from "@/lib/chat/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 읽음 커서 전진 — { messageId: number }. 뒤로는 이동하지 않는다(GREATEST).
export async function POST(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  try {
    const { userId } = await requireSession();
    const roomId = Number((await ctx.params).roomId);
    if (!Number.isInteger(roomId) || roomId <= 0) {
      return NextResponse.json({ error: "잘못된 대화방입니다." }, { status: 400 });
    }
    const body = (await req.json().catch(() => null)) as { messageId?: unknown } | null;
    const messageId = typeof body?.messageId === "number" ? body.messageId : NaN;
    if (!Number.isInteger(messageId) || messageId <= 0) {
      return NextResponse.json({ error: "messageId 가 필요합니다." }, { status: 400 });
    }
    await markRead(roomId, userId, messageId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ChatAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return authErrorToResponse(err);
  }
}
