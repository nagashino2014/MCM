import { NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getContractUnbilledStatus } from "@/lib/ieps/unbilled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuthenticated();
    const status = await getContractUnbilledStatus();
    return NextResponse.json(status);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
