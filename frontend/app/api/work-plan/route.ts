import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { forcedDeptId, requireReportScope } from "@/lib/auth/scope-guards";
import { hasGlobalScope } from "@/lib/auth/rbac";
import { recordAuditLog } from "@/lib/auth/audit";
import { listOrganizationSnapshot } from "@/lib/admin/organization";
import { getReporterContext } from "@/lib/work-plan/workspace";
import {
  listWorkPlanReports,
  listWorkPlanTemplates,
  saveWorkPlanReport,
  type WorkPlanReportInput,
} from "@/lib/work-plan/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("work_plan.view");
    const { searchParams } = new URL(req.url);
    let deptId = searchParams.get("dept");
    const status = searchParams.get("status");
    // 전사 범위(work_plan.view scope=all)가 아니면 dept 파라미터를 무시하고 본인 부서로 고정한다
    // (부서장·사원의 self_dept 는 target 없는 가드를 통과하므로 목록에서 직접 거른다 — 2026-10-19 X-01 후속).
    if (!(await hasGlobalScope(ctx.userId, "work_plan.view"))) {
      const reporter = await getReporterContext(ctx.userId);
      deptId = reporter.deptId ?? "__none__";
    }
    const [reports, templates, organization] = await Promise.all([
      listWorkPlanReports({ deptId, status }),
      listWorkPlanTemplates(),
      listOrganizationSnapshot(),
    ]);
    return NextResponse.json({ reports, templates, organization });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("work_plan.edit", { fallbackRoles: ["editor"] });
    const body = (await req.json()) as WorkPlanReportInput;
    // 기존 보고서는 그 보고서 범위, 신규는 요청 부서를 범위로 보정(전사 아니면 본인 부서) — 2026-10-19 §7.7
    if (body.reportId) await requireReportScope("work_plan.edit", String(body.reportId));
    else body.deptId = await forcedDeptId(actor.userId, "work_plan.edit", body.deptId);
    const reportId = await saveWorkPlanReport(actor.userId, body);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "work_plan_save",
      targetTable: "work_plan_reports",
      targetId: reportId,
      after: { status: body.status ?? "draft", itemCount: body.items?.length ?? 0 },
    });
    return NextResponse.json({ reportId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
