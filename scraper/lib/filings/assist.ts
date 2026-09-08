/**
 * 반자동 신고 흐름 — 로그인된 브라우저로 신고 화면을 열고, 화면 위 패널로 대기열 값을 입력·복사하게 한 뒤
 * 사람이 사이트에서 저장·제출한다. 패널의 [제출 완료]/[제외] 가 MCM 대기열 상태를 바꾼다.
 *
 * 한 번 실행에 같은 종류의 대기 건을 [이전]/[다음] 으로 순회한다(IEPS 세션 1시간 안에 몰아서 처리).
 */
import { BrowserContext, Page } from "playwright";
import { SiteConfig } from "./config";
import { FillTarget, FilingKind, FilingsConfig, KIND_LABEL, KIND_SITE } from "./config";
import { FilingRow, getFiling, listPendingFilings, markFiling } from "./mcm-api";
import { ACTION_FN, OverlayAction, OverlayData, RENDER_FN, renderOverlay } from "./overlay";
import { dumpPage } from "./probe";
import { openContext, snapshotCookies, waitForContextClose } from "./session";

const DATA_FN = "__mcmFilingsGetData";

function toOverlay(
  f: FilingRow | null,
  index: number,
  total: number,
  fill: Record<string, FillTarget>,
  defaults: Record<string, string>
): OverlayData {
  if (!f) {
    return {
      filingId: "",
      kindLabel: "",
      title: "대기 건이 없습니다",
      subtitle: null,
      screen: "창을 닫으면 종료됩니다",
      dueOn: null,
      fields: [],
      index: 0,
      total: 0,
      fill: {},
    };
  }
  return {
    filingId: f.filingId,
    kindLabel: KIND_LABEL[f.filingKind],
    title: f.title,
    subtitle: f.subtitle,
    screen: f.payload.screen,
    dueOn: f.dueOn,
    // MCM 값이 비어 있으면 자사 상수(config.defaults)로 보충
    fields: f.payload.fields.map((fld) =>
      !fld.value && defaults[fld.label] ? { ...fld, value: defaults[fld.label], hint: fld.hint ?? "설정 기본값" } : fld
    ),
    index,
    total,
    fill,
  };
}

