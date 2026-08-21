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
  /** 화면에서 주문번호를 골라내는 정규식(기본: 15~20자리 숫자) */
  orderNoPattern?: string;
  /** 주문번호 앞 8자리가 주문일인 사이트(11번가)에서 켠다 */
  orderDateFromOrderNo?: boolean;
  /**
   * 봇 확인(Cloudflare Turnstile 등)이 있는 사이트에서 켠다.
   * UA·viewport 를 덮어쓰지 않고 자동화 표식을 숨기며, headless 대신 headed 로 돈다.
   */
  stealth?: boolean;
  /** 다음 페이지 이동 요소 후보 */
  nextPageSelectors: string[];
  /**
   * 주문번호만으로 영수증을 여는 URL 템플릿(`{ordNo}` 치환).
   * 이게 있으면 목록에서 버튼을 클릭할 필요 없이 영수증 주소로 바로 이동한다 — 훨씬 빠르고 안정적이다.
   */
  receiptUrlTemplate?: string;
  /**
   * 영수증이 GET 이 아니라 **폼 POST** 로 열리는 경우의 요청 정의. 있으면 receiptUrlTemplate 보다 우선한다.
   * 값에 들어간 `{ordNo}` 는 주문번호로 치환된다.
   */
  receiptRequest?: {
    url: string;
    fields: Record<string, string>;
    /** 폼을 보내기 전에 머무를 페이지 — 세션·리퍼러를 자연스럽게 만든다 */
    refererUrl?: string;
  };
  /** 수집 문서의 이름(파일명·대장의 receiptType 에 쓰인다) */
  receiptLabel?: string;
  /**
   * 조회 기간을 직접 지정해 주문목록을 여는 요청(무인 실행용).
   * 이게 있으면 사람이 화면에서 기간을 고를 필요가 없다(--wait 불필요).
   * 값의 `{from}`/`{to}` 는 dateFormat 에 맞춰 치환된다.
   */
  listRequest?: {
    url: string;
    method?: "GET" | "POST";
    /**
     * 값에 쓰는 치환 토큰:
     *   {from} {to}                     dateFormat 형식의 시작·종료일
     *   {fromYYYY} {fromMM} {fromDD}    시작일을 년/월/일로 나눈 값
     *   {toYYYY} {toMM} {toDD}          종료일을 년/월/일로 나눈 값
     *   {page}                          페이지 번호(1부터) — 있으면 페이지 이동도 이 요청으로 한다
     */
    fields: Record<string, string>;
    /** 날짜 치환 형식 — "YYYYMMDD" | "YYYY-MM-DD" | "YYYY.MM.DD" (기본 YYYYMMDD) */
    dateFormat?: string;
    /** POST 일 때 폼을 보내기 전에 머무를 페이지 */
    refererUrl?: string;
  };
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
  orderNoPattern: "\\b\\d{15,20}\\b",
  orderDateFromOrderNo: true,
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

  /**
   * 실측(2026-08): '증빙서류 발급 > 영수증' 에서 [신용카드 매출전표] 를 누르면 아래 폼 POST 가 나간다.
   *   POST https://buy.11st.co.kr/remittance/documentaryEvidencePop.tmall
   *   method=displayCardPop&ordNo=...&ordPrdSeq=1&prdSeqCnt=&prdSeq=0&prdTypCd=01&prfItmClfCd=
   * 이쪽이 세무 증빙으로 쓰는 문서라 수집 대상은 이것이다(위 결제영수증은 효력 없음).
   *
   * ⚠ ordPrdSeq 는 주문 내 상품 순번으로 보인다. 한 주문에 상품이 여러 개일 때 어떻게 되는지는
   *   아직 확인되지 않아 1 로 고정해 뒀다.
   */
  receiptRequest: {
    url: "https://buy.11st.co.kr/remittance/documentaryEvidencePop.tmall",
    fields: {
      method: "displayCardPop",
      ordNo: "{ordNo}",
      ordPrdSeq: "1",
      prdSeqCnt: "",
      prdSeq: "0",
      prdTypCd: "01",
      prfItmClfCd: "",
    },
    refererUrl: "https://buy.11st.co.kr/my11st/remittance/documentaryEvidence.tmall?method=displayDocumentaryEvidenceIssue",
  },
  receiptLabel: "신용카드매출전표",

  /**
   * 실측(2026-08): '증빙서류 발급 > 영수증' 의 기간 조회 파라미터.
   * 조회 후 세션이 끊겼을 때 로그인 페이지의 returnURL 에 그대로 실려 나온 값에서 확보했다.
   *   ...documentaryEvidence.tmall?method=displayDocumentaryEvidenceIssue&docTyp=ord
   *   &stDate=20240701&endDate=20260821&startYY=2024&startMM=07&startDD=01
   *   &endYY=2026&endMM=08&endDD=21&pageNo=1&limit=10
   *
   * limit 을 키워 한 번에 많이 받고, 그래도 넘치면 pageNo 를 올린다(목록의 '다음' 버튼에 기대지 않는다).
   * 전표를 뽑는 화면이 바로 여기라 주문목록(OrderList.tmall)보다 이쪽이 수집 시작점으로 알맞다.
   */
  listRequest: {
    url: "https://buy.11st.co.kr/my11st/remittance/documentaryEvidence.tmall",
    method: "GET",
    fields: {
      method: "displayDocumentaryEvidenceIssue",
      docTyp: "ord",
      stDate: "{from}",
      endDate: "{to}",
      startYY: "{fromYYYY}",
      startMM: "{fromMM}",
      startDD: "{fromDD}",
      endYY: "{toYYYY}",
      endMM: "{toMM}",
      endDD: "{toDD}",
      pageNo: "{page}",
      limit: "100",
    },
    dateFormat: "YYYYMMDD",
  },
};

