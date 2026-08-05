/**
 * 다우오피스 세션 관리
 * - 로그인은 **사용자가 직접** headed 브라우저에서 수행한다(2FA 포함).
 *   스크립트는 로그인 후의 세션 상태(storageState)만 저장하며 계정 정보는 보관하지 않는다.
 * - 저장된 세션으로 이후 수집(목록/문서/첨부)을 무인 실행한다.
 */

import path from "node:path";
import fs from "node:fs";
import { chromium, Browser, BrowserContext } from "playwright";

const SCRAPER_ROOT = path.resolve(__dirname, "..", "..");
const MCM_ROOT = path.resolve(SCRAPER_ROOT, "..");

/** 반출 산출물 루트 — 세션·목록·원문·첨부 전부 이 아래. (git 제외 대상) */
export const DAOU_DIR = path.join(MCM_ROOT, "data", "daou");
export const SESSION_FILE = path.join(DAOU_DIR, "session.json");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export function ensureDaouDir(sub?: string): string {
  const dir = sub ? path.join(DAOU_DIR, sub) : DAOU_DIR;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function hasSession(): boolean {
  return fs.existsSync(SESSION_FILE);
}

/**
 * 브라우저 창이 닫힐 때까지 대기.
 * - npm 스크립트를 경유하면 Windows 에서 stdin(Enter) 이 자식 프로세스로 전달되지 않는 경우가 있어
 *   "Enter 입력" 대신 "창 닫기"를 종료 신호로 쓴다.
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
 */
export async function openContext(opts: {
  headless?: boolean;
  useSession?: boolean;
  acceptDownloads?: boolean;
}): Promise<{ browser: Browser; context: BrowserContext }> {
  const { headless = true, useSession = true, acceptDownloads = false } = opts;

  if (useSession && !hasSession()) {
    throw new Error(`세션 파일이 없습니다: ${SESSION_FILE}\n먼저 'npm run daou -- login --url <다우주소>' 를 실행하세요.`);
  }

  const browser = await chromium.launch({ headless, timeout: 60_000 });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1600, height: 1000 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    acceptDownloads,
    storageState: useSession ? SESSION_FILE : undefined,
  });
  context.setDefaultTimeout(60_000);

  return { browser, context };
}

/**
 * 대화형 로그인 — headed 브라우저를 띄우고 사용자가 직접 로그인한 뒤 세션을 저장한다.
 */
export async function interactiveLogin(baseUrl: string): Promise<void> {
  ensureDaouDir();

  const browser = await chromium.launch({ headless: false, timeout: 60_000 });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1600, height: 1000 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });

  try {
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

    console.log("[DAOU] 브라우저가 열렸습니다.");
    console.log("[DAOU] 브라우저 창에서 직접 로그인하세요(2FA 포함). 스크립트는 계정 정보를 저장하지 않습니다.");
    console.log("[DAOU] 로그인 후에는 세션이 자동 저장됩니다. 다 되면 브라우저 창을 닫으세요.");

    // 3초마다 현재 세션을 덮어써 저장 — 창을 닫는 순간의 상태가 남는다.
    let saved = 0;
    const timer = setInterval(async () => {
      try {
        await context.storageState({ path: SESSION_FILE });
        saved++;
        if (saved === 1) console.log(`[DAOU] 세션 저장 시작: ${SESSION_FILE}`);
      } catch {
        // 브라우저 종료 중이면 무시
      }
    }, 3000);

    await waitForBrowserClose(browser);
    clearInterval(timer);

    if (saved > 0) {
      console.log(`[DAOU] 세션 저장 완료: ${SESSION_FILE}`);
      console.log("[DAOU] ⚠ 이 파일은 로그인 상태 그 자체입니다. 외부 공유·커밋 금지(.gitignore 등록됨).");
    } else {
      console.log("[DAOU] ❌ 세션이 저장되지 않았습니다. 다시 실행해 주세요.");
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/** 저장된 세션이 아직 유효한지 확인(로그인 페이지로 튕기는지 검사) */
export async function checkSession(baseUrl: string): Promise<boolean> {
  const { browser, context } = await openContext({ headless: true, useSession: true });
  try {
    const page = await context.newPage();
    const res = await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2000);

    const url = page.url();
    const looksLoggedOut = /login|signin|sso/i.test(url);
    console.log(`[DAOU] 최종 URL: ${url} (HTTP ${res?.status()})`);
    return !looksLoggedOut;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
