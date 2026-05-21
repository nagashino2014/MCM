#!/usr/bin/env npx ts-node
/**
 * IEPS 통합환경허가 수집 → 다운로드 → 파싱 → 사업장 적재 통합 CLI
 *
 * 워크플로 분리:
 *   - 기본(scrape + download + parse + upsert) 실행
 *   - --download-only : 스크래핑 + PDF 다운로드까지만 (파싱·적재 skip)
 *   - --parse-only=<category> : raw/ 아래 PDF 중 해당 카테고리만 파싱+적재
 *       category ∈ integratedFirst | integratedChange | annualReport
 *
 * 사용법:
 *   npm run collect -- [options]
 *
 * 옵션:
 *   --max-pages=N             게시판 목록 페이지 수 (기본: 5)
 *   --board=<board_id>        대상 보드 (기본: ieps-integrated-permit)
 *   --config=<path>           CollectionConfig JSON 파일 경로
 *   --backend=<url>           backend 서버 URL (기본: http://127.0.0.1:8001)
 *   --skip-download           PDF 다운로드 단계 생략 (DB의 pending 첨부만 활용)
 *   --skip-parse              backend 파싱 단계 생략
 *   --download-only           스크래핑 + 다운로드까지만 수행 (파싱/적재 skip)
 *   --parse-only=<category>   raw/ 아래 카테고리별 PDF 만 파싱+적재
 *   --dry-run                 사업장 DB 적재 없이 summary만 출력
 *   --from-date=YYYY-MM-DD    이 날짜 이후 게시물만 수집
 *   --help                    도움말 출력
 */

import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

import {
  runScraper,
  loadTargets,
  findBoard,
  findOrg,
  type ScrapingResult,
  type ScrapedArticle,
} from "./scraper-runner";

import { getDbAsync, flushDbToDisk } from "../lib/scraper/scraper-db";
import { BUILTIN_RULES, type ExtractionRule as BuiltinRule } from "../lib/ieps/builtin-rules";
import { extractRegion } from "../lib/ieps/region";
import { PlaywrightDownloader } from "../lib/ieps/playwright-downloader";
import {
  flushDownloadEvents,
  evaluateAlertRules,
  persistAlerts,
  type DownloadAttemptRecord,
} from "../lib/ieps/alert-rules";

// ============================================================
// 경로 / 환경 변수 설정
// ============================================================

const SCRAPER_ROOT = path.resolve(__dirname, "..");
const MCM_ROOT = path.resolve(SCRAPER_ROOT, "..");
const DATA_ROOT = path.join(MCM_ROOT, "data", "ieps");
const RAW_ROOT = path.join(DATA_ROOT, "raw");
const EXTRACTED_ROOT = path.join(DATA_ROOT, "extracted");
const LOGS_ROOT = path.join(DATA_ROOT, "logs");
const SUMMARY_PATH = path.join(DATA_ROOT, "summary.json");

// 모든 IEPS DB I/O를 같은 SQLite 파일로 모은다.
process.env.SCRAPER_DB_PATH ??= path.join(DATA_ROOT, "db.sqlite");

for (const dir of [DATA_ROOT, RAW_ROOT, EXTRACTED_ROOT, LOGS_ROOT]) {
  fs.mkdirSync(dir, { recursive: true });
}

// ============================================================
// CollectionConfig 기본값 (프로토타입과 동일 스키마)
// ============================================================

type ExtractionRule = BuiltinRule;

interface ExtractionRangeShape {
  mode: "partial" | "full";
  startPage?: number;
  endPage?: number;
}

interface CollectionConfig {
  collectionRange?: { mode?: string; startDate?: string | null; endDate?: string | null };
  filters?: string[];
  // 검토결과서(통합·변경허가) PDF 페이지 범위.
  extractionRange: ExtractionRangeShape;
  // 연간보고서 PDF 페이지 범위 (선택). 미설정 시 1~2p 디폴트.
  annualReportExtractionRange?: ExtractionRangeShape;
  extractionRules: ExtractionRule[];
  activeRuleIds?: string[];
}

// 9개 빌트인 규칙은 ../lib/ieps/builtin-rules.ts에 일원화. frontend도 동일 모듈을 import한다.
const DEFAULT_RULES: ExtractionRule[] = BUILTIN_RULES;

const DEFAULT_CONFIG: CollectionConfig = {
  collectionRange: { mode: "1y" },
  // CLI standalone 디폴트: 검토결과서(통합허가) 만 수집. 프론트에서 호출 시에는
  // 사용자 옵션이 이 값을 덮어쓴다.
  filters: ["integratedFirst"],
  extractionRange: { mode: "partial", startPage: 1, endPage: 15 },
  annualReportExtractionRange: { mode: "partial", startPage: 1, endPage: 2 },
  extractionRules: DEFAULT_RULES,
  activeRuleIds: DEFAULT_RULES.map((r) => r.id),
};

// ============================================================
// CLI 옵션 파싱
// ============================================================

// --parse-only 카테고리. 프론트의 FILTER_OPTIONS id 와 동일 어휘를 사용해 매핑이 단순해진다.
type ParseOnlyCategory = "integratedFirst" | "integratedChange" | "annualReport";

interface CliOptions {
  boardId: string;
  maxPages: number;
  configPath: string | null;
  backendUrl: string;
  skipDownload: boolean;
  skipParse: boolean;
  dryRun: boolean;
  fromDate: string | null;
  showHelp: boolean;
  jsonProgress: boolean;
  // 라운드 2C — Playwright fallback
  playwrightEnabled: boolean;
  playwrightHeadless: boolean;
  playwrightTimeoutMs: number;
  // 워크플로 분리 — UI 의 "수집 시작" 은 다운로드까지만, "X 파싱" 버튼은 카테고리별 파싱만.
  downloadOnly: boolean;
  parseOnly: ParseOnlyCategory | null;
  // 1회성 데이터 마이그레이션 — permit_type='연간보고서' permit 행을 facility_annual_reports
  // 로 옮긴 후 정리. 멱등하므로 중복 실행해도 안전.
  migrateAnnualReports: boolean;
  // 1회성 cleanup — attachments 테이블과 매칭되지 않는(orphan) parsed_fields 행을 삭제.
  // 옛 알고리즘으로 적재된 stale 검수 대기열을 정리하기 위함. 멱등.
  cleanupOrphanParsedFields: boolean;
  // 사업장 코드 체계 전환/정합성 후처리만 단독 실행.
  reconcileFacilities: boolean;
}

function parseArgs(args: string[]): CliOptions {
  // 환경변수: IEPS_PLAYWRIGHT=0 으로도 비활성화 가능 (라운드 2C)
  const envPlaywrightOff =
    process.env.IEPS_PLAYWRIGHT === "0" || process.env.IEPS_PLAYWRIGHT === "false";
  const opts: CliOptions = {
    boardId: "ieps-integrated-permit",
    maxPages: 5,
    configPath: null,
    backendUrl: process.env.IEPS_BACKEND_URL || "http://127.0.0.1:8001",
    skipDownload: false,
    skipParse: false,
    dryRun: false,
    fromDate: null,
    showHelp: false,
    jsonProgress: false,
    playwrightEnabled: !envPlaywrightOff,
    playwrightHeadless: true,
    playwrightTimeoutMs: 60_000,
    downloadOnly: false,
    parseOnly: null,
    migrateAnnualReports: false,
    cleanupOrphanParsedFields: false,
    reconcileFacilities: false,
  };
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") opts.showHelp = true;
    else if (arg.startsWith("--max-pages=")) opts.maxPages = parseInt(arg.split("=")[1], 10);
    else if (arg.startsWith("--board=")) opts.boardId = arg.split("=")[1];
    else if (arg.startsWith("--config=")) opts.configPath = arg.split("=")[1];
    else if (arg.startsWith("--backend=")) opts.backendUrl = arg.split("=")[1];
    else if (arg === "--skip-download") opts.skipDownload = true;
    else if (arg === "--skip-parse") opts.skipParse = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg.startsWith("--from-date=")) opts.fromDate = arg.split("=")[1];
    else if (arg === "--json-progress") opts.jsonProgress = true;
    else if (arg === "--no-playwright") opts.playwrightEnabled = false;
    else if (arg.startsWith("--playwright-headless=")) {
      const v = arg.split("=")[1];
      opts.playwrightHeadless = !(v === "false" || v === "0");
    } else if (arg.startsWith("--playwright-timeout=")) {
      const v = parseInt(arg.split("=")[1], 10);
      if (Number.isFinite(v) && v > 0) opts.playwrightTimeoutMs = v;
    } else if (arg === "--download-only") {
      opts.downloadOnly = true;
    } else if (arg === "--migrate-annual-reports") {
      opts.migrateAnnualReports = true;
    } else if (arg === "--cleanup-orphan-parsed-fields") {
      opts.cleanupOrphanParsedFields = true;
    } else if (arg === "--reconcile-facilities") {
      opts.reconcileFacilities = true;
    } else if (arg.startsWith("--parse-only=")) {
      const v = arg.split("=")[1];
      if (v === "integratedFirst" || v === "integratedChange" || v === "annualReport") {
        opts.parseOnly = v;
      } else {
        // 알 수 없는 카테고리는 즉시 종료해 잘못된 파라미터로 raw/ 전체를 도는 사고를 막는다.
        process.stderr.write(`[error] 알 수 없는 --parse-only 카테고리: ${v}\n`);
        process.exit(2);
      }
    }
  }
  return opts;
}

// ============================================================
// 진행률 이벤트 전송 (NDJSON to stdout / 사람용 로그는 stderr)
// ============================================================

let JSON_PROGRESS = false;

// 라운드 3 — 운영 관측. emitDownload 가 매 시도마다 push.
const downloadAttemptBuffer: DownloadAttemptRecord[] = [];
let currentJobId: string | null = null;

function emit(event: Record<string, unknown>): void {
  if (!JSON_PROGRESS) return;
  try {
    process.stdout.write(JSON.stringify(event) + "\n");
  } catch {
    // stdout 닫힘 등은 무시
  }
}

function log(message: string, level: "info" | "warn" | "error" = "info"): void {
  if (JSON_PROGRESS) {
    // JSON 모드에서는 사람용 로그는 stderr, 진행 이벤트는 emit() 사용.
    process.stderr.write("[" + level + "] " + message + "\n");
    emit({ event: "log", level, message });
  } else {
    if (level === "warn") console.warn(message);
    else if (level === "error") console.error(message);
    else console.log(message);
  }
}

function printHelp(): void {
  console.log(`IEPS 통합 수집 CLI

사용법:
  npm run collect -- [options]

옵션:
  --max-pages=N            게시판 페이지 수 (기본: 5)
  --board=<id>             보드 ID (기본: ieps-integrated-permit)
  --config=<path>          CollectionConfig JSON 경로
  --backend=<url>          backend URL (기본: http://127.0.0.1:8001)
  --skip-download          PDF 다운로드 생략
  --skip-parse             backend 파싱 호출 생략
  --dry-run                사업장 DB 적재 없이 summary만 출력
  --from-date=DATE         YYYY-MM-DD 이후 게시물만 수집
  --json-progress          stdout에 NDJSON 진행 이벤트 출력 (Next.js SSE 연동용)
  --no-playwright          HTTP 다운로드 실패 시 Playwright fallback 비활성화 (기본: 활성)
  --playwright-headless=B  Playwright chromium headless on/off (기본: true)
  --playwright-timeout=ms  Playwright goto/waitForEvent 타임아웃 (기본: 60000)
  --download-only          스크래핑 + PDF 다운로드까지만 수행 (파싱·적재 skip)
  --parse-only=<category>  raw/ 아래 PDF 중 카테고리만 파싱+적재
                           category ∈ integratedFirst | integratedChange | annualReport
  --migrate-annual-reports 1회성 데이터 마이그레이션: permit_type='연간보고서' permit 행을
                           facility_annual_reports 로 이관 후 정리 (멱등)
  --cleanup-orphan-parsed-fields  1회성 cleanup: attachments 와 매칭되지 않는 parsed_fields
                           행(legacy attachment_id) 제거. 검수 대기열의 stale 노이즈 일소.
  --reconcile-facilities  사업장 코드 체계 전환/참조 재매핑 후처리만 실행
  --help                   이 도움말 표시

환경변수:
  IEPS_PLAYWRIGHT=0        --no-playwright 와 동일 (폴백 강제 비활성화)
`);
}

// ============================================================
// 유틸: CollectionConfig 로드, 게시물 필터, 다운로드, 파싱
// ============================================================

function loadCollectionConfig(configPath: string | null): CollectionConfig {
  if (!configPath) return DEFAULT_CONFIG;
  const abs = path.isAbsolute(configPath) ? configPath : path.join(process.cwd(), configPath);
  if (!fs.existsSync(abs)) {
    console.warn(`[CONFIG] 설정 파일을 찾지 못함: ${abs} → 기본값 사용`);
    return DEFAULT_CONFIG;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      extractionRange: { ...DEFAULT_CONFIG.extractionRange, ...(raw.extractionRange || {}) },
      annualReportExtractionRange: {
        ...DEFAULT_CONFIG.annualReportExtractionRange!,
        ...(raw.annualReportExtractionRange || {}),
      },
      extractionRules: raw.extractionRules?.length ? raw.extractionRules : DEFAULT_CONFIG.extractionRules,
    };
  } catch (err: any) {
    console.warn(`[CONFIG] 로드 실패(${err?.message ?? err}) → 기본값 사용`);
    return DEFAULT_CONFIG;
  }
}

// IEPS는 제목에 "최초허가" 문구가 없고 결정번호 "제 YYYY-01호" 패턴이 최초허가를 의미한다.
const FIRST_PERMIT_DECISION_RE = /제?\s*\d{3,4}\s*-\s*0?1\s*호/;

// IEPS 게시판 자체가 카테고리(`INFO_OTHBC_CD` 체크박스, query string 으로는 `gubunList`)로
// 사전 필터링을 지원한다. 프론트의 FILTER_OPTIONS id 와 IEPS 카테고리 코드 매핑.
//   통합허가 = 136001 (= 최초허가 정보공개)
//   변경허가 = 136002
//   연간보고서 = 136004
const IEPS_GUBUN_CODES: Record<string, string> = {
  integratedFirst: "136001",
  integratedChange: "136002",
  annualReport: "136004",
};

