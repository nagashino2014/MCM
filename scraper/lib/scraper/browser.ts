/**
 * Playwright 브라우저 유틸리티 모듈
 * - 헤드리스 브라우저를 이용한 동적 웹페이지 스크래핑 지원
 * - Chromium (기본) 또는 시스템 Chrome 사용 가능
 */

import { chromium, Browser, Page, BrowserContext } from "playwright";
import AdmZip from "adm-zip";
import * as iconv from "iconv-lite";

// 브라우저 타입 정의
export type BrowserType = "chromium" | "chrome" | "msedge";

// 브라우저 설정 인터페이스
export interface BrowserConfig {
  browserType?: BrowserType;
  headless?: boolean;
  timeout?: number;
  userAgent?: string;
}

// 기본 설정
const DEFAULT_CONFIG: BrowserConfig = {
  browserType: "chromium",
  headless: true,
  timeout: 30000,
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

// 전역 브라우저 인스턴스 (재사용을 위해)
let globalBrowser: Browser | null = null;
let browserInUse = false;

const isContainerEnv =
  process.env.DOCKER_ENV === "true" ||
  !!process.env.RAILWAY_ENVIRONMENT ||
  !!process.env.RAILWAY_SERVICE_ID;

function applyContainerArgs(launchOptions: any) {
  if (isContainerEnv) {
    launchOptions.args = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      ...(launchOptions.args || []),
    ];
  }
}

/**
 * 브라우저 인스턴스 가져오기
 * - 이미 실행 중인 브라우저가 있으면 재사용
 * - 없으면 새로 생성
 */
export async function getBrowser(config: BrowserConfig = {}): Promise<Browser> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  // 이미 브라우저가 실행 중이고 사용 중이 아니면 재사용
  if (globalBrowser && globalBrowser.isConnected() && !browserInUse) {
    return globalBrowser;
  }

  // 새 브라우저 시작
  const launchOptions: any = {
    headless: mergedConfig.headless,
    timeout: mergedConfig.timeout,
  };

  // Chrome이나 Edge 사용 시 executablePath 설정
  if (mergedConfig.browserType === "chrome") {
    // Windows에서 Chrome 경로
    const chromePaths = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
    ];

    for (const path of chromePaths) {
      try {
        const fs = await import("fs");
        if (fs.existsSync(path)) {
          launchOptions.executablePath = path;
          launchOptions.channel = undefined;
          break;
        }
      } catch {
        continue;
      }
    }

    // 경로를 못 찾으면 channel 사용
    if (!launchOptions.executablePath) {
      launchOptions.channel = "chrome";
    }
  } else if (mergedConfig.browserType === "msedge") {
    launchOptions.channel = "msedge";
  }

  applyContainerArgs(launchOptions);
  globalBrowser = await chromium.launch(launchOptions);
  return globalBrowser;
}

/**
 * 새 페이지 생성
 */
export async function createPage(browser: Browser, config: BrowserConfig = {}): Promise<Page> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  const context = await browser.newContext({
    userAgent: mergedConfig.userAgent,
    viewport: { width: 1920, height: 1080 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });

  const page = await context.newPage();
  page.setDefaultTimeout(mergedConfig.timeout || 30000);

  return page;
}

/**
 * 페이지의 완전한 HTML 가져오기 (JavaScript 실행 후)
 */
export async function fetchRenderedHtml(
  url: string,
  config: BrowserConfig = {},
  waitOptions?: {
    waitFor?: "load" | "domcontentloaded" | "networkidle";
    waitForSelector?: string;
    waitTime?: number;
  }
): Promise<string> {
  browserInUse = true;
  let page: Page | null = null;

  try {
    const browser = await getBrowser(config);
    page = await createPage(browser, config);

    // 페이지 이동 (재시도 로직 포함)
    let pageLoaded = false;
    for (let retryCount = 0; retryCount < 3 && !pageLoaded; retryCount++) {
      try {
        if (retryCount > 0) {
          console.log(`[BROWSER] fetchRenderedHtml 페이지 로딩 재시도 ${retryCount}/3...`);
          await page.waitForTimeout(3000);
        }
        await page.goto(url, {
          waitUntil: waitOptions?.waitFor || "domcontentloaded",
          timeout: config.timeout || 60000,
        });
        pageLoaded = true;
      } catch (gotoError) {
        console.log(`[BROWSER] fetchRenderedHtml 페이지 로딩 시도 ${retryCount + 1} 실패: ${gotoError}`);
        if (retryCount === 2) throw gotoError;
      }
    }
    // 추가 대기 시간 (동적 콘텐츠 로딩)
    await page.waitForTimeout(2000);

    // 특정 선택자 대기 (옵션)
    if (waitOptions?.waitForSelector) {
      await page.waitForSelector(waitOptions.waitForSelector, {
        timeout: 10000,
      }).catch(() => {
        // 선택자를 못 찾아도 계속 진행
      });
    }

    // 추가 대기 시간 (옵션)
    if (waitOptions?.waitTime) {
      await page.waitForTimeout(waitOptions.waitTime);
    }

    // HTML 가져오기
    const html = await page.content();

    return html;
  } finally {
    if (page) {
      await page.close().catch(() => { });
    }
    browserInUse = false;
  }
}

/**
 * 페이지에서 첨부파일 정보 추출 (동적 로딩 포함)
 */
export interface AttachmentResult {
  fileName: string;
  downloadUrl: string;
  fileSize?: string;
}

