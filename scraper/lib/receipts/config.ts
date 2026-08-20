/**
 * 전자상거래 영수증 수집 — 사이트 설정
 *
 * ⚠ 셀렉터/URL 은 **실측 전 추정값**이다.
 *   - 11번가는 주문목록·영수증 화면이 PC 웹에만 있고 마크업이 수시로 바뀐다.
 *   - 그래서 수집기는 고정 셀렉터에 의존하지 않고 "텍스트(영수증/거래명세서) + 날짜/주문번호 정규식"
 *     휴리스틱을 우선 쓴다. 휴리스틱이 빗나가면 `probe` 로 실측해 site-config.json 에 덮어쓴다.
 *   - site-config.json 이 있으면 아래 기본값보다 **우선** 적용된다.
 */

import path from "node:path";
import fs from "node:fs";

import { siteDir, ensureSiteDir } from "./session";

export interface SiteConfig {
  /** 사이트 키 — 산출물 디렉터리명으로도 쓰인다 */
  key: string;
  name: string;
  /** login 명령이 처음 띄우는 주소 */
  loginUrl: string;
  /** 주문목록(마이페이지) 주소 — probe/collect 의 시작점 */
  orderListUrl: string;
  /** 세션 유효성 확인용 주소(보통 주문목록과 동일) */
  checkUrl: string;
  /** 로그인 페이지로 튕겼는지 판정하는 URL 패턴 */
  loggedOutPattern: string;
  /** 영수증 진입점을 찾을 때 쓰는 텍스트 후보(우선순위 순) */
  receiptKeywords: string[];
  /** 주문 행 후보 셀렉터(위에서부터 시도, 매칭되는 첫 셀렉터를 쓴다) */
  orderRowSelectors: string[];
  /** 다음 페이지 이동 요소 후보 */
  nextPageSelectors: string[];
  /**
   * 주문번호만으로 영수증을 여는 URL 템플릿(`{ordNo}` 치환).
   * 이게 있으면 목록에서 버튼을 클릭할 필요 없이 영수증 주소로 바로 이동한다 — 훨씬 빠르고 안정적이다.
   */
  receiptUrlTemplate?: string;
}

/**
 * 11번가.
 * - 로그인: login.11st.co.kr
 * - 주문목록: 마이 11번가 > 주문/배송조회. 계정·시점에 따라 주소가 달라질 수 있어
 *   login 단계에서 사용자가 실제로 머문 URL 을 site-config.json 에 기록해 덮어쓴다.
 */
export const ELEVEN_ST: SiteConfig = {
  key: "11st",
  name: "11번가",
  loginUrl: "https://login.11st.co.kr/auth/front/login.tmall",
  // 실측(2026-08): 마이 11번가 > 주문/배송조회. 주문 목록 자체는 이 페이지의 **iframe** 안에 그려진다.
  orderListUrl: "https://buy.11st.co.kr/my11st/order/OrderList.tmall",
  checkUrl: "https://buy.11st.co.kr/my11st/order/OrderList.tmall",
  loggedOutPattern: "login|signin|auth",
  receiptKeywords: ["카드영수증", "영수증", "거래명세서", "명세서"],
  orderRowSelectors: [
    "[class*='order_list'] > li",
    "[class*='orderList'] > li",
    "table[class*='order'] tbody tr",
    "[class*='c_list_order'] li",
    "li[class*='order']",
  ],
  nextPageSelectors: [
    "a:has-text('다음')",
    "[class*='paging'] a[class*='next']",
    "button:has-text('다음')",
  ],
  // 실측(2026-08): 주문상세의 [영수증] 버튼이 여는 팝업 주소. 주문번호만 있으면 바로 열린다.
  //
  // ⚠ 다만 이 문서는 "결제영수증"이고, 문서 본문에 **세무상의 지출증빙 효력이 없다**고 명시돼 있다.
  //   (품목·카드번호는 찍히지만 소득공제용 영수증·매입 세금계산서로는 쓸 수 없음)
  //   부가세 증빙으로 쓸 신용카드 매출전표·지출증빙 현금영수증은
  //   '나의11번가 > 증빙서류 발급'(documentaryEvidence.tmall)에서 발급된다 → 그쪽 주소를 실측 중.
  receiptUrlTemplate:
    "https://buy.11st.co.kr/my11st/receipt/viewReceipt.tmall?method=orderReceipt&ordNo={ordNo}&isSSL=Y",
};

const SITES: Record<string, SiteConfig> = {
  [ELEVEN_ST.key]: ELEVEN_ST,
};

export function configFile(site: string): string {
  return path.join(siteDir(site), "site-config.json");
}

/** 기본 설정 + probe 가 실측해 저장한 값(site-config.json) 병합 */
export function loadSiteConfig(site: string): SiteConfig {
  const base = SITES[site];
  if (!base) {
    throw new Error(`알 수 없는 사이트: ${site} (지원: ${Object.keys(SITES).join(", ")})`);
  }

  const file = configFile(site);
  if (!fs.existsSync(file)) return { ...base };

  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf-8"));
    return { ...base, ...saved };
  } catch {
    console.log(`[${site}] ⚠ site-config.json 을 읽지 못해 기본값을 씁니다: ${file}`);
    return { ...base };
  }
}

/** 실측 결과를 site-config.json 에 부분 저장(다음 실행부터 우선 적용) */
export function saveSiteConfig(site: string, patch: Partial<SiteConfig>): void {
  ensureSiteDir(site);
  const file = configFile(site);

  let current: Record<string, unknown> = {};
  if (fs.existsSync(file)) {
    try {
      current = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      current = {};
    }
  }

  const next = { ...current, ...patch };
  fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf-8");
  console.log(`[${site}] 사이트 설정 저장: ${file}`);
}
