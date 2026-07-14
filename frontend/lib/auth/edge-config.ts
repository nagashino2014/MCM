/**
 * Edge runtime 호환 Auth.js 설정.
 * - middleware 에서 import. node:crypto / node:fs / sql.js / bcrypt 같은 Node 전용 모듈 사용 금지.
 * - JWT 토큰 검증과 authorized 콜백만 담당.
 * - 실제 자격증명 검증(DB lookup, bcrypt)은 lib/auth/config.ts 의 `auth()` 가 담당.
 */

import type { NextAuthConfig } from "next-auth";
import { NextResponse } from "next/server";

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
        const u = user as { id?: string; role?: Role; status?: UserStatus; mustChangePassword?: boolean };
        if (u.id) (token as Record<string, unknown>).userId = u.id;
        if (u.role) (token as Record<string, unknown>).role = u.role;
        if (u.status) (token as Record<string, unknown>).status = u.status;
        (token as Record<string, unknown>).mustChangePassword = u.mustChangePassword === true;
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
        (session.user as { mustChangePassword?: boolean }).mustChangePassword =
          t.mustChangePassword === true;
      }
      return session;
    },
    authorized({ auth: session, request }) {
      const { nextUrl } = request;
      const path = nextUrl.pathname;

      if (
        path === "/login" ||
        path.startsWith("/api/auth/") ||
        path === "/api/health" ||
        path === "/manifest.webmanifest" || // PWA manifest 는 설치 시 비인증 fetch
        path.startsWith("/_next/") ||
        path.startsWith("/static/")
      ) {
        return true;
      }

      if (!session?.user) return false;
      const user = session.user as { role?: Role; status?: UserStatus; mustChangePassword?: boolean };
      if (user.status && user.status !== "active") return false;

      // 초기 비밀번호 강제 변경: 변경 전까지 변경 화면/그 API 외 모든 경로를 변경 화면으로 보낸다.
      const onChangeFlow =
        path === "/account/change-password" || path === "/api/account/change-password";
      if (user.mustChangePassword && !onChangeFlow) {
        return NextResponse.redirect(new URL("/account/change-password", nextUrl));
      }

      // 모바일 UA 가 루트로 진입하면 모바일 전용 화면(/m)으로.
      // "데스크톱 버전으로 보기"가 심는 mcm-prefer-desktop 쿠키가 있으면 미적용.
      if (path === "/") {
        const ua = request.headers.get("user-agent") ?? "";
        const preferDesktop = request.cookies.get("mcm-prefer-desktop")?.value === "1";
        if (/iPhone|iPod|Android.*Mobile/i.test(ua) && !preferDesktop) {
          return NextResponse.redirect(new URL("/m", nextUrl));
        }
      }

      if (path.startsWith("/admin") || path.startsWith("/api/admin")) {
        return user.role === "admin";
      }

      return true;
    },
  },
};
