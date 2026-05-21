/**
 * GitHub Actions용 스크래핑 실행 모듈
 * 
 * 기존 API route의 스크래핑 로직을 CLI에서 실행 가능하도록 분리한 모듈입니다.
 * Next.js 의존성 없이 독립적으로 실행됩니다.
 */

import * as cheerio from "cheerio";
import { parseStringPromise } from "xml2js";
import fs from "node:fs";
import path from "node:path";
import { chromium, Browser, Page } from "playwright";
import { syncInstantScrapeToDB } from "../lib/scraper/scraper-db";

// ============================================================
// 타입 정의
// ============================================================

export interface WebConfig {
  rendering?: "static_html" | "dynamic_js";
  list?: {
    container_selector?: string;
    item_selector?: string;
    pagination?: {
      type: "page_param" | "offset_param" | "next_button" | "none" | "javascript";
      param?: string;
      selector?: string;
      start?: number;
      step?: number;
      max_pages?: number;
    };
  };
  parse_rules?: {
    title?: string;
    date?: string;
    link?: string;
    author?: string;
  };
  detail?: {
    content_selector?: string;
    title_selector?: string;
    attachments_selector?: string;
  };
  attachments?: {
    enabled?: boolean;
    collect_all?: boolean;
    file_types?: string[];
    selector?: string;
  };
  collection_range?: {
    type: "period" | "relative" | "yearly" | "";
    start_date?: string | null;
    end_date?: string | null;
    days_before?: number;
    years?: number[];
  };
  collect_body?: boolean;

  // 외부 상세 링크 추적
  external_detail?: {
    enabled: boolean;
    url_selector?: string;
    url_pattern?: string;
    label_selector?: string;
    mode: "html" | "api_xml";
    content_selector?: string;
    attachments_selector?: string;
    api_xml?: {
      type_param?: string;
      content_fields?: string[];
      attachment_fields?: { url_field: string; name_field: string }[];
    };
    url_transform?: {
      extract_param: string;
      template: string;
    };
    metadata_selectors?: { [key: string]: string };
  };
}

// ============================================================
// API 스크래핑 타입 정의
// ============================================================

interface DateFilter {
  field: string;
  start_date?: string;
  end_date?: string;
  format?: string;
  relative_days?: number;
}

interface SearchFilter {
  field: string;
  keywords: string[];
  match_type: "contains" | "exact" | "regex" | "any";
}

interface EndpointConfig {
  name: string;
  path: string;
  method: string;
  params?: Record<string, string>;
  response_fields?: string[];
  body_type?: "json" | "form" | "none";
  body_template?: Record<string, any>;
  id_field?: string;
  id_param?: string;
}

interface ApiAuth {
  type: "param" | "header" | "bearer" | "basic" | "oauth2";
  in?: "query" | "header";
  param_name?: string;
  name?: string;
  secret_ref?: string;
  bearer_prefix?: string;
  username_ref?: string;
  password_ref?: string;
  token_url?: string;
  client_id_ref?: string;
  client_secret_ref?: string;
  scope?: string;
}

export interface ApiConfig {
  primary_endpoint: EndpointConfig;
  secondary_endpoints?: EndpointConfig[];
  params: Record<string, string>;
  pagination?: {
    type: string;
    param_name: string;
    page_size: number;
    max_pages: number;
  };
  response_fields?: string[];
  search_filters?: SearchFilter[];
  date_filters?: DateFilter[];
  response_data_path?: string;
  two_phase?: {
    enabled: boolean;
    field_mappings?: { source_field: string; target_param: string }[];
    filter_mappings?: { primary_filter_idx: number; secondary_field: string }[];
    use_filter_keywords?: boolean;
    query_param_name?: string;
    list_id_field?: string;
    detail_id_param?: string;
    max_list_items?: number;
    max_detail_items?: number;
    max_details?: number;
  };
  rate_limit?: {
    requests_per_second?: number;
    delay_between_requests?: number;
    delay_between_pages?: number;
  };
  title_field?: string;
}

export interface ApiProfile {
  base_url: string;
  auth?: ApiAuth;
  default_params?: Record<string, string>;
  endpoints?: any[];
}

export interface Board {
  board_id: string;
  org_id: string;
  board_name: string;
  access_mode: string;
  board_mode?: string;
  doc_type?: string;
  list_url?: string;
  enabled: boolean;
  web_config?: WebConfig;
  api_config?: ApiConfig;
  collection_range?: {
    type: string;
    period_start?: string;
    period_end?: string;
    relative_days?: number;
    years?: number[];
  };
  collection_targets?: {
    title_body?: boolean;
    attachments?: {
      enabled?: boolean;
      all?: boolean;
    };
  };
  browser_config?: {
    browser_type?: string;
    headless?: boolean;
    wait_time?: number;
    wait_for_selector?: string;
  };
}

export interface Organization {
  org_id: string;
  org_name: string;
  base_url: string;
  api_profile?: ApiProfile;
}

export interface ScrapedArticle {
  title: string;
  date: string;
  link: string;
  content?: string;
  attachments: Array<{
    fileName: string;
    downloadUrl: string;
    localPath?: string;
  }>;
  metadata?: { [key: string]: string };
}

export interface ScrapingResult {
  success: boolean;
  boardId: string;
  boardName: string;
  orgId: string;
  orgName: string;
  articlesCount: number;
  attachmentsCount: number;
  articles: ScrapedArticle[];
  errors: string[];
  executedAt: string;
  durationMs: number;
}

// ============================================================
// 유틸리티 함수
// ============================================================

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

export function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  
  const cleaned = dateStr.replace(/\s+/g, " ").trim();
  
  // YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD
  let match = cleaned.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (match) {
    return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  }
  
  // YY-MM-DD, YY.MM.DD
  match = cleaned.match(/(\d{2})[-./](\d{1,2})[-./](\d{1,2})/);
  if (match) {
    const year = parseInt(match[1]) + 2000;
    return new Date(year, parseInt(match[2]) - 1, parseInt(match[3]));
  }
  
  // 2024년 1월 15일
  match = cleaned.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (match) {
    return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  }
  
  return null;
}

export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function checkCollectionRange(
  itemDate: Date | null,
  range: WebConfig["collection_range"]
): boolean | "stop" {
  if (!range || !range.type) return true;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  switch (range.type) {
    case "period": {
      if (!itemDate) return true;
      
      const startDate = range.start_date ? new Date(range.start_date) : null;
      const endDate = range.end_date ? new Date(range.end_date) : null;
      
      if (startDate) startDate.setHours(0, 0, 0, 0);
      if (endDate) endDate.setHours(23, 59, 59, 999);
      
      if (endDate && itemDate > endDate) return false;
      if (startDate && itemDate < startDate) return "stop";
      
      return true;
    }
    
    case "relative": {
      if (!itemDate) return true;
      
      const daysBefore = range.days_before || 30;
      const cutoffDate = new Date(today);
      cutoffDate.setDate(cutoffDate.getDate() - daysBefore);
      
      if (itemDate < cutoffDate) return "stop";
      
      return true;
    }
    
    case "yearly": {
      if (!itemDate || !range.years || range.years.length === 0) return true;
      
      const itemYear = itemDate.getFullYear();
      
      const minYear = Math.min(...range.years);
      if (itemYear < minYear) return "stop";
      
      if (!range.years.includes(itemYear)) return false;

      return true;
    }
    
    default:
      return true;
  }
}

// ============================================================
// HTML 파싱
// ============================================================

interface ScrapingItem {
  title: string;
  link: string;
  date?: string;
  author?: string;
}

