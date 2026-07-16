/**
 * API Profile 자동생성 (EcoMonitor analyze 이식, 도메인 중립).
 * URL(가이드/명세) 또는 원문 텍스트를 LLM에 넣어 api_profile + api_config + field_mapping 을 생성한다.
 * 국가법령정보센터 등 특정 사이트 하드코딩 분기는 제거하고, intel sink 표준필드 매핑 산출을 추가했다.
 * 결과는 DB에 저장하지 않고 proposal로 반환한다(사용자 확인 후 소스/엔드포인트에 커밋).
 */
import { anthropicChatJson } from "@/lib/ai/llm-json";
import type {
  ApiConfig,
  ApiProfile,
  CatalogEndpoint,
  FieldMapping,
  ProfileEndpoint,
  ScraperPurpose,
  SourceCatalog,
} from "./types";

const MAX_TEXT_CHARS = 180000;

export interface AnalyzeInput {
  slug: string;
  name: string;
  baseUrlHint?: string;
  url?: string;
  rawText?: string;
  /** 업로드된 가이드 파일(docx 등)에서 추출한 텍스트. */
  fileText?: string;
  fileName?: string;
  context?: string;
  /** 'intel'(기본) | 'bid' — field_mapping 표준필드셋을 결정. */
  purpose?: ScraperPurpose;
}

export interface AnalyzeResult {
  api_profile: ApiProfile;
  api_config: ApiConfig;
  field_mapping: FieldMapping;
  warnings: string[];
  summary: string;
}

/** 시크릿 env 이름 규칙 — slug 대문자화. */
export function secretEnvRef(slug: string): string {
  return `ENV:SCRAPER_${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_KEY`;
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "MCM-ScraperBot/1.0 (+intel)" },
    signal: AbortSignal.timeout(30000),
  });
  const ct = res.headers.get("content-type") || "";
  const body = await res.text();
  return ct.includes("html") ? stripHtmlToText(body) : body;
}

