/**
 * API 가이드 스캐너
 *
 * 공공기관 API 가이드 페이지를 스캔하여 엔드포인트별 요청/응답 필드를 추출합니다.
 * 특히 open.law.go.kr (국가법령정보센터) 구조에 최적화되어 있습니다.
 */

import fs from "node:fs";
import path from "node:path";
import type { ApiEndpoint, ApiRequestParam, ApiResponseField } from "./targets-store";

// ─── 캐시 경로 ───────────────────────────────────────────────────────────────

function getCacheDir(): string {
  const cwd = process.cwd();
  const isFrontendCwd = path.basename(cwd).toLowerCase() === "frontend";
  const baseDir = isFrontendCwd ? cwd : path.join(cwd, "frontend");
  return path.join(baseDir, "data", "api-guide-cache");
}

function getCachePath(orgId: string): string {
  return path.join(getCacheDir(), `${orgId}.json`);
}

// ─── 캐시 읽기/쓰기 ──────────────────────────────────────────────────────────

export type GuideCache = {
  org_id: string;
  guide_url: string;
  scanned_at: string;
  endpoints: ApiEndpoint[];
};

export function readGuideCache(orgId: string): GuideCache | null {
  const p = getCachePath(orgId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as GuideCache;
  } catch {
    return null;
  }
}

export function writeGuideCache(cache: GuideCache): void {
  const dir = getCacheDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getCachePath(cache.org_id), JSON.stringify(cache, null, 2), "utf8");
}

// ─── HTML 유틸리티 ───────────────────────────────────────────────────────────

function fetchText(url: string, timeout = 30000): Promise<string> {
  return fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "EcoMonitorBot/1.0 (api_guide_scanner)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    },
    signal: AbortSignal.timeout(timeout),
  }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  });
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/g, " ");
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

// ─── 국가법령정보센터 전용 스캐너 ─────────────────────────────────────────────

/**
 * open.law.go.kr 가이드 목록에서 API 링크 추출
 */
