import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getFailureReasons } from "@/lib/ieps/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();
    const { searchParams } = new URL(req.url);
    const daysRaw = searchParams.get("days");
    const days = daysRaw ? parseInt(daysRaw, 10) : 7;
    const reasons = await getFailureReasons(
      Number.isFinite(days) && days > 0 ? days : 7,
      10
    );
    return NextResponse.json({ days, reasons });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
