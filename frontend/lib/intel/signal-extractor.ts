// 공시 신호 분류. 1차는 report_nm으로 카테고리 라우팅, 유형자산 취득은 DS005 정형 상세로 정밀 판별.
// 목표: "단순 부지 토지구매"·"순수 지분 M&A"·"자산 매각" 같은 false positive를 등급으로 강등하고,
//       설비 증설/신설만 confirmed로 승격. 계열거래는 버리지 않고 monitoring 으로 유지.

import type { TangibleAssetAcq } from "./dart-client";

export type IntelSignalType = "investment" | "expansion" | "new_site" | "other";

export const INTEL_SIGNAL_TYPE_LABELS: Record<IntelSignalType, string> = {
  investment: "투자",
  expansion: "증설",
  new_site: "신설",
  other: "기타",
};

// 신호 등급: 판별 신뢰도/관련성. 기본 목록은 confirmed+candidate, monitoring/excluded는 필터로.
export type IntelSignalGrade = "confirmed" | "candidate" | "monitoring" | "excluded";

export const INTEL_SIGNAL_GRADE_LABELS: Record<IntelSignalGrade, string> = {
  confirmed: "확정",
  candidate: "후보",
  monitoring: "관찰",
  excluded: "제외",
};

// 후보 공시의 카테고리. 'tangible'만 DS005 정형 상세(유형자산 양수) 조회가 필요하다.
// 'supply_contract'(공급·수주 계약)는 발주처(거래상대방)가 통합허가 대상일 수 있어 2차 원문 파싱 대상.
export type DisclosureCategory =
  | "new_facility"
  | "tangible"
  | "stock"
  | "business"
  | "affiliate_deal"
  | "supply_contract";

const has = (name: string, ...ks: string[]) => ks.some((k) => name.includes(k));

/**
 * report_nm 을 카테고리로 라우팅. 관심 없으면 null(미수집).
 * 처분/양도/매각(관심의 반대) 은 애초에 제외.
 */
export function routeDisclosure(reportName: string): DisclosureCategory | null {
  const name = (reportName ?? "").replace(/\s+/g, "");
  // 매각/처분/양도는 증설·발주와 무관 → 미수집. (단 '양수'는 취득이므로 제외되면 안 됨)
  const isDisposal = has(name, "처분", "매각") || (has(name, "양도") && !has(name, "양수"));

  if (has(name, "신규시설투자", "시설투자")) return "new_facility";
  if (has(name, "공장신설", "신규공장", "증설")) return "new_facility";
  if (has(name, "유형자산")) return isDisposal ? null : "tangible";
  if (has(name, "타법인주식", "출자증권")) return isDisposal ? null : "stock";
  if (has(name, "상품·용역거래", "상품ㆍ용역거래", "용역거래", "출자계열회사")) return "affiliate_deal";
  if (has(name, "단일판매", "공급계약", "수주", "도급계약", "공사도급")) return "supply_contract";
  if (has(name, "영업양수")) return "business";
  return null;
}

// 2차(counterparty) 매칭 대상 카테고리: 공시자 자신이 아니라 '거래상대방(발주처)'이 통합허가
// 대상일 수 있는 유형. 1차 corp 미매칭 공시 중 이 카테고리만 원문(document.xml)을 파싱한다.
export const COUNTERPARTY_CATEGORIES = new Set<DisclosureCategory>(["supply_contract", "affiliate_deal"]);

export interface ClassifyResult {
  signalType: IntelSignalType;
  grade: IntelSignalGrade;
  assetClass: string | null;
  purpose: string | null;
  amount: number | null;
  counterparty: string | null;
}

// 설비/생산 관련(증설·신설 정황) 키워드
const FACILITY_KWS = ["기계장치", "기계", "설비", "구축물", "장치", "생산설비", "생산라인", "플랜트"];
const PURPOSE_KWS = ["증설", "신설", "신축", "생산능력", "생산능력증대", "증대", "공장", "생산라인", "capa", "케파"];
// 설비가 아닌(단순 부지/사옥) 키워드
const LAND_KWS = ["토지", "부지", "대지", "용지"];
const BUILDING_KWS = ["건물", "사옥", "사무", "오피스", "빌딩"];

/**
 * 최종 분류. category 는 routeDisclosure 결과, detail 은 tangible 일 때만 있는 DS005 상세.
 */
