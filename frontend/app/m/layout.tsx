import type { Metadata, Viewport } from "next";
import { auth } from "@/lib/auth/config";
import { SessionProvider } from "@/components/auth/SessionProvider";
import { MobileShell } from "@/components/mobile/MobileShell";

// 모바일 전용 레이아웃(/m/*) — AppShell 대신 MobileShell(하단 탭바) 사용.
// 인증은 middleware가 보호하고, 데이터 접근 권한은 각 API 라우트의 RBAC 가드가 담당.

export const metadata: Metadata = {
  title: "MCM 모바일",
  icons: { apple: "/icons/mcm-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#5d87ff",
};

export default async function MobileLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <SessionProvider session={session}>
      <MobileShell userName={session?.user?.name ?? null}>{children}</MobileShell>
    </SessionProvider>
  );
}
