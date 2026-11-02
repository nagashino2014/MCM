import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listPurchaseContractsForTree } from "@/lib/contracts/purchase/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 매입 계약 원장 트리(331) — purchase.view 는 전사 범위만 지원하므로 가시 범위 필터가 없다. */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("purchase.view");
    const { searchParams } = new URL(req.url);
    return NextResponse.json(await listPurchaseContractsForTree(searchParams.get("year")));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