function parseListPage(
  html: string,
  baseUrl: string,
  config: WebConfig
): { items: ScrapingItem[]; $: cheerio.CheerioAPI } {
  const $ = cheerio.load(html);
  const items: ScrapingItem[] = [];
  
  const containerSelector = config.list?.container_selector;
  const itemSelector = config.list?.item_selector || "tr";
  const titleSelector = config.parse_rules?.title || "a";
  const dateSelector = config.parse_rules?.date;
  const linkSelector = config.parse_rules?.link || "a";
  const authorSelector = config.parse_rules?.author;
  
  const $container = containerSelector ? $(containerSelector) : $("body");
  const $items = $container.find(itemSelector);
  
  console.log(`[parseListPage] container="${containerSelector}", items="${itemSelector}", found=${$items.length}`);
  
  $items.each((idx, el) => {
    const $item = $(el);
    
    const $titleEl = $item.find(titleSelector).first();
    const title = cleanText($titleEl.text());
    
    const $linkEl = $item.find(linkSelector).first();
    let link = $linkEl.attr("href") || "";
    
    // onclick에서 URL 추출 시도
    if (!link || link === "#" || link.startsWith("javascript:")) {
      const onclick = $linkEl.attr("onclick") || $item.attr("onclick") || "";
      
      // 1) article.view('id') 패턴 (산업통상자원부)
      const articleViewMatch = onclick.match(/article\.view\s*\(\s*['"]?(\d+)['"]?\s*\)/i);
      if (articleViewMatch) {
        try {
          const urlObj = new URL(baseUrl);
          link = `${urlObj.pathname}/${articleViewMatch[1]}/view`;
        } catch {
          link = `${baseUrl}/${articleViewMatch[1]}/view`;
        }
      }
      
      // 2) doBbsFView 패턴 (중소벤처기업부)
      if (!link || link === "#" || link.startsWith("javascript:")) {
        const bbsFViewMatch = onclick.match(/doBbsFView\s*\(\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]/i);
        if (bbsFViewMatch) {
          try {
            const urlObj = new URL(baseUrl);
            let basePath = urlObj.pathname.replace(/List\.do$/i, "View.do").replace(/list\.do$/i, "View.do");
            urlObj.pathname = basePath;
            urlObj.searchParams.set("cbIdx", bbsFViewMatch[1]);
            urlObj.searchParams.set("bcIdx", bbsFViewMatch[2]);
            link = urlObj.pathname + urlObj.search;
          } catch {}
        }
      }
      
      // 3) 일반 URL 패턴
      if (!link || link === "#" || link.startsWith("javascript:")) {
        const urlMatch = onclick.match(/['"]([^'"]*(?:https?:\/\/|\/)[^'"]*)['"]/i);
        if (urlMatch) link = urlMatch[1];
      }
    }
    
    if (link && !link.startsWith("http")) {
      link = resolveUrl(baseUrl, link);
    }
    
    let date = "";
    if (dateSelector) {
      const $dateEl = $item.find(dateSelector).first();
      date = cleanText($dateEl.text());
    }
    
    let author = "";
    if (authorSelector) {
      const $authorEl = $item.find(authorSelector).first();
      author = cleanText($authorEl.text());
    }
    
    if (title && title.length >= 2 && link) {
      items.push({ title, link, date, author });
      if (idx < 3) {
        console.log(`[parseListPage] item[${idx}] title="${title.slice(0, 50)}...", date="${date}"`);
      }
    }
  });
  
  return { items, $ };
}

// ============================================================
// 브라우저 관리
// ============================================================

let globalBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (globalBrowser && globalBrowser.isConnected()) {
    return globalBrowser;
  }
  
  globalBrowser = await chromium.launch({
    headless: true,
    timeout: 60000,
  });
  
  return globalBrowser;
}

async function closeBrowser(): Promise<void> {
  if (globalBrowser) {
    await globalBrowser.close().catch(() => {});
    globalBrowser = null;
  }
}

async function fetchRenderedHtml(url: string, waitTime: number = 2000): Promise<string> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "ko-KR",
  });
  
  const page = await context.newPage();
  
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    
    await page.waitForTimeout(waitTime);
    
    return await page.content();
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function fetchStaticHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
    signal: AbortSignal.timeout(30000),
  });
  
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  
  return res.text();
}

// ============================================================
// 첨부파일 추출
// ============================================================

interface AttachmentInfo {
  fileName: string;
  downloadUrl: string;
}

/**
 * onclick 속성에서 URL 추출
 */
function tryExtractUrlFromOnclick(onclick: string): string | null {
  if (!onclick) return null;
  // 1) quoted URL-ish string
  const m1 = onclick.match(/['"]([^'"]*(?:https?:\/\/|\/)[^'"]*)['"]/i);
  if (m1?.[1]) return m1[1];
  // 2) javascript:location.href='...'
  const m2 = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/i);
  if (m2?.[1]) return m2[1];
  // 3) window.open('...')
  const m3 = onclick.match(/window\.open\(\s*['"]([^'"]+)['"]/i);
  if (m3?.[1]) return m3[1];
  return null;
}

/**
 * 텍스트가 첨부파일명처럼 보이는지 확인
 */
function looksLikeAttachmentName(text: string): boolean {
  const t = (text || "").toLowerCase();
  const exts = [
    ".hwp", ".hwpx", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv",
    ".ppt", ".pptx", ".zip", ".rar", ".7z"
  ];
  if (exts.some((e) => t.includes(e))) return true;
  return /\(\s*[\d.]+\s*[kmg]b\s*\)\s*$/i.test(text || "");
}

/**
 * 첨부파일 추출 (scraper-engine.ts와 동일한 4가지 전략 사용)
 */
function extractAttachmentsFromHtml(
  html: string,
  baseUrl: string,
  config: WebConfig
): AttachmentInfo[] {
  const $ = cheerio.load(html);
  const attachments: AttachmentInfo[] = [];
  const seenUrls = new Set<string>();
  
  // 첨부파일 추가 헬퍼 함수
  const pushAttachment = (fileNameRaw: string, urlRaw: string) => {
    if (!urlRaw) return;
    const downloadUrl = resolveUrl(baseUrl, urlRaw);
    if (!downloadUrl) return;
    if (seenUrls.has(downloadUrl)) return;
    seenUrls.add(downloadUrl);
    
    let fileName = cleanText(fileNameRaw);
    if (!fileName || fileName.length < 3) {
      try {
        const u = new URL(downloadUrl);
        const last = u.pathname.split("/").pop() || "";
        fileName = decodeURIComponent(last);
        if (!fileName || fileName.length < 3) {
          const qp =
            u.searchParams.get("fileName") ||
            u.searchParams.get("file_name") ||
            u.searchParams.get("filename") ||
            u.searchParams.get("name");
          if (qp) fileName = decodeURIComponent(qp);
        }
      } catch {
        fileName = urlRaw.split("/").pop()?.split("?")[0] || "unknown";
      }
    }
    
    // 크기 정보 제거 (예: "(858.3 KB)", "[123.2 KB]")
    fileName = fileName
      .replace(/\s*\([^)]*[KMG]B\)\s*$/i, "")  // (123.2 KB) 형태
      .replace(/\s*\[[^\]]*[KMG]B\]\s*$/i, "") // [123.2 KB] 형태
      .trim();
    if (!fileName) fileName = "unknown";
    
    attachments.push({ fileName, downloadUrl });
  };
  
  // ── 전략 1: 파일 확장자 기반 선택자 ──
  const extSelectors = [
    "a[href*='.hwp']", "a[href*='.hwpx']", "a[href*='.pdf']",
    "a[href*='.doc']", "a[href*='.docx']", "a[href*='.xls']",
    "a[href*='.xlsx']", "a[href*='.csv']", "a[href*='.zip']",
    "a[href*='.ppt']", "a[href*='.pptx']",
  ];
  
  // ── 전략 2: 다운로드 관련 선택자 ──
  const downloadSelectors = [
    "a[href*='download']", "a[href*='fileDown']", "a[href*='file_down']",
    "a[href*='atchFileDown']", "a[href*='AttachDown']",
    "a[onclick*='download']", "a[onclick*='fileDown']",
    ".file_list a", ".attach a", ".file a", ".file_area a",
    ".attachment a", ".attachFile a", ".atch_file a",
    "ul.file li a", "div.file a", "table.file a",
  ];
  
  // 커스텀 선택자
  if (config.attachments?.selector) {
    downloadSelectors.push(config.attachments.selector);
  }
  if (config.detail?.attachments_selector) {
    downloadSelectors.push(config.detail.attachments_selector);
  }
  
  const allSelectors = [...extSelectors, ...downloadSelectors].join(", ");
  
  $(allSelectors).each((_, el) => {
    const $a = $(el);
    let href = $a.attr("href") || "";
    const onclick = $a.attr("onclick") || "";
    
    // onclick에서 URL 추출 시도
    if (!href && onclick) {
      const extracted = tryExtractUrlFromOnclick(onclick);
      if (extracted) href = extracted;
    }
    
    if (!href) return;
    
    const downloadUrl = resolveUrl(baseUrl, href);
    if (seenUrls.has(downloadUrl)) return;
    
    // 파일명 추출
    const fileName = $a.text().replace(/\s+/g, " ").trim();
    
    // 파일 유형 체크
    const validExts = config.attachments?.file_types || 
      ["hwp", "hwpx", "pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "zip", "rar", "7z"];
    
    const hasValidExt = validExts.some(ext => 
      fileName.toLowerCase().includes(`.${ext}`) || downloadUrl.toLowerCase().includes(`.${ext}`)
    );
    const isDownloadUrl = /download|filedown|attach/i.test(downloadUrl);
    
    if (config.attachments?.collect_all || hasValidExt || isDownloadUrl) {
      pushAttachment(fileName, href);
    }
  });
  
  // ── 전략 3: '첨부파일' 라벨 주변에서 링크 수집 ──
  if (attachments.length === 0) {
    const labelEls = $("th, dt, strong, span, p")
      .toArray()
      .filter((el) => $(el).text().replace(/\s+/g, "").includes("첨부파일"));
    
    for (const el of labelEls.slice(0, 5)) {
      const $lab = $(el);
      const $cand = $lab.closest("tr").find("td")
        .add($lab.closest("dl").find("dd"))
        .add($lab.parent());
      
      $cand.find("a").each((_, a) => {
        const $a = $(a);
        const txt = $a.text().replace(/\s+/g, " ").trim();
        const href = $a.attr("href") || "";
        const onclick = $a.attr("onclick") || "";
        const urlFromOnclick = onclick ? tryExtractUrlFromOnclick(onclick) : null;
        const urlRaw = href || urlFromOnclick || "";
        
        if (!urlRaw) return;
        if (!looksLikeAttachmentName(txt) && !looksLikeAttachmentName(urlRaw)) return;
        
        pushAttachment(txt, urlRaw);
      });
    }
  }
  
  // ── 전략 4: 최후 fallback - 전체 a 중 파일패턴 검색 ──
  if (attachments.length === 0) {
    $("a").each((_, a) => {
      const $a = $(a);
      const txt = $a.text().replace(/\s+/g, " ").trim();
      const href = $a.attr("href") || "";
      const onclick = $a.attr("onclick") || "";
      const urlFromOnclick = onclick ? tryExtractUrlFromOnclick(onclick) : null;
      const urlRaw = href || urlFromOnclick || "";
      
      if (!urlRaw) return;
      if (!looksLikeAttachmentName(txt) && !looksLikeAttachmentName(urlRaw)) return;
      
      pushAttachment(txt, urlRaw);
    });
  }
  
  return attachments;
}

