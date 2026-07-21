/**
 * 인증된 API 호출 래퍼.
 * - 매 요청에 Authorization: Bearer <access> 를 붙인다.
 * - 401 이면 refresh 를 1회(싱글플라이트) 시도하고 재요청한다.
 * - refresh 도 실패하면 토큰을 지우고 onUnauthorized 핸들러(로그아웃)를 호출한다.
 */
import { API_BASE_URL } from "./config";
import { getAccessToken, getRefreshToken, saveTokens, clearTokens } from "./tokens";

let onUnauthorized: (() => void) | null = null;

/** auth-context 가 로그아웃 처리를 등록한다(refresh 실패 시 호출). */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

let refreshing: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const refresh = await getRefreshToken();
  if (!refresh) return null;
  try {
    const res = await fetch(`${API_BASE_URL}/api/mobile/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (!res.ok) {
      await clearTokens();
      return null;
    }
    const d = (await res.json()) as { accessToken: string; refreshToken: string };
    await saveTokens(d.accessToken, d.refreshToken);
    return d.accessToken;
  } catch {
    return null;
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
  const newAccess = await refreshing;

  if (!newAccess) {
    onUnauthorized?.();
    return res; // 원래 401 그대로 반환
  }

  headers.set("Authorization", `Bearer ${newAccess}`);
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