/**
 * 사용자 필터를 IEPS gubunList 쿼리 파라미터로 변환해 board.list_url 에 주입한다.
 *  - "all" 포함/빈 배열 → 파라미터 미적용 (전체 카테고리)
 *  - 매칭되는 코드만 추려 콤마로 join 하여 `gubunList` 에 set
 */
function applyGubunListToUrl(url: string, filters: string[]): string {
  const passAll = filters.length === 0 || filters.includes("all");
  if (passAll) return url;
  const codes = filters
    .map((f) => IEPS_GUBUN_CODES[f])
    .filter((c): c is string => !!c);
  if (codes.length === 0) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("gubunList", codes.join(","));
    return u.toString();
  } catch {
    return url;
  }
}

function isFirstPermit(article: ScrapedArticle, titleKeywords: string[]): boolean {
  const title = article.title || "";
  if (FIRST_PERMIT_DECISION_RE.test(title)) return true;
  if (!titleKeywords.length) return true;
  return titleKeywords.some((kw) => title.includes(kw));
}

function isPdfAttachment(fileName: string, downloadUrl: string): boolean {
  return /\.pdf(\b|$|\?)/i.test(fileName) || /\.pdf(\b|$|\?)/i.test(downloadUrl);
}

// IEPS 게시물에는 "검토결과서" PDF와 별개로 "발생/배수 공개 정보" PDF가 함께 첨부된다.
// 파싱 대상은 "검토결과서"가 들어간 파일만 추린다. 파일명을 알 수 없으면(빈 문자열) 통과.
//
// 단, 본문 검토결과서와 함께 첨부되는 "부록" PDF (예:
//   - "0867-01. 배출시설 등 설치운영허가 검토 결과서 부록_엘지이노텍(주) 구미..."
//   - "[부록]662-01. 배출시설등 설치·운영허가 검토결과서_한화솔루션..."
//   - "(부록) 배출시설 등 설치운영허가 검토결과서_OCI(주) 광양공장.pdf"
//   - "325-01. 배출시설등 설치·운영허가 명세서(부록)..."
// )도 동일 키워드("검토결과서"/"배출시설"+"허가")를 갖고 있어 단순 통과되어 왔다.
// 부록은 본문 데이터(결정번호/허가일자/종 규모/업종 등)를 포함하지 않으므로 명시적으로 제외한다.
//
// 차단 키워드는 "부록 / 별책부록"만. "별첨"은 본문 PDF가 "(별첨N)" 형태로 명명되는
// 케이스(예: "(별첨1) 한화에어로스페이스 ... 연간보고서(...).pdf") 가 있어 차단 시
// 실제 본문이 누락된다. 본문 데이터를 포함하지 않는 진짜 부록은 거의 예외 없이
// "부록" / "별책부록" 키워드로 명명되므로 그 두 가지만 차단한다.
const APPENDIX_BLOCK_RE = /(?:부\s*록|별\s*책\s*부\s*록)/;
const IRRELEVANT_ATTACHMENT_RE =
  /(?:정\s*기\s*검\s*사|품\s*질\s*검\s*사|성\s*적\s*서|석\s*탄\s*재|재\s*활\s*용|실\s*적\s*보\s*고|폐\s*기\s*물\s*배\s*출|고\s*형\s*연\s*료|사\s*진\s*대\s*장|개\s*선\s*계\s*획|측\s*정\s*결\s*과|자\s*가\s*측\s*정|공\s*문|알\s*림|첨\s*부\s*자\s*료|증\s*빙)/;

function isReviewReportFile(fileName: string): boolean {
  if (!fileName) return false;
  if (APPENDIX_BLOCK_RE.test(fileName)) return false;
  if (IRRELEVANT_ATTACHMENT_RE.test(fileName)) return false;
  const lower = fileName.toLowerCase();
  if (lower.includes("검토결과서") || lower.includes("검토 결과서")) return true;
  // "검토결과서" 가 아니라 "허가검토서" 로 명명된 변형도 본문 검토결과서로 인정.
  // 예: "(주)스테리사이클코리아 설치운영허가검토서.pdf"
  if (lower.includes("허가검토서")) return true;
  return false;
}

// 연간(점검)보고서 PDF 식별. IEPS 게시판 명명규약상 파일명에 "연간보고서" 가 들어 있고,
// 부록 류는 제외한다. (예: "연간보고서(에이치디현대코스모(주)-2023)(비공개).pdf")
function isAnnualReportFile(fileName: string): boolean {
  if (!fileName) return false;
  if (APPENDIX_BLOCK_RE.test(fileName)) return false;
  if (IRRELEVANT_ATTACHMENT_RE.test(fileName)) return false;
  const lower = fileName.toLowerCase();
  const compact = fileName.replace(/\s+/g, "");
  if (
    lower.includes("연간보고서") ||
    lower.includes("연간점검") ||
    compact.includes("연간보고서") ||
    compact.includes("연간점검")
  ) {
    return true;
  }
  return false;
}

// 문서 종류 식별 — 검토결과서(통합·변경허가)와 연간(점검)보고서를 분리해 다운로드/파싱
// 단계 모두에서 일관된 라우팅을 한다.
type DocumentType = "review_report" | "annual_report";

function classifyDocumentType(
  fileName: string,
  articleTitle?: string
): DocumentType | null {
  // 게시 제목의 카테고리 접두사가 가장 강한 신호 — IEPS 게시판은 `[통합허가, ...]` /
  // `[변경허가, ...]` / `[연간보고서] ...` 처럼 분류되어 있어 파일명보다 정확하다.
  // 단, 부록류 첨부는 본문 데이터를 포함하지 않으므로 파일명 단계에서 제외해야 한다.
  if (articleTitle) {
    if (/\[\s*연\s*간\s*(?:점검\s*)?보\s*고\s*서/.test(articleTitle)) {
      // 연간보고서 게시물에도 정기검사/증빙 등 부속 PDF가 함께 올라오므로 파일명도 본문 연간보고서여야 한다.
      if (isAnnualReportFile(fileName)) return "annual_report";
      return null;
    }
    if (
      /\[\s*통\s*합\s*허\s*가/.test(articleTitle) ||
      /\[\s*변\s*경\s*허\s*가/.test(articleTitle)
    ) {
      if (isReviewReportFile(fileName)) return "review_report";
      return null;
    }
  }
  // 게시 제목이 없거나 인식 불가한 경우 — 파일명 기반으로 폴백.
  if (isAnnualReportFile(fileName)) return "annual_report";
  if (isReviewReportFile(fileName)) return "review_report";
  return null;
}

function extractPostId(url: string): string {
  try {
    const u = new URL(url);
    for (const key of ["seq", "id", "no", "idx", "num", "sn", "bbsId", "nttId", "articleSeq"]) {
      const v = u.searchParams.get(key);
      if (v && /^\d+$/.test(v)) return v;
    }
    const last = u.pathname.split("/").filter(Boolean).pop() || "";
    if (/^\d+$/.test(last)) return last;
  } catch {}
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 12);
}

/**
 * `javascript:` 스킴이거나 거의 텅 빈 URL 이면 HTTP fetch 가 의미 없으므로 Playwright 직행.
 */
function isJsOnlyUrl(url: string): boolean {
  if (!url) return true;
  const trimmed = url.trim();
  if (!trimmed || trimmed === "#") return true;
  return /^javascript:/i.test(trimmed);
}

interface DownloadStats {
  totalAttachments: number;
  httpSucceeded: number;
  playwrightSucceeded: number;
  failed: number;
}

interface DownloadOptions {
  playwrightEnabled: boolean;
  playwrightHeadless: boolean;
  playwrightTimeoutMs: number;
}

interface DownloadEmitArgs {
  fileName: string;
  status: "ok" | "failed";
  method: "http" | "playwright" | "skipped" | "cache";
  attempts: number;
  bytes?: number;
  reason?: string;
  current: number;
  total: number;
  /** 라운드 3 — download_events 시계열을 위한 식별자 */
  downloadUrl?: string;
}

async function downloadPdfsToRaw(
  articles: ScrapedArticle[],
  yearFolder: string,
  options: DownloadOptions,
  stats: DownloadStats
): Promise<
  Array<{
    article: ScrapedArticle;
    postId: string;
    pdfPath: string;
    fileName: string;
    documentType: DocumentType;
  }>
> {
  const results: Array<{
    article: ScrapedArticle;
    postId: string;
    pdfPath: string;
    fileName: string;
    documentType: DocumentType;
  }> = [];

  // 첨부 1건 → (DocumentType | null) — null 이면 다운로드 대상에서 제외.
  const attachmentDocType = (a: { fileName: string; downloadUrl: string }, articleTitle?: string) =>
    classifyDocumentType(a.fileName, articleTitle);

  // 전체 작업 카운트 (진행률 표시용)
  let totalTargets = 0;
  for (const article of articles) {
    const pdfs = (article.attachments || [])
      .filter((a) => isPdfAttachment(a.fileName, a.downloadUrl))
      .filter((a) => attachmentDocType(a, article.title) !== null);
    totalTargets += pdfs.length;
  }
  stats.totalAttachments = totalTargets;
  let progressIdx = 0;

  // Playwright 다운로더 lazy init
  let playwright: PlaywrightDownloader | null = null;
  const lazyPlaywright = async (): Promise<PlaywrightDownloader | null> => {
    if (!options.playwrightEnabled) return null;
    if (playwright) return playwright;
    try {
      playwright = await PlaywrightDownloader.create({
        headless: options.playwrightHeadless,
        timeoutMs: options.playwrightTimeoutMs,
      });
      log(`[DOWNLOAD] Playwright fallback 활성화 (headless=${options.playwrightHeadless}, timeout=${options.playwrightTimeoutMs}ms)`);
    } catch (err: any) {
      log(`[DOWNLOAD] Playwright 기동 실패: ${err?.message ?? err}`, "warn");
      playwright = null;
    }
    return playwright;
  };

  try {
    for (const article of articles) {
      const postId = extractPostId(article.link);
      const pdfAttachments = (article.attachments || [])
        .filter((a) => isPdfAttachment(a.fileName, a.downloadUrl))
        .map((a) => ({ ...a, _docType: attachmentDocType(a, article.title) }))
        .filter((a) => a._docType !== null) as Array<
          (typeof article.attachments)[number] & { _docType: DocumentType }
        >;
      if (pdfAttachments.length === 0) continue;

      const targetDir = path.join(RAW_ROOT, yearFolder, postId);
      fs.mkdirSync(targetDir, { recursive: true });

      for (const att of pdfAttachments) {
        progressIdx++;
        const safeName = att.fileName.replace(/[<>:"/\\|?*]/g, "_");
        const targetPath = path.join(targetDir, safeName);
        const documentType: DocumentType = att._docType;

        // 1) 캐시 — 이미 동일 경로에 파일이 있으면 재사용
        if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
          results.push({ article, postId, pdfPath: targetPath, fileName: safeName, documentType });
          await markAttachmentSuccess(att.downloadUrl, targetPath, "http", 0, fs.statSync(targetPath).size);
          emitDownload({
            fileName: safeName,
            status: "ok",
            method: "cache",
            attempts: 0,
            bytes: fs.statSync(targetPath).size,
            current: progressIdx,
            total: totalTargets,
            downloadUrl: att.downloadUrl,
          });
          continue;
        }

        // 2) scraper-runner 가 이미 attachments/ 디렉터리에 다운로드해뒀을 수도 있음
        if (att.localPath && fs.existsSync(att.localPath)) {
          try {
            fs.copyFileSync(att.localPath, targetPath);
            results.push({ article, postId, pdfPath: targetPath, fileName: safeName, documentType });
            const bytes = fs.statSync(targetPath).size;
            await markAttachmentSuccess(att.downloadUrl, targetPath, "http", 0, bytes);
            emitDownload({
              fileName: safeName,
              status: "ok",
              method: "cache",
              attempts: 0,
              bytes,
              current: progressIdx,
              total: totalTargets,
              downloadUrl: att.downloadUrl,
            });
            continue;
          } catch (err: any) {
            console.warn(`[DOWNLOAD] 복사 실패(${att.localPath}): ${err?.message ?? err}`);
          }
        }

        const jsOnly = isJsOnlyUrl(att.downloadUrl);
        let attempts = 0;
        let lastErr: string | null = null;

        // 3) HTTP fetch — javascript:/onclick 만 있으면 스킵
        if (!jsOnly) {
          attempts += 1;
          try {
            const ok = await fetchToFile(att.downloadUrl, targetPath, article.link);
            if (ok) {
              const bytes = fs.statSync(targetPath).size;
              results.push({ article, postId, pdfPath: targetPath, fileName: safeName, documentType });
              await markAttachmentSuccess(att.downloadUrl, targetPath, "http", attempts, bytes);
              stats.httpSucceeded++;
              emitDownload({
                fileName: safeName,
                status: "ok",
                method: "http",
                attempts,
                bytes,
                current: progressIdx,
                total: totalTargets,
                downloadUrl: att.downloadUrl,
              });
              continue;
            }
            lastErr = "http-failed";
          } catch (err: any) {
            lastErr = "http-exception: " + (err?.message ?? String(err));
            console.warn(`[DOWNLOAD] 실패(${att.downloadUrl}): ${err?.message ?? err}`);
          }
        } else {
          lastErr = "javascript-only";
        }

        // 4) Playwright fallback
        if (!options.playwrightEnabled) {
          await markAttachmentFailure(att.downloadUrl, attempts, lastErr ?? "no-fallback");
          stats.failed++;
          emitDownload({
            fileName: safeName,
            status: "failed",
            method: jsOnly ? "skipped" : "http",
            attempts,
            reason: lastErr ?? "no-fallback",
            current: progressIdx,
            total: totalTargets,
            downloadUrl: att.downloadUrl,
          });
          continue;
        }

        const pw = await lazyPlaywright();
        if (!pw) {
          await markAttachmentFailure(att.downloadUrl, attempts, lastErr ?? "playwright-init-failed");
          stats.failed++;
          emitDownload({
            fileName: safeName,
            status: "failed",
            method: "playwright",
            attempts,
            reason: lastErr ?? "playwright-init-failed",
            current: progressIdx,
            total: totalTargets,
            downloadUrl: att.downloadUrl,
          });
          continue;
        }

        attempts += 1;
        const r = await pw.downloadFromArticle({
          articleUrl: article.link,
          fileName: safeName,
          targetPath,
        });
        if (r.ok) {
          results.push({ article, postId, pdfPath: targetPath, fileName: safeName, documentType });
          await markAttachmentSuccess(
            att.downloadUrl,
            targetPath,
            "playwright",
            attempts,
            r.bytes ?? 0
          );
          stats.playwrightSucceeded++;
          emitDownload({
            fileName: safeName,
            status: "ok",
            method: "playwright",
            attempts,
            bytes: r.bytes,
            current: progressIdx,
            total: totalTargets,
            downloadUrl: att.downloadUrl,
          });
        } else {
          const finalReason = r.error ?? lastErr ?? "playwright-failed";
          await markAttachmentFailure(att.downloadUrl, attempts, finalReason);
          stats.failed++;
          emitDownload({
            fileName: safeName,
            status: "failed",
            method: "playwright",
            attempts,
            reason: finalReason,
            current: progressIdx,
            total: totalTargets,
            downloadUrl: att.downloadUrl,
          });
        }
      }
    }
  } finally {
    if (playwright) {
      await playwright.close().catch(() => undefined);
    }
  }
  return results;
}

/**
 * 진행 이벤트 NDJSON 발신 — UI 의 ProgressDrawer 가 method/attempts/reason 을 표시하기 위함.
 */
function emitDownload(args: DownloadEmitArgs): void {
  emit({
    event: "download",
    fileName: args.fileName,
    status: args.status,
    method: args.method,
    attempts: args.attempts,
    bytes: args.bytes ?? null,
    reason: args.reason ?? null,
    current: args.current,
    total: args.total,
  });

  // 라운드 3 — download_events 시계열에 누적 (잡 종료 시 일괄 INSERT)
  if (args.downloadUrl) {
    downloadAttemptBuffer.push({
      downloadUrl: args.downloadUrl,
      method: args.method,
      status: args.status,
      attemptNo: args.attempts,
      bytes: args.bytes ?? null,
      error: args.reason ?? null,
      occurredAt: new Date().toISOString(),
    });
  }
}

/**
 * attachments 테이블의 download_method / download_attempts / status / local_path / last_error 갱신.
 * 기존 행이 download_url 로 매칭된다는 가정 — IEPS 보드 한정으로 충돌이 없다.
 */
async function markAttachmentSuccess(
  downloadUrl: string,
  localPath: string,
  method: "http" | "playwright",
  addAttempts: number,
  bytes: number
): Promise<void> {
  if (!downloadUrl) return;
  try {
    const db = await getDbAsync();
    const now = new Date().toISOString();
    db.run(
      `UPDATE attachments
         SET status='downloaded',
             local_path=?,
             downloaded_at=?,
             download_method=?,
             download_attempts=COALESCE(download_attempts,0) + ?,
             last_error=NULL,
             file_size=COALESCE(?, file_size)
       WHERE download_url=?`,
      [localPath, now, method, addAttempts, bytes > 0 ? bytes : null, downloadUrl]
    );
    saveDb();
  } catch (err: any) {
    console.warn(`[DB] markAttachmentSuccess 실패: ${err?.message ?? err}`);
  }
}

async function markAttachmentFailure(
  downloadUrl: string,
  addAttempts: number,
  reason: string
): Promise<void> {
  if (!downloadUrl) return;
  try {
    const db = await getDbAsync();
    db.run(
      `UPDATE attachments
         SET status='failed',
             download_attempts=COALESCE(download_attempts,0) + ?,
             last_error=?
       WHERE download_url=?`,
      [Math.max(1, addAttempts), reason.slice(0, 500), downloadUrl]
    );
    saveDb();
  } catch (err: any) {
    console.warn(`[DB] markAttachmentFailure 실패: ${err?.message ?? err}`);
  }
}

async function fetchToFile(url: string, outputPath: string, referer?: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ...(referer ? { Referer: referer } : {}),
      },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      console.warn(`[DOWNLOAD] HTTP ${res.status}: ${url}`);
      return false;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, buf);
    log(`[DOWNLOAD] ${path.basename(outputPath)} (${buf.byteLength} bytes)`);
    return true;
  } catch (err: any) {
    console.warn(`[DOWNLOAD] 예외: ${err?.message ?? err}`);
    return false;
  }
}

