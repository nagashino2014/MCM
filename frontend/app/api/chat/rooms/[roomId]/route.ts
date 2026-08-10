import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { ChatAccessError, getRoomDetail, renameRoom, setRoomMuted } from "@/lib/chat/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseRoomId(v: string): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// 방 상세(MSG-P2) — 멤버 목록 + 내 알림 설정.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  try {
    const { userId } = await requireSession();
    const roomId = parseRoomId((await ctx.params).roomId);
    if (!roomId) return NextResponse.json({ error: "잘못된 대화방입니다." }, { status: 400 });
    const room = await getRoomDetail(roomId, userId);
    if (!room) return NextResponse.json({ error: "대화방 멤버가 아닙니다." }, { status: 403 });
    return NextResponse.json({ room });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 방 설정 변경 — { name?: string(그룹 이름), muted?: boolean(내 알림) }.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  try {
    const { userId } = await requireSession();
    const roomId = parseRoomId((await ctx.params).roomId);
    if (!roomId) return NextResponse.json({ error: "잘못된 대화방입니다." }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { name?: unknown; muted?: unknown } | null;
    if (typeof body?.name === "string") await renameRoom(roomId, userId, body.name);
    if (typeof body?.muted === "boolean") await setRoomMuted(roomId, userId, body.muted);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ChatAccessError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}
