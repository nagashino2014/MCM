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
  representativeName?: string | null;
  siteAddress?: string | null;
  // 동일 사업자등록번호로 2개 이상의 소재지를 운영하는 사업장의 보조 소재지 목록.
  additionalSiteAddresses?: (string | null | undefined)[] | null;
  phoneNumber?: string | null;
  industryCode?: string | null;
  industryName?: string | null;
  businessCertificateBusinessType?: string | null;
  businessCertificateBusinessItem?: string | null;
  businessCertificateCorporateRegistrationNo?: string | null;
  businessCertificateOcrText?: string | null;
  memo?: string | null;
  aliases?: { alias?: string; aliasType?: string | null; note?: string | null; isPrimary?: boolean }[];
  serviceCategories?: FacilityServiceCategory[];
  companySize?: FacilityCompanySize | null;
  // 사업자등록번호가 같은 사업장(예: 동일 법인의 본사/공장)을 관계 법인으로 묶기 위해
  // 사용자가 중복을 확인한 뒤 그대로 등록하도록 허용하는 플래그.
  allowDuplicateBusinessRegistrationNo?: boolean;
}

interface DuplicateFacility {
  facilityId: string;
  companyName: string | null;
  businessRegistrationNo: string | null;
  siteAddress: string | null;
  matchType: "businessRegistrationNo" | "companyAddress";
}

function normalizeCompanyKey(name: string | null | undefined): string | null {
  if (!name) return null;
  return name.replace(/\s+/g, "").replace(/[\(\)（）]/g, "").trim().toLowerCase();
}

function normalizeText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function normalizeCorporateRegistrationNo(value: string | null | undefined): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length !== 13) return normalizeText(value);
  return digits.slice(0, 6) + "-" + digits.slice(6);
}

function duplicateFromRow(row: unknown[], matchType: DuplicateFacility["matchType"]): DuplicateFacility {
  return {
    facilityId: String(row[0] ?? ""),
    companyName: row[1] != null ? String(row[1]) : null,
    businessRegistrationNo: row[2] != null ? String(row[2]) : null,
    siteAddress: row[3] != null ? String(row[3]) : null,
    matchType,
  };
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
    // 사용자가 직접 입력한 소재지는 시군구동 구분 로직을 적용하지 않고 입력값을 그대로 저장한다.
    // (중복 검증/지역 추출용 normalized_address는 기존대로 포맷된 값을 사용)
    const siteAddressVerbatim = (body.siteAddress ?? "").replace(/\s+/g, " ").trim() || null;
    const businessRegistrationNo = normalizeBusinessRegistrationNo(body.businessRegistrationNo);
    const normAddress = siteAddress?.replace(/\s+/g, " ").trim() ?? null;
    const additionalSiteAddresses = Array.isArray(body.additionalSiteAddresses)
      ? body.additionalSiteAddresses
          .map((addr) => (addr ?? "").replace(/\s+/g, " ").trim())
          .filter((addr) => !!addr && addr !== siteAddressVerbatim)
      : [];
    const additionalSiteAddressesJson = additionalSiteAddresses.length
      ? JSON.stringify(additionalSiteAddresses)
      : null;
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
      if (businessRegistrationNo && !body.allowDuplicateBusinessRegistrationNo) {
        const r = await db.exec(
          `SELECT facility_id, company_name, business_registration_no, site_address
             FROM facilities
            WHERE business_registration_no = $1
              AND deleted_at IS NULL
            LIMIT 1`,
          [businessRegistrationNo]
        );
        if (r.length && r[0].values.length) {
          return { duplicate: duplicateFromRow(r[0].values[0], "businessRegistrationNo") };
        }
      }
      if (normCompany && normAddress) {
        const r = await db.exec(
          `SELECT facility_id, company_name, business_registration_no, site_address
             FROM facilities
            WHERE normalized_company_name = $1
              AND normalized_address = $2
              AND deleted_at IS NULL
            LIMIT 1`,
          [normCompany, normAddress]
        );
        if (r.length && r[0].values.length) {
          return { duplicate: duplicateFromRow(r[0].values[0], "companyAddress") };
        }
      }
      await db.run(
        `INSERT INTO facilities
          (facility_id, company_name, business_registration_no, representative_name, site_address, phone_number,
           industry_code, industry_name, normalized_company_name, normalized_address,
          region_sido, region_sigungu, source, memo, company_size,
          business_certificate_business_type, business_certificate_business_item,
          business_certificate_corporate_registration_no, business_certificate_ocr_text,
          created_at, updated_at, additional_site_addresses, site_address_verbatim)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'manual', $13, $14,
          $15, $16, $17, $18, $19, $20, $21, true)`,
        [
          facilityId,
          companyName,
          businessRegistrationNo,
          normalizeText(body.representativeName),
          siteAddressVerbatim,
          body.phoneNumber ?? null,
          body.industryCode ?? null,
          body.industryName ?? null,
          normCompany,
          normAddress,
          region.sido,
          region.sigungu,
          body.memo ?? null,
          normalizeFacilityCompanySize(body.companySize),
          normalizeText(body.businessCertificateBusinessType),
          normalizeText(body.businessCertificateBusinessItem),
          normalizeCorporateRegistrationNo(body.businessCertificateCorporateRegistrationNo),
          normalizeText(body.businessCertificateOcrText),
          now,
          now,
          additionalSiteAddressesJson,
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
            representativeName: normalizeText(body.representativeName),
          siteAddress: siteAddressVerbatim,
          additionalSiteAddresses,
          source: "manual",
          serviceCategories: services,
          companySize: normalizeFacilityCompanySize(body.companySize),
          businessCertificateBusinessType: normalizeText(body.businessCertificateBusinessType),
          businessCertificateBusinessItem: normalizeText(body.businessCertificateBusinessItem),
          businessCertificateCorporateRegistrationNo: normalizeCorporateRegistrationNo(body.businessCertificateCorporateRegistrationNo),
        },
      });
      return { facilityId, updatedExisting: false, duplicate: null };
    });

    if (created.duplicate) {
      const message =
        created.duplicate.matchType === "businessRegistrationNo"
          ? "동일 사업자등록번호의 사업장이 이미 존재합니다. 기존 사업장을 확인 후 필요 시 정보를 수정하세요."
          : "동일 상호와 소재지의 사업장이 이미 존재합니다. 사업장 마스터에서 확인 후 병합하세요.";
      return NextResponse.json(
        { error: message, duplicateFacility: created.duplicate },
        { status: 409 }
      );
    }

    return NextResponse.json({
      facilityId: created.facilityId,
      updatedExisting: created.updatedExisting,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
