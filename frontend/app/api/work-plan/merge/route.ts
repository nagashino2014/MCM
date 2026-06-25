import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { createConsolidated, listStaffInputItems, type MergeInput } from "@/lib/work-plan/merge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission("work_plan.view");
    const sp = new URL(req.url).searchParams;
    const deptId = sp.get("dept") ?? "";
    const periodStart = sp.get("periodStart") ?? "";
    const periodEnd = sp.get("periodEnd") ?? "";
    if (!deptId || !periodStart || !periodEnd) return NextResponse.json({ items: [] });
    return NextResponse.json({ items: await listStaffInputItems(deptId, periodStart, periodEnd) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("work_plan.merge", { fallbackRoles: ["editor"] });
    const body = (await req.json()) as MergeInput;
    if (!body.deptId || !body.periodStart || !body.periodEnd || !Array.isArray(body.sourceItemIds) || body.sourceItemIds.length === 0) {
      return NextResponse.json({ error: "부서·기간·항목 선택이 필요합니다." }, { status: 400 });
    }
    const reportId = await createConsolidated(actor.userId, body);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "work_plan_save",
      targetTable: "work_plan_reports",
      targetId: reportId,
      after: { merged: body.sourceItemIds.length },
    });
    return NextResponse.json({ reportId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
