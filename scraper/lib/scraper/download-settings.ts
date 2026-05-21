/**
 * 첨부파일 다운로드 설정 관리
 * 
 * 5개 카테고리:
 * 1. 저장 경로 관리
 * 2. 다운로드 실패 대처
 * 3. 파일 관리
 * 4. 네트워크/보안
 * 5. 저장 공간 관리
 */

import fs from "node:fs";
import path from "node:path";

// ============================================================
// 타입 정의
// ============================================================

/** 폴더 구조 규칙 */
export type FolderStructure = 
  | "flat"                    // 단일 폴더
  | "by_org"                  // {org_id}/
  | "by_org_board"            // {org_id}/{board_id}/
  | "by_org_board_date"       // {org_id}/{board_id}/{YYYY-MM}/
  | "by_date_org_board";      // {YYYY-MM}/{org_id}/{board_id}/

/** 파일명 규칙 */
export type FileNameRule = 
  | "original"                // 원본 파일명 그대로
  | "date_prefix"             // [YYYY-MM-DD]_원본명
  | "docid_prefix"            // {doc_id}_원본명
  | "datetime_prefix";        // [YYYY-MM-DD_HHmmss]_원본명

/** 중복 파일 처리 */
export type DuplicateHandling = 
  | "skip"                    // 건너뛰기
  | "overwrite"               // 덮어쓰기
  | "version";                // 버전 추가 (_v2, _v3)

/** 실패 시 동작 */
export type FailureAction = 
  | "skip"                    // 건너뛰고 계속
  | "log_only"                // 로그만 기록
  | "stop";                   // 전체 중단

/** 저장 경로 관리 설정 */
export interface PathSettings {
  /** 기본 저장 경로 */
  basePath: string;
  /** 폴더 구조 규칙 */
  folderStructure: FolderStructure;
  /** 파일명 규칙 */
  fileNameRule: FileNameRule;
}

/** 다운로드 실패 대처 설정 */
export interface RetrySettings {
  /** 최대 재시도 횟수 */
  maxRetries: number;
  /** 재시도 간격 (초) */
  retryIntervalSec: number;
  /** Exponential backoff 사용 여부 */
  useExponentialBackoff: boolean;
  /** 타임아웃 (초) */
  timeoutSec: number;
  /** 실패 시 동작 */
  failureAction: FailureAction;
}

/** 파일 관리 설정 */
export interface FileManagementSettings {
  /** 최대 파일 크기 (MB, 0=무제한) */
  maxFileSizeMb: number;
  /** 중복 파일 처리 */
  duplicateHandling: DuplicateHandling;
  /** 허용 파일 형식 (빈 배열=전체 허용) */
  allowedExtensions: string[];
  /** 동시 다운로드 수 */
  concurrentDownloads: number;
}

/** 네트워크/보안 설정 */
export interface NetworkSettings {
  /** SSL 검증 우회 */
  skipSslVerification: boolean;
  /** 커스텀 User-Agent */
  customUserAgent: string;
  /** 프록시 URL (빈 문자열=사용 안 함) */
  proxyUrl: string;
  /** Referer 헤더 자동 설정 */
  autoReferer: boolean;
}

/** 저장 공간 관리 설정 */
export interface StorageSettings {
  /** 저장 공간 경고 임계값 (GB, 0=비활성) */
  warningThresholdGb: number;
  /** 자동 정리 활성화 */
  autoCleanupEnabled: boolean;
  /** 자동 정리 기준 일수 */
  autoCleanupDays: number;
  /** 총 용량 제한 (GB, 0=무제한) */
  maxStorageGb: number;
}

/** 전체 다운로드 설정 */
export interface DownloadSettings {
  path: PathSettings;
  retry: RetrySettings;
  fileManagement: FileManagementSettings;
  network: NetworkSettings;
  storage: StorageSettings;
  updatedAt: string;
}

// ============================================================
// 기본값
// ============================================================

export const DEFAULT_DOWNLOAD_SETTINGS: DownloadSettings = {
  path: {
    basePath: "./data/attachments",
    folderStructure: "by_org_board_date",
    fileNameRule: "original",
  },
  retry: {
    maxRetries: 3,
    retryIntervalSec: 5,
    useExponentialBackoff: true,
    timeoutSec: 60,
    failureAction: "skip",
  },
  fileManagement: {
    maxFileSizeMb: 100,
    duplicateHandling: "skip",
    allowedExtensions: [], // 빈 배열 = 전체 허용
    concurrentDownloads: 2,
  },
  network: {
    skipSslVerification: false,
    customUserAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 EcoMonitorBot/1.0",
    proxyUrl: "",
    autoReferer: true,
  },
  storage: {
    warningThresholdGb: 10,
    autoCleanupEnabled: false,
    autoCleanupDays: 365,
    maxStorageGb: 0, // 무제한
  },
  updatedAt: new Date().toISOString(),
};

