// 사업장 누락 항목 자동 보완(DART 기반) — 누락 점검 화면의 "자동 보완"이 사용한다.
// 흐름: dart_corp_codes(회사명→corp_code 캐시) 매칭 → 기업개황(company.json) 조회 →
//       사업자번호 일치(강검증) 또는 상호+시도 일치(약검증) → 누락 필드 후보 생성.
// 후보는 즉시 저장하지 않고 사용자가 검토 후 apply 라우트로 반영한다.
import fs from "node:fs";
import path from "node:path";
import type { PgDatabase } from "@/lib/db";
import {
  downloadCorpCodes,
  getCompanyProfile,
  type DartCompanyProfile,
} from "@/lib/intel/dart-client";
import { fscAvailable, searchCorpOutline } from "@/lib/intel/fsc-client";

export type EnrichField =
  | "representative_name"
  | "phone_number"
  | "business_registration_no"
  | "industry_code"
  | "industry_name"
  | "site_address";

export interface EnrichCandidate {
  facilityId: string;
  companyName: string;
  field: EnrichField;
  fieldLabel: string;
  value: string;
  source: string;
  /** true = 사업자번호 일치 강검증. false = 상호·지역 검증 등 — 기본 미선택으로 노출 */
  verified: boolean;
  note: string | null;
}

export const ENRICH_FIELD_LABELS: Record<EnrichField, string> = {
  representative_name: "대표자명",
  phone_number: "전화번호",
  business_registration_no: "사업자등록번호",
  industry_code: "업종코드",
  industry_name: "업종명",
  site_address: "소재지",
};

const CORP_CACHE_TTL_DAYS = 30;

