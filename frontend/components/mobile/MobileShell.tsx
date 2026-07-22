"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, CalendarDays, ClipboardCheck, Factory, Users, Sun, Moon, Monitor } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import "@/components/cdash/cdash.css";

// 모바일 전용 셸(/m/*) — 상단 미니 헤더 + 하단 고정 탭바. AppShell(사이드바·탑바) 미사용.
// max-width 480px 중앙 정렬이라 데스크톱 브라우저에서도 같은 레이아웃으로 확인 가능.

const TABS = [
  { href: "/m", label: "홈", icon: Home },
  { href: "/m/schedule", label: "일정", icon: CalendarDays },
  { href: "/m/approval", label: "결재", icon: ClipboardCheck },
  { href: "/m/facilities", label: "사업장", icon: Factory },
  { href: "/m/contacts", label: "담당자", icon: Users },
];

const TITLE_BY_PATH: Record<string, string> = {
  "/m": "홈",
  "/m/schedule": "영업 일정",
  "/m/approval": "결재함",
  "/m/facilities": "사업장",
  "/m/contacts": "담당자",
  "/m/card": "명함 촬영",
};

function preferDesktop() {
  // 데스크톱 버전으로 탈출 — middleware UA 리다이렉트를 쿠키로 끈다(30일).
  document.cookie = "mcm-prefer-desktop=1; path=/; max-age=2592000";
  window.location.href = "/";
}

export function MobileShell({ userName, children }: { userName: string | null; children: React.ReactNode }) {
  const { theme, toggleTheme } = useCdashTheme();
  const pathname = usePathname();
  const title = TITLE_BY_PATH[pathname] ?? "MCM";

  return (
    <div className="cdash cd-fields-white min-h-dvh" data-theme={theme}>
      <div className="mx-auto flex flex-col min-h-dvh" style={{ maxWidth: 480 }}>
        {/* 상단 미니 헤더 */}
        <header
          className="cd-card-bg border-b cd-border-c sticky top-0 z-20 flex items-center justify-between px-4"
          style={{ height: 52 }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="cd-fill-primary rounded-lg flex items-center justify-center shrink-0" style={{ width: 26, height: 26 }}>
              <span className="text-white text-[11px] font-extrabold">M</span>
            </span>
            <h1 className="cd-text text-base font-extrabold truncate">{title}</h1>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {userName && <span className="cd-text-faint text-xs mr-1">{userName}</span>}
            <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={toggleTheme} aria-label="테마 전환">
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* 본문 — 하단 탭바 높이만큼 여백 확보 */}
        <main className="flex-1 min-h-0 px-3 pt-3" style={{ paddingBottom: "calc(76px + env(safe-area-inset-bottom))" }}>
          {children}
          <div className="text-center mt-6 mb-2">
            <button className="cd-text-faint text-xs inline-flex items-center gap-1" onClick={preferDesktop}>
              <Monitor className="w-3.5 h-3.5" /> 데스크톱 버전으로 보기
            </button>
          </div>
        </main>

        {/* 하단 고정 탭바 */}
        <nav
          className="cd-card-bg border-t cd-border-c fixed bottom-0 inset-x-0 z-20"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="mx-auto grid grid-cols-4" style={{ maxWidth: 480 }}>
            {TABS.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href !== "/m" && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  className="flex flex-col items-center justify-center gap-0.5 py-2"
                  style={{ minHeight: 56, color: active ? "var(--cd-primary)" : "var(--cd-faint)" }}
                >
                  <Icon className="w-5 h-5" strokeWidth={active ? 2.4 : 2} />
                  <span className="text-[11px]" style={{ fontWeight: active ? 700 : 500 }}>{label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
