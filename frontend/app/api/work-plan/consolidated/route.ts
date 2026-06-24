import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { listConsolidatedReports } from "@/lib/work-plan/merge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 부서 통합 보고 목록(임원 검토).
export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();
    const deptId = new URL(req.url).searchParams.get("dept") ?? "";
    if (!deptId) return NextResponse.json({ reports: [] });
    return NextResponse.json({ reports: await listConsolidatedReports(deptId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
