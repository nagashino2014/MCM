/**
 * Auth.js (NextAuth v5) 전체 설정.
 * - Node runtime 전용. middleware.ts 는 edge-config.ts 를 사용.
 * - credentials provider 의 authorize 가 sql.js + bcrypt 로 DB 조회.
 */

import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { findUserByEmail, findUserById } from "./users";
import { verifyPassword } from "./password";
import { ensureAdminSeeded } from "./seed";
import type { Role, UserStatus } from "./users";
import { edgeAuthConfig } from "./edge-config";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      status: UserStatus;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
    status: UserStatus;
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
      authorize: async (credentials) => {
        try {
          await ensureAdminSeeded();
        } catch (err) {
          console.warn("[auth] seed 실패: " + (err as Error).message);
        }

        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        const user = await findUserByEmail(email);
        if (!user) return null;
        if (user.status !== "active") return null;

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.userId,
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status,
        };
      },
    }),
  ],
  callbacks: {
    ...edgeAuthConfig.callbacks,
    async jwt({ token, user, trigger }) {
      // edge config 에 정의된 user 매핑 그대로 호출
      if (user) {
        const u = user as { id?: string; role?: Role; status?: UserStatus };
        if (u.id) (token as Record<string, unknown>).userId = u.id;
        if (u.role) (token as Record<string, unknown>).role = u.role;
        if (u.status) (token as Record<string, unknown>).status = u.status;
      } else if (trigger === "update") {
        const userId = (token as Record<string, unknown>).userId as string | undefined;
        if (userId) {
          const fresh = await findUserById(userId);
          if (!fresh || fresh.status !== "active") {
            (token as Record<string, unknown>).status = "disabled";
          } else {
            (token as Record<string, unknown>).role = fresh.role;
            (token as Record<string, unknown>).status = fresh.status;
          }
        }
      }
      return token;
    },
  },
});
