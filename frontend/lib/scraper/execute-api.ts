/**
 * 범용 API 실행 코어 (EcoMonitor instant/api 이식, sink 무관).
 * api_profile + api_config로 URL을 조립해 fetch하고, 페이지네이션·필터·배열 추출을 거쳐
 * 표준화되지 않은 원시 item 목록을 반환한다. 적재(intel_signals 등)는 호출자(sink 어댑터)가 담당.
 * 파일/xlsx export, 국가법령정보센터 특수 분기 등 도메인 로직은 이식하지 않는다.
 */
import type { ApiConfig, ApiProfile, DateFilter, RunApiResult, SearchFilter } from "./types";

const USER_AGENT = "MCM-ScraperBot/1.0 (+intel)";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const FETCH_TIMEOUT_MS = 60000;
const FETCH_RETRY_DELAYS_MS = [3000, 10000]; // 네트워크·타임아웃 오류 시 백오프 재시도(2회)

/**
 * 네트워크/타임아웃 오류에 한해 백오프 재시도하는 fetch.
 * ⚠ 공공데이터포털(나라장터)은 새벽 점검 시간대에 응답 없이 무한 대기하는 사례 실측 —
 * 일시 장애를 흡수하되, HTTP 응답(4xx/5xx)은 재시도하지 않고 그대로 돌려준다(호출측이 판정).
 */
async function fetchWithRetry(
  url: string,
  init: { method: string; headers: Record<string, string> },
  logs: string[]
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      lastErr = err;
      const wait = FETCH_RETRY_DELAYS_MS[attempt];
      if (wait == null) break;
      logs.push(`[API] 요청 실패(${err instanceof Error ? err.message : String(err)}) — ${wait / 1000}초 후 재시도 ${attempt + 1}/${FETCH_RETRY_DELAYS_MS.length}`);
      await delay(wait);
    }
  }
  throw lastErr;
}

/** 환경변수 시크릿 참조("ENV:KEY") → process.env 값. */
export function getEnvSecret(ref?: string): string | null {
  if (!ref || !ref.startsWith("ENV:")) return null;
  const key = ref.slice("ENV:".length);
  return key ? process.env[key] ?? null : null;
}

