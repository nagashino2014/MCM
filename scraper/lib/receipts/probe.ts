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

import { openContext, ensureSiteDir, waitForContextClose } from "./session";
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

interface FormField {
  tag: string;
  name: string;
  type: string;
  value: string;
  /** 날짜로 보이는 값이거나 이름이 날짜스러운 필드 — 기간 조회 폼을 찾는 단서 */
  looksLikeDate: boolean;
}

interface FormInfo {
  action: string | null;
  method: string | null;
  target: string | null;
  id: string | null;
  fields: FormField[];
}

interface NavLink {
  text: string;
  href: string;
}

interface FrameInspection {
  /** 메인 문서면 "main", iframe 이면 그 주소 */
  frameUrl: string;
  rowSelectorMatches: { selector: string; count: number }[];
  receiptCandidates: ClickableCandidate[];
  orderNoCandidates: string[];
  dateCandidates: string[];
  /** 화면의 폼 구조 — 조회 버튼을 누르지 않고도 기간 조회 요청을 알아내기 위한 것 */
  forms: FormInfo[];
  /** 주문내역·증빙 화면으로 가는 링크 후보 — 시작 주소를 모를 때 여기서 찾는다 */
  navLinks: NavLink[];
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
  /** 프레임 이동·네비게이션 요청(폼 POST 포함) — 기간 조회 요청을 찾는 단서 */
  navUrls?: string[];
  /** 화면에서 제출된 폼의 action·method·필드값 — 기간 조회 파라미터가 여기 잡힌다 */
  formSubmits?: string[];
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

/** 프레임의 폼 구조를 긁는다(action·method·target 과 전체 필드) */
async function collectForms(scope: Page | Frame): Promise<FormInfo[]> {
  return scope
    .evaluate(() => {
      const isDateish = (name: string, value: string) =>
        /^\d{8}$/.test(value) ||
        /^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}$/.test(value) ||
        /(dt|date|day|ymd)/i.test(name);

      return Array.from(document.querySelectorAll("form")).map((form) => ({
        // form.action/method 는 같은 이름의 input 에 가려질 수 있어 속성으로 읽는다.
        action: form.getAttribute("action"),
        method: form.getAttribute("method"),
        target: form.getAttribute("target"),
        id: form.getAttribute("id"),
        fields: Array.from(form.querySelectorAll("input, select, textarea")).map((el) => {
          const name = el.getAttribute("name") || "";
          const value = (el as HTMLInputElement).value || "";
          return {
            tag: el.tagName.toLowerCase(),
            name,
            type: el.getAttribute("type") || "",
            value: value.slice(0, 60),
            looksLikeDate: isDateish(name, value),
          };
        }),
      }));
    })
    .catch(() => [] as FormInfo[]);
}

/** 주문내역·증빙 화면으로 가는 링크를 긁는다(메인 페이지에서 시작 주소를 찾기 위한 것) */
async function collectNavLinks(scope: Page | Frame): Promise<NavLink[]> {
  return scope
    .evaluate(() => {
      const keywords = ["주문", "구매", "마이", "나의", "myg", "영수증", "증빙", "내역", "결제"];
      const seen = new Set<string>();
      const out: { text: string; href: string }[] = [];

      // GNB 의 마이페이지 링크가 <a href> 가 아니라 스크립트로 이동하는 경우가 있어(G마켓)
      // onclick 안의 주소까지 본다.
      const urlOf = (el: Element): string => {
        const href = el.getAttribute("href") || "";
        if (href && !href.startsWith("javascript:")) return (el as HTMLAnchorElement).href;

        const script = `${el.getAttribute("onclick") || ""} ${href}`;
        const abs = script.match(/https?:\/\/[^\s'"()]+/);
        if (abs) return abs[0];

        const rel = script.match(/['"](\/[^\s'"()]+)['"]/);
        return rel ? new URL(rel[1], location.href).href : "";
      };

      for (const el of Array.from(document.querySelectorAll("a, button, [onclick]"))) {
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!text || text.length > 30) continue;
        if (!keywords.some((k) => text.toLowerCase().includes(k))) continue;

        const url = urlOf(el);
        if (!url || seen.has(url)) continue;

        seen.add(url);
        out.push({ text, href: url });
      }

      return out.slice(0, 40);
    })
    .catch(() => [] as NavLink[]);
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
    forms: await collectForms(scope),
    navLinks: await collectNavLinks(scope),
    rowSelectorMatches,
    receiptCandidates,
    orderNoCandidates: [...new Set(bodyText.match(/\b\d{9,}\b/g) || [])].slice(0, 30),
    dateCandidates: [...new Set(bodyText.match(/\d{4}[.\-/]\s?\d{1,2}[.\-/]\s?\d{1,2}/g) || [])].slice(0, 30),
  };
}

