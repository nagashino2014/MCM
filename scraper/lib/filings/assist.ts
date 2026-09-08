/**
 * 반자동 신고 흐름 — 로그인된 브라우저로 신고 화면을 열고, 화면 위 패널로 대기열 값을 입력·복사하게 한 뒤
 * 사람이 사이트에서 저장·제출한다. 패널의 [제출 완료]/[제외] 가 MCM 대기열 상태를 바꾼다.
 *
 * 한 번 실행에 같은 종류의 대기 건을 [이전]/[다음] 으로 순회한다(IEPS 세션 1시간 안에 몰아서 처리).
 */
import { BrowserContext, Page } from "playwright";
import { FilingKind, FilingsConfig, KIND_LABEL, KIND_SITE } from "./config";
import { FilingRow, getFiling, listPendingFilings, markFiling } from "./mcm-api";
import { ACTION_FN, OverlayAction, OverlayData, RENDER_FN, renderOverlay } from "./overlay";
import { openContext, snapshotCookies, waitForContextClose } from "./session";

const DATA_FN = "__mcmFilingsGetData";

function toOverlay(f: FilingRow | null, index: number, total: number, fill: Record<string, string>): OverlayData {
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
    fields: f.payload.fields,
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

  const current = (): OverlayData => ({
    ...toOverlay(items[index] ?? null, index, items.length, fill),
    notices: notices.filter((n) => Date.now() - n.at < 20_000).map((n) => n.text),
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
      if (a.type === "next") index = items.length ? (index + 1) % items.length : 0;
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
