import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import {
  normalizeAddress,
  normalizeBusinessRegistrationNo,
  normalizeCompanyName,
} from "@/lib/ieps/formatters";
import { extractRegion } from "@scraper/lib/ieps/region";
import {
  normalizeFacilityCompanySize,
  normalizeServiceCategories,
  type FacilityCompanySize,
  type FacilityServiceCategory,
} from "@/lib/ieps/facility-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateBody {
  companyName: string;
  businessRegistrationNo?: string | null;
  siteAddress?: string | null;
  phoneNumber?: string | null;
  industryCode?: string | null;
  industryName?: string | null;
  memo?: string | null;
  aliases?: { alias?: string; aliasType?: string | null; note?: string | null; isPrimary?: boolean }[];
  serviceCategories?: FacilityServiceCategory[];
  companySize?: FacilityCompanySize | null;
}

function normalizeCompanyKey(name: string | null | undefined): string | null {
  if (!name) return null;
  return name.replace(/\s+/g, "").replace(/[\(\)（）]/g, "").trim().toLowerCase();
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireEditor();
    const body = (await req.json()) as CreateBody;
    if (!body?.companyName?.trim()) {
      return NextResponse.json({ error: "상호는 필수입니다." }, { status: 400 });
    }
    const companyName = normalizeCompanyName(body.companyName) ?? body.companyName.trim();
    const normCompany = normalizeCompanyKey(companyName);
    const siteAddress = normalizeAddress(body.siteAddress);
    const businessRegistrationNo = normalizeBusinessRegistrationNo(body.businessRegistrationNo);
    const normAddress = siteAddress?.replace(/\s+/g, " ").trim() ?? null;
    const region = extractRegion(siteAddress);
    const facilityId =
      "facm_" +
      crypto
        .createHash("sha256")
        .update(
          (normCompany ?? "") + "|" + (businessRegistrationNo ?? "") + "|" + Date.now()
        )
        .digest("hex")
        .slice(0, 14);
    const now = new Date().toISOString();

    const created = await withDbWrite(async (db) => {
      if (normCompany && normAddress) {
        const r = await db.exec(
          `SELECT facility_id FROM facilities
            WHERE normalized_company_name = $1 AND normalized_address = $2
            LIMIT 1`,
          [normCompany, normAddress]
        );
        if (r.length && r[0].values.length) {
          throw new Error(
            "동일 상호와 소재지의 사업장이 이미 존재합니다. 사업장 마스터에서 확인 후 병합하세요."
          );
        }
      }
      await db.run(
        `INSERT INTO facilities
          (facility_id, company_name, business_registration_no, site_address, phone_number,
           industry_code, industry_name, normalized_company_name, normalized_address,
          region_sido, region_sigungu, source, memo, company_size, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'manual', $12, $13, $14, $15)`,
        [
          facilityId,
          companyName,
          businessRegistrationNo,
          siteAddress,
          body.phoneNumber ?? null,
          body.industryCode ?? null,
          body.industryName ?? null,
          normCompany,
          normAddress,
          region.sido,
          region.sigungu,
          body.memo ?? null,
          normalizeFacilityCompanySize(body.companySize),
          now,
          now,
        ]
      );
      const services = normalizeServiceCategories(body.serviceCategories);
      for (const category of services) {
        await db.run(
          `INSERT INTO facility_service_categories
            (facility_id, category, created_at, created_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [facilityId, category, now, actor.userId]
        );
      }
      for (const alias of body.aliases ?? []) {
        const text = alias.alias?.trim();
        if (!text) continue;
        await db.run(
          `INSERT INTO facility_aliases
            (facility_id, alias, alias_type, note, is_primary, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            facilityId,
            text,
            alias.aliasType?.trim() || null,
            alias.note?.trim() || null,
            alias.isPrimary ? 1 : 0,
            now,
            now,
          ]
        );
      }
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_manual_create",
        targetTable: "facilities",
        targetId: facilityId,
        after: {
          companyName,
          businessRegistrationNo,
          siteAddress,
          source: "manual",
          serviceCategories: services,
          companySize: normalizeFacilityCompanySize(body.companySize),
        },
      });
      return { facilityId, updatedExisting: false };
    });

    return NextResponse.json({
      facilityId: created.facilityId,
      updatedExisting: created.updatedExisting,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
