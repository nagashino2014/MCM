"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Bell, ChevronDown, LogOut, User, Workflow } from "lucide-react";
import { MENU_ITEMS, isMenuVisibleForRole, type Role } from "@/config/menu";
import { cn } from "@/lib/utils";

interface TopBarProps {
  userName: string | null;
  userEmail: string | null;
  role: Role;
}

const ROLE_LABEL: Record<Role, string> = {
  admin: "관리자",
  editor: "편집자",
  viewer: "조회자",
};

export function TopBar({ userName, userEmail, role }: TopBarProps) {
  const pathname = usePathname();
  const [hoveredMenu, setHoveredMenu] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const visibleMenu = MENU_ITEMS.filter((m) => isMenuVisibleForRole(m, role));
  const mainMenu = visibleMenu.filter((m) => (m.group ?? "main") === "main");

  return (
    <header className="h-16 glass-panel rounded-2xl flex items-center justify-between px-6 sticky top-0 z-50 mb-4 shrink-0">
      <Link href="/data/status" className="flex items-center gap-2 shrink-0">
        <Workflow className="w-7 h-7 text-primary" />
        <span className="text-xl font-extrabold text-stone-800">
          Permit<span className="text-primary">IQ</span>
        </span>
      </Link>

      <nav className="hidden xl:flex flex-1 justify-center h-full">
        <ul className="flex items-center gap-2 h-full">
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
                      ? "text-primary bg-primary/10"
                      : "text-stone-600 hover:text-stone-900 hover:bg-stone-100/60"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.title}
                  {hasSubmenu && <ChevronDown className="w-3 h-3 opacity-40" />}
                </Link>

                {hasSubmenu && hoveredMenu === item.title && (
                  <div className="absolute top-[calc(100%-10px)] left-1/2 -translate-x-1/2 pt-4 w-48 z-50">
                    <div className="glass-panel rounded-xl shadow-xl border border-white/80 overflow-hidden py-1.5 flex flex-col gap-0.5 bg-white/80">
                      {item.submenu!.map((sub) => (
                        <Link
                          key={sub.title}
                          href={sub.href}
                          className={cn(
                            "block px-4 py-2.5 text-sm font-medium transition-colors",
                            pathname === sub.href
                              ? "text-primary bg-primary/10 font-bold"
                              : "text-stone-600 hover:bg-primary/10 hover:text-primary"
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

      <div className="flex items-center gap-3 shrink-0 relative">
        <button
          type="button"
          className="relative p-2.5 rounded-xl hover:bg-white/50 transition-colors text-stone-500 hover:text-stone-800 border border-transparent hover:border-white/50"
        >
          <Bell className="w-5 h-5" />
          <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white" />
        </button>
        <button
          type="button"
          onClick={() => setUserMenuOpen((v) => !v)}
          className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full hover:bg-white/50 border border-transparent hover:border-white/60 transition-all"
        >
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-stone-100 to-stone-200 border border-white flex items-center justify-center text-stone-500 shadow-sm">
            <User className="w-5 h-5" />
          </div>
          <div className="flex-col items-start hidden sm:flex">
            <span className="text-sm font-bold text-stone-700 leading-none">
              {userName || "사용자"}
            </span>
            <span className="text-[10px] text-stone-400 font-medium">
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
            <div className="absolute top-[calc(100%+8px)] right-0 w-64 z-50 glass-panel rounded-2xl shadow-xl border border-white/80 bg-white/90 overflow-hidden">
              <div className="px-4 py-3 border-b border-stone-200/70">
                <div className="text-sm font-bold text-stone-800 truncate">
                  {userName || "사용자"}
                </div>
                <div className="text-xs text-stone-500 truncate">{userEmail}</div>
                <div className="mt-1 inline-block text-[10px] font-bold uppercase tracking-wide text-primary bg-primary/10 px-2 py-0.5 rounded">
                  {ROLE_LABEL[role]}
                </div>
              </div>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="w-full px-4 py-3 text-sm font-bold text-stone-700 hover:bg-stone-100 flex items-center gap-2"
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