function buildPrompt(input: AnalyzeInput, combined: string): string {
  const secretRef = secretEnvRef(input.slug);
  const isBid = input.purpose === "bid";
  const fieldMappingSpec = isBid
    ? `7. **★ field_mapping (가장 중요)**: 응답 item 1건 기준. 이 API가 "공공기관의 발주계획/사전규격/입찰공고"를 다룬다는 전제로 아래 표준필드 경로를 채운다. 없으면 생략(빈 문자열 금지).
   - external_id: 공고번호/식별번호(orderPlanUntyNo·bfSpecRgstNo·bidNtceNo 등). 없으면 생략(URL 해시 폴백).
   - org_name: 발주기관/수요기관명.
   - title: 사업명/공고명.
   - budget: 예산·예정가격 금액 필드(숫자).
   - posted_at: 게시일/등록일시.
   - deadline: 입찰마감일시(있으면).
   - method: 조달방식/계약방법.
   - work_type: 업무구분(공사/물품/용역/외자).
   - category: 품목/업종 분류.
   - url: 원문 상세 링크(있으면).`
    : `7. **★ field_mapping (가장 중요)**: 응답 배열의 item 1건 기준으로, 아래 표준필드에 대응하는 필드 경로(점 표기)를 채운다. 이 API가 "회사/기업의 투자·설비 신호"를 다룬다는 전제로 가장 적합한 필드를 고른다. 없으면 생략(빈 문자열 금지).
   - external_id: 각 item의 고유 식별자(공고번호/일련번호/id 등). 없으면 생략(URL 해시로 폴백됨).
   - company_name: 회사/기관/사업주체명.
   - report_name: 제목/사업명/공고명.
   - url: 원문 상세 링크.
   - disclosed_at: 공시/등록/게시 일자.
   - summary: 요약/내용(선택).`;
  const fieldMappingSchema = isBid
    ? `"field_mapping": { "external_id": "...", "org_name": "...", "title": "...", "budget": "...", "posted_at": "...", "deadline": "...", "method": "...", "work_type": "...", "category": "...", "url": "..." }`
    : `"field_mapping": { "external_id": "...", "company_name": "...", "report_name": "...", "url": "...", "disclosed_at": "...", "summary": "..." }`;
  return `너는 임의의 공개 REST/OPEN API 명세(가이드 문서/응답 예시)를 분석해, 그 API를 곧바로 호출·수집할 수 있는
프로파일을 생성한다. **JSON 하나만 출력한다**(설명 텍스트 금지).

## 분석 규칙
1. **엔드포인트 경로**: 실제 호출 URL 예시에서 path 추출(예 "https://api.data.go.kr/1230000/ao/PubDataOpnStdService" → path). 추상 경로를 지어내지 말 것. 못 찾으면 warnings에 "endpoint_path_uncertain".
2. **인증 자동감지**: authKey/serviceKey/ServiceKey/apiKey/인증키 → auth.type="apiKey", param_name=해당명. OC/사용자ID만 → type="param". 둘 다 → "multi". 인증 없음 → "none". 불명 → "unknown"+warnings "auth_method_uncertain". **secret_ref 는 반드시 "${secretRef}" 로 지정**. ★ 공공데이터포털(data.go.kr)류면 param_name 은 **정확히 "serviceKey"(소문자 s로 시작)** 로 하라(대소문자 다르면 서버가 무시함).
3. **파라미터**: 필수/고정값(항상 같은 값)은 default_params 와 api_config.params 에, 가변값은 variable_params 에. 시크릿(인증키) 값은 절대 넣지 말고 auth.secret_ref 로만.
4. **응답형식**: JSON/XML 감지. response_mapping.format 에 "JSON" 또는 "XML". ★ 공공데이터포털류가 응답형식 파라미터(_type/type/dataType)로 JSON 을 지원하면 **default_params 에 그 파라미터=json 을 넣어라**(예 "_type":"json"). 그런 파라미터 없이 XML 만 반환하면 warnings 에 "xml_unsupported_mvp".
5. **응답 배열 경로**: 목록 item 이 **배열로 직접 담긴 경로**를 response_mapping.list_path 에. 공공데이터포털처럼 items 래퍼 아래 item 배열이면 "response.body.items.item" 까지, 또는 래퍼 "response.body.items" 로 지정(둘 다 실행기가 item 배열을 풀어낸다).
6. **페이지네이션**: api_config.pagination(type "page"|"offset"|"none"). param_name=페이지번호/오프셋 파라미터명(예 pageNo). **페이지당 건수 파라미터(예 numOfRows/display/perPage)가 따로 있으면 size_param 에 그 이름을, page_size 에 값을 넣어라**(누락하면 기본 소량만 조회됨).
6b. **필수 조회기간(날짜 범위)**: 조회기간(inqryBgnDt/inqryEndDt, bidNtceBgnDt/EndDt, fromDt/toDt 등)이 **필수**면 고정값 대신 **api_config.date_filters** 로 산출하라. 시작일 필드는 field 에 그 이름, relative_days 에 조회할 과거 일수(기본 30), format 은 명세의 날짜형식("YYYYMMDD" 등)으로. 종료일 필드는 별도 date_filter(field=종료일명, relative_days 동일)로. 이렇게 하면 매 실행 시 최근 기간이 자동 계산된다. 날짜 외 필수 구분값은 params 에 포함하라.
${fieldMappingSpec}

## 출력 스키마(JSON만)
{
  "api_profile": {
    "base_url": "http(s)://도메인",
    "auth": { "type": "apiKey|param|multi|none|unknown", "in": "query|header", "param_name": "ServiceKey 등", "secret_ref": "${secretRef}" },
    "default_params": { "고정키": "값", "_type": "json (공공데이터포털이 지원할 때만)" },
    "response_mapping": { "format": "JSON|XML", "list_path": "response.body.items.item" },
    "constraints": { "ip_allowlist_required": false, "rate_limit_hint": "", "approval_required": false },
    "status": "draft"
  },
  "api_config": {
    "primary_endpoint": { "name": "엔드포인트명", "path": "/실제/경로", "method": "GET" },
    "params": { "가변·고정 기본 파라미터(날짜 제외)": "값" },
    "pagination": { "type": "page|offset|none", "param_name": "pageNo", "size_param": "numOfRows", "page_size": 100, "max_pages": 3 },
    "date_filters": [ { "field": "inqryBgnDt", "relative_days": 30, "format": "YYYYMMDD" }, { "field": "inqryEndDt", "relative_days": 0, "format": "YYYYMMDD" } ]
  },
  ${fieldMappingSchema},
  "warnings": ["불확실 항목"],
  "summary": "분석 요약(한국어 1~2문장)"
}

## 입력
ORG: ${input.name} (slug: ${input.slug})
${combined}`.trim();
}

