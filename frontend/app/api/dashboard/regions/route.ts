import { NextResponse } from "next/server";
import { getRegionDistribution } from "@/lib/ieps/queries";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuthenticated();
    const data = await getRegionDistribution();
    return NextResponse.json(data);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
