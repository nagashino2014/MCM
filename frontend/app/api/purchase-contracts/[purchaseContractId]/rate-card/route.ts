import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { upgradeRateCard } from "@/lib/contracts/rate-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ purchaseContractId: string }>;
}

/** 매입 단가 기준표 조회(333) — 매출 contracts/[id]/rate-card 와 같은 모양. 없으면 빈 v2 구조. */
export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    const { purchaseContractId } = await ctx.params;
    await requirePermission("purchase.view");
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(`SELECT card, updated_at FROM purchase_contract_rate_cards WHERE purchase_contract_id = $1`, [purchaseContractId])
    );
    const raw = rows.length ? rows[0].card : null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return NextResponse.json({ card: upgradeRateCard(parsed), updatedAt: rows.length ? rows[0].updated_at ?? null : null });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 단가 기준표 저장(전체 교체) — 신규·변경계약 모달의 '단가 계약' 탭. 매입 계약이 외주 계약일 때만 받는다. */
export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const { purchaseContractId } = await ctx.params;
    const actor = await requirePermission("purchase.edit");
    const body = (await req.json().catch(() => ({}))) as { card?: unknown };
    const card = upgradeRateCard(body.card);
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      const head = rowsToObjects(
        await db.exec(`SELECT contract_type FROM purchase_contracts WHERE purchase_contract_id = $1 AND deleted_at IS NULL`, [purchaseContractId])
      )[0];
      if (!head) throw Object.assign(new Error("매입 계약을 찾을 수 없습니다."), { status: 404 });
      if (String(head.contract_type) !== "outsourcing") throw Object.assign(new Error("단가 기준표는 외주 계약에서만 저장할 수 있습니다."), { status: 400 });
      await db.run(
        `INSERT INTO purchase_contract_rate_cards (purchase_contract_id, card, updated_at, updated_by)
         VALUES ($1, $2::jsonb, $3, $4)
         ON CONFLICT (purchase_contract_id) DO UPDATE
           SET card = EXCLUDED.card, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
        [purchaseContractId, JSON.stringify(card), now, actor.userId ?? null]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "purchase_contract_rate_card_update",
        targetTable: "purchase_contract_rate_cards",
        targetId: purchaseContractId,
        after: { items: card.items.length, rounds: card.rounds.length },
      });
    });
    return NextResponse.json({ ok: true, count: card.items.length });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
