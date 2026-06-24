import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession, requireEditor } from "@/lib/auth/guards";
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
    await requireSession();
    const { contractId } = await ctx.params;
    return NextResponse.json({ reports: await listServiceReports(contractId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 이 용역에 대해 작성된 업무보고 전체 삭제(계약·수행인력·공정표 원본은 보존).
export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { contractId } = await ctx.params;
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
