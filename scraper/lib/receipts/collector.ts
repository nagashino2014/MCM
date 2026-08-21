/**
 * 영수증 수집기 (사이트 중립)
 *
 * 관통 목표: 저장된 로그인으로 주문/증빙 목록을 열고 → 각 주문의 영수증(전표)을 띄워 → PDF 로 저장 →
 * 대장(CSV)에 기록. 사이트별 차이는 전부 `config.ts` 의 SiteConfig 로 표현하고 이 파일은 공통 절차만 담는다.
 *
 * 설계 메모
 * - 고정 셀렉터 대신 **텍스트·정규식 휴리스틱** 우선. 마크업이 바뀌어도 버티고, 안 맞으면 probe 로
 *   실측해 site-config.json 에 덮어쓴다.
 * - 목록은 iframe 안에 그려지는 경우가 있어(11번가) 주문번호 수집·페이지네이션이 모든 프레임을 훑는다.
 * - 영수증을 여는 방법은 세 갈래다. config 에 정의된 것을 우선 쓴다.
 *     receiptRequest      폼 POST 로만 열리는 문서(11번가 신용카드 매출전표)
 *     receiptUrlTemplate  주문번호를 넣은 주소로 바로 열리는 문서
 *     (둘 다 없으면)      목록에서 버튼을 클릭 — 팝업 / 같은 탭 이동 / 레이어 모달 전부 처리
 * - 계정 잠금을 피하려고 건마다 딜레이를 둔다. 속도보다 안전이 우선.
 */

import path from "node:path";
import fs from "node:fs";
import { BrowserContext, Frame, Locator, Page } from "playwright";

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
  /**
   * 목록 화면에서 사용자가 **직접 조회 기간을 바꿀** 시간을 준다(초).
   * 기본 조회 기간 밖의 주문은 화면에 없어 주문번호도 안 잡히는데, 기간 조회 URL 파라미터가
   * 아직 실측되지 않아 코드가 기간을 지정하지 못한다. 그동안의 우회로.
   * 주문번호가 잡히고 개수가 안정되면 기다림을 멈추고 바로 수집을 시작한다.
   */
  waitSeconds?: number;
  /** 전표 페이지의 텍스트를 .txt 로 함께 저장한다(품목 확인·다상품 진단용) */
  withText?: boolean;
}

