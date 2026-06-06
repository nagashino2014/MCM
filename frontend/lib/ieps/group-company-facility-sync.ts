import crypto from "node:crypto";
import { rowsToObjects } from "@/lib/db";
import { normalizeAddress, normalizeBusinessRegistrationNo, normalizeCompanyName } from "@/lib/ieps/formatters";
import { extractRegion } from "@scraper/lib/ieps/region";

type DbLike = {
  exec: (sql: string, params?: unknown[]) => Promise<{ columns: string[]; values: unknown[][] }[]>;
  run: (sql: string, params?: unknown[]) => Promise<unknown>;
};

interface GroupCompanyInput {
  companyId: string;
  groupId: string;
  companyName: string;
  businessRegistrationNo?: string | null;
  address?: string | null;
  phoneNumber?: string | null;
  logoPath?: string | null;
}

function normalizeCompanyKey(name: string | null | undefined): string | null {
  if (!name) return null;
  return name.replace(/\s+/g, "").replace(/[\(\)（）]/g, "").trim().toLowerCase();
}

function normalizeAddressKey(address: string | null | undefined): string | null {
  return address?.replace(/\s+/g, " ").trim() || null;
}

function generatedFacilityId(companyId: string): string {
  return "facg_" + crypto.createHash("sha256").update(companyId).digest("hex").slice(0, 16);
}

async function findExistingFacilityId(
  db: DbLike,
  businessRegistrationNo: string | null,
  normalizedCompanyName: string | null,
  normalizedAddress: string | null
): Promise<string | null> {
  if (businessRegistrationNo) {
    const byBrn = rowsToObjects(
      await db.exec(
        `SELECT facility_id
           FROM facilities
          WHERE business_registration_no = $1
            AND deleted_at IS NULL
          ORDER BY CASE WHEN source = 'group_company' THEN 0 ELSE 1 END, updated_at DESC
          LIMIT 1`,
        [businessRegistrationNo]
      )
    );
    if (byBrn[0]?.facility_id) return String(byBrn[0].facility_id);
  }

  if (normalizedCompanyName && normalizedAddress) {
    const byNameAddress = rowsToObjects(
      await db.exec(
        `SELECT facility_id
           FROM facilities
          WHERE normalized_company_name = $1
            AND normalized_address = $2
            AND deleted_at IS NULL
          ORDER BY CASE WHEN source = 'group_company' THEN 0 ELSE 1 END, updated_at DESC
          LIMIT 1`,
        [normalizedCompanyName, normalizedAddress]
      )
    );
    if (byNameAddress[0]?.facility_id) return String(byNameAddress[0].facility_id);
  }

  return null;
}