interface ParsedField {
  ruleId: string;
  label: string;
  value: string | null;
  normalized: any;
  sourcePage: number | null;
  sourceText: string | null;
  confidence: number;
  needsReview: boolean;
  error?: string | null;
}

interface ParsedDocument {
  pdfPath: string;
  pageCount: number;
  pagesProcessed: number;
  extractionStatus: string;
  extractionMethod?: string | null;
  qualityScore: number;
  fields: ParsedField[];
  missingRequired: string[];
  errorMessage?: string | null;
}

async function callBackendParse(
  pdfPath: string,
  config: CollectionConfig,
  backendUrl: string,
  documentType: DocumentType = "review_report"
): Promise<ParsedDocument | null> {
  const body = JSON.stringify({ pdfPath, config, documentType });
  const res = await fetch(`${backendUrl.replace(/\/$/, "")}/ieps/parse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(900_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn(`[PARSE] HTTP ${res.status}: ${text.slice(0, 200)}`);
    return null;
  }
  return (await res.json()) as ParsedDocument;
}

function saveParsedJson(parsed: ParsedDocument, postId: string, yearFolder: string, fileName: string): string {
  const dir = path.join(EXTRACTED_ROOT, yearFolder, postId);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${path.parse(fileName).name}.json`);
  fs.writeFileSync(out, JSON.stringify(parsed, null, 2), "utf8");
  return out;
}

// ============================================================
// SQLite 적재 (facilities/permits/permit_scales/product_outputs/parsed_fields)
// ============================================================

function fieldByRuleId(fields: ParsedField[], ruleId: string): ParsedField | undefined {
  return fields.find((f) => f.ruleId === ruleId);
}

function asString(value: any): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function normalizeCompanyName(name: string | null): string | null {
  if (!name) return null;
  return name.replace(/\s+/g, "").replace(/[\(\)（）]/g, "").trim().toLowerCase();
}

function normalizeAddress(addr: string | null): string | null {
  if (!addr) return null;
  return addr.replace(/\s+/g, "").trim();
}

function deriveCompanyNameFromFileName(fileName: string | null | undefined): string | null {
  if (!fileName) return null;
  const base = path.parse(fileName).name;
  const marker = /검토\s*결과서/i.exec(base);
  if (!marker) return null;
  let tail = base.slice(marker.index + marker[0].length);
  tail = tail.replace(/^[\s_\-·.]+/, "");
  if (!tail) return null;

  const squareBracket = /^[\[]\s*(.+?)\s*[\]]/.exec(tail);
  if (squareBracket) {
    tail = squareBracket[1];
  }
  tail = tail.split(/_비공개|_시설정보|_변경허가|_정보공개|비공개|시설정보|최종/i)[0].trim();
  if (/^\(\(/.test(tail) && /\)$/.test(tail)) {
    tail = tail.slice(1, -1);
  } else if (/^[（(]/.test(tail) && !/^[（(]\s*주\s*[）)]/.test(tail)) {
    tail = tail.replace(/^[（(]\s*/, "").replace(/\s*[）)]$/, "");
  }

  tail = tail
    .replace(/\([^)]*비공개[^)]*\)/gi, "")
    .replace(/^\s*[_\-\[]+/, "")
    .replace(/[\]）)_.\-\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!/[가-힣]/.test(tail) || tail.length < 2) return null;
  return tail;
}