/** 한 주문에서 훑어볼 상품 순번 상한 — 빈 양식이 나오면 그 전에 멈춘다 */
const MAX_PRD_SEQ = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface CollectStats {
  saved: number;
  skipped: number;
  failed: number;
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

/**
 * 주문번호에 주문일이 들어 있는 사이트를 위한 변환(11번가: 20251027006519699 → 2025-10-27).
 * `config.orderDateFromOrderNo` 가 켜진 사이트에서만 쓴다.
 */
function dateFromOrderNo(ordNo: string): string {
  const m = ordNo.match(/^(20\d{2})(\d{2})(\d{2})/);
  if (!m) return "";

  const [, y, mo, d] = m;
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return "";
  return `${y}-${mo}-${d}`;
}

/** 전표 하나를 여는 데 필요한 식별자들 — 11번가는 {ordNo}, G마켓은 {seqNo,custNo,contrNo} */
type ReceiptKey = Record<string, string>;

function keyRule(cfg: SiteConfig): { pattern: string; groups: string[] } {
  return cfg.receiptKey || { pattern: cfg.orderNoPattern || "\\b(\\d{15,20})\\b", groups: ["ordNo"] };
}

/** 식별자를 사람이 읽고 중복 판정에도 쓸 수 있는 한 줄로 */
function keyId(key: ReceiptKey, groups: string[]): string {
  return groups.map((g) => key[g]).join("|");
}

/** 파일명·대장에 쓰는 대표 값(첫 그룹) */
function keyMain(key: ReceiptKey, groups: string[]): string {
  return key[groups[0]] || "";
}

/**
 * 목록에서 전표 식별자를 전부 긁는다.
 * - 목록이 iframe 안에 그려지는 경우가 있어 메인 문서 + 모든 프레임을 훑는다.
 * - 화면 텍스트뿐 아니라 HTML(링크 파라미터·onclick)까지 본다. G마켓처럼 식별자가
 *   링크 쿼리스트링에만 있는 경우가 있다.
 */
async function collectReceiptKeys(page: Page, cfg: SiteConfig): Promise<ReceiptKey[]> {
  const rule = keyRule(cfg);
  const found = new Map<string, ReceiptKey>();
  const scopes: (Page | Frame)[] = [page, ...page.frames().filter((f) => f !== page.mainFrame())];

  for (const scope of scopes) {
    const keys = await scope
      .evaluate(
        ({ pattern, groups }) => {
          const out: Record<string, string>[] = [];

          const scan = (text?: string | null) => {
            if (!text) return;
            const re = new RegExp(pattern, "g");
            let m: RegExpExecArray | null;

            while ((m = re.exec(text)) !== null) {
              const key: Record<string, string> = {};
              groups.forEach((name, i) => {
                key[name] = m![i + 1] ?? m![0];
              });
              out.push(key);
              if (m.index === re.lastIndex) re.lastIndex++; // 빈 매치 무한루프 방지
            }
          };

          // 화면 텍스트와 "의미 있는 속성"만 본다.
          // HTML 전체를 훑으면 URL 인코딩된 문자열(예: "주문번호%2020260728...")에서
          // %20 의 0 과 숫자가 붙어 있지도 않은 식별자가 만들어진다.
          scan(document.body?.innerText);

          const attrs = ["href", "onclick", "value", "data-ordno", "data-ord-no", "data-seqno", "data-key"];
          document
            .querySelectorAll("a, area, button, input, [onclick], [data-ordno], [data-ord-no], [data-seqno], [data-key]")
            .forEach((el) => {
              for (const name of attrs) scan(el.getAttribute(name));
            });

          return out;
        },
        { pattern: rule.pattern, groups: rule.groups }
      )
      .catch(() => [] as ReceiptKey[]);

    for (const key of keys) {
      const id = keyId(key, rule.groups);
      if (id && !found.has(id)) found.set(id, key);
    }
  }

  // 최신 건부터 — 식별자가 대체로 증가하는 값이라 역순이 최신이다.
  return [...found.values()].sort((a, b) => keyId(b, rule.groups).localeCompare(keyId(a, rule.groups)));
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
  // 봇 확인이 있는 사이트는 headless 가 막히므로 화면을 띄운다(PDF 는 CDP 폴백으로 만든다).
  const effectiveHeadless = cfg.stealth ? false : headless;
  if (cfg.stealth && headless) console.log(`${tag} 봇 확인이 있는 사이트라 화면을 띄워 실행합니다.`);

  const { context, close } = await openContext({
    site,
    headless: effectiveHeadless,
    useSession: true,
    stealth: cfg.stealth,
  });

  const stats: CollectStats = { saved: 0, skipped: 0, failed: 0 };

  try {
    const page = context.pages()[0] || (await context.newPage());
    await openOrderList(page, cfg, from, to, tag);
    await sleep(3000);

    if (new RegExp(cfg.loggedOutPattern, "i").test(page.url())) {
      throw new Error(
        `로그인 페이지로 튕겼습니다: ${page.url()}\n` +
          `  세션 만료이거나 headless 접근이 차단된 경우입니다.\n` +
          `  1) 'npm run receipts -- login --site ${site}' 로 세션을 새로 저장하거나\n` +
          `  2) '--headed' 옵션으로 다시 실행하세요.`
      );
    }

    // 주문번호만으로 영수증 문서를 열 수 있으면(11번가) 그 경로로 간다. 클릭·팝업 대기가 필요 없다.
    if (cfg.receiptRequest || cfg.receiptUrlTemplate) {
      await runCollect(site, cfg, page, { ...opts, pages, delay }, collected, stats);
      return;
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
        if (limit && stats.saved >= limit) {
          console.log(`${tag} 상한(${limit}건) 도달 — 중단`);
          return;
        }

        const order = await parseRow(rows.nth(i), i);

        if (!inRange(order.orderDate, from, to)) {
          stats.skipped++;
          continue;
        }

        const trigger = await findReceiptTrigger(order.locator, cfg.receiptKeywords);
        if (!trigger) {
          stats.skipped++;
          continue;
        }

        const key = `${order.orderNo || `p${pageNo}-r${i}`}::${trigger.label}`;
        if (collected.has(key)) {
          stats.skipped++;
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
          stats.saved++;

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
          stats.failed++;
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
    console.log(`${tag} 저장 ${stats.saved}건 / 건너뜀 ${stats.skipped}건 / 실패 ${stats.failed}건`);
    console.log(`${tag} 산출물: ${siteDir(site)}`);
    await close();
  }
}

/**
 * 전표 진단 — 한 주문번호에 대해 ordPrdSeq 를 바꿔가며 전표를 열어 본다.
 *
 * 한 주문에 상품이 여러 개일 때 전표가 상품별로 나뉘는지(=순번을 순회해야 하는지),
 * 아니면 주문 단위로 한 장에 다 나오는지(=순번 고정으로 충분한지)를 가른다.
 * 결과 텍스트는 data/receipts/<site>/probe/receipt-<주문번호>-seq<N>.txt 로 남는다.
 */
export async function probeReceiptSeq(site: string, ordNo: string, seqs: number[]): Promise<void> {
  const cfg = loadSiteConfig(site);
  const tag = `[${site}]`;

  if (!cfg.receiptRequest) {
    console.log(`${tag} 이 사이트는 폼 POST 전표 정의(receiptRequest)가 없습니다.`);
    return;
  }

  const outDir = ensureSiteDir(site, "probe");
  const { context, close } = await openContext({ site, headless: !cfg.stealth, useSession: true, stealth: cfg.stealth });
  const results: { seq: number; text: string; tokens: Set<string> }[] = [];

  try {
    const page = context.pages()[0] || (await context.newPage());

    for (const seq of seqs) {
      try {
        await openReceiptDocument(page, cfg, { ordNo }, { ordPrdSeq: String(seq) });
        await page.waitForTimeout(1000);

        const text = (await page.innerText("body").catch(() => "")).replace(/\s+/g, " ").trim();
        fs.writeFileSync(path.join(outDir, `receipt-${ordNo}-seq${seq}.txt`), text, "utf-8");
        results.push({ seq, text, tokens: new Set(text.split(" ").filter(Boolean)) });

        console.log(`${tag} ordPrdSeq=${seq}: ${text.length}자 — ${text.slice(0, 120)}`);
      } catch (e) {
        console.log(`${tag} ordPrdSeq=${seq}: 실패 — ${String(e).slice(0, 150)}`);
      }

      await page.waitForTimeout(1500);
    }

    reportSeqDiff(tag, results);
    console.log(`${tag} 원문: ${outDir}`);
  } finally {
    await close();
  }
}

/**
 * 순번별 전표가 실제로 다른 문서인지 보고한다.
 * - 전표에는 순번 값이나 발행 시각처럼 내용과 무관한 차이가 섞이므로, 같다/다르다를 단정하기보다
 *   **무엇이 달라졌는지**를 보여주고 명확한 경우에만 판정한다.
 */
function reportSeqDiff(tag: string, results: { seq: number; text: string; tokens: Set<string> }[]): void {
  console.log(`${tag} ─────────────────────────────────────────────`);

  if (results.length < 2) {
    console.log(`${tag} 비교할 결과가 부족합니다.`);
    return;
  }

  const base = results[0];
  let allIdentical = true;
  let maxDiffTokens = 0;

  for (const r of results.slice(1)) {
    if (r.text === base.text) {
      console.log(`${tag} seq=${r.seq}: seq=${base.seq} 과 완전히 동일`);
      continue;
    }

    allIdentical = false;
    const added = [...r.tokens].filter((t) => !base.tokens.has(t));
    const removed = [...base.tokens].filter((t) => !r.tokens.has(t));
    const union = new Set([...base.tokens, ...r.tokens]).size;
    const similarity = union === 0 ? 1 : 1 - (added.length + removed.length) / union;
    maxDiffTokens = Math.max(maxDiffTokens, added.length + removed.length);

    console.log(`${tag} seq=${r.seq}: seq=${base.seq} 과 유사도 ${(similarity * 100).toFixed(1)}%`);
    if (added.length) console.log(`${tag}   추가: ${added.slice(0, 15).join(" ")}`);
    if (removed.length) console.log(`${tag}   빠짐: ${removed.slice(0, 15).join(" ")}`);
  }

  if (allIdentical) {
    console.log(`${tag} 판정: 순번을 바꿔도 전표가 같습니다 → 주문 단위 문서. ordPrdSeq 고정으로 충분합니다.`);
    return;
  }

  if (maxDiffTokens <= 3) {
    console.log(`${tag} 판정: 차이가 몇 토큰뿐입니다. 위 '추가/빠짐' 이 품목명이면 상품별 전표이고,`);
    console.log(`${tag}   순번 값이나 발행 시각뿐이면 주문 단위 문서입니다 — 한 번만 눈으로 확인해 주세요.`);
    return;
  }

  console.log(`${tag} 판정: 순번마다 내용이 크게 다릅니다 → 전표가 상품별로 나뉩니다.`);
  console.log(`${tag}   수집기가 순번을 순회하도록 고쳐야 합니다.`);
}

/**
 * 사용자가 브라우저에서 조회 기간을 바꾸는 동안 기다린다.
 * - 3초마다 주문번호를 세어, 1건 이상 잡히고 직전 관측과 개수가 같으면(=조회가 끝났다고 보고) 진행한다.
 * - 제한 시간까지 아무것도 안 잡히면 그대로 진행한다(빈 목록으로 처리).
 */
async function waitForUserQuery(site: string, page: Page, cfg: SiteConfig, seconds: number): Promise<void> {
  const tag = `[${site}]`;
  console.log(`${tag} ─────────────────────────────────────────────`);
  console.log(`${tag} 브라우저에서 조회 기간을 원하는 기간으로 바꿔 조회하세요.`);
  console.log(`${tag} 주문 목록이 뜨면 자동으로 수집을 시작합니다(최대 ${seconds}초 대기).`);

  const deadline = Date.now() + seconds * 1000;
  let previous = -1;

  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);

    const count = (await collectReceiptKeys(page, cfg).catch(() => [])).length;
    if (count > 0 && count === previous) {
      console.log(`${tag} 전표 ${count}건 확인 — 수집을 시작합니다.`);
      return;
    }

    if (count !== previous) console.log(`${tag} 대기 중... 전표 ${count}건`);
    previous = count;
  }

  console.log(`${tag} 대기 시간 종료 — 현재 화면 기준으로 진행합니다.`);
}

/**
 * 주문번호 기반 수집 — 목록에서 주문번호만 모아 영수증 주소로 직접 이동한다.
 * 버튼 클릭·팝업 대기가 없어 훨씬 빠르고, 마크업이 바뀌어도 잘 버틴다.
 */
async function runCollect(
  site: string,
  cfg: SiteConfig,
  page: Page,
  opts: CollectOptions,
  collected: Set<string>,
  stats: CollectStats
): Promise<void> {
  const tag = `[${site}]`;
  const { from, to, limit, dryRun = false, delay = 2000, pages = 1 } = opts;

  if (opts.waitSeconds) {
    await waitForUserQuery(site, page, cfg, opts.waitSeconds);
  }

  const rule = keyRule(cfg);
  let previousPageKeys: Set<string> | null = null;

  for (let pageNo = 1; pageNo <= pages; pageNo++) {
    // 목록이 iframe·XHR 로 채워지는 경우가 있어 네트워크가 잦아들 때까지 기다린다.
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await sleep(1500);

    const keys = await collectReceiptKeys(page, cfg);
    console.log(`${tag} ${pageNo}페이지: 전표 ${keys.length}건`);

    // 페이지를 넘겼는데 목록이 그대로면 이동에 실패한 것이다 — 같은 목록을 반복해 읽지 않는다.
    const ids = keys.map((k) => keyId(k, rule.groups));
    if (previousPageKeys && ids.length > 0 && ids.every((id) => previousPageKeys!.has(id))) {
      console.log(`${tag} 이전 페이지와 같은 목록입니다 — 페이지 이동이 안 되는 것으로 보고 종료합니다.`);
      break;
    }
    previousPageKeys = new Set(ids);

    if (keys.length === 0) {
      // 2페이지 이후가 비었으면 그냥 목록 끝이다 — 경고할 일이 아니다.
      if (pageNo > 1) {
        console.log(`${tag} 목록 끝 — 종료`);
        break;
      }

      console.log(`${tag} ⚠ 전표를 못 찾았습니다. 조회 기간에 건이 없거나 목록이 아직 안 그려진 상태입니다.`);
      console.log(`${tag}   기간을 화면에서 직접 골라야 하면 '--wait 180' 으로 실행하세요.`);
      await dumpFailure(site, page, `no-keys-p${pageNo}`, "전표 0건");
    }

    for (const key of keys) {
      if (limit && stats.saved >= limit) {
        console.log(`${tag} 상한(${limit}건) 도달 — 중단`);
        return;
      }

      const main = keyMain(key, rule.groups);
      // 주문번호에 날짜가 든 사이트(11번가)만 여기서 날짜를 얻는다. 그 외에는 전표 문서에서 읽거나,
      // 못 읽어도 기간 조회로 범위가 좁혀져 있어 수집에는 지장이 없다(파일이 nodate 로 갈 뿐).
      const dateFromKey = cfg.orderDateFromOrderNo ? dateFromOrderNo(main) : "";
      if (!inRange(dateFromKey, from, to)) {
        stats.skipped++;
        continue;
      }

      const label = cfg.receiptLabel || "영수증";

      if (dryRun) {
        const target = cfg.receiptRequest ? `POST ${cfg.receiptRequest.url}` : receiptUrl(cfg, key);
        console.log(`${tag} [dry-run] ${dateFromKey || "날짜?"} / ${keyId(key, rule.groups)} / ${label} → ${target}`);
        continue;
      }

      // 11번가는 한 주문에 상품별로 전표가 나뉘어 순번을 올려가며 받아야 한다.
      // G마켓처럼 목록의 한 줄이 곧 전표 한 장인 사이트는 한 번만 받는다.
      const maxSeq = cfg.iterateItemSeq ? MAX_PRD_SEQ : 1;

      for (let seq = 1; seq <= maxSeq; seq++) {
        if (limit && stats.saved >= limit) {
          console.log(`${tag} 상한(${limit}건) 도달 — 중단`);
          return;
        }
        if (page.isClosed()) {
          console.log(`${tag} 브라우저가 닫혔습니다 — 중단`);
          return;
        }

        // seq=1 은 키·파일명을 그대로 둬 이전 수집분과 이어지게 한다.
        const ledgerKey = seq === 1
          ? `${keyId(key, rule.groups)}::${label}`
          : `${keyId(key, rule.groups)}#${seq}::${label}`;

        if (collected.has(ledgerKey)) {
          stats.skipped++;
          continue;
        }

        const receipt = await page.context().newPage();
        let isEmptyForm = false;

        try {
          await openReceiptDocument(receipt, cfg, key, { ordPrdSeq: String(seq) });
          await sleep(1500);

          if (new RegExp(cfg.loggedOutPattern, "i").test(receipt.url())) {
            throw new Error(`영수증 페이지가 로그인을 요구합니다: ${receipt.url()}`);
          }

          const text = await receipt.innerText("body").catch(() => "");

          // 상품 순번을 올려가는 사이트에서만 "빈 양식"을 끝 신호로 쓴다.
          if (cfg.iterateItemSeq && !text.includes(main)) {
            isEmptyForm = true;
          } else {
            const orderDate = dateFromKey || (cfg.orderDateFromDocument ? dateFromText(text) : "");
            const month = (orderDate || "unknown").slice(0, 7);
            const outDir = ensureSiteDir(site, path.join("receipts", month));
            const stem = seq === 1
              ? `${orderDate || "nodate"}_${main}`
              : `${orderDate || "nodate"}_${main}-${seq}`;
            const outBase = path.join(outDir, safeName(`${stem}_${label}`));

            const result: SaveResult = await savePageAsPdf(receipt, outBase);

            if (opts.withText) {
              const textPath = `${outBase}.txt`;
              fs.writeFileSync(textPath, text, "utf-8");
              result.files.push(textPath);
            }

            appendLedger(site, {
              site,
              orderNo: seq === 1 ? main : `${main}#${seq}`,
              orderDate,
              // 품목·금액은 전표 PDF 안에 있다. 목록에서 추정해 잘못된 값을 넣느니 비워 둔다.
              title: "",
              amount: "",
              receiptType: label,
              method: result.method,
              files: result.files.map((f) => path.relative(siteDir(site), f)).join(" | "),
              collectedAt: new Date().toISOString(),
            });
            collected.add(ledgerKey);
            stats.saved++;

            console.log(`${tag} ✅ ${orderDate || "?"} ${main}${seq > 1 ? `#${seq}` : ""} → ${result.method}`);
            for (const a of result.attempts) console.log(`${tag}    ↳ ${a.method} 실패: ${a.error}`);
          }
        } catch (e) {
          stats.failed++;
          console.log(`${tag} ❌ ${main}#${seq} 실패: ${String(e).slice(0, 200)}`);
          await dumpFailure(site, receipt, ledgerKey, String(e));
        } finally {
          await receipt.close().catch(() => {});
        }

        if (isEmptyForm) break;
        await sleep(delay);
      }
    }

    if (pageNo < pages) {
      // 조회 요청에 페이지 토큰이 있으면 '다음' 버튼을 찾는 대신 번호를 올려 다시 요청한다(훨씬 견고).
      const pagedByRequest = Object.values(cfg.listRequest?.fields || {}).some((v) => v.includes("{page}"));

      if (pagedByRequest && from && to) {
        await openOrderList(page, cfg, from, to, tag, pageNo + 1);
        continue;
      }

      const moved = await goNextPage(page, cfg);
      if (!moved) {
        console.log(`${tag} 다음 페이지 없음 — 종료`);
        break;
      }
    }
  }
}

/** ISO 날짜(YYYY-MM-DD)를 사이트가 쓰는 형식으로 바꾼다 */
function formatDate(iso: string, fmt = "YYYYMMDD"): string {
  const [y, m, d] = iso.split("-");
  return fmt.replace("YYYY", y).replace("MM", m).replace("DD", d);
}

/** 조회 요청 필드의 치환 토큰을 실제 값으로 바꾼다 */
function applyTokens(value: string, from: string, to: string, fmt: string | undefined, pageNo: number): string {
  const [fromY, fromM, fromD] = from.split("-");
  const [toY, toM, toD] = to.split("-");

  return value
    .replace(/\{from\}/g, formatDate(from, fmt))
    .replace(/\{to\}/g, formatDate(to, fmt))
    .replace(/\{fromYYYY\}/g, fromY)
    .replace(/\{fromMM\}/g, fromM)
    .replace(/\{fromDD\}/g, fromD)
    .replace(/\{toYYYY\}/g, toY)
    .replace(/\{toMM\}/g, toM)
    .replace(/\{toDD\}/g, toD)
    .replace(/\{page\}/g, String(pageNo));
}

/**
 * 목록(주문내역 또는 증빙 발급 화면)을 연다.
 * - config.listRequest 가 있으면 조회 기간을 직접 지정해 연다(무인 실행). GET·POST 둘 다 지원.
 * - 없으면 기본 목록 주소로 이동한다. 이 경우 화면의 기본 조회 기간 밖 건은 안 보이므로
 *   --wait 로 사람이 기간을 조회해 줘야 한다.
 */
async function openOrderList(
  page: Page,
  cfg: SiteConfig,
  from: string | undefined,
  to: string | undefined,
  tag: string,
  pageNo = 1
): Promise<void> {
  const req = cfg.listRequest;

  if (!req || !from || !to) {
    if (req && (!from || !to)) console.log(`${tag} 조회 기간(--from/--to)이 없어 기본 목록을 엽니다.`);
    await page.goto(cfg.orderListUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    return;
  }

  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.fields)) {
    fields[name] = applyTokens(value, from, to, req.dateFormat, pageNo);
  }

  if ((req.method || "GET") === "GET") {
    const url = new URL(req.url);
    for (const [name, value] of Object.entries(fields)) url.searchParams.set(name, value);

    console.log(`${tag} 기간 지정 조회: ${url.toString()}`);
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });
    return;
  }

  console.log(`${tag} 기간 지정 조회(POST): ${req.url} ${JSON.stringify(fields)}`);
  await page.goto(req.refererUrl || cfg.orderListUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await submitForm(page, req.url, fields);
}

