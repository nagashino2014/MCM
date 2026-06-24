import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { resolveVisibleContractIds } from "@/lib/auth/contract-scope";
import { listContractsForTree } from "@/lib/ieps/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("contract.view");
    const ids = await resolveVisibleContractIds(ctx.userId, "contract.view");
    const { searchParams } = new URL(req.url);
    const year = searchParams.get("year");
    const dept = searchParams.get("dept");
    return NextResponse.json(await listContractsForTree(year, dept, ids));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