/**
 * G마켓.
 * - 증빙 경로(고객센터 안내): 나의 G마켓 > 주문내역 > [영수증/계산서조회], 또는 주문상세의 [카드전표].
 *   신용카드 구매분은 카드매출전표가 자동 발급되고, 이것이 매입세액공제용 적격증빙이다.
 * - 영수증 전용 도메인 `receipt.gmarket.co.kr` 이 따로 있다.
 *
 * ⚠ 아래 주소·패턴은 **실측 전 추정값**이다. `login` 후 `probe` 로 실제 값을 확인해
 *   site-config.json 에 덮어쓰거나 이 파일을 고친다. 특히 아직 모르는 것:
 *     - 주문목록/증빙 화면의 실제 주소와 기간 조회 파라미터(listRequest)
 *     - 카드전표를 여는 방법(주소 직접 열기인지 폼 POST 인지) → receiptUrlTemplate / receiptRequest
 *     - 주문번호 형식(11번가와 달리 날짜가 들어 있지 않을 가능성이 높다)
 */
export const GMARKET: SiteConfig = {
  key: "gmarket",
  name: "G마켓",
  // 로그인 주소는 수시로 바뀌므로 메인에서 사용자가 직접 로그인하게 둔다(어차피 사람이 조작한다).
  loginUrl: "https://www.gmarket.co.kr/",
  orderListUrl: "https://myg.gmarket.co.kr/Order/OrderList",
  checkUrl: "https://myg.gmarket.co.kr/Order/OrderList",
  loggedOutPattern: "login|signin|member\\.gmarket\\.co\\.kr/Login",
  receiptKeywords: ["카드전표", "신용카드 매출전표", "영수증/계산서", "영수증", "거래명세서"],
  orderRowSelectors: [
    "table[class*='order'] tbody tr",
    "[class*='order_list'] > li",
    "[class*='orderList'] > li",
    "li[class*='order']",
  ],
  nextPageSelectors: ["a:has-text('다음')", "[class*='paging'] a[class*='next']", "button:has-text('다음')"],
  // 주문번호 형식 미상 — 우선 넓게 잡고 probe 결과로 좁힌다.
  orderNoPattern: "\\b\\d{9,20}\\b",
  // 실측(2026-08): 접속하면 Cloudflare 봇 확인 화면이 뜬다. 지문을 건드리지 않고 headed 로 돌아야 한다.
  stealth: true,
};

/**
 * 옥션 — G마켓과 같은 계열(신세계 지마켓)이라 구조가 비슷할 것으로 보고 같은 골격으로 둔다.
 * 증빙 경로(고객센터 안내): 마이 옥션 > 주문에서 [신용카드영수증 출력].
 * 카드 결제분은 신용카드 매출전표, 계좌이체분은 현금영수증으로 나뉜다.
 *
 * ⚠ 주소·패턴은 실측 전 추정값. G마켓과 마찬가지로 `login` → `probe` 로 확인해 채운다.
 */
export const AUCTION: SiteConfig = {
  key: "auction",
  name: "옥션",
  loginUrl: "https://www.auction.co.kr/",
  orderListUrl: "https://myauction.auction.co.kr/",
  checkUrl: "https://myauction.auction.co.kr/",
  loggedOutPattern: "login|signin|memberssl\\.auction\\.co\\.kr",
  receiptKeywords: ["신용카드영수증", "신용카드 매출전표", "카드전표", "구매영수증", "영수증", "거래명세서"],
  orderRowSelectors: [
    "table[class*='order'] tbody tr",
    "[class*='order_list'] > li",
    "[class*='orderList'] > li",
    "li[class*='order']",
  ],
  nextPageSelectors: ["a:has-text('다음')", "[class*='paging'] a[class*='next']", "button:has-text('다음')"],
  orderNoPattern: "\\b\\d{9,20}\\b",
  // G마켓이 Cloudflare 봇 확인을 쓰므로 같은 계열인 옥션도 켜 둔다(불필요하면 꺼도 동작에는 지장 없다).
  stealth: true,
};

const SITES: Record<string, SiteConfig> = {
  [ELEVEN_ST.key]: ELEVEN_ST,
  [GMARKET.key]: GMARKET,
  [AUCTION.key]: AUCTION,
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
