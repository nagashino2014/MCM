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
import { Page } from "playwright";

import { openContext, ensureSiteDir, waitForBrowserClose } from "./session";
import { loadSiteConfig, saveSiteConfig } from "./config";

interface ClickableCandidate {
  tag: string;
  text: string;
  href: string | null;
  onclick: string | null;
  className: string;
  /** 조상 3단계 경로 — 주문 행 셀렉터를 정하는 단서 */
  ancestors: string;
}

interface ProbeResult {
  site: string;
  at: string;
  requestedUrl: string;
  finalUrl: string;
  status: number | null;
  looksLoggedOut: boolean;
  title: string;
  rowSelectorMatches: { selector: string; count: number }[];
  receiptCandidates: ClickableCandidate[];
  orderNoCandidates: string[];
  dateCandidates: string[];
  popupUrls?: string[];
  xhrUrls?: string[];
}

/** 페이지에서 키워드가 들어간 클릭 요소를 전부 긁는다 */
async function findReceiptCandidates(page: Page, keywords: string[]): Promise<ClickableCandidate[]> {
  return page.evaluate((kws) => {
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

export async function probeOrderList(
  site: string,
  opts: { url?: string; watch?: boolean } = {}
): Promise<ProbeResult> {
  const cfg = loadSiteConfig(site);
  const url = opts.url || cfg.orderListUrl;
  const outDir = ensureSiteDir(site, "probe");

  // watch 모드는 사용자가 직접 클릭해야 하므로 headed.
  const headless = !opts.watch;
  const { browser, context } = await openContext({ site, headless, useSession: true });

  const popupUrls: string[] = [];
  const xhrUrls: string[] = [];

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
      context.on("request", (req) => {
        if (["xhr", "fetch"].includes(req.resourceType())) xhrUrls.push(`${req.method()} ${req.url()}`);
      });
    }

    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3000);

    const finalUrl = page.url();
    const looksLoggedOut = new RegExp(cfg.loggedOutPattern, "i").test(finalUrl);

    if (looksLoggedOut) {
      console.log(`[${site}] ⚠ 로그인 페이지로 튕겼습니다: ${finalUrl}`);
      console.log(`[${site}]   세션이 만료됐거나 headless 접근이 차단된 경우입니다.`);
      console.log(`[${site}]   'login' 을 다시 실행하거나 '--watch'(headed) 로 재시도하세요.`);
    }

    const rowSelectorMatches: { selector: string; count: number }[] = [];
    for (const selector of cfg.orderRowSelectors) {
      const count = await page.locator(selector).count().catch(() => 0);
      rowSelectorMatches.push({ selector, count });
    }

    const receiptCandidates = await findReceiptCandidates(page, cfg.receiptKeywords);

    const bodyText = await page.evaluate(() => document.body?.innerText || "");
    const orderNoCandidates = [...new Set(bodyText.match(/\b\d{9,}\b/g) || [])].slice(0, 30);
    const dateCandidates = [...new Set(bodyText.match(/\d{4}[.\-/]\s?\d{1,2}[.\-/]\s?\d{1,2}/g) || [])].slice(0, 30);

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
      ...(opts.watch ? { popupUrls: [...new Set(popupUrls)], xhrUrls: [...new Set(xhrUrls)].slice(0, 200) } : {}),
    };

    const resultFile = path.join(outDir, `probe-${stamp}.json`);
    fs.writeFileSync(resultFile, JSON.stringify(result, null, 2), "utf-8");

    printSummary(result, resultFile);

    // 로그인 상태로 잘 열렸다면 실제 주소를 설정에 반영해 둔다.
    if (!looksLoggedOut && finalUrl !== cfg.orderListUrl) {
      saveSiteConfig(site, { orderListUrl: finalUrl, checkUrl: finalUrl });
    }

    return result;
  } finally {
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
  if (r.popupUrls?.length) console.log(`${tag} 팝업 URL: ${r.popupUrls.join("\n         ")}`);
  console.log(`${tag} 상세 결과: ${resultFile}`);
}
