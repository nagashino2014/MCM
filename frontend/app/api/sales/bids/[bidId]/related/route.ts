import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { findRelated, getBid } from "@/lib/bid/bid-queries";
import type { BidType } from "@/lib/scraper/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BID_TYPES: BidType[] = ["order_plan", "prior_spec", "bid_notice"];

interface Ctx {
  params: Promise<{ bidId: string }>;
}

/**
 * 공고 상세 + 같은 사업 건의 연계 공고(발주계획↔사전규격↔입찰공고).
 * 연계 키: 발주계획통합번호(orderPlanUntyNo)·입찰공고번호목록(bidNtceNoList).
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    await requirePermission("sales.view");
    const { bidId } = await ctx.params;
    const bt = req.nextUrl.searchParams.get("bidType") as BidType | null;
    const bidType: BidType = bt && BID_TYPES.includes(bt) ? bt : "bid_notice";
    const detail = await getBid(bidType, bidId);
    if (!detail) return NextResponse.json({ error: "공고를 찾을 수 없습니다." }, { status: 404 });
    const related = await findRelated(bidType, detail);
    return NextResponse.json({ detail, related });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
