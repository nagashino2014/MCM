/**
 * 연락처 가져오기 — 담당자별 산하 사업장 추천(2026-11-13). DB 없는 순수 함수.
 * 한 회사(포스코, 하이트진로 등)의 담당자가 본사·공장마다 소속이 다를 때, 아마란스 원본의
 * 부서명·대표주소에서 사업장 이름의 고유 부분(광양제철소 → 광양, 홍천공장 → 홍천)이나
 * 소재지 시군구가 보이면 그 사업장을 추천한다. 근거가 둘 이상의 사업장에 똑같이 맞으면 추천하지 않는다.
 */
import { companyKey } from "@scraper/lib/contact-import/rules";
import { extractRegion } from "@scraper/lib/ieps/region";

/** 같은 회사의 사업장 후보가 된 근거. 앞쪽일수록 강하다. */
export const SITE_KINDS = ["decided", "candidate", "crn", "brn", "name"] as const;
/** chosen = 근거 없이 담당자가 이미 배속된 사업장(직접 검색·새로 등록). 화면 이름은 ContactImportPanel SITE_KIND_LABELS. */
export type SiteKind = (typeof SITE_KINDS)[number] | "chosen";

export interface SiteRef { facilityId: string; companyName: string; address: string | null; kind?: SiteKind }
export interface PersonRef { department: string | null; address: string | null }
export interface SiteSuggestion { facilityId: string; reason: string }

const SITE_TAIL = /(제?\d*(공장|제철소|제련소|사업장|사업소|사업부|지점|지사|본사|본점|연구소|연구원|캠퍼스|센터|발전소|발전본부|건설본부|본부|사무소|출장소))$/;
const compact = (value: string | null | undefined) => String(value ?? "").normalize("NFKC").replace(/[\s.,()·&\-'"/]/g, "").toLowerCase();

/** 사업장 이름에서 회사명을 뺀 고유 부분과 그 꼬리를 뗀 핵심(홍천공장 → 홍천공장·홍천). */
export function siteNameTokens(siteName: string, companyName: string): string[] {
  const site = companyKey(siteName);
  const company = companyKey(companyName);
  // 회사명으로 시작하지 않는 사업장 이름(예: 광양제철소)은 이름 전체가 고유 부분이다. 회사명과 같으면(본사) 없다.
  const rest = company && site.startsWith(company) ? site.slice(company.length) : site;
  const tokens = new Set<string>();
  if (rest.length >= 2 && rest !== company) tokens.add(rest);
  let core = rest;
  for (;;) {
    const next = core.replace(SITE_TAIL, "");
    if (next === core) break;
    core = next;
  }
  if (core.length >= 2 && core !== company) tokens.add(core);
  return [...tokens];
}

/** 시군구 이름의 핵심(홍천군 → 홍천, 창원시 → 창원). 한 글자면 쓰지 않는다. */
function sigunguCore(sigungu: string | null): string | null {
  const head = String(sigungu ?? "").split(/\s+/)[0] ?? "";
  const core = head.replace(/(시|군|구)$/, "");
  return core.length >= 2 ? core : null;
}

interface Scored { facilityId: string; score: number; reason: string }

function scoreSite(person: PersonRef, site: SiteRef, companyName: string): Scored {
  const department = compact(person.department);
  const address = compact(person.address);
  let score = 0;
  const reasons: string[] = [];
  const tokens = siteNameTokens(site.companyName, companyName);
  const inDepartment = department ? tokens.find((t) => department.includes(t)) : undefined;
  const inAddress = !inDepartment && address ? tokens.find((t) => address.includes(t)) : undefined;
  if (inDepartment) { score += 3; reasons.push(`부서명에 '${inDepartment}'`); }
  else if (inAddress) { score += 2; reasons.push(`주소에 '${inAddress}'`); }
  const siteRegion = extractRegion(site.address);
  const personRegion = extractRegion(person.address);
  // 이름만 회사명으로 시작하는 곳(포스코 ↔ 포스코이앤씨 같은 계열사)은 지역만 맞아서는 추천하지 않는다.
  if (!inDepartment && !inAddress && site.kind === "name") return { facilityId: site.facilityId, score: 0, reason: "" };
  if (siteRegion.sigungu && personRegion.sigungu && siteRegion.sido === personRegion.sido && siteRegion.sigungu === personRegion.sigungu) {
    score += 2;
    reasons.push(`주소 지역 일치(${siteRegion.sigungu})`);
  } else {
    const core = sigunguCore(siteRegion.sigungu);
    if (core && department.includes(core)) { score += 1; reasons.push(`부서명에 지역 '${core}'`); }
  }
  return { facilityId: site.facilityId, score, reason: reasons.join(" · ") };
}

/**
 * 담당자 한 명의 추천 사업장. 근거 점수가 2 이상이고 1위가 하나일 때만 돌려준다.
 * 사업장 후보가 하나뿐이면 고를 것이 없으므로 추천하지 않는다.
 */
export function suggestPersonSite(person: PersonRef, sites: SiteRef[], companyName: string): SiteSuggestion | null {
  if (sites.length < 2 || (!person.department && !person.address)) return null;
  const scored = sites.map((site) => scoreSite(person, site, companyName)).sort((a, b) => b.score - a.score);
  const [top, second] = scored;
  if (!top || top.score < 2 || (second && second.score === top.score)) return null;
  return { facilityId: top.facilityId, reason: top.reason };
}