/** 팝업 안에서 찾은 것들을 그 자리에서 보여준다(창이 닫히면 못 보므로) */
function printPopupSummary(tag: string, f: FrameInspection): void {
  console.log(`${tag} ── 팝업 내용: ${f.frameUrl}`);

  const rows = f.rowSelectorMatches.filter((m) => m.count > 0);
  if (rows.length) console.log(`${tag}   행매칭: ${rows.map((m) => `${m.count}건(${m.selector})`).join(", ")}`);
  if (f.orderNoCandidates.length) console.log(`${tag}   주문번호 후보: ${f.orderNoCandidates.slice(0, 6).join(", ")}`);
  if (f.dateCandidates.length) console.log(`${tag}   날짜 후보: ${f.dateCandidates.slice(0, 6).join(", ")}`);

  for (const c of f.receiptCandidates.slice(0, 8)) {
    console.log(`${tag}   <${c.tag}> "${c.text}" href=${c.href || "-"} onclick=${(c.onclick || "-").slice(0, 80)}`);
  }

  for (const form of f.forms) {
    console.log(`${tag}   폼 action=${form.action || "-"} method=${form.method || "GET"} target=${form.target || "-"}`);
    for (const x of form.fields.slice(0, 12)) {
      console.log(`${tag}     ${x.looksLikeDate ? "★" : " "} ${x.name || "(이름없음)"} = ${x.value || '""'}`);
    }
  }

  for (const link of f.navLinks.slice(0, 8)) console.log(`${tag}   링크 "${link.text}" → ${link.href}`);
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
  const { context, close } = await openContext({ site, headless: cfg.stealth ? false : headless, useSession: true, stealth: cfg.stealth });

  const popupUrls: string[] = [];
  const xhrUrls: string[] = [];
  const navUrls: string[] = [];
  const formSubmits: string[] = [];
  const frames: FrameInspection[] = [];
  // 실행마다 덮어쓰면 직전 실측을 잃는다 — 시각을 붙여 남긴다.
  const xhrLogFile = path.join(outDir, `xhr-log-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  const xhrStream = opts.watch ? fs.createWriteStream(xhrLogFile, { flags: "w" }) : null;

  try {
    const page = context.pages()[0] || (await context.newPage());

    if (opts.watch) {
      context.on("page", (p) => {
        popupUrls.push(p.url());
        console.log(`[${site}] 새 창/팝업: ${p.url()}`);

        // 팝업은 열린 직후 about:blank 인 경우가 많아 이동 후 주소를 한 번 더 잡는다.
        // 영수증 조회가 별도 창으로 열리는 사이트(옥션)에서는 이 창 안이 정작 중요한 화면이라,
        // 주소만이 아니라 폼·링크·식별자 후보까지 그 자리에서 훑는다.
        p.once("domcontentloaded", async () => {
          popupUrls.push(p.url());
          console.log(`[${site}] 팝업 로드 완료: ${p.url()}`);

          try {
            await p.waitForTimeout(2000);
            const inspection = await inspectFrame(p, `popup:${p.url()}`, cfg);
            frames.push(inspection);
            printPopupSummary(`[${site}]`, inspection);
          } catch {
            // 팝업이 곧바로 닫히면 그냥 넘어간다
          }
        });
      });
      // XHR 은 주소만이 아니라 JSON 응답 앞부분까지 남긴다 — 목록·영수증을 내려주는 내부 API 를 찾으면
      // DOM 파싱보다 훨씬 견고하게 수집할 수 있다(lib/daou/probe.ts 와 같은 접근).
      // 기간 조회는 iframe 을 타깃으로 한 폼 submit 으로 도는 경우가 많다. 이때 네비게이션 요청이
      // 리스너에 안 잡히는 경우가 있어(iframe 이 about:blank 로만 보인다), 폼 제출 자체를 후킹해
      // action·method·필드값을 통째로 기록한다. 이게 조회 파라미터를 잡는 가장 확실한 방법이다.
      await context.addInitScript(() => {
        const report = (form: HTMLFormElement, how: string) => {
          try {
            const data: Record<string, string> = {};
            new FormData(form).forEach((value, key) => {
              data[key] = String(value).slice(0, 120);
            });
            // form.method / form.action 은 같은 이름의 input 이 있으면 그 엘리먼트에 가려진다
            // (11번가 조회 폼에는 name="method" 필드가 있다) → 속성으로 읽는다.
            console.log(
              "[[FORM_SUBMIT]] " +
                JSON.stringify({
                  how,
                  action: form.getAttribute("action"),
                  method: form.getAttribute("method"),
                  target: form.getAttribute("target"),
                  data,
                })
            );
          } catch {
            // 폼을 읽을 수 없으면 조용히 넘어간다(진단이 본 작업을 막지 않는다)
          }
        };

        const originalSubmit = HTMLFormElement.prototype.submit;
        HTMLFormElement.prototype.submit = function (this: HTMLFormElement, ...args: unknown[]) {
          report(this, "submit()");
          return originalSubmit.apply(this, args as []);
        };

        document.addEventListener("submit", (e) => report(e.target as HTMLFormElement, "event"), true);
      });

      page.on("console", (msg) => {
        const text = msg.text();
        if (!text.startsWith("[[FORM_SUBMIT]]")) return;

        const payload = text.slice("[[FORM_SUBMIT]]".length).trim();
        console.log(`[${site}] 폼 제출: ${payload.slice(0, 600)}`);
        formSubmits.push(payload);
      });

      // 기간 조회는 iframe 이 통째로 이동하는 형태로 일어나는 경우가 많아, 프레임 이동과
      // 네비게이션 요청(폼 POST 포함)을 따로 추적한다. XHR 만 봐서는 놓친다.
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) return;
        console.log(`[${site}] iframe 이동: ${frame.url()}`);
        navUrls.push(`FRAME ${frame.url()}`);
      });

      context.on("request", (req) => {
        if (!req.isNavigationRequest()) return;

        const postData = req.postData();
        const line = `${req.method()} ${req.url()}${postData ? `\n[${site}]   폼 데이터: ${postData.slice(0, 400)}` : ""}`;
        console.log(`[${site}] 네비게이션: ${line}`);
        navUrls.push(`${req.method()} ${req.url()}${postData ? ` | ${postData.slice(0, 400)}` : ""}`);
      });

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
    frames.unshift(main);

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
      await waitForContextClose(context);
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
      ...(opts.watch
        ? {
            popupUrls: [...new Set(popupUrls)],
            xhrUrls: [...new Set(xhrUrls)].slice(0, 200),
            navUrls: [...new Set(navUrls)].slice(0, 100),
            formSubmits: [...new Set(formSubmits)].slice(0, 50),
          }
        : {}),
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
    await close();
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

  // 주문내역 주소를 모를 때(메인 페이지 등에서 찍었을 때) 다음 목적지를 알려준다.
  const navLinks = r.frames.flatMap((f) => f.navLinks);
  if (r.orderNoCandidates.length === 0 && navLinks.length > 0) {
    console.log(`${tag} 이 화면에는 주문이 없습니다. 아래 링크로 다시 probe 해 보세요:`);
    for (const link of navLinks.slice(0, 15)) {
      console.log(`${tag}   "${link.text}" → ${link.href}`);
    }
  }

  // 기간 조회 폼을 찾기 위한 덤프 — 조회 버튼을 누르지 않아도 구조를 알 수 있다.
  for (const f of r.frames) {
    const withDate = f.forms.filter((form) => form.fields.some((x) => x.looksLikeDate));
    if (withDate.length === 0) continue;

    console.log(`${tag} 날짜 필드를 가진 폼 (${f.frameUrl}):`);
    for (const form of withDate) {
      console.log(
        `${tag}   action=${form.action || "-"} method=${form.method || "GET"} ` +
          `target=${form.target || "-"} id=${form.id || "-"}`
      );
      for (const x of form.fields) {
        const mark = x.looksLikeDate ? "★" : " ";
        console.log(`${tag}    ${mark} ${x.name || "(이름없음)"} = ${x.value || '""'} [${x.tag}${x.type ? ":" + x.type : ""}]`);
      }
    }
  }

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
