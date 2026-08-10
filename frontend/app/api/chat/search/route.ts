import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { searchMessages } from "@/lib/chat/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 메시지 본문 검색(MSG-P2) — ?q= (2자 이상), 내가 속한 방 전체 최신순.
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireSession();
    const q = req.nextUrl.searchParams.get("q") ?? "";
    const hits = await searchMessages(userId, q);
    return NextResponse.json({ hits });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
