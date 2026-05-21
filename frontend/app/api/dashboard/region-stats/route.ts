import { NextResponse } from "next/server";
import { getRegionStats } from "@/lib/ieps/queries";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAuthenticated();
    const { searchParams } = new URL(request.url);
    const sido = searchParams.get("sido");
    const sigungu = searchParams.get("sigungu");
    const limitParam = searchParams.get("limit");
    const facilityLimit =
      limitParam === "all" ? null : limitParam ? Math.min(Math.max(Number(limitParam) || 30, 1), 500) : undefined;
    const data = await getRegionStats(
      sido && sido.length ? sido : null,
      sigungu && sigungu.length ? sigungu : null,
      { facilityLimit }
    );
    return NextResponse.json(data);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