function parseLawGoGuideLinks(html: string): { name: string; guideId: string }[] {
  const results: { name: string; guideId: string }[] = [];

  // openApiGuide('guideId') 패턴 추출
  const regex = /openApiGuide\(['"](\w+)['"]\)[^>]*>([^<]+)</gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const guideId = match[1];
    const name = stripHtml(match[2]);
    if (guideId && name) {
      results.push({ name, guideId });
    }
  }

  return results;
}

/**
 * 국가법령정보센터 API 상세 가이드 페이지 URL 구성
 * 
 * 국가법령정보센터의 가이드 페이지 구조:
 * - 가이드 목록: https://open.law.go.kr/LSO/openApi/guideList.do
 * - 상세 가이드: https://open.law.go.kr/LSO/openApi/{guideId}.do
 */
function getLawGoGuideDetailUrl(guideId: string): string {
  return `https://open.law.go.kr/LSO/openApi/${guideId}.do`;
}

/**
 * 국가법령정보센터 가이드 상세 페이지에서 요청/응답 필드 추출
 */
function parseLawGoGuideDetail(html: string, guideId: string): Partial<ApiEndpoint> | null {
  const result: Partial<ApiEndpoint> = {
    name: "",
    path: "",
    method: "GET",
    request_params: [],
    response_fields: [],
  };

  // 1. API명 추출 (제목에서)
  const titleMatch = html.match(/<h[1-4][^>]*>([^<]+)<\/h[1-4]>/i);
  if (titleMatch) {
    result.name = stripHtml(titleMatch[1]);
  }

  // 2. 호출 URL에서 path 추출
  // 패턴: http://www.law.go.kr/DRF/lawSearch.do
  const urlMatch = html.match(/https?:\/\/(?:www\.)?law\.go\.kr([^\s"'<>]+\.do)/i);
  if (urlMatch) {
    result.path = urlMatch[1];
  }

  // 3. 요청 파라미터 테이블 추출
  // 일반적인 테이블 구조에서 파라미터 정보 추출
  result.request_params = extractTableParams(html, "요청|파라미터|변수|항목명");

  // 4. 응답 필드 테이블 추출
  result.response_fields = extractTableFields(html, "응답|출력|결과|필드");

  // 결과가 비어있으면 null 반환
  if (!result.request_params?.length && !result.response_fields?.length) {
    return null;
  }

  return result;
}

/**
 * HTML 테이블에서 요청 파라미터 추출
 */
function extractTableParams(html: string, sectionHint: string): ApiRequestParam[] {
  const params: ApiRequestParam[] = [];
  const hintRegex = new RegExp(sectionHint, "i");

  // 테이블 찾기 (sectionHint 근처의 테이블)
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];

  for (const table of tables) {
    // 이 테이블이 요청 파라미터 관련인지 확인
    const contextStart = Math.max(0, html.indexOf(table) - 500);
    const context = html.slice(contextStart, html.indexOf(table) + 100);
    if (!hintRegex.test(context) && !hintRegex.test(table)) continue;

    // 테이블 행 추출
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];

    for (const row of rows) {
      const cells = row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) ?? [];
      if (cells.length < 2) continue;

      const cellTexts = cells.map((c) => stripHtml(c));

      // 헤더 행 건너뛰기
      if (cellTexts[0].match(/^(항목|파라미터|변수|필드|이름|명칭|No)$/i)) continue;

      // 파라미터 정보 추출
      const param: ApiRequestParam = {
        name: cellTexts[0] || "",
        name_ko: cellTexts[1] || cellTexts[0] || "",
        required: /필수|Y|O|Yes|Required/i.test(row),
        type: guessType(cellTexts),
        description: cellTexts.slice(2).join(" ").trim(),
      };

      if (param.name && !param.name.match(/^[0-9]+$/)) {
        params.push(param);
      }
    }
  }

  return params;
}

/**
 * HTML 테이블에서 응답 필드 추출
 */
function extractTableFields(html: string, sectionHint: string): ApiResponseField[] {
  const fields: ApiResponseField[] = [];
  const hintRegex = new RegExp(sectionHint, "i");

  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];

  for (const table of tables) {
    const contextStart = Math.max(0, html.indexOf(table) - 500);
    const context = html.slice(contextStart, html.indexOf(table) + 100);
    if (!hintRegex.test(context) && !hintRegex.test(table)) continue;

    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];

    for (const row of rows) {
      const cells = row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) ?? [];
      if (cells.length < 2) continue;

      const cellTexts = cells.map((c) => stripHtml(c));

      // 헤더 행 건너뛰기
      if (cellTexts[0].match(/^(항목|필드|출력|응답|이름|명칭|No)$/i)) continue;

      const field: ApiResponseField = {
        name: cellTexts[0] || "",
        name_ko: cellTexts[1] || cellTexts[0] || "",
        type: guessType(cellTexts),
        description: cellTexts.slice(2).join(" ").trim(),
      };

      if (field.name && !field.name.match(/^[0-9]+$/)) {
        fields.push(field);
      }
    }
  }

  return fields;
}

/**
 * 셀 내용에서 타입 추론
 */
function guessType(cells: string[]): string {
  const text = cells.join(" ").toLowerCase();
  if (text.includes("date") || text.includes("일자") || text.includes("일시")) return "date";
  if (text.includes("int") || text.includes("number") || text.includes("숫자") || text.includes("건수")) return "int";
  if (text.includes("boolean") || text.includes("여부")) return "boolean";
  return "string";
}

// ─── 국가법령정보센터 하드코딩 데이터 ─────────────────────────────────────────

/**
 * 국가법령정보센터 API는 공식 문서에서 추출하기 어려운 경우가 많으므로
 * 알려진 엔드포인트 정보를 하드코딩합니다.
 * 
 * 각 엔드포인트는 LLM이 생성할 수 있는 다양한 path 변형을 `path_aliases`로 지원합니다.
 */