// ============================================================
// 설정 파일 경로
// ============================================================

function getSettingsPath(): string {
  const cwd = process.cwd();
  const isFrontendCwd = path.basename(cwd).toLowerCase() === "frontend";
  const baseDir = isFrontendCwd ? cwd : path.join(cwd, "frontend");
  return path.join(baseDir, "data", "download-settings.json");
}

// ============================================================
// 설정 읽기/쓰기
// ============================================================

/**
 * 다운로드 설정 읽기
 */
export function readDownloadSettings(): DownloadSettings {
  const settingsPath = getSettingsPath();
  
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      const saved = JSON.parse(raw) as Partial<DownloadSettings>;
      
      // 기본값과 병합 (새로 추가된 필드 대응)
      return {
        path: { ...DEFAULT_DOWNLOAD_SETTINGS.path, ...saved.path },
        retry: { ...DEFAULT_DOWNLOAD_SETTINGS.retry, ...saved.retry },
        fileManagement: { ...DEFAULT_DOWNLOAD_SETTINGS.fileManagement, ...saved.fileManagement },
        network: { ...DEFAULT_DOWNLOAD_SETTINGS.network, ...saved.network },
        storage: { ...DEFAULT_DOWNLOAD_SETTINGS.storage, ...saved.storage },
        updatedAt: saved.updatedAt || new Date().toISOString(),
      };
    }
  } catch (err) {
    console.error("Failed to read download settings:", err);
  }
  
  return { ...DEFAULT_DOWNLOAD_SETTINGS };
}

/**
 * 다운로드 설정 저장
 */
export function saveDownloadSettings(settings: DownloadSettings): void {
  const settingsPath = getSettingsPath();
  const dir = path.dirname(settingsPath);
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  settings.updatedAt = new Date().toISOString();
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
}

// ============================================================
// 유틸리티 함수
// ============================================================

/**
 * 설정에 따른 저장 경로 생성
 */
