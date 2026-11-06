/**
 * 연락처 가져오기 판정 규칙 — DB·네트워크 없는 순수 함수. 앱과 워커가 함께 쓴다.
 * 회사명·주소로 기존 사업장 후보를 찾고, 외부 조회 결과에서 사업자번호를 판정한다.
 */
import { extractRegion } from "../ieps/region";
import { cleanSpace, identifier, nameKey, searchNames, validBrn, type Profile } from "../facility-quality/rules";

const LEGAL_FORMS = /\(주\)|주식회사|\(유\)|유한회사|유한책임회사|\(사\)|사단법인|\(재\)|재단법인|\(합\)|합자회사|\(의\)|의료법인|법무법인\(유한\)|co\.?,?\s*ltd\.?|inc\.?|corp(oration)?\.?|limited/gi;

/** 회사 묶음 키 — 법인격·공백·문장부호를 지운 소문자. ㈜ 는 NFKC 로 (주)가 된다. */
export function companyKey(name: string | null | undefined): string {
  return String(name ?? "").normalize("NFKC").replace(LEGAL_FORMS, "").replace(/[\s.,()·&\-'"/]/g, "").toLowerCase();
}

const SITE_SUFFIX = /제?\d*(공장|사업장|사업소|지점|지사|본사|본점|연구소|캠퍼스|센터|발전본부|건설본부)$/;
/** 공장·사업장 꼬리를 뗀 키. 이것만으로 같은 곳이라고 단정하지 않는다(후보 찾기용). */
export function baseKey(key: string): string {
  let current = key;
  for (;;) {
    const next = current.replace(SITE_SUFFIX, "");
    if (next === current || next.length < 2) return current;
    current = next;
  }
}

export interface Region { sido: string | null; sigungu: string | null }
export const regionOf = (address: string | null | undefined): Region => extractRegion(address);
const sameRegion = (a: Region, b: Region) => !!a.sido && !!a.sigungu && a.sido === b.sido && a.sigungu === b.sigungu;

const ROAD = /([가-힣0-9]+(?:로|길)(?:\s*\d+번?길)?)\s*(\d+(?:-\d+)?)/;
/** 시군구 + 도로명 + 건물번호. 같은 건물의 다른 기관일 수 있어 약한 근거로만 쓴다. */
export function roadKey(address: string | null | undefined): string | null {
  const region = regionOf(address);
  const match = String(address ?? "").match(ROAD);
  if (!region.sigungu || !match) return null;
  return `${region.sido}|${region.sigungu}|${match[1].replace(/\s+/g, "")}|${match[2]}`;
}

const FREE_MAIL = new Set(["naver.com", "hanmail.net", "daum.net", "gmail.com", "nate.com", "kakao.com", "hotmail.com", "outlook.com", "yahoo.co.kr", "korea.com", "empas.com", "dreamwiz.com"]);
/** 이메일·홈페이지에서 회사 도메인. 무료 메일은 회사 근거가 아니므로 null. */
export function companyDomain(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  const host = raw.includes("@") ? raw.split("@").pop()! : raw.replace(/^https?:\/\//, "").split("/")[0];
  const domain = host.replace(/^www\./, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) && !FREE_MAIL.has(domain) ? domain : null;
}

/** 분류 화면의 기본값. 낱말 어림이므로 관리자가 바꿀 수 있다. */
export function suggestCategory(name: string): string {
  const k = companyKey(name);
  if (/은행$|은행[가-힣]*지점$|증권|보험|캐피탈|저축|금융/.test(k)) return "금융기관";
  if (/협회|조합|중앙회|연합회/.test(k)) return "협회·조합";
  if (/공사$|공단$/.test(k)) return "공기업";
  if (/(특별시|광역시|도청|시청|군청|구청|의회|교육청|경찰청|소방|보건소|법원|검찰|국회)|(환경부|국토교통부|고용노동부|산업통상자원부)|지방환경청|환경청$|유역환경청|(시|군|구)$|위원회$|진흥원$|연구원$|대학교?$/.test(k)) return "공공기관";
  return "민간기업";
}

export type MatchKind = "name_region" | "name" | "prefix_region" | "prefix" | "address" | "brn";
export interface FacilityRef { facilityId: string; companyName: string; address: string | null; brn?: string | null; aliases?: string[] }
export interface MatchCandidate extends FacilityRef { kind: MatchKind }
const KIND_ORDER: MatchKind[] = ["brn", "name_region", "name", "prefix_region", "prefix", "address"];

export interface FacilityIndex { byKey: Map<string, FacilityRef[]>; byBase: Map<string, FacilityRef[]>; byRoad: Map<string, FacilityRef[]>; keys: [string, FacilityRef[]][] }
function push<K>(map: Map<K, FacilityRef[]>, key: K, value: FacilityRef) {
  const list = map.get(key);
  if (list) { if (!list.includes(value)) list.push(value); } else map.set(key, [value]);
}
export function buildFacilityIndex(facilities: FacilityRef[]): FacilityIndex {
  const byKey = new Map<string, FacilityRef[]>();
  const byBase = new Map<string, FacilityRef[]>();
  const byRoad = new Map<string, FacilityRef[]>();
  for (const f of facilities) {
    for (const name of [f.companyName, ...(f.aliases ?? [])]) {
      const key = companyKey(name);
      if (key.length < 2) continue;
      push(byKey, key, f);
      push(byBase, baseKey(key), f);
    }
    const road = roadKey(f.address);
    if (road) push(byRoad, road, f);
  }
  return { byKey, byBase, byRoad, keys: [...byKey.entries()] };
}

/**
 * 기존 사업장 후보. 이름·지역이 함께 맞는 후보가 있으면 그것만 돌려주어 선택지를 줄인다.
 * 앞부분만 맞는 후보와 주소만 맞는 후보는 자동 연결하지 않는다(검증: 같은 건물의 다른 기관,
 * 경기환경에너지진흥원 ↔ 경기환경에너지㈜ 같은 오탐이 실제 명단에서 나왔다).
 */
export function matchFacilities(name: string, address: string | null, index: FacilityIndex): MatchCandidate[] {
  const key = companyKey(name);
  if (key.length < 2) return [];
  const region = regionOf(address);
  const out = new Map<string, MatchCandidate>();
  const add = (list: FacilityRef[] | undefined, inRegion: MatchKind, elsewhere: MatchKind) => {
    for (const f of list ?? []) {
      if (out.has(f.facilityId)) continue;
      out.set(f.facilityId, { ...f, aliases: undefined, kind: sameRegion(region, regionOf(f.address)) ? inRegion : elsewhere });
    }
  };
  add(index.byKey.get(key), "name_region", "name");
  const base = baseKey(key);
  if (base.length >= 3) add(index.byBase.get(base), "name_region", "name");
  if (!out.size && key.length >= 4) {
    for (const [k, list] of index.keys) {
      if (k.length >= 4 && (k.startsWith(key) || key.startsWith(k))) add(list, "prefix_region", "prefix");
    }
  }
  const road = roadKey(address);
  if (road) for (const f of index.byRoad.get(road) ?? []) {
    if (!out.has(f.facilityId)) out.set(f.facilityId, { ...f, aliases: undefined, kind: "address" });
  }
  const list = [...out.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const strong = list.filter((c) => c.kind === "name_region");
  return (strong.length ? strong : list).slice(0, 15);
}

/** 후보가 정확히 하나이고 이름·지역이 함께 맞으면 사람 선택 없이 연결 대상으로 본다. */
export function autoLinkTarget(candidates: MatchCandidate[]): string | null {
  const confident = candidates.filter((c) => c.kind === "name_region" || c.kind === "brn");
  return confident.length === 1 && candidates.length === 1 ? confident[0].facilityId : null;
}

export interface SearchCandidate {
  source: string; name: string; brn: string | null; crn: string | null; address: string | null;
  phone: string | null; homepage: string | null; url: string | null; sourceDate: string | null;
  sameName: boolean; sameRegion: boolean; sameDomain: boolean;
}
export interface SearchVerdict { verdict: "recommend" | "review" | "not_found"; brn: string | null; crn: string | null; candidates: SearchCandidate[]; note: string | null }
export interface CompanyEvidence { name: string; address: string | null; homepage: string | null; emailDomain: string | null }

/**
 * 외부 조회 결과 판정. 등록 추천은 번호가 하나로 모이고, 이름이 같으며, 지역 또는 회사 도메인까지
 * 맞을 때만이다. 이름만 같은 후보는 다른 회사일 수 있어 사람이 본다.
 */
export function judgeProfiles(company: CompanyEvidence, profiles: Profile[]): SearchVerdict {
  const names = searchNames(company.name).map(nameKey);
  const key = companyKey(company.name);
  const region = regionOf(company.address);
  const domain = companyDomain(company.homepage) ?? companyDomain(company.emailDomain);
  const candidates: SearchCandidate[] = [];
  const seen = new Set<string>();
  for (const p of profiles) {
    const sameName = names.includes(nameKey(p.name)) || companyKey(p.name) === key;
    if (!sameName) continue;
    const brnDigits = identifier(p.values.business_registration_no);
    const crnDigits = identifier(p.values.corporate_registration_no);
    const brn = validBrn(brnDigits) ? brnDigits : null;
    const homepage = p.homepage ? cleanSpace(p.homepage) : null;
    const address = p.values.site_address ? cleanSpace(p.values.site_address) : null;
    const dedupe = `${p.source}|${brn ?? crnDigits ?? p.name}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    candidates.push({
      source: p.source, name: p.name, brn, crn: crnDigits.length === 13 ? crnDigits : null, address,
      phone: p.values.phone_number ?? null, homepage, url: p.url ?? null, sourceDate: p.sourceDate ?? null,
      sameName, sameRegion: sameRegion(region, regionOf(address)), sameDomain: !!domain && companyDomain(homepage) === domain,
    });
  }
  const numbered = candidates.filter((c) => c.brn);
  const brns = [...new Set(numbered.map((c) => c.brn!))];
  if (!brns.length) {
    return { verdict: candidates.length ? "review" : "not_found", brn: null, crn: null, candidates, note: candidates.length ? "이름이 같은 후보가 있으나 사업자번호가 없습니다" : null };
  }
  if (brns.length > 1) return { verdict: "review", brn: null, crn: null, candidates, note: `이름이 같은 사업자번호가 ${brns.length}개입니다` };
  const backed = numbered.some((c) => c.sameRegion || c.sameDomain);
  return {
    verdict: backed ? "recommend" : "review",
    brn: brns[0],
    crn: numbered.find((c) => c.crn)?.crn ?? null,
    candidates,
    note: backed ? null : "이름은 같지만 지역·도메인이 맞지 않아 본사와 다른 회사일 수 있습니다",
  };
}

/** 담당자 중복 판별 키 — 회사 안에서 이름 + (휴대폰 또는 이메일). */
export function contactDedupeKey(company: string, name: string, mobile: string | null, email: string | null): string {
  const digits = String(mobile ?? "").replace(/\D/g, "");
  return [company, String(name).replace(/\s+/g, "").toLowerCase(), digits || String(email ?? "").trim().toLowerCase()].join("|");
}

/** 전화번호 표기 정리 — +82 를 0 으로, 하이픈 표기. 알 수 없는 형식은 원문을 유지한다. */
export function formatPhone(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("82")) digits = digits.slice(2).replace(/^0?/, "0");
  if (/^010\d{8}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (/^02\d{7,8}$/.test(digits)) return `02-${digits.slice(2, digits.length - 4)}-${digits.slice(-4)}`;
  if (/^0\d{9,10}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, digits.length - 4)}-${digits.slice(-4)}`;
  if (/^1\d{7}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return raw;
}
export const isMobile = (phone: string | null) => !!phone && /^01[016789]/.test(phone.replace(/\D/g, ""));
