import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { spawn, exec, type ChildProcess } from "node:child_process";
import readline from "node:readline";
import type { CollectionConfig } from "./types";

/** /ieps/parse 라우팅과 동일한 카테고리 어휘. cli-collect 의 ParseOnlyCategory 와 1:1 대응. */
export type ParseCategory = "integratedFirst" | "integratedChange" | "annualReport";

export interface JobOptions {
  config: CollectionConfig;
  maxPages?: number;
  backendUrl?: string;
  dryRun?: boolean;
  skipParse?: boolean;
  /** 스크래핑 + PDF 다운로드까지만 수행. UI "수집 시작" 버튼은 항상 이 모드로 호출한다. */
  downloadOnly?: boolean;
  /**
   * raw/ 아래 PDF 중 카테고리에 해당하는 파일만 파싱+적재.
   * UI 의 "통합허가 파싱" / "변경허가 파싱" / "연간보고서 파싱" 버튼이 사용한다.
   * 설정 시 maxPages / collectionRange 등 스크래핑 단계 옵션은 무시된다.
   */
  parseOnly?: ParseCategory;
}

export interface JobHandle {
  process: ChildProcess;
  stdout: AsyncIterable<string>;
  stderr: AsyncIterable<string>;
  configPath: string;
  cleanup: () => void;
  /**
   * cli-collect 와 그 자식(npx → ts-node → node) 프로세스 트리 전체를 강제 종료한다.
   *
   * Windows + npx.cmd + shell:true 조합에서는 child.kill("SIGTERM")이 cmd.exe만
   * 종료시키고 실제 작업을 도는 손자(node) 프로세스는 살아남아 backend 의 /ieps/parse
   * 를 계속 호출하는 orphan 현상이 발생한다. 이 메서드는 OS별로 트리 전체를 죽인다.
   */
  killTree: () => void;
}

/**
 * Windows 에서 자식 프로세스 트리 전체를 강제 종료한다.
 * `taskkill /F /T /PID <pid>` 는 PID 와 그 모든 자손을 SIGKILL 동등 신호로 종료.
 */
function killTreeWindows(pid: number | undefined): void {
  if (!pid) return;
  try {
    // exec 는 비동기지만 결과를 기다릴 필요 없음 — 종료 명령만 발사하면 OS가 처리.
    exec(`taskkill /F /T /PID ${pid}`, () => {
      /* 실패해도 무시 — 이미 죽은 경우 등 */
    });
  } catch {
    // ignore
  }
}

/**
 * scraper의 cli-collect.ts를 spawn하여 NDJSON 진행 이벤트를 stream으로 노출한다.
 * - configPath는 임시 디렉터리에 작성하고, cleanup() 호출 시 삭제한다.
 * - npx ts-node 호출 (scraper/package.json devDependencies로 설치됨).
 */
export function startCollectJob(options: JobOptions): JobHandle {
  const scraperRoot = path.resolve(process.cwd(), "..", "scraper");
  if (!fs.existsSync(scraperRoot)) {
    throw new Error("scraper directory not found: " + scraperRoot);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcm-collect-"));
  const configPath = path.join(tmpDir, "collection-config.json");
  fs.writeFileSync(configPath, JSON.stringify(options.config, null, 2), "utf8");

  const args: string[] = [
    "ts-node",
    "--project",
    "tsconfig.json",
    "scripts/cli-collect.ts",
    "--json-progress",
    "--config=" + configPath,
  ];
  if (options.maxPages != null) args.push("--max-pages=" + options.maxPages);
  if (options.backendUrl) args.push("--backend=" + options.backendUrl);
  if (options.dryRun) args.push("--dry-run");
  if (options.skipParse) args.push("--skip-parse");
  if (options.downloadOnly) args.push("--download-only");
  if (options.parseOnly) args.push("--parse-only=" + options.parseOnly);

  // Windows 환경에서는 npx.cmd, 그 외 npx
  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

  const child = spawn(npxCmd, args, {
    cwd: scraperRoot,
    env: {
      ...process.env,
      // SSE를 띄운 Next.js 인스턴스가 가리키는 db.sqlite를 그대로 cli-collect도 사용
      SCRAPER_DB_PATH: process.env.IEPS_DB_PATH ?? path.resolve(scraperRoot, "..", "data", "ieps", "db.sqlite"),
    },
    // Windows의 npx.cmd는 cmd.exe로 해석되어야 하므로 셸 경유 필요
    // (Node 18.20.2/20.12.2/21.7.3+ 보안 패치로 .cmd 직접 spawn 시 EINVAL 발생)
    shell: process.platform === "win32",
  });

  const stdoutIter = readline.createInterface({ input: child.stdout!, crlfDelay: Infinity });
  const stderrIter = readline.createInterface({ input: child.stderr!, crlfDelay: Infinity });

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      stdoutIter.close();
      stderrIter.close();
    } catch {}
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  };

  child.on("exit", cleanup);

  const killTree = () => {
    if (process.platform === "win32") {
      killTreeWindows(child.pid);
    } else {
      // POSIX: SIGTERM 으로 1차 시도, 일정 시간 후에도 살아있으면 SIGKILL.
      try {
        child.kill("SIGTERM");
      } catch {}
      setTimeout(() => {
        try {
          if (!child.killed) child.kill("SIGKILL");
        } catch {}
      }, 3000).unref();
    }
  };

  return {
    process: child,
    stdout: stdoutIter,
    stderr: stderrIter,
    configPath,
    cleanup,
    killTree,
  };
}
