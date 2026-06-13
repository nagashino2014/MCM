import { NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getContractReceivablesStatus } from "@/lib/ieps/receivables";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuthenticated();
    const status = await getContractReceivablesStatus();
    return NextResponse.json(status);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
