/**
 * 11번가 영수증 수집기 (스파이크)
 *
 * 관통 목표: 저장된 세션으로 주문목록을 열고 → 각 주문의 영수증 화면을 띄워 → PDF 로 저장 → 대장(CSV)에 기록.
 *
 * 설계 메모
 * - 고정 셀렉터 대신 **텍스트·정규식 휴리스틱** 우선. ("영수증/거래명세서" 텍스트, 9자리 이상 숫자=주문번호,
 *   YYYY.MM.DD=주문일) 마크업이 바뀌어도 버티고, 안 맞으면 probe 로 실측해 site-config.json 에 덮어쓴다.
 * - 기간 조회 UI 조작은 몰마다 제각각이라 스파이크에서는 다루지 않는다. 화면에 보이는 목록을 페이지네이션으로
 *   훑으면서 **주문일 텍스트로 필터**한다. 기간 파라미터가 실측되면 config 에 URL 템플릿을 추가하는 편이 낫다.
 * - 영수증은 팝업(window.open) / 같은 탭 이동 / 레이어 모달 세 가지로 뜰 수 있어 전부 처리한다.
 * - 계정 잠금을 피하려고 건마다 딜레이를 둔다. 속도보다 안전이 우선.
 */

import path from "node:path";
import fs from "node:fs";
import { BrowserContext, Locator, Page } from "playwright";

import { openContext, ensureSiteDir, siteDir } from "./session";
import { loadSiteConfig, SiteConfig } from "./config";
import { savePageAsPdf, safeName, SaveResult } from "./pdf";
import { appendLedger, loadCollectedKeys, LedgerRow } from "./ledger";

export interface CollectOptions {
  from?: string;
  to?: string;
  /** 훑을 목록 페이지 수 */
  pages?: number;
  /** 저장 상한(실측 초기에 1~2 로 두고 확인) */
  limit?: number;
  /** 기본 headless. 차단되면 false 로 재시도 */
  headless?: boolean;
  /** 목록 파싱만 하고 영수증은 열지 않는다 */
  dryRun?: boolean;
  /** 건당 대기(ms) — 너무 빠르면 봇으로 잡힌다 */
  delay?: number;
}

interface OrderRow {
  index: number;
  orderNo: string;
  orderDate: string;
  title: string;
  amount: string;
  locator: Locator;
}

/** "2026. 8. 20" / "2026-08-20" / "2026.08.20" → "2026-08-20" */
function normalizeDate(raw: string): string {
  const m = raw.match(/(\d{4})[.\-/]\s?(\d{1,2})[.\-/]\s?(\d{1,2})/);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function inRange(date: string, from?: string, to?: string): boolean {
  if (!date) return true; // 날짜를 못 읽으면 거르지 않는다(누락보다 과수집이 낫다)
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

/** 매칭 건수가 가장 많은 행 셀렉터를 고른다. 전부 0이면 null */
async function pickRowSelector(page: Page, cfg: SiteConfig): Promise<string | null> {
  let best: { selector: string; count: number } | null = null;

  for (const selector of cfg.orderRowSelectors) {
    const count = await page.locator(selector).count().catch(() => 0);
    if (count > 0 && (!best || count > best.count)) best = { selector, count };
  }

  return best ? best.selector : null;
}

/** 행 하나에서 주문번호·주문일·상품명·금액을 텍스트로 뽑는다 */
async function parseRow(row: Locator, index: number): Promise<OrderRow> {
  const text = (await row.innerText().catch(() => "")).replace(/\r/g, "");
  const flat = text.replace(/\s+/g, " ").trim();

  const orderNo = (flat.match(/\b\d{9,}\b/) || [""])[0];
  const orderDate = normalizeDate(flat);
  const amount = (flat.match(/[\d,]{3,}\s?원/) || [""])[0].replace(/\s/g, "");

  // 상품명 후보: 숫자·날짜·금액이 아닌 첫 줄
  const title =
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length >= 4 && !/^\d[\d,.\s원]*$/.test(l) && !/^\d{4}[.\-/]/.test(l)) || "";

  return { index, orderNo, orderDate, title, amount, locator: row };
}

/** 행 안에서 영수증 진입 요소를 찾는다(키워드 우선순위 순) */
async function findReceiptTrigger(
  row: Locator,
  keywords: string[]
): Promise<{ locator: Locator; label: string } | null> {
  for (const keyword of keywords) {
    const candidate = row.locator("a, button, [onclick], [role='button']").filter({ hasText: keyword }).first();
    if ((await candidate.count().catch(() => 0)) > 0) {
      const label = ((await candidate.innerText().catch(() => keyword)) || keyword).replace(/\s+/g, " ").trim();
      return { locator: candidate, label: label || keyword };
    }
  }
  return null;
}

/**
 * 영수증 진입 요소를 눌러 실제 영수증이 그려진 Page 를 확보한다.
 * - 팝업이면 그 페이지, 같은 탭 이동이면 현재 페이지, 레이어 모달이면 현재 페이지를 그대로 쓴다.
 */
async function openReceipt(
  context: BrowserContext,
  page: Page,
  trigger: Locator
): Promise<{ target: Page; kind: "popup" | "navigation" | "layer"; isPopup: boolean }> {
  const urlBefore = page.url();
  const popupPromise = context.waitForEvent("page", { timeout: 8000 }).catch(() => null);

  await trigger.click({ timeout: 15_000 });

  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
    await popup.waitForTimeout(1500);
    return { target: popup, kind: "popup", isPopup: true };
  }

  await page.waitForTimeout(2500);
  if (page.url() !== urlBefore) {
    return { target: page, kind: "navigation", isPopup: false };
  }

  return { target: page, kind: "layer", isPopup: false };
}

