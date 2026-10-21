import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getEmployeeLeaveRemaining } from "@/lib/approval/leave";
import { getOvertimeRates, ordinaryHourlyWages } from "@/lib/payroll/overtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 연차수당 지급 신청서 자동 채움(2026-10-21, 결재 연계 L1) — 대상자를 고르면 잔여 연차일수와 1일 통상임금을 돌려준다.
 *   · 잔여 연차 = 연차 대장(annual_leave_ledger)의 퇴사(예정)일 연도 부여−사용
 *   · 1일 통상임금 = 최신 근로계약의 통상임금 시급(ordinaryHourlyWages, 100원 단위) × 8시간
 * 임금 정보라 급여 조회 권한(payroll.view)이 있어야 한다 — 권한이 없으면 화면은 수기 입력으로 남는다.
 * GET ?employeeId=&date=YYYY-MM-DD
 */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("payroll.view", { fallbackRoles: ["admin"] });
    const employeeId = String(req.nextUrl.searchParams.get("employeeId") ?? "").trim();
    if (!employeeId) return NextResponse.json({ error: "대상자가 필요합니다." }, { status: 400 });
    const date = String(req.nextUrl.searchParams.get("date") ?? "").slice(0, 10);
    const year = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 4) : String(new Date().getFullYear());
    const leave = await getEmployeeLeaveRemaining(employeeId, year);
    const rates = await getOvertimeRates();
    const hourly = (await ordinaryHourlyWages(rates.divisorHours)).get(employeeId) ?? null;
    return NextResponse.json({
      year,
      remainingDays: leave ? Math.max(0, leave.remaining) : null,
      dailyWage: hourly != null ? hourly * 8 : null,
      basis: {
        leave: leave ? `${year}년 부여 ${leave.granted}일 − 사용 ${leave.used}일` : null,
        wage: hourly != null ? `통상시급 ${hourly.toLocaleString("ko-KR")}원 × 8시간(최신 근로계약)` : null,
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
