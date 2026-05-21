import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { readScraperSchedules, type ScraperSchedule } from "./schedule-store";
import {
  isGitHubApiAvailable,
  updateMultipleFilesOnGitHub,
} from "./github-api";

// ============================================================
// Git helpers (same pattern as targets-store.ts)
// ============================================================

function getProjectRoot(): string {
  const cwd = process.cwd();
  if (path.basename(cwd).toLowerCase() === "frontend") return path.dirname(cwd);
  if (fs.existsSync(path.join(cwd, "frontend"))) return cwd;
  return cwd;
}

function execGitCommand(command: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { cwd, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout.trim());
    });
  });
}

export interface ScheduleSyncResult {
  success: boolean;
  message: string;
  details?: string;
}

// ============================================================
// Cron timezone conversion (KST/JST → UTC)
// ============================================================

const TIMEZONE_OFFSETS: Record<string, number> = {
  "Asia/Seoul": 9,
  "Asia/Tokyo": 9,
  UTC: 0,
};

function cronToUtc(cron: string, timezone: string): string {
  const offset = TIMEZONE_OFFSETS[timezone] ?? 9;
  if (offset === 0) return cron;

  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [minute, hourStr, dom, month, dow] = parts;
  const hour = parseInt(hourStr, 10);
  if (isNaN(hour)) return cron;

  let utcHour = hour - offset;
  let prevDay = false;

  if (utcHour < 0) {
    utcHour += 24;
    prevDay = true;
  }

  let utcDow = dow;
  let utcDom = dom;

  if (prevDay) {
    if (dow !== "*") {
      utcDow = dow
        .split(",")
        .map((d) => String((parseInt(d.trim(), 10) + 6) % 7))
        .join(",");
    }
    if (dom !== "*") {
      utcDom = dom
        .split(",")
        .map((d) => {
          const n = parseInt(d.trim(), 10);
          return String(Math.max(n - 1, 1));
        })
        .join(",");
    }
  }

  return `${minute} ${utcHour} ${utcDom} ${month} ${utcDow}`;
}

