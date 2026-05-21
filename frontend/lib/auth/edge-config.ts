/**
 * Edge runtime 호환 Auth.js 설정.
 * - middleware 에서 import. node:crypto / node:fs / sql.js / bcrypt 같은 Node 전용 모듈 사용 금지.
 * - JWT 토큰 검증과 authorized 콜백만 담당.
 * - 실제 자격증명 검증(DB lookup, bcrypt)은 lib/auth/config.ts 의 `auth()` 가 담당.
 */

import type { NextAuthConfig } from "next-auth";

export type Role = "admin" | "editor" | "viewer";
export type UserStatus = "active" | "disabled";

export const edgeAuthConfig: NextAuthConfig = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as { id?: string; role?: Role; status?: UserStatus };
        if (u.id) (token as Record<string, unknown>).userId = u.id;
        if (u.role) (token as Record<string, unknown>).role = u.role;
        if (u.status) (token as Record<string, unknown>).status = u.status;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        const t = token as Record<string, unknown>;
        (session.user as { id?: string }).id = (t.userId as string) ?? "";
        (session.user as { role?: Role }).role = (t.role as Role) ?? "viewer";
        (session.user as { status?: UserStatus }).status =
          (t.status as UserStatus) ?? "active";
      }
      return session;
    },
    authorized({ auth: session, request: { nextUrl } }) {
      const path = nextUrl.pathname;

      if (
        path === "/login" ||
        path.startsWith("/api/auth/") ||
        path === "/api/health" ||
        path.startsWith("/_next/") ||
        path.startsWith("/static/")
      ) {
        return true;
      }

      if (!session?.user) return false;
      const user = session.user as { role?: Role; status?: UserStatus };
      if (user.status && user.status !== "active") return false;

      if (path.startsWith("/admin") || path.startsWith("/api/admin")) {
        return user.role === "admin";
      }

      return true;
    },
  },
};
