import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { listOrganizationSnapshot } from "@/lib/admin/organization";
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
    await requirePermission("work_plan.view");
    const { searchParams } = new URL(req.url);
    const deptId = searchParams.get("dept");
    const status = searchParams.get("status");
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
