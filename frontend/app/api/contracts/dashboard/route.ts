import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { resolveVisibleContractIds } from "@/lib/auth/contract-scope";
import { getContractDashboardV2 } from "@/lib/ieps/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("billing.view");
    const contractIds = await resolveVisibleContractIds(ctx.userId, "billing.view");
    const sp = req.nextUrl.searchParams;
    const year = sp.get("year") ?? undefined;
    const category = sp.get("category") ?? undefined;
    return NextResponse.json(await getContractDashboardV2({ year, category, contractIds }));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
