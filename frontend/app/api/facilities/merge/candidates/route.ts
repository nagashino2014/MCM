/**
 * 중복 사업장 후보 조회.
 * - GET /api/facilities/merge/candidates → 자동 추천 그룹 목록 반환
 *   (사업자등록번호+시도+시군구 / 정규화 상호 / 정규화 주소가 같은 사업장이 2건 이상인 그룹)
 */

import { NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getDb, invalidateDb, rowsToObjects } from "@/lib/db";
import {
  formatCompanyName,
  normalizeAddress,
  normalizeBusinessRegistrationNo,
  normalizeCompanyName,
} from "@/lib/ieps/formatters";
import { extractRegion } from "@scraper/lib/ieps/region";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CandidateGroup {
  id: string;
  matches: {
    matchType: "brn" | "company" | "address";
    matchValue: string;
    facilityIds: string[];
  }[];
  facilities: {
    facilityId: string;
    companyName: string;
    businessRegistrationNo: string | null;
    siteAddress: string | null;
    source: string;
    permitsCount: number;
    createdAt: string;
  }[];
}

interface FacilityRow {
  facilityId: string;
  companyName: string;
  businessRegistrationNo: string | null;
  siteAddress: string | null;
  normalizedCompanyName: string | null;
  normalizedAddress: string | null;
  regionSido: string | null;
  regionSigungu: string | null;
  source: string;
  permitsCount: number;
  createdAt: string;
}

type MatchType = CandidateGroup["matches"][number]["matchType"];

function normalizeCompanyKey(value: string | null | undefined): string | null {
  const formatted = normalizeCompanyName(value);
  return formatted
    ? formatted.replace(/\s+/g, "").replace(/[\(\)（）]/g, "").trim().toLowerCase()
    : null;
}

function addBucket(
  buckets: Map<string, string[]>,
  key: string | null | undefined,
  facilityId: string
): void {
  if (!key) return;
  const trimmed = key.trim();
  if (!trimmed) return;
  const ids = buckets.get(trimmed) ?? [];
  ids.push(facilityId);
  buckets.set(trimmed, ids);
}

function groupKey(ids: string[]): string {
  return [...ids].sort().join("|");
}

function exclusionKey(matchType: MatchType, ids: string[]): string {
  return `${matchType}:${groupKey(ids)}`;
}

function brnRegionKey(facility: FacilityRow): string | null {
  if (!facility.businessRegistrationNo) return null;
  const extracted = extractRegion(facility.siteAddress ?? facility.normalizedAddress);
  const sido = facility.regionSido ?? extracted.sido;
  const sigungu = facility.regionSigungu ?? extracted.sigungu;
  if (!sido || !sigungu) return null;
  return `${facility.businessRegistrationNo} · ${sido} ${sigungu}`;
}

export async function GET() {
  try {
    await requireAuthenticated();
    invalidateDb();
    const db = await getDb();

    const facilityResult = await db.exec(
      `SELECT f.facility_id, f.company_name, f.business_registration_no, f.site_address,
              f.normalized_company_name, f.normalized_address, f.region_sido, f.region_sigungu,
              f.source, f.created_at,
              (SELECT COUNT(*) FROM permits p WHERE p.facility_id = f.facility_id) AS permits_count
         FROM facilities f`
    );
    const facilities: FacilityRow[] = rowsToObjects(facilityResult).map((row) => ({
      facilityId: String(row.facility_id ?? ""),
      companyName: formatCompanyName(String(row.company_name ?? "")) ?? "",
      businessRegistrationNo:
        row.business_registration_no != null
          ? normalizeBusinessRegistrationNo(String(row.business_registration_no))
          : null,
      siteAddress:
        row.site_address != null ? normalizeAddress(String(row.site_address)) : null,
      normalizedCompanyName:
        row.normalized_company_name != null
          ? String(row.normalized_company_name)
          : normalizeCompanyKey(String(row.company_name ?? "")),
      normalizedAddress:
        row.site_address != null
          ? normalizeAddress(String(row.site_address))
          : row.normalized_address != null
          ? normalizeAddress(String(row.normalized_address))
          : null,
      regionSido: row.region_sido != null ? String(row.region_sido) : null,
      regionSigungu: row.region_sigungu != null ? String(row.region_sigungu) : null,
      source: row.source != null ? String(row.source) : "ieps",
      permitsCount: Number(row.permits_count ?? 0),
      createdAt: String(row.created_at ?? ""),
    }));

    const byId = new Map(facilities.map((facility) => [facility.facilityId, facility]));
    const excludedKeys = new Set<string>();
    try {
      const exclusionRows = rowsToObjects(
        await db.exec("SELECT match_type, facility_ids_key FROM facility_merge_exclusions")
      );
      for (const row of exclusionRows) {
        if (!row.match_type || !row.facility_ids_key) continue;
        excludedKeys.add(`${String(row.match_type)}:${String(row.facility_ids_key)}`);
      }
    } catch {
      // 마이그레이션 전 DB에서도 후보 조회는 계속 동작하게 한다.
    }
    const buckets: Record<MatchType, Map<string, string[]>> = {
      brn: new Map(),
      company: new Map(),
      address: new Map(),
    };

    for (const facility of facilities) {
      addBucket(buckets.brn, brnRegionKey(facility), facility.facilityId);
      addBucket(buckets.company, facility.normalizedCompanyName, facility.facilityId);
      addBucket(buckets.address, facility.normalizedAddress, facility.facilityId);
    }

    const groupsByIds = new Map<string, CandidateGroup>();
    for (const matchType of ["brn", "company", "address"] as const) {
      for (const [matchValue, ids] of buckets[matchType]) {
        const uniqueIds = Array.from(new Set(ids));
        if (uniqueIds.length < 2) continue;
        if (excludedKeys.has(exclusionKey(matchType, uniqueIds))) continue;
        const key = groupKey(uniqueIds);
        const existing = groupsByIds.get(key);
        if (existing) {
          existing.matches.push({ matchType, matchValue, facilityIds: uniqueIds });
          continue;
        }
        const groupFacilities = uniqueIds
          .map((id) => byId.get(id))
          .filter((facility): facility is FacilityRow => Boolean(facility))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        groupsByIds.set(key, {
          id: key,
          matches: [{ matchType, matchValue, facilityIds: uniqueIds }],
          facilities: groupFacilities.map((facility) => ({
            facilityId: facility.facilityId,
            companyName: facility.companyName,
            businessRegistrationNo: facility.businessRegistrationNo,
            siteAddress: facility.siteAddress,
            source: facility.source,
            permitsCount: facility.permitsCount,
            createdAt: facility.createdAt,
          })),
        });
      }
    }

    const groups = Array.from(groupsByIds.values()).sort((a, b) => {
      const typeOrder = { brn: 0, company: 1, address: 2 };
      return typeOrder[a.matches[0].matchType] - typeOrder[b.matches[0].matchType];
    });

    return NextResponse.json({ groups });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
