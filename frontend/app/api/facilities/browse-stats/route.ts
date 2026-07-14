import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getFacilityBrowseStats } from "@/lib/ieps/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 모바일 사업장 탐색 초기 화면용 카운트 — 업종별 + 용역/영업 진행 중 사업장 수.
export async function GET() {
  try {
    await requirePermission("facility.view");
    const stats = await getFacilityBrowseStats();
    return NextResponse.json(stats);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
