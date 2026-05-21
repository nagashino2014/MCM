import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
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

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { id: facilityId } = await ctx.params;
    const body = (await req.json()) as PermitBody;
    const now = new Date().toISOString();
    const permitId = "permit_manual_" + crypto.randomUUID();

    await withDbWrite(async (db) => {
      const exists = await db.exec("SELECT facility_id FROM facilities WHERE facility_id = $1 LIMIT 1", [
        facilityId,
      ]);
      if (!exists.length || !exists[0].values.length) throw new Error("facility not found");

      await db.run(
        `INSERT INTO permits
          (permit_id, facility_id, decision_no, permit_type, permit_date, is_first_permit,
           source_doc_id, source_attachment_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          permitId,
          facilityId,
          body.decisionNo?.trim() || null,
          body.permitType?.trim() || "manual",
          body.permitDate?.trim() || null,
          body.isFirstPermit ? 1 : 0,
          null,
          null,
          now,
          now,
        ]
      );
      await upsertScale(db, permitId, body);
      await replaceProducts(db, permitId, body.products ?? []);
      await clearAnnualReportSnapshot(db, facilityId);
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "permit_create",
        targetTable: "permits",
        targetId: permitId,
        after: { facilityId, ...body },
      });
    });

    return NextResponse.json({ permitId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

async function clearAnnualReportSnapshot(db: any, facilityId: string): Promise<void> {
  await db.run("DELETE FROM facility_annual_reports WHERE facility_id = $1", [facilityId]);
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
