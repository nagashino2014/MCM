/**
 * 주문목록 화면 실측(probe)
 *
 * 셀렉터를 코드에 박아두면 몰이 마크업을 바꿀 때마다 깨진다. 그래서 수집기를 짜기 전에
 * **실제 로그인 세션으로 주문목록을 열어** 아래를 덤프하고, 확정된 값만 site-config.json 에 남긴다.
 *
 *   - 최종 URL / HTTP 상태 / 로그인 튕김 여부
 *   - "영수증·거래명세서" 텍스트를 가진 클릭 요소 전부(태그·href·onclick·클래스·조상 경로)
 *   - 주문 행 후보 셀렉터별 매칭 개수
 *   - 주문번호·날짜 패턴 후보
 *   - 전체 HTML 과 스크린샷(선택자 눈으로 확인용)
 *
 * `--watch` 를 주면 headed 로 띄운 뒤 사용자가 직접 영수증 버튼을 눌러보는 동안 열리는
 * 팝업 URL 과 XHR 을 기록한다 — 영수증 화면의 실제 주소를 잡는 가장 확실한 방법.
 */

import path from "node:path";
import fs from "node:fs";
import { Frame, Page } from "playwright";

import { openContext, ensureSiteDir, waitForBrowserClose } from "./session";
import { loadSiteConfig, saveSiteConfig, SiteConfig } from "./config";

/** XHR 응답 본문 저장 상한(개인정보·용량 고려) */
const XHR_BODY_PREVIEW_LIMIT = 4000;

interface ClickableCandidate {
  tag: string;
  text: string;
  href: string | null;
  onclick: string | null;
  className: string;
  /** 조상 3단계 경로 — 주문 행 셀렉터를 정하는 단서 */
  ancestors: string;
}

interface FrameInspection {
  /** 메인 문서면 "main", iframe 이면 그 주소 */
  frameUrl: string;
  rowSelectorMatches: { selector: string; count: number }[];
  receiptCandidates: ClickableCandidate[];
  orderNoCandidates: string[];
  dateCandidates: string[];
}

interface ProbeResult {
  site: string;
  at: string;
  requestedUrl: string;
  finalUrl: string;
  status: number | null;
  looksLoggedOut: boolean;
  title: string;
  /** 메인 문서 관측(하위 호환) */
  rowSelectorMatches: { selector: string; count: number }[];
  receiptCandidates: ClickableCandidate[];
  orderNoCandidates: string[];
  dateCandidates: string[];
  /** 메인 + iframe 전부. 11번가 마이페이지처럼 목록이 iframe 안에 있는 경우를 잡는다. */
  frames: FrameInspection[];
  popupUrls?: string[];
  xhrUrls?: string[];
}

/** 페이지에서 키워드가 들어간 클릭 요소를 전부 긁는다 */
async function findReceiptCandidates(scope: Page | Frame, keywords: string[]): Promise<ClickableCandidate[]> {
  return scope.evaluate((kws) => {
    const out: ClickableCandidate[] = [];
    const nodes = Array.from(document.querySelectorAll("a, button, [onclick], [role='button']"));

    for (const el of nodes) {
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 40) continue;
      if (!kws.some((k) => text.includes(k))) continue;

      const ancestors: string[] = [];
      let cur: Element | null = el.parentElement;
      for (let i = 0; i < 3 && cur; i++) {
        const cls = (cur.className || "").toString().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
        ancestors.push(cur.tagName.toLowerCase() + (cls ? "." + cls : ""));
        cur = cur.parentElement;
      }

      out.push({
        tag: el.tagName.toLowerCase(),
        text,
        href: el.getAttribute("href"),
        onclick: el.getAttribute("onclick"),
        className: (el.className || "").toString().slice(0, 120),
        ancestors: ancestors.join(" < "),
      });
    }
    return out;
  }, keywords);
}

/** 프레임(메인 문서 또는 iframe) 하나를 훑어 관측치를 모은다 */
async function inspectFrame(scope: Page | Frame, frameUrl: string, cfg: SiteConfig): Promise<FrameInspection> {
  const rowSelectorMatches: { selector: string; count: number }[] = [];
  for (const selector of cfg.orderRowSelectors) {
    const count = await scope.locator(selector).count().catch(() => 0);
    rowSelectorMatches.push({ selector, count });
  }

  const receiptCandidates = await findReceiptCandidates(scope, cfg.receiptKeywords).catch(() => []);
  const bodyText = await scope.evaluate(() => document.body?.innerText || "").catch(() => "");

  return {
    frameUrl,
    rowSelectorMatches,
    receiptCandidates,
    orderNoCandidates: [...new Set(bodyText.match(/\b\d{9,}\b/g) || [])].slice(0, 30),
    dateCandidates: [...new Set(bodyText.match(/\d{4}[.\-/]\s?\d{1,2}[.\-/]\s?\d{1,2}/g) || [])].slice(0, 30),
  };
}

