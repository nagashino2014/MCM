import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getReporterContext, listDeptMembers } from "@/lib/work-plan/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 수행인력 필터용 부서원 목록. non-admin 은 본인 부서로 강제.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const paramDept = new URL(req.url).searchParams.get("dept") ?? "";
    let deptId = paramDept;
    if (ctx.role !== "admin") {
      const reporter = await getReporterContext(ctx.userId);
      deptId = reporter.deptId ?? "";
    }
    if (!deptId) return NextResponse.json({ members: [] });
    return NextResponse.json({ members: await listDeptMembers(deptId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