export async function extractAttachmentsWithBrowser(
  url: string,
  config: BrowserConfig = {},
  detailSelectors?: string[]
): Promise<{ html: string; attachments: AttachmentResult[] }> {
  browserInUse = true;
  let page: Page | null = null;

  try {
    const browser = await getBrowser(config);
    page = await createPage(browser, config);

    // 다운로드 요청 캡처 준비
    const downloadUrls: Map<string, string> = new Map();

    // 네트워크 요청 모니터링 (첨부파일 다운로드 URL 캡처)
    page.on("request", (request) => {
      const reqUrl = request.url();
      const resourceType = request.resourceType();

      // 다운로드 관련 요청 감지
      if (resourceType === "document" || reqUrl.includes("download") ||
        reqUrl.includes("file") || reqUrl.includes("attach")) {
        const headers = request.headers();
        if (headers["content-disposition"] || reqUrl.match(/\.(pdf|hwp|hwpx|doc|docx|xls|xlsx|zip)$/i)) {
          downloadUrls.set(reqUrl, reqUrl);
        }
      }
    });

    // 페이지 이동 (NIER 등 불안정한 서버 대비 재시도 로직 포함)
    // domcontentloaded 사용 (networkidle보다 빠르고 안정적)
    let pageLoaded = false;
    for (let retryCount = 0; retryCount < 3 && !pageLoaded; retryCount++) {
      try {
        if (retryCount > 0) {
          console.log(`[BROWSER] 페이지 로딩 재시도 ${retryCount}/3...`);
          await page.waitForTimeout(3000); // 재시도 전 대기
        }
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: config.timeout || 60000,
        });
        pageLoaded = true;
      } catch (gotoError) {
        console.log(`[BROWSER] 페이지 로딩 시도 ${retryCount + 1} 실패: ${gotoError}`);
        if (retryCount === 2) throw gotoError;
      }
    }
    // 추가 대기 시간 (동적 콘텐츠 로딩)
    await page.waitForTimeout(2000);

    // 첨부파일 영역이 동적으로 로드되는 사이트들을 위한 대기 로직
    try {
      // 국립환경과학원, 전자정부 프레임워크 등 공통 첨부파일 패턴 대기
      await page.waitForSelector(
        "a.fileDownload, .file-atch-list a, .file_info a, .fileAttach a, a[href*='download'], a[href*='fileDown']",
        { timeout: 5000 }
      );
    } catch {
      // 선택자를 못 찾아도 무시하고 진행
    }

    // 추가 대기 (완전한 렌더링 보장)
    await page.waitForTimeout(1000);

    // JavaScript 실행 대기 (동적 콘텐츠 로딩)
    await page.waitForTimeout(2000);

    // 첨부파일 영역 선택자
    const attachmentSelectors = detailSelectors || [
      ".file-list",
      ".attach-list",
      ".attachFile",
      ".file_list",
      ".fileList",
      ".download-list",
      ".detailAttach",
      ".formAlign",
      "[class*='attach']",
      "[class*='file']",
    ];

    // 현재 URL 가져오기
    const currentUrl = page.url();
    const isNierSite = currentUrl.includes('nier.go.kr');

    // 첨부파일 정보 추출
    const attachments = await page.evaluate((args: { selectors: string[]; isNier: boolean }) => {
      const { selectors, isNier } = args;
      const results: { fileName: string; downloadUrl: string; fileSize?: string }[] = [];
      const seenUrls = new Set<string>();

      // 공통 파일 확장자 패턴
      const fileExtPattern = /\.(pdf|hwp|hwpx|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|txt|csv)$/i;

      // ============================================================
      // 국립환경과학원(NIER): 전용 선택자만 사용
      // 일반 선택자 사용 시 페이지 공통 영역의 불필요한 파일이 잡힘
      // ============================================================
      let downloadSelectors: string[];

      if (isNier) {
        downloadSelectors = ["a.fileDownload[data-no][data-seq]"];
      } else {
        downloadSelectors = [
          // 국립환경과학원(NIER) 전용 패턴 - 최우선
          "a.fileDownload[data-no][data-seq]",
          // 산업통상부 다운로드 버튼 (onclick에 /attach/down/ URL 포함) - 최우선
          "a[onclick*='/attach/down/']",
          "a[onclick*='location.href'][onclick*='/attach/']",
          // 직접 파일 확장자 링크
          "a[href$='.pdf']", "a[href$='.hwp']", "a[href$='.hwpx']",
          "a[href$='.doc']", "a[href$='.docx']", "a[href$='.xls']", "a[href$='.xlsx']",
          // 다운로드 URL 패턴
          "a[href*='download']",
          "a[href*='file']",
          "a[href*='/attach/down/']",  // 산업통상부 등
          // onclick 기반
          "button[onclick*='download']",
          "button[onclick*='fnDownload']",
          "a[onclick*='download']",
          "a[onclick*='fnDownload']",
          // onclick 기반 (바로보기 제외)
          "a[onclick*='Down']:not([class*='magnifier']):not([class*='Refer'])",
          "button[onclick*='Down']:not([class*='magnifier']):not([class*='Refer'])",
          // 첨부파일 영역 내 요소
          ".fileAttach a", ".file_info a",
          ...selectors.map(s => `${s} a`),
          ...selectors.map(s => `${s} button`),
        ];
      }

      // URL 추출 함수
      function extractUrl(element: Element): string | null {
        // ============================================================
        // 국립환경과학원(NIER) 패턴: data-no, data-seq 속성
        // ============================================================
        const dataNo = element.getAttribute("data-no");
        const dataSeq = element.getAttribute("data-seq");
        if (dataNo && dataSeq) {
          // NIER POST 방식 다운로드: atchFileNo, atchFileSeq 파라미터 사용
          return `post:/common/comDownloadFile.do|atchFileNo=${dataNo}&atchFileSeq=${dataSeq}`;
        }

        // href 속성
        const href = element.getAttribute("href");
        if (href && href !== "#" && href !== "javascript:void(0)" && !href.startsWith("javascript:")) {
          return href;
        }

        // onclick 속성에서 URL 추출
        const onclick = element.getAttribute("onclick") || "";

        // 산업통상부 패턴 (3개 해시): fn_fileDown('hash1', 'hash2', 'hash3') → /attach/down/h1/h2/h3
        const motirPattern = onclick.match(
          /(?:fn_)?(?:file)?[Dd]own(?:load)?\s*\(\s*['"]([a-f0-9]{20,})['"][\s,]+['"]([a-f0-9]{20,})['"][\s,]+['"]([a-f0-9]{20,})['"]\s*\)/i
        );
        if (motirPattern) {
          return `/attach/down/${motirPattern[1]}/${motirPattern[2]}/${motirPattern[3]}`;
        }

        // fnDownload 패턴 (2개 파라미터)
        const fnDownloadMatch = onclick.match(/fnDownload\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/);
        if (fnDownloadMatch) {
          return `/cmm/fms/FileDown.do?atchFileId=${fnDownloadMatch[1]}&fileSn=${fnDownloadMatch[2]}`;
        }

        // location.href 패턴
        const locationMatch = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
        if (locationMatch) {
          return locationMatch[1];
        }

        // window.open 패턴
        const windowOpenMatch = onclick.match(/window\.open\s*\(\s*['"]([^'"]+)['"]/);
        if (windowOpenMatch) {
          return windowOpenMatch[1];
        }

        // 일반 URL 패턴
        const urlMatch = onclick.match(/(\/[^'"\s]+\.(pdf|hwp|hwpx|doc|docx|xls|xlsx|zip))/i);
        if (urlMatch) {
          return urlMatch[1];
        }

        return null;
      }

      // 파일명 정리 함수
      function cleanFileName(text: string): string {
        return text
          .replace(/다운로드|download|첨부파일|파일/gi, "")
          .replace(/\s+/g, " ")
          .trim();
      }

      // 모든 선택자에서 첨부파일 찾기
      for (const selector of downloadSelectors) {
        try {
          document.querySelectorAll(selector).forEach((el) => {
            const url = extractUrl(el);
            if (!url || seenUrls.has(url)) return;

            // 바로보기 버튼 제외 (뷰어 페이지, 실제 다운로드 아님)
            const elText = el.textContent?.trim() || "";
            const elClass = el.className || "";
            if (elText.includes("바로보기") || elClass.includes("Refer") ||
              url.includes("viewer") || url.includes("Refer")) {
              return;
            }

            // URL이 파일 다운로드 URL인지 확인
            const isDownloadUrl = url.includes("download") ||
              url.includes("file") ||
              url.includes("attach") ||
              fileExtPattern.test(url);

            if (!isDownloadUrl) return;

            seenUrls.add(url);

            // 파일명 추출
            let fileName = cleanFileName(el.textContent || "");

            // "바로보기"가 파일명이면 스킵
            if (fileName === "바로보기" || fileName === "" || fileName.length < 2) {
              const urlParts = url.split("/");
              fileName = decodeURIComponent(urlParts[urlParts.length - 1].split("?")[0]) || "";
            }

            // 여전히 유효하지 않으면 스킵
            if (!fileName || fileName === "바로보기" || fileName.length < 2) {
              return;
            }

            // 파일 크기 추출 (있는 경우)
            const parent = el.closest("li, tr, div");
            const sizeMatch = parent?.textContent?.match(/(\d+(?:\.\d+)?\s*(?:KB|MB|GB|bytes?))/i);

            results.push({
              fileName,
              downloadUrl: url.startsWith("http") ? url : url,
              fileSize: sizeMatch ? sizeMatch[1] : undefined,
            });
          });
        } catch (e) {
          // 선택자 오류 무시
        }
      }

      return results;
    }, { selectors: attachmentSelectors, isNier: isNierSite });

    // URL 정규화 (상대 경로 -> 절대 경로)
    const baseUrl = new URL(url).origin;
    const normalizedAttachments = attachments.map(att => ({
      ...att,
      downloadUrl: att.downloadUrl.startsWith("http")
        ? att.downloadUrl
        : new URL(att.downloadUrl, url).href,
    }));

    // ============================================================
    // JavaScript 함수 기반 다운로드 버튼 클릭 처리 (KEPCO 등)
    // G_FILE.downloadFile, G_FILE.downloadFilePath 등
    // 폼 제출 방식이므로 실제로 파일을 저장해야 함
    // ============================================================
    // NIER 사이트는 전용 선택자(a.fileDownload[data-no][data-seq])로 처리하므로 이 로직 건너뜀
    if (normalizedAttachments.length === 0 && !isNierSite) {
      console.log("[BROWSER] JavaScript 함수 기반 다운로드 버튼 탐색...");

      // KEPCO 전용: h4.detail-file-title 아래의 다운로드 버튼 찾기
      let jsDownloadButtons = await page.$$('h4.detail-file-title ~ * a[href*="G_FILE.downloadFile"], h4.detail-file-title ~ * a[href*="G_FILE.downloadFilePath"], .detail-file-wrap a[href*="G_FILE"]');

      // KEPCO 전용 선택자로 못 찾으면 범용 선택자 사용
      if (jsDownloadButtons.length === 0) {
        jsDownloadButtons = await page.$$('a[href*="G_FILE.downloadFile"], a[href*="G_FILE.downloadFilePath"], a[href*="downloadFile"], a.txt-btn:has-text("다운로드")');
      }
      console.log(`[BROWSER] JavaScript 다운로드 버튼 발견: ${jsDownloadButtons.length}개`);

      if (jsDownloadButtons.length > 0) {
        const capturedDownloads: { fileName: string; downloadUrl: string; tempPath?: string }[] = [];

        // 임시 다운로드 폴더 생성
        const fs = await import("fs");
        const path = await import("path");
        const os = await import("os");
        const tempDir = path.join(os.tmpdir(), `scraper-downloads-${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });

        // 각 다운로드 버튼 클릭 시도 (최대 10개)
        for (let i = 0; i < Math.min(jsDownloadButtons.length, 10); i++) {
          try {
            const btn = jsDownloadButtons[i];
            const btnText = await btn.textContent();

            // 미리보기, 점자 버튼 제외
            if (btnText?.includes("미리보기") || btnText?.includes("점자") || btnText?.includes("Preview")) {
              continue;
            }

            console.log(`[BROWSER] 버튼 ${i + 1} 클릭 시도: "${btnText?.trim()}"`);

            // 다운로드 이벤트 대기하며 클릭
            const [download] = await Promise.all([
              page.waitForEvent("download", { timeout: 8000 }).catch(() => null),
              btn.click({ timeout: 3000 }).catch(() => null),
            ]);

            if (download) {
              const suggestedFilename = download.suggestedFilename();
              console.log(`[BROWSER] 다운로드 감지: ${suggestedFilename}`);

              // 실제 파일 저장
              const tempPath = path.join(tempDir, suggestedFilename);
              await download.saveAs(tempPath).catch((e) => {
                console.log(`[BROWSER] 파일 저장 실패: ${e}`);
              });

              // 파일이 실제로 저장되었는지 확인
              if (fs.existsSync(tempPath)) {
                const stats = fs.statSync(tempPath);
                if (stats.size > 0) {
                  console.log(`[BROWSER] 파일 저장 성공: ${suggestedFilename} (${stats.size} bytes)`);
                  capturedDownloads.push({
                    fileName: suggestedFilename,
                    downloadUrl: `file://${tempPath}`, // 로컬 파일 경로를 URL로 표시
                    tempPath: tempPath,
                  });
                } else {
                  console.log(`[BROWSER] 빈 파일 - 삭제: ${suggestedFilename}`);
                  fs.unlinkSync(tempPath);
                }
              }
            }

            await page.waitForTimeout(500);
          } catch (err) {
            console.log(`[BROWSER] 버튼 클릭 오류:`, err);
          }
        }

        // 캡처된 다운로드 추가
        if (capturedDownloads.length > 0) {
          console.log(`[BROWSER] 총 ${capturedDownloads.length}개 파일 다운로드 완료`);
          for (const dl of capturedDownloads) {
            normalizedAttachments.push({
              fileName: dl.fileName,
              downloadUrl: dl.downloadUrl,
              tempPath: dl.tempPath,
            } as AttachmentResult & { tempPath?: string });
          }
        }
      }
    }

    // HTML 가져오기 (navigation 에러 방지)
    let html = "";
    try {
      // 페이지 로딩 완료 대기
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
      html = await page.content();
    } catch (contentError) {
      console.log(`[BROWSER] page.content() 에러: ${contentError}`);
      // navigation 중 에러 발생 시 잠시 대기 후 재시도
      await page.waitForTimeout(1000);
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
        html = await page.content();
      } catch {
        // 재시도 실패 시 빈 HTML 반환
        console.log("[BROWSER] page.content() 재시도 실패, 빈 HTML 반환");
      }
    }

    return {
      html,
      attachments: normalizedAttachments,
    };
  } finally {
    if (page) {
      await page.close().catch(() => { });
    }
    browserInUse = false;
  }
}

