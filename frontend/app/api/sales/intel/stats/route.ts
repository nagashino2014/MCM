import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getIntelStats, listIntelCollectState } from "@/lib/intel/intel-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 수집현황 통계 — 기간(수집일 created_at 기준) 내 소스별 수집·채택 + 월별 추이 + 세부 조합. */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("sales.view");
    const sp = req.nextUrl.searchParams;
    const today = new Date().toISOString().slice(0, 10);
    const from = DATE_RE.test(sp.get("from") ?? "") ? String(sp.get("from")) : `${today.slice(0, 7)}-01`;
    const to = DATE_RE.test(sp.get("to") ?? "") ? String(sp.get("to")) : today;
    const [stats, collectState] = await Promise.all([getIntelStats(from, to), listIntelCollectState()]);
    return NextResponse.json({ from, to, ...stats, collectState });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
