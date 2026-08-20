/**
 * 전자상거래 영수증 수집 — 세션 관리
 *
 * - 로그인은 **사용자가 직접** headed 브라우저에서 수행한다(캡차·2차인증 포함).
 *   쿠팡·네이버는 물론 11번가도 자동 입력을 봇으로 판정할 수 있어, 스크립트는
 *   계정 정보를 다루지 않고 로그인 **이후의 세션 상태(storageState)** 만 저장한다.
 * - 저장된 세션으로 이후 수집(주문목록 순회 · 영수증 PDF 저장)을 반자동 실행한다.
 * - 세션 파일은 로그인 상태 그 자체다. `data/receipts/` 는 .gitignore 대상.
 */

import path from "node:path";
import fs from "node:fs";
import { chromium, Browser, BrowserContext } from "playwright";

const SCRAPER_ROOT = path.resolve(__dirname, "..", "..");
const MCM_ROOT = path.resolve(SCRAPER_ROOT, "..");

/** 영수증 수집 산출물 루트 — 세션·영수증 PDF·대장 전부 이 아래. (git 제외 대상) */
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

function launchOptions(headless: boolean): Record<string, unknown> {
  return {
    headless,
    timeout: 60_000,
    ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
  };
}

export function siteDir(site: string): string {
  return path.join(RECEIPTS_DIR, site);
}

export function sessionFile(site: string): string {
  return path.join(siteDir(site), "session.json");
}

export function ensureSiteDir(site: string, sub?: string): string {
  const dir = sub ? path.join(siteDir(site), sub) : siteDir(site);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function hasSession(site: string): boolean {
  return fs.existsSync(sessionFile(site));
}

/**
 * 브라우저 창이 닫힐 때까지 대기.
 * - npm 스크립트를 경유하면 Windows 에서 stdin(Enter) 이 자식 프로세스로 전달되지 않는 경우가 있어
 *   "Enter 입력" 대신 "창 닫기"를 종료 신호로 쓴다. (lib/daou/session.ts 와 동일한 이유)
 */
export function waitForBrowserClose(browser: Browser): Promise<void> {
  return new Promise((resolve) => {
    if (!browser.isConnected()) return resolve();
    browser.on("disconnected", () => resolve());
  });
}

/**
 * 브라우저 컨텍스트 생성.
 * - useSession=true 면 저장된 세션을 로드한다(없으면 예외).
 * - ⚠ headless=true 여야 page.pdf() 를 쓸 수 있다(Playwright 제약). 다만 사이트가 headless 를
 *   탐지해 튕기면 headless=false 로 돌리고 CDP 폴백으로 PDF 를 만든다(lib/receipts/pdf.ts 참고).
 */
export async function openContext(opts: {
  site: string;
  headless?: boolean;
  useSession?: boolean;
  acceptDownloads?: boolean;
}): Promise<{ browser: Browser; context: BrowserContext }> {
  const { site, headless = true, useSession = true, acceptDownloads = true } = opts;

  if (useSession && !hasSession(site)) {
    throw new Error(
      `세션 파일이 없습니다: ${sessionFile(site)}\n먼저 'npm run receipts -- login --site ${site}' 를 실행하세요.`
    );
  }

  const browser = await chromium.launch(launchOptions(headless));
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1600, height: 1000 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    acceptDownloads,
    storageState: useSession ? sessionFile(site) : undefined,
  });
  context.setDefaultTimeout(60_000);

  return { browser, context };
}

/**
 * 대화형 로그인 — headed 브라우저를 띄우고 사용자가 직접 로그인한 뒤 세션을 저장한다.
 * - 창을 닫는 순간의 URL 을 주문목록 후보로 함께 돌려준다(계정별로 주소가 다를 수 있어서).
 */
export async function interactiveLogin(
  site: string,
  startUrl: string
): Promise<{ saved: boolean; lastUrl: string | null }> {
  ensureSiteDir(site);

  const browser = await chromium.launch(launchOptions(false));
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1600, height: 1000 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });

  try {
    const page = await context.newPage();
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

    console.log(`[${site}] 브라우저가 열렸습니다.`);
    console.log(`[${site}] 창에서 직접 로그인하세요(캡차·2차인증 포함). 스크립트는 계정 정보를 저장하지 않습니다.`);
    console.log(`[${site}] 로그인 후 주문목록(주문/배송조회) 화면까지 이동한 뒤 창을 닫으세요.`);
    console.log(`[${site}] 창을 닫는 순간의 주소를 주문목록 URL 로 기록합니다.`);

    // 3초마다 현재 세션·URL 을 갱신 — 창을 닫는 순간의 상태가 남는다.
    let saved = 0;
    let lastUrl: string | null = null;
    const timer = setInterval(async () => {
      try {
        await context.storageState({ path: sessionFile(site) });
        const pages = context.pages();
        if (pages.length > 0) lastUrl = pages[pages.length - 1].url();
        saved++;
        if (saved === 1) console.log(`[${site}] 세션 저장 시작: ${sessionFile(site)}`);
      } catch {
        // 브라우저 종료 중이면 무시
      }
    }, 3000);

    await waitForBrowserClose(browser);
    clearInterval(timer);

    if (saved > 0) {
      console.log(`[${site}] 세션 저장 완료: ${sessionFile(site)}`);
      console.log(`[${site}] ⚠ 이 파일은 로그인 상태 그 자체입니다. 외부 공유·커밋 금지(.gitignore 등록됨).`);
    } else {
      console.log(`[${site}] ❌ 세션이 저장되지 않았습니다. 다시 실행해 주세요.`);
    }

    return { saved: saved > 0, lastUrl };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/** 저장된 세션이 아직 유효한지 확인(로그인 페이지로 튕기는지 검사) */
export async function checkSession(
  site: string,
  url: string,
  loggedOutPattern: string,
  headless = true
): Promise<boolean> {
  const { browser, context } = await openContext({ site, headless, useSession: true });
  try {
    const page = await context.newPage();
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2000);

    const finalUrl = page.url();
    const looksLoggedOut = new RegExp(loggedOutPattern, "i").test(finalUrl);
    console.log(`[${site}] 최종 URL: ${finalUrl} (HTTP ${res?.status()})`);
    return !looksLoggedOut;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
