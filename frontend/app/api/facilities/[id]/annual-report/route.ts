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

interface AnnualProductInput {
  productName?: string | null;
  amount?: number | string | null;
  unit?: string | null;
}

interface AnnualReportBody {
  reportYear?: number | string | null;
  airClass?: number | string | null;
  airAmountTonPerYear?: number | string | null;
  waterClass?: number | string | null;
  wastewaterM3PerDay?: number | string | null;
  products?: AnnualProductInput[];
}

const numOrNull = (value: unknown): number | null => {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const { id: facilityId } = await ctx.params;
    const body = (await req.json()) as AnnualReportBody;
    const now = new Date().toISOString();

    await withDbWrite(async (db) => {
      const before = await snapshotAnnualReport(db, facilityId);
      if (!before) throw new Error("annual report snapshot not found");

      const products = (body.products ?? [])
        .map((product) => ({
          product_name: cleanProductName(product.productName),
          amount: numOrNull(product.amount),
          unit: product.unit?.trim() || null,
        }))
        .filter((product) => product.product_name || product.amount != null || product.unit);

      await db.run(
        `UPDATE facility_annual_reports SET
           report_year = $1, air_class = $2, air_amount_ton_per_year = $3,
           water_class = $4, wastewater_amount_m3_per_day = $5, product_outputs_json = $6::jsonb,
           updated_at = $7
         WHERE facility_id = $8`,
        [
          numOrNull(body.reportYear),
          numOrNull(body.airClass),
          numOrNull(body.airAmountTonPerYear),
          numOrNull(body.waterClass),
          numOrNull(body.wastewaterM3PerDay),
          products.length ? JSON.stringify(products) : null,
          now,
          facilityId,
        ]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "annual_report_update",
        targetTable: "facility_annual_reports",
        targetId: facilityId,
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
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const { id: facilityId } = await ctx.params;
    await withDbWrite(async (db) => {
      const before = await snapshotAnnualReport(db, facilityId);
      if (!before) throw new Error("annual report snapshot not found");
      await db.run("DELETE FROM facility_annual_reports WHERE facility_id = $1", [facilityId]);
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "annual_report_delete",
        targetTable: "facility_annual_reports",
        targetId: facilityId,
        before,
        after: { deleted: true },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

async function snapshotAnnualReport(db: any, facilityId: string): Promise<Record<string, unknown> | null> {
  const result = await db.exec("SELECT * FROM facility_annual_reports WHERE facility_id = $1 LIMIT 1", [
    facilityId,
  ]);
  if (!result.length || !result[0].values.length) return null;
  const row: Record<string, unknown> = {};
  result[0].columns.forEach((col: string, idx: number) => {
    row[col] = result[0].values[0][idx];
  });
  return row;
}
