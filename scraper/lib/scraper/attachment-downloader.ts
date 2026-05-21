/**
 * 첨부파일 다운로더 엔진
 * 
 * MVP 기능:
 * 1. 기본 저장 경로
 * 2. 폴더 구조 규칙
 * 3. 최대 재시도 횟수 (3회)
 * 4. 타임아웃 (60초)
 * 5. 중복 파일 처리 (건너뛰기)
 * 6. 동시 다운로드 수 (2개)
 */

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { storage } from "@/lib/storage";
import {
  readDownloadSettings,
  buildFilePath,
  handleDuplicate,
  isAllowedExtension,
  checkStorageSpace,
  runAutoCleanup,
  formatBytes,
  type DownloadSettings,
  type StorageCheckResult,
  type CleanupResult,
} from "./download-settings";
import {
  getDbAsync,
  updateAttachmentStatus,
  getPendingAttachments,
  type AttachmentRecord,
} from "./scraper-db";

// ============================================================
// 타입 정의
// ============================================================

export interface DownloadResult {
  fileId: string;
  success: boolean;
  localPath?: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

export interface BatchDownloadResult {
  total: number;
  downloaded: number;
  skipped: number;
  failed: number;
  results: DownloadResult[];
  errors: string[];
  warnings: string[];
  storageCheck?: StorageCheckResult;
  cleanup?: CleanupResult;
}

export interface DownloadProgress {
  current: number;
  total: number;
  currentFile: string;
  status: "downloading" | "done" | "error";
}

// ============================================================
// 유틸리티
// ============================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 파일 확장자 추출
 */
function getExtension(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase().replace(".", "");
  return ext || "unknown";
}

/**
 * 파일 다운로드 (단일 파일)
 */
async function downloadFile(
  url: string,
  destPath: string,
  settings: DownloadSettings
): Promise<void> {
  const { retry, network } = settings;
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
    if (attempt > 0) {
      // 재시도 대기
      const waitTime = retry.useExponentialBackoff
        ? retry.retryIntervalSec * Math.pow(2, attempt - 1) * 1000
        : retry.retryIntervalSec * 1000;
      await delay(waitTime);
    }
    
    try {
      await downloadWithTimeout(url, destPath, settings);
      return; // 성공
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      
      // 마지막 시도가 아니면 계속
      if (attempt < retry.maxRetries) {
        continue;
      }
    }
  }
  
  throw lastError || new Error("Download failed");
}

/**
 * 타임아웃 적용 다운로드
 */
