import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { ChatAccessError, createRoom, listRooms } from "@/lib/chat/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 사내 메신저(MSG-P0) — 내 대화방 목록. ?type=dm|group 필터.
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireSession();
    const type = req.nextUrl.searchParams.get("type");
    const rooms = await listRooms(userId, type === "dm" || type === "group" ? type : undefined);
    return NextResponse.json({ rooms });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 대화방 생성 — { userIds: string[], name?: string }. 1명=DM(기존 방 재사용), 2명+=그룹.
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireSession();
    const body = (await req.json().catch(() => null)) as { userIds?: unknown; name?: unknown } | null;
    const userIds = Array.isArray(body?.userIds) ? body.userIds.map(String) : [];
    const name = typeof body?.name === "string" ? body.name : undefined;
    const result = await createRoom(userId, userIds, name);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (err) {
    if (err instanceof ChatAccessError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}
