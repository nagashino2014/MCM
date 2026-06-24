import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { listContractsForTree } from "@/lib/ieps/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();
    const { searchParams } = new URL(req.url);
    const year = searchParams.get("year");
    const dept = searchParams.get("dept");
    return NextResponse.json(await listContractsForTree(year, dept));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
