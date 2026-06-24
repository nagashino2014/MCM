import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { resolveVisibleContractIds } from "@/lib/auth/contract-scope";
import { getContractOrdersStatus } from "@/lib/ieps/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("billing.view");
    const ids = await resolveVisibleContractIds(ctx.userId, "billing.view");
    const year = req.nextUrl.searchParams.get("year") ?? undefined;
    return NextResponse.json(await getContractOrdersStatus(year, ids));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
