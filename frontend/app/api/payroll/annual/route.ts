import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { getEmployeeAnnual, listYearNames } from "@/lib/payroll/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 직원별 연간 추이 — ?year=&name= 피벗 / name 생략 시 해당 연도 성명 목록만. */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const sp = new URL(req.url).searchParams;
    const year = Number(sp.get("year"));
    if (!Number.isInteger(year)) {
      return NextResponse.json({ error: "year 가 필요합니다." }, { status: 400 });
    }
    const name = sp.get("name");
    if (!name) {
      return NextResponse.json({ names: await listYearNames(year) });
    }
    return NextResponse.json(await getEmployeeAnnual(year, name));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
