import { NextRequest, NextResponse } from "next/server";
import { confirmPasswordReset } from "@/lib/auth/self-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: 비밀번호 재설정 확정 — body: { token, password }.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { token?: string; password?: string };
    const res = await confirmPasswordReset(String(body.token ?? ""), String(body.password ?? ""));
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[reset-confirm] 실패", err);
    return NextResponse.json({ error: "처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
