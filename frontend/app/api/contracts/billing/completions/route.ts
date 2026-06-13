import { NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getContractCompletionsStatus } from "@/lib/ieps/completions-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuthenticated();
    const status = await getContractCompletionsStatus();
    return NextResponse.json(status);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