function asStringRecord(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val != null && val !== "") out[k] = String(val);
  }
  return out;
}

export async function analyzeApiSource(input: AnalyzeInput): Promise<AnalyzeResult> {
  const parts: string[] = [];
  if (input.baseUrlHint) parts.push(`BASE_URL_HINT: ${input.baseUrlHint}`);
  if (input.context) parts.push(`USER_CONTEXT:\n${input.context}`);
  if (input.url) {
    parts.push(`GUIDE_URL: ${input.url}`);
    const t = await fetchText(input.url).catch(() => "");
    if (t) parts.push(`URL_TEXT:\n${t}`);
  }
  if (input.fileText) parts.push(`GUIDE_FILE${input.fileName ? ` (${input.fileName})` : ""}:\n${input.fileText}`);
  if (input.rawText) parts.push(`RAW_TEXT:\n${input.rawText}`);
  const combinedRaw = parts.join("\n\n");
  if (!combinedRaw.trim()) {
    throw new Error("분석할 URL·가이드 파일 또는 명세 원문이 필요합니다.");
  }
  const combined = combinedRaw.slice(0, MAX_TEXT_CHARS);

  const raw = await anthropicChatJson<Partial<AnalyzeResult>>({
    system: "너는 임의의 공개 REST/OPEN API 명세를 분석해 실행 가능한 프로파일을 생성하는 전문가다. 반드시 JSON 하나만 출력한다.",
    user: buildPrompt(input, combined),
    model: "claude-sonnet-5",
    maxTokens: 6000,
    timeoutMs: 60000,
  });

  // 방어적 정규화 — secret_ref 강제, 누락 필드 기본값, warnings 배열 보장.
  const profile: ApiProfile = (raw.api_profile as ApiProfile) ?? {};
  if (!profile.base_url && input.baseUrlHint) profile.base_url = input.baseUrlHint;
  if (profile.auth && (profile.auth.type ?? "none") !== "none") {
    profile.auth.secret_ref = secretEnvRef(input.slug);
    if (!profile.auth.in) profile.auth.in = "query";
  }
  if (!profile.status) profile.status = "draft";

  const cfg = (raw.api_config as ApiConfig) ?? { primary_endpoint: { path: "" }, params: {} };
  cfg.params = asStringRecord(cfg.params);
  if (cfg.pagination && cfg.pagination.type == null) cfg.pagination.type = "none";

  const warnings = Array.isArray(raw.warnings) ? raw.warnings.map(String) : [];
  const fmt = profile.response_mapping?.format;
  if (fmt && String(fmt).toUpperCase() === "XML" && !warnings.includes("xml_unsupported_mvp")) {
    warnings.push("xml_unsupported_mvp");
  }

  return {
    api_profile: profile,
    api_config: cfg,
    field_mapping: asStringRecord(raw.field_mapping),
    warnings,
    summary: typeof raw.summary === "string" ? raw.summary : "",
  };
}

// ─────────────────────────────────────────────────────────────
// 2단 분석 (Web Scraper Final 이식): ① 카탈로그 추출 → 사용자가 엔드포인트 취사선택
// → ② 선택 항목만 정제해 api_profile.endpoints[] + 엔드포인트별 제안 생성.
// ─────────────────────────────────────────────────────────────

