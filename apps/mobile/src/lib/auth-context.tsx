/**
 * 인증 상태(토큰/사용자) 컨텍스트.
 * - 부팅 시 SecureStore 에 저장된 토큰 유무로 authed/guest 를 판정한다
 *   (토큰 유효성 실검증은 첫 API 호출/refresh 가 담당 — 낙관적).
 * - login/logout 을 제공하고, api.ts 의 refresh 실패 시 자동 로그아웃을 연결한다.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { API_BASE_URL } from "./config";
import { saveTokens, clearTokens, getAccessToken } from "./tokens";
import { setUnauthorizedHandler } from "./api";

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
  login: (identifier: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  const logout = useCallback(async () => {
    await clearTokens();
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

  // 부팅 시 저장된 토큰으로 초기 상태 결정
  useEffect(() => {
    (async () => {
      const token = await getAccessToken();
      setStatus(token ? "authed" : "guest");
    })();
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
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
