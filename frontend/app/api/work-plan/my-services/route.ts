import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getReporterContext, listMyServices } from "@/lib/work-plan/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 진행용역 = 로그인 사용자가 수행인력으로 매핑된 계약 목록 + 보고자/부서 컨텍스트.
export async function GET() {
  try {
    const ctx = await requirePermission("work_plan.view");
    const [services, reporter] = await Promise.all([
      listMyServices(ctx.userId),
      getReporterContext(ctx.userId),
    ]);
    return NextResponse.json({ services, reporter });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
