/**
 * Cron 기반 자동 스크래핑 스케줄러
 * 
 * - 서버 시작 시 JSON 파일에서 스케줄을 로드하여 cron job 등록
 * - 스케줄 추가/수정/삭제 시 동적으로 cron job 업데이트
 * - 설정된 시간에 자동으로 스크래핑 실행
 * 
 * ⚠️ 핵심: 즉시 실행 스크래핑 테스트(stream/route.ts)와 100% 동일한 로직 사용
 *    - 내부적으로 /api/scraper/execute/instant/stream API를 호출
 *    - 코드 중복 없이 동일한 Playwright 기반 스크래핑 로직 재사용
 */

import cron from "node-cron";
import {
  readScraperSchedules,
  writeScraperSchedules,
  type ScraperSchedule,
  type ScraperRun,
} from "./schedule-store";
import { readScraperTargets, type Board } from "./targets-store";

// 등록된 cron job을 저장하는 Map
const scheduledJobs = new Map<string, cron.ScheduledTask>();

// 스케줄러 초기화 상태
let isInitialized = false;

// ============================================================
// 안정성 설정
// ============================================================

/** 스케줄 실행 최대 타임아웃 (ms) - 기본 30분 */
const SCHEDULE_TIMEOUT_MS = 30 * 60 * 1000;

/** 스케줄 간 최소 간격 (ms) - 동시 트리거 방지 */
const MIN_SCHEDULE_INTERVAL_MS = 10 * 1000;

/** 재시도 횟수 */
const MAX_RETRY_COUNT = 2;

/** 재시도 대기 시간 (ms) */
const RETRY_DELAY_MS = 30 * 1000;

/** 마지막 스케줄 실행 시간 */
let lastScheduleExecutionTime = 0;

// ============================================================
// 글로벌 실행 큐 (순차 실행 보장)
// ============================================================

// 실행 대기 큐
const executionQueue: string[] = [];
// 현재 실행 중인 스케줄 ID
let currentlyExecuting: string | null = null;
// 큐 처리 중인지 여부
let isProcessingQueue = false;

/**
 * 실행 큐에 스케줄 추가
 * - 동일한 시간에 여러 스케줄이 트리거되어도 순차적으로 실행됨
 * - 최소 간격 체크로 연속 트리거 방지
 */
function enqueueSchedule(scheduleId: string): void {
  // 이미 큐에 있거나 실행 중이면 스킵
  if (executionQueue.includes(scheduleId) || currentlyExecuting === scheduleId) {
    console.log(`[Scheduler] 이미 큐에 있거나 실행 중, 스킵: ${scheduleId}`);
    return;
  }
  
  // 최소 간격 체크 (동시 트리거 방지)
  const now = Date.now();
  const timeSinceLastExecution = now - lastScheduleExecutionTime;
  if (timeSinceLastExecution < MIN_SCHEDULE_INTERVAL_MS && executionQueue.length > 0) {
    console.log(`[Scheduler] ⏳ 최소 간격 미충족 (${Math.round(timeSinceLastExecution / 1000)}초), 지연 추가`);
  }
  
  executionQueue.push(scheduleId);
  console.log(`[Scheduler] 📋 큐에 추가: ${scheduleId} (대기 중: ${executionQueue.length}개)`);
  
  // 큐 처리 시작 (비동기로 실행하여 이벤트 루프 차단 방지)
  setImmediate(() => processQueue());
}

/**
 * 타임아웃이 있는 Promise 래퍼
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
}

/**
 * 재시도 로직이 포함된 스케줄 실행
 */
