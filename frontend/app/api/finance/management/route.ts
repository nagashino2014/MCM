import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { cashFlow, profitLoss } from "@/lib/finance/management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 관리 손익·자금수지(P4) — view=pnl&year=YYYY | view=cash
export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const sp = req.nextUrl.searchParams;
    const view = sp.get("view") ?? "pnl";
    if (view === "cash") {
      return NextResponse.json(await cashFlow());
    }
    const year = sp.get("year") ?? String(new Date().getFullYear());
    if (!/^\d{4}$/.test(year)) return NextResponse.json({ error: "연도(YYYY)가 올바르지 않습니다." }, { status: 400 });
    return NextResponse.json(await profitLoss(year));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
