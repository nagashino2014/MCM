/**
 * 반자동 신고 흐름 — 로그인된 브라우저로 신고 화면을 열고, 화면 위 패널로 대기열 값을 입력·복사하게 한 뒤
 * 사람이 사이트에서 저장·제출한다. 패널의 [제출 완료]/[제외] 가 MCM 대기열 상태를 바꾼다.
 *
 * 한 번 실행에 같은 종류의 대기 건을 [이전]/[다음] 으로 순회한다(IEPS 세션 1시간 안에 몰아서 처리).
 */
import { BrowserContext, Page } from "playwright";
import { SiteConfig } from "./config";
import { FillTarget, FilingKind, FilingsConfig, KIND_LABEL, KIND_SITE } from "./config";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./config";
import { FilingAttachment, FilingRow, downloadAttachment, getFiling, listPendingFilings, markFiling, patchContractPeriod } from "./mcm-api";
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
  const attCfg = cfg.attachments;
  const sealAvailable = Boolean(attCfg?.sealPath && fs.existsSync(attCfg.sealPath));
  const current = (): OverlayData => {
    const cur = items[index];
    const docs = cur ? pickAttachments(cur) : [];
    return {
      ...toOverlay(cur ?? null, index, items.length, fill, defaults),
      notices: notices.filter((n) => Date.now() - n.at < 20_000).map((n) => n.text),
      siteSearchQuery: searchQueryOf(cur),
      attach: kind === "ieps_agency" ? { seal: sealAvailable, docs: docs.map((d) => `${d.typeLabel} ${d.name}`) } : undefined,
    };
  };
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

  /**
   * 신고서 본 화면 — 첨부·사업장 검색의 대상. "마지막에 열린 창"을 쓰면 사업장 검색 팝업이 떠 있을 때
   * 팝업 자신을 본 화면으로 착각한다(2026-09-16). 팝업이 아닌 창 중 마지막 것을 고른다.
   */
  const mainPage = (): Page | undefined => {
    const open = context.pages().filter((p) => !p.isClosed());
    return open.filter((p) => !/popup/i.test(p.url())).pop() ?? open.pop();
  };

  await context.exposeFunction(DATA_FN, () => current());
  await context.exposeFunction(ACTION_FN, async (a: OverlayAction) => {
    try {
      const cur = items[index];
      if (a.type === "attachSeal" || a.type === "attachDocs") {
        const target = mainPage();
        if (target && attCfg) {
          if (a.type === "attachSeal") {
            notices.push({ at: Date.now(), text: await attachFile(target, attCfg.sealField, attCfg.sealPath, attCfg.browseButton, attCfg.saveButton) });
          } else if (cur) {
            const docs = pickAttachments(cur);
            if (docs.length === 0) notices.push({ at: Date.now(), text: "이 건에 붙일 계약 첨부가 MCM 에 없습니다." });
            for (const d of docs) {
              try {
                const file = await downloadAttachment(d, path.join(tmpDir(), cur.filingId));
                notices.push({ at: Date.now(), text: await attachFile(target, attCfg.docField, file, attCfg.browseButton, attCfg.saveButton) });
              } catch (err) {
                notices.push({ at: Date.now(), text: `첨부 실패(${d.name}): ${(err as Error).message}` });
              }
            }
            if (cur.triggerKind === "complete") notices.push({ at: Date.now(), text: "이행 보고의 '대행계약 이행증명서'(발주자 발급)는 MCM 에 없어 직접 첨부해야 합니다." });
          }
        }
      } else if (a.type === "siteSearch") {
        const q = searchQueryOf(cur);
        const target = mainPage();
        if (q && target && siteSearch) {
          const result = await runSiteSearch(context, target, siteSearch, q);
          console.log(`[filings] ${result}`);
          notices.push({ at: Date.now(), text: result });
        }
      } else if (a.type === "editPeriod") {
        // 패널에서 고친 대행업무 기간을 MCM 계약에 저장하고, 그 값으로 양식을 다시 만든다.
        if (!cur?.contractId) {
          notices.push({ at: Date.now(), text: "계약이 연결된 건에서만 기간을 고칠 수 있습니다." });
        } else if (a.start > a.end) {
          notices.push({ at: Date.now(), text: "종료일이 시작일보다 빠릅니다." });
        } else {
          await patchContractPeriod(cur.contractId, a.start, a.end);
          const fresh = await getFiling(cur.filingId).catch(() => null);
          if (fresh) items[index] = fresh;
          notices.push({ at: Date.now(), text: `대행업무 기간을 ${a.start} ~ ${a.end} 로 저장했습니다 — [자동 채우기] 로 화면에 반영하세요.` });
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

/**
 * 보고 구분별 첨부 선택 — 체결: 계약서, 변경: 변경계약서(없으면 계약서), 이행: 세금계산서(마지막 발행분).
 * (IEPS 안내: 체결=대행계약서 사본, 변경=변경계약서 사본, 이행=이행증명서+세금계산서 사본)
 */
function pickAttachments(f: FilingRow): FilingAttachment[] {
  const all = f.attachments ?? [];
  if (f.filingKind !== "ieps_agency") return [];
  const byType = (t: string) => all.filter((a) => a.type === t);
  if (f.triggerKind === "amend") return byType("amendment").length ? byType("amendment").slice(0, 1) : byType("contract").slice(0, 1);
  if (f.triggerKind === "complete") return byType("invoice").slice(0, 1);
  return byType("contract").slice(0, 1);
}

/**
 * 파일 첨부 — 기준 칸(anchor)과 같은 셀 안의 [찾아보기] 를 눌러 뜨는 파일 선택기를 가로채 파일을 넣고, 같은 셀의 [저장] 을 누른다.
 * 숨겨진 <input type=file> 의 셀렉터를 몰라도 되고, 사이트가 "신청서 저장 후 등록 가능" 같은 alert 를 띄우면 그대로 표시된다.
 */
export async function attachFile(page: Page, anchorSel: string, filePath: string, browseSel: string, saveSel: string): Promise<string> {
  if (!fs.existsSync(filePath)) return `첨부할 파일이 없습니다: ${filePath}`;
  const anchor = page.locator(anchorSel).first();
  if ((await anchor.count()) === 0) return `첨부 칸(${anchorSel})을 찾지 못했습니다 — 신청서를 먼저 저장했는지 확인하세요.`;
  // 같은 셀(td) → 같은 행(tr) 순으로 버튼을 찾는다
  let browse = anchor.locator("xpath=ancestor::td[1]").locator(browseSel).first();
  if ((await browse.count()) === 0) browse = anchor.locator("xpath=ancestor::tr[1]").locator(browseSel).first();
  if ((await browse.count()) === 0) return `[찾아보기] 버튼을 찾지 못했습니다(${anchorSel} 근처) — 직접 첨부하세요: ${filePath}`;
  const chooserP = page.waitForEvent("filechooser", { timeout: 8_000 }).catch(() => null);
  await browse.click().catch(() => {});
  const chooser = await chooserP;
  if (!chooser) return `파일 선택기가 열리지 않았습니다 — 직접 첨부하세요: ${filePath}`;
  // 경로 대신 버퍼로 넘긴다 — 한글 파일명 경로는 선택기에 들어가지 않는 경우가 있다(원래 이름은 유지된다)
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "application/octet-stream";
  await chooser.setFiles({ name: path.basename(filePath), mimeType, buffer: fs.readFileSync(filePath) });
  // 사이트가 change 이벤트로 표시 칸에 파일명을 적을 때까지(최대 3초) 기다린 뒤 저장한다
  await anchor.evaluate((el, name) => new Promise<void>((resolve) => {
    const input = el as HTMLInputElement;
    const t0 = Date.now();
    const tick = () => (input.value.includes(name) || Date.now() - t0 > 3000 ? resolve() : setTimeout(tick, 100));
    tick();
  }), path.basename(filePath).replace(/\.[^.]+$/, "")).catch(() => {});
  await page.waitForTimeout(300);
  let save = anchor.locator("xpath=ancestor::td[1]").locator(saveSel).first();
  if ((await save.count()) === 0) save = anchor.locator("xpath=ancestor::tr[1]").locator(saveSel).first();
  if ((await save.count()) > 0) {
    await save.click().catch(() => {});
    await page.waitForTimeout(1500);
    return `첨부 후 저장했습니다: ${path.basename(filePath)} — 화면에서 등록됐는지 확인하세요.`;
  }
  return `파일을 넣었습니다: ${path.basename(filePath)} — [저장] 버튼은 직접 눌러 주세요.`;
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
 * 사업장명을 비교용 낱말로 쪼갠다 — "국도화학㈜ 경인사업소 제1공장" → ["국도화학", "경인사업소", "제1공장"].
 * 첫 낱말은 회사명이라 반드시 맞아야 하고, 나머지는 겹치는 비율로 점수를 낸다.
 */
function nameTokens(name: string): string[] {
  return name
    .replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\(합\)/g, " ")
    .split(/[\s(),·\-_/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/**
 * 사업장 검색 팝업 자동화 — 본문의 [사업장 검색] 을 눌러 팝업을 띄우고, 검색어를 넣어 검색한 뒤
 * 결과에서 사업장명이 일치하는 행을 클릭한다. 어느 단계든 못 찾으면 팝업을 열어 둔 채 사람이 잇는다.
 */
export async function runSiteSearch(context: BrowserContext, page: Page, cfg: NonNullable<SiteConfig["siteSearch"]>, name: string): Promise<string> {
  // 1) 팝업 열기 — 이미 열린 팝업이 있으면 그것을 쓴다
  let popup = context.pages().find((p) => !p.isClosed() && /bplcCodeNmPopup|Popup/i.test(p.url()) && p !== page) ?? null;
  if (!popup) {
    const waitPopup = context.waitForEvent("page", { timeout: 10_000 }).catch(() => null);
    const opener = page.locator(cfg.openButton).first();
    if ((await opener.count()) > 0) {
      await opener.click().catch(() => {});
    } else if (!(await clickByText(page, "사업장 검색"))) {
      // IEPS 의 [사업장 검색] 은 input/button 이 아니라 onclick 을 단 요소라 셀렉터로 안 잡히는 경우가 있다(2026-09-16).
      return `사업장 검색 버튼을 찾지 못했습니다 — 직접 눌러 "${searchKeyword(name)}" 로 검색하세요.`;
    }
    popup = await waitPopup;
    if (!popup) return `팝업이 열리지 않았습니다 — 직접 [사업장 검색] 을 눌러 "${searchKeyword(name)}" 로 검색하세요.`;
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
  }
  if ((await popup.locator(cfg.input).first().count()) === 0) {
    return `팝업의 검색어 칸(${cfg.input})을 찾지 못했습니다 — 직접 "${searchKeyword(name)}" 로 검색하세요.`;
  }

  // 2) 두 단계로 찾는다(2026-09-16 사용자 요청).
  //    ① 사업장명 그대로 검색해 **이름이 그대로 일치**하는 행을 고른다.
  //    ② 못 찾으면 회사명만으로 다시 검색해 **낱말 겹침**으로 가장 비슷한 행을 고른다
  //       (MCM 마스터 명칭과 IEPS 등록명이 ㈜ 표기·지점 표기·띄어쓰기에서 어긋나는 경우가 있다).
  const full = normalizeName(name) === normalizeName(searchKeyword(name)) ? "" : name.replace(/\(주\)|㈜|주식회사|\(유\)|유한회사/g, " ").replace(/\s+/g, " ").trim();
  const passes: { keyword: string; minScore: number }[] = [];
  if (full) passes.push({ keyword: full, minScore: 1 });
  passes.push({ keyword: searchKeyword(name), minScore: 0.6 });

  for (const pass of passes) {
    const picked = await searchAndPick(popup, page, cfg, name, pass.keyword, pass.minScore);
    if (picked) {
      const how = picked.score === 1 ? "" : ` (이름이 정확히 같지는 않아 가장 비슷한 행을 골랐습니다: ${picked.text})`;
      return `사업장 검색: "${pass.keyword}" 결과에서 "${name}" 행을 선택했습니다${how} — 본문의 사업장 명칭·소재지가 맞는지 확인하세요.`;
    }
  }
  return `사업장 검색: "${passes.map((p) => p.keyword).join('" → "')}" 로 검색했지만 "${name}" 와 맞는 행을 찾지 못했습니다 — 팝업에서 직접 고르세요.`;
}

/**
 * 팝업에서 한 번 검색하고 결과에서 가장 잘 맞는 행을 누른다. minScore 미만이면 아무것도 누르지 않는다.
 * 점수: 이름이 그대로 들어 있으면 1, 아니면 회사명(첫 낱말)을 포함하는 행에 한해 낱말 겹침 비율.
 */
/** 결과 영역의 현재 글자 — 검색 전후 비교용. 페이지가 바뀌는 중이면 빈 문자열. */
async function resultText(popup: Page): Promise<string> {
  return popup
    .evaluate(() => Array.from(document.querySelectorAll("table tbody tr, table tr")).map((r) => r.textContent ?? "").join("|"))
    .catch(() => "");
}

/**
 * 팝업에 검색어를 넣고 조회한 뒤 **결과가 실제로 바뀔 때까지** 기다린다.
 *
 * IEPS 사업장 검색의 [조회] 는 페이지를 새로 불러온다. 로드 시작 직후를 "끝났다"고 보면, 아직 이전 화면에서
 * 결과를 읽고 다음 검색어를 곧 사라질 입력칸에 넣게 된다 — 두 번째 검색이 증발하고 첫 검색의
 * "자료가 없습니다" 화면만 남던 원인(2026-09-16 익산지점). 새 문서 로드와 같은 문서 안의 결과 갱신 중
 * 먼저 오는 쪽을 기다린다(최대 8초).
 */
async function submitSearch(popup: Page, cfg: NonNullable<SiteConfig["siteSearch"]>, keyword: string): Promise<void> {
  const input = popup.locator(cfg.input).first();
  await input.waitFor({ state: "visible", timeout: 8_000 }).catch(() => {});
  await input.fill(keyword).catch(() => {});
  const before = await resultText(popup);
  const navigated = popup
    .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  const submit = popup.locator(cfg.submit).first();
  if ((await submit.count()) > 0) await submit.click().catch(() => {});
  else await input.press("Enter").catch(() => {});
  const changed = (async () => {
    for (let i = 0; i < 40; i++) {
      await popup.waitForTimeout(200);
      const now = await resultText(popup);
      if (now && now !== before) return true;
    }
    return false;
  })();
  await Promise.race([navigated, changed]);
  await popup.waitForLoadState("domcontentloaded").catch(() => {});
  await popup.waitForTimeout(400);
}

async function searchAndPick(
  popup: Page,
  page: Page,
  cfg: NonNullable<SiteConfig["siteSearch"]>,
  name: string,
  keyword: string,
  minScore: number
): Promise<{ score: number; text: string } | null> {
  await submitSearch(popup, cfg, keyword);

  const want = normalizeName(name);
  const tokens = nameTokens(name);
  // 결과 표의 행만 본다. 예전엔 "li, .row" 도 후보에 넣었는데, 팝업에 주입된 신고 보조 패널의 양식 행(.row)이
  // 섞여 1차 검색 결과가 비었을 때 패널의 "대행사업장 명칭" 행을 정답으로 골랐다(2026-09-16 익산지점). 패널엔 table 이 없다.
  const rows = popup.locator("table tr");
  const n = await rows.count().catch(() => 0);
  let best: { index: number; score: number; text: string } | null = null;
  for (let i = 0; i < Math.min(n, 200); i++) {
    const text = ((await rows.nth(i).textContent().catch(() => "")) ?? "").trim();
    if (!text) continue;
    const flat = normalizeName(text);
    if (!flat) continue;
    // 양방향 포함 — IEPS 등록명이 MCM 명칭보다 짧을 수도, 길 수도 있다
    let score = flat.includes(want) || (want.length >= 4 && want.includes(flat)) ? 1 : 0;
    if (score === 0 && tokens.length) {
      if (!flat.includes(tokens[0])) continue; // 회사명은 반드시 맞아야 한다
      score = tokens.filter((t) => flat.includes(t)).length / tokens.length;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { index: i, score, text: text.replace(/\s+/g, " ").trim().slice(0, 60) };
    }
  }
  if (!best || best.score < minScore) return null;
  const row = rows.nth(best.index);
  const link = row.locator("a, [onclick], button").first();
  if ((await link.count()) > 0) await link.click().catch(() => {});
  else await row.click().catch(() => {});
  await page.waitForTimeout(500);
  return { score: best.score, text: best.text };
}

/**
 * 라벨 텍스트로 버튼을 찾아 누른다 — 셀렉터로 안 잡히는 요소(onclick 을 단 span·td·img)까지 훑는 폴백.
 * 화면에 보이고 텍스트가 정확히 일치하는 것 중 가장 안쪽 요소를 누른다(조상까지 함께 잡히는 것을 피한다).
 */
async function clickByText(page: Page, label: string): Promise<boolean> {
  return page
    .evaluate((want) => {
      const flat = (s: string) => s.replace(/\s+/g, "");
      const target = flat(want);
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>("a, button, input, span, td, th, label, img, div, li")
      ).filter((el) => {
        if (!el.getClientRects().length) return false;
        const text =
          el.tagName === "INPUT"
            ? (el as HTMLInputElement).value
            : el.getAttribute("alt") || el.getAttribute("title") || el.textContent || "";
        return flat(text) === target;
      });
      if (!nodes.length) return false;
      // 가장 안쪽(자식 수가 적은) 요소 — 조상 div 가 아니라 실제 버튼을 누르기 위해
      nodes.sort((a, b) => a.getElementsByTagName("*").length - b.getElementsByTagName("*").length);
      nodes[0].click();
      return true;
    }, label)
    .catch(() => false);
}

function watchLogout(context: BrowserContext, pattern: string, site: string): void {
  const re = new RegExp(pattern, "i");
  const hook = (p: Page) =>
    p.on("framenavigated", (fr) => {
      if (fr !== p.mainFrame() || !re.test(fr.url())) return;
      // 사업장 검색 팝업(/web/mypage/memberjoin/bplcCodeNmPopup)처럼 경로에 member 가 든 창은 로그아웃이 아니다.
      void p
        .opener()
        .then((opener) => {
          if (opener) return;
          console.log(`[${site}] ⚠ 로그인 페이지로 이동했습니다 — 세션이 끝났으면 창에서 다시 로그인하세요(쿠키는 계속 저장됩니다).`);
        })
        .catch(() => {});
    });
  context.pages().forEach(hook);
  context.on("page", hook);
}
