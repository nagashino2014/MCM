import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { rowsToObjects, withDbWrite } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ purchaseContractId: string }>;
}

/** 단계 순서 변경(331) — body.order 에 단계 id 전체를 새 순서대로 담는다. */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { purchaseContractId } = await ctx.params;
    await requirePermission("purchase.edit");
    const body = await req.json();
    const order = Array.isArray(body.order) ? body.order.map((v: unknown) => String(v)) : [];
    if (order.length === 0) return NextResponse.json({ error: "순서 목록이 비어 있습니다." }, { status: 400 });
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      const rows = rowsToObjects(
        await db.exec("SELECT milestone_id FROM purchase_contract_milestones WHERE purchase_contract_id = $1", [purchaseContractId])
      );
      const known = new Set(rows.map((r) => String(r.milestone_id)));
      if (order.length !== known.size || order.some((id: string) => !known.has(id))) {
        throw Object.assign(new Error("단계 목록이 현재 상태와 다릅니다. 새로고침 후 다시 시도해 주세요."), { status: 409 });
      }
      for (let i = 0; i < order.length; i++) {
        await db.run("UPDATE purchase_contract_milestones SET stage_order = $1, updated_at = $2 WHERE milestone_id = $3", [i + 1, now, order[i]]);
      }
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
