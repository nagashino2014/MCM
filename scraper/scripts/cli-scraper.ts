#!/usr/bin/env npx ts-node
/**
 * GitHub Actions용 CLI 스크래퍼
 * 
 * 사용법:
 *   npx ts-node scripts/cli-scraper.ts --board=mcee_board1 --output=./results
 *   npx ts-node scripts/cli-scraper.ts --boards=mcee_board1,kepco_board1 --output=./results
 *   npx ts-node scripts/cli-scraper.ts --all --output=./results
 * 
 * 옵션:
 *   --board=<board_id>      단일 보드 스크래핑
 *   --boards=<id1,id2,...>  여러 보드 스크래핑 (쉼표 구분)
 *   --all                   활성화된 모든 보드 스크래핑
 *   --output=<path>         결과 저장 경로 (기본: ./results)
 *   --max-pages=<n>         최대 페이지 수 (기본: 10)
 *   --no-attachments        첨부파일 다운로드 안함
 *   --data-path=<path>      타겟 데이터 경로 (기본: ./data)
 *   --help                  도움말 출력
 */

import path from "node:path";
import fs from "node:fs";
import {
  runScraper,
  loadTargets,
  findBoard,
  findOrg,
  type ScrapingResult,
} from "./scraper-runner";

// ============================================================
// 명령줄 인자 파싱
// ============================================================

interface CliOptions {
  boardIds: string[];
  outputDir: string;
  maxPages: number;
  downloadAttachments: boolean;
  dataPath: string;
  showHelp: boolean;
  all: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    boardIds: [],
    outputDir: "./results",
    maxPages: 10,
    downloadAttachments: true,
    dataPath: "./data",
    showHelp: false,
    all: false,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.showHelp = true;
    } else if (arg === "--all") {
      options.all = true;
    } else if (arg === "--no-attachments") {
      options.downloadAttachments = false;
    } else if (arg.startsWith("--board=")) {
      const boardId = arg.slice("--board=".length);
      if (boardId) {
        options.boardIds.push(boardId);
      }
    } else if (arg.startsWith("--boards=")) {
      const boards = arg.slice("--boards=".length).split(",").filter(Boolean);
      options.boardIds.push(...boards);
    } else if (arg.startsWith("--output=")) {
      options.outputDir = arg.slice("--output=".length);
    } else if (arg.startsWith("--max-pages=")) {
      const val = parseInt(arg.slice("--max-pages=".length), 10);
      if (!isNaN(val) && val > 0) {
        options.maxPages = val;
      }
    } else if (arg.startsWith("--data-path=")) {
      options.dataPath = arg.slice("--data-path=".length);
    }
  }

  return options;
}

function showHelp(): void {
  console.log(`
GitHub Actions용 CLI 스크래퍼

사용법:
  npx ts-node scripts/cli-scraper.ts [옵션]

옵션:
  --board=<board_id>      단일 보드 스크래핑
  --boards=<id1,id2,...>  여러 보드 스크래핑 (쉼표 구분)
  --all                   활성화된 모든 보드 스크래핑
  --output=<path>         결과 저장 경로 (기본: ./results)
  --max-pages=<n>         최대 페이지 수 (기본: 10)
  --no-attachments        첨부파일 다운로드 안함
  --data-path=<path>      타겟 데이터 경로 (기본: ./data)
  --help, -h              도움말 출력

예시:
  # 단일 보드 스크래핑
  npx ts-node scripts/cli-scraper.ts --board=mcee_board1

  # 여러 보드 스크래핑
  npx ts-node scripts/cli-scraper.ts --boards=mcee_board1,kepco_board1

  # 모든 활성 보드 스크래핑 (첨부파일 제외)
  npx ts-node scripts/cli-scraper.ts --all --no-attachments

출력:
  results/
    {board_id}/
      documents.json     # 수집된 문서 데이터
      attachments/       # 다운로드된 첨부파일
      report.json        # 실행 결과 요약
`);
}

