/**
 * 다우오피스 API 클라이언트
 * - 저장된 세션(storageState)의 쿠키로 내부 API 를 직접 호출한다(브라우저 렌더링 불필요).
 * - probe 로 확인한 엔드포인트:
 *     GET /gw/api/approval/manage/document          목록(관리자 · 전 사용자 · 전 상태)
 *     GET /gw/api/approval/manage/document/{id}     상세(본문 HTML · 첨부 · 의견 · 결재선)
 *     GET /gw/api/approval/document/{id}/comment    결재 의견
 *     GET /gw/api/approval/apprform/core/admin      양식 목록
 *     GET /gw/app/approval/document/{id}/popup/print 인쇄용 HTML(보존용 폴백)
 */

import { chromium, request, APIRequestContext, Browser, BrowserContext, Page } from "playwright";

import { SESSION_FILE, hasSession } from "./session";

/** 목록 조회 시 사용하는 상태 필터 — 진행중·완료·반려·수신·임시저장까지 전부 포함(누락 방지) */
export const ALL_DOC_STATUS = [
  "inprogress",
  "complete",
  "return",
  "recv_waiting",
  "received",
  "recv_returned",
  "draft_waiting",
  "tempsave",
];

export const ALL_DOC_TYPE = ["draft", "receive"];

export interface DocListItem {
  id: string;
  documentId: string;
  docType: string;
  docNum: string;
  formName: string;
  title: string;
  docYear: number;
  docStatus: string;
  docStatusName: string;
  apprStatus: string;
  attachCount: number;
  commentCount: number;
  drafterId: string;
  drafterName: string;
  drafterDeptName: string;
  drafterPositionName: string;
  draftedAt: string;
  completedAt: string;
  finalActivityUsers: string;
  [key: string]: any;
}

/**
 * 다우 API 핸들.
 * ⚠ 다우는 AccessToken/RefreshToken 방식이라 **파일 storageState 만으로 만든 request 컨텍스트는
 *   AccessToken 만료 시점(수십 초~수 분)부터 전부 401** 이 된다(실측: 150건 성공 후 전량 401).
 *   토큰 갱신은 브라우저가 수행하므로, 브라우저 컨텍스트와 쿠키를 공유하는 `context.request` 를 쓰고
 *   401 이 나면 페이지를 다시 열어(refresh) 토큰을 갱신한 뒤 재시도한다.
 */
export interface DaouApi {
  api: APIRequestContext;
  /** 페이지 네비게이션으로 토큰 갱신(동시 호출은 1회로 합쳐진다) */
  refresh(): Promise<void>;
  close(): Promise<void>;
}

export async function openDaouApi(baseUrl: string): Promise<DaouApi> {
  if (!hasSession()) {
    throw new Error("세션이 없습니다. 먼저 'npm run daou -- probe --url <주소>' 로 로그인하세요.");
  }

  const browser: Browser = await chromium.launch({ headless: true, timeout: 60_000 });
  const context: BrowserContext = await browser.newContext({
    baseURL: baseUrl,
    storageState: SESSION_FILE,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    extraHTTPHeaders: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "ko-KR,ko;q=0.9",
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  context.setDefaultTimeout(60_000);

  const page: Page = await context.newPage();
  await page.goto("/gw/app/approval", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3000);

  let refreshing: Promise<void> | null = null;

  return {
    api: context.request,
    async refresh() {
      if (refreshing) return refreshing;
      refreshing = (async () => {
        try {
          await page.goto("/gw/app/approval", { waitUntil: "domcontentloaded", timeout: 60_000 });
          await page.waitForTimeout(2500);
          await context.storageState({ path: SESSION_FILE });
        } catch {
          // 갱신 실패는 호출부에서 401 재발로 감지된다
        } finally {
          refreshing = null;
        }
      })();
      return refreshing;
    },
    async close() {
      await context.storageState({ path: SESSION_FILE }).catch(() => {});
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

/** @deprecated 파일 쿠키만 쓰는 방식 — 토큰 만료로 401 이 난다. openDaouApi 를 쓸 것. */
export async function createApiContext(baseUrl: string): Promise<APIRequestContext> {
  if (!hasSession()) {
    throw new Error("세션이 없습니다. 먼저 'npm run daou -- probe --url <주소>' 로 로그인하세요.");
  }
  return request.newContext({
    baseURL: baseUrl,
    storageState: SESSION_FILE,
    extraHTTPHeaders: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "ko-KR,ko;q=0.9",
      "X-Requested-With": "XMLHttpRequest",
    },
    timeout: 60_000,
  });
}

function buildListQuery(params: {
  startAt: string;
  endAt: string;
  page: number;
  offset: number;
}): string {
  const qs = new URLSearchParams();
  qs.set("startAt", params.startAt);
  qs.set("endAt", params.endAt);
  for (const key of ["drafterName", "drafterDeptName", "drafterCompanyName", "activityUserName", "docNum", "title"]) {
    qs.set(key, "");
  }
  for (const s of ALL_DOC_STATUS) qs.append("docStatus[]", s);
  for (const t of ALL_DOC_TYPE) qs.append("docType[]", t);
  qs.append("formId[]", "");
  qs.set("page", String(params.page));
  qs.set("offset", String(params.offset));
  return qs.toString();
}

export interface ListPageResult {
  page: number;
  total: number;
  totalPage: number;
  hasNext: boolean;
  items: DocListItem[];
}

/** 문서 목록 한 페이지 조회(page 는 0-based) */
export async function fetchListPage(
  api: APIRequestContext,
  params: { startAt: string; endAt: string; page: number; offset: number }
): Promise<ListPageResult> {
  const url = `/gw/api/approval/manage/document?${buildListQuery(params)}`;
  const res = await api.get(url);
  if (!res.ok()) {
    throw new Error(`목록 조회 실패 HTTP ${res.status()} (page=${params.page})`);
  }
  const json: any = await res.json();
  return {
    page: json.page?.page ?? params.page,
    total: json.page?.total ?? 0,
    totalPage: json.page?.totalPage ?? 0,
    hasNext: !!json.hasNext,
    items: json.data || [],
  };
}

/** 문서 상세(본문 HTML·첨부·의견 포함) */
export async function fetchDocDetail(api: APIRequestContext, docId: string): Promise<any> {
  const res = await api.get(`/gw/api/approval/manage/document/${docId}`);
  if (!res.ok()) {
    throw new Error(`상세 조회 실패 HTTP ${res.status()} (docId=${docId})`);
  }
  return res.json();
}

/** 결재 의견(상세에 비어 있는 경우 보조) */
export async function fetchDocComments(api: APIRequestContext, docId: string): Promise<any> {
  const res = await api.get(`/gw/api/approval/document/${docId}/comment`);
  if (!res.ok()) return null;
  return res.json();
}

/** 인쇄용 HTML — 결재 도장·결재선이 렌더된 보존용 원본 */
export async function fetchPrintHtml(api: APIRequestContext, docId: string): Promise<string | null> {
  const res = await api.get(`/gw/app/approval/document/${docId}/popup/print`);
  if (!res.ok()) return null;
  return res.text();
}

/** 양식 목록 */
export async function fetchForms(api: APIRequestContext): Promise<any[]> {
  const res = await api.get("/gw/api/approval/apprform/core/admin");
  if (!res.ok()) throw new Error(`양식 목록 조회 실패 HTTP ${res.status()}`);
  const json: any = await res.json();
  return json.data || [];
}