export async function runAssist(opts: { cfg: FilingsConfig; kind?: FilingKind; filingId?: string }): Promise<void> {
  const { cfg } = opts;
  let items: FilingRow[];
  if (opts.filingId) {
    const one = await getFiling(opts.filingId);
    if (one.status !== "pending") console.log(`[filings] ⚠ 이 항목은 이미 '${one.status}' 상태입니다. 그래도 엽니다.`);
    items = [one];
  } else if (opts.kind) {
    items = await listPendingFilings(opts.kind);
  } else {
    throw new Error("--kind <ieps_staff|ieps_agency|etis_career> 또는 --id <filingId> 가 필요합니다.");
  }
  if (items.length === 0) {
    console.log("[filings] 대기 건이 없습니다.");
    return;
  }
  const kind = (opts.kind ?? items[0].filingKind) as FilingKind;
  const site = KIND_SITE[kind];
  const siteCfg = cfg.sites[site];
  const fill = cfg.fill[kind] ?? {};
  const defaults = cfg.defaults?.[kind] ?? {};
  let index = 0;

  console.log(`[filings] ${KIND_LABEL[kind]} 대기 ${items.length}건 — ${siteCfg.label} 창을 엽니다.`);
  // 사이트 alert 메시지 — 패널 상단 배너로도 보여 준다(페이지가 바뀌어도 20초 안이면 다시 표시).
  const notices: { at: number; text: string }[] = [];
  const { context } = await openContext(site, {
    onNotice: (text) => {
      notices.push({ at: Date.now(), text });
      void rerender();
    },
  });

  const siteSearch = siteCfg.siteSearch;
  const searchQueryOf = (f: FilingRow | undefined): string | undefined => {
    if (!siteSearch || !f) return undefined;
    const v = f.payload.fields.find((x) => x.label === siteSearch.queryLabel)?.value?.trim();
    return v || undefined;
  };
  const current = (): OverlayData => ({
    ...toOverlay(items[index] ?? null, index, items.length, fill, defaults),
    notices: notices.filter((n) => Date.now() - n.at < 20_000).map((n) => n.text),
    siteSearchQuery: searchQueryOf(items[index]),
  });
  const rerender = async () => {
    const d = current();
    for (const p of context.pages()) {
      if (p.isClosed()) continue;
      await p
        .evaluate(({ fn, data }) => {
          const w = window as unknown as Record<string, (d: unknown) => void>;
          if (typeof w[fn] === "function") w[fn](data);
        }, { fn: RENDER_FN, data: d })
        .catch(() => {});
    }
  };

  await context.exposeFunction(DATA_FN, () => current());
  await context.exposeFunction(ACTION_FN, async (a: OverlayAction) => {
    try {
      const cur = items[index];
      if (a.type === "siteSearch") {
        const q = searchQueryOf(cur);
        const target = context.pages().filter((p) => !p.isClosed()).pop();
        if (q && target && siteSearch) {
          const result = await runSiteSearch(context, target, siteSearch, q);
          notices.push({ at: Date.now(), text: result });
        }
      } else if (a.type === "probe") {
        // 패널이 떠 있는 바로 그 창의 현재 페이지를 덤프한다(별도 창은 같은 프로필을 못 연다)
        const target = context.pages().filter((p) => !p.isClosed()).pop();
        if (target) {
          const file = await dumpPage(site, target);
          notices.push({ at: Date.now(), text: `폼 덤프 저장: ${file}` });
        }
      } else if (a.type === "next") index = items.length ? (index + 1) % items.length : 0;
      else if (a.type === "prev") index = items.length ? (index - 1 + items.length) % items.length : 0;
      else if (cur && (a.type === "submitted" || a.type === "skipped")) {
        await markFiling(cur.filingId, {
          status: a.type,
          receiptNo: a.type === "submitted" ? a.receiptNo || null : null,
          note: a.type === "skipped" ? a.note || null : null,
        });
        console.log(`[filings] ${cur.title} → ${a.type === "submitted" ? "제출 완료" : "제외"} 기록`);
        items.splice(index, 1);
        if (index >= items.length) index = 0;
      }
    } catch (err) {
      console.log(`[filings] ⚠ 처리 실패: ${(err as Error).message}`);
    }
    await rerender();
  });
  // 페이지가 바뀔 때마다 패널을 다시 그린다 — 데이터는 노드 측에서 받아 온다(항목이 바뀌어도 초기값에 묶이지 않게).
  await context.addInitScript(
    `(() => { const render = ${renderOverlay.toString()};
       const boot = async () => { try { const d = await window["${DATA_FN}"](); if (d) render(d); } catch (e) { /* 미노출 페이지 */ } };
       if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot(); })();`
  );

  const page: Page = context.pages()[0] || (await context.newPage());
  const startUrl = siteCfg.screens[kind] || siteCfg.loginUrl;
  await page.goto(startUrl, { waitUntil: "domcontentloaded" }).catch((e) => console.log(`[filings] ⚠ 이동 실패: ${e.message}`));
  watchLogout(context, siteCfg.loggedOutPattern, site);

  console.log(`[filings] 패널에서 값을 복사·채우고, 사이트에서 저장·제출한 뒤 패널의 [제출 완료] 를 누르세요.`);
  console.log(`[filings] 신고 화면 URL 이 다르면 메뉴로 이동하세요(패널은 어느 화면에서든 따라갑니다). 창을 닫으면 종료.`);
  console.log(`[filings] 사이트 팝업(알림·확인 창)은 이 터미널과 패널에 표시됩니다 — 확인 창은 여기서 y/n 으로 답하세요.`);
  const timer = setInterval(() => void snapshotCookies(site, context), 5000);
  await waitForContextClose(context);
  clearInterval(timer);
  console.log(`[filings] 종료 — 남은 대기 ${items.length}건`);
}

