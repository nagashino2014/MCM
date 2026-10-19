import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { requireBillingScope } from "@/lib/auth/billing-scope";
import { getContractOrdersStatus } from "@/lib/ieps/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // scope=dept 면 부서장 범위(billing.dept.view·수행부서 계약), 아니면 전사 현황(billing.view) — 299
    const { ids } = await requireBillingScope(req.nextUrl.searchParams);
    const year = req.nextUrl.searchParams.get("year") ?? undefined;
    return NextResponse.json(await getContractOrdersStatus(year, ids));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
