import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listBids, listMethodOptions } from "@/lib/bid/bid-queries";
import { getCategory } from "@/lib/bid/category-store";
import { computeCell, DEFAULT_COLUMNS, getViewColumns } from "@/lib/bid/view-config";
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
    // 커스텀 열 구성(076) — 없으면 기본 열. 정렬은 열의 parts[0] 기준(클라이언트가 전달).
    const columns = (await getViewColumns(bidType)) ?? DEFAULT_COLUMNS[bidType];
    const sortField = sp.get("sortField") || "";
    const sortDir = sp.get("sortDir") === "asc" ? ("asc" as const) : ("desc" as const);
    const sortNumeric = sp.get("sortNumeric") === "1";

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
      ...(sortField ? { sort: { field: sortField, dir: sortDir, numeric: sortNumeric } } : {}),
      withRaw: true,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      offset: Number.isFinite(offset) && offset >= 0 ? offset : undefined,
    });
    // 행별 커스텀 열 값 계산(표준 컬럼 + raw 병합) — raw 원문은 응답에서 제외.
    const items = result.items.map((r) => {
      const merged: Record<string, unknown> = {
        ...(r.raw ?? {}),
        org_name: r.orgName, title: r.title, budget: r.budget, posted_at: r.postedAt,
        deadline: r.deadline, method: r.method, work_type: r.workType, category: r.category,
        url: r.url, external_id: r.externalId,
      };
      const cells = columns.map((c) => computeCell(merged, c));
      const { raw: _raw, ...rest } = r;
      return { ...rest, cells };
    });
    // 계약방법 필터 옵션 — 해당 종류의 실데이터 distinct(발주계획엔 적격심사가 없는 등 종류별 상이).
    const methods = await listMethodOptions(bidType);
    return NextResponse.json({ items, total: result.total, methods, columns });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