function deriveDecisionNoFromFileName(fileName: string | null | undefined): string | null {
  if (!fileName) return null;
  const base = path.parse(fileName).name;
  const m =
    /제\s*(\d{3,5})\s*[-_]\s*(\d{1,2})\s*호/.exec(base) ||
    /^\s*\(?\s*(\d{3,5})\s*[-_]\s*(\d{1,2})\b/.exec(base);
  if (!m) return null;
  return `제${m[1]}-${m[2].padStart(2, "0")}호`;
}

function isWeakCompanyName(value: string | null | undefined): boolean {
  if (!value) return true;
  const cleaned = value.replace(/\s+/g, "").trim();
  if (!cleaned) return true;
  if (/^[()[\]{}（）·._\-—–]+$/.test(cleaned)) return true;
  if (/^[년월일\d]+$/.test(cleaned)) return true;
  return false;
}

function applyFileNameFallbacks(fields: ParsedField[], fileName: string | null | undefined): void {
  const companyField = fieldByRuleId(fields, "company_name");
  if (
    companyField &&
    isWeakCompanyName(asString(companyField.normalized) || companyField.value)
  ) {
    const fallbackCompany = deriveCompanyNameFromFileName(fileName);
    if (fallbackCompany) {
      companyField.value = fallbackCompany;
      companyField.normalized = fallbackCompany;
      companyField.sourceText = fileName ?? null;
      companyField.confidence = Math.max(companyField.confidence ?? 0, 0.7);
      companyField.needsReview = false;
      companyField.error = null;
    }
  }

  const decisionField = fieldByRuleId(fields, "decision_no");
  if (decisionField && !asString(decisionField.normalized) && !decisionField.value) {
    const fallbackDecisionNo = deriveDecisionNoFromFileName(fileName);
    if (fallbackDecisionNo) {
      decisionField.value = fallbackDecisionNo;
      decisionField.normalized = fallbackDecisionNo;
      decisionField.sourceText = fileName ?? null;
      decisionField.confidence = Math.max(decisionField.confidence ?? 0, 0.75);
      decisionField.needsReview = false;
      decisionField.error = null;
    }
  }
}

interface UpsertSummary {
  facilitiesCreated: number;
  facilitiesUpdated: number;
  permitsCreated: number;
  permitsUpdated: number;
  needsReview: number;
}

async function upsertParsedDocument(
  parsed: ParsedDocument,
  attachmentId: string,
  docId: string,
  isFirstPermit: boolean,
  postId: string,
  summary: UpsertSummary,
  fileMeta?: { fileName?: string | null; pdfPath?: string | null },
  documentType: DocumentType = "review_report",
  /**
   * 카테고리 — 사업장 데이터 적재 경로 분기 + permit_type 라벨링 +
   * facility 컬럼 신뢰도 우선순위(검토결과서 > 연간보고서) 결정에 사용.
   *
   * 미지정 시 `documentType` + 부재한 docTitle 만으로 추정해 폴백한다 (호환성용).
   */
  category: ParseOnlyCategory = documentType === "annual_report"
    ? "annualReport"
    : "integratedFirst"
): Promise<void> {
  const db = await getDbAsync();
  const now = new Date().toISOString();
  const fields = parsed.fields || [];
  applyFileNameFallbacks(fields, fileMeta?.fileName);

  const decisionField = fieldByRuleId(fields, "decision_no");
  const companyField = fieldByRuleId(fields, "company_name");
  const brnField = fieldByRuleId(fields, "business_registration_no");
  const addressField = fieldByRuleId(fields, "site_address");
  const phoneField = fieldByRuleId(fields, "phone_number");
  const industryField = fieldByRuleId(fields, "industry_code_name");
  const permitDateField = fieldByRuleId(fields, "permit_date");
  const scaleField = fieldByRuleId(fields, "permit_scale");
  const productField = fieldByRuleId(fields, "product_output");

  const companyName = (asString(companyField?.normalized) || companyField?.value || "").trim();
  if (!companyName) {
    // 사업장 식별 불가 → parsed_fields만 기록
    await insertParsedFields(db, attachmentId, docId, fields, now, fileMeta);
    summary.needsReview += fields.filter((f) => f.needsReview).length;
    saveDb();
    return;
  }

  const brn = asString(brnField?.normalized) || brnField?.value || null;
  const address = asString(addressField?.normalized) || addressField?.value || null;
  const phone = asString(phoneField?.normalized) || phoneField?.value || null;

  let industryCode: string | null = null;
  let industryName: string | null = null;
  if (industryField) {
    const norm = industryField.normalized;
    // 다중 업종 → 첫 항목을 facility 메인 업종으로 사용. 나머지는 parsed_fields JSON 으로 보존됨.
    if (Array.isArray(norm) && norm.length > 0) {
      const first = norm[0];
      if (first && typeof first === "object") {
        industryCode = (first as any).code ?? null;
        industryName = (first as any).name ?? null;
      }
    } else if (norm && typeof norm === "object" && !Array.isArray(norm)) {
      industryCode = (norm as any).code ?? null;
      industryName = (norm as any).name ?? null;
    } else if (typeof industryField.value === "string") {
      const m = industryField.value.match(/(\d{5})\s*[\)\.\-:·]?\s*(.+)/);
      if (m) {
        industryCode = m[1];
        industryName = m[2].trim();
      } else {
        industryName = industryField.value;
      }
    }
  }

  // 기존 facility 식별: 동일 사업자번호/상호를 여러 공장이 공유할 수 있으므로
  // 주소를 최우선 보강 키로 사용한다.
  const normCompany = normalizeCompanyName(companyName);
  const normAddress = normalizeAddress(address);
  const region = extractRegion(address);

  let facilityId: string | null = null;
  if (brn && normAddress) {
    const r = db.exec(
      `SELECT facility_id FROM facilities
       WHERE business_registration_no = ? AND normalized_address = ?
       LIMIT 1`,
      [brn, normAddress]
    );
    if (r.length && r[0].values.length) facilityId = r[0].values[0][0] as string;
  }
  if (!facilityId && brn && normCompany && normAddress) {
    const r = db.exec(
      `SELECT facility_id FROM facilities
       WHERE business_registration_no = ? AND normalized_company_name = ? AND normalized_address = ?
       LIMIT 1`,
      [brn, normCompany, normAddress]
    );
    if (r.length && r[0].values.length) facilityId = r[0].values[0][0] as string;
  }
  if (!facilityId && brn && normCompany && !normAddress) {
    const r = db.exec(
      `SELECT facility_id FROM facilities
       WHERE business_registration_no = ? AND normalized_company_name = ?
       LIMIT 1`,
      [brn, normCompany]
    );
    if (r.length && r[0].values.length) facilityId = r[0].values[0][0] as string;
  }
  if (!facilityId && normCompany) {
    const r = db.exec(
      `SELECT facility_id FROM facilities WHERE normalized_company_name = ? LIMIT 1`,
      [normCompany]
    );
    if (r.length && r[0].values.length) facilityId = r[0].values[0][0] as string;
  }

  // 카테고리별 facility 신뢰도 — 3단계 우선순위.
  //   변경허가(integrated_change) > 통합허가(integrated_first) > 연간보고서(annual_report)
  //
  // 의미:
  //   - 최초허가 이후 변경허가가 발급되었다면 변경허가가 가장 최신 정보를 담는다.
  //     따라서 같은 사업장의 통합허가 잡이 먼저 적재되어 있어도 변경허가 잡이
  //     덮어쓴다(잡 실행 순서와 무관).
  //   - 연간보고서는 발행 시점이 더 최신이라도 검토결과서(통합/변경)가 있는 사업장에선
  //     NULL 결손 컬럼만 보강하고 기존 값을 덮어쓰지 않는다.
  //   - 같은 우선순위끼리는 마지막 잡 우선(=현재 동작 유지). 예: 변경허가 PDF 가 여러 개면
  //     마지막에 처리된 PDF 의 값이 남는다. 시계열 비교가 필요하면 추후 permit_date 기반 보강.
  //
  // 마이그레이션 호환:
  //   - 옛 'review_report' 값은 통합/변경 구분이 없으므로 보수적으로 통합허가와 동일 우선순위
  //     (priority=2) 로 취급한다. 새 잡이 들어오면 정확한 카테고리(integrated_first/change)로
  //     자연스럽게 갱신된다.
  type FacilitySource =
    | "integrated_change"
    | "integrated_first"
    | "annual_report"
    | "review_report" // legacy
    | "manual"
    | null;
  const sourcePriority = (t: FacilitySource): number => {
    switch (t) {
      case "integrated_change":
        return 3;
      case "integrated_first":
        return 2;
      case "review_report":
        return 2; // legacy — integrated_first 와 동등
      case "annual_report":
        return 1;
      default:
        return 0; // null / "manual" 등 — 어떤 잡이든 덮어쓰기 허용
    }
  };
  const incomingSource: FacilitySource =
    category === "annualReport"
      ? "annual_report"
      : category === "integratedChange"
      ? "integrated_change"
      : "integrated_first";

  if (!facilityId) {
    facilityId = `fac_${crypto.createHash("sha256").update(`${normCompany}|${brn ?? ""}`).digest("hex").slice(0, 16)}`;
    db.run(
      `INSERT INTO facilities
        (facility_id, company_name, business_registration_no, site_address, phone_number,
         industry_code, industry_name, normalized_company_name, normalized_address,
         region_sido, region_sigungu, source, source_doc_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ieps', ?, ?, ?)`,
      [facilityId, companyName, brn, address, phone, industryCode, industryName,
        normCompany, normAddress, region.sido, region.sigungu, incomingSource, now, now]
    );
    summary.facilitiesCreated++;
  } else {
    let existingSource: FacilitySource = null;
    const r = db.exec(
      `SELECT source_doc_type FROM facilities WHERE facility_id = ? LIMIT 1`,
      [facilityId]
    );
    if (r.length && r[0].values.length) {
      const v = r[0].values[0][0];
      existingSource = (v == null ? null : String(v)) as FacilitySource;
    }

    const lowerPriorityIncoming =
      sourcePriority(existingSource) > sourcePriority(incomingSource);

    if (lowerPriorityIncoming) {
      // 신뢰도가 더 낮은 출처 → NULL 결손 컬럼만 보강. source_doc_type 은 그대로 유지.
      db.run(
        `UPDATE facilities SET
           company_name = COALESCE(company_name, ?),
           business_registration_no = COALESCE(business_registration_no, ?),
           site_address = COALESCE(site_address, ?),
           phone_number = COALESCE(phone_number, ?),
           industry_code = COALESCE(industry_code, ?),
           industry_name = COALESCE(industry_name, ?),
           normalized_company_name = COALESCE(normalized_company_name, ?),
           normalized_address = COALESCE(normalized_address, ?),
           region_sido = COALESCE(region_sido, ?),
           region_sigungu = COALESCE(region_sigungu, ?),
           updated_at = ?
         WHERE facility_id = ?`,
        [companyName, brn, address, phone, industryCode, industryName,
          normCompany, normAddress, region.sido, region.sigungu, now, facilityId]
      );
    } else {
      // 같거나 더 높은 신뢰도 → 새 값으로 덮어쓰기 + source_doc_type 갱신.
      db.run(
        `UPDATE facilities SET
           company_name = COALESCE(?, company_name),
           business_registration_no = COALESCE(?, business_registration_no),
           site_address = COALESCE(?, site_address),
           phone_number = COALESCE(?, phone_number),
           industry_code = COALESCE(?, industry_code),
           industry_name = COALESCE(?, industry_name),
           normalized_company_name = COALESCE(?, normalized_company_name),
           normalized_address = COALESCE(?, normalized_address),
           region_sido = COALESCE(?, region_sido),
           region_sigungu = COALESCE(?, region_sigungu),
           source_doc_type = ?,
           updated_at = ?
         WHERE facility_id = ?`,
        [companyName, brn, address, phone, industryCode, industryName,
          normCompany, normAddress, region.sido, region.sigungu, incomingSource, now, facilityId]
      );
    }
    summary.facilitiesUpdated++;
  }

  // ── 카테고리별 적재 경로 분기 ─────────────────────────────────────
  //   - annualReport : permits/permit_scales/product_outputs 적재 안 함.
  //                    대신 facility_annual_reports 에 사업장당 1행 UPSERT.
  //                    "연간보고서는 허가가 아니라 점검 스냅샷" 정책에 맞춰 permit 행을
  //                    매년 누적 생성하던 기존 동작을 차단한다.
  //   - integrated*  : 기존대로 permits + permit_scales + product_outputs 적재.
  if (category === "annualReport") {
    const scaleNorm: any =
      scaleField && scaleField.normalized && typeof scaleField.normalized === "object"
        ? scaleField.normalized
        : {};
    const productItemsRaw: any[] = (() => {
      if (!productField || !productField.normalized) return [];
      const n = productField.normalized as any;
      if (Array.isArray(n)) return n;
      if (n && typeof n === "object") return [n];
      return [];
    })();
    const productItems = productItemsRaw
      .filter((it) => it && typeof it === "object" && it.product_name)
      .map((it) => ({
        product_name: it.product_name ?? null,
        amount: it.amount ?? null,
        unit: it.unit ?? null,
      }));

    db.run(
      `INSERT INTO facility_annual_reports
        (facility_id, report_year, air_class, air_amount_ton_per_year,
         water_class, wastewater_amount_m3_per_day, product_outputs_json,
         source_doc_id, source_attachment_id, source_pdf_path,
         source_page_scale, source_page_product, parsed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(facility_id) DO UPDATE SET
         air_class = COALESCE(excluded.air_class, facility_annual_reports.air_class),
         air_amount_ton_per_year = COALESCE(excluded.air_amount_ton_per_year, facility_annual_reports.air_amount_ton_per_year),
         water_class = COALESCE(excluded.water_class, facility_annual_reports.water_class),
         wastewater_amount_m3_per_day = COALESCE(excluded.wastewater_amount_m3_per_day, facility_annual_reports.wastewater_amount_m3_per_day),
         product_outputs_json = COALESCE(excluded.product_outputs_json, facility_annual_reports.product_outputs_json),
         source_doc_id = excluded.source_doc_id,
         source_attachment_id = excluded.source_attachment_id,
         source_pdf_path = excluded.source_pdf_path,
         source_page_scale = COALESCE(excluded.source_page_scale, facility_annual_reports.source_page_scale),
         source_page_product = COALESCE(excluded.source_page_product, facility_annual_reports.source_page_product),
         updated_at = excluded.updated_at`,
      [
        facilityId,
        // 보고 연도는 PDF 본문에서 별도 추출하지 않음 — 추후 확장 여지로 NULL 허용.
        null,
        scaleNorm.air_class ?? null,
        scaleNorm.air_amount_ton_per_year ?? null,
        scaleNorm.water_class ?? null,
        scaleNorm.wastewater_m3_per_day ?? null,
        productItems.length ? JSON.stringify(productItems) : null,
        docId,
        attachmentId,
        fileMeta?.pdfPath ?? null,
        scaleField?.sourcePage ?? null,
        productField?.sourcePage ?? null,
        now,
        now,
      ]
    );
  } else {
    // permits — integratedFirst / integratedChange 만 적재.
    const decisionNo = (asString(decisionField?.normalized) || decisionField?.value || "").trim() || null;
    const permitDate = (asString(permitDateField?.normalized) || permitDateField?.value || "").trim() || null;

    // permit_id 결정 우선순위:
    //  (1) decision_no 가 있으면 동일 결정번호의 기존 permit 재사용 (가장 안정적)
    //  (2) decision_no 가 null 이어도 facility+attachment 조합 결정해시(=과거에 INSERT한 동일 ID)가
    //      이미 DB 에 있으면 재사용. 이 단계가 빠져 있어 "decision_no 못 찾은 PDF" 의 재파싱 시
    //      `pmt_<sha256(facilityId|attachmentId)>` 가 그대로 재계산되어 UNIQUE 충돌이 발생했다.
    //  (3) 그래도 없으면 신규 INSERT.
    let permitId: string | null = null;
    if (decisionNo) {
      const r = db.exec(`SELECT permit_id FROM permits WHERE decision_no = ? LIMIT 1`, [decisionNo]);
      if (r.length && r[0].values.length) permitId = r[0].values[0][0] as string;
    }
    const candidateId = `pmt_${crypto
      .createHash("sha256")
      .update(`${facilityId}|${decisionNo ?? attachmentId}`)
      .digest("hex")
      .slice(0, 16)}`;
    if (!permitId) {
      const r2 = db.exec(`SELECT permit_id FROM permits WHERE permit_id = ? LIMIT 1`, [candidateId]);
      if (r2.length && r2[0].values.length) {
        permitId = candidateId;
      }
    }
    // 카테고리에 맞는 permit_type 라벨링 (통합허가 ↔ 변경허가 분리).
    const permitTypeLabel = category === "integratedChange" ? "변경허가" : "통합허가";

    if (!permitId) {
      permitId = candidateId;
      db.run(
        `INSERT INTO permits
          (permit_id, facility_id, decision_no, permit_type, permit_date, is_first_permit,
           source_doc_id, source_attachment_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          permitId,
          facilityId,
          decisionNo,
          permitTypeLabel,
          permitDate,
          // is_first_permit 은 통합허가(최초허가) 식별 용도이므로 변경허가는 항상 0.
          category === "integratedFirst" && isFirstPermit ? 1 : 0,
          docId,
          attachmentId,
          now,
          now,
        ]
      );
      summary.permitsCreated++;
    } else {
      db.run(
        `UPDATE permits SET
           facility_id = ?,
           decision_no = COALESCE(?, decision_no),
           permit_type = COALESCE(?, permit_type),
           permit_date = COALESCE(?, permit_date),
           is_first_permit = ?,
           source_doc_id = COALESCE(?, source_doc_id),
           source_attachment_id = COALESCE(?, source_attachment_id),
           updated_at = ?
         WHERE permit_id = ?`,
        [
          facilityId,
          decisionNo,
          permitTypeLabel,
          permitDate,
          category === "integratedFirst" && isFirstPermit ? 1 : 0,
          docId,
          attachmentId,
          now,
          permitId,
        ]
      );
      summary.permitsUpdated++;
    }

    // permit_scales (기존 행 제거 후 재삽입 - 1 permit : 1 scale)
    if (scaleField && scaleField.normalized && typeof scaleField.normalized === "object") {
      const norm: any = scaleField.normalized;
      db.run(`DELETE FROM permit_scales WHERE permit_id = ?`, [permitId]);
      db.run(
        `INSERT INTO permit_scales
          (permit_id, air_class, air_amount_ton_per_year, water_class, wastewater_amount_m3_per_day,
           source_page, source_text)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          permitId,
          norm.air_class ?? null,
          norm.air_amount_ton_per_year ?? null,
          norm.water_class ?? null,
          norm.wastewater_m3_per_day ?? null,
          scaleField.sourcePage ?? null,
          scaleField.sourceText ?? null,
        ]
      );
    }

    // product_outputs — 다중 생산품을 모두 적재한다 (1 permit : N products).
    //   - "주요 생산품" 섹션(productField) 항목: source_industry_code = NULL.
    //   - 업종 항목 옆 괄호에 부속된 생산품(industryField.normalized.products[]):
    //     source_industry_code = 그 업종 엔트리의 KSIC 코드. 통계에서 "업종에 명시된 생산품"
    //     과 본문 생산품을 구분 가능. 동일 PDF 안에서 두 출처에 같은 product_name 이 있으면
    //     아래 INSERT 가 두 행을 각각 만든다 — dedup 책임은 조회 측에 둔다 (출처 보존).
    db.run(`DELETE FROM product_outputs WHERE permit_id = ?`, [permitId]);

    if (productField && productField.normalized) {
      const norm = productField.normalized as any;
      const items: any[] = Array.isArray(norm)
        ? norm
        : norm && typeof norm === "object"
        ? [norm]
        : [];
      for (const item of items) {
        if (!item || typeof item !== "object" || !item.product_name) continue;
        db.run(
          `INSERT INTO product_outputs
            (permit_id, product_name, production_amount, production_unit, source_page, source_text, source_industry_code)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            permitId,
            item.product_name ?? null,
            item.amount ?? null,
            item.unit ?? null,
            productField.sourcePage ?? null,
            productField.sourceText ?? null,
            null,
          ]
        );
      }
    }

    // 업종 normalized 의 products[] 도 함께 적재 — KSIC 코드별로 출처를 묶어 둔다.
    if (industryField && industryField.normalized) {
      const indNorm = industryField.normalized as any;
      const entries: any[] = Array.isArray(indNorm)
        ? indNorm
        : indNorm && typeof indNorm === "object"
        ? [indNorm]
        : [];
      for (const e of entries) {
        if (!e || typeof e !== "object") continue;
        const code = e.code ? String(e.code) : null;
        const products: any[] = Array.isArray(e.products) ? e.products : [];
        for (const p of products) {
          const productName = typeof p === "string" ? p : p?.product_name ?? null;
          if (!productName) continue;
          db.run(
            `INSERT INTO product_outputs
              (permit_id, product_name, production_amount, production_unit, source_page, source_text, source_industry_code)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              permitId,
              productName,
              null,
              null,
              industryField.sourcePage ?? null,
              industryField.sourceText ?? null,
              code,
            ]
          );
        }
      }
    }
  }

  // parsed_fields (전 필드 적재 - 검수 대기열용)
  await insertParsedFields(db, attachmentId, docId, fields, now, fileMeta);
  summary.needsReview += fields.filter((f) => f.needsReview).length;

  saveDb();
}

