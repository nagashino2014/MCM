import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * H4 승격 — 모바일 간이 등록(source='mobile-quick') 사업장을 정식(source='manual')으로 승격한다.
 * 관리자 "완성" 버튼에서 호출. facility.edit 권한 + audit log.
 */
export async function POST(_: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const now = new Date().toISOString();

    await withDbWrite(async (db) => {
      const rows = rowsToObjects(
        await db.exec("SELECT source FROM facilities WHERE facility_id = $1 AND deleted_at IS NULL", [id])
      );
      if (rows.length === 0) throw new Error("사업장을 찾을 수 없습니다.");
      const source = rows[0].source != null ? String(rows[0].source) : null;
      if (source !== "mobile-quick") {
        throw new Error("간이 등록(mobile-quick) 사업장만 승격할 수 있습니다.");
      }
      await db.run(
        "UPDATE facilities SET source = 'manual', updated_at = $1 WHERE facility_id = $2",
        [now, id]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_promote",
        targetTable: "facilities",
        targetId: id,
        before: { source: "mobile-quick" },
        after: { source: "manual" },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