export const LAWGO_KNOWN_ENDPOINTS: ApiEndpoint[] = [
  {
    name: "현행법령 목록 조회",
    path: "/DRF/lawSearch.do",
    method: "GET",
    required_params: ["OC", "target", "type"],
    fixed_params: { target: "law", type: "XML" },
    variable_params: ["query", "page", "display", "org", "sort"],
    description: "현행법령 목록을 조회하는 API",
    request_params: [
      { name: "OC", name_ko: "사용자ID", required: true, type: "string", description: "Open API 사용자 ID" },
      { name: "target", name_ko: "대상", required: true, type: "string", description: "검색 대상 (law 고정)" },
      { name: "type", name_ko: "응답형식", required: true, type: "string", description: "응답 형식 (XML, JSON)" },
      { name: "query", name_ko: "검색어", required: false, type: "string", description: "검색어" },
      { name: "page", name_ko: "페이지", required: false, type: "int", description: "페이지 번호" },
      { name: "display", name_ko: "출력건수", required: false, type: "int", description: "한 페이지 출력 건수" },
      { name: "org", name_ko: "소관부처", required: false, type: "string", description: "소관부처 코드" },
      { name: "sort", name_ko: "정렬", required: false, type: "string", description: "정렬 방식" },
    ],
    response_fields: [
      { name: "법령일련번호", name_ko: "법령일련번호", type: "string", description: "법령 고유 식별자" },
      { name: "현행연혁코드", name_ko: "현행연혁코드", type: "string", description: "현행/연혁 구분 코드" },
      { name: "법령명한글", name_ko: "법령명한글", type: "string", description: "법령의 한글 명칭" },
      { name: "법령명약칭", name_ko: "법령명약칭", type: "string", description: "법령 약칭" },
      { name: "법령ID", name_ko: "법령ID", type: "string", description: "법령 ID" },
      { name: "공포일자", name_ko: "공포일자", type: "date", description: "공포 일자 (YYYYMMDD)" },
      { name: "공포번호", name_ko: "공포번호", type: "string", description: "공포 번호" },
      { name: "시행일자", name_ko: "시행일자", type: "date", description: "시행 일자 (YYYYMMDD)" },
      { name: "소관부처코드", name_ko: "소관부처코드", type: "string", description: "소관부처 코드" },
      { name: "소관부처명", name_ko: "소관부처명", type: "string", description: "소관부처 명칭" },
      { name: "법령구분명", name_ko: "법령구분명", type: "string", description: "법령 구분 (법률, 대통령령 등)" },
      { name: "법령상세링크", name_ko: "법령상세링크", type: "string", description: "상세 페이지 링크" },
    ],
  },
  {
    name: "행정규칙 목록 조회",
    path: "/DRF/lawSearch.do",
    method: "GET",
    required_params: ["OC", "target", "type"],
    fixed_params: { target: "admrul", type: "XML" },
    variable_params: ["query", "page", "display", "org", "sort"],
    description: "행정규칙(훈령, 예규, 고시 등) 목록을 조회하는 API",
    request_params: [
      { name: "OC", name_ko: "사용자ID", required: true, type: "string", description: "Open API 사용자 ID" },
      { name: "target", name_ko: "대상", required: true, type: "string", description: "검색 대상 (admrul 고정)" },
      { name: "type", name_ko: "응답형식", required: true, type: "string", description: "응답 형식 (XML, JSON)" },
      { name: "query", name_ko: "검색어", required: false, type: "string", description: "검색어" },
      { name: "page", name_ko: "페이지", required: false, type: "int", description: "페이지 번호" },
      { name: "display", name_ko: "출력건수", required: false, type: "int", description: "한 페이지 출력 건수" },
    ],
    response_fields: [
      { name: "행정규칙일련번호", name_ko: "행정규칙일련번호", type: "string", description: "행정규칙 고유 식별자" },
      { name: "행정규칙종류", name_ko: "행정규칙종류", type: "string", description: "훈령, 예규, 고시 등" },
      { name: "행정규칙명", name_ko: "행정규칙명", type: "string", description: "행정규칙 명칭" },
      { name: "발령일자", name_ko: "발령일자", type: "date", description: "발령 일자 (YYYYMMDD)" },
      { name: "발령번호", name_ko: "발령번호", type: "string", description: "발령 번호" },
      { name: "시행일자", name_ko: "시행일자", type: "date", description: "시행 일자 (YYYYMMDD)" },
      { name: "소관부처명", name_ko: "소관부처명", type: "string", description: "소관부처 명칭" },
    ],
  },
  // 판례 - LLM이 /DRF/precSearch.do 로 생성할 수 있음
  {
    name: "판례 목록 조회",
    path: "/DRF/lawSearch.do",
    method: "GET",
    required_params: ["OC", "target", "type"],
    fixed_params: { target: "prec", type: "XML" },
    variable_params: ["query", "page", "display"],
    description: "판례 목록을 조회하는 API",
    request_params: [
      { name: "OC", name_ko: "사용자ID", required: true, type: "string", description: "Open API 사용자 ID" },
      { name: "target", name_ko: "대상", required: true, type: "string", description: "검색 대상 (prec 고정)" },
      { name: "type", name_ko: "응답형식", required: true, type: "string", description: "응답 형식 (XML, JSON)" },
      { name: "query", name_ko: "검색어", required: false, type: "string", description: "검색어" },
      { name: "page", name_ko: "페이지", required: false, type: "int", description: "페이지 번호" },
      { name: "display", name_ko: "출력건수", required: false, type: "int", description: "한 페이지 출력 건수" },
    ],
    response_fields: [
      { name: "판례일련번호", name_ko: "판례일련번호", type: "string", description: "판례 고유 식별자" },
      { name: "사건명", name_ko: "사건명", type: "string", description: "사건 명칭" },
      { name: "사건번호", name_ko: "사건번호", type: "string", description: "사건 번호" },
      { name: "선고일자", name_ko: "선고일자", type: "date", description: "선고 일자" },
      { name: "법원명", name_ko: "법원명", type: "string", description: "법원 명칭" },
      { name: "사건종류명", name_ko: "사건종류명", type: "string", description: "사건 종류" },
      { name: "판결유형", name_ko: "판결유형", type: "string", description: "판결 유형" },
    ],
  },
  // 판례 본문 - LLM이 생성하는 path 변형
  {
    name: "판례 본문 조회",
    path: "/DRF/precSearch.do",
    method: "GET",
    required_params: ["OC", "target", "type"],
    fixed_params: { target: "prec", type: "XML" },
    variable_params: ["query", "page", "display"],
    description: "판례 본문을 조회하는 API",
    request_params: [
      { name: "OC", name_ko: "사용자ID", required: true, type: "string", description: "Open API 사용자 ID" },
      { name: "target", name_ko: "대상", required: true, type: "string", description: "검색 대상 (prec 고정)" },
      { name: "type", name_ko: "응답형식", required: true, type: "string", description: "응답 형식 (XML, JSON)" },
      { name: "query", name_ko: "검색어", required: false, type: "string", description: "검색어" },
      { name: "page", name_ko: "페이지", required: false, type: "int", description: "페이지 번호" },
      { name: "display", name_ko: "출력건수", required: false, type: "int", description: "한 페이지 출력 건수" },
    ],
    response_fields: [
      { name: "판례일련번호", name_ko: "판례일련번호", type: "string", description: "판례 고유 식별자" },
      { name: "사건명", name_ko: "사건명", type: "string", description: "사건 명칭" },
      { name: "사건번호", name_ko: "사건번호", type: "string", description: "사건 번호" },
      { name: "선고일자", name_ko: "선고일자", type: "date", description: "선고 일자" },
      { name: "법원명", name_ko: "법원명", type: "string", description: "법원 명칭" },
      { name: "사건종류명", name_ko: "사건종류명", type: "string", description: "사건 종류" },
      { name: "판결유형", name_ko: "판결유형", type: "string", description: "판결 유형" },
      { name: "판시사항", name_ko: "판시사항", type: "string", description: "판시 사항" },
      { name: "판결요지", name_ko: "판결요지", type: "string", description: "판결 요지" },
    ],
  },
  // 행정심판례 - LLM이 /DRF/admrulSearch.do 로 생성할 수 있음
  {
    name: "행정심판례 본문 조회",
    path: "/DRF/admrulSearch.do",
    method: "GET",
    required_params: ["OC", "target", "type"],
    fixed_params: { target: "admrul", type: "XML" },
    variable_params: ["query", "page", "display"],
    description: "행정심판례 본문을 조회하는 API",
    request_params: [
      { name: "OC", name_ko: "사용자ID", required: true, type: "string", description: "Open API 사용자 ID" },
      { name: "target", name_ko: "대상", required: true, type: "string", description: "검색 대상 (admrul 고정)" },
      { name: "type", name_ko: "응답형식", required: true, type: "string", description: "응답 형식 (XML, JSON)" },
      { name: "query", name_ko: "검색어", required: false, type: "string", description: "검색어" },
      { name: "page", name_ko: "페이지", required: false, type: "int", description: "페이지 번호" },
      { name: "display", name_ko: "출력건수", required: false, type: "int", description: "한 페이지 출력 건수" },
    ],
    response_fields: [
      { name: "행정규칙일련번호", name_ko: "행정규칙일련번호", type: "string", description: "행정규칙 고유 식별자" },
      { name: "행정규칙종류", name_ko: "행정규칙종류", type: "string", description: "훈령, 예규, 고시 등" },
      { name: "행정규칙명", name_ko: "행정규칙명", type: "string", description: "행정규칙 명칭" },
      { name: "발령일자", name_ko: "발령일자", type: "date", description: "발령 일자 (YYYYMMDD)" },
      { name: "발령번호", name_ko: "발령번호", type: "string", description: "발령 번호" },
      { name: "시행일자", name_ko: "시행일자", type: "date", description: "시행 일자 (YYYYMMDD)" },
      { name: "소관부처명", name_ko: "소관부처명", type: "string", description: "소관부처 명칭" },
    ],
  },
  {
    name: "법령 본문 조회",
    path: "/DRF/lawService.do",
    method: "GET",
    required_params: ["OC", "target", "type", "ID"],
    fixed_params: { target: "law", type: "XML" },
    variable_params: ["ID"],
    description: "법령 본문 상세 정보를 조회하는 API",
    request_params: [
      { name: "OC", name_ko: "사용자ID", required: true, type: "string", description: "Open API 사용자 ID" },
      { name: "target", name_ko: "대상", required: true, type: "string", description: "검색 대상 (law 고정)" },
      { name: "type", name_ko: "응답형식", required: true, type: "string", description: "응답 형식 (XML, JSON)" },
      { name: "ID", name_ko: "법령ID", required: true, type: "string", description: "법령 ID 또는 법령일련번호" },
    ],
    response_fields: [
      { name: "법령ID", name_ko: "법령ID", type: "string", description: "법령 ID" },
      { name: "법령명한글", name_ko: "법령명한글", type: "string", description: "법령 한글명" },
      { name: "법령명영문", name_ko: "법령명영문", type: "string", description: "법령 영문명" },
      { name: "공포일자", name_ko: "공포일자", type: "date", description: "공포 일자" },
      { name: "시행일자", name_ko: "시행일자", type: "date", description: "시행 일자" },
      { name: "소관부처명", name_ko: "소관부처명", type: "string", description: "소관부처 명칭" },
      { name: "조문", name_ko: "조문", type: "string", description: "조문 내용 (XML 구조)" },
    ],
  },
  // 현행법령 본문 - LLM이 /DRF/lawView.do 로 생성할 수 있음
  {
    name: "현행법령(시행일) 본문 조회",
    path: "/DRF/lawView.do",
    method: "GET",
    required_params: ["OC", "target", "type", "id"],
    fixed_params: { target: "law", type: "XML" },
    variable_params: ["id"],
    description: "현행법령의 시행일 본문을 조회하는 API",
    request_params: [
      { name: "OC", name_ko: "사용자ID", required: true, type: "string", description: "Open API 사용자 ID" },
      { name: "target", name_ko: "대상", required: true, type: "string", description: "검색 대상 (law 고정)" },
      { name: "type", name_ko: "응답형식", required: true, type: "string", description: "응답 형식 (XML, JSON)" },
      { name: "id", name_ko: "법령ID", required: true, type: "string", description: "법령 고유 식별자" },
    ],
    response_fields: [
      { name: "법령ID", name_ko: "법령ID", type: "string", description: "법령 ID" },
      { name: "법령명한글", name_ko: "법령명한글", type: "string", description: "법령 한글명" },
      { name: "법령명영문", name_ko: "법령명영문", type: "string", description: "법령 영문명" },
      { name: "공포일자", name_ko: "공포일자", type: "date", description: "공포 일자" },
      { name: "시행일자", name_ko: "시행일자", type: "date", description: "시행 일자" },
      { name: "소관부처명", name_ko: "소관부처명", type: "string", description: "소관부처 명칭" },
      { name: "조문", name_ko: "조문", type: "string", description: "조문 내용 (XML 구조)" },
      { name: "부칙", name_ko: "부칙", type: "string", description: "부칙 내용" },
    ],
  },
  {
    name: "행정규칙 본문 조회",
    path: "/DRF/lawService.do",
    method: "GET",
    required_params: ["OC", "target", "type", "ID"],
    fixed_params: { target: "admrul", type: "XML" },
    variable_params: ["ID"],
    description: "행정규칙 본문 상세 정보를 조회하는 API",
    request_params: [
      { name: "OC", name_ko: "사용자ID", required: true, type: "string", description: "Open API 사용자 ID" },
      { name: "target", name_ko: "대상", required: true, type: "string", description: "검색 대상 (admrul 고정)" },
      { name: "type", name_ko: "응답형식", required: true, type: "string", description: "응답 형식 (XML, JSON)" },
      { name: "ID", name_ko: "행정규칙ID", required: true, type: "string", description: "행정규칙 일련번호" },
    ],
    response_fields: [
      { name: "행정규칙일련번호", name_ko: "행정규칙일련번호", type: "string", description: "행정규칙 고유 식별자" },
      { name: "행정규칙종류", name_ko: "행정규칙종류", type: "string", description: "훈령, 예규, 고시 등" },
      { name: "행정규칙명", name_ko: "행정규칙명", type: "string", description: "행정규칙 명칭" },
      { name: "발령일자", name_ko: "발령일자", type: "date", description: "발령 일자" },
      { name: "발령번호", name_ko: "발령번호", type: "string", description: "발령 번호" },
      { name: "본문", name_ko: "본문", type: "string", description: "본문 내용" },
    ],
  },
  // 행정규칙 본문 - LLM이 /DRF/admrulView.do 로 생성할 수 있음
  {
    name: "행정규칙 본문 조회 (View)",
    path: "/DRF/admrulView.do",
    method: "GET",
    required_params: ["OC", "target", "type", "id"],
    fixed_params: { target: "admrul", type: "XML" },
    variable_params: ["id"],
    description: "행정규칙 본문을 조회하는 API",
    request_params: [
      { name: "OC", name_ko: "사용자ID", required: true, type: "string", description: "Open API 사용자 ID" },
      { name: "target", name_ko: "대상", required: true, type: "string", description: "검색 대상 (admrul 고정)" },
      { name: "type", name_ko: "응답형식", required: true, type: "string", description: "응답 형식 (XML, JSON)" },
      { name: "id", name_ko: "규칙ID", required: true, type: "string", description: "행정규칙 고유 식별자" },
    ],
    response_fields: [
      { name: "행정규칙일련번호", name_ko: "행정규칙일련번호", type: "string", description: "행정규칙 고유 식별자" },
      { name: "행정규칙종류", name_ko: "행정규칙종류", type: "string", description: "훈령, 예규, 고시 등" },
      { name: "행정규칙명", name_ko: "행정규칙명", type: "string", description: "행정규칙 명칭" },
      { name: "발령일자", name_ko: "발령일자", type: "date", description: "발령 일자" },
      { name: "발령번호", name_ko: "발령번호", type: "string", description: "발령 번호" },
      { name: "시행일자", name_ko: "시행일자", type: "date", description: "시행 일자" },
      { name: "소관부처명", name_ko: "소관부처명", type: "string", description: "소관부처 명칭" },
      { name: "본문", name_ko: "본문", type: "string", description: "본문 내용" },
    ],
  },
];

