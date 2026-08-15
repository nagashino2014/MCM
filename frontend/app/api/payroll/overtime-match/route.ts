import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { matchOvertimeRequests, ordinaryHourlyWages, overtimeAmounts } from "@/lib/payroll/overtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 초과근무 신청 × 근태 대조 내역 (?year=&month=) — 급여대장 산정 근거 확인용.
 * 신청 시간대와 실제 재실 시간대의 교집합만 인정하며, 미근무(absent)·조기퇴근(short)을 그대로 보여준다.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const sp = new URL(req.url).searchParams;
    const year = Number(sp.get("year"));
    const month = Number(sp.get("month"));
    if (!year || !month) return NextResponse.json({ error: "year·month가 필요합니다." }, { status: 400 });

    const [rows, amounts, hourly] = await Promise.all([
      matchOvertimeRequests(year, month),
      overtimeAmounts(year, month),
      ordinaryHourlyWages(),
    ]);
    const byEmployee = [...amounts.entries()]
      .filter(([, v]) => v.amount > 0 || v.cappedMin > 0)
      .map(([employeeId, v]) => ({
        employeeId,
        name: rows.find((r) => r.employeeId === employeeId)?.name ?? "",
        hourlyWage: hourly.get(employeeId) ?? null,
        ...v,
      }))
      .sort((a, b) => b.amount - a.amount);

    return NextResponse.json({
      year, month, rows, byEmployee,
      summary: {
        docs: rows.length,
        absent: rows.filter((r) => r.verdict === "absent").length,
        short: rows.filter((r) => r.verdict === "short").length,
        noRecord: rows.filter((r) => r.verdict === "no-record").length,
        requestedHours: Math.round((rows.reduce((a, r) => a + r.reqMin, 0) / 60) * 10) / 10,
        actualHours: Math.round((rows.reduce((a, r) => a + r.actualMin, 0) / 60) * 10) / 10,
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
