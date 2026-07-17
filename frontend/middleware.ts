import NextAuth from "next-auth";
import { edgeAuthConfig } from "@/lib/auth/edge-config";

/**
 * Next.js 미들웨어 — Edge runtime.
 * - lib/auth/edge-config.ts 만 import 해야 한다 (node:fs/sql.js/bcrypt 사용 금지).
 * - authorized 콜백이 라우팅 가드 본체 (모바일 UA → /m 리다이렉트 포함).
 * ⚠ `auth(콜백)` 래핑 형태로 바꾸지 말 것 — 콜백이 undefined 를 반환하면 authorized
 *   결과가 적용되지 않아 인증 가드 전체가 무력화된다(2026-07-14 실측).
 */
const { auth } = NextAuth(edgeAuthConfig);

export default auth;

export const config = {
  matcher: [
    // /geo/* 정적 토포 JSON (라운드 2B 지도) 은 인증 없이 공개.
    // /api/internal/* 은 서버 자기호출 크론 틱 — 세션 없이 호출되며 라우트가 AUTH_SECRET 헤더로 자체 가드.
    "/((?!_next/static|_next/image|favicon.ico|geo/|api/internal/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