/** 분석 입력 텍스트 조립(공용). */
async function combineInput(input: AnalyzeInput): Promise<string> {
  const parts: string[] = [];
  if (input.baseUrlHint) parts.push(`BASE_URL_HINT: ${input.baseUrlHint}`);
  if (input.context) parts.push(`USER_CONTEXT:\n${input.context}`);
  if (input.url) {
    parts.push(`GUIDE_URL: ${input.url}`);
    const t = await fetchText(input.url).catch(() => "");
    if (t) parts.push(`URL_TEXT:\n${t}`);
  }
  if (input.fileText) parts.push(`GUIDE_FILE${input.fileName ? ` (${input.fileName})` : ""}:\n${input.fileText}`);
  if (input.rawText) parts.push(`RAW_TEXT:\n${input.rawText}`);
  const combined = parts.join("\n\n");
  if (!combined.trim()) throw new Error("분석할 URL·가이드 파일 또는 명세 원문이 필요합니다.");
  return combined.slice(0, MAX_TEXT_CHARS);
}

export interface ExtractCatalogResult {
  catalog: SourceCatalog;
  warnings: string[];
  summary: string;
}

/** 문서 발췌에서 특정 오퍼레이션의 요청변수·응답필드를 완전 추출(카탈로그 2차·build 상세 보충 공용). */
async function extractOpDetail(
  op: { title: string },
  doc: string
): Promise<Pick<CatalogEndpoint, "request_params" | "response_fields">> {
  const d = await anthropicChatJson<{ request_params?: unknown[]; response_fields?: unknown[] }>({
    system: "너는 API 가이드에서 특정 오퍼레이션의 요청변수·응답필드를 완전하게 추출하는 전문가다. 반드시 JSON 하나만 출력한다.",
    user: `아래 문서 발췌에서 오퍼레이션 "${op.title}" 의 **요청변수와 응답필드를 하나도 빠짐없이** 추출한다. **JSON 하나만 출력**(설명 금지).
- 요청변수가 12개면 12개 전부, 응답필드가 60개면 60개 전부. 요약·생략 금지. 문서에 없는 값은 지어내지 말 것.
- request_params[]: { "name": 영문 변수명, "name_ko": 한글명, "required": true/false(문서의 필수/옵션 표기), "type": 형, "description": 설명, "example": 샘플값(있으면) }
- response_fields[]: { "name": 영문 필드명, "name_ko": 한글명, "type": 형, "description": 설명 }

## 출력 스키마
{ "request_params": [...], "response_fields": [...] }

## 문서 발췌
${doc}`.trim(),
    model: "claude-sonnet-5",
    maxTokens: 24000,
    timeoutMs: 180000,
  });
  const params = Array.isArray(d.request_params) ? d.request_params : [];
  const fields = Array.isArray(d.response_fields) ? d.response_fields : [];
  return {
    request_params: params.filter((p): p is CatalogEndpoint["request_params"][number] => !!p && typeof (p as { name?: unknown }).name === "string"),
    response_fields: fields.filter((f): f is CatalogEndpoint["response_fields"][number] => !!f && typeof (f as { name?: unknown }).name === "string"),
  };
}

/**
 * 오퍼레이션 제목 기준으로 문서에서 해당 구간만 잘라낸다(상세 추출 입력·시간 절감).
 * 제목은 목차·본문 등 여러 번 등장하므로, **모든 등장 위치 중 다음 제목까지의 구간이 가장 긴 곳(=본문 상세)**을 고른다.
 * (첫 등장만 쓰면 목차 몇 줄만 잘려 파라미터/필드가 비는 문제 — E2E 실측.)
 * 구간이 너무 짧거나 못 찾으면 전체 문서 fallback.
 */
function sliceDocForOp(doc: string, title: string, allTitles: string[]): string {
  const PAD = 500;
  const MIN_SLICE = 1500;
  const positions: number[] = [];
  let p = doc.indexOf(title);
  while (p >= 0 && positions.length < 30) {
    positions.push(p);
    p = doc.indexOf(title, p + title.length);
  }
  if (!positions.length) return doc;
  let best = { start: positions[0], end: doc.length, len: 0 };
  for (const start of positions) {
    let end = doc.length;
    for (const t of allTitles) {
      if (t === title) continue;
      const q = doc.indexOf(t, start + title.length);
      if (q > start && q < end) end = q;
    }
    if (end - start > best.len) best = { start, end, len: end - start };
  }
  if (best.len < MIN_SLICE) return doc;
  return doc.slice(Math.max(0, best.start - PAD), Math.min(doc.length, best.end + PAD));
}

