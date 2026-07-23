import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getLeaveCharts } from "@/lib/approval/leave";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 직원별 휴가 관리 차트 — 월별 연차 사용·월별 소진율·연도별 연차 외(admin)
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const year = String(req.nextUrl.searchParams.get("year") ?? new Date().getFullYear());
    return NextResponse.json({ charts: await getLeaveCharts(year) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
