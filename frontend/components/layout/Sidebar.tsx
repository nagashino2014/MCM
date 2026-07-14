"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight, ShieldCheck, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { MENU_ITEMS, isMenuVisibleForRole, type MenuItem, type Role } from "@/config/menu";
import { AlertBell } from "@/components/dashboard/AlertBell";

interface SidebarProps {
  role: Role;
}

export function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname();
  const [openSections, setOpenSections] = useState<string[]>(
    MENU_ITEMS.filter((m) => m.submenu).map((m) => m.title)
  );

  const toggleSection = (title: string) => {
    setOpenSections((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]
    );
  };

  const visible = MENU_ITEMS.filter((m) => isMenuVisibleForRole(m, role));
  const homeItems = visible.filter((m) => m.group === "home");
  const workItems = visible.filter((m) => m.group === "work");
  const mainItems = visible.filter((m) => (m.group ?? "main") === "main");
  const systemItems = visible.filter((m) => m.group === "system");

  return (
    <aside
      className="w-72 h-[calc(100vh-2rem)] sticky top-4 left-4 rounded-3xl flex flex-col p-6 overflow-y-auto hidden xl:flex shrink-0 border cd-border-c"
      style={{ background: "var(--cd-card)", boxShadow: "var(--cd-shadow)" }}
    >
      <div className="mb-6 px-2">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center cd-soft-primary">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[18px] font-extrabold tracking-tight cd-text">
              PermitIQ
            </span>
            <span className="text-[11px] font-semibold cd-text-faint">
              IEPS Permit Intelligence
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {homeItems.map((section) =>
          renderItem(section, pathname, openSections, toggleSection)
        )}
        {homeItems.length > 0 && <div className="mb-3" />}
        {workItems.length > 0 && (
          <>
            <div className="px-3 mb-1 text-[10px] font-bold uppercase tracking-widest cd-text-faint">
              업무 보고
            </div>
            {workItems.map((section) =>
              renderItem(section, pathname, openSections, toggleSection)
            )}
            <div className="px-3 mb-1 mt-4 text-[10px] font-bold uppercase tracking-widest cd-text-faint">
              사업 운영
            </div>
          </>
        )}
        {mainItems.map((section) =>
          renderItem(section, pathname, openSections, toggleSection)
        )}
      </div>

      {systemItems.length > 0 && (
        <div className="mt-6 pt-4 border-t cd-border-c flex flex-col gap-1">
          <div className="px-3 mb-1 text-[10px] font-bold uppercase tracking-widest cd-text-faint">
            시스템
          </div>
          {systemItems.map((section) =>
            renderItem(section, pathname, openSections, toggleSection)
          )}
        </div>
      )}

      <div className="mt-auto pt-6 flex flex-col gap-3">
        <AlertBell variant="sidebar" canAck={role === "admin" || role === "editor"} />
        <div className="rounded-2xl border cd-border-c cd-surface-bg p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center cd-soft-primary">
            <Zap className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold cd-text truncate">자동 수집</div>
            <div className="text-[11px] cd-text-faint truncate">
              `npm run collect` 또는 수집 시작 버튼
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function renderItem(
  section: MenuItem,
  pathname: string | null,
  openSections: string[],
  toggleSection: (t: string) => void
) {
  const hasSubmenu = !!section.submenu && section.submenu.length > 0;
  const isActiveSection = hasSubmenu
    ? section.submenu!.some((s) => pathname === s.href || pathname?.startsWith(s.href + "/"))
    : pathname === section.href || pathname?.startsWith(section.href + "/");
  const isOpen = openSections.includes(section.title);
  const Icon = section.icon;

  if (!hasSubmenu) {
    return (
      <Link
        key={section.title}
        href={section.href}
        className={cn(
          "flex items-center justify-between w-full px-3 py-2.5 rounded-xl text-sm font-semibold transition-all group",
          isActiveSection
            ? "cd-soft-primary"
            : "cd-text-muted hover:text-[color:var(--cd-text)]"
        )}
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "p-2 rounded-lg flex items-center justify-center transition-colors",
              isActiveSection ? "cd-fill-primary" : "cd-surface-bg cd-text-muted"
            )}
          >
            <Icon className="w-4 h-4" />
          </div>
          <span>{section.title}</span>
        </div>
        {section.comingSoon && (
          <span className="text-[10px] cd-text-faint font-medium">예정</span>
        )}
      </Link>
    );
  }

  return (
    <div key={section.title} className="flex flex-col">
      <button
        type="button"
        onClick={() => toggleSection(section.title)}
        className={cn(
          "flex items-center justify-between w-full px-3 py-2.5 rounded-xl text-sm font-semibold transition-all group",
          isActiveSection
            ? "text-[color:var(--cd-primary)]"
            : "cd-text-muted hover:text-[color:var(--cd-text)]"
        )}
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "p-2 rounded-lg flex items-center justify-center transition-colors",
              isActiveSection ? "cd-fill-primary" : "cd-surface-bg cd-text-muted"
            )}
          >
            <Icon className="w-4 h-4" />
          </div>
          <span>{section.title}</span>
        </div>
        {isOpen ? (
          <ChevronDown className="w-4 h-4 opacity-40" />
        ) : (
          <ChevronRight className="w-4 h-4 opacity-40" />
        )}
      </button>

      {isOpen && (
        <div className="flex flex-col gap-1 pl-4 mt-1 relative">
          <div className="absolute left-6 top-0 bottom-0 w-px" style={{ background: "var(--cd-border)" }} />
          {section.submenu!.map((item) => {
            const isItemActive = pathname === item.href;
            return (
              <Link
                key={item.title}
                href={item.href}
                className={cn(
                  "relative block px-3 py-2 text-sm rounded-lg ml-4 transition-colors",
                  isItemActive
                    ? "cd-soft-primary font-semibold"
                    : "cd-text-muted hover:text-[color:var(--cd-text)] cd-row-hover"
                )}
              >
                {item.title}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
