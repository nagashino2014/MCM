import { auth } from "@/lib/auth/config";
import { ensureAdminSeeded } from "@/lib/auth/seed";
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
  const role = (session?.user as { role?: "admin" | "editor" | "viewer" } | undefined)?.role ?? "viewer";

  return (
    <SessionProvider session={session}>
      <AppShell
        role={role}
        userName={session?.user?.name ?? null}
        userEmail={session?.user?.email ?? null}
      >
        {children}
      </AppShell>
    </SessionProvider>
  );
}