/**
 * 영수증(전표) 문서를 연다.
 * - receiptRequest 가 있으면 폼 POST(11번가), 없으면 receiptUrlTemplate 로 GET(G마켓).
 * - 폼 POST 는 지정된 페이지로 먼저 이동해 세션·리퍼러를 갖춘 뒤 제출한다.
 */
async function openReceiptDocument(
  page: Page,
  cfg: SiteConfig,
  key: ReceiptKey,
  overrides: Record<string, string> = {}
): Promise<void> {
  const req = cfg.receiptRequest;

  if (!req) {
    await page.goto(receiptUrl(cfg, key), { waitUntil: "domcontentloaded", timeout: 60_000 });
    return;
  }

  await page.goto(req.refererUrl || cfg.orderListUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.fields)) fields[name] = fillKeyTokens(value, key, false);
  Object.assign(fields, overrides);

  await submitForm(page, req.url, fields);
}

/**
 * 현재 페이지에 폼을 만들어 제출한다(POST 로만 열리는 문서·목록용).
 * 필드 이름에 method 가 있으면 IDL 속성(form.method)과 부딪히므로 content attribute 로 지정한다.
 */
async function submitForm(page: Page, url: string, fields: Record<string, string>): Promise<void> {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60_000 }),
    page.evaluate(
      ({ url, fields }) => {
        const form = document.createElement("form");
        form.setAttribute("method", "post");
        form.setAttribute("action", url);

        for (const [name, value] of Object.entries(fields)) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = name;
          input.value = value;
          form.appendChild(input);
        }

        document.body.appendChild(form);
        form.submit();
      },
      { url, fields }
    ),
  ]);
}

