import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { loadChangeContractId, requireContractDeptScope } from "@/lib/auth/scope-guards";
import { deleteChange } from "@/lib/staffing/changes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ changeId: string }>;
}

export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const { changeId } = await ctx.params;
    // 변동 행의 계약 수행부서 범위 확인(2026-10-19 §7.7) — 해석 불가 id 는 403
    const contractId = await loadChangeContractId(changeId);
    await requireContractDeptScope("staffing.changes.record", [contractId ?? "__missing__"]);
    await deleteChange(changeId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
