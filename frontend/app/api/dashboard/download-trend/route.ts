import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getDownloadTrend } from "@/lib/ieps/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();
    const { searchParams } = new URL(req.url);
    const daysRaw = searchParams.get("days");
    const days = daysRaw ? parseInt(daysRaw, 10) : 7;
    const trend = await getDownloadTrend(Number.isFinite(days) && days > 0 ? days : 7);
    return NextResponse.json({ days, buckets: trend });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
