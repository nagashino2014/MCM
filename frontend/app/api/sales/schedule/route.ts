import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listActivitiesByMonth } from "@/lib/sales/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 월 단위 일정 조회(모바일 캘린더용). ?month=YYYY-MM
export async function GET(req: NextRequest) {
  try {
    await requirePermission("sales.view");
    const month = new URL(req.url).searchParams.get("month") ?? "";
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "month=YYYY-MM 형식이 필요합니다." }, { status: 400 });
    }
    const activities = await listActivitiesByMonth(month);
    return NextResponse.json({ activities });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
