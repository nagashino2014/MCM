import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { ChatAccessError, inviteMembers, leaveRoom } from "@/lib/chat/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseRoomId(v: string): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// 그룹 초대(MSG-P2) — { userIds: string[] }.
export async function POST(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  try {
    const { userId } = await requireSession();
    const roomId = parseRoomId((await ctx.params).roomId);
    if (!roomId) return NextResponse.json({ error: "잘못된 대화방입니다." }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { userIds?: unknown } | null;
    const userIds = Array.isArray(body?.userIds) ? body.userIds.map(String) : [];
    await inviteMembers(roomId, userId, userIds);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ChatAccessError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}

// 나가기 — 그룹은 system 메시지, DM 은 조용히(재개 시 복귀).
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  try {
    const { userId } = await requireSession();
    const roomId = parseRoomId((await ctx.params).roomId);
    if (!roomId) return NextResponse.json({ error: "잘못된 대화방입니다." }, { status: 400 });
    await leaveRoom(roomId, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ChatAccessError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}
