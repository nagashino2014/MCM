import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { resolveVisibleContractIds } from "@/lib/auth/contract-scope";
import { getContractReceivablesStatus } from "@/lib/ieps/receivables";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requirePermission("billing.view");
    const ids = await resolveVisibleContractIds(ctx.userId, "billing.view");
    const status = await getContractReceivablesStatus(ids);
    return NextResponse.json(status);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
