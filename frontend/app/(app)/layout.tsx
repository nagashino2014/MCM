import { auth } from "@/lib/auth/config";
import { ensureAdminSeeded } from "@/lib/auth/seed";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
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
      <div className="flex h-screen bg-[#F2F4F7] p-4 gap-4">
        <Sidebar role={role} />
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <TopBar
            userName={session?.user?.name ?? null}
            userEmail={session?.user?.email ?? null}
            role={role}
          />
          <main className="flex-1 mt-4 min-h-0 relative rounded-3xl overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </SessionProvider>
  );
}