async function executeScheduleWithRetry(scheduleId: string): Promise<void> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= MAX_RETRY_COUNT; attempt++) {
    try {
      console.log(`[Scheduler] 🔄 실행 시도 ${attempt}/${MAX_RETRY_COUNT}: ${scheduleId}`);
      
      // 타임아웃이 있는 실행
      await withTimeout(
        executeSchedule(scheduleId),
        SCHEDULE_TIMEOUT_MS,
        `스케줄 실행 타임아웃 (${SCHEDULE_TIMEOUT_MS / 60000}분 초과)`
      );
      
      // 성공 시 리턴
      return;
      
    } catch (err: any) {
      lastError = err;
      console.error(`[Scheduler] ❌ 실행 실패 (시도 ${attempt}/${MAX_RETRY_COUNT}): ${err.message}`);
      
      // 마지막 시도가 아니면 재시도 대기
      if (attempt < MAX_RETRY_COUNT) {
        console.log(`[Scheduler] ⏳ ${RETRY_DELAY_MS / 1000}초 후 재시도...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }
  
  // 모든 재시도 실패
  console.error(`[Scheduler] ❌ 최대 재시도 횟수 초과: ${scheduleId}`);
  throw lastError;
}

/**
 * 큐에서 스케줄을 순차적으로 처리
 * - 타임아웃 및 재시도 로직 포함
 * - 이벤트 루프 차단 최소화
 */
async function processQueue(): Promise<void> {
  // 이미 처리 중이면 리턴 (중복 처리 방지)
  if (isProcessingQueue) return;
  
  isProcessingQueue = true;
  
  while (executionQueue.length > 0) {
    const scheduleId = executionQueue.shift()!;
    currentlyExecuting = scheduleId;
    lastScheduleExecutionTime = Date.now();
    
    console.log(`[Scheduler] ▶️ 큐에서 실행 시작: ${scheduleId} (남은 대기: ${executionQueue.length}개)`);
    
    try {
      // 재시도 로직이 포함된 실행
      await executeScheduleWithRetry(scheduleId);
    } catch (err: any) {
      console.error(`[Scheduler] ❌ 큐 처리 최종 실패 (${scheduleId}): ${err.message}`);
      
      // 실패한 스케줄 상태 업데이트
      try {
        const data = readScraperSchedules();
        const runningRun = data.runs.find(
          (r) => r.schedule_id === scheduleId && r.status === "running"
        );
        if (runningRun) {
          const nextRuns = data.runs.map((r) => {
            if (r.run_id !== runningRun.run_id) return r;
            return {
              ...r,
              finished_at: new Date().toISOString(),
              status: "failed" as const,
              summary: `실행 실패: ${err.message}`,
            };
          });
          writeScraperSchedules({ schedules: data.schedules, runs: nextRuns });
        }
      } catch (saveErr) {
        console.error(`[Scheduler] 상태 업데이트 실패:`, saveErr);
      }
    }
    
    currentlyExecuting = null;
    
    // 다음 스케줄 실행 전 잠시 대기 (서버 안정성 + 이벤트 루프 양보)
    if (executionQueue.length > 0) {
      const waitTime = Math.max(5000, MIN_SCHEDULE_INTERVAL_MS);
      console.log(`[Scheduler] ⏳ 다음 스케줄 실행까지 ${waitTime / 1000}초 대기...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
  
  isProcessingQueue = false;
  console.log(`[Scheduler] ✓ 모든 대기 스케줄 처리 완료`);
}

/**
 * 스케줄러 초기화 (서버 시작 시 호출)
 */
export function initializeScheduler(): void {
  if (isInitialized) {
    console.log("[Scheduler] 이미 초기화됨, 스킵");
    return;
  }

  console.log("[Scheduler] 스케줄러 초기화 시작...");

  try {
    // 오래된 running 상태 정리
    cleanupStuckRuns();

    const data = readScraperSchedules();
    const enabledSchedules = data.schedules.filter((s) => s.enabled);

    console.log(`[Scheduler] 활성화된 스케줄: ${enabledSchedules.length}개`);

    for (const schedule of enabledSchedules) {
      registerCronJob(schedule);
    }

    // 설정 파일 무결성 주기적 체크 (매 6시간)
    cron.schedule("0 */6 * * *", () => {
      verifyConfigIntegrity();
    });

    isInitialized = true;
    console.log("[Scheduler] 스케줄러 초기화 완료 ✓");
  } catch (err) {
    console.error("[Scheduler] 초기화 실패:", err);
  }
}

/**
 * 설정 파일 무결성 검증 — data-defaults 에서 복원
 * Railway 볼륨 유실 시 스케줄러가 자동으로 감지하여 서비스 중단을 방지한다.
 */
function verifyConfigIntegrity(): void {
  const fs = require("node:fs") as typeof import("node:fs");
  const pathMod = require("node:path") as typeof import("node:path");

  const cwd = process.cwd();
  const dataDefaultsDir = pathMod.join(cwd, "data-defaults");
  if (!fs.existsSync(dataDefaultsDir)) return;

  const dataDir = pathMod.join(cwd, "data");
  const CONFIG_FILES = [
    "scraper-targets.json",
    "scraper-schedules.json",
    "embedding-settings.json",
    "model-mappings.json",
    "download-settings.json",
    "users.json",
  ];

  let restored = 0;
  for (const file of CONFIG_FILES) {
    const src = pathMod.join(dataDefaultsDir, file);
    const dest = pathMod.join(dataDir, file);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
        fs.copyFileSync(src, dest);
        restored++;
        console.warn(`[Integrity] 누락 파일 복원: ${file}`);
      } catch (e) {
        console.error(`[Integrity] 복원 실패: ${file}`, e);
      }
    }
  }

  if (restored > 0) {
    console.warn(`[Integrity] ${restored}개 설정 파일 복원 완료`);
  }
}

/**
 * 오래된 running 상태 정리 (30분 이상 running 상태면 failed로 변경)
 */
function cleanupStuckRuns(): void {
  try {
    const data = readScraperSchedules();
    const now = Date.now();
    const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30분

    let hasChanges = false;
    const updatedRuns = data.runs.map((run) => {
      if (run.status === "running") {
        const startedAt = new Date(run.started_at).getTime();
        const elapsed = now - startedAt;

        if (elapsed > STUCK_THRESHOLD_MS) {
          console.log(`[Scheduler] ⚠️ Stuck run 정리: ${run.run_id} (${Math.round(elapsed / 60000)}분 경과)`);
          hasChanges = true;
          return {
            ...run,
            status: "failed" as const,
            finished_at: new Date().toISOString(),
            summary: "서버 재시작으로 인해 자동 정리됨 (실행 시간 초과)",
          };
        }
      }
      return run;
    });

    if (hasChanges) {
      writeScraperSchedules({
        schedules: data.schedules,
        runs: updatedRuns,
      });
    }
  } catch (err) {
    console.error("[Scheduler] Stuck run 정리 실패:", err);
  }
}

/**
 * 특정 스케줄에 대한 cron job 등록
 */
function registerCronJob(schedule: ScraperSchedule): void {
  const { schedule_id, name, cron: cronExpression, timezone } = schedule;

  // 기존 job이 있으면 제거
  if (scheduledJobs.has(schedule_id)) {
    scheduledJobs.get(schedule_id)?.stop();
    scheduledJobs.delete(schedule_id);
  }

  // cron 표현식 유효성 검사
  if (!cron.validate(cronExpression)) {
    console.error(`[Scheduler] 유효하지 않은 cron 표현식: ${cronExpression} (${name})`);
    return;
  }

  // cron job 생성 (큐에 추가하여 순차 실행)
  const job = cron.schedule(
    cronExpression,
    () => {
      console.log(`[Scheduler] ⏰ 자동 스크래핑 트리거: ${name} (${schedule_id})`);
      // 직접 실행 대신 큐에 추가 → 동시 트리거된 스케줄도 순차 실행
      enqueueSchedule(schedule_id);
    },
    {
      scheduled: true,
      timezone: timezone || "Asia/Seoul",
    }
  );

  scheduledJobs.set(schedule_id, job);

  // 다음 실행 시간 계산 (로그용)
  const nextRunInfo = getNextRunTime(cronExpression, timezone);
  console.log(`[Scheduler] ✓ 등록: ${name} (${cronExpression}) - 다음 실행: ${nextRunInfo}`);
}

/**
 * 다음 실행 시간 계산 (대략적)
 */
function getNextRunTime(cronExpression: string, timezone?: string): string {
  try {
    // node-cron은 다음 실행 시간 계산 기능이 없으므로 현재 시간 기준으로 표시
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timezone || "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    };
    return `스케줄 설정됨 (현재: ${now.toLocaleString("ko-KR", options)})`;
  } catch {
    return "알 수 없음";
  }
}

/**
 * 스케줄 실행 (cron에서 호출)
 */
async function executeSchedule(scheduleId: string): Promise<void> {
  const data = readScraperSchedules();
  const schedule = data.schedules.find((s) => s.schedule_id === scheduleId);

  if (!schedule) {
    console.error(`[Scheduler] 스케줄을 찾을 수 없음: ${scheduleId}`);
    return;
  }

  if (!schedule.enabled) {
    console.log(`[Scheduler] 비활성화된 스케줄, 스킵: ${schedule.name}`);
    return;
  }

  // ⏰ 기간 제한 스케줄인 경우, 해당 기간 내인지 먼저 확인
  const today = new Date().toISOString().split("T")[0];
  const targetsData = readScraperTargets();
  const boardIds = Array.isArray(schedule.targets) ? schedule.targets : [];
  
  // 모든 대상 보드의 기간 체크
  let allOutOfPeriod = true;
  for (const boardId of boardIds) {
    const board = targetsData.boards.find((b) => b.board_id === boardId);
    if (!board) continue;
    
    const config = board.schedule_config;
    // scheduleMode가 "period"가 아니거나 config가 없으면 기간 제한 없음
    if (!config || config.scheduleMode !== "period") {
      allOutOfPeriod = false;
      break;
    }
    
    const startDate = config.startDate;
    const endDate = config.endDate;
    
    // 기간 내인지 확인
    const isWithin = (!startDate || today >= startDate) && (!endDate || today <= endDate);
    if (isWithin) {
      allOutOfPeriod = false;
      break;
    }
  }
  
  // 모든 보드가 기간 외면 조용히 스킵 (로그 최소화, 실행 기록 저장 안 함)
  if (allOutOfPeriod && boardIds.length > 0) {
    console.log(`[Scheduler] 📅 기간 외 스킵: ${schedule.name} (오늘: ${today})`);
    return;
  }

  // 중복 실행 방지
  const hasRunning = data.runs.some(
    (r) => r.schedule_id === scheduleId && r.status === "running"
  );
  if (hasRunning) {
    console.log(`[Scheduler] 이미 실행 중, 스킵: ${schedule.name}`);
    return;
  }

  const startedAt = new Date();
  const run: ScraperRun = {
    run_id: makeRunId(),
    schedule_id: scheduleId,
    triggered_by: "cron",
    started_at: startedAt.toISOString(),
    status: "running",
    summary: "자동 스크래핑 실행 중...",
  };

  // 실행 기록 저장
  writeScraperSchedules({
    schedules: data.schedules,
    runs: [run, ...data.runs].slice(0, 5000),
  });

  console.log(`[Scheduler] 실행 시작: ${schedule.name} (run_id: ${run.run_id})`);

  // 스크래핑 실행
  try {
    const result = await runScheduleScraping(schedule, run, startedAt);
    console.log(`[Scheduler] 실행 완료: ${schedule.name} - ${result.summary}`);
  } catch (err: any) {
    console.error(`[Scheduler] ❌ 스크래핑 실행 중 치명적 오류 발생:`);
    console.error(`[Scheduler]    에러: ${err.message}`);
    console.error(`[Scheduler]    스택: ${err.stack}`);

    // 실행 상태를 failed로 업데이트
    try {
      const data2 = readScraperSchedules();
      const nextRuns = data2.runs.map((r) => {
        if (r.run_id !== run.run_id) return r;
        return {
          ...r,
          finished_at: new Date().toISOString(),
          status: "failed" as const,
          summary: `치명적 오류: ${err.message}`,
        };
      });

      writeScraperSchedules({
        schedules: data2.schedules,
        runs: nextRuns,
      });
      console.log(`[Scheduler] 실행 상태를 failed로 업데이트 완료`);
    } catch (saveErr: any) {
      console.error(`[Scheduler] 실행 상태 업데이트 실패:`, saveErr.message);
    }
  }
}

/**
 * 즉시 실행 API를 호출하여 SSE 스트림 결과를 파싱
 * - 웹 스크래핑: /api/scraper/execute/instant/stream 호출
 * - API 스크래핑: /api/scraper/execute/instant/api/stream 호출
 * 
 * @param boardId 보드 ID
 * @param isApiMode true면 API 스크래핑, false면 웹 스크래핑
 */
interface ScrapeResult {
  success: boolean;
  articlesCount: number;
  attachmentsDownloaded: number;
  attachmentsFailed: number;
  jsonPath?: string;
  xlsxPath?: string;
  errors: string[];
}

async function callInstantScrapeApi(boardId: string, isApiMode: boolean = false): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    success: false,
    articlesCount: 0,
    attachmentsDownloaded: 0,
    attachmentsFailed: 0,
    errors: [],
  };
  
  try {
    // 내부 API 호출 (Next.js 서버 내부에서 호출)
    // mode=auto: 자동 스크래핑 모드 (basePath + 폴더 구조 규칙 적용)
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    
    // 보드 모드에 따라 적절한 API 엔드포인트 선택
    const apiPath = isApiMode 
      ? `/api/scraper/execute/instant/api/stream`  // API 스크래핑용
      : `/api/scraper/execute/instant/stream`;      // 웹 스크래핑용
    
    const apiUrl = `${baseUrl}${apiPath}?board_id=${encodeURIComponent(boardId)}&mode=auto`;
    
    console.log(`[Scheduler]      API 호출 (${isApiMode ? 'API모드' : '웹모드'}): ${apiUrl}`);
    
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "Accept": "text/event-stream",
      },
    });
    
    if (!response.ok) {
      throw new Error(`API 응답 오류: HTTP ${response.status}`);
    }
    
    if (!response.body) {
      throw new Error("응답 본문 없음");
    }
    
    // SSE 스트림 읽기
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        break;
      }
      
      buffer += decoder.decode(value, { stream: true });
      
      // 라인별로 SSE 이벤트 파싱
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // 마지막 불완전한 라인은 버퍼에 유지
      
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const eventData = JSON.parse(line.slice(6));
            
            // 로그 출력 (일부만)
            if (eventData.type === "log") {
              // 중요 로그만 출력
              const msg = eventData.message || "";
              if (msg.includes("✅") || msg.includes("✗") || msg.includes("⚠️") || 
                  msg.includes("수집 대상") || msg.includes("저장 완료") ||
                  msg.includes("다운로드 완료") || msg.includes("다운로드 실패") ||
                  msg.includes("API") || msg.includes("법령")) {
                console.log(`[Scheduler]      ${msg}`);
              }
            }
            
            // 완료 이벤트에서 결과 추출
            // stream/route.ts에서 { type: "complete", data: { articlesCount, attachmentsCount, ... } } 형태로 전송
            // api/stream/route.ts에서 { type: "complete", data: { dataCount, ... } } 형태로 전송
            if (eventData.type === "complete") {
              const data = eventData.data || eventData;
              result.success = data.success ?? true;
              // 웹 스크래핑: articlesCount, API 스크래핑: dataCount
              result.articlesCount = data.articlesCount ?? data.dataCount ?? data.articles ?? 0;
              result.attachmentsDownloaded = data.attachmentsCount ?? data.attachments_downloaded ?? 0;
              result.attachmentsFailed = data.attachmentsFailed ?? data.attachments_failed ?? 0;
              result.jsonPath = data.jsonPath ?? data.json_path;
              result.xlsxPath = data.xlsxPath ?? data.xlsx_path;
              
              console.log(`[Scheduler]      ✓ 완료: ${result.articlesCount}건 수집${result.attachmentsDownloaded > 0 ? `, ${result.attachmentsDownloaded}건 첨부파일` : ''}`);
            }
            
            // 오류 이벤트
            if (eventData.type === "error") {
              const errMsg = eventData.message || "알 수 없는 오류";
              result.errors.push(errMsg);
              console.log(`[Scheduler]      ✗ 오류: ${errMsg}`);
            }
            
          } catch {
            // JSON 파싱 실패 - 무시
          }
        }
      }
    }
    
    // 스트림 완료 후 성공 여부 결정
    if (result.articlesCount > 0 || result.attachmentsDownloaded > 0) {
      result.success = true;
    }
    
  } catch (err: any) {
    result.errors.push(err.message);
    console.error(`[Scheduler]      ✗ API 호출 실패: ${err.message}`);
  }
  
  return result;
}

