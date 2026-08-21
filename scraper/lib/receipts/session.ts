/**
 * 전자상거래 영수증 수집 — 세션 관리
 *
 * - 로그인은 **사용자가 직접** headed 브라우저에서 수행한다(캡차·2차인증 포함).
 *   쿠팡·네이버는 물론 11번가도 자동 입력을 봇으로 판정할 수 있어, 스크립트는
 *   계정 정보를 다루지 않고 로그인 **이후의 브라우저 프로필**만 재사용한다.
 * - 세션은 storageState 파일이 아니라 **브라우저 프로필 디렉터리**(persistent context)에 담는다.
 *   storageState 방식은 저장할 때마다 Playwright 가 origin 마다 임시 페이지를 열고 닫아
 *   headed 로그인 중 창이 깜빡였고, 쿠키 외 저장소가 온전히 보존되지도 않았다.
 * - 프로필은 로그인 상태 그 자체다. `data/receipts/` 는 .gitignore 대상.
 */

import path from "node:path";
import fs from "node:fs";
import { chromium, BrowserContext } from "playwright";

const SCRAPER_ROOT = path.resolve(__dirname, "..", "..");
const MCM_ROOT = path.resolve(SCRAPER_ROOT, "..");

/** 영수증 수집 산출물 루트 — 프로필·영수증 PDF·대장 전부 이 아래. (git 제외 대상) */
export const RECEIPTS_DIR = path.join(MCM_ROOT, "data", "receipts");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * 실행할 브라우저 바이너리 경로(선택).
 * - 번들 Chromium 보다 **실제 설치된 Chrome** 이 봇 탐지를 덜 받는 경우가 있어 갈아끼울 수 있게 뒀다.
 *   예) RECEIPTS_CHROME_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
 * - 지정하지 않으면 Playwright 번들 Chromium 을 쓴다.
 */
const CHROME_PATH = process.env.RECEIPTS_CHROME_PATH;

export function siteDir(site: string): string {
  return path.join(RECEIPTS_DIR, site);
}

/** 로그인 상태가 담기는 브라우저 프로필 디렉터리 */
export function profileDir(site: string): string {
  return path.join(siteDir(site), "browser-profile");
}

export function ensureSiteDir(site: string, sub?: string): string {
  const dir = sub ? path.join(siteDir(site), sub) : siteDir(site);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 로그인한 적이 있는지 — 프로필이 만들어져 있으면 참(유효성은 checkSession 으로 확인) */
export function hasSession(site: string): boolean {
  return fs.existsSync(path.join(profileDir(site), "Default"));
}

/** 브라우저 창이 닫힐 때까지 대기(창 닫기를 종료 신호로 쓴다) */
export function waitForContextClose(context: BrowserContext): Promise<void> {
  return new Promise((resolve) => {
    context.on("close", () => resolve());
  });
}

/**
 * 브라우저 컨텍스트 생성(로그인 프로필 재사용).
 * - ⚠ headless=true 여야 page.pdf() 를 쓸 수 있다(Playwright 제약). 사이트가 headless 를 막으면
 *   headless=false 로 돌리고 CDP 폴백으로 PDF 를 만든다(lib/receipts/pdf.ts 참고).
 * - 프로필 디렉터리는 한 번에 한 프로세스만 쓸 수 있다 — 같은 사이트를 동시에 돌리지 말 것.
 */
export async function openContext(opts: {
  site: string;
  headless?: boolean;
  useSession?: boolean;
  acceptDownloads?: boolean;
}): Promise<{ context: BrowserContext; close: () => Promise<void> }> {
  const { site, headless = true, useSession = true, acceptDownloads = true } = opts;

  if (useSession && !hasSession(site)) {
    throw new Error(
      `로그인 프로필이 없습니다: ${profileDir(site)}\n먼저 'npm run receipts -- login --site ${site}' 를 실행하세요.`
    );
  }

  const context = await chromium.launchPersistentContext(profileDir(site), {
    headless,
    timeout: 60_000,
    userAgent: USER_AGENT,
    viewport: { width: 1600, height: 1000 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    acceptDownloads,
    ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
  });
  context.setDefaultTimeout(60_000);

  return { context, close: () => context.close().catch(() => {}) };
}

/**
 * 대화형 로그인 — headed 브라우저를 띄우고 사용자가 직접 로그인한 뒤 창을 닫으면 끝난다.
 * - 프로필에 자동 저장되므로 주기적으로 세션을 떠낼 필요가 없다(그 폴링이 창 깜빡임의 원인이었다).
 * - 창을 닫는 순간의 URL 을 주문목록 후보로 함께 돌려준다(계정별로 주소가 다를 수 있어서).
 */
export async function interactiveLogin(
  site: string,
  startUrl: string
): Promise<{ saved: boolean; lastUrl: string | null }> {
  ensureSiteDir(site);

  const { context } = await openContext({ site, headless: false, useSession: false });

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

    console.log(`[${site}] 브라우저가 열렸습니다.`);
    console.log(`[${site}] 창에서 직접 로그인하세요(캡차·2차인증 포함). 스크립트는 계정 정보를 저장하지 않습니다.`);
    console.log(`[${site}] 로그인 후 주문목록(주문/배송조회) 화면까지 이동한 뒤 창을 닫으세요.`);
    console.log(`[${site}] 로그인 상태는 프로필에 저장됩니다: ${profileDir(site)}`);

    // 열린 페이지의 주소만 가볍게 따라간다(페이지를 새로 만들지 않으므로 창이 깜빡이지 않는다).
    let lastUrl: string | null = null;
    const timer = setInterval(() => {
      const pages = context.pages().filter((p) => !p.isClosed());
      if (pages.length > 0) lastUrl = pages[pages.length - 1].url();
    }, 2000);

    await waitForContextClose(context);
    clearInterval(timer);

    console.log(`[${site}] 로그인 프로필 저장 완료: ${profileDir(site)}`);
    console.log(`[${site}] ⚠ 이 디렉터리는 로그인 상태 그 자체입니다. 외부 공유·커밋 금지(.gitignore 등록됨).`);

    return { saved: hasSession(site), lastUrl };
  } finally {
    await context.close().catch(() => {});
  }
}

/** 저장된 세션이 아직 유효한지 확인(로그인 페이지로 튕기는지 검사) */
export async function checkSession(
  site: string,
  url: string,
  loggedOutPattern: string,
  headless = true
): Promise<boolean> {
  const { context, close } = await openContext({ site, headless, useSession: true });
  try {
    const page = context.pages()[0] || (await context.newPage());
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2000);

    const finalUrl = page.url();
    const looksLoggedOut = new RegExp(loggedOutPattern, "i").test(finalUrl);
    console.log(`[${site}] 최종 URL: ${finalUrl} (HTTP ${res?.status()})`);
    return !looksLoggedOut;
  } finally {
    await close();
  }
}
