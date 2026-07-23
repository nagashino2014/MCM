import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listPromotion, promotionGate } from "@/lib/approval/leave-promotion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 연차촉진제도 관리 목록(admin) — 직원별 소진율·1/2차 고지 현황 + 발송 게이팅
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const year = String(req.nextUrl.searchParams.get("year") ?? new Date().getFullYear());
    return NextResponse.json({ rows: await listPromotion(year), gate: promotionGate(new Date()) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