/**
 * 실제 스크래핑 로직 실행
 * - 즉시 실행 API를 내부적으로 호출하여 동일한 로직 사용
 */
async function runScheduleScraping(
  schedule: ScraperSchedule,
  run: ScraperRun,
  startedAt: Date
): Promise<{ summary: string; status: "success" | "failed" }> {
  console.log(`[Scheduler] ══════════════════════════════════════════`);
  console.log(`[Scheduler] 🔄 runScheduleScraping 시작`);
  console.log(`[Scheduler]    스케줄: ${schedule.name}`);
  console.log(`[Scheduler]    대상 보드: ${schedule.targets.join(", ")}`);
  console.log(`[Scheduler]    ⚡ 즉시 실행 API와 동일한 로직 사용`);
  console.log(`[Scheduler] ══════════════════════════════════════════`);

  let targetsData;
  try {
    targetsData = readScraperTargets();
    console.log(`[Scheduler] ✓ 타겟 데이터 로드 완료: ${targetsData.boards.length}개 보드, ${targetsData.orgs.length}개 기관`);
  } catch (err: any) {
    console.error(`[Scheduler] ✗ 타겟 데이터 로드 실패:`, err.message);
    return { summary: `타겟 데이터 로드 실패: ${err.message}`, status: "failed" };
  }

  const boardsById = new Map(targetsData.boards.map((b) => [b.board_id, b] as const));

  const boardIds = Array.isArray(schedule.targets) ? schedule.targets : [];
  const orgIds = Array.isArray(schedule.org_ids) ? schedule.org_ids : [];

  console.log(`[Scheduler]    boardIds: ${JSON.stringify(boardIds)}`);
  console.log(`[Scheduler]    orgIds: ${JSON.stringify(orgIds)}`);

  const today = startedAt.toISOString().split("T")[0];

  const isWithinPeriod = (board: Board): boolean => {
    const config = board.schedule_config;
    if (!config || config.scheduleMode !== "period") return true;

    const startDate = config.startDate;
    const endDate = config.endDate;

    if (startDate && today < startDate) return false;
    if (endDate && today > endDate) return false;

    return true;
  };

  // 대상 보드 필터링
  const boards = boardIds
    .map((id) => boardsById.get(id))
    .filter((b): b is Board => b !== undefined)
    .filter((b) => (orgIds.length ? orgIds.includes(b.org_id) : true))
    .filter(isWithinPeriod);

  console.log(`[Scheduler] 📋 대상 보드 목록: ${boards.length}개`);
  boards.forEach((b, i) => {
    console.log(`[Scheduler]    ${i + 1}. ${b.board_name} (${b.board_id})`);
  });

  if (boards.length === 0) {
    console.log(`[Scheduler] ⚠️ 처리할 보드가 없습니다!`);
    return { summary: "처리할 보드 없음", status: "failed" };
  }

  let totalScraped = 0;
  let totalAttachments = 0;
  let totalFailed = 0;
  let boardsProcessed = 0;
  const errors: string[] = [];

  // 각 보드에 대해 즉시 실행 API 호출
  for (const board of boards) {
    console.log(`[Scheduler] ──────────────────────────────────────────`);
    console.log(`[Scheduler] 📰 보드 처리: ${board.board_name} (${board.board_id})`);

    // 보드 모드 확인 (API 모드 vs 웹 스크래핑 모드)
    const boardMode = (board as Record<string, unknown>).board_mode as string | undefined;
    const accessMode = (board as Record<string, unknown>).access_mode as string | undefined;
    const isApiMode = boardMode === "api" || accessMode === "api";
    const apiConfig = (board as Record<string, unknown>).api_config;
    
    console.log(`[Scheduler]    모드: ${isApiMode ? 'API 스크래핑' : '웹 스크래핑'}`);
    
    // 모드별 필수 설정 검증
    if (isApiMode) {
      // API 모드: api_config가 필요
      if (!apiConfig) {
        console.log(`[Scheduler]    ✗ API 설정(api_config) 없음, 스킵`);
        errors.push(`${board.board_name}: API 설정 불완전`);
        totalFailed++;
        continue;
      }
    } else {
      // 웹 스크래핑 모드: list_url과 web_config가 필요
      if (!board.list_url || !board.web_config) {
        console.log(`[Scheduler]    ✗ 웹 스크래핑 설정(list_url, web_config) 없음, 스킵`);
        errors.push(`${board.board_name}: 설정 불완전`);
        totalFailed++;
        continue;
      }
    }

    try {
      const scraperStartTime = Date.now();
      
      // 모드에 따라 적절한 API 호출
      const result = await callInstantScrapeApi(board.board_id, isApiMode);
      
      const scraperDuration = Date.now() - scraperStartTime;
      console.log(`[Scheduler]    완료: ${result.articlesCount}건 수집, ${result.attachmentsDownloaded}건 다운로드 (${Math.round(scraperDuration / 1000)}초)`);

      totalScraped += result.articlesCount;
      totalAttachments += result.attachmentsDownloaded;
      
      if (result.attachmentsFailed > 0) {
        console.log(`[Scheduler]    ⚠️ 첨부파일 다운로드 실패: ${result.attachmentsFailed}건`);
      }
      
      if (result.success) {
        boardsProcessed++;
      } else {
        totalFailed++;
        if (result.errors.length > 0) {
          errors.push(`${board.board_name}: ${result.errors.slice(0, 2).join(", ")}`);
        }
      }

    } catch (err: any) {
      console.error(`[Scheduler]    ✗ 실패: ${err.message}`);
      errors.push(`${board.board_name}: ${err.message}`);
      totalFailed++;
    }

    // 보드 간 딜레이
    if (boards.indexOf(board) < boards.length - 1) {
      console.log(`[Scheduler]    ⏳ 다음 보드까지 1초 대기...`);
      await sleep(1000);
    }
  }

  console.log(`[Scheduler] ──────────────────────────────────────────`);
  console.log(`[Scheduler] 📊 모든 보드 처리 완료`);
  console.log(`[Scheduler]    총 수집: ${totalScraped}건`);
  console.log(`[Scheduler]    총 첨부파일: ${totalAttachments}건`);
  console.log(`[Scheduler]    실패 보드: ${totalFailed}개`);
  console.log(`[Scheduler]    성공 보드: ${boardsProcessed}/${boards.length}`);

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const finalStatus: ScraperRun["status"] =
    totalFailed > 0 && boardsProcessed === 0 ? "failed" : "success";

  // 결과 요약 생성
  let summary = `스크래핑 완료: ${totalScraped}건 수집, ${totalAttachments}건 다운로드`;
  if (totalFailed > 0) {
    summary += `, ${totalFailed}개 보드 실패`;
  }
  summary += ` (${boardsProcessed}/${boards.length} 보드, ${Math.round(durationMs / 1000)}초)`;

  // 결과 저장
  try {
    const data2 = readScraperSchedules();
    const nextRuns = data2.runs.map((r) => {
      if (r.run_id !== run.run_id) return r;

      return {
        ...r,
        finished_at: finishedAt.toISOString(),
        status: finalStatus,
        summary,
        metrics: {
          new_records: totalScraped,
          skipped_duplicates: 0,
          failed_records: totalFailed,
          duration_ms: durationMs,
        },
      } satisfies ScraperRun;
    });

    writeScraperSchedules({
      schedules: data2.schedules,
      runs: nextRuns,
    });
    console.log(`[Scheduler] ✓ 실행 결과 저장 완료`);
  } catch (saveErr: any) {
    console.error(`[Scheduler] ✗ 실행 결과 저장 실패:`, saveErr.message);
  }

  console.log(`[Scheduler] ══════════════════════════════════════════`);
  console.log(`[Scheduler] ✅ 완료: ${summary}`);
  console.log(`[Scheduler] ══════════════════════════════════════════`);

  return { summary, status: finalStatus };
}

