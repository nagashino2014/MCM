import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { myPayrollSummary } from "@/lib/payroll/statements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 본인 급여 수령액 집계(월별·연도별·항목별) — 내 급여 화면. ?year= 미지정 시 최근 연도. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const year = Number(req.nextUrl.searchParams.get("year") ?? 0) || undefined;
    return NextResponse.json(await myPayrollSummary(ctx.userId, year));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