function downloadWithTimeout(
  url: string,
  destPath: string,
  settings: DownloadSettings
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = settings.retry.timeoutSec * 1000;
    let timeoutId: NodeJS.Timeout | null = null;
    
    // 디렉토리 생성
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // HTTP/HTTPS 선택
    const isHttps = url.startsWith("https://");
    const protocol = isHttps ? https : http;
    
    // 요청 옵션
    const urlObj = new URL(url);
    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: {
        "User-Agent": settings.network.customUserAgent,
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate",
      },
      timeout,
    };
    
    // Referer 설정 (더 상세하게)
    if (settings.network.autoReferer) {
      // 실제 웹 브라우저처럼 전체 도메인을 Referer로 설정
      options.headers!["Referer"] = `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}`;
      options.headers!["Origin"] = `${urlObj.protocol}//${urlObj.hostname}`;
    }
    
    // SSL 검증 우회
    if (isHttps && settings.network.skipSslVerification) {
      (options as https.RequestOptions).rejectUnauthorized = false;
    }
    
    const req = protocol.request(options, (res) => {
      // 리다이렉트 처리
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (timeoutId) clearTimeout(timeoutId);
        downloadWithTimeout(res.headers.location, destPath, settings)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      
      // Content-Type 확인 (HTML 응답이면 실패 처리)
      const contentType = res.headers["content-type"] || "";
      if (contentType.includes("text/html")) {
        reject(new Error("서버가 HTML 응답 반환 (세션/인증 필요)"));
        return;
      }
      
      const writeStream = fs.createWriteStream(destPath);
      res.pipe(writeStream);
      
      writeStream.on("finish", () => {
        if (timeoutId) clearTimeout(timeoutId);
        writeStream.close();
        
        // 다운로드된 파일이 HTML인지 확인 (Content-Type이 정확하지 않은 경우 대비)
        try {
          const fileContent = fs.readFileSync(destPath, { encoding: "utf-8", flag: "r" });
          const firstBytes = fileContent.slice(0, 100).toLowerCase();
          if (firstBytes.includes("<!doctype") || firstBytes.includes("<html")) {
            fs.unlinkSync(destPath);
            reject(new Error("다운로드된 파일이 HTML 페이지 (세션/인증 필요)"));
            return;
          }
        } catch {
          // 바이너리 파일인 경우 읽기 실패 - 정상
        }
        
        resolve();
      });
      
      writeStream.on("error", (err) => {
        if (timeoutId) clearTimeout(timeoutId);
        fs.unlink(destPath, () => {}); // 실패한 파일 삭제
        reject(err);
      });
    });
    
    req.on("error", (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(err);
    });
    
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Timeout after ${settings.retry.timeoutSec}s`));
    });
    
    // 전체 타임아웃
    timeoutId = setTimeout(() => {
      req.destroy();
      reject(new Error(`Timeout after ${settings.retry.timeoutSec}s`));
    }, timeout);
    
    req.end();
  });
}

// ============================================================
// 동시 다운로드 제어 (Semaphore)
// ============================================================

class DownloadSemaphore {
  private current = 0;
  private queue: (() => void)[] = [];
  
  constructor(private max: number) {}
  
  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }
  
  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) {
      this.current++;
      next();
    }
  }
}

// ============================================================
// 메인 다운로드 함수
// ============================================================

/**
 * 단일 첨부파일 다운로드
 */
/**
 * 파일명에서 크기 정보 제거 및 정규화
 */
function normalizeFileName(fileName: string): string {
  return fileName
    .replace(/\s*\([^)]*[KMG]B\)\s*$/i, "")  // (123.2 KB) 형태
    .replace(/\s*\[[^\]]*[KMG]B\]\s*$/i, "") // [123.2 KB] 형태
    .replace(/\s+/g, " ")
    .trim();
}

export async function downloadAttachment(
  attachment: AttachmentRecord,
  orgId: string,
  boardId: string,
  publishedDate?: string,
  settingsOverride?: Partial<DownloadSettings>
): Promise<DownloadResult> {
  const settings = { ...readDownloadSettings(), ...settingsOverride };
  
  // 파일명 정규화 (크기 정보 제거)
  const normalizedFileName = normalizeFileName(attachment.file_name);
  
  try {
    // 확장자 체크
    const ext = getExtension(normalizedFileName);
    if (!isAllowedExtension(normalizedFileName, settings.fileManagement.allowedExtensions)) {
      await updateAttachmentStatus(attachment.file_id, "failed");
      return {
        fileId: attachment.file_id,
        success: false,
        skipped: true,
        skipReason: `확장자 제외: .${ext}`,
      };
    }
    
    // 파일 크기 체크 (헤더에서 Content-Length 확인 - 선택사항)
    // 여기서는 다운로드 후 확인
    
    // 저장 경로 생성 (정규화된 파일명 사용)
    const destPath = buildFilePath(
      settings,
      orgId,
      boardId,
      attachment.doc_id,
      normalizedFileName,
      publishedDate
    );
    
    // 중복 파일 처리
    const { shouldDownload, finalPath } = handleDuplicate(
      destPath,
      settings.fileManagement.duplicateHandling
    );
    
    if (!shouldDownload) {
      // 이미 존재하고 건너뛰기
      await updateAttachmentStatus(attachment.file_id, "downloaded", finalPath);
      return {
        fileId: attachment.file_id,
        success: true,
        localPath: finalPath,
        skipped: true,
        skipReason: "이미 존재",
      };
    }
    
    // 다운로드 실행
    await downloadFile(attachment.download_url, finalPath, settings);
    
    // 파일 크기 체크
    const stats = fs.statSync(finalPath);
    const fileSizeMb = stats.size / (1024 * 1024);
    
    if (settings.fileManagement.maxFileSizeMb > 0 && fileSizeMb > settings.fileManagement.maxFileSizeMb) {
      // 파일 크기 초과 - 삭제
      fs.unlinkSync(finalPath);
      await updateAttachmentStatus(attachment.file_id, "failed");
      return {
        fileId: attachment.file_id,
        success: false,
        error: `파일 크기 초과: ${fileSizeMb.toFixed(1)}MB > ${settings.fileManagement.maxFileSizeMb}MB`,
      };
    }
    
    // R2 모드: 다운로드된 파일을 R2에 업로드
    if (storage.backend === "r2") {
      try {
        // 로컬 경로에서 R2 키 생성 (save/ScrapingData/... → ScrapingData/...)
        const cwd = process.cwd();
        let r2Key = path.relative(cwd, finalPath).replace(/\\/g, "/");
        if (r2Key.startsWith("save/")) {
          r2Key = r2Key.slice(5); // "save/" 제거
        }
        const fileBuffer = fs.readFileSync(finalPath);
        await storage.upload(r2Key, fileBuffer);
        // 로컬 임시 파일 삭제 (R2에 저장 완료)
        fs.unlinkSync(finalPath);
      } catch (r2Err) {
        console.error(`[R2 Upload] 실패, 로컬 파일 유지: ${r2Err}`);
        // R2 업로드 실패해도 로컬 파일은 유지
      }
    }
    
    // 성공
    await updateAttachmentStatus(attachment.file_id, "downloaded", finalPath);
    return {
      fileId: attachment.file_id,
      success: true,
      localPath: finalPath,
    };
    
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await updateAttachmentStatus(attachment.file_id, "failed");
    return {
      fileId: attachment.file_id,
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * 배치 다운로드 (대기 중인 모든 첨부파일)
 */
export async function downloadPendingAttachments(
  onProgress?: (progress: DownloadProgress) => void,
  settingsOverride?: Partial<DownloadSettings>
): Promise<BatchDownloadResult> {
  // DB 초기화
  await getDbAsync();
  
  const settings = { ...readDownloadSettings(), ...settingsOverride };
  const pendingFiles = await getPendingAttachments(1000);
  
  const warnings: string[] = [];
  let storageCheck: StorageCheckResult | undefined;
  let cleanup: CleanupResult | undefined;
  
  if (pendingFiles.length === 0) {
    return {
      total: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
      results: [],
      errors: [],
      warnings: [],
    };
  }
  
  // 저장 공간 체크 (다운로드 전)
  const basePath = settings.path.basePath;
  storageCheck = await checkStorageSpace(basePath, settings.storage);
  
  if (storageCheck.warning) {
    warnings.push(storageCheck.warning);
  }
  
  // 저장 공간 부족 시 자동 정리 실행
  if (!storageCheck.canProceed || storageCheck.warning) {
    if (settings.storage.autoCleanupEnabled && settings.storage.autoCleanupDays > 0) {
      console.log(`[Storage] Running auto-cleanup (files older than ${settings.storage.autoCleanupDays} days)...`);
      cleanup = runAutoCleanup(basePath, settings.storage.autoCleanupDays);
      
      if (cleanup.deletedFiles > 0) {
        warnings.push(`🧹 자동 정리: ${cleanup.deletedFiles}개 파일 삭제 (${formatBytes(cleanup.deletedSize)} 확보)`);
        
        // 정리 후 다시 저장 공간 체크
        storageCheck = await checkStorageSpace(basePath, settings.storage);
      }
      
      if (cleanup.errors.length > 0) {
        warnings.push(`자동 정리 중 오류: ${cleanup.errors.join(", ")}`);
      }
    }
  }
  
  // 저장 공간 부족으로 진행 불가
  if (!storageCheck.canProceed) {
    return {
      total: pendingFiles.length,
      downloaded: 0,
      skipped: pendingFiles.length,
      failed: 0,
      results: [],
      errors: [storageCheck.error || "저장 공간 부족으로 다운로드를 중단합니다."],
      warnings,
      storageCheck,
      cleanup,
    };
  }
  
  const results: DownloadResult[] = [];
  const errors: string[] = [];
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  
  // 동시 다운로드 제어
  const semaphore = new DownloadSemaphore(settings.fileManagement.concurrentDownloads);
  
  // 문서별 org_id, board_id 조회를 위한 캐시 (실제로는 DB 조회 필요)
  // 여기서는 간단히 처리
  
  const downloadTasks = pendingFiles.map(async (attachment, index) => {
    await semaphore.acquire();
    
    try {
      if (onProgress) {
        onProgress({
          current: index + 1,
          total: pendingFiles.length,
          currentFile: attachment.file_name,
          status: "downloading",
        });
      }
      
      // org_id, board_id는 attachment에서 직접 알 수 없으므로
      // doc_id에서 추출하거나 documents 테이블 조회 필요
      // 여기서는 doc_id에서 board_id를 추출하는 방식 사용
      const docIdParts = attachment.doc_id.split("_");
      const boardId = docIdParts[1] || "unknown";
      const orgId = "unknown"; // 실제로는 documents 테이블에서 조회 필요
      
      const result = await downloadAttachment(attachment, orgId, boardId, undefined, settings);
      results.push(result);
      
      if (result.success) {
        if (result.skipped) {
          skipped++;
        } else {
          downloaded++;
        }
      } else {
        failed++;
        if (result.error) {
          errors.push(`${attachment.file_name}: ${result.error}`);
        }
        
        // 실패 시 동작에 따라 중단
        if (settings.retry.failureAction === "stop") {
          throw new Error("Download stopped due to failure");
        }
      }
      
    } finally {
      semaphore.release();
    }
  });
  
  try {
    await Promise.all(downloadTasks);
  } catch (err) {
    if (err instanceof Error && err.message.includes("stopped")) {
      errors.push("다운로드가 실패로 인해 중단되었습니다.");
    }
  }
  
  if (onProgress) {
    onProgress({
      current: pendingFiles.length,
      total: pendingFiles.length,
      currentFile: "",
      status: "done",
    });
  }
  
  return {
    total: pendingFiles.length,
    downloaded,
    skipped,
    failed,
    results,
    errors,
    warnings,
    storageCheck,
    cleanup,
  };
}

/**
 * 특정 보드의 첨부파일만 다운로드
 */
export async function downloadBoardAttachments(
  boardId: string,
  orgId: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<BatchDownloadResult> {
  await getDbAsync();
  
  // 해당 보드의 pending 첨부파일만 조회
  // 실제로는 JOIN 쿼리 필요
  const allPending = await getPendingAttachments(1000);
  const boardPending = allPending.filter(a => a.doc_id.includes(boardId));
  
  const warnings: string[] = [];
  
  if (boardPending.length === 0) {
    return { total: 0, downloaded: 0, skipped: 0, failed: 0, results: [], errors: [], warnings: [] };
  }
  
  const settings = readDownloadSettings();
  
  // 저장 공간 체크
  const basePath = settings.path.basePath;
  let storageCheck = await checkStorageSpace(basePath, settings.storage);
  let cleanup: CleanupResult | undefined;
  
  if (storageCheck.warning) {
    warnings.push(storageCheck.warning);
  }
  
  // 저장 공간 부족 시 자동 정리
  if (!storageCheck.canProceed || storageCheck.warning) {
    if (settings.storage.autoCleanupEnabled && settings.storage.autoCleanupDays > 0) {
      cleanup = runAutoCleanup(basePath, settings.storage.autoCleanupDays);
      if (cleanup.deletedFiles > 0) {
        warnings.push(`🧹 자동 정리: ${cleanup.deletedFiles}개 파일 삭제 (${formatBytes(cleanup.deletedSize)} 확보)`);
        storageCheck = await checkStorageSpace(basePath, settings.storage);
      }
    }
  }
  
  if (!storageCheck.canProceed) {
    return {
      total: boardPending.length,
      downloaded: 0,
      skipped: boardPending.length,
      failed: 0,
      results: [],
      errors: [storageCheck.error || "저장 공간 부족"],
      warnings,
      storageCheck,
      cleanup,
    };
  }
  
  const results: DownloadResult[] = [];
  const errors: string[] = [];
  let downloaded = 0, skipped = 0, failed = 0;
  
  const semaphore = new DownloadSemaphore(settings.fileManagement.concurrentDownloads);
  
  for (let i = 0; i < boardPending.length; i++) {
    await semaphore.acquire();
    
    try {
      const attachment = boardPending[i];
      
      if (onProgress) {
        onProgress({
          current: i + 1,
          total: boardPending.length,
          currentFile: attachment.file_name,
          status: "downloading",
        });
      }
      
      const result = await downloadAttachment(attachment, orgId, boardId);
      results.push(result);
      
      if (result.success) {
        result.skipped ? skipped++ : downloaded++;
      } else {
        failed++;
        if (result.error) errors.push(`${attachment.file_name}: ${result.error}`);
      }
      
    } finally {
      semaphore.release();
    }
  }
  
  if (onProgress) {
    onProgress({ current: boardPending.length, total: boardPending.length, currentFile: "", status: "done" });
  }
  
  return { total: boardPending.length, downloaded, skipped, failed, results, errors, warnings, storageCheck, cleanup };
}
