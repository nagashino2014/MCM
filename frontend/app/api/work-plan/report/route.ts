import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { requireReportScope, requireSubjectScope } from "@/lib/auth/scope-guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { saveReport, type SaveReportInput } from "@/lib/work-plan/workspace";
import { pushReportSubmitted } from "@/lib/work-plan/push-notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 용역/Task 보고 저장(신규/수정). reportId 유무로 분기.
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("work_plan.edit", { fallbackRoles: ["editor"] });
    const body = (await req.json()) as SaveReportInput;
    // 기존 보고서는 그 보고서 범위, 신규는 주제(용역 계약 수행부서 | Task 담당부서) 범위 — 본인 작성(self)도 허용(2026-10-19 §7.7)
    if (body.reportId) await requireReportScope("work_plan.edit", String(body.reportId));
    else if (body.subjectId) await requireSubjectScope("work_plan.edit", body.subjectKind === "task" ? "task" : "contract", String(body.subjectId), actor.userId);
    const reportId = await saveReport(actor.userId, body);
    // 제출(감독 저장 제외) → 부서장 앱 푸시(work.report). 실패해도 저장 흐름은 막지 않는다.
    if (body.status === "submitted" && !body.fromReview) void pushReportSubmitted(reportId, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: body.reportId ? "contract_update" : "contract_create",
      targetTable: "work_plan_reports",
      targetId: reportId,
      after: { subjectKind: body.subjectKind, subjectId: body.subjectId, status: body.status ?? "draft" },
    });
    return NextResponse.json({ reportId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
