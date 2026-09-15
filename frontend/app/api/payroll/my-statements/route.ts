import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { listMyPayslips } from "@/lib/payroll/statements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 본인 급여명세서 목록 — 홈 수신함 카드(최근 24개월) / ?year= 내 급여 화면(해당 연도 전체) */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const year = Number(req.nextUrl.searchParams.get("year") ?? 0) || undefined;
    return NextResponse.json(await listMyPayslips(ctx.userId, { year }));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
