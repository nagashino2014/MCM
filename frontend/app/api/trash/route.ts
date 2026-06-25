import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission("trash.view", { fallbackRoles: ["editor"] });
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");
    const where = ["t.purged_at IS NULL"];
    const params: unknown[] = [];
    if (type === "facility" || type === "contract") {
      params.push(type);
      where.push(`t.item_type = $${params.length}`);
    }
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT t.trash_id, t.item_type, t.item_id, t.item_title, t.reason,
                t.deleted_at, t.deleted_by, u.name AS deleted_by_name, u.email AS deleted_by_email
         FROM trash_items t
         LEFT JOIN users u ON u.user_id = t.deleted_by
         WHERE ${where.join(" AND ")}
         ORDER BY t.deleted_at DESC`,
        params
      )
    );
    return NextResponse.json({ items: rows.map(mapTrashItem) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

function mapTrashItem(row: Record<string, unknown>) {
  return {
    trashId: String(row.trash_id ?? ""),
    itemType: String(row.item_type ?? ""),
    itemId: String(row.item_id ?? ""),
    itemTitle: String(row.item_title ?? ""),
    reason: row.reason != null ? String(row.reason) : null,
    deletedAt: String(row.deleted_at ?? ""),
    deletedBy: row.deleted_by != null ? String(row.deleted_by) : null,
    deletedByName: row.deleted_by_name != null ? String(row.deleted_by_name) : null,
    deletedByEmail: row.deleted_by_email != null ? String(row.deleted_by_email) : null,
  };
}