async function insertParsedFields(
  db: any,
  attachmentId: string,
  docId: string,
  fields: ParsedField[],
  now: string,
  fileMeta?: { fileName?: string | null; pdfPath?: string | null }
): Promise<void> {
  // 동일 attachment + rule 조합 중복 제거
  db.run(`DELETE FROM parsed_fields WHERE attachment_id = ?`, [attachmentId]);
  for (const f of fields) {
    db.run(
      `INSERT INTO parsed_fields
        (attachment_id, doc_id, rule_id, field_label, raw_value, normalized_value,
         source_page, source_text, confidence, needs_review, reviewed_value, error,
         file_name, pdf_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        attachmentId,
        docId,
        f.ruleId,
        f.label,
        f.value ?? null,
        f.normalized !== undefined && f.normalized !== null
          ? typeof f.normalized === "string"
            ? f.normalized
            : JSON.stringify(f.normalized)
          : null,
        f.sourcePage ?? null,
        f.sourceText ?? null,
        f.confidence ?? 0,
        f.needsReview ? 1 : 0,
        null,
        // 백엔드 ParsedField.error("값을 찾지 못함" 등) 를 진단 익스포트에 그대로 노출.
        f.error ?? null,
        // 검수 대기열 진단에서 LEFT JOIN 깨짐 우회 — 파싱 시점의 파일명/원본 경로를 직적재.
        fileMeta?.fileName ?? null,
        fileMeta?.pdfPath ?? null,
        now,
      ]
    );
  }
}

function saveDb(): void {
  // sql.js는 인메모리 DB이므로 IEPS 전용 INSERT 이후 명시적으로 디스크에 flush.
  try {
    flushDbToDisk();
  } catch (err: any) {
    console.warn(`[DB] flush 실패: ${err?.message ?? err}`);
  }
}

// ============================================================
// 사업장 코드 체계 전환/정합성 후처리
// ============================================================

function execRows<T extends Record<string, any>>(db: any, sql: string, params: any[] = []): T[] {
  const out = db.exec(sql, params);
  if (!out.length) return [];
  const columns = out[0].columns;
  return out[0].values.map((values: any[]) => {
    const row: Record<string, any> = {};
    columns.forEach((col: string, idx: number) => {
      row[col] = values[idx];
    });
    return row as T;
  });
}

function normalizeBusinessRegistrationNo(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = String(value).replace(/\D+/g, "");
  return digits.length ? digits : null;
}

function normalizeLegalNameSeed(value: string | null | undefined): string {
  const compact = String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/㈜|\(주\)|（주）|\(유\)|（유）/g, "")
    .replace(/[\(\)（）]/g, "")
    .trim()
    .toLowerCase();
  return compact
    .replace(/주식회사|유한회사|합자회사|합명회사|재단법인|사단법인/g, "")
    .replace(/주(?=(공장|사업장|지점|지사|본사|분공장|$))/g, "")
    .replace(/공장|사업장|지점|지사|본사|분공장/g, "")
    .trim();
}

function branchLabelFromName(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = String(value).replace(/\s+/g, "");
  const m = /([가-힣A-Za-z0-9]+?(?:공장|사업장|지점|지사|본사|분공장))/.exec(compact);
  return m ? m[1] : null;
}

function stableBaseCode(seed: string): string {
  const hash = crypto.createHash("sha256").update(seed).digest("hex");
  const num = parseInt(hash.slice(0, 10), 16) % 100000;
  return String(num).padStart(5, "0");
}

function parsedFieldValue(row: { normalized_value: any; raw_value: any }): string | null {
  const normalized = row.normalized_value == null ? "" : String(row.normalized_value).trim();
  const raw = row.raw_value == null ? "" : String(row.raw_value).trim();
  if (!normalized && !raw) return null;
  if (normalized.startsWith("{") || normalized.startsWith("[")) return raw || normalized;
  return normalized || raw;
}

interface ParsedFacilityHint {
  permitId: string;
  currentFacilityId: string;
  attachmentId: string;
  companyName: string | null;
  brn: string | null;
  address: string | null;
}

function loadParsedFacilityHints(db: any): ParsedFacilityHint[] {
  const rows = execRows<{
    permit_id: string;
    facility_id: string;
    source_attachment_id: string | null;
    rule_id: string;
    raw_value: string | null;
    normalized_value: string | null;
  }>(
    db,
    `SELECT p.permit_id, p.facility_id, p.source_attachment_id,
            pf.rule_id, pf.raw_value, pf.normalized_value
       FROM permits p
       JOIN parsed_fields pf ON pf.attachment_id = p.source_attachment_id
      WHERE p.source_attachment_id IS NOT NULL
        AND pf.rule_id IN ('company_name', 'business_registration_no', 'site_address')
      ORDER BY p.permit_id, pf.rule_id`
  );
  const grouped = new Map<string, ParsedFacilityHint>();
  for (const row of rows) {
    const permitId = String(row.permit_id);
    const hint =
      grouped.get(permitId) ??
      {
        permitId,
        currentFacilityId: String(row.facility_id),
        attachmentId: String(row.source_attachment_id ?? ""),
        companyName: null,
        brn: null,
        address: null,
      };
    const value = parsedFieldValue(row);
    if (row.rule_id === "company_name") hint.companyName = value;
    else if (row.rule_id === "business_registration_no") {
      hint.brn = normalizeBusinessRegistrationNo(value);
    } else if (row.rule_id === "site_address") {
      hint.address = value;
    }
    grouped.set(permitId, hint);
  }
  return Array.from(grouped.values()).filter((h) => h.companyName || h.brn || h.address);
}

function findOrCreateFacilityForHint(
  db: any,
  hint: ParsedFacilityHint,
  now: string,
  apply: boolean
): string | null {
  const companyName = hint.companyName?.trim() || null;
  const brn = normalizeBusinessRegistrationNo(hint.brn);
  const address = hint.address?.trim() || null;
  const normCompany = normalizeCompanyName(companyName);
  const normAddress = normalizeAddress(address);
  const region = extractRegion(address);

  const candidates: { sql: string; params: any[] }[] = [];
  if (brn && normAddress) {
    candidates.push({
      sql: `SELECT facility_id FROM facilities
             WHERE business_registration_no = ? AND normalized_address = ?
             ORDER BY CASE WHEN normalized_company_name = ? THEN 0 ELSE 1 END
             LIMIT 1`,
      params: [brn, normAddress, normCompany],
    });
  }
  if (normCompany && normAddress) {
    candidates.push({
      sql: `SELECT facility_id FROM facilities
             WHERE normalized_company_name = ? AND normalized_address = ?
             LIMIT 1`,
      params: [normCompany, normAddress],
    });
  }
  if (brn && normCompany && !normAddress) {
    candidates.push({
      sql: `SELECT facility_id FROM facilities
             WHERE business_registration_no = ? AND normalized_company_name = ?
             LIMIT 1`,
      params: [brn, normCompany],
    });
  }

  let facilityId: string | null = null;
  for (const c of candidates) {
    const rows = execRows<{ facility_id: string }>(db, c.sql, c.params);
    if (rows.length) {
      facilityId = String(rows[0].facility_id);
      break;
    }
  }
  if (!facilityId && !companyName) return null;
  if (!facilityId && !apply) return null;
  if (!facilityId) {
    facilityId = `fac_${crypto
      .createHash("sha256")
      .update(`${normCompany}|${brn ?? ""}|${normAddress ?? ""}`)
      .digest("hex")
      .slice(0, 16)}`;
    db.run(
      `INSERT OR IGNORE INTO facilities
        (facility_id, company_name, business_registration_no, site_address,
         normalized_company_name, normalized_address, region_sido, region_sigungu,
         source, source_doc_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ieps', 'review_report', ?, ?)`,
      [
        facilityId,
        companyName,
        brn,
        address,
        normCompany,
        normAddress,
        region.sido,
        region.sigungu,
        now,
        now,
      ]
    );
  } else if (apply) {
    db.run(
      `UPDATE facilities SET
         company_name = COALESCE(?, company_name),
         business_registration_no = COALESCE(?, business_registration_no),
         site_address = COALESCE(?, site_address),
         normalized_company_name = COALESCE(?, normalized_company_name),
         normalized_address = COALESCE(?, normalized_address),
         region_sido = COALESCE(?, region_sido),
         region_sigungu = COALESCE(?, region_sigungu),
         updated_at = ?
       WHERE facility_id = ?`,
      [
        companyName,
        brn,
        address,
        normCompany,
        normAddress,
        region.sido,
        region.sigungu,
        now,
        facilityId,
      ]
    );
  }
  return facilityId;
}

interface FacilityRowForCode {
  facility_id: string;
  company_name: string | null;
  business_registration_no: string | null;
  site_address: string | null;
  normalized_company_name: string | null;
  normalized_address: string | null;
}

interface FacilityReconcileReport {
  relinkedPermits: number;
  mergedFacilities: number;
  renamedFacilities: number;
  updatedAnnualReports: number;
  collisions: string[];
  mappings: Array<{ oldFacilityId: string; newFacilityId: string; companyName: string | null }>;
}

function normalizeExistingFacilityAddresses(db: any, now: string, apply: boolean): void {
  const rows = execRows<{ facility_id: string; site_address: string | null; normalized_address: string | null }>(
    db,
    `SELECT facility_id, site_address, normalized_address FROM facilities`
  );
  for (const row of rows) {
    const next = normalizeAddress(row.site_address || row.normalized_address || null);
    if (!next || next === row.normalized_address || !apply) continue;
    db.run(`UPDATE facilities SET normalized_address = ?, updated_at = ? WHERE facility_id = ?`, [
      next,
      now,
      row.facility_id,
    ]);
  }
}

function mergeDuplicateFacilitiesByBranchKey(db: any, now: string, apply: boolean): number {
  const rows = execRows<FacilityRowForCode & { permits_count: number }>(
    db,
    `SELECT f.facility_id, f.company_name, f.business_registration_no, f.site_address,
            f.normalized_company_name, f.normalized_address,
            (SELECT COUNT(*) FROM permits p WHERE p.facility_id = f.facility_id) AS permits_count
       FROM facilities f
      WHERE f.business_registration_no IS NOT NULL
        AND f.normalized_company_name IS NOT NULL
        AND f.normalized_address IS NOT NULL
      ORDER BY f.business_registration_no, f.normalized_company_name, f.normalized_address, f.facility_id`
  );
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = [
      normalizeBusinessRegistrationNo(row.business_registration_no),
      normalizeCompanyName(row.normalized_company_name || row.company_name || ""),
      normalizeAddress(row.normalized_address || row.site_address || ""),
    ].join("|");
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  let merged = 0;
  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue;
    const sorted = [...bucket].sort((a, b) => {
      if (b.permits_count !== a.permits_count) return b.permits_count - a.permits_count;
      return String(a.facility_id).localeCompare(String(b.facility_id), "ko");
    });
    const target = sorted[0];
    for (const source of sorted.slice(1)) {
      merged++;
      if (!apply) continue;
      db.run(`UPDATE permits SET facility_id = ?, updated_at = ? WHERE facility_id = ?`, [
        target.facility_id,
        now,
        source.facility_id,
      ]);
      const hasTargetAnnual = execRows<{ c: number }>(
        db,
        `SELECT COUNT(*) AS c FROM facility_annual_reports WHERE facility_id = ?`,
        [target.facility_id]
      )[0]?.c;
      if (!hasTargetAnnual) {
        db.run(`UPDATE facility_annual_reports SET facility_id = ?, updated_at = ? WHERE facility_id = ?`, [
          target.facility_id,
          now,
          source.facility_id,
        ]);
      } else {
        db.run(`DELETE FROM facility_annual_reports WHERE facility_id = ?`, [source.facility_id]);
      }
      db.run(`DELETE FROM facilities WHERE facility_id = ?`, [source.facility_id]);
    }
  }
  return merged;
}

