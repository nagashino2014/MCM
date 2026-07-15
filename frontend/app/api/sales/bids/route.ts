import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listBids } from "@/lib/bid/bid-queries";
import type { BidType } from "@/lib/scraper/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BID_TYPES: BidType[] = ["order_plan", "prior_spec", "bid_notice"];

/** 공공입찰 목록 — ?bidType=order_plan|prior_spec|bid_notice + 필터/페이지네이션. */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("sales.view");
    const sp = req.nextUrl.searchParams;
    const bt = sp.get("bidType") as BidType | null;
    const bidType: BidType = bt && BID_TYPES.includes(bt) ? bt : "bid_notice";
    const limit = Number(sp.get("limit"));
    const offset = Number(sp.get("offset"));
    const result = await listBids({
      bidType,
      q: sp.get("q") || undefined,
      orgName: sp.get("orgName") || undefined,
      method: sp.get("method") || undefined,
      workType: sp.get("workType") || undefined,
      deadlineFrom: sp.get("deadlineFrom") || undefined,
      deadlineTo: sp.get("deadlineTo") || undefined,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      offset: Number.isFinite(offset) && offset >= 0 ? offset : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
