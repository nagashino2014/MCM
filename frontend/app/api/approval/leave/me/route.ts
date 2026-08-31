import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getMyLeaveOverview } from "@/lib/approval/leave";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 내 휴가(/approval/my-leave) — 본인 연차·특별휴가 현황.
 *
 * 관리자 화면(/api/approval/leave)은 approval.manage 로 전 직원을 보지만,
 * 이 라우트는 users.user_id → employee_id 스코프라 **본인 것만** 돌려준다 → approval.view 로 충분.
 * ?year=YYYY (기본 올해 KST).
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const thisYear = new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear();
    const yearParam = req.nextUrl.searchParams.get("year");
    const year = yearParam && /^\d{4}$/.test(yearParam) ? yearParam : String(thisYear);
    return NextResponse.json(await getMyLeaveOverview(ctx.userId, year));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
