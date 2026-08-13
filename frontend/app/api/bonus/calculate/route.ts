import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { parsePeriod } from "@/lib/bonus/source";
import { calculateBonus } from "@/lib/bonus/statements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 일괄산정 — 반기 statements 전량 재생성(관리자 전용). */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const body = await req.json();
    const p = parsePeriod(String(body?.period ?? ""));
    if (!p) return NextResponse.json({ error: "period 형식은 YYYY-H1/H2 입니다." }, { status: 400 });
    const summary = await calculateBonus(ctx.userId, p);
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
