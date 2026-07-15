/**
 * API Profile 자동생성 (EcoMonitor analyze 이식, 도메인 중립).
 * URL(가이드/명세) 또는 원문 텍스트를 LLM에 넣어 api_profile + api_config + field_mapping 을 생성한다.
 * 국가법령정보센터 등 특정 사이트 하드코딩 분기는 제거하고, intel sink 표준필드 매핑 산출을 추가했다.
 * 결과는 DB에 저장하지 않고 proposal로 반환한다(사용자 확인 후 소스/엔드포인트에 커밋).
 */
import { anthropicChatJson } from "@/lib/ai/llm-json";
import type { ApiConfig, ApiProfile, FieldMapping } from "./types";

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
  return `너는 임의의 공개 REST/OPEN API 명세(가이드 문서/응답 예시)를 분석해, 그 API를 곧바로 호출·수집할 수 있는
프로파일을 생성한다. **JSON 하나만 출력한다**(설명 텍스트 금지).

## 분석 규칙
1. **엔드포인트 경로**: 실제 호출 URL 예시에서 path 추출(예 "https://api.data.go.kr/1230000/ao/PubDataOpnStdService" → path). 추상 경로를 지어내지 말 것. 못 찾으면 warnings에 "endpoint_path_uncertain".
2. **인증 자동감지**: authKey/serviceKey/ServiceKey/apiKey/인증키 → auth.type="apiKey", param_name=해당명. OC/사용자ID만 → type="param". 둘 다 → "multi". 인증 없음 → "none". 불명 → "unknown"+warnings "auth_method_uncertain". **secret_ref 는 반드시 "${secretRef}" 로 지정**.
3. **파라미터**: 필수/고정값(항상 같은 값)은 default_params 와 api_config.params 에, 가변값은 variable_params 에. 시크릿(인증키) 값은 절대 넣지 말고 auth.secret_ref 로만.
4. **응답형식**: JSON/XML 감지. response_mapping.format 에 "JSON" 또는 "XML". **XML 이면 warnings 에 "xml_unsupported_mvp"** (현재 JSON 만 지원).
5. **응답 배열 경로**: 목록이 담긴 키(data/items/results/response.body.items 등)를 response_mapping.list_path 에.
6. **페이지네이션**: 페이지/오프셋 파라미터명과 페이지 크기를 api_config.pagination 에(type "page"|"offset"|"none").
7. **★ field_mapping (가장 중요)**: 응답 배열의 item 1건 기준으로, 아래 표준필드에 대응하는 필드 경로(점 표기)를 채운다. 이 API가 "회사/기업의 투자·설비 신호"를 다룬다는 전제로 가장 적합한 필드를 고른다. 없으면 생략(빈 문자열 금지).
   - external_id: 각 item의 고유 식별자(공고번호/일련번호/id 등). 없으면 생략(URL 해시로 폴백됨).
   - company_name: 회사/기관/사업주체명.
   - report_name: 제목/사업명/공고명.
   - url: 원문 상세 링크.
   - disclosed_at: 공시/등록/게시 일자.
   - summary: 요약/내용(선택).

## 출력 스키마(JSON만)
{
  "api_profile": {
    "base_url": "http(s)://도메인",
    "auth": { "type": "apiKey|param|multi|none|unknown", "in": "query|header", "param_name": "ServiceKey 등", "secret_ref": "${secretRef}" },
    "default_params": { "고정키": "값" },
    "response_mapping": { "format": "JSON|XML", "list_path": "response.body.items" },
    "constraints": { "ip_allowlist_required": false, "rate_limit_hint": "", "approval_required": false },
    "status": "draft"
  },
  "api_config": {
    "primary_endpoint": { "name": "엔드포인트명", "path": "/실제/경로", "method": "GET" },
    "params": { "가변·고정 기본 파라미터": "값" },
    "pagination": { "type": "page|offset|none", "param_name": "pageNo", "page_size": 100, "max_pages": 3 }
  },
  "field_mapping": { "external_id": "...", "company_name": "...", "report_name": "...", "url": "...", "disclosed_at": "...", "summary": "..." },
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
