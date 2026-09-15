import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";
import { employeeRankOrder, listTripLodgingRules, previewLodgingAllowance } from "@/lib/payroll/trip-allowance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET ?from&to — 본인 직급 기준 숙박출장수당 미리보기(출장보고서 기안 화면 배너).
 * 기안자 본인 직급으로만 계산한다(다른 사람 조회 불가).
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const from = req.nextUrl.searchParams.get("from") ?? "";
    const to = req.nextUrl.searchParams.get("to") ?? from;
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) return NextResponse.json({ error: "from/to 가 필요합니다." }, { status: 400 });
    const db = await getDb();
    const emp = rowsToObjects(await db.exec(`SELECT employee_id FROM users WHERE user_id = $1`, [ctx.userId]))[0];
    if (!emp?.employee_id) return NextResponse.json({ preview: null, reason: "직원 정보가 연결되어 있지 않습니다." });
    const [rules, rank] = await Promise.all([listTripLodgingRules(), employeeRankOrder(String(emp.employee_id))]);
    const preview = previewLodgingAllowance({ from, to }, rules, rank);
    return NextResponse.json({ preview, reason: preview ? null : "숙박출장수당 기준이 등록되어 있지 않습니다." });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
