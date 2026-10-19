import { auth } from "@/lib/auth/config";
import { ensureAdminSeeded } from "@/lib/auth/seed";
import { permsOf } from "@/lib/auth/perms";
import { AppShell } from "@/components/layout/AppShell";
import { SessionProvider } from "@/components/auth/SessionProvider";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 첫 진입 시 admin 시드 (멱등). middleware가 인증을 보호하므로 여기는 보조 가드.
  try {
    await ensureAdminSeeded();
  } catch {
    // 부팅 시 환경변수 미설정 등은 무시
  }
  const session = await auth();
  // 메뉴 노출·버튼 게이트의 근거 = 세션에 실린 권한 요약(perms). role 은 더 이상 화면에 전달하지 않는다(role 일원화 WP5).
  const perms = permsOf(session?.user);

  return (
    <SessionProvider session={session}>
      <AppShell
        perms={perms}
        userName={session?.user?.name ?? null}
        userEmail={session?.user?.email ?? null}
      >
        {children}
      </AppShell>
    </SessionProvider>
  );
}
