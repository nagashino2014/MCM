import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const text = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
};
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("facility.view");
    const { id } = await ctx.params;
    const db = await getDb();
    const info = rowsToObjects(
      await db.exec("SELECT * FROM facility_facility_info WHERE facility_id = $1 LIMIT 1", [id])
    )[0];
    const docs = rowsToObjects(
      await db.exec("SELECT doc_type, original_filename, uploaded_at FROM facility_facility_documents WHERE facility_id = $1", [id])
    ).map((r) => ({
      docType: String(r.doc_type ?? ""),
      originalFilename: r.original_filename != null ? String(r.original_filename) : null,
      uploadedAt: r.uploaded_at != null ? String(r.uploaded_at) : null,
    }));
    return NextResponse.json({
      info: info
        ? {
            dischargeFacility: info.discharge_facility ?? null,
            generalStack: info.general_stack ?? null,
            cleansys: info.cleansys ?? null,
            flareStack: info.flare_stack ?? null,
            outlet: info.outlet ?? null,
            nonDischargeFacility: info.non_discharge_facility ?? null,
            factoryArea: info.factory_area ?? null,
            manufacturingArea: info.manufacturing_area ?? null,
            auxiliaryArea: info.auxiliary_area ?? null,
          }
        : null,
      docs,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const { id } = await ctx.params;
    const b = await req.json();
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      await db.run(
        `INSERT INTO facility_facility_info
           (facility_id, discharge_facility, general_stack, cleansys, flare_stack, outlet, non_discharge_facility,
            factory_area, manufacturing_area, auxiliary_area, updated_at, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (facility_id) DO UPDATE SET
           discharge_facility = EXCLUDED.discharge_facility, general_stack = EXCLUDED.general_stack,
           cleansys = EXCLUDED.cleansys, flare_stack = EXCLUDED.flare_stack, outlet = EXCLUDED.outlet,
           non_discharge_facility = EXCLUDED.non_discharge_facility, factory_area = EXCLUDED.factory_area,
           manufacturing_area = EXCLUDED.manufacturing_area, auxiliary_area = EXCLUDED.auxiliary_area,
           updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
        [
          id, text(b.dischargeFacility), text(b.generalStack), text(b.cleansys), text(b.flareStack),
          text(b.outlet), text(b.nonDischargeFacility), num(b.factoryArea), num(b.manufacturingArea),
          num(b.auxiliaryArea), now, actor.userId || null,
        ]
      );
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