export function buildFilePath(
  settings: DownloadSettings,
  orgId: string,
  boardId: string,
  docId: string,
  originalFileName: string,
  publishedDate?: string
): string {
  const { basePath, folderStructure, fileNameRule } = settings.path;
  
  // 날짜 정보
  const now = new Date();
  const dateStr = publishedDate || now.toISOString().split("T")[0];
  const yearMonth = dateStr.slice(0, 7); // YYYY-MM
  const dateTimeStr = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  
  // 폴더 경로 생성
  let folderPath = basePath;
  switch (folderStructure) {
    case "flat":
      // basePath 그대로
      break;
    case "by_org":
      folderPath = path.join(basePath, orgId);
      break;
    case "by_org_board":
      folderPath = path.join(basePath, orgId, boardId);
      break;
    case "by_org_board_date":
      folderPath = path.join(basePath, orgId, boardId, yearMonth);
      break;
    case "by_date_org_board":
      folderPath = path.join(basePath, yearMonth, orgId, boardId);
      break;
  }
  
  // 파일명 생성
  let fileName = originalFileName;
  switch (fileNameRule) {
    case "original":
      // 그대로
      break;
    case "date_prefix":
      fileName = `[${dateStr}]_${originalFileName}`;
      break;
    case "docid_prefix":
      fileName = `${docId}_${originalFileName}`;
      break;
    case "datetime_prefix":
      fileName = `[${dateTimeStr}]_${originalFileName}`;
      break;
  }
  
  // 파일명 정리 (특수문자 제거)
  fileName = fileName.replace(/[<>:"/\\|?*]/g, "_");
  
  return path.join(folderPath, fileName);
}

/**
 * 중복 파일 처리
 */
export function handleDuplicate(
  filePath: string,
  handling: DuplicateHandling
): { shouldDownload: boolean; finalPath: string } {
  if (!fs.existsSync(filePath)) {
    return { shouldDownload: true, finalPath: filePath };
  }
  
  switch (handling) {
    case "skip":
      return { shouldDownload: false, finalPath: filePath };
      
    case "overwrite":
      return { shouldDownload: true, finalPath: filePath };
      
    case "version": {
      const ext = path.extname(filePath);
      const base = filePath.slice(0, -ext.length);
      let version = 2;
      let newPath = `${base}_v${version}${ext}`;
      
      while (fs.existsSync(newPath)) {
        version++;
        newPath = `${base}_v${version}${ext}`;
        if (version > 100) break; // 무한 루프 방지
      }
      
      return { shouldDownload: true, finalPath: newPath };
    }
      
    default:
      return { shouldDownload: true, finalPath: filePath };
  }
}

/**
 * 파일 확장자 검증
 */
export function isAllowedExtension(
  fileName: string,
  allowedExtensions: string[]
): boolean {
  // 빈 배열이면 전체 허용
  if (allowedExtensions.length === 0) return true;
  
  const ext = path.extname(fileName).toLowerCase().replace(".", "");
  return allowedExtensions.some(allowed => 
    allowed.toLowerCase().replace(".", "") === ext
  );
}

/**
 * 폴더 구조 규칙 라벨
 */
export const FOLDER_STRUCTURE_LABELS: Record<FolderStructure, string> = {
  flat: "단일 폴더 (모든 파일 한 곳에)",
  by_org: "{기관ID}/",
  by_org_board: "{기관ID}/{보드ID}/",
  by_org_board_date: "{기관ID}/{보드ID}/{YYYY-MM}/",
  by_date_org_board: "{YYYY-MM}/{기관ID}/{보드ID}/",
};

/**
 * 파일명 규칙 라벨
 */
export const FILENAME_RULE_LABELS: Record<FileNameRule, string> = {
  original: "원본 파일명 그대로",
  date_prefix: "[YYYY-MM-DD]_원본명",
  docid_prefix: "{문서ID}_원본명",
  datetime_prefix: "[YYYY-MM-DD_HHmmss]_원본명",
};

/**
 * 중복 처리 라벨
 */
export const DUPLICATE_HANDLING_LABELS: Record<DuplicateHandling, string> = {
  skip: "건너뛰기 (기존 파일 유지)",
  overwrite: "덮어쓰기 (기존 파일 교체)",
  version: "버전 추가 (_v2, _v3...)",
};

/**
 * 실패 동작 라벨
 */
export const FAILURE_ACTION_LABELS: Record<FailureAction, string> = {
  skip: "건너뛰고 계속 진행",
  log_only: "로그만 기록하고 계속",
  stop: "전체 다운로드 중단",
};

// ============================================================
// 저장 공간 관리 유틸리티
// ============================================================

/**
 * 디스크 사용량 정보
 */
export interface DiskUsageInfo {
  total: number;        // 전체 용량 (bytes)
  free: number;         // 남은 용량 (bytes)
  used: number;         // 사용 용량 (bytes)
  usedPercent: number;  // 사용률 (%)
}

/**
 * 폴더 용량 정보
 */
export interface FolderSizeInfo {
  totalSize: number;    // 전체 크기 (bytes)
  fileCount: number;    // 파일 수
  oldestFile?: {        // 가장 오래된 파일
    path: string;
    mtime: Date;
  };
}

/**
 * 저장 공간 체크 결과
 */
export interface StorageCheckResult {
  canProceed: boolean;        // 다운로드 진행 가능 여부
  warning?: string;           // 경고 메시지 (임계값 초과)
  error?: string;             // 에러 메시지 (용량 제한 초과)
  diskUsage?: DiskUsageInfo;  // 디스크 사용량
  folderSize?: FolderSizeInfo; // 저장 폴더 용량
}

/**
 * 자동 정리 결과
 */
export interface CleanupResult {
  success: boolean;
  deletedFiles: number;
  deletedSize: number;      // bytes
  errors: string[];
}

/**
 * 디스크 사용량 조회 (Windows/Unix 지원)
 */
export async function getDiskUsage(targetPath: string): Promise<DiskUsageInfo | null> {
  try {
    const { execSync } = await import("node:child_process");
    const resolvedPath = path.resolve(targetPath);
    
    if (process.platform === "win32") {
      // Windows: PowerShell Get-PSDrive 명령 사용 (wmic deprecated)
      const driveLetter = resolvedPath.charAt(0).toUpperCase();
      try {
        const output = execSync(
          `powershell -Command "(Get-PSDrive ${driveLetter}).Free, (Get-PSDrive ${driveLetter}).Used"`,
          { encoding: "utf-8" }
        );
        
        const values = output.trim().split(/\r?\n/).filter(l => l.trim());
        if (values.length >= 2) {
          const free = parseInt(values[0].trim(), 10);
          const used = parseInt(values[1].trim(), 10);
          const total = free + used;
          return {
            total,
            free,
            used,
            usedPercent: (used / total) * 100,
          };
        }
      } catch {
        // PowerShell 실패 시 기본값 반환 (다운로드 계속 진행)
        console.warn("[getDiskUsage] PowerShell 명령 실패, 기본값 사용");
        return {
          total: 1000 * 1024 * 1024 * 1024, // 1TB 가정
          free: 500 * 1024 * 1024 * 1024,   // 500GB 가정
          used: 500 * 1024 * 1024 * 1024,
          usedPercent: 50,
        };
      }
    } else {
      // Unix/Linux/macOS: df 명령 사용
      const output = execSync(`df -B1 "${resolvedPath}"`, { encoding: "utf-8" });
      const lines = output.trim().split("\n");
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        if (parts.length >= 4) {
          const total = parseInt(parts[1], 10);
          const used = parseInt(parts[2], 10);
          const free = parseInt(parts[3], 10);
          return {
            total,
            free,
            used,
            usedPercent: (used / total) * 100,
          };
        }
      }
    }
  } catch (err) {
    console.error("Failed to get disk usage:", err);
  }
  
  return null;
}

/**
 * 폴더 크기 계산 (재귀)
 */
export function getFolderSize(folderPath: string): FolderSizeInfo {
  let totalSize = 0;
  let fileCount = 0;
  let oldestFile: { path: string; mtime: Date } | undefined;
  
  function walkDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile()) {
        try {
          const stats = fs.statSync(fullPath);
          totalSize += stats.size;
          fileCount++;
          
          if (!oldestFile || stats.mtime < oldestFile.mtime) {
            oldestFile = { path: fullPath, mtime: stats.mtime };
          }
        } catch {
          // 파일 접근 실패 무시
        }
      }
    }
  }
  
  walkDir(folderPath);
  
  return { totalSize, fileCount, oldestFile };
}

