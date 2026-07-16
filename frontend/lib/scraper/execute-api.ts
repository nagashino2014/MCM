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

/**
 * format 토큰(YYYY/MM/DD/HH/mm/ss) 치환 — YYYYMM·YYYYMMDDHHmm 등 임의 조합 지원.
 * (기존 switch 방식은 미지원 포맷을 YYYY-MM-DD로 폴백해 나라장터 필수값 오류(08)를 유발했다.)
 * endOfDay=true(종료일)면 시각 성분을 23:59:59로 채운다.
 */
function formatDateForApi(date: Date, format?: string, endOfDay = false): string {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  if (!format) return `${y}-${m}-${d}`;
  return format
    .replace("YYYY", y)
    .replace("MM", m)
    .replace("DD", d)
    .replace("HH", endOfDay ? "23" : "00")
    .replace("mm", endOfDay ? "59" : "00")
    .replace("ss", endOfDay ? "59" : "00");
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
export async function runApiCollect(
  apiProfile: ApiProfile,
  apiConfig: ApiConfig,
  opts: { secret?: string | null } = {}
): Promise<RunApiResult> {
  const logs: string[] = [];
  let allData: Record<string, unknown>[] = [];
  try {
    if (!apiConfig?.primary_endpoint?.path) {
      return { items: [], logs, error: "api_config.primary_endpoint 가 없습니다." };
    }
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
      const result = await executeApiCall(apiProfile, apiConfig, pageParams, logs, opts.secret ?? null);
      if (result.error) {
        logs.push(`[ERROR] ${result.error}`);
        if (page === 1) return { items: [], logs, error: result.error };
        break;
      }
      const items = extractDataFromResponse(result.data, logs, listPath);
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