// ============================================================
// 외부 상세 링크 추적 함수 (CLI용)
// ============================================================

function stripJsessionId(url: string): string {
  return url.replace(/;jsessionid=[^?&]*/gi, "");
}

function extractExternalDetailUrl(
  $: cheerio.CheerioAPI,
  baseUrl: string,
  config: NonNullable<WebConfig["external_detail"]>
): string | null {
  // 방법 1: CSS 선택자로 직접 추출
  if (config.url_selector) {
    const href = $(config.url_selector).first().attr("href");
    if (href) {
      console.log(`[extractExternalDetailUrl] url_selector 매칭: ${href.slice(0, 80)}...`);
      return stripJsessionId(resolveUrl(baseUrl, href));
    }
  }
  // 방법 2: 라벨 주변에서 링크 추출 (<dt>/<dd> 및 <th>/<td> 구조)
  if (config.label_selector) {
    const $label = $(config.label_selector).first();
    if ($label.length > 0) {
      const $link = $label.next("dd").find("a[href]")
        .add($label.closest("tr").find("td a[href]"))
        .add($label.parent().find("a[href]"));
      const href = $link.first().attr("href");
      if (href) {
        console.log(`[extractExternalDetailUrl] label_selector 매칭: ${href.slice(0, 80)}...`);
        return stripJsessionId(resolveUrl(baseUrl, href));
      }
    }
  }
  // 방법 3: URL 패턴 매칭
  if (config.url_pattern) {
    const re = new RegExp(config.url_pattern);
    let found: string | null = null;
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (re.test(href)) {
        console.log(`[extractExternalDetailUrl] url_pattern 매칭: ${href.slice(0, 80)}...`);
        found = stripJsessionId(resolveUrl(baseUrl, href));
        return false;
      }
    });
    if (found) return found;
  }
  return null;
}

async function fetchExternalDetailAsXml(
  url: string,
  config: NonNullable<WebConfig["external_detail"]>
): Promise<{ content: string; attachments: AttachmentInfo[] }> {
  let xmlUrl = url;
  if (config.api_xml?.type_param) {
    xmlUrl = url.replace(/([?&])type=[^&]*/i, `$1type=${config.api_xml.type_param}`);
    if (xmlUrl === url && !url.includes("type=")) {
      xmlUrl += (url.includes("?") ? "&" : "?") + `type=${config.api_xml.type_param}`;
    }
  }
  console.log(`[fetchExternalDetailAsXml] XML 요청: ${xmlUrl.slice(0, 100)}...`);
  const xmlText = await fetchStaticHtml(xmlUrl);

  let parsed: Record<string, unknown>;
  try {
    parsed = await parseStringPromise(xmlText, {
      explicitArray: false, ignoreAttrs: false, mergeAttrs: true,
      trim: true, normalize: true, normalizeTags: false,
    });
  } catch (err) {
    console.log(`[fetchExternalDetailAsXml] XML 파싱 실패: ${err instanceof Error ? err.message : String(err)}`);
    return { content: "", attachments: [] };
  }

  const rootCandidates = ["행정규칙", "법령", "자치법규", "판례", "헌재결정례"];
  let root: Record<string, unknown> | null = null;
  for (const key of rootCandidates) {
    if (parsed[key] && typeof parsed[key] === "object") {
      root = parsed[key] as Record<string, unknown>;
      break;
    }
  }
  if (!root) {
    const keys = Object.keys(parsed);
    if (keys.length === 1 && typeof parsed[keys[0]] === "object") {
      root = parsed[keys[0]] as Record<string, unknown>;
    }
  }
  if (!root) return { content: "", attachments: [] };

  const contentFields = config.api_xml?.content_fields || ["조문내용"];
  let content = "";
  for (const field of contentFields) {
    const value = root[field];
    if (value && typeof value === "string") content += value + "\n";
    else if (value && typeof value === "object") content += JSON.stringify(value, null, 2) + "\n";
  }
  content = content.trim();

  const attachments: AttachmentInfo[] = [];
  for (const mapping of config.api_xml?.attachment_fields || []) {
    const fileUrl = root[mapping.url_field];
    const fileName = root[mapping.name_field];
    if (fileUrl && typeof fileUrl === "string" && fileUrl.trim()) {
      const urls = fileUrl.split(/[,;|\n]/).map(u => u.trim()).filter(Boolean);
      const names = (typeof fileName === "string" ? fileName : "").split(/[,;|\n]/).map(n => n.trim()).filter(Boolean);
      for (let i = 0; i < urls.length; i++) {
        attachments.push({ fileName: names[i] || `attachment_${i + 1}`, downloadUrl: urls[i] });
      }
    }
  }
  console.log(`[fetchExternalDetailAsXml] 본문 ${content.length}자, 첨부 ${attachments.length}개`);
  return { content, attachments };
}

async function fetchExternalDetailAsHtml(
  url: string,
  config: NonNullable<WebConfig["external_detail"]>
): Promise<{ content: string; attachments: AttachmentInfo[] }> {
  console.log(`[fetchExternalDetailAsHtml] HTML 요청: ${url.slice(0, 100)}...`);
  const html = await fetchStaticHtml(url);
  const $ = cheerio.load(html);

  let content = "";
  if (config.content_selector) {
    const $content = $(config.content_selector).first();
    if ($content.length > 0) {
      $content.find("script, style, nav, header, footer").remove();
      content = cleanText($content.text());
    }
  }
  if (!content) {
    $("script, style, nav, header, footer").remove();
    content = cleanText($("body").text()).slice(0, 10000);
  }

  const attachments: AttachmentInfo[] = [];
  const seenUrls = new Set<string>();
  const attachSelector = config.attachments_selector ||
    "a[href*='.hwp'], a[href*='.pdf'], a[href*='.doc'], a[href*='.docx'], a[href*='.xls'], a[href*='.xlsx'], a[href*='download'], a[href*='fileDown']";
  $(attachSelector).each((_, el) => {
    const $a = $(el);
    const href = $a.attr("href") || "";
    if (!href) return;
    const downloadUrl = resolveUrl(url, href);
    if (seenUrls.has(downloadUrl)) return;
    seenUrls.add(downloadUrl);
    let fileName = cleanText($a.text());
    if (!fileName) {
      const imgAlt = $a.find("img").first().attr("alt") || "";
      try {
        const urlParams = new URLSearchParams(href.split("?")[1] || "");
        const flNm = urlParams.get("flNm");
        if (flNm) {
          const ext = imgAlt.match(/HWP/i) ? ".hwp" : imgAlt.match(/PDF/i) ? ".pdf" : imgAlt.match(/DOC/i) ? ".doc" : "";
          fileName = flNm + ext;
        } else {
          fileName = imgAlt || href.split("/").pop()?.split("?")[0] || "unknown";
        }
      } catch {
        fileName = imgAlt || href.split("/").pop()?.split("?")[0] || "unknown";
      }
    }
    attachments.push({ fileName, downloadUrl });
  });

  return { content, attachments };
}