/** 식별자 값을 URL·폼에 넣기 좋게 다듬는다(이미 인코딩된 값은 그대로 둔다) */
function encodeKeyValue(value: string): string {
  if (value.includes("%")) return value;
  return /[^A-Za-z0-9_.~-]/.test(value) ? encodeURIComponent(value) : value;
}

/** 템플릿의 {이름} 토큰을 식별자 값으로 치환 */
function fillKeyTokens(template: string, key: ReceiptKey, encode: boolean): string {
  let out = template;
  for (const [name, value] of Object.entries(key)) {
    out = out.split(`{${name}}`).join(encode ? encodeKeyValue(value) : value);
  }
  return out;
}

function receiptUrl(cfg: SiteConfig, key: ReceiptKey): string {
  return fillKeyTokens(cfg.receiptUrlTemplate || "", key, true);
}

/** 문서 텍스트에서 첫 날짜를 찾는다(전표에 찍힌 거래일자) */
function dateFromText(text: string): string {
  const m = text.match(/(20\d{2})[.\-/\s]+(\d{1,2})[.\-/\s]+(\d{1,2})/);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}



async function goNextPage(page: Page, cfg: SiteConfig): Promise<boolean> {
  // 페이지네이션도 목록과 같은 iframe 안에 있을 수 있어 모든 프레임을 뒤진다.
  const scopes: (Page | Frame)[] = [page, ...page.frames().filter((f) => f !== page.mainFrame())];

  for (const selector of cfg.nextPageSelectors) {
    for (const scope of scopes) {
      const next = scope.locator(selector).first();
      if ((await next.count().catch(() => 0)) === 0) continue;
      if (!(await next.isEnabled().catch(() => false))) continue;

      await next.click({ timeout: 15_000 }).catch(() => {});
      await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(2500);
      return true;
    }
  }
  return false;
}
