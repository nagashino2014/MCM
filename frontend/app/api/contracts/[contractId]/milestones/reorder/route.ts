import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string }>;
}

/**
 * Persist a new ordering for a contract's payment milestones. The request body
 * is `{ order: string[] }` listing milestone ids in the desired top-to-bottom
 * order; stage_order is rewritten to 1..N so the detail view (ordered by
 * stage_order ASC) reflects the drag-and-drop result.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { contractId } = await ctx.params;
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"], target: { contractId } });
    const body = await req.json();
    const order: string[] = Array.isArray(body?.order)
      ? body.order.map((value: unknown) => String(value))
      : [];
    if (order.length === 0) {
      return NextResponse.json({ error: "재정렬할 단계 순서가 필요합니다." }, { status: 400 });
    }

    await withDbWrite(async (db) => {
      const rows = rowsToObjects(
        await db.exec(
          "SELECT milestone_id FROM contract_payment_milestones WHERE contract_id = $1",
          [contractId]
        )
      );
      const validIds = new Set(rows.map((r) => String(r.milestone_id)));
      const orderedValid = order.filter((id) => validIds.has(id));
      if (orderedValid.length === 0) {
        throw new Error("재정렬할 단계를 찾을 수 없습니다.");
      }
      const now = new Date().toISOString();
      for (let i = 0; i < orderedValid.length; i++) {
        await db.run(
          "UPDATE contract_payment_milestones SET stage_order = $1, updated_at = $2 WHERE milestone_id = $3 AND contract_id = $4",
          [i + 1, now, orderedValid[i], contractId]
        );
      }
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "contract_payment_update",
        targetTable: "contract_payment_milestones",
        targetId: contractId,
        after: { reorder: orderedValid },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