export function classifyDisclosure(
  reportName: string,
  category: DisclosureCategory,
  detail?: TangibleAssetAcq | null
): ClassifyResult {
  const name = (reportName ?? "").replace(/\s+/g, "");

  switch (category) {
    case "new_facility": {
      const signalType: IntelSignalType = has(name, "공장신설", "신규공장")
        ? "new_site"
        : has(name, "증설")
          ? "expansion"
          : "investment";
      return { signalType, grade: "confirmed", assetClass: null, purpose: null, amount: null, counterparty: null };
    }

    case "tangible": {
      const base = {
        assetClass: detail?.assetClass ?? null,
        purpose: detail?.purpose ?? null,
        amount: detail?.amount ?? null,
        counterparty: detail?.counterparty ?? null,
      };
      if (!detail) {
        // 정형 상세 없음(무자료/오류) → 유형자산 취득이라 설비 추정하되 미확정.
        return { signalType: "expansion", grade: "candidate", ...base };
      }
      const hay = [detail.assetClass, detail.assetName, detail.purpose].filter(Boolean).join(" ");
      const isFacility = has(hay, ...FACILITY_KWS) || has(hay, ...PURPOSE_KWS);
      const isLandOnly = has(hay, ...LAND_KWS) && !isFacility;
      const isBuildingOnly = has(hay, ...BUILDING_KWS) && !isFacility;

      if (isFacility) return { signalType: "expansion", grade: "confirmed", ...base };
      if (isLandOnly) return { signalType: "other", grade: "excluded", ...base }; // 단순 부지 토지구매
      if (isBuildingOnly) return { signalType: "expansion", grade: "candidate", ...base }; // 공장동일 수 있어 후보
      return { signalType: "expansion", grade: "candidate", ...base };
    }

    case "stock":
      // 순수 지분 취득 → 공장 신증설과 무관. 버리지 않고 excluded 로 남김(후속: 목적 정형으로 승격 여지).
      return { signalType: "investment", grade: "excluded", assetClass: null, purpose: null, amount: null, counterparty: null };

    case "affiliate_deal":
      // 계열사 상품·용역거래. 설비증설 정황이 섞일 수 있어 monitoring 으로 유지(LS엠앤엠 EVBM 사례).
      return { signalType: "other", grade: "monitoring", assetClass: null, purpose: null, amount: null, counterparty: null };

    case "supply_contract":
      // 단일판매·공급/수주 계약. direct(공시자=대상)면 대상이 공급자 측이라 발주 정황이 약함 → monitoring.
      // 핵심 가치는 2차 counterparty(발주처가 대상)에 있다(classifyCounterparty).
      return { signalType: "other", grade: "monitoring", assetClass: null, purpose: null, amount: null, counterparty: null };

    case "business":
      return { signalType: "other", grade: "candidate", assetClass: null, purpose: null, amount: null, counterparty: null };
  }
}

// --- 2차 counterparty 매칭: 공시 원문에서 거래상대방(발주처) → 통합허가 대상 대조 ---

// 원문에서 거래상대방이 등장할 만한 라벨(공급/수주/특수관계 서식 다양성 대응).
const COUNTERPARTY_ANCHORS = [
  "계약상대방", "계약상대", "거래상대방", "거래상대", "매출처", "발주처", "발주자",
  "공급받는자", "수요처", "주문자", "구매자", "매수인", "양수인", "상대회사", "상대방", "특수관계인",
];

/**
 * 원문 텍스트에서 거래상대방 라벨 주변 윈도우만 이어붙여 반환(원문 전체 매칭의 과탐 억제).
 * 앵커가 하나도 없으면 "" (전체 폴백은 하지 않는다 — 정밀도 우선).
 */
export function extractCounterpartyText(fullText: string, window = 120): string {
  if (!fullText) return "";
  const parts: string[] = [];
  for (const anchor of COUNTERPARTY_ANCHORS) {
    let from = 0;
    for (;;) {
      const i = fullText.indexOf(anchor, from);
      if (i < 0) break;
      parts.push(fullText.slice(i, i + anchor.length + window));
      from = i + anchor.length;
    }
  }
  return parts.join(" ");
}

/** 회사명 코어(법인격·공백·특수문자 제거). 원문 대조용 매칭 키. */
export function coreCompanyName(name: string | null | undefined): string {
  return (name ?? "")
    .replace(/㈜/g, "")
    .replace(/주식회사/g, "")
    .replace(/[（(]\s*주\s*[)）]/g, "")
    .replace(/[^가-힣A-Za-z0-9]/g, "");
}

const MIN_CORE_LEN = 3; // 과탐 억제: 코어명이 이보다 짧은 대상은 원문 대조에서 제외

/**
 * 대조 텍스트(거래상대방 윈도우)에서 통합허가 대상 회사명(코어)을 찾는다.
 * coreToFac: 코어명→{facilityId,name}. excludeCore: 공시자 자신(제외). 가장 긴 코어명 우선(부분포함 오탐 축소).
 */
export function findCounterpartyFacility(
  matchText: string,
  coreToFac: Map<string, { facilityId: string; name: string }>,
  excludeCore: string
): { facilityId: string; name: string } | null {
  if (!matchText) return null;
  const compact = matchText.replace(/\s+/g, "");
  let best: { facilityId: string; name: string; len: number } | null = null;
  for (const [core, fac] of coreToFac) {
    if (core.length < MIN_CORE_LEN || core === excludeCore) continue;
    if (compact.includes(core) && (!best || core.length > best.len)) {
      best = { facilityId: fac.facilityId, name: fac.name, len: core.length };
    }
  }
  return best ? { facilityId: best.facilityId, name: best.name } : null;
}

/** 2차 매칭 성공(거래상대방=통합허가 대상) 신호 분류. 사람 검토용 monitoring. */
export function classifyCounterparty(counterpartyName: string): ClassifyResult {
  return { signalType: "other", grade: "monitoring", assetClass: null, purpose: null, amount: null, counterparty: counterpartyName };
}