// ─── 메인 스캔 함수 ──────────────────────────────────────────────────────────

export type ScanResult = {
  success: boolean;
  endpoints: ApiEndpoint[];
  warnings: string[];
  source: "scan" | "cache" | "fallback";
};

/**
 * 국가법령정보센터 가이드 스캔
 */
export async function scanLawGoGuide(guideUrl: string, useCache = true): Promise<ScanResult> {
  const orgId = "lawgo";
  const warnings: string[] = [];

  // 1. 캐시 확인
  if (useCache) {
    const cached = readGuideCache(orgId);
    if (cached && cached.endpoints.length > 0) {
      // 24시간 이내 캐시만 사용
      const cacheAge = Date.now() - new Date(cached.scanned_at).getTime();
      if (cacheAge < 24 * 60 * 60 * 1000) {
        return { success: true, endpoints: cached.endpoints, warnings: [], source: "cache" };
      }
    }
  }

  // 2. 웹 스캔 시도
  try {
    const html = await fetchText(guideUrl);
    const links = parseLawGoGuideLinks(html);

    if (links.length === 0) {
      warnings.push("가이드 목록에서 API 링크를 찾지 못했습니다.");
    }

    const endpoints: ApiEndpoint[] = [];

    // 각 가이드 상세 페이지 스캔
    for (const link of links.slice(0, 10)) {
      // 최대 10개만 스캔
      try {
        const detailUrl = getLawGoGuideDetailUrl(link.guideId);
        const detailHtml = await fetchText(detailUrl);
        const parsed = parseLawGoGuideDetail(detailHtml, link.guideId);

        if (parsed) {
          endpoints.push({
            name: parsed.name || link.name,
            path: parsed.path || "",
            method: parsed.method || "GET",
            request_params: parsed.request_params,
            response_fields: parsed.response_fields,
          });
        }
      } catch (err) {
        warnings.push(`${link.name} 상세 페이지 스캔 실패`);
      }
    }

    // 스캔 결과가 있으면 캐시 저장
    if (endpoints.length > 0) {
      writeGuideCache({
        org_id: orgId,
        guide_url: guideUrl,
        scanned_at: new Date().toISOString(),
        endpoints,
      });
      return { success: true, endpoints, warnings, source: "scan" };
    }
  } catch (err) {
    warnings.push(`가이드 페이지 접근 실패: ${(err as Error).message}`);
  }

  // 3. 폴백: 하드코딩된 데이터 사용
  warnings.push("웹 스캔 실패로 하드코딩된 데이터를 사용합니다.");
  return { success: true, endpoints: LAWGO_KNOWN_ENDPOINTS, warnings, source: "fallback" };
}

