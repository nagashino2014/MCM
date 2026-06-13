import { NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getContractCollectionsStatus } from "@/lib/ieps/collections-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuthenticated();
    const status = await getContractCollectionsStatus();
    return NextResponse.json(status);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
