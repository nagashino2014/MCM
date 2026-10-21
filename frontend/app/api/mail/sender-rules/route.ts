import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { listSenderRules, setSenderRule } from "@/lib/mail/sender-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 내 발신자 자동 분류 규칙 — 보낸 사람 팝업에서 현재 지정된 분류를 표시한다.
export async function GET() {
  try {
    const ctx = await requireSession();
    return NextResponse.json({ rules: await listSenderRules(ctx.userId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 발신자 분류 지정/해제 — body: { sender, categoryId } (categoryId=null 이면 해제). 지정 시 받은편지함 기존 메일에 소급.
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json().catch(() => ({}))) as { sender?: string; categoryId?: string | null };
    try {
      const res = await setSenderRule(ctx.userId, String(body.sender ?? ""), body.categoryId ? String(body.categoryId) : null);
      return NextResponse.json({ ok: true, ...res });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  } catch (err) {
    return authErrorToResponse(err);
  }
}
