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
  // maxAge = "로그인 유지" 체크 시 상한(30일). 미체크 세션은 config.ts jwt 콜백이 12시간에 강제 만료(G-L).
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
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
        path.startsWith("/login/") || // 아이디/비밀번호 찾기·재설정(G-L)
        path.startsWith("/api/auth/") ||
        path.startsWith("/api/mobile/auth/") || // 모바일 로그인/refresh — 세션 없이 접근
        path === "/api/mail/track" || // 수신 확인 픽셀(G2-10) — 외부 수신자가 호출
        path === "/api/health" ||
        path === "/manifest.webmanifest" || // PWA manifest 는 설치 시 비인증 fetch
        path === "/m-app" ||
        path.startsWith("/m-app/") || // 모바일 앱 웹 데모(Expo 정적 번들) — 정적 파일만 공개, 데이터는 API 인증이 가드
        path === "/m-demo.html" || // 폰 프레임 시연 래퍼 페이지
        path.startsWith("/m-demo-video/") || // 시연 래퍼가 재생하는 촬영 시연 영상(명함·영수증)
        path === "/privacy.html" || // 개인정보처리방침 — 스토어 심사·직원이 비인증 열람
        path.startsWith("/_next/") ||
        path.startsWith("/static/")
      ) {
        return true;
      }

      // 모바일 네이티브 앱: Authorization: Bearer <accessToken> 요청.
      // 실제 토큰 검증은 각 API 라우트의 requireSession(Node) 이 수행한다.
      // edge 미들웨어는 토큰 존재만 확인해 통과시키고(쿠키 세션이 없어 아래서 막히지 않도록),
      // 무효/만료 토큰은 라우트가 401 로 처리한다. (page 리다이렉트 로직과 무관한 API 전용)
      const authz = request.headers.get("authorization");
      if (authz && authz.toLowerCase().startsWith("bearer ")) {
        return true;
      }

      // 세션 만료 시 API 요청은 401 JSON 으로 응답한다. false(로그인 307 리다이렉트)를 그대로 두면
      // 업로드 같은 multipart POST 가 /login 페이지로 재전송되어 "Failed to find Server Action"
      // 텍스트가 내려오고, 클라이언트 fetch 의 res.json() 이 "is not valid JSON" 으로 깨진다.
      // 401 JSON 이면 각 화면의 기존 오류 처리(alert(data.error))가 만료 안내를 그대로 보여준다.
      const sessionExpired = () =>
        path.startsWith("/api/")
          ? NextResponse.json(
              { error: "로그인이 만료되었습니다. 페이지를 새로고침해 다시 로그인해 주세요." },
              { status: 401 }
            )
          : false;
      if (!session?.user) return sessionExpired();
      const user = session.user as { role?: Role; status?: UserStatus; mustChangePassword?: boolean };
      if (user.status && user.status !== "active") return sessionExpired();

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

      // ⚠ 미들웨어는 edge runtime 이라 DB(권한 템플릿)를 조회할 수 없다.
      //   여기서는 JWT 의 role 로 1차 차단만 하고, 실제 권한 판정은 각 API 라우트의
      //   requirePermission(account.manage / org.edit / rbac.* 등)이 한다.
      //   role 을 완전히 걷어내려면 로그인 시 권한 요약을 JWT 에 실어야 한다(후속 과제).
      if (path.startsWith("/admin") || path.startsWith("/api/admin")) {
        return user.role === "admin";
      }

      return true;
    },
  },
};
