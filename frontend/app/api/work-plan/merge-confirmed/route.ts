import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { assertReportsInScope, forcedDeptId } from "@/lib/auth/scope-guards";
import { loadUserAccess } from "@/lib/auth/rbac";
import { recordAuditLog } from "@/lib/auth/audit";
import { mergeConfirmedReports } from "@/lib/work-plan/merge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 확인 완료 보고들을 묶어 부서 통합 보고 생성. non-admin 은 본인 부서로 강제.
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("work_plan.merge", { fallbackRoles: ["editor"] });
    const body = (await req.json()) as { deptId?: string; reportIds?: string[] };
    if (!Array.isArray(body.reportIds) || body.reportIds.length === 0) {
      return NextResponse.json({ error: "통합할 보고를 선택하세요." }, { status: 400 });
    }
    let deptId = body.deptId ?? "";
    // 전사면 요청 부서 그대로, 아니면 허용 부서(주 소속 + 겸직, 300) 안의 요청 부서 — 밖이면 주 소속
    deptId = await forcedDeptId(actor.userId, "work_plan.view", deptId);
    if (!deptId) return NextResponse.json({ error: "부서를 확인할 수 없습니다." }, { status: 400 });
    await assertReportsInScope(await loadUserAccess(actor.userId), "work_plan.merge", body.reportIds); // 타 부서 보고서 혼입 차단(2026-10-19 §7.7)
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
