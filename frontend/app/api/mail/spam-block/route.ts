import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { blockSender } from "@/lib/mail/spam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: 발신자 스팸 차단 — body: { sender, retroactive } (retroactive=받은편지함 소급 이동)
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json().catch(() => ({}))) as { sender?: string; retroactive?: boolean };
    const res = await blockSender(ctx.userId, String(body.sender ?? ""), body.retroactive === true);
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
