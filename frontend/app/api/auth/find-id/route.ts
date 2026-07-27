import { NextRequest, NextResponse } from "next/server";
import { findLoginId } from "@/lib/auth/self-service";
import { clientIpFrom } from "@/lib/auth/login-throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: 아이디(사번) 찾기 — body: { name, email }. 일치 시 등록 이메일로 사번 발송(항상 동일 응답 — 열거 방지).
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: string; email?: string };
    await findLoginId(String(body.name ?? ""), String(body.email ?? ""), clientIpFrom(req));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[find-id] 실패", err);
    return NextResponse.json({ ok: true }); // 실패도 동일 응답
  }
}
