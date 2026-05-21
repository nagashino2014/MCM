import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import {
  normalizeFacilityCompanySize,
  normalizeServiceCategories,
  type FacilityCompanySize,
  type FacilityServiceCategory,
} from "@/lib/ieps/facility-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  serviceCategories?: FacilityServiceCategory[];
  companySize?: FacilityCompanySize | null;
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { id } = await ctx.params;
    const body = (await req.json()) as Body;
    const categories = normalizeServiceCategories(body.serviceCategories);
    const companySize = normalizeFacilityCompanySize(body.companySize);
    const now = new Date().toISOString();

    await withDbWrite(async (db) => {
      const before = {
        categories: await db.exec("SELECT category FROM facility_service_categories WHERE facility_id = $1", [id]),
        companySize: await db.exec("SELECT company_size FROM facilities WHERE facility_id = $1", [id]),
      };
      await db.run("DELETE FROM facility_service_categories WHERE facility_id = $1", [id]);
      for (const category of categories) {
        await db.run(
          `INSERT INTO facility_service_categories
            (facility_id, category, created_at, created_by)
           VALUES ($1, $2, $3, $4)`,
          [id, category, now, actor.userId]
        );
      }
      await db.run("UPDATE facilities SET company_size = $1, updated_at = $2 WHERE facility_id = $3", [
        companySize,
        now,
        id,
      ]);
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_service_update",
        targetTable: "facilities",
        targetId: id,
        before,
        after: { serviceCategories: categories, companySize },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
