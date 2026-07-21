/**
 * Auth.js (NextAuth v5) 전체 설정.
 * - Node runtime 전용. middleware.ts 는 edge-config.ts 를 사용.
 * - credentials provider 의 authorize 가 sql.js + bcrypt 로 DB 조회.
 */

import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { findUserById } from "./users";
import { verifyCredentials } from "./verify-credentials";
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