export async function syncGroupCompanyFacility(db: DbLike, input: GroupCompanyInput, now = new Date().toISOString()) {
  const companyName = normalizeCompanyName(input.companyName) ?? input.companyName.trim();
  if (!companyName) return null;

  const siteAddress = normalizeAddress(input.address);
  const businessRegistrationNo = normalizeBusinessRegistrationNo(input.businessRegistrationNo);
  const normalizedCompanyName = normalizeCompanyKey(companyName);
  const normalizedAddress = normalizeAddressKey(siteAddress);
  const region = extractRegion(siteAddress);
  const fallbackFacilityId = generatedFacilityId(input.companyId);
  let existingFacilityId = await findExistingFacilityId(
    db,
    businessRegistrationNo,
    normalizedCompanyName,
    normalizedAddress
  );
  if (existingFacilityId) {
    const membershipRows = rowsToObjects(
      await db.exec(
        `SELECT company_id, relation_type
           FROM facility_group_memberships
          WHERE facility_id = $1
          LIMIT 1`,
        [existingFacilityId]
      )
    );
    const membership = membershipRows[0];
    if (
      membership &&
      String(membership.company_id ?? "") !== input.companyId &&
      String(membership.relation_type ?? "") !== "other"
    ) {
      existingFacilityId = null;
    }
  }
  const facilityId = existingFacilityId ?? fallbackFacilityId;

  if (existingFacilityId) {
    await db.run(
      `UPDATE facilities
          SET company_name = CASE WHEN source = 'group_company' THEN $2 ELSE company_name END,
              business_registration_no = COALESCE(business_registration_no, $3),
              site_address = CASE WHEN source = 'group_company' THEN $4 ELSE COALESCE(site_address, $4) END,
              phone_number = CASE WHEN source = 'group_company' THEN $5 ELSE COALESCE(phone_number, $5) END,
              logo_path = CASE WHEN source = 'group_company' THEN $6 ELSE COALESCE(logo_path, $6) END,
              normalized_company_name = CASE WHEN source = 'group_company' THEN $7 ELSE COALESCE(normalized_company_name, $7) END,
              normalized_address = CASE WHEN source = 'group_company' THEN $8 ELSE COALESCE(normalized_address, $8) END,
              region_sido = CASE WHEN source = 'group_company' THEN $9 ELSE COALESCE(region_sido, $9) END,
              region_sigungu = CASE WHEN source = 'group_company' THEN $10 ELSE COALESCE(region_sigungu, $10) END,
              updated_at = $11
        WHERE facility_id = $1`,
      [
        facilityId,
        companyName,
        businessRegistrationNo,
        siteAddress,
        input.phoneNumber?.trim() || null,
        input.logoPath?.trim() || null,
        normalizedCompanyName,
        normalizedAddress,
        region.sido,
        region.sigungu,
        now,
      ]
    );
  } else {
    await db.run(
      `INSERT INTO facilities
        (facility_id, company_name, business_registration_no, site_address, phone_number,
         normalized_company_name, normalized_address, region_sido, region_sigungu,
         source, memo, logo_path, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'group_company', $10, $11, $12, $13)
       ON CONFLICT (facility_id) DO UPDATE SET
         company_name = excluded.company_name,
         business_registration_no = excluded.business_registration_no,
         site_address = excluded.site_address,
         phone_number = excluded.phone_number,
         normalized_company_name = excluded.normalized_company_name,
         normalized_address = excluded.normalized_address,
         region_sido = excluded.region_sido,
         region_sigungu = excluded.region_sigungu,
         logo_path = excluded.logo_path,
         updated_at = excluded.updated_at`,
      [
        facilityId,
        companyName,
        businessRegistrationNo,
        siteAddress,
        input.phoneNumber?.trim() || null,
        normalizedCompanyName,
        normalizedAddress,
        region.sido,
        region.sigungu,
        "그룹관리 등록 기업에서 자동 생성된 사업장 마스터입니다.",
        input.logoPath?.trim() || null,
        now,
        now,
      ]
    );
  }

  await db.run(
    `INSERT INTO facility_group_memberships
      (facility_id, group_id, company_id, relation_type, started_at, ended_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'other', NULL, NULL, $4, $5)
     ON CONFLICT (facility_id) DO UPDATE SET
       group_id = excluded.group_id,
       company_id = excluded.company_id,
       updated_at = excluded.updated_at
     WHERE facility_group_memberships.company_id = excluded.company_id
        OR facility_group_memberships.relation_type = 'other'`,
    [facilityId, input.groupId, input.companyId, now, now]
  );

  return facilityId;
}

export async function syncAllGroupCompanyFacilities(db: DbLike): Promise<number> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.company_id, c.group_id, c.company_name, c.business_registration_no,
              c.address, c.phone_number, c.logo_path
         FROM facility_group_companies c
        WHERE NOT EXISTS (
          SELECT 1
            FROM facility_group_memberships m
           WHERE m.company_id = c.company_id
             AND m.relation_type = 'other'
        )`
    )
  );
  const now = new Date().toISOString();
  let count = 0;
  for (const row of rows) {
    await syncGroupCompanyFacility(
      db,
      {
        companyId: String(row.company_id ?? ""),
        groupId: String(row.group_id ?? ""),
        companyName: String(row.company_name ?? ""),
        businessRegistrationNo: row.business_registration_no != null ? String(row.business_registration_no) : null,
        address: row.address != null ? String(row.address) : null,
        phoneNumber: row.phone_number != null ? String(row.phone_number) : null,
        logoPath: row.logo_path != null ? String(row.logo_path) : null,
      },
      now
    );
    count += 1;
  }
  return count;
}
