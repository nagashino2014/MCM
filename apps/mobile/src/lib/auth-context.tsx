/**
 * 인증 상태(토큰/사용자) 컨텍스트.
 * - 부팅 시 토큰이 있으면 `/api/mobile/auth/me` 로 **사용자 정보를 복원**한다.
 *   토큰만으로 authed 로 넘기면 앱을 재시작할 때마다 이름·권한이 비어 "사용자"로 보인다(실측 버그).
 * - 네트워크가 없을 땐 마지막으로 저장해 둔 사용자로 화면을 채운다(오프라인 표시용).
 * - login/logout 을 제공하고, api.ts 의 refresh 실패 시 자동 로그아웃을 연결한다.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { API_BASE_URL } from "./config";
import { saveTokens, clearTokens, getAccessToken } from "./tokens";
import { apiJson, setUnauthorizedHandler } from "./api";
import { kvClearUserData, kvGet, kvSet } from "./kv";
import { unregisterPush } from "./push";

const USER_KEY = "auth.user";
/** 자동 로그인 여부(기본 ON) — OFF 면 앱을 다시 켤 때 저장된 토큰을 버리고 로그인 화면으로 간다. */
const AUTO_LOGIN_KEY = "auth.autoLogin";
/** 마지막 로그인 아이디 — 로그인 화면 프리필(비밀번호는 저장하지 않는다). */
const LAST_ID_KEY = "auth.lastIdentifier";

export async function getAutoLogin(): Promise<boolean> {
  const v = await kvGet<boolean>(AUTO_LOGIN_KEY);
  return v?.value !== false; // 미설정 = ON
}
export async function setAutoLogin(on: boolean): Promise<void> {
  await kvSet(AUTO_LOGIN_KEY, on);
}
export async function getLastIdentifier(): Promise<string> {
  const v = await kvGet<string>(LAST_ID_KEY);
  return v?.value ?? "";
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "editor" | "viewer";
  mustChangePassword: boolean;
}

type Status = "loading" | "authed" | "guest";

interface AuthState {
  status: Status;
  user: AuthUser | null;
  login: (
    identifier: string,
    password: string,
    opts?: { autoLogin?: boolean }
  ) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  const logout = useCallback(async () => {
    // 토큰이 아직 유효할 때 이 기기의 푸시 수신을 먼저 끊는다(로그아웃 후엔 API 호출 불가).
    await unregisterPush();
    await clearTokens();
    // 캐시된 업무 데이터(결재·메일 목록 등)가 다음 로그인 사용자에게 보이지 않게 비운다.
    await kvClearUserData();
    setUser(null);
    setStatus("guest");
  }, []);

  // refresh 실패(세션 만료) → 자동 로그아웃
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void logout();
    });
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // 부팅 — 토큰이 있으면 사용자 정보까지 복원한다.
  useEffect(() => {
    (async () => {
      const token = await getAccessToken();
      if (!token) {
        setStatus("guest");
        return;
      }
      // 자동 로그인 OFF: 저장된 토큰이 있어도 쓰지 않고 로그인 화면으로 보낸다.
      if (!(await getAutoLogin())) {
        await clearTokens();
        setStatus("guest");
        return;
      }
      // ① 저장해 둔 사용자로 먼저 화면을 채운다(네트워크가 느리거나 없어도 이름이 보이게).
      const cached = await kvGet<AuthUser>(USER_KEY);
      if (cached?.value) setUser(cached.value);
      setStatus("authed");

      // ② 서버에서 최신 정보로 덮어쓴다. 401 이면 apiFetch 가 refresh 를 시도하고,
      //    그마저 실패하면 onUnauthorized(=logout)가 걸린다.
      try {
        const d = await apiJson<{ user: AuthUser }>("/api/mobile/auth/me");
        setUser(d.user);
        void kvSet(USER_KEY, d.user);
      } catch {
        // 네트워크 오류면 캐시된 사용자로 계속 진행한다(로그아웃시키지 않는다).
      }
    })();
  }, []);

  const login = useCallback(async (identifier: string, password: string, opts?: { autoLogin?: boolean }) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/mobile/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: d.error ?? "로그인에 실패했습니다." };
      }
      const d = (await res.json()) as {
        accessToken: string;
        refreshToken: string;
        user: AuthUser;
      };
      await saveTokens(d.accessToken, d.refreshToken);
      setUser(d.user);
      void kvSet(USER_KEY, d.user);
      void kvSet(AUTO_LOGIN_KEY, opts?.autoLogin !== false);
      void kvSet(LAST_ID_KEY, identifier);
      setStatus("authed");
      return { ok: true };
    } catch {
      return { ok: false, error: "네트워크 오류가 발생했습니다." };
    }
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
