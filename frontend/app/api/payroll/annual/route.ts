import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listYearNames } from "@/lib/payroll/queries";
import { getAnnualStatement } from "@/lib/payroll/annual-statement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 직원별 연간 추이 — ?year=&name= 피벗(+인적사항·퇴직금 적립/추계) / name 생략 시 해당 연도 성명 목록만. */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("payroll.view");
    const sp = new URL(req.url).searchParams;
    const year = Number(sp.get("year"));
    if (!Number.isInteger(year)) {
      return NextResponse.json({ error: "year 가 필요합니다." }, { status: 400 });
    }
    const name = sp.get("name");
    if (!name) {
      return NextResponse.json({ names: await listYearNames(year) });
    }
    return NextResponse.json(await getAnnualStatement(year, name));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
