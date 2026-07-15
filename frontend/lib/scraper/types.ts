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
  /** 페이지 번호/오프셋 파라미터명(예: pageNo). */
  param_name: string;
  /** 페이지당 건수 파라미터명(예: numOfRows). 지정 시 요청에 page_size 값이 함께 나간다. */
  size_param?: string;
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

/** bid sink 어댑터 옵션 — 대상 테이블(종류)을 결정한다. */
export type BidType = "order_plan" | "prior_spec" | "bid_notice";
export interface BidSinkConfig {
  bid_type?: BidType; // 기본 bid_notice
}

/**
 * bid sink 표준 field_mapping 키(참고): external_id / org_name(발주기관) / title(사업명) /
 * budget(예산·예정가격) / posted_at(게시일) / deadline(입찰마감) / method(조달방식) /
 * work_type(업무구분) / category(분류) / url(원문링크). FieldMapping(Record<string,string>) 재사용.
 */

/** DB row: scraper_sources */
export interface ScraperSourceRow {
  sourceId: string;
  slug: string;
  name: string;
  baseUrl: string | null;
  purpose: ScraperPurpose;
  apiProfile: ApiProfile | null;
  enabled: boolean;
  /** 인증키가 DB에 저장돼 있는지(값은 응답에 포함하지 않음 — 실행 시에만 복호화). */
  hasSecret: boolean;
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
