import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getAttendanceSettings, listDailyForWeek, listMyWeekly } from "@/lib/adt/queries";
import { DEFAULT_ATTENDANCE_SETTINGS } from "@/lib/adt/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 내 근태(모바일 M5) — 최근 주별 근무·초과근무 요약 + (선택) 특정 주의 일별 기록.
 *
 * 관리자 화면(/api/approval/attendance)은 approval.manage 로 전 직원을 보지만,
 * 이 라우트는 **본인 것만** 돌려주므로 approval.view 로 충분하다.
 * ?week=YYYY-MM-DD 를 주면 그 주의 일별 출퇴근까지 함께 준다.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const { adtEmpNo, weeks } = await listMyWeekly(ctx.userId, 8);

    const week = req.nextUrl.searchParams.get("week") ?? weeks[0]?.weekStart ?? null;
    const daily = adtEmpNo && week ? await listDailyForWeek(adtEmpNo, week) : [];

    // 주 40h/52h 기준선은 사규 설정에서 읽는다(하드코딩하면 규정 변경 시 어긋난다).
    // 52h = 소정 40h + 연장 인정한도 12h.
    let s = DEFAULT_ATTENDANCE_SETTINGS;
    try {
      s = await getAttendanceSettings();
    } catch {
      // 설정 조회 실패 시 사규 기본값을 쓴다.
    }
    const limits = {
      weeklyStandardMinutes: s.weeklyStandardMinutes,
      weeklyLimitMinutes: s.weeklyStandardMinutes + s.weeklyOvertimeLimitMinutes,
      weeklyOvertimeLimitMinutes: s.weeklyOvertimeLimitMinutes,
    };

    return NextResponse.json({ weeks, week, daily, limits });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
