import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { resolveVisibleContractIds } from "@/lib/auth/contract-scope";
import {
  getDashboardCounterpartyDetail,
  searchDashboardCounterparties,
} from "@/lib/ieps/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("billing.view");
    const visible = await resolveVisibleContractIds(ctx.userId, "billing.view"); // null = 전사(2026-10-19 §7.7)
    const sp = req.nextUrl.searchParams;
    const q = sp.get("q");
    const facilityId = sp.get("facilityId");
    if (facilityId) {
      const year = sp.get("year") ?? String(new Date().getFullYear());
      const detail = await getDashboardCounterpartyDetail(facilityId, year, visible);
      if (!detail) {
        return NextResponse.json({ error: "counterparty not found" }, { status: 404 });
      }
      return NextResponse.json(detail);
    }
    if (q != null && q.trim().length > 0) {
      return NextResponse.json({ items: await searchDashboardCounterparties(q.trim(), visible) });
    }
    return NextResponse.json({ error: "q or facilityId is required" }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
