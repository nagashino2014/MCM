import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getMessageDetail } from "@/lib/mail/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 메시지 상세(소유권 검증·읽음 처리).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  try {
    const ctx = await requireSession();
    const { messageId } = await params;
    const detail = await getMessageDetail(ctx.userId, messageId);
    if (!detail) return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json(detail);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