/** 배치 검증에서 확립한 상호 정규화(법인격·공백·특수문자 제거). */
export function normalizeCorpKey(name: string): string {
  let s = String(name ?? "").normalize("NFKC");
  s = s.replace(/\(\s*주\s*\)|주식회사|㈜|\(유\)|유한회사|\(재\)|재단법인|\(사\)|사단법인|농업회사법인|\(합\)/g, "");
  s = s.replace(/[\s.,\-–·&/()\[\]'"“”‘’*]+/g, "");
  return s.toLowerCase();
}

const SITE_SUFFIX = /(제?\d+공장|공장|지사|지점|사업소|사업장|사업부문|본부|캠퍼스|발전소|열병합발전|빛드림본부)$/;

/** 사업장명 → 법인명 정규화 키 후보(원명 → 사이트 접미사 제거 반복 → 첫 토큰). */
export function corpKeyCandidates(name: string): string[] {
  const out: string[] = [];
  const base = normalizeCorpKey(String(name).replace(/\(.*?\)$/, ""));
  if (base) out.push(base);
  let prev = "";
  let cur = base;
  while (cur && cur !== prev) {
    prev = cur;
    cur = cur.replace(SITE_SUFFIX, "");
    if (cur && cur !== prev && !out.includes(cur)) out.push(cur);
  }
  const firstTok = normalizeCorpKey(String(name).split(/\s+/)[0] ?? "");
  if (firstTok && !out.includes(firstTok)) out.push(firstTok);
  return out.filter((k) => k.length >= 2);
}

/** corpCode 캐시가 비었거나 오래됐으면 DART 에서 재적재. */
export async function ensureDartCorpCache(db: PgDatabase): Promise<void> {
  const r = await db.exec(
    "SELECT COUNT(*), MAX(refreshed_at) FROM dart_corp_codes"
  );
  const count = r.length && r[0].values.length ? Number(r[0].values[0][0] ?? 0) : 0;
  const refreshedAt = r.length && r[0].values.length ? String(r[0].values[0][1] ?? "") : "";
  if (count > 0 && refreshedAt) {
    const ageMs = Date.now() - new Date(refreshedAt).getTime();
    if (Number.isFinite(ageMs) && ageMs < CORP_CACHE_TTL_DAYS * 24 * 3600 * 1000) return;
  }
  const corps = await downloadCorpCodes();
  if (corps.length === 0) throw new Error("DART corpCode 목록이 비어 있습니다.");
  const now = new Date().toISOString();
  await db.run("DELETE FROM dart_corp_codes");
  const CHUNK = 1000;
  for (let i = 0; i < corps.length; i += CHUNK) {
    const chunk = corps.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const rows = chunk.map((c, j) => {
      params.push(c.corpCode, c.corpName, normalizeCorpKey(c.corpName), c.stockCode, now);
      const b = j * 5;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`;
    });
    await db.run(
      `INSERT INTO dart_corp_codes (corp_code, corp_name, normalized_name, stock_code, refreshed_at)
       VALUES ${rows.join(", ")}
       ON CONFLICT (corp_code) DO UPDATE
         SET corp_name = EXCLUDED.corp_name,
             normalized_name = EXCLUDED.normalized_name,
             stock_code = EXCLUDED.stock_code,
             refreshed_at = EXCLUDED.refreshed_at`,
      params
    );
  }
}

// KSIC-11 코드표 (public/ksic11.json) — 프로세스 수명 동안 1회 로드.
let ksicMap: Map<string, string> | null = null;

function loadKsic(): Map<string, string> {
  if (ksicMap) return ksicMap;
  const p = path.join(process.cwd(), "public", "ksic11.json");
  const arr = JSON.parse(fs.readFileSync(p, "utf-8")) as { code: string; name: string }[];
  ksicMap = new Map(arr.map((e) => [String(e.code).trim(), String(e.name).trim()]));
  return ksicMap;
}

/** 코드 문자열(줄바꿈/쉼표 구분) → [코드, 이름] 목록. 하나라도 매핑 실패 시 null. */
function ksicPairs(codesRaw: string): [string, string][] | null {
  const map = loadKsic();
  const codes = String(codesRaw ?? "")
    .split(/[\n,/]+/)
    .map((c) => c.trim())
    .filter(Boolean);
  if (codes.length === 0) return null;
  const out: [string, string][] = [];
  for (const c of codes) {
    const digitsOnly = c.replace(/\D/g, "");
    if (map.has(digitsOnly)) out.push([digitsOnly, map.get(digitsOnly)!]);
    else if (digitsOnly.length > 5 && map.has(digitsOnly.slice(0, 5)))
      out.push([digitsOnly.slice(0, 5), map.get(digitsOnly.slice(0, 5))!]);
    else return null;
  }
  return out;
}

const SIDO_PAT = /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청북|충청남|충북|충남|전라북|전라남|전북|전남|경상북|경상남|경북|경남|제주)/;

function sidoOf(text: string | null | undefined): string {
  const m = SIDO_PAT.exec(String(text ?? ""));
  return m ? m[1].slice(0, 2) : "";
}

interface FacilityRow {
  facilityId: string;
  companyName: string;
  brn: string; // 숫자 10자리 or ""
  representative: string;
  phone: string;
  address: string;
  industryCode: string;
  industryName: string;
  regionSido: string;
}

async function loadFacilities(db: PgDatabase, facilityIds: string[]): Promise<FacilityRow[]> {
  if (facilityIds.length === 0) return [];
  const placeholders = facilityIds.map((_, i) => `$${i + 1}`).join(", ");
  const r = await db.exec(
    `SELECT facility_id, company_name,
            COALESCE(NULLIF(TRIM(COALESCE(business_registration_no,'')),''), NULLIF(TRIM(COALESCE(site_business_registration_no,'')),'')) AS brn,
            COALESCE(TRIM(representative_name), '') AS representative,
            COALESCE(TRIM(phone_number), '') AS phone,
            COALESCE(TRIM(site_address), '') AS address,
            COALESCE(TRIM(industry_code), '') AS industry_code,
            COALESCE(TRIM(industry_name), '') AS industry_name,
            COALESCE(region_sido, '') AS region_sido
       FROM facilities
      WHERE facility_id IN (${placeholders}) AND deleted_at IS NULL`,
    facilityIds
  );
  if (!r.length) return [];
  return r[0].values.map((v) => ({
    facilityId: String(v[0] ?? ""),
    companyName: String(v[1] ?? ""),
    brn: String(v[2] ?? "").replace(/\D/g, ""),
    representative: String(v[3] ?? ""),
    phone: String(v[4] ?? ""),
    address: String(v[5] ?? ""),
    industryCode: String(v[6] ?? ""),
    industryName: String(v[7] ?? ""),
    regionSido: String(v[8] ?? ""),
  }));
}

interface FoundProfile {
  profile: Omit<DartCompanyProfile, "indutyCode"> & { indutyCode: string | null };
  verified: boolean;
  origin: "DART" | "금융위";
}

/** 금융위 기업개요 검색(2차 소스). 원문 법인명 후보로 검색 후 동일 검증 규칙 적용. */
async function findFscProfile(fac: FacilityRow): Promise<FoundProfile | null> {
  if (!fscAvailable()) return null;
  const base = String(fac.companyName).replace(/\(.*?\)$/, "").trim();
  const core = base.replace(/\(주\)|㈜|주식회사|\(유\)|유한회사/g, "").trim();
  const queries = [...new Set([core, core.split(/\s+/)[0] ?? ""])].filter((q) => q.length >= 2);
  for (const q of queries) {
    const items = await searchCorpOutline(q);
    if (items.length === 0) continue;
    const toProfile = (it: (typeof items)[number]) => ({
      corpName: it.corpName,
      bizrNo: it.bizrNo,
      ceoName: it.ceoName,
      phoneNo: it.phoneNo,
      address: it.address,
      indutyCode: null,
    });
    if (fac.brn) {
      const hit = items.find((it) => it.bizrNo === fac.brn);
      if (hit) return { profile: toProfile(hit), verified: true, origin: "금융위" };
      continue;
    }
    const key = normalizeCorpKey(fac.companyName);
    const exact = items.filter((it) => normalizeCorpKey(it.corpName) === key);
    const sido = fac.regionSido.slice(0, 2);
    const region = exact.filter((it) => sido && sidoOf(it.address) === sido);
    if (exact.length === 1 && (!sido || region.length === 1))
      return { profile: toProfile(exact[0]), verified: false, origin: "금융위" };
    if (region.length === 1)
      return { profile: toProfile(region[0]), verified: false, origin: "금융위" };
    return null;
  }
  return null;
}

async function findCorpProfiles(
  db: PgDatabase,
  fac: FacilityRow
): Promise<{ profile: DartCompanyProfile; verified: boolean } | null> {
  for (const key of corpKeyCandidates(fac.companyName)) {
    const r = await db.exec(
      "SELECT corp_code FROM dart_corp_codes WHERE normalized_name = $1 LIMIT 5",
      [key]
    );
    const codes = r.length ? r[0].values.map((v) => String(v[0] ?? "")).filter(Boolean) : [];
    if (codes.length === 0) continue;
    const profiles: DartCompanyProfile[] = [];
    for (const code of codes) {
      const p = await getCompanyProfile(code);
      if (p) profiles.push(p);
    }
    if (profiles.length === 0) continue;
    if (fac.brn) {
      const hit = profiles.find((p) => p.bizrNo === fac.brn);
      if (hit) return { profile: hit, verified: true };
      continue; // 사업자번호 불일치 — 다음 이름 후보로
    }
    const sido = fac.regionSido.slice(0, 2);
    const regionHits = profiles.filter((p) => sido && sidoOf(p.address) === sido);
    if (profiles.length === 1 && (!sido || regionHits.length === 1)) {
      return { profile: profiles[0], verified: false };
    }
    if (regionHits.length === 1) return { profile: regionHits[0], verified: false };
    return null; // 동명 복수 — 자동 판별 불가
  }
  return null;
}

const fmtBrn = (d: string) => `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;

/** 대상 사업장들의 누락 필드 보완 후보를 생성한다(저장하지 않음). */
export async function buildEnrichCandidates(
  db: PgDatabase,
  facilityIds: string[]
): Promise<EnrichCandidate[]> {
  const facilities = await loadFacilities(db, facilityIds);
  const out: EnrichCandidate[] = [];

  for (const fac of facilities) {
    // 업종: 기존 코드가 있고 이름만 비어 있으면 DART 없이도 KSIC 변환 가능
    if (fac.industryCode && !fac.industryName) {
      const pairs = ksicPairs(fac.industryCode);
      if (pairs) {
        out.push({
          facilityId: fac.facilityId,
          companyName: fac.companyName,
          field: "industry_name",
          fieldLabel: ENRICH_FIELD_LABELS.industry_name,
          value: pairs.map((p) => p[1]).join("\n"),
          source: "기존 업종코드 → KSIC-11 변환",
          verified: true,
          note: null,
        });
      }
    }

    const needDart =
      !fac.representative || !fac.phone || !fac.brn || !fac.address ||
      (!fac.industryCode && !fac.industryName);
    if (!needDart) continue;

    // 1차 DART → 미매칭 시 2차 금융위(커버리지가 더 넓음, 업종은 미제공)
    const dartFound = await findCorpProfiles(db, fac);
    const found: FoundProfile | null = dartFound
      ? { ...dartFound, origin: "DART" }
      : await findFscProfile(fac);
    if (!found) continue;
    const { profile, verified, origin } = found;
    const source = `${origin}: ${profile.corpName}` + (verified ? "" : " (상호·지역 검증)");

    const push = (field: EnrichField, value: string, note: string | null, v = verified) =>
      out.push({
        facilityId: fac.facilityId,
        companyName: fac.companyName,
        field,
        fieldLabel: ENRICH_FIELD_LABELS[field],
        value,
        source,
        verified: v,
        note,
      });

    if (!fac.representative && profile.ceoName) push("representative_name", profile.ceoName, null);
    if (!fac.phone && profile.phoneNo && /\d{3,}/.test(profile.phoneNo))
      push("phone_number", profile.phoneNo, "본사 대표번호");
    if (!fac.brn && profile.bizrNo) push("business_registration_no", fmtBrn(profile.bizrNo), null);
    if (!fac.industryCode && !fac.industryName && profile.indutyCode) {
      const pairs = ksicPairs(profile.indutyCode);
      if (pairs) {
        push("industry_code", pairs.map((p) => p[0]).join("\n"), null);
        push("industry_name", pairs.map((p) => p[1]).join("\n"), null);
      } else {
        push(
          "industry_code",
          profile.indutyCode,
          "KSIC 상위분류 — 세세분류 선택 필요",
          false
        );
      }
    }
    if (!fac.address && profile.address)
      push("site_address", profile.address, "본사 주소일 수 있음 — 확인 필요", false);
  }
  return out;
}