// ============================================================
// 메인 실행
// ============================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.showHelp) {
    showHelp();
    process.exit(0);
  }

  // 데이터 경로 확인 및 조정
  let dataPath = options.dataPath;
  if (!path.isAbsolute(dataPath)) {
    dataPath = path.resolve(process.cwd(), dataPath);
  }

  // frontend/data 경로 체크
  if (!fs.existsSync(path.join(dataPath, "scraper-targets.json"))) {
    const altPath = path.join(process.cwd(), "frontend", "data");
    if (fs.existsSync(path.join(altPath, "scraper-targets.json"))) {
      dataPath = altPath;
    }
  }

  console.log(`\n📂 데이터 경로: ${dataPath}`);

  // 타겟 데이터 로드
  let targets;
  try {
    targets = loadTargets(dataPath);
    console.log(`✓ 타겟 로드: ${targets.orgs.length}개 기관, ${targets.boards.length}개 보드\n`);
  } catch (err: any) {
    console.error(`❌ 타겟 데이터 로드 실패: ${err.message}`);
    process.exit(1);
  }

  // 보드 목록 결정
  let boardIds = options.boardIds;

  if (options.all) {
    boardIds = targets.boards
      .filter(b => b.enabled)
      .map(b => b.board_id);
    console.log(`🔍 활성화된 모든 보드: ${boardIds.length}개\n`);
  }

  if (boardIds.length === 0) {
    console.error("❌ 스크래핑할 보드를 지정해주세요. (--board, --boards, 또는 --all)");
    showHelp();
    process.exit(1);
  }

  // 출력 디렉토리 설정
  let outputDir = options.outputDir;
  if (!path.isAbsolute(outputDir)) {
    outputDir = path.resolve(process.cwd(), outputDir);
  }
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`📁 출력 경로: ${outputDir}`);
  console.log(`📋 대상 보드: ${boardIds.join(", ")}`);
  console.log(`📄 최대 페이지: ${options.maxPages}`);
  console.log(`📎 첨부파일 다운로드: ${options.downloadAttachments ? "예" : "아니오"}\n`);

  // 스크래핑 실행
  const results: ScrapingResult[] = [];
  const startTime = Date.now();

  for (const boardId of boardIds) {
    const board = findBoard(targets, boardId);
    
    if (!board) {
      console.error(`⚠️ 보드를 찾을 수 없음: ${boardId}`);
      results.push({
        success: false,
        boardId,
        boardName: "Unknown",
        orgId: "",
        orgName: "",
        articlesCount: 0,
        attachmentsCount: 0,
        articles: [],
        errors: [`보드를 찾을 수 없음: ${boardId}`],
        executedAt: new Date().toISOString(),
        durationMs: 0,
      });
      continue;
    }

    const org = findOrg(targets, board.org_id);
    
    if (!org) {
      console.error(`⚠️ 기관을 찾을 수 없음: ${board.org_id}`);
      results.push({
        success: false,
        boardId,
        boardName: board.board_name,
        orgId: board.org_id,
        orgName: "Unknown",
        articlesCount: 0,
        attachmentsCount: 0,
        articles: [],
        errors: [`기관을 찾을 수 없음: ${board.org_id}`],
        executedAt: new Date().toISOString(),
        durationMs: 0,
      });
      continue;
    }

    try {
      const result = await runScraper({
        board,
        org,
        outputDir,
        maxPages: options.maxPages,
        downloadAttachments: options.downloadAttachments,
      });
      results.push(result);
    } catch (err: any) {
      console.error(`❌ 스크래핑 실패 (${boardId}): ${err.message}`);
      results.push({
        success: false,
        boardId,
        boardName: board.board_name,
        orgId: org.org_id,
        orgName: org.org_name,
        articlesCount: 0,
        attachmentsCount: 0,
        articles: [],
        errors: [err.message],
        executedAt: new Date().toISOString(),
        durationMs: 0,
      });
    }
  }

  // 전체 요약 저장
  const totalDuration = Date.now() - startTime;
  const summary = {
    executedAt: new Date().toISOString(),
    totalDurationMs: totalDuration,
    totalBoards: boardIds.length,
    successBoards: results.filter(r => r.success).length,
    failedBoards: results.filter(r => !r.success).length,
    totalArticles: results.reduce((sum, r) => sum + r.articlesCount, 0),
    totalAttachments: results.reduce((sum, r) => sum + r.attachmentsCount, 0),
    boards: results.map(r => ({
      boardId: r.boardId,
      boardName: r.boardName,
      orgName: r.orgName,
      success: r.success,
      articlesCount: r.articlesCount,
      attachmentsCount: r.attachmentsCount,
      errors: r.errors,
    })),
  };

  const summaryPath = path.join(outputDir, "summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  // 최종 출력
  console.log("\n" + "=".repeat(50));
  console.log("📊 스크래핑 완료 요약");
  console.log("=".repeat(50));
  console.log(`총 소요 시간: ${(totalDuration / 1000).toFixed(1)}초`);
  console.log(`성공: ${summary.successBoards}/${summary.totalBoards} 보드`);
  console.log(`총 수집: ${summary.totalArticles}건`);
  console.log(`총 첨부파일: ${summary.totalAttachments}개`);
  
  if (summary.failedBoards > 0) {
    console.log("\n❌ 실패한 보드:");
    for (const r of results.filter(r => !r.success)) {
      console.log(`  - ${r.boardId}: ${r.errors.join(", ")}`);
    }
  }
  
  console.log(`\n📁 결과 저장: ${outputDir}`);
  console.log("=".repeat(50) + "\n");

  // 실패한 보드가 있으면 exit code 1
  process.exit(summary.failedBoards > 0 ? 1 : 0);
}

// 실행
main().catch(err => {
  console.error("치명적 오류:", err);
  process.exit(1);
});
