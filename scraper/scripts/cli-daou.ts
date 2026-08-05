#!/usr/bin/env npx ts-node
/**
 * 다우오피스 전자결재 문서 반출 CLI (MCM 이관용).
 *
 * 사용법:
 *   npm run daou -- login --url https://<회사>.daouoffice.com
 *   npm run daou -- check --url https://<회사>.daouoffice.com
 *   npm run daou -- probe --url https://<회사>.daouoffice.com
 *
 * 명령:
 *   login  headed 브라우저로 사용자가 직접 로그인 → 세션(storageState) 저장
 *   check  저장된 세션이 아직 유효한지 확인
 *   probe  화면 조작 중 발생하는 XHR/fetch 를 기록해 내부 API 후보를 뽑음(수집기 설계용)
 *
 * 산출물은 전부 `data/daou/` 아래에 쌓인다(git 제외).
 */

import { interactiveLogin, checkSession, DAOU_DIR } from "../lib/daou/session";
import { probeApi } from "../lib/daou/probe";
import { collectList, summarizeList, verifyList } from "../lib/daou/collect-list";
import { fetchDocs, auditDocs } from "../lib/daou/fetch-docs";

interface Args {
  command: string;
  url?: string;
  from?: string;
  to?: string;
  offset?: number;
  pages?: number;
  concurrency?: number;
  limit?: number;
  withPrint?: boolean;
  fixAttach?: boolean;
}

function parseArgs(argv: string[]): Args {
  const [command, ...rest] = argv;
  const opt: Record<string, string> = {};

  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) opt[rest[i].slice(2)] = rest[i + 1];
  }

  return {
    command: command || "",
    url: opt.url || process.env.DAOU_BASE_URL,
    from: opt.from,
    to: opt.to,
    offset: opt.offset ? Number(opt.offset) : undefined,
    pages: opt.pages ? Number(opt.pages) : undefined,
    concurrency: opt.concurrency ? Number(opt.concurrency) : undefined,
    limit: opt.limit ? Number(opt.limit) : undefined,
    withPrint: "with-print" in opt,
    fixAttach: "fix-attach" in opt,
  };
}

function usage(): void {
  console.log(`
다우오피스 전자결재 반출 CLI

  npm run daou -- login --url <다우오피스 주소>   세션 저장(사용자가 직접 로그인)
  npm run daou -- check --url <다우오피스 주소>   세션 유효성 확인
  npm run daou -- probe --url <다우오피스 주소>   내부 API 탐색(로그인 겸용)
  npm run daou -- list  --url <주소> [--from 2015-01-01] [--to 2026-08-31] [--offset 100]
                                                 문서 목록 전량 수집(중단 시 이어받기)
  npm run daou -- summary                        수집된 목록 요약(연도·상태·양식별)
  npm run daou -- verify --url <주소>             연도별 서버 total 과 수집 건수 대사
  npm run daou -- fetch --url <주소> [--concurrency 5] [--limit 100] [--fix-attach]
                                                 문서 상세(본문·결재선)·첨부 반출(재개 가능)
  npm run daou -- audit                          반출 결과 대사(문서·첨부 누락 확인)

  산출물 경로: ${DAOU_DIR}
`);
}

async function main(): Promise<void> {
  const { command, url, from, to, offset, concurrency, limit, withPrint, fixAttach } = parseArgs(process.argv.slice(2));

  if (!command || command === "help") {
    usage();
    return;
  }

  if (command === "summary") {
    summarizeList();
    return;
  }

  if (command === "audit") {
    auditDocs();
    return;
  }

  if (!url) {
    console.error("[DAOU] --url 로 다우오피스 주소를 지정하세요(또는 DAOU_BASE_URL 환경변수).");
    process.exitCode = 1;
    return;
  }

  switch (command) {
    case "login":
      await interactiveLogin(url);
      break;

    case "check": {
      const ok = await checkSession(url);
      console.log(ok ? "[DAOU] 세션 유효 ✅" : "[DAOU] 세션 만료 ❌ — login 을 다시 실행하세요.");
      process.exitCode = ok ? 0 : 1;
      break;
    }

    case "probe":
      await probeApi(url);
      break;

    case "list":
      await collectList(url, { from, to, offset });
      break;

    case "verify":
      await verifyList(url, { from, to });
      break;

    case "fetch":
      await fetchDocs(url, { concurrency, limit, withPrint, fixAttach });
      break;

    default:
      console.error(`[DAOU] 알 수 없는 명령: ${command}`);
      usage();
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[DAOU] 실행 실패:", err);
  process.exitCode = 1;
});
