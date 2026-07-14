import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { resolveVisibleContractIds } from "@/lib/auth/contract-scope";
import { getBillingSummary } from "@/lib/home/billing-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** H7 — 최근 2개월 발행/수금/미수금 요약. billing.view + RBAC 계약 스코프. */
export async function GET() {
  try {
    const ctx = await requirePermission("billing.view");
    const contractIds = await resolveVisibleContractIds(ctx.userId, "billing.view");
    const summary = await getBillingSummary(contractIds);
    return NextResponse.json(summary);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
