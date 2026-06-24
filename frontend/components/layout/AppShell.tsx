"use client";

import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import type { Role } from "@/config/menu";
import "@/components/cdash/cdash.css";

interface AppShellProps {
  role: Role;
  userName: string | null;
  userEmail: string | null;
  children: React.ReactNode;
}

/**
 * Modernize(cdash) 전역 셸 — 사이드바 + 탑바 + 본문 프레임.
 * 루트에 `.cdash` 를 두어 페이지 사이 여백 배경/토큰까지 라이트·다크로 동작하게 하고,
 * 테마는 useCdashTheme(localStorage `cdash-theme`) 로 각 페이지와 공유한다.
 */
export function AppShell({ role, userName, userEmail, children }: AppShellProps) {
  const { theme, toggleTheme } = useCdashTheme();

  return (
    <div
      className="cdash cd-fields-white flex h-screen p-4 gap-4"
      data-theme={theme}
    >
      <Sidebar role={role} />
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <TopBar
          userName={userName}
          userEmail={userEmail}
          role={role}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <main className="flex-1 mt-4 min-h-0 relative rounded-3xl overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
