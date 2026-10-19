import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { requireBillingScope } from "@/lib/auth/billing-scope";
import { getContractUnbilledStatus } from "@/lib/ieps/unbilled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // scope=dept 면 부서장 범위(billing.dept.view·수행부서 계약), 아니면 전사 현황(billing.view) — 299
    const { ids } = await requireBillingScope(req.nextUrl.searchParams);
    const status = await getContractUnbilledStatus(ids);
    return NextResponse.json(status);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
