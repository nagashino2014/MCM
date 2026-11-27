import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ trashId: string }>;
}

export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("trash.purge", { fallbackRoles: ["admin"] });
    const { trashId } = await ctx.params;
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      const rows = rowsToObjects(
        await db.exec(
          "SELECT * FROM trash_items WHERE trash_id = $1 AND purged_at IS NULL LIMIT 1",
          [trashId]
        )
      );
      const item = rows[0];
      if (!item) throw new Error("휴지통 항목을 찾을 수 없습니다.");
      const itemType = String(item.item_type ?? "");
      const itemId = String(item.item_id ?? "");

      if (itemType === "contract") {
        await db.run("DELETE FROM contracts WHERE contract_id = $1", [itemId]);
      } else if (itemType === "facility") {
        await purgeFacility(db, itemId);
      } else if (itemType === "contact_person") {
        // 주소록 담당자(381) — 원본 행은 휴지통으로 옮길 때 이미 뺐다. 휴지통 기록만 완전 삭제 처리한다.
      } else {
        throw new Error("지원하지 않는 휴지통 항목입니다.");
      }

      await db.run(
        "UPDATE trash_items SET purged_at = $1, purged_by = $2 WHERE trash_id = $3",
        [now, actor.userId, trashId]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "trash_purge",
        targetTable: "trash_items",
        targetId: trashId,
        before: item,
        after: { purged: true, itemType, itemId },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

async function purgeFacility(db: { run: (sql: string, params?: unknown[]) => Promise<unknown> }, facilityId: string) {
  await db.run("DELETE FROM facility_annual_reports WHERE facility_id = $1", [facilityId]);
  await db.run("DELETE FROM facility_aliases WHERE facility_id = $1", [facilityId]);
  await db.run("DELETE FROM facility_service_categories WHERE facility_id = $1", [facilityId]);
  await db.run("DELETE FROM facility_manual_products WHERE facility_id = $1", [facilityId]);
  await db.run("DELETE FROM facility_group_memberships WHERE facility_id = $1", [facilityId]);
  await db.run("DELETE FROM facility_operating_entities WHERE facility_id = $1", [facilityId]);
  await db.run("DELETE FROM facility_contact_main_numbers WHERE facility_id = $1", [facilityId]);
  await db.run("DELETE FROM facility_contact_logs WHERE facility_id = $1", [facilityId]);
  await db.run("DELETE FROM facility_contact_people WHERE facility_id = $1", [facilityId]);
  await db.run("DELETE FROM facility_contact_departments WHERE facility_id = $1", [facilityId]);
  await db.run("DELETE FROM facilities WHERE facility_id = $1", [facilityId]);
}
