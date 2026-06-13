import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getContractOrdersStatus } from "@/lib/ieps/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();
    const year = req.nextUrl.searchParams.get("year") ?? undefined;
    return NextResponse.json(await getContractOrdersStatus(year));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