/**
 * 범용 가이드 스캔 (기관별 분기)
 */
export async function scanApiGuide(
  orgId: string,
  guideUrl: string,
  useCache = true
): Promise<ScanResult> {
  // 국가법령정보센터
  if (orgId === "lawgo" || guideUrl.includes("law.go.kr")) {
    return scanLawGoGuide(guideUrl, useCache);
  }

  // 기타 기관은 추후 구현
  return {
    success: false,
    endpoints: [],
    warnings: ["해당 기관의 가이드 스캐너가 아직 구현되지 않았습니다."],
    source: "fallback",
  };
}

/**
 * 엔드포인트 매칭 점수 계산
 * 높을수록 더 좋은 매칭
 */
function calculateMatchScore(ep: Partial<ApiEndpoint>, scanned: ApiEndpoint): number {
  let score = 0;

  // 1. path 완전 일치 (최고 점수)
  if (ep.path && ep.path === scanned.path) score += 100;

  // 2. path 부분 일치 (예: /DRF/lawSearch.do와 /DRF/precSearch.do 모두 /DRF/ 포함)
  if (ep.path && scanned.path) {
    const epBaseName = ep.path.split("/").pop()?.replace(".do", "") ?? "";
    const scannedBaseName = scanned.path.split("/").pop()?.replace(".do", "") ?? "";
    if (epBaseName === scannedBaseName) score += 80;
  }

  // 3. fixed_params.target 일치 (매우 중요!)
  const epTarget = (ep.fixed_params as Record<string, string> | undefined)?.target;
  const scannedTarget = scanned.fixed_params?.target;
  if (epTarget && scannedTarget && epTarget === scannedTarget) score += 50;

  // 4. 이름 완전 일치
  if (ep.name && ep.name === scanned.name) score += 40;

  // 5. 이름 부분 일치
  if (ep.name && scanned.name) {
    const epNameLower = (ep.name as string).toLowerCase();
    const scannedNameLower = scanned.name.toLowerCase();
    if (epNameLower.includes(scannedNameLower) || scannedNameLower.includes(epNameLower)) {
      score += 20;
    }
    // 키워드 매칭 (법령, 판례, 행정규칙 등)
    const keywords = ["법령", "판례", "행정규칙", "행정심판", "본문", "목록"];
    for (const kw of keywords) {
      if (epNameLower.includes(kw) && scannedNameLower.includes(kw)) {
        score += 10;
      }
    }
  }

  return score;
}

