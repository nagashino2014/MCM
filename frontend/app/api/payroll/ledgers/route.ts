import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { recordAccessLog } from "@/lib/auth/access-log";
import { getLedgerDetail, listLedgerMonths } from "@/lib/payroll/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 급여대장 — ?ledgerId= 상세 / 무파라미터 = 전체 대장 목록. 급여는 admin 전용(§8-4). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const ledgerId = new URL(req.url).searchParams.get("ledgerId");
    if (!ledgerId) {
      return NextResponse.json({ ledgers: await listLedgerMonths() });
    }
    const detail = await getLedgerDetail(ledgerId);
    if (!detail) return NextResponse.json({ error: "대장을 찾을 수 없습니다." }, { status: 404 });
    // 접속기록(PR-P1) — 급여대장 상세(전 직원 급여) 열람.
    await recordAccessLog({ actorUserId: ctx.userId, action: "view", targetKind: "payroll", targetId: ledgerId });
    return NextResponse.json(detail);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