/**
 * 저장 공간 체크
 * - 경고 임계값 확인
 * - 용량 제한 확인
 */
export async function checkStorageSpace(
  targetPath: string,
  settings: StorageSettings
): Promise<StorageCheckResult> {
  const result: StorageCheckResult = { canProceed: true };
  
  // 디렉토리가 없으면 생성 시도
  const resolvedPath = path.resolve(targetPath);
  if (!fs.existsSync(resolvedPath)) {
    try {
      fs.mkdirSync(resolvedPath, { recursive: true });
    } catch {
      result.canProceed = false;
      result.error = `저장 경로를 생성할 수 없습니다: ${resolvedPath}`;
      return result;
    }
  }
  
  // 디스크 사용량 조회
  const diskUsage = await getDiskUsage(resolvedPath);
  result.diskUsage = diskUsage || undefined;
  
  // 경고 임계값 체크 (GB 단위)
  if (diskUsage && settings.warningThresholdGb > 0) {
    const freeGb = diskUsage.free / (1024 * 1024 * 1024);
    if (freeGb < settings.warningThresholdGb) {
      result.warning = `⚠️ 저장 공간 부족 경고: 남은 용량 ${freeGb.toFixed(1)}GB < 임계값 ${settings.warningThresholdGb}GB`;
    }
  }
  
  // 폴더 용량 체크
  const folderSize = getFolderSize(resolvedPath);
  result.folderSize = folderSize;
  
  // 최대 저장 용량 체크 (0 = 무제한)
  if (settings.maxStorageGb > 0) {
    const folderSizeGb = folderSize.totalSize / (1024 * 1024 * 1024);
    if (folderSizeGb >= settings.maxStorageGb) {
      result.canProceed = false;
      result.error = `🚫 저장 용량 제한 초과: 현재 ${folderSizeGb.toFixed(2)}GB >= 제한 ${settings.maxStorageGb}GB`;
    }
  }
  
  return result;
}

/**
 * 자동 정리 실행
 * - 지정된 일수보다 오래된 파일 삭제
 */
export function runAutoCleanup(
  targetPath: string,
  daysThreshold: number
): CleanupResult {
  const result: CleanupResult = {
    success: true,
    deletedFiles: 0,
    deletedSize: 0,
    errors: [],
  };
  
  if (!fs.existsSync(targetPath)) {
    return result;
  }
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysThreshold);
  
  function cleanDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        cleanDir(fullPath);
        
        // 빈 디렉토리 삭제
        try {
          const remaining = fs.readdirSync(fullPath);
          if (remaining.length === 0) {
            fs.rmdirSync(fullPath);
          }
        } catch {
          // 무시
        }
      } else if (entry.isFile()) {
        try {
          const stats = fs.statSync(fullPath);
          
          if (stats.mtime < cutoffDate) {
            result.deletedSize += stats.size;
            fs.unlinkSync(fullPath);
            result.deletedFiles++;
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          result.errors.push(`${entry.name}: ${errorMsg}`);
        }
      }
    }
  }
  
  try {
    cleanDir(targetPath);
  } catch (err) {
    result.success = false;
    const errorMsg = err instanceof Error ? err.message : String(err);
    result.errors.push(`자동 정리 실패: ${errorMsg}`);
  }
  
  return result;
}

/**
 * 용량 포맷 (bytes → human readable)
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}