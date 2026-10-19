/**
 * Auth.js (NextAuth v5) 전체 설정.
 * - Node runtime 전용. middleware.ts 는 edge-config.ts 를 사용.
 * - credentials provider 의 authorize 가 sql.js + bcrypt 로 DB 조회.
 * - 로그인·세션 갱신(update()) 시 권한 요약(perms)을 토큰에 싣는다(role 일원화 WP5).
 */

import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { findUserById } from "./users";
import { verifyCredentials } from "./verify-credentials";
import type { Role, UserStatus } from "./users";
import { edgeAuthConfig } from "./edge-config";
import { loadPermissionSummary } from "./rbac";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      status: UserStatus;
      mustChangePassword: boolean;
      /** 권한 요약(lib/auth/perms.ts) — "key" 또는 "key@all". 메뉴·화면 게이트의 판정 근거. */
      perms: string[];
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
    status: UserStatus;
    mustChangePassword?: boolean;
    /** "로그인 유지" 체크 여부(G-L) — 미체크 세션은 12시간 후 만료. */
    rememberMe?: boolean;
  }
}

/** 미기억(로그인 유지 미체크) 세션의 수명 — 기존 전역 maxAge(12h)와 동일. */
const SHORT_SESSION_MS = 12 * 60 * 60 * 1000;

/** 권한 요약 로드 — 실패(DB 일시 장애)해도 로그인을 막지 않고 빈 요약으로 둔다(메뉴만 비고 API 는 DB 판정). */
async function safePermissionSummary(userId: string): Promise<string[]> {
  try {
    return await loadPermissionSummary(userId);
  } catch (err) {
    console.warn("[auth] 권한 요약 로드 실패: " + (err as Error).message);
    return [];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...edgeAuthConfig,
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
        remember: { label: "Remember", type: "text" },
      },
      authorize: async (credentials, request) => {
        // 웹/모바일 공유 검증 로직(verify-credentials.ts) — throttle·status·bcrypt 포함.
        const verified = await verifyCredentials(
          String(credentials?.email ?? ""),
          String(credentials?.password ?? ""),
          request as unknown as Request | undefined
        );
        if (!verified) return null;
        return {
          id: verified.id,
          email: verified.email,
          name: verified.name,
          role: verified.role,
          status: verified.status,
          mustChangePassword: verified.mustChangePassword,
          rememberMe: String(credentials?.remember ?? "") === "1",
        };
      },
    }),
  ],
  callbacks: {
    ...edgeAuthConfig.callbacks,
    async jwt({ token, user, trigger }) {
      // edge config 에 정의된 user 매핑 그대로 호출
      const t = token as Record<string, unknown>;
      if (user) {
        const u = user as { id?: string; role?: Role; status?: UserStatus; mustChangePassword?: boolean; rememberMe?: boolean };
        if (u.id) t.userId = u.id;
        if (u.role) t.role = u.role;
        if (u.status) t.status = u.status;
        t.mustChangePassword = u.mustChangePassword === true;
        // 자동 로그인(G-L): 체크 시 쿠키 maxAge(30일)까지 유지, 미체크 시 12시간 후 만료 처리.
        t.rememberMe = u.rememberMe === true;
        t.loginAt = Date.now();
        // 권한 요약 — 로그인 시점 스냅샷. 변경은 재로그인 또는 update() 로 반영(§6-6).
        if (u.id) t.perms = await safePermissionSummary(u.id);
      } else if (t.rememberMe !== true) {
        const loginAt = Number(t.loginAt ?? 0);
        if (!loginAt) {
          // 배포 전(G-L 이전) 발급 토큰 — 즉시 무효화하면 전 직원이 일제히 로그아웃되므로
          // 지금부터 12시간 카운트로 1회 마이그레이션(유예).
          t.loginAt = Date.now();
        } else if (Date.now() - loginAt > SHORT_SESSION_MS) {
          return null; // 세션 무효화(로그아웃)
        }
      }
      if (!user && trigger === "update") {
        const userId = (token as Record<string, unknown>).userId as string | undefined;
        if (userId) {
          const fresh = await findUserById(userId);
          if (!fresh || fresh.status !== "active") {
            (token as Record<string, unknown>).status = "disabled";
          } else {
            (token as Record<string, unknown>).role = fresh.role;
            (token as Record<string, unknown>).status = fresh.status;
            (token as Record<string, unknown>).mustChangePassword = fresh.mustChangePassword;
            (token as Record<string, unknown>).perms = await safePermissionSummary(userId);
          }
        }
      }
      if (!user && trigger !== "update" && !Array.isArray(t.perms) && typeof t.userId === "string") {
        // 배포 전(권한 요약 도입 이전) 발급 토큰 — 1회 보강. 서버 컴포넌트 경로에서는 쿠키가 다시 쓰이지
        // 않을 수 있어 재로그인 전까지 요청마다 반복될 수 있다(requirePermission 과 같은 비용 수준).
        t.perms = await safePermissionSummary(t.userId);
      }
      return token;
    },
  },
});
