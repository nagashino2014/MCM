import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { listReceipts } from "@/lib/mail/receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 수신 확인 — 내 보낸 메일들의 수신자별 열람 여부·시각(최신순).
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? "50");
    return NextResponse.json({ items: await listReceipts(ctx.userId, limit) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
