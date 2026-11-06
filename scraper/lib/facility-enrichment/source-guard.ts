import type { Page } from "playwright";
import { rows, type Database } from "../facility-quality/store";
import { ProviderError } from "./public-api";
import type { Navigate } from "./browser";

/** 외부 정보원 일일 한도·접속 간격·차단 감지. 사업장 전수 점검과 연락처 가져오기가 같은 한도를 나눠 쓴다. */
export function createSourceGuard(db: Database) {
  let lastNavigation = 0;
  async function budget(source: string) {
    const max = Math.max(1, Math.min(10000, Number(process.env[`FACILITY_QUALITY_${source.toUpperCase()}_DAILY_LIMIT`] || (source === "bizno" ? 100 : 600))));
    const reserved = await rows(db, `INSERT INTO facility_quality_source_requests(source,day,requests) VALUES($1,CURRENT_DATE,1)
      ON CONFLICT(source,day) DO UPDATE SET requests=facility_quality_source_requests.requests+1 WHERE facility_quality_source_requests.requests<$2 RETURNING requests`, [source, max]);
    if (!reserved.length) throw new ProviderError("quota", "일일 조회 한도 도달");
  }
  const navigate: Navigate = async (page: Page, url, source) => {
    await budget(source);
    const delay = Math.max(1500, Number(process.env.FACILITY_QUALITY_INTERVAL_MS || 3000));
    const remaining = lastNavigation + delay - Date.now();
    if (remaining > 0) await new Promise(r => setTimeout(r, remaining));
    lastNavigation = Date.now();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    if ([401,403,429].includes(response?.status() ?? 200)) throw new ProviderError("blocked", "정보원 접근 제한");
    if (response && response.status() >= 400) throw new ProviderError("error", "정보원 응답 오류");
    // 차단 화면을 우회하거나 CAPTCHA를 풀지 않는다. 전체 업체 본문을 읽거나 로그에 남기지 않는다.
    const blocked = await page.locator('input[name*="captcha"], iframe[src*="captcha"], #captcha').count();
    const title = await page.title();
    const blockText = await page.getByText(/자동입력 방지|비정상적인 접근|접근이 제한|보안 확인을 완료/i).first().isVisible().catch(() => false);
    if (blocked || blockText || /접근.{0,5}제한|보안.?확인|access denied|captcha/i.test(title)) throw new ProviderError("blocked", "자동조회 제한으로 수동 확인 필요");
  };
  return { budget, navigate };
}
