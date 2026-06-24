/**
 * Auth.js (NextAuth v5) 전체 설정.
 * - Node runtime 전용. middleware.ts 는 edge-config.ts 를 사용.
 * - credentials provider 의 authorize 가 sql.js + bcrypt 로 DB 조회.
 */

import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { findUserByLoginIdentifier, findUserById } from "./users";
import { verifyPassword } from "./password";
import { ensureAdminSeeded } from "./seed";
import { clientIpFrom, isLoginBlocked, recordLoginFailure, clearLoginFailures } from "./login-throttle";
import type { Role, UserStatus } from "./users";
import { edgeAuthConfig } from "./edge-config";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      status: UserStatus;
      mustChangePassword: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
    status: UserStatus;
    mustChangePassword?: boolean;
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
      },
      authorize: async (credentials, request) => {
        try {
          await ensureAdminSeeded();
        } catch (err) {
          console.warn("[auth] seed 실패: " + (err as Error).message);
        }

        // credentials.email 필드는 "로그인 식별자"(사번 또는 이메일 로컬파트)를 담는다.
        const identifier = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!identifier || !password) return null;

        // 무차별 대입 방어: 윈도 내 실패 임계 초과 시 자격 검증 없이 거부.
        const ip = clientIpFrom(request);
        if (await isLoginBlocked(identifier, ip)) {
          console.warn(`[auth] 로그인 차단(과도한 실패): id=${identifier} ip=${ip}`);
          return null;
        }

        const user = await findUserByLoginIdentifier(identifier);
        if (!user) {
          await recordLoginFailure(identifier, ip);
          return null;
        }
        if (user.status !== "active") {
          await recordLoginFailure(identifier, ip);
          return null;
        }

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) {
          await recordLoginFailure(identifier, ip);
          return null;
        }

        await clearLoginFailures(identifier);
        return {
          id: user.userId,
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],
  callbacks: {
    ...edgeAuthConfig.callbacks,
    async jwt({ token, user, trigger }) {
      // edge config 에 정의된 user 매핑 그대로 호출
      if (user) {
        const u = user as { id?: string; role?: Role; status?: UserStatus; mustChangePassword?: boolean };
        if (u.id) (token as Record<string, unknown>).userId = u.id;
        if (u.role) (token as Record<string, unknown>).role = u.role;
        if (u.status) (token as Record<string, unknown>).status = u.status;
        (token as Record<string, unknown>).mustChangePassword = u.mustChangePassword === true;
      } else if (trigger === "update") {
        const userId = (token as Record<string, unknown>).userId as string | undefined;
        if (userId) {
          const fresh = await findUserById(userId);
          if (!fresh || fresh.status !== "active") {
            (token as Record<string, unknown>).status = "disabled";
          } else {
            (token as Record<string, unknown>).role = fresh.role;
            (token as Record<string, unknown>).status = fresh.status;
            (token as Record<string, unknown>).mustChangePassword = fresh.mustChangePassword;
          }
        }
      }
      return token;
    },
  },
});