/**
 * LLM 결과에 스캔 데이터 병합
 *
 * LLM이 생성한 api_profile에 스캔된 request_params/response_fields를 병합합니다.
 * 매칭 로직을 개선하여 path, name, fixed_params.target 등을 종합적으로 고려합니다.
 */
export function mergeScannedFields(
  apiProfile: Record<string, unknown>,
  scannedEndpoints: ApiEndpoint[]
): Record<string, unknown> {
  const endpoints = (apiProfile.endpoints ?? []) as Partial<ApiEndpoint>[];

  const merged = endpoints.map((ep) => {
    // 모든 스캔된 엔드포인트에 대해 매칭 점수 계산
    let bestMatch: ApiEndpoint | null = null;
    let bestScore = 0;

    for (const scanned of scannedEndpoints) {
      const score = calculateMatchScore(ep, scanned);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = scanned;
      }
    }

    // 매칭 점수가 30 이상인 경우에만 병합 (너무 낮으면 무관한 엔드포인트)
    if (!bestMatch || bestScore < 30) return ep;

    return {
      ...ep,
      // 스캔된 데이터로 보강 (기존 값이 없거나 비어있으면 덮어씀)
      request_params:
        Array.isArray(ep.request_params) && ep.request_params.length > 0
          ? ep.request_params
          : bestMatch.request_params,
      response_fields:
        Array.isArray(ep.response_fields) && ep.response_fields.length > 0
          ? ep.response_fields
          : bestMatch.response_fields,
      // path도 보강 (기존 path 유지, 없으면 스캔 결과 사용)
      path: ep.path || bestMatch.path,
      fixed_params: ep.fixed_params || bestMatch.fixed_params,
      variable_params: ep.variable_params || bestMatch.variable_params,
    };
  });

  // LLM이 놓친 엔드포인트 추가 (중복 방지)
  for (const scanned of scannedEndpoints) {
    const exists = merged.some((m) => {
      const score = calculateMatchScore(m, scanned);
      return score >= 50; // path 또는 target이 일치하면 존재하는 것으로 간주
    });
    if (!exists) {
      merged.push(scanned);
    }
  }

  return {
    ...apiProfile,
    endpoints: merged,
  };
}

