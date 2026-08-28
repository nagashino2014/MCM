import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { listSeveranceSettlements, updateSeveranceSettlement } from "@/lib/approval/severance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 퇴직 정산 목록(207) — 연차수당 승인 건이 자동 적재된 퇴사자별 카드.
export async function GET() {
  try {
    await requirePermission("finance.view");
    return NextResponse.json({ settlements: await listSeveranceSettlements() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PATCH: {settleId, severanceAmount?, note?, status?} — 퇴직금 수기 입력·정산 완료 처리.
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requirePermission("finance.manage");
    const body = (await req.json().catch(() => ({}))) as {
      settleId?: string;
      severanceAmount?: number | null;
      note?: string | null;
      status?: "draft" | "confirmed";
    };
    if (!body.settleId) return NextResponse.json({ error: "settleId가 필요합니다." }, { status: 400 });
    await updateSeveranceSettlement({
      settleId: body.settleId,
      severanceAmount: body.severanceAmount != null ? Math.round(Number(body.severanceAmount)) : null,
      note: body.note ?? null,
      status: body.status,
      actorUserId: actor.userId,
    });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "severance_settlement_update",
      targetTable: "severance_settlements",
      targetId: body.settleId,
      after: { severanceAmount: body.severanceAmount, status: body.status },
    });
    return NextResponse.json({ settlements: await listSeveranceSettlements() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
