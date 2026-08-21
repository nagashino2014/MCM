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

/**
 * 프로필과 별개로 보관하는 쿠키 파일.
 * Chromium 은 만료 없는 **세션 쿠키를 디스크에 저장하지 않는다** — 프로필만 재사용하면
 * 브라우저를 닫는 순간 로그인이 풀린다. 그래서 쿠키는 따로 떠서 다음 실행에 주입한다.
 * (쿠키만 읽는 context.cookies() 는 storageState 와 달리 임시 페이지를 열지 않아 창이 깜빡이지 않는다)
 */
export function cookiesFile(site: string): string {
  return path.join(siteDir(site), "cookies.json");
}

/**
 * 세션이 **실제로 살아 있는지** 마지막으로 확인한 결과.
 *
 * 쿠키 파일이 있다고 로그인이 유지되는 것은 아니다 — 만료되거나(하루쯤), 도메인이 갈려
 * (G마켓: gmarket.co.kr 은 되는데 receipt.gmarket.co.kr 은 다시 로그인 요구) 튕기기도 한다.
 * 그래서 접근해 본 결과를 남겨 두고 화면은 그것을 보여 준다.
 * check 뿐 아니라 collect·bulk 도 결과를 남기므로 수집 한 번이 곧 세션 확인이 된다.
 */
export interface SessionCheck {
  ok: boolean;
  checkedAt: string;
  url?: string;
  reason?: string;
}

export function sessionCheckFile(site: string): string {
  return path.join(siteDir(site), "session-check.json");
}

export function saveSessionCheck(site: string, ok: boolean, detail?: { url?: string; reason?: string }): void {
  try {
    ensureSiteDir(site);
    const body: SessionCheck = { ok, checkedAt: new Date().toISOString(), ...detail };
    fs.writeFileSync(sessionCheckFile(site), JSON.stringify(body, null, 2), "utf-8");
  } catch {
    // 기록에 실패해도 수집 자체는 계속한다.
  }
}

/** 로그인을 새로 했을 때처럼 이전 판정이 더는 유효하지 않은 경우 지운다(=확인 필요 상태) */
export function clearSessionCheck(site: string): void {
  try {
    fs.rmSync(sessionCheckFile(site), { force: true });
  } catch {
    // 없으면 그만이다.
  }
}

export function readSessionCheck(site: string): SessionCheck | null {
  try {
    return JSON.parse(fs.readFileSync(sessionCheckFile(site), "utf-8")) as SessionCheck;
  } catch {
    return null;
  }
}

/** 로그인한 적이 있는지 — 프로필이 만들어져 있으면 참(유효성은 checkSession 으로 확인) */
export function hasSession(site: string): boolean {
  return fs.existsSync(path.join(profileDir(site), "Default")) || fs.existsSync(cookiesFile(site));
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
  /**
   * 봇 확인(Cloudflare Turnstile 등)이 있는 사이트용.
   * - UA·viewport 를 덮어쓰지 않는다. 덮어쓴 UA 는 브라우저가 함께 보내는 Client Hints 와 어긋나
   *   그 모순 자체가 봇 신호가 된다.
   * - 자동화 표식(navigator.webdriver, AutomationControlled)을 숨기고, 가능하면 실제 설치된 Chrome 을 쓴다.
   * - headless 는 거의 확실히 막히므로 호출부에서 headed 로 돌린다.
   */
  stealth?: boolean;
}): Promise<{ context: BrowserContext; close: () => Promise<void> }> {
  const { site, headless = true, useSession = true, acceptDownloads = true, stealth = false } = opts;

  if (useSession && !hasSession(site)) {
    throw new Error(
      `로그인 프로필이 없습니다: ${profileDir(site)}\n먼저 'npm run receipts -- login --site ${site}' 를 실행하세요.`
    );
  }

  const launchOptions: Record<string, unknown> = {
    headless,
    timeout: 60_000,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    acceptDownloads,
    ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
  };

  if (stealth) {
    launchOptions.args = ["--disable-blink-features=AutomationControlled"];
    launchOptions.viewport = null;
    // 번들 Chromium 보다 실제 Chrome 이 지문상 유리하다(설치돼 있을 때만).
    if (!CHROME_PATH) launchOptions.channel = "chrome";
  } else {
    launchOptions.userAgent = USER_AGENT;
    launchOptions.viewport = { width: 1600, height: 1000 };
  }

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(profileDir(site), launchOptions as never);
  } catch (e) {
    if (!launchOptions.channel) throw e;
    console.log(`[${site}] 설치된 Chrome 을 찾지 못해 번들 Chromium 으로 실행합니다(봇 확인을 통과하지 못할 수 있음).`);
    delete launchOptions.channel;
    context = await chromium.launchPersistentContext(profileDir(site), launchOptions as never);
  }

  if (stealth) {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
  }

  context.setDefaultTimeout(60_000);

  // 프로필이 잃어버린 세션 쿠키를 되살린다.
  if (useSession && fs.existsSync(cookiesFile(site))) {
    try {
      const cookies = JSON.parse(fs.readFileSync(cookiesFile(site), "utf-8"));
      if (Array.isArray(cookies) && cookies.length > 0) await context.addCookies(cookies);
    } catch {
      console.log(`[${site}] ⚠ 쿠키 파일을 읽지 못했습니다: ${cookiesFile(site)}`);
    }
  }

  return { context, close: () => context.close().catch(() => {}) };
}

/**
 * 대화형 로그인 — headed 브라우저를 띄우고 사용자가 직접 로그인한 뒤 창을 닫으면 끝난다.
 * - 프로필에 자동 저장되므로 주기적으로 세션을 떠낼 필요가 없다(그 폴링이 창 깜빡임의 원인이었다).
 * - 창을 닫는 순간의 URL 을 주문목록 후보로 함께 돌려준다(계정별로 주소가 다를 수 있어서).
 */
