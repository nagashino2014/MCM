import NextAuth from "next-auth";
import { edgeAuthConfig } from "@/lib/auth/edge-config";

/**
 * Next.js 미들웨어 — Edge runtime.
 * - lib/auth/edge-config.ts 만 import 해야 한다 (node:fs/sql.js/bcrypt 사용 금지).
 * - authorized 콜백이 라우팅 가드 본체.
 */
const { auth } = NextAuth(edgeAuthConfig);

export default auth;

export const config = {
  matcher: [
    // /geo/* 정적 토포 JSON (라운드 2B 지도) 은 인증 없이 공개
    "/((?!_next/static|_next/image|favicon.ico|geo/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
