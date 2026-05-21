/**
 * IEPS 라운드 2C — cli-collect 의 PDF 다운로드 폴백.
 *
 * 정적 HTTP fetch 가 실패 (또는 attachment.downloadUrl 이 javascript:/onclick 패턴) 한 경우,
 * 이 모듈이 chromium 브라우저로 실제 게시물 페이지를 열고 첨부 링크를 클릭하여
 * 다운로드 이벤트를 캡처해 디스크에 저장한다.
 *
 * - 외부 의존성: playwright (이미 scraper-runner.ts 가 사용 중)
 * - lazy init: cli-collect 가 첫 폴백을 시도할 때까지 chromium 미기동.
 */

import path from "node:path";
import fs from "node:fs";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Download,
  type Page,
} from "playwright";

export interface PlaywrightDownloaderOptions {
  /** chromium headless 모드 (기본 true) */
  headless?: boolean;
  /** page goto / waitForEvent 타임아웃 ms (기본 60_000) */
  timeoutMs?: number;
}

export interface DownloadResult {
  ok: boolean;
  bytes?: number;
  error?: string;
}

export interface DownloadArgs {
  /** 게시물 상세 페이지 URL */
  articleUrl: string;
  /** 매칭에 사용할 첨부 파일명 (텍스트) */
  fileName: string;
  /** 저장 대상 절대 경로 */
  targetPath: string;
  /**
   * 추가 셀렉터 힌트 (옵션). 기본 휴리스틱이 실패할 때 추가로 시도한다.
   * 예: ['a.file_down', 'button[onclick*="customDown"]']
   */
  selectorHints?: string[];
}

/**
 * IEPS 게시판 PDF 다운로드 폴백.
 * 사용 방법:
 *   const dl = await PlaywrightDownloader.create();
 *   const r1 = await dl.downloadFromArticle({...});
 *   await dl.close();
 */
export class PlaywrightDownloader {
  private browser: Browser;
  private headless: boolean;
  private timeoutMs: number;

  private constructor(browser: Browser, headless: boolean, timeoutMs: number) {
    this.browser = browser;
    this.headless = headless;
    this.timeoutMs = timeoutMs;
  }

  static async create(opts: PlaywrightDownloaderOptions = {}): Promise<PlaywrightDownloader> {
    const headless = opts.headless ?? true;
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const browser = await chromium.launch({ headless });
    return new PlaywrightDownloader(browser, headless, timeoutMs);
  }

  async close(): Promise<void> {
    try {
      await this.browser.close();
    } catch {
      // ignore
    }
  }

  /**
   * 게시물 페이지를 열고 첨부 링크/버튼을 클릭하여 다운로드 이벤트를 캡처한다.
   * 성공 시 targetPath 에 파일을 저장하고 ok=true.
   */
  async downloadFromArticle(args: DownloadArgs): Promise<DownloadResult> {
    const { articleUrl, fileName, targetPath, selectorHints } = args;

    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      context = await this.browser.newContext({
        acceptDownloads: true,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      });
      page = await context.newPage();
      page.setDefaultTimeout(this.timeoutMs);

      try {
        await page.goto(articleUrl, { waitUntil: "domcontentloaded", timeout: this.timeoutMs });
      } catch (err) {
        return { ok: false, error: "goto-failed: " + (err as Error).message };
      }

      // 페이지가 정적 HTML 인 경우, JS 내려오는 시간을 잠깐 기다림
      try {
        await page.waitForLoadState("networkidle", { timeout: 5_000 });
      } catch {
        // networkidle 타임아웃은 무시 (긴 keep-alive 가 흔함)
      }

      const candidate = await this.locateAttachmentHandle(page, fileName, selectorHints);
      if (!candidate) {
        return { ok: false, error: "no-match" };
      }

      // 다운로드 이벤트와 클릭을 동시에 진행
      let download: Download;
      try {
        const [dl] = await Promise.all([
          page.waitForEvent("download", { timeout: this.timeoutMs }),
          candidate.click({ timeout: this.timeoutMs }).catch(() => undefined),
        ]);
        download = dl;
      } catch (err) {
        return { ok: false, error: "no-download: " + (err as Error).message };
      }

      // 저장 디렉터리 보장 후 saveAs
      try {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        await download.saveAs(targetPath);
      } catch (err) {
        return { ok: false, error: "save-failed: " + (err as Error).message };
      }

      let bytes = 0;
      try {
        bytes = fs.statSync(targetPath).size;
      } catch {
        // ignore
      }
      if (bytes <= 0) {
        return { ok: false, error: "empty-file" };
      }

      return { ok: true, bytes };
    } catch (err) {
      return { ok: false, error: "exception: " + (err as Error).message };
    } finally {
      try {
        if (page) await page.close();
      } catch {}
      try {
        if (context) await context.close();
      } catch {}
    }
  }

  /**
   * 게시물 페이지 안에서 fileName 과 가장 잘 매칭되는 첨부 핸들을 찾는다.
   *  - 1순위: a/button 의 표시 텍스트가 파일명을 (대소문자 무시) 포함
   *  - 2순위: a[href*='download'] / a[onclick*='fileDown'|'download'|'atchFile']
   *  - 3순위: 사용자가 넘긴 selectorHints
   *  - 4순위: a[href$='.pdf'] / a[href*='.pdf']
   */
  private async locateAttachmentHandle(
    page: Page,
    fileName: string,
    selectorHints?: string[]
  ): Promise<import("playwright").ElementHandle<Element> | null> {
    const exists = async (selector: string) => {
      try {
        const h = await page.$(selector);
        return h;
      } catch {
        return null;
      }
    };

    const baseName = path.basename(fileName).trim();
    if (baseName) {
      // 텍스트 매칭 (대소문자 무시) — Playwright text= 는 정확/포함 모두 지원하므로 부분 매칭 사용
      const text = baseName.replace(/"/g, '\\"');
      const byText = await exists(`a:has-text("${text}"), button:has-text("${text}")`);
      if (byText) return byText;

      // 확장자 제외 베이스 이름으로 한번 더
      const stem = baseName.replace(/\.[^./\\]+$/, "");
      if (stem && stem !== baseName) {
        const byStem = await exists(
          `a:has-text("${stem.replace(/"/g, '\\"')}"), button:has-text("${stem.replace(/"/g, '\\"')}")`
        );
        if (byStem) return byStem;
      }
    }

    // 2순위 — IEPS 정부 사이트 공통 패턴
    const downloadSelectors = [
      "a[href*='download']",
      "a[href*='fileDown']",
      "a[href*='file_down']",
      "a[href*='atchFile']",
      "a[onclick*='fileDown']",
      "a[onclick*='download']",
      "a[onclick*='atchFile']",
      "a[onclick*='fnFileDown']",
      "button[onclick*='fileDown']",
      "button[onclick*='download']",
    ];
    for (const sel of downloadSelectors) {
      const h = await exists(sel);
      if (h) return h;
    }

    // 3순위 — caller hint
    if (selectorHints && selectorHints.length) {
      for (const sel of selectorHints) {
        const h = await exists(sel);
        if (h) return h;
      }
    }

    // 4순위 — pdf 링크 직접
    for (const sel of ["a[href$='.pdf']", "a[href*='.pdf']", "a[href$='.PDF']"]) {
      const h = await exists(sel);
      if (h) return h;
    }

    return null;
  }
}
