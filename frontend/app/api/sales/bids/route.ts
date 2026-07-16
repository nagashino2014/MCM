import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listBids, listMethodOptions } from "@/lib/bid/bid-queries";
import { getCategory } from "@/lib/bid/category-store";
import type { BidType } from "@/lib/scraper/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BID_TYPES: BidType[] = ["order_plan", "prior_spec", "bid_notice"];

/** 공공입찰 목록 — ?bidType=order_plan|prior_spec|bid_notice + 필터(기간·금액·지역권·계약방법·분류)/페이지네이션. */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("sales.view");
    const sp = req.nextUrl.searchParams;
    const bt = sp.get("bidType") as BidType | null;
    const bidType: BidType = bt && BID_TYPES.includes(bt) ? bt : "bid_notice";
    const limit = Number(sp.get("limit"));
    const offset = Number(sp.get("offset"));
    const budgetMin = Number(sp.get("budgetMin"));
    const budgetMax = Number(sp.get("budgetMax"));
    // 분류 필터 — categoryId 로 키워드 조회해 title OR 검색
    let categoryKeywords: string[] | undefined;
    const categoryId = sp.get("categoryId");
    if (categoryId) {
      const cat = await getCategory(categoryId);
      if (cat?.keywords?.length) categoryKeywords = cat.keywords;
    }
    const result = await listBids({
      bidType,
      q: sp.get("q") || undefined,
      orgName: sp.get("orgName") || undefined,
      method: sp.get("method") || undefined,
      workType: sp.get("workType") || undefined,
      deadlineFrom: sp.get("deadlineFrom") || undefined,
      deadlineTo: sp.get("deadlineTo") || undefined,
      postedFrom: sp.get("postedFrom") || undefined,
      postedTo: sp.get("postedTo") || undefined,
      budgetMin: Number.isFinite(budgetMin) && budgetMin > 0 ? budgetMin : undefined,
      budgetMax: Number.isFinite(budgetMax) && budgetMax > 0 ? budgetMax : undefined,
      regionGroup: sp.get("regionGroup") || undefined,
      categoryKeywords,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      offset: Number.isFinite(offset) && offset >= 0 ? offset : undefined,
    });
    // 계약방법 필터 옵션 — 해당 종류의 실데이터 distinct(발주계획엔 적격심사가 없는 등 종류별 상이).
    const methods = await listMethodOptions(bidType);
    return NextResponse.json({ ...result, methods });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
