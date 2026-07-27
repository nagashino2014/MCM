"use client";

// Modernize(cdash) 전역 셸(G1) — 사이드바(반응형 레일) + 탑바(글로벌 액션) + 본문.
// 반응형(§3.0 FHD-first): ≥2xl 사이드바 확장 / lg~2xl 아이콘 레일 / <lg 드로어(햄버거).
// 본문은 초광폭(울트라와이드)에서 무한정 뻗지 않게 max-w 중앙 정렬(§3.0).
// CdToastProvider 전역 래핑. 뱃지는 여기서 1회 폴링해 사이드바/드로어에 공유.

import { useState } from "react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdToastProvider } from "@/components/cdash/CdToast";
import { CdDrawer } from "@/components/cdash/CdModal";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { useNavBadges } from "@/components/layout/useNavBadges";
import type { Role } from "@/config/menu";
import "@/components/cdash/cdash.css";

interface AppShellProps {
  role: Role;
  userName: string | null;
  userEmail: string | null;
  children: React.ReactNode;
}

export function AppShell({ role, userName, userEmail, children }: AppShellProps) {
  const { theme, toggleTheme } = useCdashTheme();
  const badges = useNavBadges();
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);

  return (
    <CdToastProvider>
      <div className="cdash cd-fields-white flex h-screen p-3 2xl:p-4 gap-3 2xl:gap-4" data-theme={theme}>
        <Sidebar role={role} badges={badges} />
        <div className="flex-1 flex flex-col min-w-0 min-h-0 gap-3 2xl:gap-4">
          <TopBar
            userName={userName}
            userEmail={userEmail}
            role={role}
            theme={theme}
            onToggleTheme={toggleTheme}
            onOpenNav={() => setNavDrawerOpen(true)}
          />
          <main className="flex-1 min-h-0 relative rounded-3xl overflow-y-auto">
            {/* 울트라와이드 확장 취급: 본문 최대폭 + 중앙 정렬(§3.0). FHD 이하에서는 영향 없음. */}
            <div className="mx-auto w-full max-w-[1760px] h-full min-h-0">{children}</div>
          </main>
        </div>
      </div>

      {/* <lg 네비 드로어 — 네비 소실 방지(§3.0) */}
      <CdDrawer open={navDrawerOpen} onClose={() => setNavDrawerOpen(false)} side="left" widthClass="max-w-[19rem]">
        <div className="-mx-5 -my-4 h-[calc(100%+2rem)]">
          <Sidebar role={role} badges={badges} mode="drawer" onNavigate={() => setNavDrawerOpen(false)} />
        </div>
      </CdDrawer>
    </CdToastProvider>
  );
}
