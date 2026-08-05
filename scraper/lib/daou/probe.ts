/**
 * 다우오피스 내부 API 탐색(probe)
 * - 다우오피스는 SPA 이므로 화면 뒤에 문서 목록/상세를 JSON 으로 반환하는 내부 API 가 있을 가능성이 높다.
 *   이를 찾으면 HTML 파싱 대신 JSON 페이징 수집이 가능해 속도·정확도가 크게 올라간다.
 * - 사용자가 headed 브라우저에서 [전자결재 > 관리자 양식별 조회 / 전사 문서함 > 문서 상세] 를 돌아다니는 동안
 *   XHR/fetch 요청·응답을 전부 기록하고, 종료 시 경로별로 집계해 후보를 뽑는다.
 */

import path from "node:path";
import fs from "node:fs";
import { chromium } from "playwright";

import { DAOU_DIR, SESSION_FILE, ensureDaouDir, hasSession, waitForBrowserClose } from "./session";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** 응답 본문 저장 상한(개인정보·용량 고려) */
const BODY_PREVIEW_LIMIT = 4000;

interface ProbeEntry {
  at: string;
  method: string;
  url: string;
  status: number;
  contentType: string;
  resourceType: string;
  bodyPreview?: string;
  postData?: string;
}

export async function probeApi(baseUrl: string): Promise<void> {
  ensureDaouDir();
  const outFile = path.join(DAOU_DIR, "probe-log.jsonl");
  const stream = fs.createWriteStream(outFile, { flags: "w" });

  const browser = await chromium.launch({ headless: false, timeout: 60_000 });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1600, height: 1000 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    storageState: hasSession() ? SESSION_FILE : undefined,
  });

  const seenPaths = new Map<string, number>();

  context.on("response", async (res) => {
    try {
      const req = res.request();
      const resourceType = req.resourceType();
      // 문서(HTML) 네비게이션과 XHR/fetch 만 관심 대상. 이미지·CSS·폰트는 제외.
      if (!["xhr", "fetch", "document"].includes(resourceType)) return;

      const url = res.url();
      if (/\.(png|jpe?g|gif|svg|woff2?|css|js)(\?|$)/i.test(url)) return;

      const contentType = (res.headers()["content-type"] || "").split(";")[0];
      const key = `${req.method()} ${new URL(url).pathname}`;
      seenPaths.set(key, (seenPaths.get(key) || 0) + 1);

      let bodyPreview: string | undefined;
      if (contentType.includes("json")) {
        // navigation 으로 폐기된 응답에서 text() 가 영영 안 끝나는 경우가 있어 타임아웃을 건다.
        const text = await Promise.race<string>([
          res.text().catch(() => ""),
          new Promise<string>((resolve) => setTimeout(() => resolve(""), 5000)),
        ]);
        bodyPreview = text.slice(0, BODY_PREVIEW_LIMIT);
      }

      const entry: ProbeEntry = {
        at: new Date().toISOString(),
        method: req.method(),
        url,
        status: res.status(),
        contentType,
        resourceType,
        bodyPreview,
        postData: req.postData()?.slice(0, 1000) || undefined,
      };
      stream.write(JSON.stringify(entry) + "\n");
    } catch {
      // 탐색용이므로 개별 실패는 무시
    }
  });

  try {
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

    console.log("[DAOU] API 탐색 모드. 아래 순서로 브라우저를 조작해 주세요:");
    console.log("  1) (필요 시) 로그인");
    console.log("  2) 전자결재 > 관리자 > 양식별 조회  — 조회 기간을 전체로 잡고 목록 조회");
    console.log("  3) 목록 2페이지, 3페이지로 이동(페이징 파라미터 확인용)");
    console.log("  4) 아무 문서나 열어 상세 화면 확인");
    console.log("  5) 그 문서의 [인쇄] 팝업 열기");
    console.log("  6) 첨부파일이 있는 문서를 열어 첨부 1개 다운로드");
    console.log("  7) 전사 문서함도 한 번 조회");
    console.log("\n[DAOU] 조작을 마쳤으면 **브라우저 창을 닫으세요** — 그 시점에 기록이 종료됩니다.");

    // 세션도 함께 갱신(로그인 상태가 바뀌었을 수 있음)
    const timer = setInterval(async () => {
      try {
        await context.storageState({ path: SESSION_FILE });
      } catch {
        // 종료 중이면 무시
      }
    }, 5000);

    await waitForBrowserClose(browser);
    clearInterval(timer);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    stream.end();
  }

  // 경로별 집계 요약
  const sorted = [...seenPaths.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n[DAOU] 기록 완료: ${outFile}`);
  console.log(`[DAOU] 관측된 엔드포인트 ${sorted.length}종 (호출수 순):`);
  for (const [key, count] of sorted.slice(0, 40)) {
    console.log(`  ${String(count).padStart(4)}회  ${key}`);
  }

  const summaryFile = path.join(DAOU_DIR, "probe-summary.json");
  fs.writeFileSync(
    summaryFile,
    JSON.stringify({ baseUrl, capturedAt: new Date().toISOString(), endpoints: sorted.map(([k, v]) => ({ endpoint: k, count: v })) }, null, 2),
    "utf-8"
  );
  console.log(`[DAOU] 요약 저장: ${summaryFile}`);
}
