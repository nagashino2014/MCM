import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { cleanProductName } from "@/lib/ieps/formatters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface ProductInput {
  productName?: string | null;
  productionAmount?: number | string | null;
  productionUnit?: string | null;
}

interface PermitBody {
  decisionNo?: string | null;
  permitType?: string | null;
  permitDate?: string | null;
  isFirstPermit?: boolean | number;
  airClass?: number | string | null;
  airAmount?: number | string | null;
  waterClass?: number | string | null;
  waterAmount?: number | string | null;
  products?: ProductInput[];
}

const numOrNull = (value: unknown): number | null => {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("data.review");
    const { id } = await ctx.params;
    const body = (await req.json()) as PermitBody;
    const now = new Date().toISOString();

    await withDbWrite(async (db) => {
      const before = await snapshotPermit(db, id);
      if (!before) throw new Error("permit not found");
      const facilityId = before.facility_id != null ? String(before.facility_id) : null;
      await db.run(
        `UPDATE permits SET
           decision_no = $1, permit_type = $2, permit_date = $3, is_first_permit = $4, updated_at = $5
         WHERE permit_id = $6`,
        [
          body.decisionNo?.trim() || null,
          body.permitType?.trim() || null,
          body.permitDate?.trim() || null,
          body.isFirstPermit ? 1 : 0,
          now,
          id,
        ]
      );
      await db.run("DELETE FROM permit_scales WHERE permit_id = $1", [id]);
      await upsertScale(db, id, body);
      await db.run("DELETE FROM product_outputs WHERE permit_id = $1", [id]);
      await replaceProducts(db, id, body.products ?? []);
      if (facilityId) await clearAnnualReportSnapshot(db, facilityId);
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "permit_update",
        targetTable: "permits",
        targetId: id,
        before,
        after: body,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("data.review");
    const { id } = await ctx.params;
    await withDbWrite(async (db) => {
      const before = await snapshotPermit(db, id);
      if (!before) throw new Error("permit not found");
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "permit_delete",
        targetTable: "permits",
        targetId: id,
        before,
        after: { deleted: true },
      });
      await db.run("DELETE FROM permits WHERE permit_id = $1", [id]);
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

async function clearAnnualReportSnapshot(db: any, facilityId: string): Promise<void> {
  await db.run("DELETE FROM facility_annual_reports WHERE facility_id = $1", [facilityId]);
}

async function snapshotPermit(db: any, permitId: string): Promise<Record<string, unknown> | null> {
  const permit = await db.exec("SELECT * FROM permits WHERE permit_id = $1 LIMIT 1", [permitId]);
  if (!permit.length || !permit[0].values.length) return null;
  const row: Record<string, unknown> = {};
  permit[0].columns.forEach((col: string, idx: number) => (row[col] = permit[0].values[0][idx]));
  row.scales = await db.exec("SELECT * FROM permit_scales WHERE permit_id = $1", [permitId]);
  row.products = await db.exec("SELECT * FROM product_outputs WHERE permit_id = $1", [permitId]);
  return row;
}

async function upsertScale(db: any, permitId: string, body: PermitBody): Promise<void> {
  const airClass = numOrNull(body.airClass);
  const airAmount = numOrNull(body.airAmount);
  const waterClass = numOrNull(body.waterClass);
  const waterAmount = numOrNull(body.waterAmount);
  if (airClass == null && airAmount == null && waterClass == null && waterAmount == null) return;
  await db.run(
    `INSERT INTO permit_scales
      (permit_id, air_class, air_amount_ton_per_year, water_class, wastewater_amount_m3_per_day, source_page, source_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [permitId, airClass, airAmount, waterClass, waterAmount, null, "manual"]
  );
}

async function replaceProducts(db: any, permitId: string, products: ProductInput[]): Promise<void> {
  for (const product of products) {
    const name = cleanProductName(product.productName);
    if (!name && product.productionAmount == null && !product.productionUnit) continue;
    await db.run(
      `INSERT INTO product_outputs
        (permit_id, product_name, production_amount, production_unit, source_page, source_text)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        permitId,
        name,
        numOrNull(product.productionAmount),
        product.productionUnit?.trim() || null,
        null,
        "manual",
      ]
    );
  }
}
