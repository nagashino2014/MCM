import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { parsePeriod } from "@/lib/bonus/source";
import { getStatementDetail, listStatementsOverview } from "@/lib/bonus/statements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 지급 명세 조회 — ?employeeId= 가 있으면 개별 상세(용역별 lines), 없으면 전체 명세.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("bonus.view", { fallbackRoles: ["editor"] });
    const sp = new URL(req.url).searchParams;
    const p = parsePeriod(sp.get("period") ?? "");
    if (!p) return NextResponse.json({ error: "period 형식은 YYYY-H1/H2 입니다." }, { status: 400 });
    const employeeId = sp.get("employeeId");
    if (employeeId) {
      return NextResponse.json({ detail: await getStatementDetail(p, employeeId) });
    }
    return NextResponse.json({
      overview: await listStatementsOverview(p),
      isAdmin: ctx.role === "admin",
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