function extractMetadataFromDetailPage(
  $: cheerio.CheerioAPI,
  selectors: { [key: string]: string }
): { [key: string]: string } {
  const metadata: { [key: string]: string } = {};
  for (const [key, selector] of Object.entries(selectors)) {
    const text = cleanText($(selector).first().text());
    if (text) metadata[key] = text;
  }
  return metadata;
}

// ============================================================
// 상세 페이지 처리
// ============================================================

async function parseDetailPage(
  url: string,
  config: WebConfig,
  useBrowser: boolean = false
): Promise<{ content: string; attachments: AttachmentInfo[]; metadata?: { [key: string]: string } }> {
  let html: string;
  
  if (useBrowser) {
    html = await fetchRenderedHtml(url);
  } else {
    html = await fetchStaticHtml(url);
  }
  
  const $ = cheerio.load(html);
  
  // 본문 추출
  let content = "";
  if (config.collect_body) {
    const contentSelectors = [
      config.detail?.content_selector,
      ".view_con", ".view_cont", ".view_content", ".viewContent",
      ".board_view_content", ".bbs_content", ".bbsContent",
      ".article_content", ".article_body", ".articleBody",
      ".post_content", ".post_body",
      "article .content", "article .body",
      ".content_area", "#content .text",
      "article", ".content", "#content"
    ].filter(Boolean);
    
    for (const selector of contentSelectors) {
      const $content = $(selector as string).first();
      if ($content.length > 0) {
        $content.find("script, style, nav, header, footer, .skip, .blind").remove();
        const text = cleanText($content.text());
        if (text.length > 50 && !text.startsWith("주메뉴") && !text.startsWith("바로가기")) {
          content = text;
          break;
        }
      }
    }
    
    // fallback: 본문을 찾지 못한 경우 body에서 추출
    if (!content) {
      $("script, style, nav, header, footer, .gnb, .lnb, .skip, .blind, #header, #footer").remove();
      let bodyText = cleanText($("body").text());
      // 앞부분 메뉴 텍스트 제거
      const mainIdx = bodyText.indexOf("본문내용");
      if (mainIdx > 0 && mainIdx < 200) {
        bodyText = bodyText.slice(mainIdx + 4).trim();
      }
      content = bodyText.slice(0, 5000);
    }
  }
  
  // 첨부파일 추출 (개선된 4가지 전략 사용)
  const attachments = extractAttachmentsFromHtml(html, url, config);
  
  // 외부 상세 링크 추적
  let metadata: { [key: string]: string } | undefined;
  
  if (config.external_detail?.enabled) {
    console.log(`[parseDetailPage] 외부 상세 링크 추적 활성화됨 (mode: ${config.external_detail.mode})`);
    
    if (config.external_detail.metadata_selectors) {
      metadata = extractMetadataFromDetailPage($, config.external_detail.metadata_selectors);
      if (Object.keys(metadata).length > 0) {
        console.log(`[parseDetailPage] 메타데이터 추출: ${JSON.stringify(metadata)}`);
      }
    }
    
    let externalUrl = extractExternalDetailUrl($, url, config.external_detail);
    
    // URL 변환 (DRF API URL → 공개 페이지 URL 등)
    if (externalUrl && config.external_detail.url_transform) {
      try {
        const urlObj = new URL(externalUrl);
        const paramValue = urlObj.searchParams.get(config.external_detail.url_transform.extract_param);
        if (paramValue) {
          externalUrl = config.external_detail.url_transform.template.replace(
            `{${config.external_detail.url_transform.extract_param}}`, paramValue
          );
          console.log(`[parseDetailPage] URL 변환됨: ${externalUrl.slice(0, 120)}...`);
        }
      } catch (e) {
        console.log(`[parseDetailPage] URL 변환 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    
    if (externalUrl) {
      try {
        if (config.external_detail.mode === "api_xml") {
          const xmlResult = await fetchExternalDetailAsXml(externalUrl, config.external_detail);
          if (xmlResult.content) content = xmlResult.content;
          if (xmlResult.attachments.length > 0) attachments.push(...xmlResult.attachments);
        } else {
          const htmlResult = await fetchExternalDetailAsHtml(externalUrl, config.external_detail);
          if (htmlResult.content) content = htmlResult.content;
          if (htmlResult.attachments.length > 0) attachments.push(...htmlResult.attachments);
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.log(`[parseDetailPage] 외부 상세 링크 처리 실패: ${errorMessage}`);
      }
    }
  }
  
  return { content, attachments, metadata };
}

// ============================================================
// 파일 다운로드
// ============================================================

async function downloadFile(
  url: string,
  outputPath: string,
  referer?: string
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ...(referer ? { "Referer": referer } : {}),
      },
      signal: AbortSignal.timeout(60000),
    });
    
    if (!res.ok) {
      console.error(`[DOWNLOAD] HTTP ${res.status}: ${url}`);
      return false;
    }
    
    const buffer = await res.arrayBuffer();
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from(buffer));
    
    console.log(`[DOWNLOAD] 저장: ${path.basename(outputPath)} (${buffer.byteLength} bytes)`);
    return true;
  } catch (err: any) {
    console.error(`[DOWNLOAD] 실패: ${url} - ${err.message}`);
    return false;
  }
}

// ============================================================
// API 스크래핑 유틸리티 함수
// ============================================================

function getEnvSecret(ref?: string): string | null {
  if (!ref) return null;
  if (!ref.startsWith("ENV:")) return null;
  const key = ref.slice("ENV:".length);
  if (!key) return null;
  return process.env[key] ?? null;
}

function apiDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDateForApi(date: Date, format?: string): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  switch (format) {
    case "YYYYMMDD": return `${y}${m}${d}`;
    case "YYYY/MM/DD": return `${y}/${m}/${d}`;
    case "YYYY.MM.DD": return `${y}.${m}.${d}`;
    case "YYYY-MM-DD":
    default: return `${y}-${m}-${d}`;
  }
}

function applyDateFilters(params: Record<string, string>, dateFilters?: DateFilter[]): Record<string, string> {
  if (!dateFilters || dateFilters.length === 0) return params;
  const result = { ...params };
  const today = new Date();
  for (const df of dateFilters) {
    if (!df.field) continue;
    let startDate = df.start_date;
    let endDate = df.end_date;
    if (df.relative_days && df.relative_days > 0) {
      const pastDate = new Date(today);
      pastDate.setDate(pastDate.getDate() - df.relative_days);
      startDate = formatDateForApi(pastDate, df.format);
      endDate = formatDateForApi(today, df.format);
    }
    if (df.field.toLowerCase().includes("start") || df.field.toLowerCase().includes("from")) {
      if (startDate) result[df.field] = startDate;
    } else if (df.field.toLowerCase().includes("end") || df.field.toLowerCase().includes("to")) {
      if (endDate) result[df.field] = endDate;
    } else {
      if (startDate) result[df.field] = startDate;
    }
  }
  return result;
}

function getNestedValue(obj: any, valuePath: string): any {
  if (!obj || !valuePath) return undefined;
  if (obj[valuePath] !== undefined) return obj[valuePath];
  const parts = valuePath.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function normalizeKey(key: string): string {
  return String(key ?? "").replace(/[\s_]+/g, "").toLowerCase();
}

function buildDeepKeyIndex(root: any): Map<string, any[]> {
  const index = new Map<string, any[]>();
  const seen = new WeakSet<object>();
  const push = (k: string, v: any) => {
    const nk = normalizeKey(k);
    if (!nk) return;
    const arr = index.get(nk) ?? [];
    arr.push(v);
    index.set(nk, arr);
  };
  const walk = (node: any) => {
    if (node === null || node === undefined || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) { for (const it of node) walk(it); return; }
    for (const [k, v] of Object.entries(node)) { push(k, v); walk(v); }
  };
  walk(root);
  return index;
}

function extractDetailRootObject(parsed: any): any | null {
  if (!parsed || typeof parsed !== "object") return null;
  const candidates = ["법령", "행정규칙", "자치법규", "판례", "헌재결정례", "결정례", "영문법령"];
  for (const key of candidates) {
    if (parsed[key] && typeof parsed[key] === "object") return parsed[key];
  }
  const keys = Object.keys(parsed);
  if (keys.length === 1) {
    const only = parsed[keys[0]];
    if (only && typeof only === "object") return only;
  }
  return null;
}

function applySearchFilters(data: any[], searchFilters?: SearchFilter[]): any[] {
  if (!searchFilters || searchFilters.length === 0) return data;
  return data.filter((item) => {
    for (const filter of searchFilters) {
      const value = getNestedValue(item, filter.field);
      if (value === undefined || value === null) continue;
      const strValue = String(value);
      let matches = false;
      switch (filter.match_type) {
        case "exact":
          matches = filter.keywords.some((kw) => strValue === kw);
          break;
        case "regex":
          matches = filter.keywords.some((kw) => { try { return new RegExp(kw, "i").test(strValue); } catch { return false; } });
          break;
        case "any":
        case "contains":
        default:
          matches = filter.keywords.some((kw) => strValue.toLowerCase().includes(kw.toLowerCase()));
          break;
      }
      if (!matches) return false;
    }
    return true;
  });
}

function filterResponseFields(data: any[], responseFields?: string[]): any[] {
  if (!responseFields || responseFields.length === 0) return data;
  return data.map((item) => {
    const filtered: Record<string, any> = {};
    const deepIndex = buildDeepKeyIndex(item);
    for (const field of responseFields) {
      if (item[field] !== undefined) { filtered[field] = item[field]; }
      else {
        const value = getNestedValue(item, field);
        if (value !== undefined) { filtered[field] = value; }
        else {
          const values = deepIndex.get(normalizeKey(field));
          if (values && values.length > 0) filtered[field] = values.length === 1 ? values[0] : values;
        }
      }
    }
    return filtered;
  });
}

async function parseXmlResponse(xmlText: string): Promise<any> {
  try {
    return await parseStringPromise(xmlText, {
      explicitArray: false, ignoreAttrs: false, mergeAttrs: true, trim: true, normalize: true, normalizeTags: false,
    });
  } catch (error) {
    console.error("XML 파싱 오류:", error);
    return { raw_xml: xmlText, parse_error: String(error) };
  }
}

function extractDataFromResponse(response: any, dataPath?: string): any[] {
  if (!response) return [];
  if (dataPath) {
    const data = getNestedValue(response, dataPath);
    if (data !== undefined) return Array.isArray(data) ? data : [data];
  }
  if (Array.isArray(response)) return response;
  if (typeof response === "object") {
    const commonPaths = [
      "data", "items", "results", "records", "list", "rows", "content",
      "response", "body", "documents", "entries", "objects",
      "data.items", "data.list", "data.results", "data.records",
      "response.body", "response.data", "response.items",
      "result.data", "result.items", "result.list",
      "response.body.items.item", "response.body.items",
      "LawSearch.law", "AdmRulSearch.admrul", "OrdinSearch.ordin",
      "PrecSearch.prec", "DecsSearch.decis",
      "LawService.law", "AdmRulService.admrul", "OrdinService.ordin",
      "page.content", "page.items", "_embedded.items", "_embedded.data",
    ];
    for (const p of commonPaths) {
      const data = getNestedValue(response, p);
      if (data !== undefined && data !== null) {
        if (Array.isArray(data)) return data;
        if (typeof data === "object" && Object.keys(data).length > 0) {
          const innerArray = Object.values(data).find(v => Array.isArray(v));
          if (innerArray) return innerArray as any[];
          return [data];
        }
      }
    }
    for (const key of Object.keys(response)) {
      if (Array.isArray(response[key])) return response[key];
    }
    for (const key of Object.keys(response)) {
      if (typeof response[key] === "object" && response[key] !== null) {
        for (const subKey of Object.keys(response[key])) {
          if (Array.isArray(response[key][subKey])) return response[key][subKey];
        }
      }
    }
    return [response];
  }
  return [];
}

async function applyAuthentication(
  url: URL, headers: Record<string, string>, auth: ApiAuth, logs?: string[]
): Promise<void> {
  const authType = auth.type || "param";
  switch (authType) {
    case "param":
    case "header": {
      const authIn = (auth.in || (authType === "header" ? "header" : "query")).toLowerCase();
      const authName = auth.param_name || auth.name || "";
      const secret = getEnvSecret(auth.secret_ref);
      if (secret && authName) {
        if (authIn === "header") { headers[authName] = secret; logs?.push(`[AUTH] 헤더 인증: ${authName}`); }
        else { url.searchParams.set(authName, secret); logs?.push(`[AUTH] 쿼리 파라미터 인증: ${authName}`); }
      } else if (!secret && auth.secret_ref) {
        logs?.push(`[WARN] 인증 시크릿을 찾을 수 없음: ${auth.secret_ref}`);
      }
      break;
    }
    case "bearer": {
      const token = getEnvSecret(auth.secret_ref);
      const prefix = auth.bearer_prefix || "Bearer";
      if (token) { headers["Authorization"] = `${prefix} ${token}`; logs?.push(`[AUTH] Bearer 토큰 인증 적용`); }
      else if (auth.secret_ref) { logs?.push(`[WARN] Bearer 토큰을 찾을 수 없음: ${auth.secret_ref}`); }
      break;
    }
    case "basic": {
      const username = getEnvSecret(auth.username_ref);
      const password = getEnvSecret(auth.password_ref);
      if (username && password) {
        const credentials = Buffer.from(`${username}:${password}`).toString("base64");
        headers["Authorization"] = `Basic ${credentials}`;
        logs?.push(`[AUTH] Basic 인증 적용`);
      } else { logs?.push(`[WARN] Basic 인증 정보를 찾을 수 없음`); }
      break;
    }
    case "oauth2": {
      if (!auth.token_url) { logs?.push(`[WARN] OAuth2 token_url이 설정되지 않음`); break; }
      const clientId = getEnvSecret(auth.client_id_ref);
      const clientSecret = getEnvSecret(auth.client_secret_ref);
      if (!clientId || !clientSecret) { logs?.push(`[WARN] OAuth2 클라이언트 정보를 찾을 수 없음`); break; }
      try {
        const tokenResponse = await fetch(auth.token_url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, ...(auth.scope ? { scope: auth.scope } : {}) }),
          signal: AbortSignal.timeout(30000),
        });
        if (!tokenResponse.ok) { logs?.push(`[ERROR] OAuth2 토큰 요청 실패: ${tokenResponse.status}`); break; }
        const tokenData = await tokenResponse.json();
        if (tokenData.access_token) {
          headers["Authorization"] = `${tokenData.token_type || "Bearer"} ${tokenData.access_token}`;
          logs?.push(`[AUTH] OAuth2 토큰 획득 성공`);
        } else { logs?.push(`[WARN] OAuth2 응답에서 access_token을 찾을 수 없음`); }
      } catch (error) { logs?.push(`[ERROR] OAuth2 토큰 요청 오류: ${error}`); }
      break;
    }
    default: logs?.push(`[WARN] 알 수 없는 인증 타입: ${authType}`);
  }
}

async function executeSingleApiCall(
  apiProfile: ApiProfile, endpoint: EndpointConfig, params: Record<string, string>,
  bodyData?: Record<string, any>, logs?: string[]
): Promise<{ data: any; error?: string; url?: string; rawXml?: string; hierarchicalData?: any }> {
  const baseUrl = apiProfile.base_url;
  if (!baseUrl) return { data: null, error: "base_url이 설정되지 않았습니다." };
  if (!endpoint.path) return { data: null, error: "endpoint path가 설정되지 않았습니다." };
  try {
    const url = new URL(endpoint.path, baseUrl);
    const method = (endpoint.method || "GET").toUpperCase();
    const headers: Record<string, string> = {
      "User-Agent": "EcoMonitorBot/1.0 (cli_api_scraper)",
      Accept: "application/json, application/xml, text/xml, text/html, */*",
    };
    if (method === "GET") {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
      }
    }
    if (apiProfile.auth) await applyAuthentication(url, headers, apiProfile.auth, logs);
    const fetchOptions: RequestInit = { method, headers, signal: AbortSignal.timeout(60000) };
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const bodyType = endpoint.body_type || "json";
      const finalBody = bodyData || endpoint.body_template || params;
      if (bodyType === "json") {
        headers["Content-Type"] = "application/json";
        fetchOptions.body = JSON.stringify(finalBody);
      } else if (bodyType === "form") {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        fetchOptions.body = new URLSearchParams(finalBody as Record<string, string>).toString();
      }
    }
    logs?.push(`[REQUEST] ${method} ${url.toString()}`);
    const response = await fetch(url.toString(), fetchOptions);
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      logs?.push(`[ERROR] HTTP ${response.status}: ${response.statusText}`);
      if (errorText) logs?.push(`[ERROR] Response: ${errorText.slice(0, 500)}`);
      return { data: null, error: `HTTP ${response.status}: ${response.statusText}`, url: url.toString() };
    }
    const contentType = response.headers.get("content-type") || "";
    const responseText = await response.text();
    let data;
    if (contentType.includes("application/json") || contentType.includes("text/json")) {
      try { data = JSON.parse(responseText); } catch { data = { raw_text: responseText, content_type: contentType }; }
    } else if (contentType.includes("xml") || responseText.trim().startsWith("<?xml") || responseText.trim().startsWith("<")) {
      data = await parseXmlResponse(responseText);
      return { data, url: url.toString(), rawXml: responseText, hierarchicalData: data };
    } else {
      try { data = JSON.parse(responseText); } catch { data = { raw_text: responseText, content_type: contentType }; }
    }
    return { data, url: url.toString() };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logs?.push(`[ERROR] ${errorMsg}`);
    return { data: null, error: errorMsg };
  }
}

async function executeListApiCallForCli(
  apiProfile: ApiProfile, apiConfig: ApiConfig, pageParams?: Record<string, string>, logs?: string[]
): Promise<{ data: any; error?: string; url?: string }> {
  const endpoint = apiConfig.primary_endpoint;
  let params: Record<string, string> = {};
  for (const [k, v] of Object.entries(apiProfile.default_params ?? {})) {
    if (v !== undefined && v !== null && v !== "") params[k] = String(v);
  }
  for (const [k, v] of Object.entries(apiConfig.params || {})) {
    if (v !== undefined && v !== null && v !== "") params[k] = String(v);
  }
  params = applyDateFilters(params, apiConfig.date_filters);
  if (pageParams) params = { ...params, ...pageParams };
  return executeSingleApiCall(apiProfile, endpoint, params, undefined, logs);
}

function extractIdFromListItem(item: any, idField: string): string | null {
  if (!item || !idField) return null;
  const value = getNestedValue(item, idField);
  return value !== undefined && value !== null ? String(value) : null;
}

function extractItemTitle(item: any, titleField?: string): string {
  if (titleField) {
    const title = getNestedValue(item, titleField);
    if (title) return String(title);
  }
  const commonTitleFields = ["title", "name", "label", "subject", "headline", "제목", "이름", "명칭", "법령명", "법령명_한글"];
  for (const field of commonTitleFields) {
    if (item[field]) return String(item[field]);
  }
  return "제목 없음";
}

// ============================================================
// API 보드 스크래핑 메인 함수
// ============================================================

async function runApiScraper(options: ScraperOptions): Promise<ScrapingResult> {
  const { board, org, outputDir } = options;
  const startTime = Date.now();
  const logs: string[] = [];

  const result: ScrapingResult = {
    success: false,
    boardId: board.board_id,
    boardName: board.board_name,
    orgId: org.org_id,
    orgName: org.org_name,
    articlesCount: 0,
    attachmentsCount: 0,
    articles: [],
    errors: [],
    executedAt: new Date().toISOString(),
    durationMs: 0,
  };

  console.log(`\n========================================`);
  console.log(`API 스크래핑 시작: ${org.org_name} - ${board.board_name}`);
  console.log(`========================================\n`);

  try {
    const apiConfig = board.api_config;
    if (!apiConfig || !apiConfig.primary_endpoint) {
      throw new Error("api_config 또는 primary_endpoint가 설정되지 않았습니다");
    }

    const apiProfile: ApiProfile = (org.api_profile || {}) as ApiProfile;
    if (!apiProfile.base_url && org.base_url) {
      apiProfile.base_url = org.base_url;
    }

    if (!apiProfile.base_url) {
      throw new Error("API base_url이 설정되지 않았습니다");
    }

    console.log(`🔗 Base URL: ${apiProfile.base_url}`);
    console.log(`📡 엔드포인트: ${apiConfig.primary_endpoint.path}`);

    const rateLimit = apiConfig.rate_limit || {};
    const delayBetweenRequests = rateLimit.delay_between_requests ?? 300;
    const delayBetweenPages = rateLimit.delay_between_pages ?? 500;

    const pagination = apiConfig.pagination;
    const maxPages = pagination?.max_pages || 1;
    const pageSize = pagination?.page_size || 100;
    const pageParam = pagination?.param_name || "page";

    const twoPhase = apiConfig.two_phase;
    const secondaryEndpoint = apiConfig.secondary_endpoints?.[0];
    const fieldMappings = twoPhase?.field_mappings && twoPhase.field_mappings.length > 0
      ? twoPhase.field_mappings
      : twoPhase?.list_id_field && twoPhase?.detail_id_param
        ? [{ source_field: twoPhase.list_id_field, target_param: twoPhase.detail_id_param }]
        : [];
    const isTwoPhaseMode = twoPhase?.enabled && secondaryEndpoint && fieldMappings.length > 0;
    const maxListItems = twoPhase?.max_list_items ?? 100;
    const maxDetailItems = twoPhase?.max_detail_items ?? twoPhase?.max_details ?? 10;

    if (isTwoPhaseMode) {
      console.log(`🔄 2단계 호출 모드:`);
      console.log(`  1단계: 목록 → ${secondaryEndpoint!.path}`);
      console.log(`  2단계: 본문 → ${apiConfig.primary_endpoint.path}`);
    }

    let allData: any[] = [];
    let listItems: any[] = [];
    const rawXmlResponses: string[] = [];
    const hierarchicalDataList: any[] = [];

    const listEndpoint = isTwoPhaseMode ? secondaryEndpoint! : apiConfig.primary_endpoint;
    const listParams: Record<string, string> = isTwoPhaseMode
      ? { ...apiConfig.params, ...(secondaryEndpoint!.params || {}) }
      : apiConfig.params;

    const useFilterKeywords = twoPhase?.use_filter_keywords ?? false;
    const queryParamName = twoPhase?.query_param_name ?? "query";
    const filterMappingsForQuery = twoPhase?.filter_mappings ?? [];

    let searchKeywords: string[] = [];
    if (isTwoPhaseMode && useFilterKeywords && filterMappingsForQuery.length > 0 && apiConfig.search_filters) {
      for (const fm of filterMappingsForQuery) {
        const filter = apiConfig.search_filters[fm.primary_filter_idx];
        if (filter?.keywords?.length) searchKeywords.push(...filter.keywords);
      }
      searchKeywords = [...new Set(searchKeywords)];
    }

    if (searchKeywords.length > 0) {
      console.log(`🔍 키워드별 순차 검색 모드 (${searchKeywords.length}개)`);
      const seenIds = new Set<string>();
      const idField = fieldMappings[0]?.source_field || "법령ID";

      for (let kwIdx = 0; kwIdx < searchKeywords.length; kwIdx++) {
        const keyword = searchKeywords[kwIdx];
        console.log(`  검색 ${kwIdx + 1}/${searchKeywords.length}: "${keyword.slice(0, 30)}"`);
        const keywordParams: Record<string, string> = { ...listParams };
        keywordParams[queryParamName] = keyword;
        keywordParams[pageParam] = "1";
        const callLogs: string[] = [];
        const listApiConfig = { ...apiConfig, primary_endpoint: listEndpoint, params: keywordParams };
        const apiResult = await executeListApiCallForCli(apiProfile, listApiConfig, {}, callLogs);
        logs.push(...callLogs);
        if (apiResult.error) { console.log(`  ⚠️ 검색 실패: ${apiResult.error}`); continue; }
        const items = extractDataFromResponse(apiResult.data, apiConfig.response_data_path);
        console.log(`  → ${items.length}건 검색됨`);
        for (const item of items) {
          const id = getNestedValue(item, idField);
          const idStr = id ? String(id) : JSON.stringify(item);
          if (!seenIds.has(idStr)) { seenIds.add(idStr); listItems.push(item); }
        }
        if (kwIdx < searchKeywords.length - 1) await apiDelay(delayBetweenRequests);
      }
      console.log(`키워드 검색 완료: 총 ${listItems.length}건`);
    } else {
      for (let page = 1; page <= maxPages; page++) {
        console.log(`📄 목록 조회 페이지 ${page}/${maxPages}...`);
        let pageParams: Record<string, string> = {};
        if (pagination && pagination.type !== "none") {
          switch (pagination.type) {
            case "page": pageParams[pageParam] = String(page); break;
            case "offset": pageParams[pageParam] = String((page - 1) * pageSize); break;
            default: pageParams[pageParam] = String(page);
          }
        }
        const callLogs: string[] = [];
        const listApiConfig = { ...apiConfig, primary_endpoint: listEndpoint, params: listParams };
        const apiResult = await executeListApiCallForCli(apiProfile, listApiConfig, pageParams, callLogs);
        logs.push(...callLogs);
        if (apiResult.error) { throw new Error(`API 호출 실패: ${apiResult.error}`); }
        const items = extractDataFromResponse(apiResult.data, apiConfig.response_data_path);
        console.log(`  → ${items.length}건 추출`);
        if (items.length === 0) { console.log("  데이터 없음, 페이지네이션 종료"); break; }
        listItems.push(...items);
        if (page < maxPages) await apiDelay(delayBetweenPages);
      }
    }

    console.log(`\n📊 목록 조회 완료: 총 ${listItems.length}건`);

    if (isTwoPhaseMode && listItems.length > 0) {
      console.log(`\n📄 본문 조회 시작 (주 엔드포인트)...`);

      let filteredListItems = listItems;
      const filterMappingsConfig = twoPhase?.filter_mappings ?? [];
      const skipFilterMapping = useFilterKeywords;

      if (!skipFilterMapping && filterMappingsConfig.length > 0 && apiConfig.search_filters?.length) {
        filteredListItems = listItems.filter((item) => {
          for (const fm of filterMappingsConfig) {
            const filter = apiConfig.search_filters?.[fm.primary_filter_idx];
            if (!filter) continue;
            const fieldValue = getNestedValue(item, fm.secondary_field);
            if (fieldValue === undefined || fieldValue === null) continue;
            const fieldValueStr = String(fieldValue);
            let matched = false;
            switch (filter.match_type) {
              case "exact": matched = filter.keywords.some((kw) => fieldValueStr === kw); break;
              case "regex": matched = filter.keywords.some((kw) => { try { return new RegExp(kw, "i").test(fieldValueStr); } catch { return false; } }); break;
              default: matched = filter.keywords.some((kw) => fieldValueStr.includes(kw)); break;
            }
            if (!matched) return false;
          }
          return true;
        });
        console.log(`  필터 매핑 적용: ${listItems.length}건 → ${filteredListItems.length}건`);
      }

      const limitedListItems = filteredListItems.slice(0, maxListItems);
      const itemsToFetch = limitedListItems.slice(0, maxDetailItems);
      console.log(`  본문 조회 대상: ${itemsToFetch.length}건`);

      const detailBaseParams: Record<string, string> = {};
      if (apiConfig.params) {
        for (const [k, v] of Object.entries(apiConfig.params)) { if (v) detailBaseParams[k] = String(v); }
      }
      if (apiConfig.primary_endpoint.params) {
        for (const [k, v] of Object.entries(apiConfig.primary_endpoint.params)) { if (v) detailBaseParams[k] = String(v); }
      }

      for (let i = 0; i < itemsToFetch.length; i++) {
        const item = itemsToFetch[i];
        const mappedParams: Record<string, string> = { ...detailBaseParams };
        let mappingSuccess = true;
        for (const mapping of fieldMappings) {
          const fieldValue = extractIdFromListItem(item, mapping.source_field);
          if (!fieldValue) { mappingSuccess = false; break; }
          mappedParams[mapping.target_param] = fieldValue;
        }
        if (!mappingSuccess) continue;

        const itemTitle = extractItemTitle(item, apiConfig.title_field);
        console.log(`  본문 ${i + 1}/${itemsToFetch.length}: ${itemTitle.slice(0, 40)}`);

        const detailLogs: string[] = [];
        const detailResult = await executeSingleApiCall(apiProfile, apiConfig.primary_endpoint, mappedParams, undefined, detailLogs);
        logs.push(...detailLogs);

        if (detailResult.error) {
          console.log(`  ⚠️ 본문 조회 실패: ${detailResult.error}`);
          allData.push({ ...item, _detail_error: detailResult.error });
        } else {
          const detailRoot = extractDetailRootObject(detailResult.data) ?? detailResult.data;
          allData.push({ ...item, _detail: detailRoot, _from_list: item });
          if (detailResult.rawXml) rawXmlResponses.push(detailResult.rawXml);
          if (detailResult.hierarchicalData) {
            hierarchicalDataList.push(extractDetailRootObject(detailResult.hierarchicalData) ?? detailResult.hierarchicalData);
          }
        }
        if (i < itemsToFetch.length - 1) await apiDelay(delayBetweenRequests);
      }
      console.log(`본문 조회 완료: ${allData.length}건`);
    } else {
      allData = listItems;
    }

    if (apiConfig.search_filters?.length) {
      const beforeCount = allData.length;
      allData = applySearchFilters(allData, apiConfig.search_filters);
      console.log(`검색 필터 적용: ${beforeCount}건 → ${allData.length}건`);
    }

    if (apiConfig.response_fields?.length) {
      allData = filterResponseFields(allData, apiConfig.response_fields);
      console.log(`응답 필드 필터링 완료 (${apiConfig.response_fields.length}개 필드)`);
    }

    if (allData.length > 0) {
      const { exportApiData } = await import("../lib/scraper/api-export");
      const saveDir = path.join(outputDir, "API");
      const docType = board.doc_type || "";
      const exportOptions = {
        docType,
        rawXmlResponses: rawXmlResponses.length > 0 ? rawXmlResponses : undefined,
        hierarchicalData: hierarchicalDataList.length > 0 ? hierarchicalDataList : undefined,
      };
      const exportResult = await exportApiData(allData, board.board_name, saveDir, undefined, exportOptions);
      if (exportResult.success) {
        console.log(`\n✅ 결과 저장 완료:`);
        if (exportResult.jsonPath) console.log(`  JSON: ${exportResult.jsonPath}`);
        if (exportResult.xlsxPath) console.log(`  XLSX: ${exportResult.xlsxPath}`);
        if (exportResult.docxPath) console.log(`  DOCX: ${exportResult.docxPath}`);
        if (exportResult.xmlPath) console.log(`  XML: ${exportResult.xmlPath}`);
      } else {
        throw new Error(`결과 저장 실패: ${exportResult.error}`);
      }
    } else {
      console.log("수집된 데이터가 없습니다.");
    }

    result.success = true;
    result.articlesCount = allData.length;
  } catch (err: any) {
    console.error(`\n❌ API 스크래핑 오류: ${err.message}`);
    result.errors.push(err.message);
  }

  result.durationMs = Date.now() - startTime;
  console.log(`\n========================================`);
  console.log(`API 스크래핑 완료: ${result.articlesCount}건`);
  console.log(`소요 시간: ${(result.durationMs / 1000).toFixed(1)}초`);
  console.log(`========================================\n`);

  return result;
}

// ============================================================
// 메인 스크래핑 함수
// ============================================================

export interface ScraperOptions {
  board: Board;
  org: Organization;
  outputDir: string;
  maxPages?: number;
  downloadAttachments?: boolean;
}

export async function runScraper(options: ScraperOptions): Promise<ScrapingResult> {
  const { board, org, outputDir, maxPages = 10, downloadAttachments = true } = options;

  // API 보드인 경우 API 스크래핑 함수로 라우팅
  if (board.access_mode === "api" || board.board_mode === "api") {
    return runApiScraper(options);
  }

  const startTime = Date.now();
  
  const result: ScrapingResult = {
    success: false,
    boardId: board.board_id,
    boardName: board.board_name,
    orgId: org.org_id,
    orgName: org.org_name,
    articlesCount: 0,
    attachmentsCount: 0,
    articles: [],
    errors: [],
    executedAt: new Date().toISOString(),
    durationMs: 0,
  };
  
  console.log(`\n========================================`);
  console.log(`스크래핑 시작: ${org.org_name} - ${board.board_name}`);
  console.log(`========================================\n`);
  
  try {
    const listUrl = board.list_url;
    if (!listUrl) {
      throw new Error("list_url이 설정되지 않았습니다");
    }
    
    // web_config 구성: collection_targets → file_types 변환
    const attCfg = board.collection_targets?.attachments;
    const resolvedFileTypes: string[] = [];
    if (attCfg && !attCfg.all && attCfg.enabled !== false) {
      if ((attCfg as Record<string, unknown>).hwpx) resolvedFileTypes.push("hwpx", "hwp");
      if ((attCfg as Record<string, unknown>).docx) resolvedFileTypes.push("docx", "doc");
      if ((attCfg as Record<string, unknown>).xlsx) resolvedFileTypes.push("xlsx", "xls", "csv");
      if ((attCfg as Record<string, unknown>).pdf) resolvedFileTypes.push("pdf");
    }
    const webConfig: WebConfig = {
      ...(board.web_config as WebConfig || {}),
      collect_body: board.collection_targets?.title_body ?? true,
      attachments: {
        ...(board.web_config as WebConfig || {}).attachments,
        enabled: attCfg?.enabled ?? true,
        collect_all: attCfg?.all ?? false,
        file_types: resolvedFileTypes.length > 0 ? resolvedFileTypes : undefined,
      },
      collection_range: board.collection_range ? {
        type: board.collection_range.type as any,
        start_date: board.collection_range.period_start,
        end_date: board.collection_range.period_end,
        days_before: board.collection_range.relative_days,
        years: board.collection_range.years,
      } : undefined,
    };
    
    const useBrowser = board.access_mode === "dynamic_js";
    let currentPage = 0;
    let shouldStop = false;
    const seenUrls = new Set<string>();
    let nextPageUrl: string | null = listUrl;  // next_button용 URL 추적
    
    // 출력 디렉토리 생성
    const boardOutputDir = path.join(outputDir, board.board_id);
    const attachmentsDir = path.join(boardOutputDir, "attachments");
    fs.mkdirSync(attachmentsDir, { recursive: true });
    
    while (!shouldStop && currentPage < maxPages && nextPageUrl) {
      currentPage++;
      console.log(`\n--- 페이지 ${currentPage} 처리 중 ---`);
      
      // 페이지 URL 구성
      let pageUrl = nextPageUrl;
      const pagination = webConfig.list?.pagination;
      
      // page_param과 offset_param은 URL 파라미터로 계산
      if (pagination && currentPage > 1 && pagination.type !== "next_button") {
        if (pagination.type === "page_param") {
          const param = pagination.param || "page";
          const start = pagination.start ?? 1;
          const urlObj = new URL(listUrl);
          urlObj.searchParams.set(param, String(start + currentPage - 1));
          pageUrl = urlObj.toString();
        } else if (pagination.type === "offset_param") {
          const param = pagination.param || "offset";
          const step = pagination.step || 10;
          const start = pagination.start ?? 0;
          const urlObj = new URL(listUrl);
          urlObj.searchParams.set(param, String(start + (currentPage - 1) * step));
          pageUrl = urlObj.toString();
        }
      }
      
      console.log(`[URL] ${pageUrl}`);
      
      // 목록 페이지 가져오기
      let html: string;
      try {
        if (useBrowser) {
          html = await fetchRenderedHtml(pageUrl, board.browser_config?.wait_time || 2000);
        } else {
          html = await fetchStaticHtml(pageUrl);
        }
      } catch (err: any) {
        result.errors.push(`페이지 ${currentPage} 로드 실패: ${err.message}`);
        break;
      }
      
      // 목록 파싱 ($ 객체도 함께 받아서 next_button 처리에 사용)
      const { items, $ } = parseListPage(html, pageUrl, webConfig);
      
      // next_button 타입: 다음 페이지 URL 추출
      if (pagination?.type === "next_button" && pagination.selector) {
        const $next = $(pagination.selector);
        const nextHref = $next.attr("href");
        if (nextHref && nextHref !== "#" && !nextHref.startsWith("javascript:")) {
          nextPageUrl = resolveUrl(pageUrl, nextHref);
          console.log(`[NEXT] 다음 페이지 URL 발견: ${nextPageUrl}`);
        } else {
          nextPageUrl = null;
          console.log(`[NEXT] 다음 페이지 없음`);
        }
      } else if (pagination?.type === "page_param" || pagination?.type === "offset_param") {
        // page_param/offset_param은 항목이 있으면 계속 진행
        nextPageUrl = items.length > 0 ? listUrl : null;
      } else {
        // pagination 없거나 none이면 첫 페이지만
        nextPageUrl = null;
      }
      
      if (items.length === 0) {
        console.log("항목 없음, 종료");
        break;
      }
      
      console.log(`${items.length}개 항목 발견`);
      
      // 각 항목 처리
      let consecutiveStopCount = 0;
      const STOP_THRESHOLD = 3;
      
      for (const item of items) {
        // 중복 체크
        if (seenUrls.has(item.link)) {
          continue;
        }
        seenUrls.add(item.link);
        
        // 날짜 범위 체크
        const itemDate = parseDate(item.date || "");
        const rangeCheck = checkCollectionRange(itemDate, webConfig.collection_range);
        
        if (rangeCheck === "stop") {
          consecutiveStopCount++;
          if (consecutiveStopCount >= STOP_THRESHOLD) {
            console.log(`날짜 범위 종료 (연속 ${STOP_THRESHOLD}개)`);
            shouldStop = true;
            break;
          }
          continue;
        }
        
        consecutiveStopCount = 0;
        
        if (rangeCheck === false) {
          continue;
        }
        
        console.log(`[NEW] ${item.title.slice(0, 50)}...`);
        
        // 상세 페이지 처리
        let content = "";
        let attachments: AttachmentInfo[] = [];
        let detailMetadata: { [key: string]: string } | undefined;
        
        if (webConfig.collect_body || webConfig.attachments?.enabled) {
          try {
            await delay(500);
            const detail = await parseDetailPage(item.link, webConfig, useBrowser);
            content = detail.content;
            attachments = detail.attachments;
            detailMetadata = detail.metadata;
            console.log(`  본문: ${content.length}자, 첨부: ${attachments.length}개`);
          } catch (err: any) {
            result.errors.push(`상세 페이지 실패 (${item.title}): ${err.message}`);
            continue;
          }
        }
        
        // 첨부파일 다운로드
        const downloadedAttachments: ScrapedArticle["attachments"] = [];
        
        if (downloadAttachments && attachments.length > 0) {
          for (const att of attachments) {
            const safeFileName = att.fileName.replace(/[<>:"/\\|?*]/g, "_");
            const localPath = path.join(attachmentsDir, safeFileName);
            
            const success = await downloadFile(att.downloadUrl, localPath, item.link);
            
            downloadedAttachments.push({
              fileName: att.fileName,
              downloadUrl: att.downloadUrl,
              localPath: success ? localPath : undefined,
            });
            
            if (success) {
              result.attachmentsCount++;
            }
          }
        }
        
        result.articles.push({
          title: item.title,
          date: item.date || "",
          link: item.link,
          content,
          attachments: downloadedAttachments,
          ...(detailMetadata ? { metadata: detailMetadata } : {}),
        });
        
        result.articlesCount++;
      }
      
      // 페이지네이션 체크 (next_button이 아닌 경우 항목 없으면 종료)
      if (!pagination || pagination.type === "none") {
        break;
      }
      
      // 다음 페이지가 없으면 종료 (next_button에서 URL이 없을 때)
      if (!nextPageUrl) {
        console.log("다음 페이지 없음, 종료");
        break;
      }
      
      // 다음 페이지 요청 전 딜레이
      await delay(500);
    }
    
    result.success = true;
    
  } catch (err: any) {
    result.errors.push(`치명적 오류: ${err.message}`);
    console.error("스크래핑 오류:", err);
  } finally {
    await closeBrowser();
    result.durationMs = Date.now() - startTime;
  }
  
  // 결과 저장
  const boardOutputDir = path.join(outputDir, board.board_id);
  fs.mkdirSync(boardOutputDir, { recursive: true });
  
  // documents.json
  const documentsPath = path.join(boardOutputDir, "documents.json");
  fs.writeFileSync(documentsPath, JSON.stringify(result.articles, null, 2), "utf8");
  
  // report.json
  const reportPath = path.join(boardOutputDir, "report.json");
  const report = {
    success: result.success,
    boardId: result.boardId,
    boardName: result.boardName,
    orgId: result.orgId,
    orgName: result.orgName,
    articlesCount: result.articlesCount,
    attachmentsCount: result.attachmentsCount,
    errors: result.errors,
    executedAt: result.executedAt,
    durationMs: result.durationMs,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  
  // 수집 현황 DB 동기화 (SQLite)
  if (result.articles.length > 0) {
    try {
      const downloadedFiles = result.articles
        .flatMap(a => a.attachments)
        .map(att => att.localPath)
        .filter((p): p is string => !!p);

      const dbSyncResult = await syncInstantScrapeToDB({
        boardId: result.boardId,
        orgId: result.orgId,
        articles: result.articles.map(a => ({
          title: a.title,
          link: a.link,
          date: a.date,
          content: a.content || "",
          attachments: a.attachments?.map(att => ({
            fileName: att.fileName,
            downloadUrl: att.downloadUrl,
          })),
        })),
        downloadedFiles,
        dedupKey: "url",
      });
      console.log(`[DB-SYNC] 수집 현황 DB 동기화 완료: ${dbSyncResult.docsAdded}건 추가, ${dbSyncResult.attachmentsAdded}건 첨부`);
    } catch (dbError) {
      console.error("[DB-SYNC] 수집 현황 DB 동기화 실패:", dbError);
      // DB 동기화 실패해도 스크래핑 결과에는 영향 없음
    }
  }

  console.log(`\n========================================`);
  console.log(`스크래핑 완료: ${result.articlesCount}건, 첨부파일 ${result.attachmentsCount}개`);
  console.log(`소요 시간: ${(result.durationMs / 1000).toFixed(1)}초`);
  console.log(`========================================\n`);
  
  return result;
}

// ============================================================
// 타겟 데이터 로드
// ============================================================

export interface ScraperTargets {
  orgs: Organization[];
  boards: Board[];
}

export function loadTargets(dataPath: string): ScraperTargets {
  const filePath = path.join(dataPath, "scraper-targets.json");
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`타겟 파일을 찾을 수 없습니다: ${filePath}`);
  }
  
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  
  return {
    orgs: data.orgs || [],
    boards: data.boards || [],
  };
}

export function findBoard(targets: ScraperTargets, boardId: string): Board | undefined {
  return targets.boards.find(b => b.board_id === boardId);
}

export function findOrg(targets: ScraperTargets, orgId: string): Organization | undefined {
  return targets.orgs.find(o => o.org_id === orgId);
}
