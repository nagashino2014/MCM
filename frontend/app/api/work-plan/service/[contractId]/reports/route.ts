import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { requireSubjectScope } from "@/lib/auth/scope-guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { deleteServiceReports, listServiceReports } from "@/lib/work-plan/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string }>;
}

// 보고 Log = 특정 용역의 보고 목록.
export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    const { contractId } = await ctx.params;
    await requireSubjectScope("work_plan.view", "contract", contractId); // 계약 수행부서 범위(2026-10-19 §7.7)
    return NextResponse.json({ reports: await listServiceReports(contractId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 이 용역에 대해 작성된 업무보고 전체 삭제(계약·수행인력·공정표 원본은 보존).
export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const { contractId } = await ctx.params;
    const actor = await requireSubjectScope("work_plan.edit", "contract", contractId);
    const deleted = await deleteServiceReports(contractId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "contract_delete",
      targetTable: "work_plan_reports",
      targetId: contractId,
      after: { deletedReports: deleted },
    });
    return NextResponse.json({ ok: true, deleted });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
