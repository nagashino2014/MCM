import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { listMyNotices } from "@/lib/approval/leave-promotion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 수신 문서함(홈) — 세션 직원 본인이 받은 연차 고지 목록.
// 직원 매핑이 없는 계정(관리자 등)은 빈 배열 → 위젯이 숨겨진다.
export async function GET() {
  try {
    const ctx = await requireSession();
    return NextResponse.json({ notices: await listMyNotices(ctx.userId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