function cronToKstDescription(cron: string, timezone: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, , dow] = parts;
  const dayNames: Record<string, string> = {
    "0": "일", "1": "월", "2": "화", "3": "수",
    "4": "목", "5": "금", "6": "토",
  };
  let desc = `KST ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  if (dow !== "*") desc += ` (${dow.split(",").map((d) => dayNames[d.trim()] || d).join(",")})`;
  if (dom !== "*") desc += ` (매월 ${dom}일)`;
  return desc;
}

// ============================================================
// Workflow YAML generation
// ============================================================

type CronGroup = {
  utcCron: string;
  boards: string[];
  kstDesc: string;
  names: string[];
};

function groupSchedulesByCron(schedules: ScraperSchedule[]): CronGroup[] {
  const map = new Map<string, CronGroup>();

  for (const sched of schedules) {
    if (!sched.enabled || sched.targets.length === 0) continue;

    const utcCron = cronToUtc(sched.cron, sched.timezone);
    const kstDesc = cronToKstDescription(sched.cron, sched.timezone);

    if (map.has(utcCron)) {
      const group = map.get(utcCron)!;
      for (const t of sched.targets) {
        if (!group.boards.includes(t)) group.boards.push(t);
      }
      group.names.push(sched.name);
    } else {
      map.set(utcCron, {
        utcCron,
        boards: [...sched.targets],
        kstDesc,
        names: [sched.name],
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const pa = a.utcCron.split(/\s+/).map(Number);
    const pb = b.utcCron.split(/\s+/).map(Number);
    return pa[1] !== pb[1] ? pa[1] - pb[1] : pa[0] - pb[0];
  });
}

function generateWorkflowYaml(groups: CronGroup[]): string {
  const L: string[] = [];
  const push = (...lines: string[]) => lines.forEach((l) => L.push(l));

  // --- Header ---
  push(
    "# GitHub Actions 스케줄 스크래핑 워크플로우",
    "#",
    "# 이 파일은 Railway 앱의 스케줄 설정 변경 시 자동 생성됩니다.",
    "# 직접 수정하지 마세요. 앱의 스케줄 관리 UI에서 변경해 주세요.",
    "#",
    `# 마지막 생성: ${new Date().toISOString()}`,
    "",
    "name: Scheduled Scraping",
    "",
    "on:",
    "  schedule:",
  );

  if (groups.length === 0) {
    push('    - cron: "0 0 31 2 *"  # placeholder (never fires)');
  } else {
    for (const g of groups) {
      push(`    - cron: "${g.utcCron}"  # ${g.kstDesc} - ${g.names.join(", ")}`);
    }
  }

  push(
    "",
    "  workflow_dispatch:",
    "    inputs:",
    "      board_ids:",
    '        description: "스크래핑할 보드 ID (쉼표 구분, 빈칸=스케줄 기반)"',
    "        required: false",
    '        default: ""',
    "      max_pages:",
    '        description: "최대 페이지 수"',
    "        required: false",
    '        default: "10"',
    "      download_attachments:",
    '        description: "첨부파일 다운로드"',
    "        required: false",
    '        default: "true"',
    "        type: boolean",
    "",
    "env:",
    '  NODE_VERSION: "20"',
    "",
    "concurrency:",
    "  group: scraping-workflow",
    "  cancel-in-progress: false",
    "",
    "jobs:",
    "  determine-boards:",
    "    runs-on: ubuntu-latest",
    "    outputs:",
    "      boards: ${{ steps.set-boards.outputs.boards }}",
    "      should_run: ${{ steps.set-boards.outputs.should_run }}",
    "",
    "    steps:",
    "      - name: Checkout repository",
    "        uses: actions/checkout@v4",
    "",
    "      - name: Determine boards to scrape",
    "        id: set-boards",
    "        run: |",
    '          # 수동 실행인 경우',
    '          if [ -n "${{ github.event.inputs.board_ids }}" ]; then',
    '            echo "boards=${{ github.event.inputs.board_ids }}" >> $GITHUB_OUTPUT',
    '            echo "should_run=true" >> $GITHUB_OUTPUT',
    "            exit 0",
    "          fi",
    "",
    '          CRON="${{ github.event.schedule }}"',
    "          KST_NOW=$(TZ='Asia/Seoul' date '+%Y-%m-%d %H:%M:%S')",
    '          echo "Triggered by cron: \'${CRON}\'"',
    '          echo "Current KST: ${KST_NOW}"',
    "",
    '          BOARDS=""',
    "",
    '          case "${CRON}" in',
  );

  // --- Case entries ---
  for (const g of groups) {
    const boards = g.boards.join(",");
    push(
      `            "${g.utcCron}")`,
      `              # ${g.kstDesc} - ${g.names.join(", ")}`,
      `              BOARDS="${boards}"`,
      "              ;;",
    );
  }

  push(
    "          esac",
    "",
    '          if [ -n "$BOARDS" ]; then',
    '            echo "boards=${BOARDS}" >> $GITHUB_OUTPUT',
    '            echo "should_run=true" >> $GITHUB_OUTPUT',
    '            echo "Will scrape: ${BOARDS}"',
    "          else",
    '            echo "boards=" >> $GITHUB_OUTPUT',
    '            echo "should_run=false" >> $GITHUB_OUTPUT',
    "            echo \"No boards matched for cron: '${CRON}'\"",
    "          fi",
    "",
  );

  // --- Scrape job (static) ---
  push(
    "  scrape:",
    "    needs: determine-boards",
    "    if: needs.determine-boards.outputs.should_run == 'true'",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 45",
    "",
    "    steps:",
    "      - name: Checkout repository",
    "        uses: actions/checkout@v4",
    "",
    "      - name: Setup Node.js",
    "        uses: actions/setup-node@v4",
    "        with:",
    "          node-version: ${{ env.NODE_VERSION }}",
    '          cache: "npm"',
    "          cache-dependency-path: frontend/package-lock.json",
    "",
    "      - name: Install dependencies",
    "        working-directory: frontend",
    "        run: npm ci",
    "",
    "      - name: Install Playwright browsers",
    "        working-directory: frontend",
    "        run: npx playwright install chromium --with-deps",
    "",
    "      - name: Run scraper (attempt 1)",
    "        id: scrape1",
    "        working-directory: frontend",
    "        continue-on-error: true",
    "        env:",
    "          BOARDS: ${{ needs.determine-boards.outputs.boards }}",
    "          MAX_PAGES: ${{ github.event.inputs.max_pages || '10' }}",
    "          DOWNLOAD_ATTACHMENTS: ${{ github.event.inputs.download_attachments || 'true' }}",
    "        run: |",
    '          SCRAPE_ARGS="--boards=${BOARDS} --output=./results --max-pages=${MAX_PAGES}"',
    "",
    '          if [ "${DOWNLOAD_ATTACHMENTS}" = "false" ]; then',
    '            SCRAPE_ARGS="${SCRAPE_ARGS} --no-attachments"',
    "          fi",
    "",
    '          echo "Running: npm run scrape -- ${SCRAPE_ARGS}"',
    "          npm run scrape -- ${SCRAPE_ARGS}",
    "",
    "      - name: Wait before retry",
    "        if: steps.scrape1.outcome == 'failure'",
    "        run: |",
    '          echo "First attempt failed, waiting 30 seconds before retry..."',
    "          sleep 30",
    "",
    "      - name: Run scraper (attempt 2)",
    "        id: scrape2",
    "        if: steps.scrape1.outcome == 'failure'",
    "        working-directory: frontend",
    "        continue-on-error: true",
    "        env:",
    "          BOARDS: ${{ needs.determine-boards.outputs.boards }}",
    "          MAX_PAGES: ${{ github.event.inputs.max_pages || '10' }}",
    "          DOWNLOAD_ATTACHMENTS: ${{ github.event.inputs.download_attachments || 'true' }}",
    "        run: |",
    '          SCRAPE_ARGS="--boards=${BOARDS} --output=./results --max-pages=${MAX_PAGES}"',
    "",
    '          if [ "${DOWNLOAD_ATTACHMENTS}" = "false" ]; then',
    '            SCRAPE_ARGS="${SCRAPE_ARGS} --no-attachments"',
    "          fi",
    "",
    '          echo "Retry attempt: npm run scrape -- ${SCRAPE_ARGS}"',
    "          npm run scrape -- ${SCRAPE_ARGS}",
    "",
    "      - name: Wait before final retry",
    "        if: steps.scrape1.outcome == 'failure' && steps.scrape2.outcome == 'failure'",
    "        run: |",
    '          echo "Second attempt failed, waiting 60 seconds before final retry..."',
    "          sleep 60",
    "",
    "      - name: Run scraper (attempt 3 - final)",
    "        id: scrape3",
    "        if: steps.scrape1.outcome == 'failure' && steps.scrape2.outcome == 'failure'",
    "        working-directory: frontend",
    "        env:",
    "          BOARDS: ${{ needs.determine-boards.outputs.boards }}",
    "          MAX_PAGES: ${{ github.event.inputs.max_pages || '10' }}",
    "          DOWNLOAD_ATTACHMENTS: ${{ github.event.inputs.download_attachments || 'true' }}",
    "        run: |",
    '          SCRAPE_ARGS="--boards=${BOARDS} --output=./results --max-pages=${MAX_PAGES}"',
    "",
    '          if [ "${DOWNLOAD_ATTACHMENTS}" = "false" ]; then',
    '            SCRAPE_ARGS="${SCRAPE_ARGS} --no-attachments"',
    "          fi",
    "",
    '          echo "Final attempt: npm run scrape -- ${SCRAPE_ARGS}"',
    "          npm run scrape -- ${SCRAPE_ARGS}",
    "",
    "      - name: Generate artifact name",
    "        id: artifact-name",
    "        run: |",
    "          DATE=$(TZ='Asia/Seoul' date +%Y%m%d_%H%M)",
    '          echo "name=scrape-results-${DATE}" >> $GITHUB_OUTPUT',
    "",
    "      - name: Upload results as artifact",
    "        uses: actions/upload-artifact@v4",
    "        with:",
    "          name: ${{ steps.artifact-name.outputs.name }}",
    "          path: frontend/results/",
    "          retention-days: 7",
    "          if-no-files-found: warn",
    "",
    "      - name: Summary",
    "        run: |",
    '          echo "## 스크래핑 완료" >> $GITHUB_STEP_SUMMARY',
    '          echo "" >> $GITHUB_STEP_SUMMARY',
    '          echo "- 대상 보드: ${{ needs.determine-boards.outputs.boards }}" >> $GITHUB_STEP_SUMMARY',
    "          echo \"- 실행 시간: $(TZ='Asia/Seoul' date '+%Y-%m-%d %H:%M:%S KST')\" >> $GITHUB_STEP_SUMMARY",
    "",
    "          ATTEMPTS=1",
    '          if [ "${{ steps.scrape1.outcome }}" == "failure" ]; then',
    "            ATTEMPTS=2",
    '            if [ "${{ steps.scrape2.outcome }}" == "failure" ]; then',
    "              ATTEMPTS=3",
    "            fi",
    "          fi",
    '          echo "- 시도 횟수: ${ATTEMPTS}회" >> $GITHUB_STEP_SUMMARY',
    '          echo "" >> $GITHUB_STEP_SUMMARY',
    "",
    "          if [ -f frontend/results/summary.json ]; then",
    '            echo "### 결과 요약" >> $GITHUB_STEP_SUMMARY',
    "            cat frontend/results/summary.json | jq -r '\"- 총 수집: \\(.totalArticles)건\"' >> $GITHUB_STEP_SUMMARY",
    "            cat frontend/results/summary.json | jq -r '\"- 첨부파일: \\(.totalAttachments)개\"' >> $GITHUB_STEP_SUMMARY",
    "            cat frontend/results/summary.json | jq -r '\"- 성공: \\(.successBoards)/\\(.totalBoards) 보드\"' >> $GITHUB_STEP_SUMMARY",
    "          fi",
    "",
  );

  return L.join("\n");
}

