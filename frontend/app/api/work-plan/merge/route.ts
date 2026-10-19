import { hasGlobalScope } from "@/lib/auth/rbac";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { assertItemsInScope, forcedDeptId } from "@/lib/auth/scope-guards";
import { loadUserAccess } from "@/lib/auth/rbac";
import { recordAuditLog } from "@/lib/auth/audit";
import { getReporterContext } from "@/lib/work-plan/workspace";
import { createConsolidated, listStaffInputItems, type MergeInput } from "@/lib/work-plan/merge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 머지 대상 항목 — 전사 범위가 아니면 dept 파라미터를 무시하고 본인 부서로 강제(X-01, 2026-10-19).
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("work_plan.view");
    const sp = new URL(req.url).searchParams;
    let deptId = sp.get("dept") ?? "";
    const periodStart = sp.get("periodStart") ?? "";
    const periodEnd = sp.get("periodEnd") ?? "";
    if (!(await hasGlobalScope(ctx.userId, "work_plan.view"))) {
      const reporter = await getReporterContext(ctx.userId);
      deptId = reporter.deptId ?? "";
    }
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
    // 통합 보고는 본인 부서 범위로만(전사 제외) · 원천 항목이 모두 범위 안인지 확인(2026-10-19 §7.7)
    body.deptId = await forcedDeptId(actor.userId, "work_plan.merge", body.deptId);
    await assertItemsInScope(await loadUserAccess(actor.userId), "work_plan.merge", body.sourceItemIds);
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
