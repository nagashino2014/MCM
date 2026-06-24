import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor, requireSession } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { getReporterContext } from "@/lib/work-plan/workspace";
import { mergeConfirmedReports } from "@/lib/work-plan/merge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 확인 완료 보고들을 묶어 부서 통합 보고 생성. non-admin 은 본인 부서로 강제.
export async function POST(req: NextRequest) {
  try {
    const actor = await requireEditor();
    const body = (await req.json()) as { deptId?: string; reportIds?: string[] };
    if (!Array.isArray(body.reportIds) || body.reportIds.length === 0) {
      return NextResponse.json({ error: "통합할 보고를 선택하세요." }, { status: 400 });
    }
    let deptId = body.deptId ?? "";
    if (actor.role !== "admin") {
      const session = await requireSession();
      const reporter = await getReporterContext(session.userId);
      deptId = reporter.deptId ?? "";
    }
    if (!deptId) return NextResponse.json({ error: "부서를 확인할 수 없습니다." }, { status: 400 });
    const reportId = await mergeConfirmedReports(actor.userId, deptId, body.reportIds);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "work_plan_save",
      targetTable: "work_plan_reports",
      targetId: reportId,
      after: { mergedConfirmed: body.reportIds.length },
    });
    return NextResponse.json({ reportId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
