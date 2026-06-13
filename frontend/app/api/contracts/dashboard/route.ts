import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getContractDashboardV2 } from "@/lib/ieps/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();
    const sp = req.nextUrl.searchParams;
    const year = sp.get("year") ?? undefined;
    const category = sp.get("category") ?? undefined;
    return NextResponse.json(await getContractDashboardV2({ year, category }));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