/**
 * 국민참여입법센터 전용 첨부파일 추출
 */
export async function extractLawmakingAttachments(
  url: string,
  config: BrowserConfig = {}
): Promise<{ html: string; attachments: AttachmentResult[] }> {
  browserInUse = true;
  let page: Page | null = null;

  try {
    const browser = await getBrowser(config);
    page = await createPage(browser, config);

    // 페이지 이동 (재시도 로직 포함)
    let pageLoaded = false;
    for (let retryCount = 0; retryCount < 3 && !pageLoaded; retryCount++) {
      try {
        if (retryCount > 0) {
          console.log(`[BROWSER] downloadWithPlaywright 페이지 로딩 재시도 ${retryCount}/3...`);
          await page.waitForTimeout(3000);
        }
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: config.timeout || 60000,
        });
        pageLoaded = true;
      } catch (gotoError) {
        console.log(`[BROWSER] downloadWithPlaywright 페이지 로딩 시도 ${retryCount + 1} 실패: ${gotoError}`);
        if (retryCount === 2) throw gotoError;
      }
    }
    // 추가 대기 시간 (동적 콘텐츠 로딩)
    await page.waitForTimeout(2000);

    // 첨부파일 탭 클릭 시도 (있는 경우)
    try {
      const attachTab = await page.$('[role="tab"]:has-text("첨부파일"), .tab:has-text("첨부"), button:has-text("첨부")');
      if (attachTab) {
        await attachTab.click();
        await page.waitForTimeout(1000);
      }
    } catch {
      // 탭이 없으면 무시
    }

    // 첨부파일 정보 추출
    const attachments = await page.evaluate(() => {
      const results: { fileName: string; downloadUrl: string }[] = [];
      const seenUrls = new Set<string>();

      // 국민참여입법센터 특화 선택자
      const selectors = [
        ".detailAttach a",
        ".detailAttach button",
        ".formAlign a",
        ".formAlign button",
        ".file-list a",
        ".attach a",
        "a[onclick*='fnDownload']",
        "button[onclick*='fnDownload']",
        "a[href*='FileDown']",
        "a[href*='download']",
      ];

      for (const selector of selectors) {
        try {
          document.querySelectorAll(selector).forEach((el) => {
            let downloadUrl = "";
            let fileName = "";

            // href에서 URL 추출
            const href = (el as HTMLAnchorElement).href || el.getAttribute("href");
            if (href && href !== "#" && !href.startsWith("javascript:")) {
              downloadUrl = href;
            }

            // onclick에서 URL 추출
            const onclick = el.getAttribute("onclick") || "";
            if (onclick) {
              // fnDownload('id', 'key') 패턴 - 국민참여입법센터 등
              const fnMatch = onclick.match(/fnDownload\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/);
              if (fnMatch) {
                downloadUrl = `/cmm/fms/FileDown.do?atchFileId=${fnMatch[1]}&fileSn=${fnMatch[2]}`;
              }

              // fileDownload('atchFileId', 'fileSn') 패턴 - 한강유역환경청 등 전자정부프레임워크
              const fileDownMatch = onclick.match(/fileDownload\s*\(\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]/i);
              if (fileDownMatch && !downloadUrl) {
                downloadUrl = `/cmm/fms/FileDown.do?atchFileId=${fileDownMatch[1]}&fileSn=${fileDownMatch[2]}`;
              }

              // 다른 패턴들
              const locationMatch = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
              if (locationMatch && !downloadUrl) downloadUrl = locationMatch[1];

              const openMatch = onclick.match(/window\.open\s*\(\s*['"]([^'"]+)['"]/);
              if (openMatch && !downloadUrl) downloadUrl = openMatch[1];
            }

            if (!downloadUrl || seenUrls.has(downloadUrl)) return;
            seenUrls.add(downloadUrl);

            // 파일명 추출
            fileName = el.textContent?.replace(/\s+/g, " ").trim() || "";

            // 숨김 텍스트 제거
            el.querySelectorAll(".blind, .sr-only, .a11y_hidden").forEach(hidden => {
              fileName = fileName.replace(hidden.textContent || "", "");
            });
            fileName = fileName.trim();

            // 파일명이 없으면 URL에서 추출
            if (!fileName) {
              const urlParts = downloadUrl.split("/");
              fileName = decodeURIComponent(urlParts[urlParts.length - 1].split("?")[0]) || "첨부파일";
            }

            results.push({ fileName, downloadUrl });
          });
        } catch {
          // 무시
        }
      }

      return results;
    });

    // URL 정규화
    const normalizedAttachments = attachments.map(att => ({
      ...att,
      downloadUrl: att.downloadUrl.startsWith("http")
        ? att.downloadUrl
        : new URL(att.downloadUrl, url).href,
    }));

    const html = await page.content();

    return {
      html,
      attachments: normalizedAttachments,
    };
  } finally {
    if (page) {
      await page.close().catch(() => { });
    }
    browserInUse = false;
  }
}