/** 검색어 정규화 — 법인 표기를 떼고 첫 낱말(IEPS 등록명은 MCM 표기와 다를 수 있어 넓게 검색한 뒤 이름 일치 행을 고른다) */
function searchKeyword(name: string): string {
  const stripped = name.replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\(합\)/g, " ").replace(/\s+/g, " ").trim();
  return stripped.split(" ")[0] || stripped || name;
}
function normalizeName(name: string): string {
  return name.replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\s+/g, "").trim();
}

/**
 * 사업장 검색 팝업 자동화 — 본문의 [사업장 검색] 을 눌러 팝업을 띄우고, 검색어를 넣어 검색한 뒤
 * 결과에서 사업장명이 일치하는 행을 클릭한다. 어느 단계든 못 찾으면 팝업을 열어 둔 채 사람이 잇는다.
 */
export async function runSiteSearch(context: BrowserContext, page: Page, cfg: NonNullable<SiteConfig["siteSearch"]>, name: string): Promise<string> {
  const keyword = searchKeyword(name);
  // 1) 팝업 열기 — 이미 열린 팝업이 있으면 그것을 쓴다
  let popup = context.pages().find((p) => !p.isClosed() && /bplcCodeNmPopup|Popup/i.test(p.url()) && p !== page) ?? null;
  if (!popup) {
    const opener = page.locator(cfg.openButton).first();
    if ((await opener.count()) === 0) return `사업장 검색 버튼을 찾지 못했습니다 — 직접 눌러 "${keyword}" 로 검색하세요.`;
    const waitPopup = context.waitForEvent("page", { timeout: 10_000 }).catch(() => null);
    await opener.click().catch(() => {});
    popup = await waitPopup;
    if (!popup) return `팝업이 열리지 않았습니다 — 직접 [사업장 검색] 을 눌러 "${keyword}" 로 검색하세요.`;
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
  }
  // 2) 검색어 입력 + 검색
  const input = popup.locator(cfg.input).first();
  if ((await input.count()) === 0) return `팝업의 검색어 칸(${cfg.input})을 찾지 못했습니다 — 직접 "${keyword}" 로 검색하세요.`;
  await input.fill(keyword).catch(() => {});
  const submit = popup.locator(cfg.submit).first();
  if ((await submit.count()) > 0) await submit.click().catch(() => {});
  else await input.press("Enter").catch(() => {});
  await popup.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await popup.waitForTimeout(800);
  // 3) 결과에서 이름 일치 행 클릭 — 정확 일치 → 정규화 일치 → 없으면 사람에게
  const want = normalizeName(name);
  const rows = popup.locator("table tr, li, .row");
  const n = await rows.count().catch(() => 0);
  for (let i = 0; i < Math.min(n, 200); i++) {
    const r = rows.nth(i);
    const text = ((await r.textContent().catch(() => "")) ?? "").trim();
    if (!text) continue;
    if (normalizeName(text).includes(want)) {
      const link = r.locator("a, [onclick], button").first();
      if ((await link.count()) > 0) await link.click().catch(() => {});
      else await r.click().catch(() => {});
      await page.waitForTimeout(500);
      return `사업장 검색: "${keyword}" 결과에서 "${name}" 행을 선택했습니다 — 본문의 사업장 명칭·소재지가 채워졌는지 확인하세요.`;
    }
  }
  return `사업장 검색: "${keyword}" 로 검색했지만 "${name}" 와 일치하는 행을 찾지 못했습니다 — 팝업에서 직접 고르세요.`;
}

function watchLogout(context: BrowserContext, pattern: string, site: string): void {
  const re = new RegExp(pattern, "i");
  const hook = (p: Page) =>
    p.on("framenavigated", (fr) => {
      if (fr === p.mainFrame() && re.test(fr.url()))
        console.log(`[${site}] ⚠ 로그인 페이지로 이동했습니다 — 세션이 끝났으면 창에서 다시 로그인하세요(쿠키는 계속 저장됩니다).`);
    });
  context.pages().forEach(hook);
  context.on("page", hook);
}
