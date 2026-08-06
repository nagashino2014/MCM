import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { buildQuoteReport } from "@/lib/quote/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 견적 수주 분석 리포트(Q5) — 기간(YYYY-MM) 필터. 권한: approval.manage(기준 관리 화면 전용).
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.manage");
    const sp = req.nextUrl.searchParams;
    const report = await buildQuoteReport({ from: sp.get("from"), to: sp.get("to") });
    return NextResponse.json({ report });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
