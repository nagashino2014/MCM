import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { withContractTransactionWrite } from "@/lib/finance/contract-link-lock";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ trashId: string }>;
}

/**
 * POST: 휴지통 복원(F-11, 2026-10-21) — 사업장·계약의 휴지통 이동(삭제 표시)을 되돌린다.
 * 원본 행의 deleted_at·deleted_by·delete_reason 을 비우고 휴지통 행을 지운다.
 * 휴지통 행에 있던 사유·삭제자·삭제 전 상태는 감사 로그(before)에 남는다.
 * 계약은 삭제(DELETE /api/contracts/[id])와 같은 회계 쓰기 잠금·스냅샷(withContractTransactionWrite) 안에서 되살린다
 * — 복원은 거래 연결을 바꾸지 않으므로 연결 보호 검사(protect)는 생략한다.
 */
export async function POST(_: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("trash.restore");
    const { trashId } = await ctx.params;
    const now = new Date().toISOString();
    const peek = rowsToObjects(
      await (await getDb()).exec("SELECT item_type, item_id FROM trash_items WHERE trash_id = $1 AND purged_at IS NULL LIMIT 1", [trashId])
    )[0];
    const write = <T,>(cb: (db: PgDatabase) => Promise<T>): Promise<T> =>
      peek && String(peek.item_type) === "contract"
        ? withContractTransactionWrite(String(peek.item_id), null, cb, { protect: false })
        : withDbWrite(cb);
    await write(async (db) => {
      const rows = rowsToObjects(
        await db.exec("SELECT * FROM trash_items WHERE trash_id = $1 AND purged_at IS NULL LIMIT 1", [trashId])
      );
      const item = rows[0];
      if (!item) throw new Error("휴지통 항목을 찾을 수 없습니다.");
      const itemType = String(item.item_type ?? "");
      const itemId = String(item.item_id ?? "");

      const table = itemType === "contract" ? "contracts" : itemType === "facility" ? "facilities" : null;
      const idCol = itemType === "contract" ? "contract_id" : "facility_id";
      if (!table) throw new Error("지원하지 않는 휴지통 항목입니다.");

      const target = rowsToObjects(await db.exec(`SELECT ${idCol} FROM ${table} WHERE ${idCol} = $1 LIMIT 1`, [itemId]));
      if (!target.length) throw new Error("원본 데이터가 없어 복원할 수 없습니다.");

      await db.run(
        `UPDATE ${table} SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL, updated_at = $1 WHERE ${idCol} = $2`,
        [now, itemId]
      );
      // 같은 원본이 여러 번 휴지통에 들어간 이력이 있어도 미처리 행은 모두 정리한다.
      await db.run("DELETE FROM trash_items WHERE item_type = $1 AND item_id = $2 AND purged_at IS NULL", [itemType, itemId]);
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "trash_restore",
        targetTable: table,
        targetId: itemId,
        before: item,
        after: { restored: true, itemType, itemId },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
