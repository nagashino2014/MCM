import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getServiceReport } from "@/lib/work-plan/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ reportId: string }>;
}

// 단일 용역 보고 상세(편집용).
export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requireSession();
    const { reportId } = await ctx.params;
    const report = await getServiceReport(reportId);
    if (!report) return NextResponse.json({ error: "보고를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ report });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
