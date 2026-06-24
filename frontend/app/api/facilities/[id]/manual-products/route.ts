import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  products?: {
    productName?: string | null;
    amount?: number | string | null;
    unit?: string | null;
    note?: string | null;
  }[];
}

const finiteNumber = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const { id } = await ctx.params;
    const body = (await req.json()) as Body;
    const now = new Date().toISOString();
    const products = (body.products ?? [])
      .map((item) => ({
        productName: item.productName?.trim() ?? "",
        amount: finiteNumber(item.amount),
        unit: item.unit?.trim() || null,
        note: item.note?.trim() || null,
      }))
      .filter((item) => item.productName);

    await withDbWrite(async (db) => {
      const before = await db.exec("SELECT * FROM facility_manual_products WHERE facility_id = $1", [id]);
      await db.run("DELETE FROM facility_manual_products WHERE facility_id = $1", [id]);
      for (const item of products) {
        await db.run(
          `INSERT INTO facility_manual_products
            (facility_id, product_name, amount, unit, note, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, item.productName, item.amount, item.unit, item.note, now, now]
        );
      }
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_manual_product_update",
        targetTable: "facility_manual_products",
        targetId: id,
        before,
        after: products,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
