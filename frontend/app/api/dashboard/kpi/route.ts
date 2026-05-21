import { NextResponse } from "next/server";
import { getKpiSummary } from "@/lib/ieps/queries";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuthenticated();
    const summary = await getKpiSummary();
    return NextResponse.json(summary);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
