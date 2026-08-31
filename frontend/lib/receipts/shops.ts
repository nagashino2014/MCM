/**
 * 전자상거래 전표 수집 — 앱에서 쓰는 사이트 목록·경로
 *
 * 실제 수집은 `scraper/` 의 CLI 가 한다(로그인 세션이 이 PC 의 브라우저 프로필에 있기 때문).
 * 이 파일은 화면과 API 가 공유하는 최소 정보만 갖는다 — 자세한 사이트 설정은 scraper/lib/receipts/config.ts.
 */

import path from "node:path";

export interface ShopInfo {
  key: string;
  name: string;
  /** 전표를 받는 방식 — 화면 안내 문구에 쓴다 */
  mode: "collect" | "bulk";
  hint?: string;
}

export const SHOPS: ShopInfo[] = [
  { key: "11st", name: "11번가", mode: "collect" },
  { key: "gmarket", name: "G마켓", mode: "collect" },
  { key: "auction", name: "옥션", mode: "collect", hint: "1년이 지난 건은 발급이 막혀 있습니다" },
  { key: "naver", name: "네이버페이", mode: "collect" },
  {
    key: "coupang",
    name: "쿠팡",
    mode: "bulk",
    hint: "쿠팡 화면에서 기간을 지정해 일괄 신청한 뒤, 신청 ID 로 받습니다",
  },
];

export function shopByKey(key: string): ShopInfo | undefined {
  return SHOPS.find((s) => s.key === key);
}

/** 리포 루트 — 프론트는 frontend/ 에서 돌아간다 */
export function repoRoot(): string {
  return path.resolve(process.cwd(), "..");
}

export function scraperDir(): string {
  return path.join(repoRoot(), "scraper");
}

export function receiptsDir(): string {
  return path.join(repoRoot(), "data", "receipts");
}

export function shopDir(key: string): string {
  return path.join(receiptsDir(), key);
}

/**
 * 이 기능은 **로컬에서 띄운 앱에서만** 쓸 수 있다.
 * 로그인 세션과 브라우저가 사용자 PC 에 있어서, 배포 서버에서는 실행할 방법이 없다.
 * 실행 스크립트(scripts/receipts-app)가 이 환경변수를 켜 준다.
 */
export function localToolsEnabled(): boolean {
  return process.env.RECEIPTS_LOCAL_TOOLS === "1";
}
