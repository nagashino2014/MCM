/**
 * 인증된 API 호출 래퍼.
 * - 매 요청에 Authorization: Bearer <access> 를 붙인다.
 * - 401 이면 refresh 를 1회(싱글플라이트) 시도하고 재요청한다.
 * - refresh 가 **확정 만료(401/403)** 일 때만 토큰을 지우고 onUnauthorized(로그아웃)를 호출한다.
 *   5xx·네트워크 오류는 일시 장애로 보고 토큰을 유지한다 — Aurora resume 창(20~30초)의 503 을
 *   세션 만료로 오인해 멀쩡한 토큰을 폐기하던 문제(2026-08-17 실측).
 */
import { API_BASE_URL } from "./config";
import { getAccessToken, getRefreshToken, saveTokens, clearTokens } from "./tokens";

let onUnauthorized: (() => void) | null = null;

/** auth-context 가 로그아웃 처리를 등록한다(refresh 확정 만료 시 호출). */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

interface RefreshResult {
  token: string | null;
  /** true = 세션 확정 만료(토큰 폐기됨). false = 일시 장애(토큰 유지, 로그아웃 금지). */
  expired: boolean;
}

let refreshing: Promise<RefreshResult> | null = null;

async function doRefresh(): Promise<RefreshResult> {
  const refresh = await getRefreshToken();
  if (!refresh) return { token: null, expired: true }; // 토큰 자체가 없음 — guest 확정
  try {
    const res = await fetch(`${API_BASE_URL}/api/mobile/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (res.status === 401 || res.status === 403) {
      // 서버가 refresh 를 명시적으로 거부 — 진짜 만료/폐기.
      await clearTokens();
      return { token: null, expired: true };
    }
    if (!res.ok) {
      // 503(DB 웨이크업)·5xx 등 일시 장애 — 토큰을 지키고 다음 기회에 다시 시도한다.
      return { token: null, expired: false };
    }
    const d = (await res.json()) as { accessToken: string; refreshToken: string };
    await saveTokens(d.accessToken, d.refreshToken);
    return { token: d.accessToken, expired: false };
  } catch {
    // 네트워크 오류(오프라인·전파 불안정) — 로그아웃 사유가 아니다.
    return { token: null, expired: false };
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;

  const access = await getAccessToken();
  const headers = new Headers(init.headers);
  if (access) headers.set("Authorization", `Bearer ${access}`);

  let res = await fetch(url, { ...init, headers });
  if (res.status !== 401) return res;

  // access 만료 추정 → refresh 싱글플라이트(동시 401 은 한 번만 갱신)
  if (!refreshing) {
    refreshing = doRefresh().finally(() => {
      refreshing = null;
    });
  }
  const r = await refreshing;

  if (!r.token) {
    if (r.expired) onUnauthorized?.();
    return res; // 원래 401 그대로 반환
  }

  headers.set("Authorization", `Bearer ${r.token}`);
  res = await fetch(url, { ...init, headers });
  return res;
}

/** JSON 응답 헬퍼. 실패 시 throw. */
export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    throw new Error((body as { error?: string }).error ?? `요청 실패 (HTTP ${res.status})`);
  }
  return res.json() as Promise<T>;
}
