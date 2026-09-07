/**
 * 사이트 브라우저 세션 — 로그인은 **사람이 직접**(IEPS 문자인증, ETIS 공동인증서) headed 창에서 하고,
 * 이후 실행은 브라우저 프로필(persistent context) + 따로 떠 둔 세션 쿠키를 재사용한다.
 * (receipts/session.ts 와 같은 방식 — 정부 사이트는 봇 탐지보다 보안 모듈이 문제라 실제 설치된 Chrome 을 우선한다)
 *
 * IEPS 세션은 약 1시간 유지된다 — 한 번 로그인에 대기 건을 이어서 처리하고, 만료되면 login 을 다시 한다.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, BrowserContext } from "playwright";
import { FilingSite, SiteConfig, siteDir } from "./config";

const CHROME_PATH = process.env.FILINGS_CHROME_PATH;

export function profileDir(site: FilingSite): string {
  return path.join(siteDir(site), "browser-profile");
}
export function cookiesFile(site: FilingSite): string {
  return path.join(siteDir(site), "cookies.json");
}
export function hasSession(site: FilingSite): boolean {
  return fs.existsSync(path.join(profileDir(site), "Default")) || fs.existsSync(cookiesFile(site));
}

export function waitForContextClose(context: BrowserContext): Promise<void> {
  return new Promise((resolve) => context.on("close", () => resolve()));
}

/** 세션 쿠키를 파일로 떠 둔다(Chromium 은 만료 없는 세션 쿠키를 디스크에 남기지 않는다). */
export async function snapshotCookies(site: FilingSite, context: BrowserContext): Promise<number> {
  try {
    const cookies = await context.cookies();
    if (cookies.length > 0) fs.writeFileSync(cookiesFile(site), JSON.stringify(cookies, null, 2), "utf-8");
    return cookies.length;
  } catch {
    return 0;
  }
}

/**
 * 브라우저 컨텍스트(프로필 재사용). 정부 사이트는 headed 로만 쓴다 — 보안 모듈·인증서 창이 뜨고,
 * 제출 직전 확인은 사람이 하기 때문이다.
 */
export async function openContext(site: FilingSite, opts: { useSession?: boolean; headless?: boolean } = {}) {
  const { useSession = true, headless = false } = opts;
  if (useSession && !hasSession(site)) {
    throw new Error(`로그인 프로필이 없습니다: ${profileDir(site)}\n먼저 'npm run filings -- login --site ${site}' 를 실행하세요.`);
  }
  const launch: Record<string, unknown> = {
    headless,
    timeout: 60_000,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    viewport: null,
    acceptDownloads: true,
    ignoreDefaultArgs: ["--enable-automation"],
    ...(CHROME_PATH ? { executablePath: CHROME_PATH } : { channel: "chrome" }),
  };
  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(profileDir(site), launch as never);
  } catch {
    // 설치된 Chrome 이 없으면 번들 Chromium
    delete launch.channel;
    delete launch.executablePath;
    console.log(`[${site}] 설치된 Chrome 을 찾지 못해 번들 Chromium 으로 실행합니다.`);
    context = await chromium.launchPersistentContext(profileDir(site), launch as never);
  }
  context.setDefaultTimeout(60_000);
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

/** 대화형 로그인 — 사람이 로그인(문자인증·인증서)한 뒤 창을 닫으면 끝. 쿠키는 2초마다 떠 둔다. */
export async function interactiveLogin(site: FilingSite, cfg: SiteConfig): Promise<boolean> {
  siteDir(site);
  const { context } = await openContext(site, { useSession: false });
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(cfg.loginUrl, { waitUntil: "domcontentloaded" });
    console.log(`[${site}] ${cfg.label} 창이 열렸습니다. 직접 로그인하세요` +
      (site === "ieps" ? "(아이디/비밀번호 → 문자 인증번호)." : "(공동인증서 선택 → 비밀번호)."));
    console.log(`[${site}] 로그인 뒤 신고 메뉴 화면까지 이동한 다음 창을 닫으면 세션이 저장됩니다.`);
    let lastUrl = "";
    const timer = setInterval(async () => {
      try {
        const pages = context.pages().filter((p) => !p.isClosed());
        if (pages.length) lastUrl = pages[pages.length - 1].url();
        await snapshotCookies(site, context);
      } catch {
        // 종료 중
      }
    }, 2000);
    await waitForContextClose(context);
    clearInterval(timer);
    const stillLoggedOut = Boolean(lastUrl && new RegExp(cfg.loggedOutPattern, "i").test(lastUrl));
    console.log(`[${site}] 프로필 저장: ${profileDir(site)} (외부 공유·커밋 금지 — .gitignore 등록)`);
    if (stillLoggedOut) console.log(`[${site}] ⚠ 창을 닫을 때 아직 로그인 페이지였습니다: ${lastUrl}`);
    return !stillLoggedOut;
  } finally {
    await context.close().catch(() => {});
  }
}

/** 저장된 세션이 살아 있는지 — 로그인 필요 페이지가 로그인 화면으로 튕기는지 본다(headless). */
export async function checkSession(site: FilingSite, cfg: SiteConfig): Promise<boolean> {
  const { context, close } = await openContext(site, { headless: true });
  try {
    const page = context.pages()[0] || (await context.newPage());
    const res = await page.goto(cfg.checkUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const url = page.url();
    const out = new RegExp(cfg.loggedOutPattern, "i").test(url);
    console.log(`[${site}] 최종 URL: ${url} (HTTP ${res?.status()})`);
    return !out;
  } finally {
    await close();
  }
}
