import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string; changeId: string }>;
}

/**
 * 변경 이벤트의 차수 지정(278) — 변경 이력 카드에서 지난 이벤트를 기존 차수에 넣거나(amendmentId)
 * 정보 정정으로 돌린다(amendmentId: null). 새 차수는 변경계약서 업로드로만 생긴다(documents route).
 */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const { contractId, changeId } = await ctx.params;
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"], target: { contractId } });
    const body = await req.json().catch(() => ({}));
    const amendmentId = body?.amendmentId ? String(body.amendmentId) : null;
    const now = new Date().toISOString();

    const result = await withDbWrite(async (db) => {
      const events = rowsToObjects(
        await db.exec("SELECT amendment_id FROM contract_change_events WHERE change_id = $1 AND contract_id = $2", [
          changeId,
          contractId,
        ])
      );
      if (events.length === 0) return { status: 404, error: "변경 이벤트를 찾을 수 없습니다." };
      if (amendmentId) {
        const round = rowsToObjects(
          await db.exec("SELECT 1 FROM contract_amendments WHERE amendment_id = $1 AND contract_id = $2", [
            amendmentId,
            contractId,
          ])
        );
        if (round.length === 0) return { status: 404, error: "선택한 변경 차수를 찾을 수 없습니다." };
      }
      await db.run(
        "UPDATE contract_change_events SET amendment_id = $1, updated_at = $2 WHERE change_id = $3 AND contract_id = $4",
        [amendmentId, now, changeId, contractId]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "contract_update",
        targetTable: "contract_change_events",
        targetId: changeId,
        before: { amendmentId: events[0].amendment_id ?? null },
        after: { contractId, amendmentId, kind: "change_round_assign" },
      });
      return null;
    });
    if (result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
