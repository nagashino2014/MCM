import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { markPayslipViewed } from "@/lib/payroll/statements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 본인 급여명세서 열람 기록(수신 확인) — 내 급여 화면에서 미리보기를 열 때 호출. 최초 1회만 시각을 남긴다. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  try {
    const ctx = await requireSession();
    const { entryId } = await params;
    return NextResponse.json(await markPayslipViewed(ctx.userId, entryId));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
