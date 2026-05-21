import { NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getContractDashboard } from "@/lib/ieps/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuthenticated();
    return NextResponse.json(await getContractDashboard());
  } catch (err) {
    return authErrorToResponse(err);
  }
}