export async function interactiveLogin(
  site: string,
  startUrl: string,
  stealth = false,
  loggedOutPattern?: string
): Promise<{ saved: boolean; lastUrl: string | null }> {
  ensureSiteDir(site);

  const { context } = await openContext({ site, headless: false, useSession: false, stealth });

  // 사용자가 로그인하는 동안 페이지 스크립트가 창을 닫아버리는 경우가 있다(네이버).
  // 로그인 창은 사람이 닫는 것이 종료 신호이므로, 스크립트발 close 는 막는다.
  await context.addInitScript(() => {
    try {
      window.close = () => {};
    } catch {
      // 막지 못해도 로그인 자체에는 지장이 없다
    }
  });

  const openedAt = Date.now();

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

    console.log(`[${site}] 브라우저가 열렸습니다.`);
    console.log(`[${site}] 창에서 직접 로그인하세요(캡차·2차인증 포함). 스크립트는 계정 정보를 저장하지 않습니다.`);
    console.log(`[${site}] 로그인 후 주문목록(주문/배송조회) 화면까지 이동한 뒤 창을 닫으세요.`);
    console.log(`[${site}] 로그인 상태는 프로필에 저장됩니다: ${profileDir(site)}`);

    // 주소와 쿠키만 가볍게 따라간다(페이지를 새로 만들지 않으므로 창이 깜빡이지 않는다).
    let lastUrl: string | null = null;
    const timer = setInterval(async () => {
      try {
        const pages = context.pages().filter((p) => !p.isClosed());
        if (pages.length > 0) lastUrl = pages[pages.length - 1].url();

        const cookies = await context.cookies();
        if (cookies.length > 0) fs.writeFileSync(cookiesFile(site), JSON.stringify(cookies, null, 2), "utf-8");
      } catch {
        // 브라우저 종료 중이면 무시
      }
    }, 2000);

    await waitForContextClose(context);
    clearInterval(timer);

    // 창을 닫는 순간 로그인 화면이었다면 로그인이 끝나지 않은 것이다 — 그대로 두면
    // 다음 명령이 "세션 만료"로 보여 원인을 오해하기 쉽다.
    const stillOnLogin = Boolean(lastUrl && loggedOutPattern && new RegExp(loggedOutPattern, "i").test(lastUrl));
    const openSeconds = Math.round((Date.now() - openedAt) / 1000);

    // 로그인할 시간도 없이 닫혔다면 사람이 닫은 게 아니다 — 원인을 짚어 준다.
    if (openSeconds < 20) {
      console.log(`[${site}] ⚠ 창이 ${openSeconds}초 만에 닫혔습니다. 사람이 닫은 것이 아니라면:`);
      console.log(`[${site}]   · 사이트가 자동화를 감지해 창을 닫았을 수 있습니다(네이버가 그렇습니다).`);
      console.log(`[${site}]   · 같은 사이트의 다른 명령이 아직 돌고 있으면 프로필이 잠겨 바로 종료됩니다.`);
      console.log(`[${site}]   · RECEIPTS_CHROME_PATH 로 실제 Chrome 을 지정하면 나아지는 경우가 있습니다.`);
    }
    let cookieCount = 0;
    try {
      cookieCount = JSON.parse(fs.readFileSync(cookiesFile(site), "utf-8")).length;
    } catch {
      cookieCount = 0;
    }

    console.log(`[${site}] 로그인 프로필 저장 완료: ${profileDir(site)}`);
    console.log(`[${site}] 세션 쿠키 ${cookieCount}개 저장: ${cookiesFile(site)}`);

    // 로그인 창을 닫았다고 대상 화면까지 열린다는 보장은 없다(도메인이 갈리는 사이트가 있다).
    // 그래서 성공을 단정하지 않고 이전 판정을 지워 '확인 필요' 로 되돌린다.
    if (stillOnLogin) {
      saveSessionCheck(site, false, { url: lastUrl ?? undefined, reason: "로그인 창을 닫을 때 아직 로그인 페이지였습니다" });
    } else {
      clearSessionCheck(site);
    }

    if (stillOnLogin) {
      console.log(`[${site}] ⚠ 창을 닫을 때 화면이 아직 로그인 페이지였습니다: ${lastUrl}`);
      console.log(`[${site}]   로그인을 끝내고 목록 화면이 보이는 상태에서 창을 닫아야 세션이 남습니다.`);
      console.log(`[${site}]   'npm run receipts -- login --site ${site}' 를 다시 실행해 주세요.`);
    }
    console.log(`[${site}] ⚠ 이 디렉터리는 로그인 상태 그 자체입니다. 외부 공유·커밋 금지(.gitignore 등록됨).`);

    return { saved: !stillOnLogin && (hasSession(site) || fs.existsSync(cookiesFile(site))), lastUrl };
  } finally {
    await context.close().catch(() => {});
  }
}

/** 저장된 세션이 아직 유효한지 확인(로그인 페이지로 튕기는지 검사) */
export async function checkSession(
  site: string,
  url: string,
  loggedOutPattern: string,
  headless = true,
  stealth = false
): Promise<boolean> {
  const { context, close } = await openContext({ site, headless, useSession: true, stealth });
  try {
    const page = context.pages()[0] || (await context.newPage());
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2000);

    const finalUrl = page.url();
    const looksLoggedOut = new RegExp(loggedOutPattern, "i").test(finalUrl);
    console.log(`[${site}] 최종 URL: ${finalUrl} (HTTP ${res?.status()})`);
    saveSessionCheck(site, !looksLoggedOut, { url: finalUrl });
    return !looksLoggedOut;
  } finally {
    await close();
  }
}
