import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { listMyPayslips } from "@/lib/payroll/statements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 본인 급여명세서 목록(발행분) — 홈 수신함 카드 */
export async function GET() {
  try {
    const ctx = await requireSession();
    return NextResponse.json(await listMyPayslips(ctx.userId));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