/**
 * Playwright를 사용한 세션 기반 다운로드
 * - 세션 쿠키가 필요한 사이트 (산업통상부 등)에서 사용
 * - 상세 페이지 방문 후 같은 세션에서 다운로드
 */
export async function downloadWithPlaywright(
  downloadUrl: string,
  outputDir: string,
  fileName: string,
  refererUrl: string,
  config: BrowserConfig = {}
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    // 브라우저 시작
    const launchOptions: any = {
      headless: mergedConfig.headless,
      timeout: mergedConfig.timeout,
    };

    if (mergedConfig.browserType === "chrome") {
      launchOptions.channel = "chrome";
    } else if (mergedConfig.browserType === "msedge") {
      launchOptions.channel = "msedge";
    }

    applyContainerArgs(launchOptions);
    browser = await chromium.launch(launchOptions);

    const context = await browser.newContext({
      userAgent: mergedConfig.userAgent,
      acceptDownloads: true,
    });

    page = await context.newPage();

    // 1. 먼저 상세 페이지에 접근해서 세션 쿠키 획득
    await page.goto(refererUrl, {
      waitUntil: 'networkidle',
      timeout: mergedConfig.timeout
    });
    await page.waitForTimeout(1000);

    // 2. 다운로드 디렉토리 생성
    const fs = await import('fs');
    const path = await import('path');
    fs.mkdirSync(outputDir, { recursive: true });

    const safeFileName = fileName.replace(/[\\/:*?"<>|]/g, '_');
    const filePath = path.join(outputDir, safeFileName);

    // 3. 다운로드 이벤트 대기 및 URL 접근
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });

    // 다운로드 URL로 이동 (클릭 대신 직접 이동)
    await page.goto(downloadUrl, { timeout: 30000 }).catch(() => { });

    try {
      const download = await downloadPromise;

      // 다운로드 완료 대기 및 저장
      await download.saveAs(filePath);

      // 파일 크기 확인
      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        fs.unlinkSync(filePath);
        return { success: false, error: '다운로드된 파일이 비어 있습니다' };
      }

      return { success: true, filePath };
    } catch (downloadError) {
      // 다운로드 이벤트가 발생하지 않은 경우 - 직접 응답 처리
      const response = await page.goto(downloadUrl, {
        waitUntil: 'commit',
        timeout: 30000
      });

      if (response && response.ok()) {
        const buffer = await response.body();
        if (buffer && buffer.length > 0) {
          fs.writeFileSync(filePath, buffer);
          return { success: true, filePath };
        }
      }

      return {
        success: false,
        error: `다운로드 실패: ${downloadError}`
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    if (page) {
      await page.close().catch(() => { });
    }
    if (browser) {
      await browser.close().catch(() => { });
    }
  }
}