/** 실패한 건은 화면·HTML 을 남겨 다음 실측의 재료로 쓴다 */
async function dumpFailure(site: string, page: Page, key: string, reason: string): Promise<void> {
  const dir = ensureSiteDir(site, "failed");
  const base = path.join(dir, safeName(`${key}_${Date.now()}`));
  try {
    fs.writeFileSync(`${base}.html`, await page.content(), "utf-8");
    await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
    fs.writeFileSync(`${base}.txt`, reason, "utf-8");
  } catch {
    // 진단 덤프 실패는 무시 — 본 수집을 막지 않는다
  }
}

export async function collectReceipts(site: string, opts: CollectOptions = {}): Promise<void> {
  const cfg = loadSiteConfig(site);
  const { from, to, pages = 1, limit, headless = true, dryRun = false, delay = 2000 } = opts;
  const tag = `[${site}]`;

  const collected = loadCollectedKeys(site);
  const { browser, context } = await openContext({ site, headless, useSession: true });

  let saved = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const page = await context.newPage();
    await page.goto(cfg.orderListUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3000);

    if (new RegExp(cfg.loggedOutPattern, "i").test(page.url())) {
      throw new Error(
        `로그인 페이지로 튕겼습니다: ${page.url()}\n` +
          `  세션 만료이거나 headless 접근이 차단된 경우입니다.\n` +
          `  1) 'npm run receipts -- login --site ${site}' 로 세션을 새로 저장하거나\n` +
          `  2) '--headed' 옵션으로 다시 실행하세요.`
      );
    }

    for (let pageNo = 1; pageNo <= pages; pageNo++) {
      const rowSelector = await pickRowSelector(page, cfg);
      if (!rowSelector) {
        console.log(`${tag} ⚠ 주문 행을 못 찾았습니다. 'probe' 로 실측해 site-config.json 을 채우세요.`);
        await dumpFailure(site, page, `no-rows-p${pageNo}`, "orderRowSelectors 전부 0건");
        break;
      }

      const rows = page.locator(rowSelector);
      const count = await rows.count();
      console.log(`${tag} ${pageNo}페이지: 행 ${count}건 (셀렉터 ${rowSelector})`);

      for (let i = 0; i < count; i++) {
        if (limit && saved >= limit) {
          console.log(`${tag} 상한(${limit}건) 도달 — 중단`);
          return;
        }

        const order = await parseRow(rows.nth(i), i);

        if (!inRange(order.orderDate, from, to)) {
          skipped++;
          continue;
        }

        const trigger = await findReceiptTrigger(order.locator, cfg.receiptKeywords);
        if (!trigger) {
          skipped++;
          continue;
        }

        const key = `${order.orderNo || `p${pageNo}-r${i}`}::${trigger.label}`;
        if (collected.has(key)) {
          skipped++;
          continue;
        }

        if (dryRun) {
          console.log(
            `${tag} [dry-run] ${order.orderDate || "날짜?"} / ${order.orderNo || "주문번호?"} / ` +
              `${order.amount || "-"} / "${order.title.slice(0, 30)}" → [${trigger.label}]`
          );
          continue;
        }

        try {
          const { target, kind, isPopup } = await openReceipt(context, page, trigger.locator);

          const month = (order.orderDate || "unknown").slice(0, 7);
          const outDir = ensureSiteDir(site, path.join("receipts", month));
          const outBase = path.join(
            outDir,
            safeName(`${order.orderDate || "nodate"}_${order.orderNo || `p${pageNo}r${i}`}_${trigger.label}`)
          );

          const result: SaveResult = await savePageAsPdf(target, outBase);

          const row: LedgerRow = {
            site,
            orderNo: order.orderNo,
            orderDate: order.orderDate,
            title: order.title,
            amount: order.amount,
            receiptType: trigger.label,
            method: result.method,
            files: result.files.map((f) => path.relative(siteDir(site), f)).join(" | "),
            collectedAt: new Date().toISOString(),
          };
          appendLedger(site, row);
          collected.add(key);
          saved++;

          console.log(
            `${tag} ✅ ${order.orderDate || "?"} ${order.orderNo || "?"} [${trigger.label}] ` +
              `→ ${result.method} (${kind})`
          );
          if (result.attempts.length > 0) {
            for (const a of result.attempts) console.log(`${tag}    ↳ ${a.method} 실패: ${a.error}`);
          }

          if (isPopup) {
            await target.close().catch(() => {});
          } else if (kind === "navigation") {
            await page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
            await page.waitForTimeout(1500);
          } else {
            // 레이어 모달 — ESC 로 닫는다
            await page.keyboard.press("Escape").catch(() => {});
            await page.waitForTimeout(500);
          }
        } catch (e) {
          failed++;
          console.log(`${tag} ❌ ${order.orderNo || `p${pageNo}r${i}`} 실패: ${String(e).slice(0, 200)}`);
          await dumpFailure(site, page, key, String(e));
        }

        await page.waitForTimeout(delay);
      }

      if (pageNo < pages) {
        const moved = await goNextPage(page, cfg);
        if (!moved) {
          console.log(`${tag} 다음 페이지 없음 — 종료`);
          break;
        }
      }
    }
  } finally {
    console.log(`${tag} 저장 ${saved}건 / 건너뜀 ${skipped}건 / 실패 ${failed}건`);
    console.log(`${tag} 산출물: ${siteDir(site)}`);
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function goNextPage(page: Page, cfg: SiteConfig): Promise<boolean> {
  for (const selector of cfg.nextPageSelectors) {
    const next = page.locator(selector).first();
    if ((await next.count().catch(() => 0)) === 0) continue;
    if (!(await next.isEnabled().catch(() => false))) continue;

    await next.click({ timeout: 15_000 }).catch(() => {});
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2500);
    return true;
  }
  return false;
}
