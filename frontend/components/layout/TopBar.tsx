"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Bell, ChevronDown, LogOut, Moon, Sun, User, Workflow } from "lucide-react";
import { MENU_ITEMS, isMenuVisibleForRole, type Role } from "@/config/menu";
import type { CdTheme } from "@/components/cdash/useCdashTheme";
import { cn } from "@/lib/utils";

interface TopBarProps {
  userName: string | null;
  userEmail: string | null;
  role: Role;
  theme: CdTheme;
  onToggleTheme: () => void;
}

const ROLE_LABEL: Record<Role, string> = {
  admin: "관리자",
  editor: "편집자",
  viewer: "조회자",
};

export function TopBar({ userName, userEmail, role, theme, onToggleTheme }: TopBarProps) {
  const pathname = usePathname();
  const [hoveredMenu, setHoveredMenu] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const visibleMenu = MENU_ITEMS.filter((m) => isMenuVisibleForRole(m, role));
  const mainMenu = visibleMenu.filter((m) => (m.group ?? "main") === "main");

  return (
    <header
      className="h-16 rounded-2xl flex items-center justify-between px-6 sticky top-0 z-50 mb-4 shrink-0 border cd-border-c"
      style={{ background: "var(--cd-card)", boxShadow: "var(--cd-shadow)" }}
    >
      <Link href="/data/status" className="flex items-center gap-2 shrink-0">
        <Workflow className="w-7 h-7 text-[color:var(--cd-primary)]" />
        <span className="text-xl font-extrabold cd-text">
          Permit<span className="text-[color:var(--cd-primary)]">IQ</span>
        </span>
      </Link>

      <nav className="hidden xl:flex flex-1 justify-center h-full">
        <ul className="flex items-center gap-1 h-full">
          {mainMenu.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              pathname?.startsWith(item.href + "/") ||
              !!item.submenu?.some(
                (s) => pathname === s.href || pathname?.startsWith(s.href + "/")
              );
            const hasSubmenu = !!item.submenu && item.submenu.length > 0;

            return (
              <li
                key={item.title}
                className="relative h-full flex items-center"
                onMouseEnter={() => setHoveredMenu(item.title)}
                onMouseLeave={() => setHoveredMenu(null)}
              >
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-1.5 text-sm font-bold transition-colors px-4 py-2 rounded-xl",
                    isActive
                      ? "cd-soft-primary"
                      : "cd-text-muted hover:text-[color:var(--cd-text)] cd-row-hover"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.title}
                  {hasSubmenu && <ChevronDown className="w-3 h-3 opacity-40" />}
                </Link>

                {hasSubmenu && hoveredMenu === item.title && (
                  <div className="absolute top-[calc(100%-10px)] left-1/2 -translate-x-1/2 pt-4 w-48 z-50">
                    <div
                      className="rounded-xl overflow-hidden py-1.5 flex flex-col gap-0.5 border cd-border-c"
                      style={{ background: "var(--cd-card)", boxShadow: "var(--cd-shadow)" }}
                    >
                      {item.submenu!.map((sub) => (
                        <Link
                          key={sub.title}
                          href={sub.href}
                          className={cn(
                            "block px-4 py-2.5 text-sm font-medium transition-colors",
                            pathname === sub.href
                              ? "cd-soft-primary font-bold"
                              : "cd-text-muted hover:text-[color:var(--cd-text)] cd-row-hover"
                          )}
                        >
                          {sub.title}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex items-center gap-2 shrink-0 relative">
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
          className="p-2.5 rounded-xl cd-text-muted hover:bg-[var(--cd-primary-soft)] hover:text-[color:var(--cd-primary)] transition-colors"
        >
          {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
        <button
          type="button"
          className="relative p-2.5 rounded-xl cd-text-muted hover:bg-[var(--cd-primary-soft)] hover:text-[color:var(--cd-primary)] transition-colors"
        >
          <Bell className="w-5 h-5" />
          <span
            className="absolute top-2 right-2 w-2 h-2 rounded-full"
            style={{ background: "var(--cd-error)", border: "2px solid var(--cd-card)" }}
          />
        </button>
        <button
          type="button"
          onClick={() => setUserMenuOpen((v) => !v)}
          className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full cd-row-hover border border-transparent transition-all"
        >
          <div className="w-9 h-9 rounded-full flex items-center justify-center cd-surface-bg cd-text-muted border cd-border-c">
            <User className="w-5 h-5" />
          </div>
          <div className="flex-col items-start hidden sm:flex">
            <span className="text-sm font-bold cd-text leading-none">
              {userName || "사용자"}
            </span>
            <span className="text-[10px] cd-text-faint font-medium">
              {ROLE_LABEL[role]}
            </span>
          </div>
        </button>

        {userMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setUserMenuOpen(false)}
            />
            <div
              className="absolute top-[calc(100%+8px)] right-0 w-64 z-50 rounded-2xl overflow-hidden border cd-border-c"
              style={{ background: "var(--cd-card)", boxShadow: "var(--cd-shadow)" }}
            >
              <div className="px-4 py-3 border-b cd-border-c">
                <div className="text-sm font-bold cd-text truncate">
                  {userName || "사용자"}
                </div>
                <div className="text-xs cd-text-muted truncate">{userEmail}</div>
                <div className="mt-1 inline-block text-[10px] font-bold uppercase tracking-wide cd-soft-primary px-2 py-0.5 rounded">
                  {ROLE_LABEL[role]}
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  // ALB(프록시) 뒤에서 next-auth 가 host 를 localhost:3000 으로 잡아 절대 URL 로
                  // 리다이렉트하는 문제 회피: redirect:false 후 동일 출처 상대경로로 직접 이동.
                  await signOut({ redirect: false });
                  window.location.href = "/login";
                }}
                className="w-full px-4 py-3 text-sm font-bold cd-text cd-row-hover flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                로그아웃
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