/**
 * 여러 파일을 Playwright 세션으로 일괄 다운로드
 * - 하나의 브라우저 세션을 유지하면서 여러 파일 다운로드
 */
export async function downloadBatchWithPlaywright(
  attachments: Array<{ downloadUrl: string; fileName: string; refererUrl: string }>,
  outputDir: string,
  config: BrowserConfig = {},
  onProgress?: (index: number, total: number, fileName: string, success: boolean, error?: string) => void
): Promise<{ success: number; failed: number; results: Array<{ fileName: string; success: boolean; error?: string }> }> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  const results: Array<{ fileName: string; success: boolean; error?: string }> = [];
  let success = 0;
  let failed = 0;

  try {
    // 브라우저 시작
    const launchOptions: any = {
      headless: mergedConfig.headless,
      timeout: mergedConfig.timeout,
    };

    if (mergedConfig.browserType === "chrome") {
      launchOptions.channel = "chrome";
    } else if (mergedConfig.browserType === "msedge") {
      launchOptions.channel = "msedge";
    }

    applyContainerArgs(launchOptions);
    browser = await chromium.launch(launchOptions);
    context = await browser.newContext({
      userAgent: mergedConfig.userAgent,
      acceptDownloads: true,
    });

    const fs = await import('fs');
    const path = await import('path');
    fs.mkdirSync(outputDir, { recursive: true });

    // Referer별로 그룹화 (같은 상세 페이지의 첨부파일은 세션 공유)
    const groupedByReferer = new Map<string, typeof attachments>();
    for (const att of attachments) {
      const group = groupedByReferer.get(att.refererUrl) || [];
      group.push(att);
      groupedByReferer.set(att.refererUrl, group);
    }

    console.log(`[PW-DOWNLOAD] 총 ${attachments.length}개 파일, ${groupedByReferer.size}개 페이지 그룹`);

    let processedCount = 0;

    let pageIndex = 0;
    for (const [refererUrl, atts] of groupedByReferer) {
      pageIndex++;

      // 페이지 간 딜레이 (NIER 등 불안정한 서버 대비, 첫 페이지 제외)
      if (pageIndex > 1) {
        console.log(`[PW-DOWNLOAD] 서버 안정화 대기 (3초)...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      console.log(`[PW-DOWNLOAD] 페이지 방문: ${refererUrl.slice(0, 80)}...`);
      const page = await context.newPage();

      try {
        // 상세 페이지 방문 (세션 쿠키 획득) - NIER 등 불안정한 서버 대비
        // 최대 3회 재시도
        let pageLoaded = false;
        for (let pageRetry = 0; pageRetry < 3 && !pageLoaded; pageRetry++) {
          try {
            if (pageRetry > 0) {
              console.log(`[PW-DOWNLOAD] 페이지 로딩 재시도 ${pageRetry}/3...`);
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
            await page.goto(refererUrl, {
              waitUntil: 'domcontentloaded',
              timeout: mergedConfig.timeout || 60000
            });
            pageLoaded = true;
          } catch (gotoError) {
            console.log(`[PW-DOWNLOAD] 페이지 로딩 시도 ${pageRetry + 1} 실패: ${gotoError}`);
            if (pageRetry === 2) throw gotoError; // 마지막 시도 실패 시 에러 전파
          }
        }
        await page.waitForTimeout(2000); // 추가 대기 시간

        // 같은 세션에서 모든 첨부파일 다운로드
        for (const att of atts) {
          processedCount++;
          const safeFileName = att.fileName.replace(/[\\/:*?"<>|]/g, '_');
          const filePath = path.join(outputDir, safeFileName);

          console.log(`[PW-DOWNLOAD] [${processedCount}/${attachments.length}] ${att.fileName}`);
          console.log(`[PW-DOWNLOAD] URL: ${att.downloadUrl.slice(0, 100)}...`);

          try {
            // ============================================================
            // NIER 전용: 상세 페이지에서 다운로드 버튼 클릭
            // post:/common/comDownloadFile.do|atchFileNo=xxx&atchFileSeq=yyy 형식
            // ============================================================
            const isNierPostUrl = refererUrl.includes('nier.go.kr') && att.downloadUrl.startsWith('post:');
            const isNierFileDownUrl = refererUrl.includes('nier.go.kr') && att.downloadUrl.includes('comBbsFileDownLoad.do');

            if (isNierPostUrl || isNierFileDownUrl) {
              console.log(`[PW-DOWNLOAD] NIER 클릭 기반 다운로드 시도...`);

              // atchFileNo 또는 fileNo 추출
              let fileNo = '';
              if (isNierPostUrl) {
                const atchFileNoMatch = att.downloadUrl.match(/atchFileNo=(\d+)/);
                fileNo = atchFileNoMatch ? atchFileNoMatch[1] : '';
              } else {
                const fileNoMatch = att.downloadUrl.match(/fileNo=(\d+)/);
                fileNo = fileNoMatch ? fileNoMatch[1] : '';
              }

              if (fileNo) {
                // 다운로드 버튼 찾기: data-no 속성으로 매칭
                const downloadBtn = await page.$(`a.fileDownload[data-no="${fileNo}"]`);

                if (downloadBtn) {
                  console.log(`[PW-DOWNLOAD] NIER 버튼 발견: data-no="${fileNo}"`);

                  // 최대 3회 재시도
                  for (let retry = 0; retry < 3; retry++) {
                    try {
                      if (retry > 0) {
                        console.log(`[PW-DOWNLOAD] NIER 재시도 ${retry}/3...`);
                        // 페이지 새로고침 후 버튼 다시 찾기 (domcontentloaded로 빠르게)
                        await page.goto(refererUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        await page.waitForTimeout(2000);
                      }

                      const retryBtn = retry > 0
                        ? await page.$(`a.fileDownload[data-no="${fileNo}"]`)
                        : downloadBtn;

                      if (!retryBtn) {
                        console.log(`[PW-DOWNLOAD] NIER 재시도 버튼 못찾음`);
                        continue;
                      }

                      const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
                      await retryBtn.click();

                      const download = await downloadPromise;
                      console.log(`[PW-DOWNLOAD] NIER 다운로드 시작: ${download.suggestedFilename()}`);

                      // 파일 저장
                      const downloadPath = await download.path();
                      if (downloadPath) {
                        // suggestedFilename 사용 (확장자 포함)
                        const suggestedName = download.suggestedFilename() || safeFileName;
                        const finalPath = path.join(outputDir, suggestedName.replace(/[\\/:*?"<>|]/g, '_'));
                        await download.saveAs(finalPath);

                        const stats = fs.statSync(finalPath);
                        if (stats.size > 0) {
                          success++;
                          results.push({ fileName: suggestedName, success: true });
                          onProgress?.(processedCount, attachments.length, suggestedName, true);
                          console.log(`[PW-DOWNLOAD] ✅ NIER 완료: ${stats.size} bytes`);

                          // 다운로드 후 상세 페이지로 돌아가기
                          await page.goto(refererUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => { });
                          await page.waitForTimeout(1000);
                          break; // 성공 시 루프 탈출
                        } else {
                          fs.unlinkSync(finalPath);
                          throw new Error('빈 파일 다운로드됨');
                        }
                      } else {
                        throw new Error('다운로드 경로 없음');
                      }
                    } catch (retryError) {
                      const errMsg = retryError instanceof Error ? retryError.message : String(retryError);
                      console.log(`[PW-DOWNLOAD] NIER 시도 ${retry + 1} 실패: ${errMsg}`);

                      // 마지막 시도가 아니면 대기 후 재시도
                      if (retry < 2) {
                        await page.waitForTimeout(2000);
                      } else {
                        // 마지막 시도도 실패하면 전체 실패 처리
                        throw retryError;
                      }
                    }
                  }
                  continue; // 성공하면 다음 파일로
                } else {
                  console.log(`[PW-DOWNLOAD] NIER 버튼 못찾음: data-no="${fileNo}"`);
                }
              }
              throw new Error('NIER 다운로드 버튼 클릭 실패');
            }

            // 방법 1: JavaScript로 location.href 설정하여 다운로드 트리거
            const downloadPromise = page.waitForEvent('download', { timeout: 20000 });

            // 새 탭에서 다운로드 URL 열기 (세션 쿠키 유지)
            await page.evaluate((url) => {
              window.location.href = url;
            }, att.downloadUrl);

            const download = await downloadPromise;
            console.log(`[PW-DOWNLOAD] 다운로드 시작: ${download.suggestedFilename()}`);

            // 다운로드 완료 대기
            const downloadPath = await download.path();
            if (downloadPath) {
              // 파일 이동 (다운로드 폴더에서 대상 폴더로)
              await download.saveAs(filePath);

              const stats = fs.statSync(filePath);
              if (stats.size > 0) {
                success++;
                results.push({ fileName: att.fileName, success: true });
                onProgress?.(processedCount, attachments.length, att.fileName, true);
                console.log(`[PW-DOWNLOAD] ✅ 완료: ${stats.size} bytes`);

                // 다운로드 후 상세 페이지로 돌아가기
                await page.goto(refererUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => { });
                await page.waitForTimeout(500);
                continue;
              } else {
                fs.unlinkSync(filePath);
                throw new Error('빈 파일');
              }
            }
            throw new Error('다운로드 경로 없음');
          } catch (dlError) {
            console.log(`[PW-DOWNLOAD] 방법1 실패: ${dlError}`);

            // 방법 2: 직접 request 사용 (쿠키 포함)
            try {
              // 상세 페이지로 돌아가기
              await page.goto(refererUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => { });

              const response = await page.request.get(att.downloadUrl, {
                timeout: 30000,
              });

              if (response.ok()) {
                const buffer = await response.body();
                if (buffer && buffer.length > 0) {
                  fs.writeFileSync(filePath, buffer);
                  success++;
                  results.push({ fileName: att.fileName, success: true });
                  onProgress?.(processedCount, attachments.length, att.fileName, true);
                  console.log(`[PW-DOWNLOAD] ✅ 방법2 완료: ${buffer.length} bytes`);
                  continue;
                }
              }
              throw new Error(`HTTP ${response.status()}`);
            } catch (reqError) {
              console.log(`[PW-DOWNLOAD] 방법2 실패: ${reqError}`);
            }

            failed++;
            const errorMsg = dlError instanceof Error ? dlError.message : String(dlError);
            results.push({ fileName: att.fileName, success: false, error: errorMsg });
            onProgress?.(processedCount, attachments.length, att.fileName, false, errorMsg);
          }
        }
      } catch (pageError) {
        console.log(`[PW-DOWNLOAD] 페이지 에러: ${pageError}`);
        // 남은 파일들 실패 처리
        for (const att of atts) {
          if (!results.find(r => r.fileName === att.fileName)) {
            failed++;
            results.push({ fileName: att.fileName, success: false, error: String(pageError) });
            onProgress?.(++processedCount, attachments.length, att.fileName, false, String(pageError));
          }
        }
      } finally {
        await page.close().catch(() => { });
      }
    }

    // 다운로드 완료 후 ZIP 파일 자동 압축 해제
    if (success > 0) {
      const zipExtractResult = extractAllZipsInDirectory(outputDir, true);
      if (zipExtractResult.totalZips > 0) {
        console.log(`[PW-DOWNLOAD] ZIP 압축 해제: ${zipExtractResult.successCount}/${zipExtractResult.totalZips}개 완료, ${zipExtractResult.extractedFiles.length}개 파일 추출`);
      }
    }

    return { success, failed, results };
  } catch (error) {
    return {
      success,
      failed: attachments.length - success,
      results
    };
  } finally {
    if (context) {
      await context.close().catch(() => { });
    }
    if (browser) {
      await browser.close().catch(() => { });
    }
  }
}

/**
 * 브라우저 종료
 */
export async function closeBrowser(): Promise<void> {
  if (globalBrowser) {
    await globalBrowser.close().catch(() => { });
    globalBrowser = null;
  }
}

/**
 * 브라우저 상태 확인
 */
export function isBrowserRunning(): boolean {
  return globalBrowser !== null && globalBrowser.isConnected();
}

/**
 * PowerShell을 사용하여 ZIP 파일 압축 해제 (CP949 인코딩 지원)
 * Windows .NET의 ZipFile 클래스를 사용하여 한글 파일명 정상 처리
 */
function extractZipWithPowerShell(
  zipFilePath: string,
  extractToDir: string
): { success: boolean; error?: string } {
  const { execSync } = require("child_process");
  const fs = require("fs");
  const path = require("path");

  try {
    // PowerShell 스크립트: CP949(코드페이지 949) 인코딩으로 ZIP 압축 해제
    const psScript = `
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $encoding = [System.Text.Encoding]::GetEncoding(949)
      $zip = [System.IO.Compression.ZipFile]::Open('${zipFilePath.replace(/\\/g, "\\\\")}', 'Read', $encoding)
      foreach ($entry in $zip.Entries) {
        if (-not $entry.FullName.EndsWith('/')) {
          $targetPath = Join-Path '${extractToDir.replace(/\\/g, "\\\\")}' $entry.Name
          $entryStream = $entry.Open()
          $fileStream = [System.IO.File]::Create($targetPath)
          $entryStream.CopyTo($fileStream)
          $fileStream.Close()
          $entryStream.Close()
          Write-Host "Extracted: $($entry.Name)"
        }
      }
      $zip.Dispose()
    `.trim();

    // PowerShell 실행
    const result = execSync(`powershell -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, "; ")}"`, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 60000,
    });

    console.log(`[ZIP-EXTRACT] PowerShell 압축 해제 완료`);
    if (result) {
      console.log(`[ZIP-EXTRACT] ${result}`);
    }

    return { success: true };
  } catch (error) {
    console.error(`[ZIP-EXTRACT] PowerShell 압축 해제 실패:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * ZIP 파일 압축 해제
 * @param zipFilePath ZIP 파일 경로
 * @param extractToDir 압축 해제할 디렉토리 (기본값: ZIP 파일이 있는 디렉토리)
 * @param deleteZipAfterExtract 압축 해제 후 ZIP 파일 삭제 여부 (기본값: true)
 * @returns 압축 해제된 파일 목록
 */
export function extractZipFile(
  zipFilePath: string,
  extractToDir?: string,
  deleteZipAfterExtract: boolean = true
): { success: boolean; extractedFiles: string[]; error?: string } {
  const fs = require("fs");
  const path = require("path");

  try {
    // ZIP 파일 존재 확인
    if (!fs.existsSync(zipFilePath)) {
      return { success: false, extractedFiles: [], error: `ZIP 파일이 존재하지 않습니다: ${zipFilePath}` };
    }

    // 압축 해제 디렉토리 설정
    const targetDir = extractToDir || path.dirname(zipFilePath);
    
    // 디렉토리 생성
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    console.log(`[ZIP-EXTRACT] ZIP 파일 압축 해제 시작: ${path.basename(zipFilePath)}`);

    // 압축 해제 전 기존 파일 목록
    const filesBefore = new Set(fs.existsSync(targetDir) ? fs.readdirSync(targetDir) : []);

    // Windows에서는 PowerShell을 사용하여 CP949 인코딩 처리
    const psResult = extractZipWithPowerShell(zipFilePath, targetDir);
    
    if (psResult.success) {
      // 압축 해제 후 새로 생성된 파일 목록
      const filesAfter = fs.readdirSync(targetDir);
      const extractedFiles: string[] = [];
      
      for (const file of filesAfter) {
        if (!filesBefore.has(file) && !file.toLowerCase().endsWith(".zip")) {
          const filePath = path.join(targetDir, file);
          extractedFiles.push(filePath);
          console.log(`[ZIP-EXTRACT] 추출됨: ${file}`);
        }
      }

      // ZIP 파일 삭제
      if (deleteZipAfterExtract && extractedFiles.length > 0) {
        try {
          fs.unlinkSync(zipFilePath);
          console.log(`[ZIP-EXTRACT] ZIP 파일 삭제됨: ${path.basename(zipFilePath)}`);
        } catch (err) {
          console.error(`[ZIP-EXTRACT] ZIP 파일 삭제 실패:`, err);
        }
      }

      console.log(`[ZIP-EXTRACT] 압축 해제 완료: ${extractedFiles.length}개 파일`);
      return { success: true, extractedFiles };
    }

    // PowerShell 실패 시 AdmZip 폴백 (영문 파일명만 정상 처리됨)
    console.log(`[ZIP-EXTRACT] PowerShell 실패, AdmZip 폴백 사용`);
    
    const zip = new AdmZip(zipFilePath);
    const zipEntries = zip.getEntries();
    const extractedFiles: string[] = [];

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;

      const fileName = path.basename(entry.entryName);
      
      // 빈 파일명 또는 숨김 파일 스킵
      if (!fileName || fileName.startsWith(".")) continue;

      // 안전한 파일명으로 변환
      const safeFileName = fileName.replace(/[\\/:*?"<>|]/g, "_");
      const targetFilePath = path.join(targetDir, safeFileName);

      try {
        // 파일 추출
        const content = entry.getData();
        fs.writeFileSync(targetFilePath, content);
        extractedFiles.push(targetFilePath);
        console.log(`[ZIP-EXTRACT] 추출됨: ${safeFileName}`);
      } catch (err) {
        console.error(`[ZIP-EXTRACT] 추출 실패: ${safeFileName}`, err);
      }
    }

    // ZIP 파일 삭제
    if (deleteZipAfterExtract && extractedFiles.length > 0) {
      try {
        fs.unlinkSync(zipFilePath);
        console.log(`[ZIP-EXTRACT] ZIP 파일 삭제됨: ${path.basename(zipFilePath)}`);
      } catch (err) {
        console.error(`[ZIP-EXTRACT] ZIP 파일 삭제 실패:`, err);
      }
    }

    console.log(`[ZIP-EXTRACT] 압축 해제 완료: ${extractedFiles.length}개 파일`);
    return { success: true, extractedFiles };
  } catch (error) {
    console.error(`[ZIP-EXTRACT] 압축 해제 오류:`, error);
    return { 
      success: false, 
      extractedFiles: [], 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

/**
 * 디렉토리 내 모든 ZIP 파일 압축 해제
 * @param directory 대상 디렉토리
 * @param deleteZipAfterExtract 압축 해제 후 ZIP 파일 삭제 여부
 * @returns 압축 해제 결과
 */
export function extractAllZipsInDirectory(
  directory: string,
  deleteZipAfterExtract: boolean = true
): { totalZips: number; successCount: number; extractedFiles: string[] } {
  const fs = require("fs");
  const path = require("path");

  const result = {
    totalZips: 0,
    successCount: 0,
    extractedFiles: [] as string[]
  };

  try {
    if (!fs.existsSync(directory)) {
      return result;
    }

    const files = fs.readdirSync(directory);
    const zipFiles = files.filter((f: string) => f.toLowerCase().endsWith(".zip"));
    result.totalZips = zipFiles.length;

    if (zipFiles.length === 0) {
      return result;
    }

    console.log(`[ZIP-EXTRACT] ${directory}에서 ${zipFiles.length}개 ZIP 파일 발견`);

    for (const zipFile of zipFiles) {
      const zipPath = path.join(directory, zipFile);
      const extractResult = extractZipFile(zipPath, directory, deleteZipAfterExtract);
      
      if (extractResult.success) {
        result.successCount++;
        result.extractedFiles.push(...extractResult.extractedFiles);
      }
    }

    return result;
  } catch (error) {
    console.error(`[ZIP-EXTRACT] 디렉토리 처리 오류:`, error);
    return result;
  }
}
