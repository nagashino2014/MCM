import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getWeeklyOvertimeUsage } from "@/lib/approval/overtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 초과근무 신청 기안용 — ?date=YYYY-MM-DD 가 속한 주의 본인 초과근무 사용량.
 * (기존 신청 합 + 근태 실적 + 주 한도) — 기안 화면이 신청 시간을 더해 12h 초과 경고를 띄운다.
 * ?excludeDocId= 로 수정 중인 문서 자신을 합산에서 제외한다.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const date = req.nextUrl.searchParams.get("date") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "date(YYYY-MM-DD)가 필요합니다." }, { status: 400 });
    }
    const usage = await getWeeklyOvertimeUsage(ctx.userId, date, req.nextUrl.searchParams.get("excludeDocId"));
    return NextResponse.json({ usage });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
