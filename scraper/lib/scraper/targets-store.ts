import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import {
  isGitHubApiAvailable,
  updateFileOnGitHub,
  type GitHubSyncResult as ApiSyncResult,
} from "./github-api";

export type OrgStatus = "active" | "inactive";
export type CollectionMode = "web_scraping" | "api_only" | "hybrid";
export type OrganizationType = "국가기관" | "유관기관" | "협회 및 학회";

export type OrgPolicy = {
  rps: number;
  timeout_sec: number;
};

export type Organization = {
  org_id: string;
  org_name: string;
  base_url: string;
  status: OrgStatus;
  default_policy: OrgPolicy;
  notes?: string;
  collection_mode?: CollectionMode;
  org_type?: OrganizationType;
  logo_path?: string;
  api_profile?: Record<string, unknown>;
};

export type BoardAccessMode = "api" | "static_html" | "dynamic_js" | "login_required";

// 헤드리스 브라우저 설정
export type BrowserType = "chromium" | "chrome" | "msedge";

export type BrowserConfig = {
  browser_type?: BrowserType;      // 사용할 브라우저 (기본: chromium)
  headless?: boolean;               // 헤드리스 모드 (기본: true)
  wait_time?: number;               // 페이지 로드 후 추가 대기 시간 (ms)
  wait_for_selector?: string;       // 특정 선택자가 로드될 때까지 대기
};
export type BoardMode = "web_scraping" | "api" | "hybrid";
export type DedupKey = "url" | "id" | "hash";

export type CollectionRangeType = "period" | "relative" | "yearly" | "";

export type CollectionRange = {
  type: CollectionRangeType;
  period_start?: string;
  period_end?: string;
  relative_days?: number;
  years?: number[];
};

export type CollectionTargets = {
  title_body?: boolean;
  attachments?: {
    enabled?: boolean;
    all?: boolean;
    hwpx?: boolean;
    docx?: boolean;
    xlsx?: boolean;
    pdf?: boolean;
  };
};

// 스케줄 설정 상세 (기간/주기 옵션 포함)
export type ScheduleConfig = {
  scheduleMode: "period" | "cycle" | "";  // 기간 설정 vs 주기 설정
  startDate?: string;  // 기간 시작일 (YYYY-MM-DD)
  endDate?: string;    // 기간 종료일 (YYYY-MM-DD)
  cycleType?: "monthly" | "weekly" | "interval" | "";  // 주기 유형
  monthlyDay?: string;   // 매월 N일
  weeklyDay?: string;    // 매주 요일 (mon, tue, ...)
  intervalDays?: string; // N일마다
  hour?: string;         // 실행 시각 (시)
  minute?: string;       // 실행 시각 (분)
};

// 사이트 내 검색 옵션 (드롭다운, 키워드 검색 등)
export type SiteSearchOption = {
  type: "select" | "text" | "date" | "radio" | "checkbox";
  name: string;           // input name 또는 select name
  label: string;          // 레이블 텍스트
  selector: string;       // CSS 선택자
  options?: { value: string; label: string }[];  // select, radio, checkbox용 옵션들
  placeholder?: string;   // text input용 플레이스홀더
  default_value?: string; // 기본값
  selected_value?: string; // 사용자가 선택한 값 (보드 설정에서 저장)
};

export type SiteSearchConfig = {
  form_selector?: string;       // 검색 폼 선택자
  submit_selector?: string;     // 검색 버튼 선택자
  submit_type: "form" | "url_param" | "ajax";  // 검색 제출 방식
  options: SiteSearchOption[];  // 검색 옵션들
};

// 첨부파일 감지 패턴 유형
export type AttachmentPatternType = 
  | "standard_href"           // 표준 href 기반 (환경부 등 대부분 사이트)
  | "onclick_fndownload"      // 국민참여입법센터 패턴: onclick="fnDownload('id','key')"
  | "onclick_javascript"      // onclick="javascript:..." 패턴
  | "file_area_button"        // 파일 영역 내 버튼 클릭
  | "auto";                   // 자동 감지 (기본값)

// 첨부파일 감지 설정
export type AttachmentConfig = {
  pattern_type: AttachmentPatternType;  // 감지 패턴 유형
  container_selector?: string;          // 첨부파일 영역 선택자
  link_selector?: string;               // 첨부파일 링크/버튼 선택자
  filename_selector?: string;           // 파일명 추출 선택자 (없으면 링크 텍스트)
  onclick_function?: string;            // onclick 함수명 (예: "fnDownload")
  download_url_pattern?: string;        // 다운로드 URL 패턴 (예: "/file/download/{id}")
};

export type Board = {
  board_id: string;
  org_id: string;
  board_name: string;
  access_mode: BoardAccessMode;
  list_url?: string;
  doc_type?: string;
  domain_tags?: string[];
  enabled: boolean;

  // --- 개편안(확장) ---
  board_mode?: BoardMode;
  schedule_cron?: string;
  schedule_timezone?: string;  // 스케줄 시간대 (예: Asia/Seoul)
  schedule_config?: ScheduleConfig;  // 스케줄 상세 설정 (기간/주기 옵션)
  dedup_key?: DedupKey;
  published_date_rule?: Record<string, unknown>;

  // 수집 범위 및 대상
  collection_range?: CollectionRange;
  collection_targets?: CollectionTargets;

  // 모드별 상세 설정(1차는 JSON blob 형태로 저장)
  web_config?: Record<string, unknown>;
  api_config?: Record<string, unknown>;
  hybrid_config?: Record<string, unknown>;
  
  // 사이트 내 검색 옵션 설정 (소관부처 선택, 키워드 검색 등)
  site_search_config?: SiteSearchConfig;
  
  // 첨부파일 감지 설정 (사이트별 패턴)
  attachment_config?: AttachmentConfig;
  
  // 헤드리스 브라우저 설정 (dynamic_js 모드에서 사용)
  browser_config?: BrowserConfig;
};