// ============================================================
// 동적 스케줄 관리 API
// ============================================================

/**
 * 스케줄 추가/업데이트
 */
export function updateScheduleJob(schedule: ScraperSchedule): void {
  if (schedule.enabled) {
    registerCronJob(schedule);
  } else {
    removeScheduleJob(schedule.schedule_id);
  }
}

/**
 * 스케줄 제거
 */
export function removeScheduleJob(scheduleId: string): void {
  const job = scheduledJobs.get(scheduleId);
  if (job) {
    job.stop();
    scheduledJobs.delete(scheduleId);
    console.log(`[Scheduler] 스케줄 제거됨: ${scheduleId}`);
  }
}

/**
 * 모든 스케줄 다시 로드
 */
export function reloadAllSchedules(): void {
  console.log("[Scheduler] 모든 스케줄 다시 로드...");

  // 기존 모든 job 중지
  for (const [id, job] of scheduledJobs) {
    job.stop();
    scheduledJobs.delete(id);
  }

  // 스케줄 다시 로드
  const data = readScraperSchedules();
  const enabledSchedules = data.schedules.filter((s) => s.enabled);

  for (const schedule of enabledSchedules) {
    registerCronJob(schedule);
  }

  console.log(`[Scheduler] ${enabledSchedules.length}개 스케줄 다시 로드 완료`);
}

/**
 * 현재 등록된 스케줄 목록 조회
 */
export function getRegisteredSchedules(): string[] {
  return Array.from(scheduledJobs.keys());
}

/**
 * 스케줄러 상태 조회
 */
export function getSchedulerStatus(): {
  initialized: boolean;
  registeredCount: number;
  schedules: string[];
} {
  return {
    initialized: isInitialized,
    registeredCount: scheduledJobs.size,
    schedules: Array.from(scheduledJobs.keys()),
  };
}

// ============================================================
// 유틸리티
// ============================================================

function makeRunId(): string {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const rand = Math.random().toString(36).slice(2, 8);
  return `run_${ts}_${rand}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
