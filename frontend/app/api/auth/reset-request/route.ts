import { NextRequest, NextResponse } from "next/server";
import { requestPasswordReset } from "@/lib/auth/self-service";
import { clientIpFrom } from "@/lib/auth/login-throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: 비밀번호 재설정 요청 — body: { loginId, email }. 일치 시 재설정 링크 발송(항상 동일 응답).
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { loginId?: string; email?: string };
    await requestPasswordReset(String(body.loginId ?? ""), String(body.email ?? ""), clientIpFrom(req));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[reset-request] 실패", err);
    return NextResponse.json({ ok: true });
  }
}