export type ScraperTargetsFile = {
  orgs: Organization[];
  boards: Board[];
  updated_at: string;
};

function targetsFilePath() {
  // 기본은 Next 서버 실행 위치(cwd)/data 를 사용하되,
  // 루트에서 실행되는 경우에도 frontend/data 를 우선하도록 보정한다.
  // (이 설정 파일은 프론트 프로젝트 내부에 존재해야 하므로 저장 위치를 일관되게 유지)
  const cwd = process.cwd();
  const isFrontendCwd = path.basename(cwd).toLowerCase() === "frontend";
  if (isFrontendCwd) {
    return path.join(cwd, "data", "scraper-targets.json");
  }

  const frontendDir = path.join(cwd, "frontend");
  if (fs.existsSync(frontendDir) && fs.statSync(frontendDir).isDirectory()) {
    return path.join(frontendDir, "data", "scraper-targets.json");
  }

  return path.join(cwd, "data", "scraper-targets.json");
}

/**
 * data-defaults 폴백 경로 탐색
 * Docker 이미지에 내장된 기본 설정 파일 위치를 반환한다.
 * (Railway 볼륨 유실 시 자동 복원용)
 */
function dataDefaultsFilePath(filename: string): string | null {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "data-defaults", filename),
    path.join("/app", "data-defaults", filename),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function readScraperTargets(): ScraperTargetsFile {
  const p = targetsFilePath();

  if (fs.existsSync(p)) {
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw) as ScraperTargetsFile;
  }

  // 볼륨 유실 대비: data-defaults 에서 자동 복원
  const fallback = dataDefaultsFilePath("scraper-targets.json");
  if (fallback) {
    console.warn(`[targets-store] 파일 없음 → data-defaults 복원: ${p}`);
    try {
      const raw = fs.readFileSync(fallback, "utf8");
      const data = JSON.parse(raw) as ScraperTargetsFile;
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      console.warn("[targets-store] ✓ 복원 완료");
      return data;
    } catch (e) {
      console.error("[targets-store] data-defaults 복원 실패:", e);
    }
  }

  return { orgs: [], boards: [], updated_at: new Date().toISOString() };
}

export function writeScraperTargets(next: Omit<ScraperTargetsFile, "updated_at">) {
  const p = targetsFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const payload: ScraperTargetsFile = {
    ...next,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(p, JSON.stringify(payload, null, 2), "utf8");
}

// ============================================================
// GitHub 자동 동기화
// ============================================================

export interface GitSyncResult {
  success: boolean;
  message: string;
  details?: string;
}

/**
 * 프로젝트 루트 디렉토리 찾기
 */
function getProjectRoot(): string {
  const cwd = process.cwd();
  const isFrontendCwd = path.basename(cwd).toLowerCase() === "frontend";
  
  if (isFrontendCwd) {
    return path.dirname(cwd);
  }
  
  const frontendDir = path.join(cwd, "frontend");
  if (fs.existsSync(frontendDir)) {
    return cwd;
  }
  
  return cwd;
}

/**
 * Git 명령 실행 헬퍼
 */
function execGitCommand(command: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { cwd, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * scraper-targets.json 변경사항을 GitHub에 동기화
 *
 * 1) GITHUB_TOKEN + GITHUB_REPO가 설정되어 있으면 GitHub REST API 사용 (Railway 환경)
 * 2) 아니면 로컬 git CLI 사용 (개발 환경)
 */
export async function syncTargetsToGitHub(
  commitMessage: string = "update: scraper targets settings"
): Promise<GitSyncResult> {
  const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
  const fullMessage = `${commitMessage} (${timestamp})`;

  // --- GitHub API 방식 (Railway / Docker 환경) ---
  if (isGitHubApiAvailable()) {
    try {
      const p = targetsFilePath();
      const content = fs.readFileSync(p, "utf-8");
      const result: ApiSyncResult = await updateFileOnGitHub(
        "frontend/data/scraper-targets.json",
        content,
        fullMessage
      );
      console.log(`[GitSync] API: ${result.message} ${result.details || ""}`);
      return result;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[GitSync] API 실패:", msg);
      return { success: false, message: "GitHub API 동기화 실패", details: msg };
    }
  }

  // --- Git CLI 방식 (로컬 개발 환경) ---
  const projectRoot = getProjectRoot();
  const targetsFile = "frontend/data/scraper-targets.json";

  try {
    const status = await execGitCommand("git status --porcelain", projectRoot);

    if (!status.includes("scraper-targets.json")) {
      return { success: true, message: "변경사항 없음 - 동기화 불필요" };
    }

    await execGitCommand(`git add "${targetsFile}"`, projectRoot);
    await execGitCommand(`git commit -m "${fullMessage}"`, projectRoot);
    const pushResult = await execGitCommand("git push", projectRoot);

    return {
      success: true,
      message: "GitHub 동기화 완료",
      details: pushResult || "푸시 성공",
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("nothing to commit")) {
      return { success: true, message: "변경사항 없음 - 동기화 불필요" };
    }
    return { success: false, message: "GitHub 동기화 실패", details: msg };
  }
}

/**
 * 설정 저장 및 GitHub 동기화를 한 번에 수행
 */
export async function writeAndSyncScraperTargets(
  next: Omit<ScraperTargetsFile, "updated_at">,
  commitMessage?: string
): Promise<GitSyncResult> {
  // 1. 로컬 파일 저장
  writeScraperTargets(next);
  
  // 2. GitHub 동기화
  return syncTargetsToGitHub(commitMessage);
}

