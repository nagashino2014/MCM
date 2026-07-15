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

function formatDateForApi(date: Date, format?: string): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  switch (format) {
    case "YYYYMMDD":
      return `${y}${m}${d}`;
    case "YYYY/MM/DD":
      return `${y}/${m}/${d}`;
    case "YYYY.MM.DD":
      return `${y}.${m}.${d}`;
    default:
      return `${y}-${m}-${d}`;
  }
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
    if (df.relative_days && df.relative_days > 0) {
      const past = new Date(today);
      past.setDate(past.getDate() - df.relative_days);
      startDate = formatDateForApi(past, df.format);
      endDate = formatDateForApi(today, df.format);
    }
    const f = df.field.toLowerCase();
    if (f.includes("start") || f.includes("from")) {
      if (startDate) result[df.field] = startDate;
    } else if (f.includes("end") || f.includes("to")) {
      if (endDate) result[df.field] = endDate;
    } else if (startDate) {
      result[df.field] = startDate;
    }
  }
  return result;
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

/** JSON 응답에서 데이터 배열 추출(일반 경로 자동탐지). XML은 [{raw_xml}]로 감싸 반환(어댑터가 skip). */
function extractDataFromResponse(response: unknown, logs: string[]): Record<string, unknown>[] {
  if (response && typeof response === "object") {
    if (Array.isArray(response)) {
      logs.push(`[EXTRACT] 배열 응답: ${response.length}건`);
      return response as Record<string, unknown>[];
    }
    const rec = response as Record<string, unknown>;
    if ((rec.raw_xml || rec.raw_text) && Object.keys(rec).length <= 2) {
      return [rec];
    }
    const commonPaths = ["data", "items", "results", "records", "list", "rows", "content", "목록", "결과"];
    for (const key of commonPaths) {
      const v = rec[key];
      if (v) {
        if (Array.isArray(v)) {
          logs.push(`[EXTRACT] ${key} 경로: ${v.length}건`);
          return v as Record<string, unknown>[];
        }
        if (typeof v === "object") {
          for (const subKey of commonPaths) {
            const sv = (v as Record<string, unknown>)[subKey];
            if (Array.isArray(sv)) {
              logs.push(`[EXTRACT] ${key}.${subKey} 경로: ${sv.length}건`);
              return sv as Record<string, unknown>[];
            }
          }
          return [v as Record<string, unknown>];
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
  logs: string[]
): Promise<{ data: unknown; error?: string }> {
  const baseUrl = apiProfile.base_url;
  if (!baseUrl) return { data: null, error: "base_url이 설정되지 않았습니다." };
  const endpoint = apiConfig.primary_endpoint;
  if (!endpoint?.path) return { data: null, error: "endpoint path가 설정되지 않았습니다." };

  try {
    const url = new URL(endpoint.path, baseUrl);
    let params = { ...(apiProfile.default_params ?? {}), ...apiConfig.params };
    params = applyDateFilters(params, apiConfig.date_filters);
    params = { ...params, ...pageParams };
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
      const secret = getEnvSecret(auth.secret_ref);
      if (secret && authName) {
        if (authIn === "header") headers[authName] = secret;
        else url.searchParams.set(authName, secret);
        logs.push(`[AUTH] 인증 파라미터 "${authName}" 적용됨`);
      } else if (auth.secret_ref && authName) {
        logs.push(`[AUTH] 시크릿(${auth.secret_ref}) 부재 — 인증 없이 호출`);
      }
    }

    logs.push(`[API] ${endpoint.method || "GET"} ${url.toString()}`);
    const response = await fetch(url.toString(), {
      method: endpoint.method || "GET",
      headers,
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) return { data: null, error: `HTTP ${response.status}: ${response.statusText}` };

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
    return { data };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 등록된 api_profile + api_config로 수집을 실행해 원시 item 목록을 반환한다.
 * 페이지네이션(page/offset), max_pages 상한, 빈 페이지 조기 종료, 검색/필드 필터 적용.
 */
export async function runApiCollect(apiProfile: ApiProfile, apiConfig: ApiConfig): Promise<RunApiResult> {
  const logs: string[] = [];
  let allData: Record<string, unknown>[] = [];
  try {
    if (!apiConfig?.primary_endpoint?.path) {
      return { items: [], logs, error: "api_config.primary_endpoint 가 없습니다." };
    }
    const pagination = apiConfig.pagination;
    const maxPages = Math.min(pagination?.max_pages || 1, 200); // 무한루프 방어 상한
    const pageSize = pagination?.page_size || 10;
    const pageParam = pagination?.param_name || "page";

    for (let page = 1; page <= maxPages; page++) {
      const pageParams: Record<string, string> = {};
      if (pagination && pagination.type !== "none") {
        if (pagination.type === "offset") pageParams[pageParam] = String((page - 1) * pageSize);
        else pageParams[pageParam] = String(page);
        // 페이지당 건수 파라미터(예: numOfRows)가 별도면 함께 전달.
        if (pagination.size_param) pageParams[pagination.size_param] = String(pageSize);
      }
      const result = await executeApiCall(apiProfile, apiConfig, pageParams, logs);
      if (result.error) {
        logs.push(`[ERROR] ${result.error}`);
        if (page === 1) return { items: [], logs, error: result.error };
        break;
      }
      const items = extractDataFromResponse(result.data, logs);
      if (items.length === 0) {
        logs.push("[INFO] 빈 페이지 — 페이지네이션 종료");
        break;
      }
      allData.push(...items);
      if (page < maxPages) await delay(500);
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
    return { items: allData, logs };
  } catch (error) {
    return { items: allData, logs, error: error instanceof Error ? error.message : String(error) };
  }
}
