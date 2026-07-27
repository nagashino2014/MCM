import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getApprovalInsights } from "@/lib/approval/insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 결재 인사이트(소요시간·체류·반려율·병목) — admin.
export async function GET() {
  try {
    await requirePermission("approval.manage");
    return NextResponse.json({ insights: await getApprovalInsights() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
