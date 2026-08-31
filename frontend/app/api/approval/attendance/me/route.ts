import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import {
  getAttendanceSettings,
  listDailyForWeek,
  listMyAttendanceMonths,
  listMyWeekly,
  listMyMonthlyTrend,
  listMyMonthlyLateDays,
  listMyMealWarnings,
  listMyAbsenceRequests,
} from "@/lib/adt/queries";
import { myPayBasis, overtimePay } from "@/lib/payroll/overtime";
import { DEFAULT_ATTENDANCE_SETTINGS } from "@/lib/adt/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 내 근태(모바일 M5) — 최근 주별 근무·초과근무 요약 + (선택) 특정 주의 일별 기록.
 *
 * 관리자 화면(/api/approval/attendance)은 approval.manage 로 전 직원을 보지만,
 * 이 라우트는 **본인 것만** 돌려주므로 approval.view 로 충분하다.
 * ?week=YYYY-MM-DD 를 주면 그 주의 일별 출퇴근까지 함께 준다.
 * ?month=YYYY-MM 을 주면 그 달에 시작하는 주만 돌려준다(모바일 연/월 탐색 — 2026-08-20).
 *   응답의 months 는 기록이 있는 전체 월 목록(최신순)이다.
 * ?full=1 (웹 "내 근태·초과근무" 화면) 이면 월별 추이·지각·식대 경고·결근사유서 요청까지 함께 준다
 *   — 모바일 M5 는 기존 필드만 쓰므로 응답은 추가만 하고 기존 형태는 바꾸지 않는다.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const month = req.nextUrl.searchParams.get("month");
    const full = req.nextUrl.searchParams.get("full") === "1";
    const year = String(month ?? "").slice(0, 4) || String(new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear());
    const [{ adtEmpNo, weeks }, months, trend, lateMonthly, mealWarnings, absenceRequests, pay] = await Promise.all([
      listMyWeekly(ctx.userId, 8, month),
      listMyAttendanceMonths(ctx.userId),
      full ? listMyMonthlyTrend(ctx.userId, 12) : Promise.resolve([]),
      full ? listMyMonthlyLateDays(ctx.userId, 12) : Promise.resolve([]),
      full ? listMyMealWarnings(ctx.userId, year) : Promise.resolve([]),
      full ? listMyAbsenceRequests(ctx.userId) : Promise.resolve([]),
      full ? myPayBasis(ctx.userId) : Promise.resolve(null),
    ]);

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

    if (!full) return NextResponse.json({ weeks, week, daily, limits, months });
    // 수당 환산 — 급여 엔진과 같은 규칙(통상시급 100원 반올림·overtimePay 10원 절사)을 서버에서 적용한다.
    const wage = pay?.hourlyWage ?? null;
    const rates = pay ? { rateDay: pay.rateDay, rateNight: pay.rateNight, divisorHours: pay.divisorHours } : null;
    const estPay = (dayMin: number, nightMin: number) =>
      wage != null && rates ? overtimePay(wage, dayMin, nightMin, rates) : null;
    const trendWithPay = trend.map((t) => ({ ...t, estimatedPay: estPay(t.overtimeDayMinutes, t.overtimeNightMinutes) }));
    const weeksWithPay = weeks.map((w) => ({ ...w, estimatedPay: estPay(w.overtimeDayMinutes, w.overtimeNightMinutes) }));
    return NextResponse.json({
      weeks: weeksWithPay,
      week,
      daily,
      limits,
      months,
      trend: trendWithPay,
      lateMonthly,
      mealWarnings,
      absenceRequests,
      pay,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