// ============================================================
// Public API
// ============================================================

/**
 * scraper-schedules.json에서 워크플로우 YAML을 생성하고 GitHub에 동기화
 *
 * 1) GITHUB_TOKEN + GITHUB_REPO가 설정되어 있으면 GitHub REST API 사용 (Railway 환경)
 * 2) 아니면 로컬 git CLI 사용 (개발 환경)
 */
export async function syncScheduleWorkflowToGitHub(): Promise<ScheduleSyncResult> {
  const data = readScraperSchedules();
  const groups = groupSchedulesByCron(data.schedules);
  const yaml = generateWorkflowYaml(groups);

  const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
  const commitMsg = `update: sync scraping schedules and workflow (${timestamp})`;

  // --- GitHub API 방식 (Railway / Docker 환경) ---
  if (isGitHubApiAvailable()) {
    try {
      const projectRoot = getProjectRoot();
      const schedulesPath = path.join(projectRoot, "frontend", "data", "scraper-schedules.json");

      const schedulesContent = fs.existsSync(schedulesPath)
        ? fs.readFileSync(schedulesPath, "utf-8")
        : JSON.stringify(data, null, 2);

      const result = await updateMultipleFilesOnGitHub(
        [
          { path: "frontend/data/scraper-schedules.json", content: schedulesContent },
          { path: ".github/workflows/scheduled-scrape.yml", content: yaml },
        ],
        commitMsg
      );
      console.log(`[ScheduleSync] API: ${result.message} ${result.details || ""}`);
      return {
        success: result.success,
        message: result.message,
        details: result.success ? `${groups.length}개 cron 트리거 생성` : result.details,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[ScheduleSync] API 실패:", msg);
      return { success: false, message: "GitHub API 동기화 실패", details: msg };
    }
  }

  // --- Git CLI 방식 (로컬 개발 환경) ---
  const projectRoot = getProjectRoot();
  const workflowPath = path.join(projectRoot, ".github", "workflows", "scheduled-scrape.yml");
  const schedulesRelPath = "frontend/data/scraper-schedules.json";
  const workflowRelPath = ".github/workflows/scheduled-scrape.yml";

  try {
    fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
    fs.writeFileSync(workflowPath, yaml, "utf8");

    const status = await execGitCommand("git status --porcelain", projectRoot);

    const hasScheduleChanges = status.includes("scraper-schedules.json");
    const hasWorkflowChanges = status.includes("scheduled-scrape.yml");

    if (!hasScheduleChanges && !hasWorkflowChanges) {
      return { success: true, message: "변경사항 없음 - 동기화 불필요" };
    }

    if (hasScheduleChanges) {
      await execGitCommand(`git add "${schedulesRelPath}"`, projectRoot);
    }
    if (hasWorkflowChanges) {
      await execGitCommand(`git add "${workflowRelPath}"`, projectRoot);
    }

    await execGitCommand(`git commit -m "${commitMsg}"`, projectRoot);
    await execGitCommand("git push", projectRoot);

    return {
      success: true,
      message: "GitHub 동기화 완료 (스케줄 + 워크플로우)",
      details: `${groups.length}개 cron 트리거 생성`,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("nothing to commit")) {
      return { success: true, message: "변경사항 없음 - 동기화 불필요" };
    }
    return { success: false, message: "GitHub 동기화 실패", details: msg };
  }
}
