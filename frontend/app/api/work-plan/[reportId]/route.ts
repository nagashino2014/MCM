import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated, requireEditor } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  deleteWorkPlanReport,
  getWorkPlanReport,
  saveWorkPlanReport,
  type WorkPlanReportInput,
} from "@/lib/work-plan/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ reportId: string }>;
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requireAuthenticated();
    const { reportId } = await ctx.params;
    const detail = await getWorkPlanReport(reportId);
    if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { reportId } = await ctx.params;
    const body = (await req.json()) as WorkPlanReportInput;
    const savedId = await saveWorkPlanReport(actor.userId, { ...body, reportId });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "work_plan_save",
      targetTable: "work_plan_reports",
      targetId: savedId,
      after: { status: body.status ?? "draft", itemCount: body.items?.length ?? 0 },
    });
    return NextResponse.json({ reportId: savedId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { reportId } = await ctx.params;
    await deleteWorkPlanReport(reportId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "work_plan_delete",
      targetTable: "work_plan_reports",
      targetId: reportId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
