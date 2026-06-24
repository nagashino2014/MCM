import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface AliasBody {
  aliases?: { alias?: string; aliasType?: string | null; note?: string | null; isPrimary?: boolean }[];
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const { id } = await ctx.params;
    const body = (await req.json()) as AliasBody;
    const now = new Date().toISOString();
    const aliases = (body.aliases ?? [])
      .map((item) => ({
        alias: item.alias?.trim() ?? "",
        aliasType: item.aliasType?.trim() || null,
        note: item.note?.trim() || null,
        isPrimary: !!item.isPrimary,
      }))
      .filter((item) => item.alias);

    await withDbWrite(async (db) => {
      const before = await db.exec("SELECT * FROM facility_aliases WHERE facility_id = $1", [id]);
      await db.run("DELETE FROM facility_aliases WHERE facility_id = $1", [id]);
      let idx = 0;
      for (const item of aliases) {
        await db.run(
          `INSERT INTO facility_aliases
            (facility_id, alias, alias_type, note, is_primary, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, item.alias, item.aliasType, item.note, item.isPrimary || idx === 0 ? 1 : 0, now, now]
        );
        idx += 1;
      }
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_alias_update",
        targetTable: "facility_aliases",
        targetId: id,
        before,
        after: aliases,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