/** 점(.) 경로로 중첩 값 접근. 직접 키 우선. */
export function getNestedValue(obj: unknown, path: string): unknown {
  if (obj == null) return undefined;
  const rec = obj as Record<string, unknown>;
  if (rec[path] !== undefined) return rec[path];
  let current: unknown = obj;
  for (const part of path.split(".")) {
    if (current == null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * format 토큰(YYYY/MM/DD/HH/mm/ss) 치환 — YYYYMM·YYYYMMDDHHmm 등 임의 조합 지원.
 * (기존 switch 방식은 미지원 포맷을 YYYY-MM-DD로 폴백해 나라장터 필수값 오류(08)를 유발했다.)
 * endOfDay=true(종료일)면 시각 성분을 23:59:59로 채운다. (백필 청크 생성에서도 재사용)
 */
export function formatDateForApi(date: Date, format?: string, endOfDay = false): string {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  if (!format) return `${y}-${m}-${d}`;
  return (
    format
      .replace("YYYY", y)
      .replace("MM", m)
      .replace("DD", d)
      .replace("HH", endOfDay ? "23" : "00")
      .replace("mm", endOfDay ? "59" : "00")
      .replace("ss", endOfDay ? "59" : "00")
      // "YYYYMMDDHHMM"처럼 분을 대문자로 쓰는 표기 — 월 치환 후 남은 MM/SS 는 분/초.
      .replace("MM", endOfDay ? "59" : "00")
      .replace("SS", endOfDay ? "59" : "00")
  );
}

/** 날짜 필터 필드가 기간의 시작인지 종료인지 — 이름에 start/from 이 있으면 시작, end/to 면 종료, 그 밖은 시작. */
function dateFieldRole(field: string): "start" | "end" {
  const f = field.toLowerCase();
  if (f.includes("start") || f.includes("from")) return "start";
  if (f.includes("end") || f.includes("to")) return "end";
  return "start";
}

function applyDateFilters(
  params: Record<string, string>,
  dateFilters?: DateFilter[]
): Record<string, string> {
  if (!dateFilters?.length) return params;
  const result = { ...params };
  const today = new Date();
  for (const df of dateFilters) {
    if (!df.field) continue;
    let startDate = df.start_date;
    let endDate = df.end_date;
    if (df.relative_days != null && df.relative_days >= 0) {
      const past = new Date(today);
      past.setDate(past.getDate() - df.relative_days);
      startDate = formatDateForApi(past, df.format);
      endDate = formatDateForApi(today, df.format, true);
    }
    if (dateFieldRole(df.field) === "end") {
      if (endDate) result[df.field] = endDate;
    } else if (startDate) {
      result[df.field] = startDate;
    }
  }
  return result;
}

/** 조회 기간(양끝 날짜 포함). 시각 성분은 버린다 — 나라장터는 시작일과 종료일의 날짜 차이로 범위를 판정한다. */
interface DateWindow {
  start: Date;
  end: Date;
}

const DAY_MS = 86400 * 1000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** formatDateForApi 로 만든 문자열을 날짜로 되돌린다. 일(DD)이 없는 형식(YYYYMM 등)은 null. */
function parseApiDate(value: string | undefined, format?: string): Date | null {
  if (!value) return null;
  const fmt = format || "YYYY-MM-DD";
  const yi = fmt.indexOf("YYYY");
  const mi = fmt.indexOf("MM"); // 첫 MM 이 월(formatDateForApi 와 같은 순서)
  const di = fmt.indexOf("DD");
  if (yi < 0 || mi < 0 || di < 0) return null;
  const y = Number(value.slice(yi, yi + 4));
  const m = Number(value.slice(mi, mi + 2));
  const d = Number(value.slice(di, di + 2));
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return new Date(y, m - 1, d);
}

/**
 * date_filters 가 실제로 요청하는 조회 기간을 날짜로 푼다(applyDateFilters 와 같은 규칙).
 * 시작·종료 필드가 모두 있고 둘 다 일 단위로 풀릴 때만 돌려준다 — 그 밖에는 기간을 나눌 수 없다.
 */
function resolveDateWindow(dateFilters?: DateFilter[]): DateWindow | null {
  if (!dateFilters?.length) return null;
  const today = startOfDay(new Date());
  let start: Date | null = null;
  let end: Date | null = null;
  for (const df of dateFilters) {
    if (!df.field) continue;
    if (!(df.format || "YYYY-MM-DD").includes("DD")) return null; // 월 단위 조회는 일 단위로 못 나눈다
    const relative = df.relative_days != null && df.relative_days >= 0;
    if (dateFieldRole(df.field) === "end") {
      const d = relative ? today : parseApiDate(df.end_date, df.format);
      if (!d) return null;
      if (!end || d > end) end = d;
    } else {
      const d = relative ? addDays(today, -df.relative_days!) : parseApiDate(df.start_date, df.format);
      if (!d) return null;
      if (!start || d < start) start = d;
    }
  }
  if (!start || !end || start > end) return null;
  return { start, end };
}

/** 조회 기간을 고정값으로 박은 설정 복제본(백필 청크와 같은 모양 — 시작·종료 필드 양쪽에 값을 둔다). */
function withDateWindow(apiConfig: ApiConfig, win: DateWindow): ApiConfig {
  return {
    ...apiConfig,
    date_filters: (apiConfig.date_filters ?? []).map((df) => ({
      field: df.field,
      format: df.format,
      start_date: formatDateForApi(win.start, df.format),
      end_date: formatDateForApi(win.end, df.format, true),
    })),
  };
}

interface ApiError {
  code: string;
  message: string;
  /** 포털 게이트웨이 오류(인증키·요청 한도) — 서비스 resultCode 와 번호 체계가 달라 조회 기간 분할 판정에 쓰지 않는다. */
  gateway?: boolean;
}

/** XML 본문에서 태그 하나의 값을 꺼낸다(게이트웨이 오류 본문 전용 — 일반 XML 파싱은 하지 않는다). */
function xmlTagValue(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${tag}>`));
  return m ? m[1].trim() : "";
}

function gatewayError(errMsg: unknown, authMsg: unknown, reasonCode: unknown): ApiError {
  const parts = [errMsg, authMsg].map((v) => (v == null ? "" : String(v).trim())).filter(Boolean);
  return {
    code: reasonCode == null ? "" : String(reasonCode).trim(),
    message: parts.join(" — ") || "OpenAPI_ServiceResponse",
    gateway: true,
  };
}

/**
 * 공공데이터포털 게이트웨이 오류(OpenAPI_ServiceResponse) 판정 — 인증키 미등록·접근 거부·요청 한도 초과 등.
 * 2026-11-19 실측: 키 오류는 HTTP 401/403 에 JSON 본문
 * {"OpenAPI_ServiceResponse": {"cmmMsgHeader": {errMsg, returnAuthMsg, returnReasonCode}}} 로 온다.
 * 같은 본문이 HTTP 200 으로 오면 JSON 은 오류 객체가 item 1건으로, XML(옛 형식)은 0건 성공으로 지나간다.
 */
function detectGatewayError(rec: Record<string, unknown>): ApiError | null {
  const wrapper = rec.OpenAPI_ServiceResponse;
  if (wrapper && typeof wrapper === "object") {
    const header = ((wrapper as Record<string, unknown>).cmmMsgHeader ?? {}) as Record<string, unknown>;
    return gatewayError(header.errMsg, header.returnAuthMsg, header.returnReasonCode);
  }
  const raw = typeof rec.raw_xml === "string" ? rec.raw_xml : typeof rec.raw_text === "string" ? rec.raw_text : "";
  if (raw.includes("<OpenAPI_ServiceResponse")) {
    return gatewayError(
      xmlTagValue(raw, "errMsg"),
      xmlTagValue(raw, "returnAuthMsg"),
      xmlTagValue(raw, "returnReasonCode")
    );
  }
  return null;
}

/**
 * 공공데이터포털(나라장터) 오류 응답 판정 — 게이트웨이 오류와 서비스 오류.
 * 서비스 오류도 HTTP 200 에 {"nkoneps.com.response.ResponseError": {header: {resultCode, resultMsg}}} 로 온다.
 * 판정 없이 넘기면 배열 추출이 오류 객체를 item 1건으로 오인해 "수집 1건 성공"으로 기록된다
 * (2026-11 입찰공고 조회 기간 제한 때 9일간 수집 중단을 아무도 몰랐던 원인).
 */
function detectApiError(data: unknown): ApiError | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const gateway = detectGatewayError(data as Record<string, unknown>);
  if (gateway) return gateway;
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (!key.endsWith("ResponseError")) continue;
    const header = (value as { header?: { resultCode?: unknown; resultMsg?: unknown } } | null)?.header;
    return {
      code: header?.resultCode != null ? String(header.resultCode) : "",
      message: header?.resultMsg != null ? String(header.resultMsg) : key,
    };
  }
  return null;
}

/** 나라장터 "입력범위값 초과 에러" — 조회 기간이 서비스 한도를 넘었을 때(입찰공고는 달력 7일). */
const RANGE_EXCEEDED_CODE = "07";

/** HTTP 오류 응답 본문에서 포털 오류 사유를 읽는다 — 없거나 읽지 못하면 null(상태 문구만 남긴다). */
async function readErrorReason(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw_text: text };
    }
    const apiError = detectApiError(body);
    if (!apiError) return null;
    return `${apiError.message}${apiError.code ? ` (${apiError.code})` : ""}`;
  } catch {
    return null;
  }
}

function applySearchFilters(
  data: Record<string, unknown>[],
  searchFilters?: SearchFilter[]
): Record<string, unknown>[] {
  if (!searchFilters?.length) return data;
  return data.filter((item) => {
    for (const filter of searchFilters) {
      const value = getNestedValue(item, filter.field);
      if (value === undefined || value === null) continue; // 선택적 필터
      const strValue = String(value);
      let matches = false;
      switch (filter.match_type) {
        case "exact":
          matches = filter.keywords.some((k) => strValue === k);
          break;
        case "regex":
          matches = filter.keywords.some((k) => {
            try {
              return new RegExp(k, "i").test(strValue);
            } catch {
              return false;
            }
          });
          break;
        default: // contains | any
          matches = filter.keywords.some((k) => strValue.toLowerCase().includes(k.toLowerCase()));
          break;
      }
      if (!matches) return false;
    }
    return true;
  });
}

function filterResponseFields(
  data: Record<string, unknown>[],
  responseFields?: string[]
): Record<string, unknown>[] {
  if (!responseFields?.length) return data;
  return data.map((item) => {
    const filtered: Record<string, unknown> = {};
    for (const field of responseFields) {
      const value = item[field] !== undefined ? item[field] : getNestedValue(item, field);
      if (value !== undefined) filtered[field] = value;
    }
    return filtered;
  });
}

/**
 * 어떤 값을 item 배열로 강제한다.
 * - 배열이면 그대로.
 * - 공공데이터포털식 래퍼({ item: [...] } / { item: {...} } 등 단일 건은 객체)면 그 내부 배열/객체.
 * - 그 밖의 단일 객체면 [obj].
 * - null/빈문자열(totalCount=0 시 items="")이면 null(→ 빈 페이지 판정).
 */
function coerceItemArray(v: unknown): Record<string, unknown>[] | null {
  if (v == null || v === "") return null;
  if (Array.isArray(v)) return v as Record<string, unknown>[];
  if (typeof v === "object") {
    const rec = v as Record<string, unknown>;
    // 공공데이터포털: items 래퍼 안에 item(배열이면 다건, 객체면 1건)
    const inner = rec.item ?? rec.items ?? rec.list ?? rec.row;
    if (Array.isArray(inner)) return inner as Record<string, unknown>[];
    if (inner && typeof inner === "object") return [inner as Record<string, unknown>];
    return [rec];
  }
  return null;
}

/**
 * JSON 응답에서 데이터 배열 추출. api_profile.response_mapping.list_path 우선,
 * 없으면 response/body 래퍼를 벗겨 일반 경로 자동탐지. XML은 [{raw_xml}]로 감싸 반환(어댑터가 skip).
 */
function extractDataFromResponse(
  response: unknown,
  logs: string[],
  listPath?: string
): Record<string, unknown>[] {
  if (response && typeof response === "object") {
    if (Array.isArray(response)) {
      logs.push(`[EXTRACT] 배열 응답: ${response.length}건`);
      return response as Record<string, unknown>[];
    }
    const rec = response as Record<string, unknown>;
    if ((rec.raw_xml || rec.raw_text) && Object.keys(rec).length <= 2) {
      return [rec];
    }
    // 1) 명세에서 뽑은 list_path 우선(예 "response.body.items" 또는 "response.body.items.item")
    if (listPath) {
      const raw = getNestedValue(rec, listPath);
      const arr = coerceItemArray(raw);
      if (arr) {
        logs.push(`[EXTRACT] list_path(${listPath}): ${arr.length}건`);
        return arr;
      }
      // 경로는 존재하나 빈 값(""/null, totalCount=0)이면 0건 — 자동탐지 폴백 금지(전체 객체 오인 방지)
      if (raw !== undefined) {
        logs.push(`[EXTRACT] list_path(${listPath}) 빈 결과 — 0건`);
        return [];
      }
      logs.push(`[EXTRACT] list_path(${listPath}) 미해결 — 자동탐지로 폴백`);
    }
    // 2) 자동탐지 — response/body 래퍼도 벗겨서 탐색(공공데이터포털 표준 응답 구조)
    const commonPaths = ["data", "items", "results", "records", "list", "rows", "content", "목록", "결과", "item"];
    const roots: Record<string, unknown>[] = [rec];
    const resp = rec.response;
    if (resp && typeof resp === "object") {
      roots.push(resp as Record<string, unknown>);
      const body = (resp as Record<string, unknown>).body;
      if (body && typeof body === "object") roots.push(body as Record<string, unknown>);
    }
    for (const root of roots) {
      for (const key of commonPaths) {
        const v = root[key];
        if (v == null) continue;
        // 배열 직결, 또는 items/item 래퍼일 때만 내부 배열 추출(임의 객체를 1건으로 오인 방지)
        if (Array.isArray(v) || key === "items" || key === "item") {
          const arr = coerceItemArray(v);
          if (arr) {
            logs.push(`[EXTRACT] ${key} 경로: ${arr.length}건`);
            return arr;
          }
        }
      }
    }
    logs.push(`[EXTRACT] 배열 경로 미탐지 — 전체를 단일 항목으로`);
    return [rec];
  }
  if (typeof response === "string" && response.trim().startsWith("<")) {
    logs.push(`[EXTRACT] XML 텍스트 응답(MVP 미지원)`);
    return [{ raw_xml: response }];
  }
  return [];
}

async function executeApiCall(
  apiProfile: ApiProfile,
  apiConfig: ApiConfig,
  pageParams: Record<string, string>,
  logs: string[],
  resolvedSecret: string | null
): Promise<{ data: unknown; error?: string; errorCode?: string }> {
  const baseUrl = apiProfile.base_url;
  if (!baseUrl) return { data: null, error: "base_url이 설정되지 않았습니다." };
  const endpoint = apiConfig.primary_endpoint;
  if (!endpoint?.path) return { data: null, error: "endpoint path가 설정되지 않았습니다." };

  try {
    const url = new URL(endpoint.path, baseUrl);
    let params = { ...(apiProfile.default_params ?? {}), ...apiConfig.params };
    params = applyDateFilters(params, apiConfig.date_filters);
    params = { ...params, ...pageParams };
    // 공공데이터포털(serviceKey / data.go.kr) 계열은 미지정 시 기본 XML → JSON 강제(MVP는 JSON만 파싱).
    const authName0 = (apiProfile.auth?.param_name || apiProfile.auth?.name || "").toLowerCase();
    const isDataGoKr = /data\.go\.kr/i.test(baseUrl) || authName0 === "servicekey";
    if (isDataGoKr && !("_type" in params) && !("type" in params) && !("dataType" in params)) {
      params._type = "json";
      logs.push(`[API] 공공데이터포털 감지 — _type=json 자동 주입`);
    }
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: "application/json, application/xml, text/xml, */*",
    };
    if (apiProfile.auth) {
      const auth = apiProfile.auth;
      const authIn = (auth.in || "query").toLowerCase();
      const authName = auth.param_name || auth.name || "";
      // DB에 저장된 키(resolvedSecret) 우선, 없으면 ENV 폴백(하위호환).
      const secret = resolvedSecret ?? getEnvSecret(auth.secret_ref);
      if (secret && authName) {
        if (authIn === "header") headers[authName] = secret;
        else url.searchParams.set(authName, secret);
        logs.push(`[AUTH] 인증 파라미터 "${authName}" 적용됨`);
      } else if (auth.secret_ref && authName) {
        logs.push(`[AUTH] 시크릿(${auth.secret_ref}) 부재 — 인증 없이 호출`);
      }
    }

    logs.push(`[API] ${endpoint.method || "GET"} ${url.toString()}`);
    const response = await fetchWithRetry(url.toString(), { method: endpoint.method || "GET", headers }, logs);
    if (!response.ok) {
      // 포털은 인증키·한도 오류를 4xx 에 본문으로 알려 준다 — "HTTP 403" 만으로는 원인을 알 수 없다.
      const reason = await readErrorReason(response);
      return { data: null, error: `HTTP ${response.status}: ${reason ?? response.statusText}` };
    }

    const contentType = response.headers.get("content-type") || "";
    let data: unknown;
    if (contentType.includes("application/json")) {
      data = await response.json();
    } else if (contentType.includes("xml")) {
      data = { raw_xml: await response.text(), content_type: contentType };
    } else {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw_text: text, content_type: contentType };
      }
    }
    const apiError = detectApiError(data);
    if (apiError) {
      return {
        data: null,
        error: `API 오류${apiError.code ? ` ${apiError.code}` : ""}: ${apiError.message}`,
        errorCode: apiError.gateway ? undefined : apiError.code,
      };
    }
    return { data };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 페이지 수집 진행 보고 콜백 — 백필 진행률 바(폴링)용. 실패는 무시(수집을 막지 않는다). */
export type FetchProgressFn = (p: { page: number; items: number }) => void;

interface PageRun {
  items: Record<string, unknown>[];
  error?: string;
  /** 첫 페이지가 API 오류 응답이었을 때의 resultCode. */
  errorCode?: string;
}

/** 페이지네이션 루프 1회분 — primary_endpoint 를 max_pages 까지 수집. */
async function collectPages(
  apiProfile: ApiProfile,
  apiConfig: ApiConfig,
  logs: string[],
  secret: string | null,
  onProgress?: FetchProgressFn
): Promise<PageRun> {
  const allData: Record<string, unknown>[] = [];
  const pagination = apiConfig.pagination;
  const paging = !!pagination && pagination.type !== "none";
  const maxPages = paging ? Math.min(pagination!.max_pages || 1, 200) : 1; // 무한루프 방어 상한
  const pageSize = pagination?.page_size || 10;
  const pageParam = pagination?.param_name || "page";
  const listPath = apiProfile.response_mapping?.list_path;

  for (let page = 1; page <= maxPages; page++) {
    const pageParams: Record<string, string> = {};
    if (paging) {
      if (pagination!.type === "offset") pageParams[pageParam] = String((page - 1) * pageSize);
      else pageParams[pageParam] = String(page);
    }
    // 페이지당 건수 파라미터(예: numOfRows)는 페이지네이션이 없어도 전달(기본 소량 조회 방지).
    if (pagination?.size_param) pageParams[pagination.size_param] = String(pageSize);
    const result = await executeApiCall(apiProfile, apiConfig, pageParams, logs, secret);
    if (result.error) {
      logs.push(`[ERROR] ${result.error}`);
      if (page === 1) return { items: [], error: result.error, errorCode: result.errorCode };
      break;
    }
    const items = extractDataFromResponse(result.data, logs, listPath);
    if (items.length === 0) {
      logs.push("[INFO] 빈 페이지 — 페이지네이션 종료");
      break;
    }
    allData.push(...items);
    try {
      onProgress?.({ page, items: allData.length });
    } catch {
      // 진행 보고 실패는 수집에 영향 없음
    }
    if (page < maxPages) await delay(300);
  }
  return { items: allData };
}

const ymd = (d: Date): string => formatDateForApi(d, "YYYY-MM-DD");

/**
 * collectPages + 조회 기간 한도 대응.
 * 첫 페이지가 "입력범위값 초과(07)"면 조회 기간을 날짜 단위로 반씩 나눠 다시 조회한다(하루까지).
 * 한도를 설정에 박지 않는 이유: 서비스마다 다르고(입찰공고 7일·사전규격 1개월 이상) 예고 없이 바뀐다.
 * 나눈 구간 중 일부만 실패하면 모은 건은 돌려주되 error 를 함께 실어 구멍이 났음을 알린다.
 */
async function collectPagesWithinRange(
  apiProfile: ApiProfile,
  apiConfig: ApiConfig,
  logs: string[],
  secret: string | null,
  onProgress?: FetchProgressFn
): Promise<PageRun> {
  const run = await collectPages(apiProfile, apiConfig, logs, secret, onProgress);
  if (run.errorCode !== RANGE_EXCEEDED_CODE) return run;
  const win = resolveDateWindow(apiConfig.date_filters);
  if (!win) return run;
  const days = Math.round((win.end.getTime() - win.start.getTime()) / DAY_MS) + 1;
  if (days < 2) return run;

  const half = Math.floor(days / 2);
  const windows: DateWindow[] = [
    { start: win.start, end: addDays(win.start, half - 1) },
    { start: addDays(win.start, half), end: win.end },
  ];
  logs.push(
    `[RANGE] 조회 기간 한도 초과(${days}일) — ${windows.map((w) => `${ymd(w.start)}~${ymd(w.end)}`).join(" / ")} 로 나눠 조회`
  );

  const items: Record<string, unknown>[] = [];
  const errors: string[] = [];
  for (const w of windows) {
    const base = items.length;
    const part = await collectPagesWithinRange(
      apiProfile,
      withDateWindow(apiConfig, w),
      logs,
      secret,
      onProgress ? (p) => onProgress({ page: p.page, items: base + p.items }) : undefined
    );
    items.push(...part.items);
    if (part.error) errors.push(`${ymd(w.start)}~${ymd(w.end)} ${part.error}`);
  }
  return errors.length ? { items, error: errors.join("; ") } : { items };
}

/**
 * 등록된 api_profile + api_config로 수집을 실행해 원시 item 목록을 반환한다.
 * 페이지네이션(page/offset), max_pages 상한, 빈 페이지 조기 종료, 검색/필드 필터 적용.
 * two_phase.enabled 면 목록 API(secondary_endpoints[0])로 키를 뽑아 본문(primary)을 반복 조회한다.
 */
export async function runApiCollect(
  apiProfile: ApiProfile,
  apiConfig: ApiConfig,
  opts: { secret?: string | null; onProgress?: FetchProgressFn } = {}
): Promise<RunApiResult> {
  const logs: string[] = [];
  let allData: Record<string, unknown>[] = [];
  // 일부 구간만 실패한 수집 — 모은 건은 돌려주되 호출자가 실패를 기록할 수 있게 error 를 함께 싣는다.
  let partialError: string | undefined;
  const secret = opts.secret ?? null;
  try {
    if (!apiConfig?.primary_endpoint?.path) {
      return { items: [], logs, error: "api_config.primary_endpoint 가 없습니다." };
    }

    const twoPhase = apiConfig.two_phase;
    const listEp = apiConfig.secondary_endpoints?.[0];
    if (twoPhase?.enabled && listEp?.path && twoPhase.field_mappings?.length) {
      // ── 2단계 호출: 목록 → 키 추출 → 본문 반복 ──
      const listCfg: ApiConfig = {
        primary_endpoint: { name: listEp.name, path: listEp.path, method: listEp.method },
        params: listEp.params ?? {},
        pagination: apiConfig.pagination, // 페이지네이션은 목록 단계에 적용
        date_filters: listEp.date_filters ?? apiConfig.date_filters,
        response_fields: listEp.response_fields,
      };
      const listRun = await collectPagesWithinRange(apiProfile, listCfg, logs, secret, opts.onProgress);
      if (listRun.error && listRun.items.length === 0) {
        return { items: [], logs, error: `목록 단계 실패: ${listRun.error}` };
      }
      if (listRun.error) partialError = `목록 단계 일부 실패: ${listRun.error}`;
      const listItems = listRun.items.filter((it) => !("raw_xml" in it));
      logs.push(`[2PHASE] 목록 ${listItems.length}건`);

      const maxDetail = Math.min(twoPhase.max_detail_items || 100, 1000);
      const seen = new Set<string>();
      const keySets: Record<string, string>[] = [];
      for (const it of listItems) {
        const kv: Record<string, string> = {};
        let ok = true;
        for (const fm of twoPhase.field_mappings) {
          if (!fm.source_field || !fm.target_param) continue;
          const v = getNestedValue(it, fm.source_field);
          if (v == null || v === "") { ok = false; break; }
          kv[fm.target_param] = String(v);
        }
        if (!ok || Object.keys(kv).length === 0) continue;
        const sig = JSON.stringify(kv);
        if (seen.has(sig)) continue;
        seen.add(sig);
        keySets.push(kv);
        if (keySets.length >= maxDetail) break;
      }
      logs.push(`[2PHASE] 본문 조회 대상 ${keySets.length}건 (상한 ${maxDetail})`);

      let detailDone = 0;
      for (const kv of keySets) {
        const detailCfg: ApiConfig = {
          ...apiConfig,
          params: { ...apiConfig.params, ...kv },
          pagination: undefined,
          secondary_endpoints: undefined,
          two_phase: undefined,
          search_filters: undefined, // 필터는 최종 결과에 일괄 적용
          response_fields: undefined,
        };
        const r = await collectPages(apiProfile, detailCfg, logs, secret);
        allData.push(...r.items.filter((it) => !("raw_xml" in it)));
        detailDone++;
        try {
          // 본문 반복도 진행 보고(page=본문 조회 순번) — 2단계 소스의 진행률 표시용
          opts.onProgress?.({ page: detailDone, items: allData.length });
        } catch {
          // 진행 보고 실패는 수집에 영향 없음
        }
        await delay(300);
      }
    } else {
      const run = await collectPagesWithinRange(apiProfile, apiConfig, logs, secret, opts.onProgress);
      if (run.error && run.items.length === 0) return { items: [], logs, error: run.error };
      if (run.error) partialError = `일부 구간 실패: ${run.error}`;
      allData = run.items;
    }

    if (apiConfig.search_filters?.length) {
      const before = allData.length;
      allData = applySearchFilters(allData, apiConfig.search_filters);
      logs.push(`[FILTER] ${before} → ${allData.length}건`);
    }
    if (apiConfig.response_fields?.length) {
      allData = filterResponseFields(allData, apiConfig.response_fields);
    }
    logs.push(`[DONE] 수집 ${allData.length}건`);
    return partialError ? { items: allData, logs, error: partialError } : { items: allData, logs };
  } catch (error) {
    return { items: allData, logs, error: error instanceof Error ? error.message : String(error) };
  }
}