/**
 * ① 가이드에서 엔드포인트×요청변수×응답필드 "카탈로그"를 추출한다(선택지 나열이 목적 — 판단 없음).
 * 결과는 scraper_sources.catalog 에 저장하고, UI가 카드로 나열해 사용자가 취사선택한다.
 * 단일 호출은 출력이 수만 토큰이라 llm_timeout 이 나므로(원본도 배치 처리) **2패스**로 나눈다:
 * 1차 오퍼레이션 목록(가벼움) → 2차 오퍼레이션별 파라미터/응답필드(문서 구간 슬라이스, 병렬 배치).
 */
export async function extractCatalog(input: AnalyzeInput): Promise<ExtractCatalogResult> {
  const combined = await combineInput(input);
  const warnings: string[] = [];

  // ── 1차: 오퍼레이션 목록만 ──
  const listRaw = await anthropicChatJson<{
    operations?: Array<Pick<CatalogEndpoint, "title" | "category" | "request_url" | "path" | "method" | "description">>;
    summary?: string;
  }>({
    system: "너는 API 가이드 문서에서 오퍼레이션 목록을 추출하는 전문가다. 반드시 JSON 하나만 출력한다.",
    user: `아래 API 가이드 문서에 실린 **모든 오퍼레이션(엔드포인트)의 목록**을 만든다. **JSON 하나만 출력**(설명 금지).
- 문서에 오퍼레이션이 N개면 정확히 N개(통합·생략 금지). 파라미터/응답필드는 여기서 출력하지 않는다.
- title 은 문서의 오퍼레이션명 표기를 **원문 그대로**(뒤 단계에서 문서 검색 키로 쓴다).
- request_url: 호출 URL 예시 전체. path: URL 의 경로 부분. method: GET/POST.

## 출력 스키마
{ "operations": [ { "title": "...", "category": "...", "request_url": "...", "path": "/...", "method": "GET", "description": "..." } ],
  "summary": "한국어 1문장(오퍼레이션 수 포함)" }

## 입력
ORG: ${input.name} (slug: ${input.slug})
${combined}`.trim(),
    model: "claude-sonnet-5",
    maxTokens: 8000,
    timeoutMs: 120000,
  });

  const ops = (Array.isArray(listRaw.operations) ? listRaw.operations : []).filter(
    (o) => !!o && typeof o.title === "string" && o.title.trim()
  );
  if (!ops.length) throw new Error("가이드에서 오퍼레이션을 찾지 못했습니다.");
  const allTitles = ops.map((o) => o.title);

  // 오퍼레이션이 많은 문서(입찰공고정보서비스 등 수십 개)는 전량 상세 추출이 토큰·시간 한도를
  // 넘는다 → 목록만 저장하고, 상세(파라미터/응답필드)는 사용자가 선택한 항목만 build 단계에서
  // 원문(doc_text)으로부터 추출한다.
  const DETAIL_LIMIT = 12;
  if (ops.length > DETAIL_LIMIT) {
    return {
      catalog: {
        extracted_at: new Date().toISOString(),
        source: input.fileName || input.url || (input.rawText ? "raw_text" : undefined),
        total_endpoints: ops.length,
        endpoints: ops.map((op) => ({ ...op, request_params: [], response_fields: [] })),
        doc_text: combined,
      },
      warnings,
      summary:
        (typeof listRaw.summary === "string" && listRaw.summary ? listRaw.summary + " " : "") +
        `오퍼레이션이 ${ops.length}개로 많아 목록만 추출했습니다 — 항목을 선택해 "선택 항목 분석"을 누르면 선택분의 요청변수·응답필드를 분석합니다.`,
    };
  }

  const endpoints: CatalogEndpoint[] = [];
  const BATCH = 4;
  for (let i = 0; i < ops.length; i += BATCH) {
    const batch = ops.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (op): Promise<CatalogEndpoint> => {
        const base: CatalogEndpoint = { ...op, request_params: [], response_fields: [] };
        try {
          const doc = sliceDocForOp(combined, op.title, allTitles);
          let detail = await extractOpDetail(op, doc);
          // 구간 슬라이스가 빗나가 빈 결과면 전체 문서로 1회 재시도.
          if (detail.request_params.length === 0 && detail.response_fields.length === 0 && doc !== combined) {
            detail = await extractOpDetail(op, combined);
          }
          if (detail.request_params.length === 0 && detail.response_fields.length === 0) {
            warnings.push(`"${op.title}" 요청변수/응답필드를 찾지 못함`);
          }
          return { ...base, ...detail };
        } catch (e) {
          warnings.push(`"${op.title}" 상세 추출 실패: ${e instanceof Error ? e.message : String(e)}`);
          return base;
        }
      })
    );
    endpoints.push(...results);
  }

  return {
    catalog: {
      extracted_at: new Date().toISOString(),
      source: input.fileName || input.url || (input.rawText ? "raw_text" : undefined),
      total_endpoints: endpoints.length,
      endpoints,
    },
    warnings,
    summary:
      typeof listRaw.summary === "string" && listRaw.summary
        ? listRaw.summary
        : `오퍼레이션 ${endpoints.length}개 추출`,
  };
}

