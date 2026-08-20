#!/usr/bin/env npx ts-node
/**
 * 전자상거래 카드영수증 수집 CLI (부가세 신고 증빙용) — 11번가 스파이크.
 *
 * 사용법:
 *   npm run receipts -- login                                  세션 저장(사용자가 직접 로그인)
 *   npm run receipts -- check                                  저장된 세션이 아직 유효한지 확인
 *   npm run receipts -- probe [--watch]                        주문목록 실측(셀렉터·영수증 URL 확보)
 *   npm run receipts -- collect --from 2026-07-01 --to 2026-07-31 --limit 2 --dry-run
 *   npm run receipts -- summary                                수집 대장 요약
 *
 * 권장 순서: login → check → probe → collect --dry-run → collect --limit 1 → 전량 수집
 *
 * 주의
 * - 로그인은 사람이 직접 한다(캡차·2차인증). 스크립트는 계정 정보를 저장하지 않는다.
 * - 각 몰 약관은 자동화 접근을 제한한다. 본인 계정의 본인 결제내역이라도 계정 차단 가능성이 있으니
 *   건당 딜레이를 유지하고 저빈도(신고철 월 1회)로 돌린다.
 * - 산출물(세션·영수증·대장)은 전부 `data/receipts/` 아래에 쌓인다(git 제외).
 */

import { interactiveLogin, checkSession, hasSession, siteDir } from "../lib/receipts/session";
import { loadSiteConfig, saveSiteConfig } from "../lib/receipts/config";
import { probeOrderList } from "../lib/receipts/probe";
import { collectReceipts } from "../lib/receipts/eleven-st";
import { summarize } from "../lib/receipts/ledger";

interface Args {
  command: string;
  site: string;
  url?: string;
  from?: string;
  to?: string;
  pages?: number;
  limit?: number;
  delay?: number;
  headed: boolean;
  dryRun: boolean;
  watch: boolean;
}

function parseArgs(argv: string[]): Args {
  const [command, ...rest] = argv;
  const opt: Record<string, string> = {};

  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) opt[rest[i].slice(2)] = rest[i + 1];
  }

  return {
    command: command || "",
    site: opt.site || "11st",
    url: opt.url,
    from: opt.from,
    to: opt.to,
    pages: opt.pages ? Number(opt.pages) : undefined,
    limit: opt.limit ? Number(opt.limit) : undefined,
    delay: opt.delay ? Number(opt.delay) : undefined,
    headed: "headed" in opt,
    dryRun: "dry-run" in opt,
    watch: "watch" in opt,
  };
}

function usage(): void {
  console.log(`
전자상거래 카드영수증 수집 CLI (기본 사이트: 11번가)

  npm run receipts -- login   [--site 11st]        세션 저장(브라우저에서 직접 로그인 후 주문목록까지 이동)
  npm run receipts -- check   [--site 11st]        세션 유효성 확인
  npm run receipts -- probe   [--url <주문목록>] [--watch]
                                                   주문목록 실측 — 셀렉터·영수증 팝업 주소 확보
                                                   --watch: headed 로 띄워 직접 클릭하며 팝업/XHR 기록
  npm run receipts -- collect [--from 2026-07-01] [--to 2026-07-31]
                              [--pages 3] [--limit 2] [--delay 2000] [--headed] [--dry-run]
                                                   주문목록 순회 → 영수증 PDF 저장 → 대장 기록
  npm run receipts -- summary [--site 11st]        수집 대장 요약

  산출물 경로: ${siteDir("11st")}
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { command, site } = args;

  if (!command || command === "help") {
    usage();
    return;
  }

  const cfg = loadSiteConfig(site);

  if (command === "login") {
    const { saved, lastUrl } = await interactiveLogin(site, cfg.loginUrl);
    // 사용자가 마지막으로 머문 화면이 주문목록일 가능성이 높다 → 다음 실행의 시작점으로 기록.
    if (saved && lastUrl && !new RegExp(cfg.loggedOutPattern, "i").test(lastUrl)) {
      saveSiteConfig(site, { orderListUrl: lastUrl, checkUrl: lastUrl });
      console.log(`[${site}] 주문목록 URL 로 기록: ${lastUrl}`);
    }
    return;
  }

  if (command === "check") {
    if (!hasSession(site)) {
      console.log(`[${site}] 세션이 없습니다. 먼저 login 을 실행하세요.`);
      return;
    }
    const ok = await checkSession(site, cfg.checkUrl, cfg.loggedOutPattern, !args.headed);
    console.log(`[${site}] 세션 ${ok ? "✅ 유효" : "❌ 만료(또는 headless 차단)"}`);
    if (!ok) console.log(`[${site}] --headed 로 다시 확인해 보고, 그래도 안 되면 login 을 다시 실행하세요.`);
    return;
  }

  if (command === "probe") {
    await probeOrderList(site, { url: args.url, watch: args.watch });
    return;
  }

  if (command === "collect") {
    await collectReceipts(site, {
      from: args.from,
      to: args.to,
      pages: args.pages ?? 1,
      limit: args.limit,
      delay: args.delay,
      headless: !args.headed,
      dryRun: args.dryRun,
    });
    return;
  }

  if (command === "summary") {
    summarize(site);
    return;
  }

  console.log(`알 수 없는 명령: ${command}`);
  usage();
}

main().catch((e) => {
  console.error(`실패: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
