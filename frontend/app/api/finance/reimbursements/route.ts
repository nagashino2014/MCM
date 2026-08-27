import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listReimbursements } from "@/lib/finance/reimbursements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 개인 경비 환급 이체 목록(?year=&month= — 결재 종결일 자연월 기준).
 * 결재 종결된 지출결의·출장보고의 개인 지출 행(법인카드 제외)을 기안자별로 집계한다.
 * 식대 불지급(withhold) 처분 행은 자동 제외되어 표시된다(마이그 203·204).
 */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const sp = new URL(req.url).searchParams;
    const year = Number(sp.get("year"));
    const month = Number(sp.get("month"));
    if (!year || !month) return NextResponse.json({ error: "year·month가 필요합니다." }, { status: 400 });
    const from = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    return NextResponse.json(await listReimbursements(from, to));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
