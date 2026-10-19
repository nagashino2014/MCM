// 권한 없음 안내 페이지(role 일원화 WP5).
// 미들웨어(lib/auth/edge-config.ts)가 메뉴 권한키 표(config/menu-permissions.ts)로 JWT 권한 요약을 판정해
// 미보유 경로를 이 페이지로 rewrite 한다(주소창 경로는 유지). 직접 열면 요청 경로 없이 안내만 보인다.

import { AccessDenied } from "@/components/auth/AccessDenied";

export const dynamic = "force-dynamic";

export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; keys?: string }>;
}) {
  const sp = await searchParams;
  const keys = (sp.keys ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  const from = sp.from && sp.from.startsWith("/") ? sp.from : null;
  return <AccessDenied requiredKeys={keys} path={from} />;
}
