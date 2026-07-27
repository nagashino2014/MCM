import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { ensureMailbox, updateSignature } from "@/lib/mail/mailbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 현재 사용자의 메일함 정보(없으면 email_local 기반으로 생성) — 주소·표시이름·서명.
export async function GET() {
  try {
    const ctx = await requireSession();
    const mailbox = await ensureMailbox(ctx.userId);
    return NextResponse.json({
      address: mailbox.address,
      displayName: mailbox.displayName,
      signatureHtml: mailbox.signatureHtml,
      status: mailbox.status,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PATCH: 내 서명 저장 — body: { signatureHtml }
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json().catch(() => ({}))) as { signatureHtml?: string };
    await updateSignature(ctx.userId, String(body.signatureHtml ?? ""));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
