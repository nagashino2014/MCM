import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getYearOverview } from "@/lib/payroll/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 연간 현황 — ?year= 그해 대장에 등장한 직원 전부(퇴사자 포함)의 항목별 연간 합계. */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("payroll.view");
    const year = Number(new URL(req.url).searchParams.get("year"));
    if (!Number.isInteger(year)) {
      return NextResponse.json({ error: "year 가 필요합니다." }, { status: 400 });
    }
    return NextResponse.json(await getYearOverview(year));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