function mergeUnkeyedFacilitiesIntoBrnTargets(db: any, now: string, apply: boolean): number {
  const rows = execRows<FacilityRowForCode & { permits_count: number }>(
    db,
    `SELECT f.facility_id, f.company_name, f.business_registration_no, f.site_address,
            f.normalized_company_name, f.normalized_address,
            (SELECT COUNT(*) FROM permits p WHERE p.facility_id = f.facility_id) AS permits_count
       FROM facilities f
      ORDER BY f.facility_id`
  );
  const keyed = rows.filter((r) => normalizeBusinessRegistrationNo(r.business_registration_no));
  const unkeyed = rows.filter((r) => !normalizeBusinessRegistrationNo(r.business_registration_no));
  let merged = 0;

  for (const source of unkeyed) {
    const sourceRoot = normalizeLegalNameSeed(source.normalized_company_name || source.company_name || "");
    const sourceAddress = normalizeAddress(source.normalized_address || source.site_address || "");
    const sourceBranch = branchLabelFromName(source.company_name || source.normalized_company_name);
    if (!sourceRoot) continue;

    const candidates = keyed.filter((target) => {
      const targetRoot = normalizeLegalNameSeed(target.normalized_company_name || target.company_name || "");
      if (targetRoot !== sourceRoot) return false;
      const targetAddress = normalizeAddress(target.normalized_address || target.site_address || "");
      if (sourceAddress && targetAddress && sourceAddress === targetAddress) return true;
      if (!sourceAddress && sourceBranch) {
        const targetBranch = branchLabelFromName(target.company_name || target.normalized_company_name);
        return targetBranch === sourceBranch;
      }
      return false;
    });
    if (candidates.length !== 1) continue;

    const target = candidates[0];
    merged++;
    if (!apply) continue;
    db.run(`UPDATE permits SET facility_id = ?, updated_at = ? WHERE facility_id = ?`, [
      target.facility_id,
      now,
      source.facility_id,
    ]);
    const hasTargetAnnual = execRows<{ c: number }>(
      db,
      `SELECT COUNT(*) AS c FROM facility_annual_reports WHERE facility_id = ?`,
      [target.facility_id]
    )[0]?.c;
    if (!hasTargetAnnual) {
      db.run(`UPDATE facility_annual_reports SET facility_id = ?, updated_at = ? WHERE facility_id = ?`, [
        target.facility_id,
        now,
        source.facility_id,
      ]);
    } else {
      db.run(`DELETE FROM facility_annual_reports WHERE facility_id = ?`, [source.facility_id]);
    }
    db.run(`DELETE FROM facilities WHERE facility_id = ?`, [source.facility_id]);
  }
  return merged;
}

