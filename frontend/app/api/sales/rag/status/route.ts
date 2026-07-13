import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getRagStatus } from "@/lib/intel/rag-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("sales.view");
    return NextResponse.json(await getRagStatus());
  } catch (err) {
    return authErrorToResponse(err);
  }
}
