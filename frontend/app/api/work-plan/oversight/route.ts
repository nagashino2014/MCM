import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { listOversight } from "@/lib/work-plan/oversight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 부서장 감독 화면 — 부서별 용역 진행 현황 카드.
export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();
    const deptId = new URL(req.url).searchParams.get("dept") ?? "";
    if (!deptId) return NextResponse.json({ cards: [] });
    return NextResponse.json({ cards: await listOversight(deptId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