async function reconcileFacilityBranches(apply: boolean): Promise<FacilityReconcileReport> {
  const db = await getDbAsync();
  const now = new Date().toISOString();
  const report: FacilityReconcileReport = {
    relinkedPermits: 0,
    mergedFacilities: 0,
    renamedFacilities: 0,
    updatedAnnualReports: 0,
    collisions: [],
    mappings: [],
  };

  if (apply) {
    db.run(`DROP INDEX IF EXISTS idx_facilities_brn_company`);
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_facilities_brn_company_address
      ON facilities(business_registration_no, normalized_company_name, normalized_address)
      WHERE business_registration_no IS NOT NULL
        AND normalized_company_name IS NOT NULL
        AND normalized_address IS NOT NULL
    `);
  }

  const hints = loadParsedFacilityHints(db);
  for (const hint of hints) {
    const targetFacilityId = findOrCreateFacilityForHint(db, hint, now, apply);
    if (!targetFacilityId || targetFacilityId === hint.currentFacilityId) continue;
    report.relinkedPermits++;
    if (apply) {
      db.run(`UPDATE permits SET facility_id = ?, updated_at = ? WHERE permit_id = ?`, [
        targetFacilityId,
        now,
        hint.permitId,
      ]);
    }
  }

  normalizeExistingFacilityAddresses(db, now, apply);
  report.mergedFacilities = mergeDuplicateFacilitiesByBranchKey(db, now, apply);
  report.mergedFacilities += mergeUnkeyedFacilitiesIntoBrnTargets(db, now, apply);

  const facilities = execRows<FacilityRowForCode>(
    db,
    `SELECT facility_id, company_name, business_registration_no, site_address,
            normalized_company_name, normalized_address
       FROM facilities
      ORDER BY business_registration_no, normalized_company_name, normalized_address, facility_id`
  );

  const clusters = new Map<string, FacilityRowForCode[]>();
  for (const facility of facilities) {
    const brn = normalizeBusinessRegistrationNo(facility.business_registration_no);
    const nameSeed = normalizeLegalNameSeed(
      facility.normalized_company_name || facility.company_name || ""
    );
    const fallbackSeed =
      nameSeed ||
      normalizeAddress(facility.normalized_address || facility.site_address || "") ||
      facility.facility_id;
    const clusterKey = brn ? `brn:${brn}` : `name:${fallbackSeed}`;
    const bucket = clusters.get(clusterKey) ?? [];
    bucket.push(facility);
    clusters.set(clusterKey, bucket);
  }

  const usedBases = new Map<string, string>();
  const finalIds = new Map<string, string>();
  for (const [clusterKey, bucket] of clusters) {
    const seed = clusterKey.startsWith("brn:")
      ? clusterKey.slice(4)
      : bucket
          .map((f) => normalizeLegalNameSeed(f.normalized_company_name || f.company_name || ""))
          .find(Boolean) || clusterKey;
    let base = stableBaseCode(seed);
    while (usedBases.has(base) && usedBases.get(base) !== clusterKey) {
      base = String((Number(base) + 1) % 100000).padStart(5, "0");
    }
    usedBases.set(base, clusterKey);

    const sorted = [...bucket].sort((a, b) => {
      const aBranch = branchLabelFromName(a.company_name || a.normalized_company_name);
      const bBranch = branchLabelFromName(b.company_name || b.normalized_company_name);
      const aRank = aBranch && !/본사/.test(aBranch) ? 1 : 0;
      const bRank = bBranch && !/본사/.test(bBranch) ? 1 : 0;
      if (aRank !== bRank) return aRank - bRank;
      const aKey = `${normalizeAddress(a.normalized_address || a.site_address || "")}|${aBranch ?? ""}|${a.facility_id}`;
      const bKey = `${normalizeAddress(b.normalized_address || b.site_address || "")}|${bBranch ?? ""}|${b.facility_id}`;
      return aKey.localeCompare(bKey, "ko");
    });
    sorted.forEach((facility, idx) => {
      const newId = `${base}-${String(idx).padStart(2, "0")}`;
      finalIds.set(facility.facility_id, newId);
      if (facility.facility_id !== newId) {
        report.mappings.push({
          oldFacilityId: facility.facility_id,
          newFacilityId: newId,
          companyName: facility.company_name ?? null,
        });
      }
    });
  }

  const duplicateNewIds = new Map<string, string[]>();
  for (const [oldId, newId] of finalIds) {
    const ids = duplicateNewIds.get(newId) ?? [];
    ids.push(oldId);
    duplicateNewIds.set(newId, ids);
  }
  for (const [newId, oldIds] of duplicateNewIds) {
    if (oldIds.length > 1) report.collisions.push(`${newId}: ${oldIds.join(", ")}`);
  }
  if (report.collisions.length || !apply) return report;

  const mappings = report.mappings;
  for (const { oldFacilityId } of mappings) {
    const tmpId = `__tmp__${oldFacilityId}`;
    db.run(`UPDATE facilities SET facility_id = ? WHERE facility_id = ?`, [tmpId, oldFacilityId]);
    db.run(`UPDATE permits SET facility_id = ? WHERE facility_id = ?`, [tmpId, oldFacilityId]);
    db.run(`UPDATE facility_annual_reports SET facility_id = ? WHERE facility_id = ?`, [
      tmpId,
      oldFacilityId,
    ]);
  }
  for (const { oldFacilityId, newFacilityId } of mappings) {
    const tmpId = `__tmp__${oldFacilityId}`;
    db.run(`UPDATE facilities SET facility_id = ?, updated_at = ? WHERE facility_id = ?`, [
      newFacilityId,
      now,
      tmpId,
    ]);
    db.run(`UPDATE permits SET facility_id = ?, updated_at = ? WHERE facility_id = ?`, [
      newFacilityId,
      now,
      tmpId,
    ]);
    db.run(`UPDATE facility_annual_reports SET facility_id = ?, updated_at = ? WHERE facility_id = ?`, [
      newFacilityId,
      now,
      tmpId,
    ]);
  }

  report.renamedFacilities = mappings.length;
  report.updatedAnnualReports = execRows<{ c: number }>(
    db,
    `SELECT COUNT(*) AS c FROM facility_annual_reports`
  )[0]?.c ?? 0;
  saveDb();
  return report;
}

async function runFacilityReconcile(apply: boolean): Promise<void> {
  const report = await reconcileFacilityBranches(apply);
  log(
    `[FACILITY] relink permits=${report.relinkedPermits}, merge facilities=${report.mergedFacilities}, rename facilities=${report.mappings.length}, collisions=${report.collisions.length}`
  );
  if (report.mappings.length) {
    log(
      `[FACILITY] mappings preview: ${report.mappings
        .slice(0, 20)
        .map((m) => `${m.oldFacilityId}->${m.newFacilityId}(${m.companyName ?? ""})`)
        .join(", ")}`
    );
  }
  if (report.collisions.length) {
    log(`[FACILITY] 충돌 후보: ${report.collisions.join(" | ")}`, "warn");
  }
  emit({ event: "facility_reconcile", apply, report });
}

// ============================================================
// parse-only — raw/ 아래 PDF 중 카테고리별로만 파싱+적재
//   integratedFirst / integratedChange : 검토결과서(파일명 기준) AND
//                                         documents.title 의 카테고리 접두사 매칭
//   annualReport                       : 연간보고서(파일명 기준) — 접두사 매칭은 보조
//
// raw/ 폴더에서 통합허가와 변경허가는 같은 검토결과서 형식이라 파일명만으론 구분 불가.
// 따라서 attachments→documents JOIN 으로 게시 제목의 `[통합허가, ...]` / `[변경허가, ...]`
// 접두사를 보고 분류한다 (게시판 자체가 gubunList 카테고리 코드로 사전 분류돼 있어
// 이 접두사는 사실상 카테고리 코드와 동치).
// ============================================================

interface ParseTarget {
  pdfPath: string;
  fileName: string;
  postId: string;
  yearFolder: string;
  documentType: DocumentType;
  /** documents.title (있으면). 카테고리 접두사 매칭에 사용. */
  docTitle: string | null;
  /** 매칭된 attachments.file_id (있으면). upsert 시 deterministic ID 와 비교용. */
  matchedAttachmentId: string | null;
  /** 매칭된 documents.doc_id (있으면). upsert 시 사용. */
  matchedDocId: string | null;
}

const CATEGORY_TITLE_RE: Record<ParseOnlyCategory, RegExp> = {
  // 게시판 카테고리 접두사. 공백/괄호 변형 흡수 (`[통합허가, 섬유]` / `【통합허가】` 등 가벼운 변형 대비).
  integratedFirst: /\[\s*통\s*합\s*허\s*가/,
  integratedChange: /\[\s*변\s*경\s*허\s*가/,
  annualReport: /\[\s*연\s*간\s*(?:점검\s*)?보\s*고\s*서/,
};

const CATEGORY_LABEL: Record<ParseOnlyCategory, string> = {
  integratedFirst: "통합허가",
  integratedChange: "변경허가",
  annualReport: "연간보고서",
};

/**
 * 문서 종류 + 게시 제목으로 카테고리(통합허가/변경허가/연간보고서) 추정.
 *
 * `runParseOnly` 는 사용자가 명시적으로 카테고리를 지정하므로 호출 시 그 값을 직접
 * 넘기지만, 호환을 위해 남아 있는 `main()` 4단계 적재 경로(현재는 `downloadOnly` 가
 * 항상 true 라 실질 비활성)는 자체적으로 카테고리를 결정해야 해서 이 헬퍼를 둔다.
 *
 * 우선순위:
 *  - documentType=annual_report → annualReport (제목 무관)
 *  - 제목에 [변경허가] 접두사 → integratedChange
 *  - 그 외 검토결과서 → integratedFirst (폴백)
 */
function categorizeFromTitle(
  documentType: DocumentType,
  title: string | null | undefined
): ParseOnlyCategory {
  if (documentType === "annual_report") return "annualReport";
  if (title) {
    if (CATEGORY_TITLE_RE.integratedChange.test(title)) return "integratedChange";
    if (CATEGORY_TITLE_RE.integratedFirst.test(title)) return "integratedFirst";
  }
  return "integratedFirst";
}

/**
 * 다운로드된 PDF 첨부 전수를 attachments/documents JOIN 으로 가져온다.
 *
 * raw/ 폴더 스캔 방식이 아니라 DB-driven 으로 가는 이유:
 *  - 과거 잡 실행 시 `runScraper` 가 첨부를 `data/ieps/scrape/.../attachments/` 로
 *    1차 다운로드한 뒤, `cli-collect` 의 raw/ 이전 단계에서 article.attachments
 *    가 비어 있는 게시물(이미 documents 에 등록된 stale 게시물 등)을 만나면
 *    raw/ 로 복사가 누락되는 케이스가 누적된다. 그 결과 `data/ieps/raw/` 만
 *    스캔하면 통합허가 720건 중 ~490건, 변경허가/연간보고서는 거의 0건만 잡혀
 *    "파싱 대상이 게시판 카운트보다 훨씬 적은" 사용자 신고 상황이 발생한다.
 *  - attachments 테이블의 `local_path` 는 raw/ 든 attachments/ 든 실제 파일
 *    위치를 그대로 가리키고 있어, 어느 폴더에 있든 동일하게 처리할 수 있다.
 *
 * 또한 documents.title 의 카테고리 접두사(`[통합허가, ...]` / `[변경허가, ...]` /
 * `[연간보고서] ...`)가 카테고리 분류의 정확한 신호이므로 `targetMatchesCategory`
 * 가 그대로 활용한다.
 */
async function walkDownloadedPdfs(): Promise<ParseTarget[]> {
  const targets: ParseTarget[] = [];
  const db = await getDbAsync();

  let rows: ReturnType<typeof db.exec>;
  try {
    rows = db.exec(
      `SELECT a.file_id, a.doc_id, a.file_name, a.local_path,
              d.title, d.source_url, d.published_date
         FROM attachments a
         JOIN documents d ON d.doc_id = a.doc_id
        WHERE d.board_id = 'ieps-integrated-permit'
          AND a.status = 'downloaded'
          AND a.local_path IS NOT NULL
          AND a.local_path <> ''
          AND LOWER(a.file_name) LIKE '%.pdf'`
    );
  } catch (err: any) {
    log(`[PARSE] attachments JOIN 실패: ${err?.message ?? err}`, "warn");
    return targets;
  }
  if (!rows.length) return targets;

  let missingFile = 0;
  let unclassified = 0;
  for (const row of rows[0].values) {
    const fileId = row[0] as string;
    const docId = (row[1] as string) ?? null;
    const fileName = (row[2] as string) ?? "";
    const localPath = (row[3] as string) ?? "";
    const docTitle = (row[4] as string) ?? null;
    const sourceUrl = (row[5] as string) ?? "";
    const publishedDate = (row[6] as string) ?? "";

    if (!localPath || !fs.existsSync(localPath)) {
      missingFile++;
      continue;
    }
    if (!isPdfAttachment(fileName, fileName)) continue;

    // documentType 식별 — 파일명만 부정확하면 docTitle 의 카테고리 접두사로 보강.
    const docType = classifyDocumentType(fileName, docTitle ?? undefined);
    if (!docType) {
      unclassified++;
      continue;
    }

    // postId / yearFolder 는 파싱 결과 JSON 저장 경로(EXTRACTED_ROOT/<year>/<postId>) 산정용.
    // - postId : 게시 URL 에서 숫자 ID, 못 찾으면 sha256 prefix (cli-collect 다운로드와 동일 규약).
    // - yearFolder : 게시일 앞 4자리. 게시일이 없으면 현재 연도로 폴백.
    const postId = sourceUrl ? extractPostId(sourceUrl) : (docId?.slice(-12) || "unknown");
    const yearFolder = (publishedDate || new Date().toISOString()).slice(0, 4);

    targets.push({
      pdfPath: localPath,
      fileName,
      postId,
      yearFolder,
      documentType: docType,
      docTitle,
      matchedAttachmentId: fileId,
      matchedDocId: docId,
    });
  }
  if (missingFile > 0) {
    log(`[PARSE] local_path 가 가리키는 파일이 사라진 첨부 ${missingFile}건은 건너뜀.`, "warn");
  }
  if (unclassified > 0) {
    log(`[PARSE] 파일명/제목으로 카테고리 식별 실패 첨부 ${unclassified}건은 건너뜀.`, "warn");
  }
  return targets;
}

/**
 * 카테고리 + 파일명 + 게시 제목 접두사를 종합해 `target` 이 이번 파싱 잡의 처리 대상인지 결정.
 *
 * 기본 원칙 (walkDownloadedPdfs 가 DB-driven 이라 docTitle 이 항상 채워진다는 가정):
 *  - integratedFirst / integratedChange : documentType=review_report AND docTitle 의 카테고리 접두사 매칭.
 *  - annualReport                       : documentType=annual_report AND docTitle 의 카테고리 접두사 매칭.
 *
 * docTitle 이 비어 있는 경우(DB 누락 등 엣지) — 파일명 폴백 분류만 신뢰한다.
 *  - integratedFirst : review_report 형식 PDF 라면 통합허가 잡에 포함 (변경허가 잡과 중복 회피).
 *  - integratedChange / annualReport : 게시 제목 신호가 없으면 제외 (오분류 방지가 우선).
 */
function targetMatchesCategory(target: ParseTarget, category: ParseOnlyCategory): boolean {
  const wantedRe = CATEGORY_TITLE_RE[category];
  if (category === "annualReport") {
    if (target.documentType !== "annual_report") return false;
    return target.docTitle ? wantedRe.test(target.docTitle) : false;
  }

  // integratedFirst / integratedChange : 모두 review_report 형식.
  if (target.documentType !== "review_report") return false;
  if (target.docTitle) {
    return wantedRe.test(target.docTitle);
  }
  // docTitle 결손 시 — 통합허가 잡에서만 처리해 변경허가 잡과 중복되지 않도록.
  return category === "integratedFirst";
}

/**
 * 1회성 마이그레이션 — 기존에 `permit_type='연간보고서'` 로 적재되었던 permit 행을
 * `facility_annual_reports` 로 옮기고 permit_scales / product_outputs / permits 에서
 * 제거한다.
 *
 * 멱등성:
 *  - 같은 facility 의 facility_annual_reports 행이 이미 있으면 ON CONFLICT 로 결손
 *    컬럼만 보강 (덮어쓰지 않음).
 *  - 변환 끝낸 permit 은 그대로 DELETE 되므로 재실행 시 0 건이면 no-op 으로 종료.
 */
async function runMigrateAnnualReports(): Promise<void> {
  const db = await getDbAsync();
  const now = new Date().toISOString();

  let rows: ReturnType<typeof db.exec>;
  try {
    rows = db.exec(
      `SELECT permit_id, facility_id, source_doc_id, source_attachment_id
         FROM permits
        WHERE permit_type = '연간보고서'`
    );
  } catch (err: any) {
    log(`[MIGRATE] permits 조회 실패: ${err?.message ?? err}`, "error");
    return;
  }

  const records: { permitId: string; facilityId: string; docId: string | null; attId: string | null }[] = [];
  if (rows.length && rows[0].values.length) {
    for (const row of rows[0].values) {
      records.push({
        permitId: String(row[0]),
        facilityId: String(row[1]),
        docId: row[2] == null ? null : String(row[2]),
        attId: row[3] == null ? null : String(row[3]),
      });
    }
  }

  if (records.length === 0) {
    log("[MIGRATE] 이전 대상 permit_type='연간보고서' 행이 없습니다 — no-op.");
    return;
  }

  log(`[MIGRATE] permit_type='연간보고서' ${records.length} 건 발견 → facility_annual_reports 로 이관 시작`);

  let movedFar = 0;
  let removedScales = 0;
  let removedProducts = 0;
  let removedPermits = 0;

  for (const rec of records) {
    // permit_scales 1건 → air_class / water_class / amount
    let air: any = { air_class: null, air_amount: null, water_class: null, wastewater: null };
    const scaleRows = db.exec(
      `SELECT air_class, air_amount_ton_per_year, water_class, wastewater_amount_m3_per_day
         FROM permit_scales WHERE permit_id = ? LIMIT 1`,
      [rec.permitId]
    );
    if (scaleRows.length && scaleRows[0].values.length) {
      const r = scaleRows[0].values[0];
      air = {
        air_class: r[0] ?? null,
        air_amount: r[1] ?? null,
        water_class: r[2] ?? null,
        wastewater: r[3] ?? null,
      };
    }

    // product_outputs N건 → JSON 배열
    const productRows = db.exec(
      `SELECT product_name, production_amount, production_unit
         FROM product_outputs WHERE permit_id = ?`,
      [rec.permitId]
    );
    const productItems: { product_name: string | null; amount: number | null; unit: string | null }[] = [];
    if (productRows.length && productRows[0].values.length) {
      for (const r of productRows[0].values) {
        productItems.push({
          product_name: r[0] == null ? null : String(r[0]),
          amount: r[1] == null ? null : Number(r[1]),
          unit: r[2] == null ? null : String(r[2]),
        });
      }
    }

    db.run(
      `INSERT INTO facility_annual_reports
        (facility_id, report_year, air_class, air_amount_ton_per_year,
         water_class, wastewater_amount_m3_per_day, product_outputs_json,
         source_doc_id, source_attachment_id, source_pdf_path,
         source_page_scale, source_page_product, parsed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(facility_id) DO UPDATE SET
         air_class = COALESCE(facility_annual_reports.air_class, excluded.air_class),
         air_amount_ton_per_year = COALESCE(facility_annual_reports.air_amount_ton_per_year, excluded.air_amount_ton_per_year),
         water_class = COALESCE(facility_annual_reports.water_class, excluded.water_class),
         wastewater_amount_m3_per_day = COALESCE(facility_annual_reports.wastewater_amount_m3_per_day, excluded.wastewater_amount_m3_per_day),
         product_outputs_json = COALESCE(facility_annual_reports.product_outputs_json, excluded.product_outputs_json),
         updated_at = excluded.updated_at`,
      [
        rec.facilityId,
        null,
        air.air_class,
        air.air_amount,
        air.water_class,
        air.wastewater,
        productItems.length ? JSON.stringify(productItems) : null,
        rec.docId,
        rec.attId,
        null,
        null,
        null,
        now,
        now,
      ]
    );
    movedFar++;

    db.run(`DELETE FROM permit_scales WHERE permit_id = ?`, [rec.permitId]);
    removedScales++;
    db.run(`DELETE FROM product_outputs WHERE permit_id = ?`, [rec.permitId]);
    removedProducts++;
    db.run(`DELETE FROM permits WHERE permit_id = ?`, [rec.permitId]);
    removedPermits++;
  }

  saveDb();
  log(
    `[MIGRATE] 완료 — facility_annual_reports +${movedFar}, permit_scales -${removedScales}, product_outputs -${removedProducts}, permits -${removedPermits}`
  );
}

/**
 * 1회성 cleanup — attachments 와 매칭되지 않는 orphan parsed_fields 행을 일괄 제거.
 *
 * legacy attachment_id 패턴(`att_<short16hash>`) 으로 적재된 검수 대기열 노이즈가 누적되어
 * 검수 화면이 가양성으로 가득 차는 문제를 1회 정리한다. attachments 테이블의 file_id
 * (현재 패턴: `file_<board>_<docHash>_<attHash>`) 와 매칭되지 않는 행을 모두 제거하므로,
 * 다음번 카테고리 잡 실행에서 새로 INSERT 되는 정상 행만 남는다.
 *
 * 멱등 — 매칭되는 행은 건드리지 않으므로 반복 실행해도 안전.
 */
async function runCleanupOrphanParsedFields(): Promise<void> {
  const db = await getDbAsync();

  let beforeRows: ReturnType<typeof db.exec>;
  try {
    beforeRows = db.exec(
      `SELECT COUNT(*) AS n_total,
              SUM(CASE WHEN attachment_id NOT IN (SELECT file_id FROM attachments) THEN 1 ELSE 0 END) AS n_orphan
         FROM parsed_fields`
    );
  } catch (err: any) {
    log(`[CLEANUP] parsed_fields 조회 실패: ${err?.message ?? err}`, "error");
    return;
  }
  const before = beforeRows[0]?.values?.[0];
  const total = before ? Number(before[0]) : 0;
  const orphan = before ? Number(before[1]) : 0;
  if (orphan === 0) {
    log(`[CLEANUP] orphan parsed_fields 없음 — no-op (전체 ${total}건).`);
    return;
  }
  log(`[CLEANUP] 전체 parsed_fields ${total}건 중 orphan ${orphan}건 제거 시작`);

  try {
    db.run(
      `DELETE FROM parsed_fields WHERE attachment_id NOT IN (SELECT file_id FROM attachments)`
    );
  } catch (err: any) {
    log(`[CLEANUP] DELETE 실패: ${err?.message ?? err}`, "error");
    return;
  }
  saveDb();
  log(`[CLEANUP] 완료 — parsed_fields -${orphan}`);
}

async function runParseOnly(opts: CliOptions, category: ParseOnlyCategory): Promise<void> {
  log(`[PARSE] category=${category} (${CATEGORY_LABEL[category]}), backend=${opts.backendUrl}`);
  const config = loadCollectionConfig(opts.configPath);
  // 카테고리별 파싱 시에는 백엔드의 BUILTIN_RULES를 그대로 사용하도록 빈 룰을 보낸다.
  // (frontend가 stale한 룰 정의를 들고 있을 가능성을 배제 — DB에 저장된 config를 우회)
  const parseConfig: CollectionConfig = {
    ...config,
    extractionRules: [],
    activeRuleIds: undefined,
  };

  // attachments 테이블 기준으로 다운로드 성공 PDF 전수를 본다 (raw/ 폴더 스캔이 아닌 DB-driven).
  // 이렇게 해야 raw/ 와 scrape/.../attachments/ 두 위치 어디에 있든 동일하게 처리되며,
  // 게시판 카테고리(통합허가 720 / 변경허가 282 / 연간보고서 1,811)와 파싱 대상 수가 일치한다.
  const all = await walkDownloadedPdfs();
  const targets = all.filter((t) => targetMatchesCategory(t, category));
  log(
    `[PARSE] 다운로드된 PDF ${all.length}건 중 ${CATEGORY_LABEL[category]} 대상 ${targets.length}건 파싱 시작`
  );
  emit({
    event: "parse",
    phase: "start",
    total: targets.length,
    current: 0,
    category,
  });

  const titleKeywords = ["최초허가"];
  const summary: UpsertSummary = {
    facilitiesCreated: 0,
    facilitiesUpdated: 0,
    permitsCreated: 0,
    permitsUpdated: 0,
    needsReview: 0,
  };
  const parsedFiles: string[] = [];
  const parseFailures: Array<{ pdfPath: string; reason: string }> = [];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    try {
      const parsed = await callBackendParse(
        t.pdfPath,
        parseConfig,
        opts.backendUrl,
        t.documentType
      );
      if (!parsed) {
        parseFailures.push({ pdfPath: t.pdfPath, reason: "backend 응답 실패" });
        emit({
          event: "parse",
          postId: t.postId,
          status: "failed",
          current: i + 1,
          total: targets.length,
        });
        continue;
      }
      const jsonOut = saveParsedJson(parsed, t.postId, t.yearFolder, t.fileName);
      parsedFiles.push(jsonOut);
      emit({
        event: "parse",
        postId: t.postId,
        status: "ok",
        current: i + 1,
        total: targets.length,
      });

      if (opts.dryRun) continue;

      // attachmentId / docId 는 cli-collect 다운로드 단계와 동일한 deterministic 해시.
      // walkRawPdfs() 가 이미 매칭에 성공한 경우 그 값을 우선 사용.
      const fallbackAttId =
        "att_" +
        crypto.createHash("sha256").update(`${t.postId}|${t.fileName}`).digest("hex").slice(0, 16);
      const attachmentId = t.matchedAttachmentId ?? fallbackAttId;
      const docId =
        t.matchedDocId ??
        `doc_${crypto
          .createHash("sha256")
          .update(`${t.postId}|${t.fileName}`)
          .digest("hex")
          .slice(0, 16)}`;
      const isFirst = isFirstPermit(
        { title: t.docTitle ?? "" } as ScrapedArticle,
        titleKeywords
      );

      const before = { ...summary };
      await upsertParsedDocument(
        parsed,
        attachmentId,
        docId,
        isFirst,
        t.postId,
        summary,
        { fileName: t.fileName, pdfPath: t.pdfPath },
        t.documentType,
        category
      );
      const facCreated = summary.facilitiesCreated - before.facilitiesCreated;
      const facUpdated = summary.facilitiesUpdated - before.facilitiesUpdated;
      const companyField = parsed.fields?.find((f) => f.ruleId === "company_name");
      const facName = (companyField?.value as string | null) ?? null;
      emit({
        event: "upsert",
        facility: facName ?? t.postId,
        permitId: attachmentId,
        current: i + 1,
        total: targets.length,
        created: facCreated,
        updated: facUpdated,
      });
    } catch (err: any) {
      parseFailures.push({ pdfPath: t.pdfPath, reason: err?.message ?? String(err) });
      emit({
        event: "parse",
        postId: t.postId,
        status: "failed",
        current: i + 1,
        total: targets.length,
      });
      log(`[PARSE] parse 실패(${t.pdfPath}): ${err?.message ?? err}`, "warn");
    }
  }

  log(
    `[PARSE:${category}] 완료: 성공 ${parsedFiles.length} / 실패 ${parseFailures.length} / 사업장 신규 ${summary.facilitiesCreated} / 갱신 ${summary.facilitiesUpdated} / 검수 ${summary.needsReview}`
  );
  if (!opts.dryRun) {
    await runFacilityReconcile(true);
  }
  emit({
    event: "done",
    summary: {
      mode: "parse-only",
      category,
      attempted: targets.length,
      succeeded: parsedFiles.length,
      failed: parseFailures.length,
      upsert: summary,
      failures: parseFailures.slice(0, 20),
    },
  });
}

// ============================================================
// 메인
// ============================================================

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.showHelp) {
    printHelp();
    return;
  }
  JSON_PROGRESS = opts.jsonProgress;

  // 1회성 데이터 마이그레이션 — permit_type='연간보고서' permit 행을
  // facility_annual_reports 로 옮기고 정리. 다른 옵션과 동시 사용을 막아 부수 작용 차단.
  if (opts.migrateAnnualReports) {
    currentJobId = `migrate_annual_${Date.now()}`;
    await runMigrateAnnualReports();
    return;
  }

  // 1회성 cleanup — attachments 와 매칭되지 않는 parsed_fields(orphan) 행 제거.
  // 옛 알고리즘 시점에 적재된 stale 검수 대기열을 일소한다.
  if (opts.cleanupOrphanParsedFields) {
    currentJobId = `cleanup_orphans_${Date.now()}`;
    await runCleanupOrphanParsedFields();
    return;
  }

  // 사업장 코드 체계 전환/참조 재매핑 후처리 단독 실행.
  if (opts.reconcileFacilities) {
    currentJobId = `reconcile_facilities_${Date.now()}`;
    await runFacilityReconcile(!opts.dryRun);
    return;
  }

  // --parse-only 가 설정되면 raw/ 아래 카테고리별 파싱+적재만 수행하고 종료.
  if (opts.parseOnly) {
    currentJobId = `parse_${opts.parseOnly}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await runParseOnly(opts, opts.parseOnly);
    return;
  }

  // 라운드 3 — 잡 ID 생성 (download_events / alerts 매칭용)
  currentJobId = `cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const targets = loadTargets(path.join(SCRAPER_ROOT, "data"));
  const board = findBoard(targets, opts.boardId);
  const org = board ? findOrg(targets, board.org_id) : undefined;
  if (!board || !org) {
    log(`보드 ${opts.boardId}를 찾지 못했습니다`, "error");
    emit({ event: "error", message: `board not found: ${opts.boardId}` });
    process.exit(1);
  }

  const config = loadCollectionConfig(opts.configPath);
  const titleKeywords = (board.collection_targets as any)?.title_keywords ?? ["최초허가"];

  // collection_range from CLI / config
  if (opts.fromDate) {
    board.collection_range = {
      type: "period",
      period_start: opts.fromDate,
      period_end: undefined,
    } as any;
  } else if (config.collectionRange?.startDate || config.collectionRange?.endDate) {
    board.collection_range = {
      type: "period",
      period_start: config.collectionRange.startDate ?? undefined,
      period_end: config.collectionRange.endDate ?? undefined,
    } as any;
  }

  // 카테고리 사전 필터: config.filters → IEPS gubunList 쿼리 파라미터 주입
  const userFiltersForUrl = (config.filters ?? []).map((f) => String(f));
  if (board.list_url) {
    const before = board.list_url;
    const after = applyGubunListToUrl(before, userFiltersForUrl);
    if (after !== before) {
      board.list_url = after;
      log(`수집 필터: gubunList 적용 → ${after}`);
    }
  }

  log(`board=${board.board_id}, max-pages=${opts.maxPages}, backend=${opts.backendUrl}`);

  // 1) 게시판 스크래핑 (documents/attachments까지 SQLite에 적재됨)
  emit({ event: "scrape", phase: "start", total: opts.maxPages, current: 0 });
  const scrapeOutDir = path.join(DATA_ROOT, "scrape");
  fs.mkdirSync(scrapeOutDir, { recursive: true });
  let scrapeResult: ScrapingResult;
  try {
    scrapeResult = await runScraper({
      board,
      org,
      outputDir: scrapeOutDir,
      maxPages: opts.maxPages,
      downloadAttachments: !opts.skipDownload,
    });
  } catch (err: any) {
    log(`스크래핑 실패: ${err?.message ?? err}`, "error");
    emit({ event: "error", message: `scrape failed: ${err?.message ?? err}` });
    process.exit(2);
  }

  log(`게시물 ${scrapeResult.articlesCount}건, 첨부 ${scrapeResult.attachmentsCount}개 수집`);
  emit({
    event: "scrape",
    phase: "done",
    current: opts.maxPages,
    total: opts.maxPages,
    articles: scrapeResult.articlesCount,
  });

  // 2) 게시판이 이미 카테고리(gubunList) 단계에서 사전 필터링했으므로 모든 결과 통과.
  //    "전체" 선택 시에는 통합/변경/연간 모두 받기 때문에 별도 사후 필터가 없는 게 맞다.
  //    과거의 제목 키워드/결정번호 정규식 기반 "최초허가 필터" 단계는 카테고리 코드보다
  //    부정확해(게시판 720건 vs 정규식 통과 579건) 폐기 — 진행 팝업의 단계도 함께 제거됐다.
  const userFilters = (config.filters ?? []).map((f) => String(f));
  const passAll = userFilters.length === 0 || userFilters.includes("all");
  const targetArticles = scrapeResult.articles;
  log(
    `수집 필터 (${passAll ? "전체" : userFilters.join(",")}) — 게시판 카테고리 사전필터 적용: ${scrapeResult.articles.length}건`
  );

  // 3) PDF만 raw 폴더로 정리(이미 다운로드된 파일은 재사용)
  //    - 라운드 2C: javascript:/onclick + HTTP 실패 시 Playwright fallback 사용
  const yearFolder = String(new Date().getFullYear());
  emit({ event: "download", phase: "start", total: targetArticles.length, current: 0 });
  const downloadStats: DownloadStats = {
    totalAttachments: 0,
    httpSucceeded: 0,
    playwrightSucceeded: 0,
    failed: 0,
  };
  const pdfBundles = await downloadPdfsToRaw(
    targetArticles,
    yearFolder,
    {
      playwrightEnabled: opts.playwrightEnabled,
      playwrightHeadless: opts.playwrightHeadless,
      playwrightTimeoutMs: opts.playwrightTimeoutMs,
    },
    downloadStats
  );
  log(
    `다운로드 결과: 총 ${downloadStats.totalAttachments}건 / HTTP 성공 ${downloadStats.httpSucceeded} / Playwright 성공 ${downloadStats.playwrightSucceeded} / 실패 ${downloadStats.failed}`
  );
  emit({
    event: "download",
    phase: "done",
    total: downloadStats.totalAttachments,
    current: pdfBundles.length,
    httpSucceeded: downloadStats.httpSucceeded,
    playwrightSucceeded: downloadStats.playwrightSucceeded,
    failed: downloadStats.failed,
  });

  // 라운드 3 — download_events 시계열 적재 + 임계값 검사 + alerts 영속화 (관측만)
  let alertsRaised = 0;
  try {
    const db = await getDbAsync();
    flushDownloadEvents(db, currentJobId, downloadAttemptBuffer);
    const triggered = evaluateAlertRules({
      db,
      stats: downloadStats,
      events: downloadAttemptBuffer,
    });
    if (triggered.length) {
      persistAlerts(db, currentJobId, triggered);
      alertsRaised = triggered.length;
      for (const a of triggered) {
        log(`[ALERT][${a.severity}] ${a.code} — ${a.title}`, a.severity === "error" ? "error" : "warn");
        emit({
          event: "alert",
          severity: a.severity,
          source: a.source,
          code: a.code,
          title: a.title,
          body: a.body,
        });
      }
    }
    saveDb();
  } catch (err: any) {
    log(`download_events / alerts 적재 실패: ${err?.message ?? err}`, "warn");
  }

  const summary: UpsertSummary = {
    facilitiesCreated: 0,
    facilitiesUpdated: 0,
    permitsCreated: 0,
    permitsUpdated: 0,
    needsReview: 0,
  };
  const parsedFiles: string[] = [];
  const parseFailures: Array<{ pdfPath: string; reason: string }> = [];

  // 4) backend 파싱 + DB 적재
  //    --download-only 모드는 여기서 종료 — 파싱은 별도 "X 파싱" 잡(--parse-only=...) 으로 수행.
  if (!opts.skipParse && !opts.downloadOnly) {
    emit({ event: "parse", phase: "start", total: pdfBundles.length, current: 0 });
    for (let i = 0; i < pdfBundles.length; i++) {
      const bundle = pdfBundles[i];
      try {
        const parsed = await callBackendParse(
          bundle.pdfPath,
          config,
          opts.backendUrl,
          bundle.documentType
        );
        if (!parsed) {
          parseFailures.push({ pdfPath: bundle.pdfPath, reason: "backend 응답 실패" });
          emit({
            event: "parse",
            postId: bundle.postId,
            status: "failed",
            current: i + 1,
            total: pdfBundles.length,
          });
          continue;
        }
        const jsonOut = saveParsedJson(parsed, bundle.postId, yearFolder, bundle.fileName);
        parsedFiles.push(jsonOut);
        emit({
          event: "parse",
          postId: bundle.postId,
          status: "ok",
          current: i + 1,
          total: pdfBundles.length,
        });

        if (!opts.dryRun) {
          const attachmentId = crypto
            .createHash("sha256")
            .update(`${bundle.postId}|${bundle.fileName}`)
            .digest("hex")
            .slice(0, 16);
          const docId = crypto
            .createHash("sha256")
            .update(bundle.article.link)
            .digest("hex")
            .slice(0, 16);
          const before = { ...summary };
          await upsertParsedDocument(
            parsed,
            `att_${attachmentId}`,
            `doc_${docId}`,
            isFirstPermit(bundle.article, titleKeywords),
            bundle.postId,
            summary,
            { fileName: bundle.fileName, pdfPath: bundle.pdfPath },
            bundle.documentType,
            categorizeFromTitle(bundle.documentType, bundle.article.title)
          );
          const facCreated = summary.facilitiesCreated - before.facilitiesCreated;
          const facUpdated = summary.facilitiesUpdated - before.facilitiesUpdated;
          // 가장 최근 처리된 사업장 표시용
          const companyField = parsed.fields?.find((f) => f.ruleId === "company_name");
          const facName = (companyField?.value as string | null) ?? null;
          emit({
            event: "upsert",
            facility: facName ?? bundle.postId,
            permitId: `att_${attachmentId}`,
            current: i + 1,
            total: pdfBundles.length,
            created: facCreated,
            updated: facUpdated,
          });
        }
      } catch (err: any) {
        parseFailures.push({ pdfPath: bundle.pdfPath, reason: err?.message ?? String(err) });
        emit({
          event: "parse",
          postId: bundle.postId,
          status: "failed",
          current: i + 1,
          total: pdfBundles.length,
        });
        log(`parse 실패: ${err?.message ?? err}`, "warn");
      }
    }
  }

  if (!opts.dryRun && !opts.downloadOnly && !opts.skipParse && parsedFiles.length > 0) {
    await runFacilityReconcile(true);
  }

  // 5) summary.json 작성
  const summaryPayload = {
    executedAt: new Date().toISOString(),
    board: { id: board.board_id, name: board.board_name },
    org: { id: org.org_id, name: org.org_name },
    options: opts,
    config: {
      extractionRange: config.extractionRange,
      ruleCount: config.extractionRules.length,
      activeRuleCount: config.activeRuleIds?.length ?? config.extractionRules.length,
    },
    scrape: {
      articles: scrapeResult.articlesCount,
      attachments: scrapeResult.attachmentsCount,
      // 호환성을 위해 키 이름은 유지 — 더 이상 "최초허가 정규식 통과" 가 아니라
      // 게시판 카테고리 필터(gubunList) 통과 게시물 전수.
      firstPermitArticles: targetArticles.length,
      pdfBundles: pdfBundles.length,
      errors: scrapeResult.errors,
    },
    download: {
      totalAttachments: downloadStats.totalAttachments,
      httpSucceeded: downloadStats.httpSucceeded,
      playwrightSucceeded: downloadStats.playwrightSucceeded,
      failed: downloadStats.failed,
      playwrightEnabled: opts.playwrightEnabled,
    },
    ops: {
      jobId: currentJobId,
      attemptEvents: downloadAttemptBuffer.length,
      alertsRaised,
    },
    parse: {
      attempted: pdfBundles.length,
      succeeded: parsedFiles.length,
      failed: parseFailures.length,
      jsonFiles: parsedFiles,
      failures: parseFailures,
    },
    upsert: opts.dryRun ? null : summary,
  };
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summaryPayload, null, 2), "utf8");
  log(`summary 저장: ${SUMMARY_PATH}`);
  if (!JSON_PROGRESS) {
    console.log(JSON.stringify(summaryPayload, null, 2));
  }
  emit({ event: "done", summaryPath: SUMMARY_PATH, summary: summaryPayload });
}

main().catch((err) => {
  log(String(err), "error");
  emit({ event: "error", message: String(err?.message ?? err) });
  process.exit(1);
});
