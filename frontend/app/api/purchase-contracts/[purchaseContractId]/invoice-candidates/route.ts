import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listPurchaseInvoiceCandidates } from "@/lib/contracts/purchase/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ purchaseContractId: string }>;
}

/** 홈택스 매입 세금계산서 후보(331) — ?milestoneId= 를 주면 그 단계 금액에 가까운 순으로 정렬한다. */
export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const { purchaseContractId } = await ctx.params;
    await requirePermission("purchase.view");
    const milestoneId = req.nextUrl.searchParams.get("milestoneId")?.trim() || null;
    return NextResponse.json(await listPurchaseInvoiceCandidates(purchaseContractId, milestoneId));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
