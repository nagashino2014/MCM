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
export type DisclosureCategory = "new_facility" | "tangible" | "stock" | "business" | "affiliate_deal";

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
  if (has(name, "영업양수")) return "business";
  return null;
}

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

    case "business":
      return { signalType: "other", grade: "candidate", assetClass: null, purpose: null, amount: null, counterparty: null };
  }
}
