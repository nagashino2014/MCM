/**
 * 범용 API 스크래퍼 프레임워크 공용 타입 (EcoMonitor 이식).
 * sink 무관 — 소스/엔드포인트/프로파일 정의와 실행 결과 계약만 담는다.
 * 적재(intel_signals 등)는 sink 어댑터가 field_mapping으로 소비한다.
 */

/** 소스 적재 대상 구분. 'intel'=인텔 파이프라인, 'bid'=공공입찰(2차). */
export type ScraperPurpose = "intel" | "bid";

export interface DateFilter {
  field: string;
  start_date?: string;
  end_date?: string;
  /** YYYYMMDD | YYYY-MM-DD | YYYY/MM/DD | YYYY.MM.DD */
  format?: string;
  relative_days?: number;
}

export interface SearchFilter {
  field: string;
  keywords: string[];
  match_type: "contains" | "exact" | "regex" | "any";
}

export interface ApiPagination {
  /** 'page' | 'offset' | 'none' */
  type: string;
  param_name: string;
  page_size: number;
  max_pages: number;
}

export interface ApiConfig {
  primary_endpoint: { name?: string; path: string; method?: string };
  params: Record<string, string>;
  pagination?: ApiPagination;
  /** 지정 시 이 필드만 남긴다(선택). field_mapping과 별개의 원본 슬림화 옵션. */
  response_fields?: string[];
  search_filters?: SearchFilter[];
  date_filters?: DateFilter[];
}

export interface ApiAuth {
  /** 'param' | 'apiKey' | 'multi' | 'none' | 'unknown' */
  type: string;
  /** 'query' | 'header' */
  in?: string;
  param_name?: string;
  name?: string;
  /** "ENV:SCRAPER_<SLUG>_KEY" — 실행 시 process.env에서 로드 */
  secret_ref?: string;
}

export interface ApiProfile {
  base_url?: string;
  auth?: ApiAuth;
  default_params?: Record<string, string>;
  endpoints?: unknown[];
  response_mapping?: { format?: string; list_path?: string; total_path?: string };
  constraints?: Record<string, unknown>;
  /** 'draft' | 'ready' */
  status?: string;
}

/**
 * 응답 item → 표준 필드 경로 매핑. 값은 getNestedValue 경로 문자열.
 * intel sink 표준 키: external_id / company_name / report_name / url / disclosed_at / summary.
 * (purpose별로 필드셋이 다르므로 Record로 유연하게 둔다.)
 */
export type FieldMapping = Record<string, string>;

/** intel sink 어댑터 옵션(엔드포인트 sink_config). */
export interface IntelSinkConfig {
  signal_type?: string; // investment/expansion/new_site/other
  signal_grade?: string; // 기본 monitoring
  use_llm_classify?: boolean; // 2차
}

/** DB row: scraper_sources */
export interface ScraperSourceRow {
  sourceId: string;
  slug: string;
  name: string;
  baseUrl: string | null;
  purpose: ScraperPurpose;
  apiProfile: ApiProfile | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

/** DB row: scraper_endpoints */
export interface ScraperEndpointRow {
  endpointId: string;
  sourceId: string;
  name: string;
  apiConfig: ApiConfig | null;
  fieldMapping: FieldMapping;
  sinkConfig: IntelSinkConfig | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** runApiCollect 결과 — sink 무관 원시 item 목록. */
export interface RunApiResult {
  items: Record<string, unknown>[];
  logs: string[];
  error?: string;
}
