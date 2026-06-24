import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { resolveVisibleContractIds } from "@/lib/auth/contract-scope";
import { getContractUnbilledStatus } from "@/lib/ieps/unbilled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requirePermission("billing.view");
    const ids = await resolveVisibleContractIds(ctx.userId, "billing.view");
    const status = await getContractUnbilledStatus(ids);
    return NextResponse.json(status);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
