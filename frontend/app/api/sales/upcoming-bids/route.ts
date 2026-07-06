import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listUpcomingBids } from "@/lib/sales/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("sales.view");
    const bids = await listUpcomingBids();
    return NextResponse.json({ bids });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
