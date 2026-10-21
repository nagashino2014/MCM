import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { addMailContact } from "@/lib/mail/sender-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: 내 메일 주소록에 추가 — body: { address, name? }. 메일 쓰기 받는 사람 자동완성에 함께 나온다.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json().catch(() => ({}))) as { address?: string; name?: string | null };
    try {
      await addMailContact(ctx.userId, String(body.address ?? ""), body.name ?? null);
      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  } catch (err) {
    return authErrorToResponse(err);
  }
}