export async function probeOrderList(
  site: string,
  opts: { url?: string; watch?: boolean; save?: boolean } = {}
): Promise<ProbeResult> {
  const cfg = loadSiteConfig(site);
  const url = opts.url || cfg.orderListUrl;
  const outDir = ensureSiteDir(site, "probe");

  // watch 모드는 사용자가 직접 클릭해야 하므로 headed.
  const headless = !opts.watch;
  const { browser, context } = await openContext({ site, headless, useSession: true });

  const popupUrls: string[] = [];
  const xhrUrls: string[] = [];
  const xhrLogFile = path.join(outDir, "xhr-log.jsonl");
  const xhrStream = opts.watch ? fs.createWriteStream(xhrLogFile, { flags: "w" }) : null;

  try {
    const page = await context.newPage();

    if (opts.watch) {
      context.on("page", (p) => {
        popupUrls.push(p.url());
        console.log(`[${site}] 새 창/팝업: ${p.url()}`);
        // 팝업은 열린 직후 about:blank 인 경우가 많아 이동 후 주소를 한 번 더 잡는다.
        p.once("domcontentloaded", () => {
          popupUrls.push(p.url());
          console.log(`[${site}] 팝업 로드 완료: ${p.url()}`);
        });
      });
      // XHR 은 주소만이 아니라 JSON 응답 앞부분까지 남긴다 — 목록·영수증을 내려주는 내부 API 를 찾으면
      // DOM 파싱보다 훨씬 견고하게 수집할 수 있다(lib/daou/probe.ts 와 같은 접근).
      context.on("response", async (res) => {
        const req = res.request();
        // 기간 조회는 XHR 이 아니라 폼 POST(document 네비게이션)로 도는 경우가 많아 document 도 남긴다.
        if (!["xhr", "fetch", "document"].includes(req.resourceType())) return;

        xhrUrls.push(`${req.method()} ${req.url()}`);
        const postData = req.postData();
        if (postData) console.log(`[${site}] ${req.method()} ${req.url()}\n[${site}]   폼 데이터: ${postData.slice(0, 300)}`);

        const contentType = (res.headers()["content-type"] || "").split(";")[0];

        // JSON 응답만 본문을 남긴다(HTML 은 너무 커서 의미가 없다). 요청·폼데이터는 종류와 무관하게 기록.
        const body = contentType.includes("json")
          ? await Promise.race<string>([
              // navigation 으로 폐기된 응답에서 text() 가 안 끝나는 경우가 있어 타임아웃을 건다.
              res.text().catch(() => ""),
              new Promise<string>((resolve) => setTimeout(() => resolve(""), 5000)),
            ])
          : "";

        xhrStream?.write(
          JSON.stringify({
            at: new Date().toISOString(),
            method: req.method(),
            url: req.url(),
            status: res.status(),
            postData: postData ? postData.slice(0, 1000) : undefined,
            bodyPreview: body.slice(0, XHR_BODY_PREVIEW_LIMIT),
          }) + "\n"
        );
      });
    }

    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    // 목록은 XHR 로 늦게 채워지는 경우가 있어 네트워크가 잦아들 때까지 기다린다.
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const finalUrl = page.url();
    const looksLoggedOut = new RegExp(cfg.loggedOutPattern, "i").test(finalUrl);

    if (looksLoggedOut) {
      console.log(`[${site}] ⚠ 로그인 페이지로 튕겼습니다: ${finalUrl}`);
      console.log(`[${site}]   세션이 만료됐거나 headless 접근이 차단된 경우입니다.`);
      console.log(`[${site}]   'login' 을 다시 실행하거나 '--watch'(headed) 로 재시도하세요.`);
    }

    // 메인 문서 + 모든 iframe 을 훑는다(목록이 iframe 안에 있는 경우를 놓치지 않으려고).
    const main = await inspectFrame(page, "main", cfg);
    const frames: FrameInspection[] = [main];

    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      frames.push(await inspectFrame(frame, frame.url(), cfg));
    }

    const { rowSelectorMatches, receiptCandidates, orderNoCandidates, dateCandidates } = main;

    // 원본 보존 — 셀렉터를 눈으로 확인할 때 필요
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(path.join(outDir, `order-list-${stamp}.html`), await page.content(), "utf-8");
    await page.screenshot({ path: path.join(outDir, `order-list-${stamp}.png`), fullPage: true }).catch(() => {});

    if (opts.watch) {
      console.log(`[${site}] ─────────────────────────────────────────────`);
      console.log(`[${site}] 브라우저에서 영수증 버튼을 직접 눌러보세요.`);
      console.log(`[${site}] 열리는 팝업 주소와 XHR 을 기록합니다. 다 되면 창을 닫으세요.`);
      await waitForBrowserClose(browser);
    }

    const result: ProbeResult = {
      site,
      at: new Date().toISOString(),
      requestedUrl: url,
      finalUrl,
      status: res?.status() ?? null,
      looksLoggedOut,
      title: await page.title().catch(() => ""),
      rowSelectorMatches,
      receiptCandidates,
      orderNoCandidates,
      dateCandidates,
      frames,
      ...(opts.watch ? { popupUrls: [...new Set(popupUrls)], xhrUrls: [...new Set(xhrUrls)].slice(0, 200) } : {}),
    };

    const resultFile = path.join(outDir, `probe-${stamp}.json`);
    fs.writeFileSync(resultFile, JSON.stringify(result, null, 2), "utf-8");

    printSummary(result, resultFile);

    // 로그인 상태로 잘 열렸다면 실제 주소를 설정에 반영한다.
    // --url 로 다른 화면을 잠깐 들여다보는 경우까지 덮어쓰면 곤란하므로, 그때는 --save 를 줘야 저장한다.
    const shouldSave = !looksLoggedOut && finalUrl !== cfg.orderListUrl && (!opts.url || opts.save);
    if (shouldSave) {
      saveSiteConfig(site, { orderListUrl: finalUrl, checkUrl: finalUrl });
    } else if (!looksLoggedOut && opts.url && finalUrl !== cfg.orderListUrl) {
      console.log(`[${site}] (이 주소를 수집 시작점으로 쓰려면 --save 를 붙여 다시 실행하세요)`);
    }

    return result;
  } finally {
    if (xhrStream) {
      xhrStream.end();
      console.log(`[${site}] XHR 기록: ${xhrLogFile}`);
    }
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function printSummary(r: ProbeResult, resultFile: string): void {
  const tag = `[${r.site}]`;
  console.log(`${tag} 최종 URL: ${r.finalUrl} (HTTP ${r.status})`);
  console.log(`${tag} 제목: ${r.title}`);
  console.log(`${tag} 로그인 상태: ${r.looksLoggedOut ? "❌ 튕김" : "✅ 유지"}`);

  console.log(`${tag} 주문 행 셀렉터 매칭:`);
  for (const m of r.rowSelectorMatches) {
    console.log(`${tag}   ${m.count.toString().padStart(3)} 건  ${m.selector}`);
  }

  console.log(`${tag} 영수증 후보 요소 ${r.receiptCandidates.length}개`);
  for (const c of r.receiptCandidates.slice(0, 10)) {
    console.log(`${tag}   <${c.tag}> "${c.text}" href=${c.href || "-"} onclick=${(c.onclick || "-").slice(0, 60)}`);
    console.log(`${tag}      조상: ${c.ancestors}`);
  }

  console.log(`${tag} 주문번호 후보: ${r.orderNoCandidates.slice(0, 8).join(", ") || "-"}`);
  console.log(`${tag} 날짜 후보: ${r.dateCandidates.slice(0, 8).join(", ") || "-"}`);

  // 목록이 iframe 안에 있으면 메인 문서에서는 아무것도 안 잡힌다 — 프레임별로 따로 보여준다.
  const subFrames = r.frames.filter((f) => f.frameUrl !== "main");
  if (subFrames.length > 0) {
    console.log(`${tag} iframe ${subFrames.length}개:`);
    for (const f of subFrames) {
      const rows = f.rowSelectorMatches.filter((m) => m.count > 0);
      console.log(`${tag}   ${f.frameUrl}`);
      console.log(
        `${tag}     행매칭 ${rows.map((m) => `${m.count}건(${m.selector})`).join(", ") || "-"} / ` +
          `영수증후보 ${f.receiptCandidates.length}개 / 주문번호 ${f.orderNoCandidates.slice(0, 3).join(", ") || "-"}`
      );
      for (const c of f.receiptCandidates.slice(0, 5)) {
        console.log(`${tag}     <${c.tag}> "${c.text}" href=${c.href || "-"}`);
      }
    }
  }
  if (r.popupUrls?.length) console.log(`${tag} 팝업 URL: ${r.popupUrls.join("\n         ")}`);
  console.log(`${tag} 상세 결과: ${resultFile}`);
}