/** 엔드포인트별 제안 — UI 설정 빌더의 시작점(사용자가 수정 후 저장). */
export interface EndpointProposal {
  name: string;
  api_config: ApiConfig;
  field_mapping: FieldMapping;
  /** purpose=bid 전용 — 적재 테이블 종류. 이름 휴리스틱으로 보정됨. */
  bid_type?: "order_plan" | "prior_spec" | "bid_notice";
}

/** 엔드포인트 이름/설명에서 bid 종류 추론(발주계획/사전규격/입찰공고). */
export function inferBidType(text: string): "order_plan" | "prior_spec" | "bid_notice" | null {
  if (/발주\s*계획/.test(text)) return "order_plan";
  if (/사전\s*규격/.test(text)) return "prior_spec";
  if (/입찰\s*공고|낙찰|개찰/.test(text)) return "bid_notice";
  return null;
}

export interface BuildProfileResult {
  api_profile: ApiProfile;
  endpoint_proposals: EndpointProposal[];
  warnings: string[];
  summary: string;
  /** 목록만 있던 카탈로그에 선택분 상세를 보충한 경우 — 호출측이 catalog 를 재저장한다. */
  catalog_updated?: boolean;
}

/**
 * ② 카탈로그에서 사용자가 선택한 엔드포인트만 정제해 api_profile(.endpoints[] 보존)과
 * 엔드포인트별 제안(api_config 초기값 + field_mapping)을 생성한다.
 * request_params/response_fields 는 LLM 산출을 신뢰하지 않고 카탈로그 원본을 그대로 이식한다(누락 방지).
 */
export async function buildProfileFromCatalog(input: {
  slug: string;
  name: string;
  baseUrlHint?: string;
  purpose?: ScraperPurpose;
  context?: string;
  catalog: SourceCatalog;
  /** 선택한 카탈로그 엔드포인트 title 배열. */
  selectedTitles: string[];
}): Promise<BuildProfileResult> {
  const selected = input.catalog.endpoints.filter((e) => input.selectedTitles.includes(e.title));
  if (!selected.length) throw new Error("선택된 엔드포인트가 없습니다.");
  const secretRef = secretEnvRef(input.slug);
  const isBid = input.purpose === "bid";
  const buildWarnings: string[] = [];

  // 목록만 추출된 카탈로그(대형 가이드)는 선택분의 상세(파라미터/응답필드)를 원문에서 지금 추출.
  const docText = input.catalog.doc_text;
  const needDetail = selected.filter((e) => !e.request_params?.length && !e.response_fields?.length);
  if (needDetail.length && docText) {
    const allTitles = input.catalog.endpoints.map((e) => e.title);
    const BATCH = 4;
    for (let i = 0; i < needDetail.length; i += BATCH) {
      const batch = needDetail.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async (ep) => {
          try {
            const doc = sliceDocForOp(docText, ep.title, allTitles);
            let detail = await extractOpDetail(ep, doc);
            if (!detail.request_params.length && !detail.response_fields.length && doc !== docText) {
              detail = await extractOpDetail(ep, docText);
            }
            ep.request_params = detail.request_params;
            ep.response_fields = detail.response_fields;
          } catch (e) {
            buildWarnings.push(`"${ep.title}" 상세 추출 실패: ${e instanceof Error ? e.message : String(e)}`);
          }
        })
      );
    }
  } else if (needDetail.length && !docText) {
    buildWarnings.push("카탈로그에 원문이 없어 일부 항목의 파라미터/응답필드를 보충하지 못했습니다 — 카탈로그를 다시 추출하세요.");
  }

  // 카탈로그를 텍스트화(LLM 입력) — 파라미터/필드 이름과 설명만(전량).
  const epText = selected
    .map((e, i) => {
      const params = e.request_params
        .map((p) => `  - ${p.name}${p.name_ko ? `(${p.name_ko})` : ""}${p.required ? " [필수]" : ""}${p.example ? ` 예:${p.example}` : ""} ${p.description ?? ""}`.trimEnd())
        .join("\n");
      const fields = e.response_fields.map((f) => `${f.name}${f.name_ko ? `(${f.name_ko})` : ""}`).join(", ");
      return `### [${i}] ${e.title}${e.category ? ` (${e.category})` : ""}
URL: ${e.request_url ?? "-"} / path: ${e.path ?? "-"} / method: ${e.method ?? "GET"}
요청변수(${e.request_params.length}개):
${params || "  (없음)"}
응답필드(${e.response_fields.length}개): ${fields || "(없음)"}`;
    })
    .join("\n\n");

  const fieldKeys = isBid
    ? "external_id/org_name/title/budget/posted_at/deadline/method/work_type/category/url"
    : "external_id/company_name/report_name/url/disclosed_at/summary";

  const prompt = `너는 API 카탈로그에서 선택된 엔드포인트들을 "곧바로 호출 가능한 프로파일"로 정제한다.
**JSON 하나만 출력한다**(설명 텍스트 금지).

## 규칙
1. endpoints 배열에 선택된 ${selected.length}개를 **인덱스 순서 그대로** 넣는다(통합·생략 금지).
   각 항목: { "name": 제목, "path": 실제 경로, "method": "GET", "description": 한 줄,
   "fixed_params": {항상 같은 값인 파라미터: 값}, "variable_params": [사용자 입력 파라미터명], "required_params": [필수 파라미터명] }
   ※ request_params/response_fields 는 출력하지 마라(시스템이 카탈로그 원본을 이식한다).
2. 인증: authKey/serviceKey류 → auth.type="apiKey"·param_name(공공데이터포털이면 정확히 "serviceKey"). OC류 → "param". secret_ref 는 반드시 "${secretRef}".
3. 응답형식 파라미터(_type/type/dataType)로 JSON 지원 시 default_params 에 (예 "_type":"json"). 목록 배열 경로를 response_mapping.list_path 에(공공데이터포털은 "response.body.items.item").
4. **엔드포인트별 제안(proposals)**: 각 엔드포인트에 대해
   - params: 필수·고정 파라미터의 초기값(날짜 파라미터 제외, 시크릿 제외).
   - pagination: { type, param_name, size_param, page_size, max_pages } (페이지 파라미터가 있으면).
   - date_filters: 필수 조회기간은 [{ "field": 시작필드, "relative_days": 30, "format": 문서의 날짜형식(YYYYMMDD/YYYYMM/YYYYMMDDHHmm 등) }, { "field": 종료필드, "relative_days": 0, "format": 동일 }].
   - field_mapping: 응답필드 중 표준키(${fieldKeys})에 대응하는 필드 경로. 없으면 그 키 생략.
     ★ 오퍼레이션이 특정 구분 전용(예: "용역조회")인데 응답에 그 구분 필드가 없으면 **상수 문법 "=값"** 을 쓴다(예: work_type: "=용역").
5. 시크릿 값은 절대 출력하지 말 것.

## 출력 스키마(JSON만)
{
  "api_profile": {
    "base_url": "http(s)://도메인",
    "auth": { "type": "apiKey|param|multi|none|unknown", "in": "query|header", "param_name": "serviceKey", "secret_ref": "${secretRef}" },
    "default_params": { },
    "response_mapping": { "format": "JSON|XML", "list_path": "response.body.items.item" },
    "constraints": { "ip_allowlist_required": false, "rate_limit_hint": "", "approval_required": false },
    "status": "draft",
    "endpoints": [ { "name": "...", "path": "/...", "method": "GET", "description": "...", "fixed_params": {}, "variable_params": [], "required_params": [] } ]
  },
  "proposals": [ { "name": "...", "params": {}, "pagination": null, "date_filters": [], "field_mapping": {} } ],
  "warnings": [],
  "summary": "한국어 1~2문장"
}

## 입력
ORG: ${input.name} (slug: ${input.slug})${input.baseUrlHint ? `\nBASE_URL_HINT: ${input.baseUrlHint}` : ""}${input.context ? `\nUSER_CONTEXT: ${input.context}` : ""}

## 선택된 엔드포인트 카탈로그
${epText}`.trim();

  const raw = await anthropicChatJson<{
    api_profile?: ApiProfile;
    proposals?: Array<{
      name?: string;
      params?: Record<string, unknown>;
      pagination?: ApiConfig["pagination"] | null;
      date_filters?: ApiConfig["date_filters"];
      field_mapping?: Record<string, unknown>;
    }>;
    warnings?: unknown[];
    summary?: string;
  }>({
    system: "너는 API 카탈로그를 실행 가능한 프로파일로 정제하는 전문가다. 반드시 JSON 하나만 출력한다.",
    user: prompt,
    model: "claude-sonnet-5",
    maxTokens: 16000,
    timeoutMs: 120000,
  });

  const profile: ApiProfile = raw.api_profile ?? {};
  if (!profile.base_url && input.baseUrlHint) profile.base_url = input.baseUrlHint;
  if (profile.auth && (profile.auth.type ?? "none") !== "none") {
    profile.auth.secret_ref = secretEnvRef(input.slug);
    if (!profile.auth.in) profile.auth.in = "query";
  }
  if (!profile.status) profile.status = "draft";

  // endpoints 정합화 + 카탈로그 원본(request_params/response_fields) 이식 — LLM 누락 방지.
  const llmEndpoints = Array.isArray(profile.endpoints) ? profile.endpoints : [];
  profile.endpoints = selected.map((cat, i) => {
    const llm = (llmEndpoints[i] ?? {}) as ProfileEndpoint;
    return {
      name: llm.name || cat.title,
      path: llm.path || cat.path || "",
      method: llm.method || cat.method || "GET",
      description: llm.description ?? cat.description,
      fixed_params: llm.fixed_params ?? {},
      variable_params: Array.isArray(llm.variable_params) ? llm.variable_params : [],
      required_params: Array.isArray(llm.required_params)
        ? llm.required_params
        : cat.request_params.filter((p) => p.required).map((p) => p.name),
      request_params: cat.request_params,
      response_fields: cat.response_fields,
    };
  });

  const rawProposals = Array.isArray(raw.proposals) ? raw.proposals : [];
  const endpoint_proposals: EndpointProposal[] = profile.endpoints.map((ep, i) => {
    const p = rawProposals[i] ?? {};
    const cfg: ApiConfig = {
      primary_endpoint: { name: ep.name, path: ep.path, method: ep.method || "GET" },
      params: asStringRecord(p.params),
    };
    if (p.pagination && p.pagination.type && p.pagination.type !== "none") cfg.pagination = p.pagination;
    if (Array.isArray(p.date_filters) && p.date_filters.length) cfg.date_filters = p.date_filters;
    const proposal: EndpointProposal = { name: ep.name, api_config: cfg, field_mapping: asStringRecord(p.field_mapping) };
    // bid 소스는 엔드포인트 이름으로 적재 테이블 종류를 판별(발주계획/사전규격/입찰공고).
    if (input.purpose === "bid") {
      proposal.bid_type = inferBidType(`${ep.name} ${ep.description ?? ""}`) ?? undefined;
    }
    return proposal;
  });

  return {
    api_profile: profile,
    endpoint_proposals,
    warnings: [...buildWarnings, ...(Array.isArray(raw.warnings) ? raw.warnings.map(String) : [])],
    summary: typeof raw.summary === "string" ? raw.summary : "",
    ...(needDetail.length && docText ? { catalog_updated: true } : {}),
  };
}
