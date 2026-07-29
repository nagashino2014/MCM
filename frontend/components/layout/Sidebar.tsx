"use client";

// 전역 사이드바(G1) — 5섹션 IA(홈/협업/업무/사업운영/관리) + 카운트 뱃지 + 반응형 레일.
// 반응형(§3.0 FHD-first): ≥2xl(1536) 전체 확장(w-72) · lg~2xl 아이콘 레일(라벨 숨김·title 툴팁) · <lg 미표시(AppShell 드로어).
// mode="drawer" 면 폭 강제 확장(오버레이 드로어 내부용). 순수 CSS 브레이크포인트라 상태관리 없음.
// 설계: docs/groupware-ux-overhaul-blueprint.md §2.1·§3.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { MENU_ITEMS, isMenuVisibleForRole, type MenuItem, type Role } from "@/config/menu";
import type { NavBadges } from "@/components/layout/useNavBadges";

interface SidebarProps {
  role: Role;
  badges: NavBadges;
  /** auto=데스크톱(레일↔확장 CSS 자동) / drawer=오버레이 내부(항상 확장). */
  mode?: "auto" | "drawer";
  /** 드로어에서 항목 클릭 시 닫기 콜백. */
  onNavigate?: () => void;
}

const SECTION_LABEL: Record<string, string> = {
  collab: "협업",
  work: "업무",
  main: "사업 운영",
  system: "관리",
};

// v2 = 기본 접힘 정책 도입(구 키의 "전체 펼침" 저장값이 복원되지 않도록 분리).
const OPEN_SECTIONS_KEY = "nav-open-sections-v2";

/** 현재 경로가 속한 항목만 펼친다(기본 접힘 — 분석 §1 사이드바 '벽' 문제). */
function sectionsForPath(pathname: string | null): string[] {
  if (!pathname) return [];
  return MENU_ITEMS.filter(
    (m) => m.submenu?.some((s) => pathname === s.href || pathname.startsWith(s.href + "/"))
  ).map((m) => m.title);
}

export function Sidebar({ role, badges, mode = "auto", onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const [openSections, setOpenSections] = useState<string[]>(() => sectionsForPath(pathname));

  // 접힘 상태 기억(클라이언트 전용) — 저장값 ∪ 현재 경로 섹션(경로 이동 시 자동 펼침).
  useEffect(() => {
    let saved: string[] = [];
    try {
      const raw = localStorage.getItem(OPEN_SECTIONS_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch {
      /* noop */
    }
    setOpenSections(Array.from(new Set([...saved, ...sectionsForPath(pathname)])));
  }, [pathname]);
  const toggleSection = (title: string) => {
    setOpenSections((prev) => {
      const next = prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title];
      try {
        localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify(next));
      } catch {
        /* noop */
      }
      return next;
    });
  };

  const visible = MENU_ITEMS.filter((m) => isMenuVisibleForRole(m, role));
  const groups: Array<{ key: string; items: MenuItem[] }> = ["home", "collab", "work", "main", "system"]
    .map((key) => ({ key, items: visible.filter((m) => (m.group ?? "main") === key) }))
    .filter((g) => g.items.length > 0);

  const isDrawer = mode === "drawer";
  // 레일 모드에서 라벨류를 숨기는 클래스(드로어는 항상 표시).
  const labelCls = isDrawer ? "" : "hidden 2xl:block";
  const expandOnlyCls = isDrawer ? "" : "hidden 2xl:flex";

  return (
    <aside
      className={cn(
        "h-full rounded-[20px] flex-col overflow-y-auto overflow-x-hidden shrink-0 border flex",
        isDrawer ? "w-72 p-5 px-3.5" : "w-[76px] 2xl:w-[248px] p-3 2xl:px-3.5 2xl:py-5 hidden lg:flex"
      )}
      style={{
        background: "var(--cd-card)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderColor: "var(--cd-border)",
        boxShadow: "var(--cd-shadow)",
      }}
    >
      {/* 브랜드 — 그라데이션 로고 사각형 + MCM */}
      <Link href="/home" onClick={onNavigate} className={cn("mb-[18px] flex items-center gap-2.5", isDrawer ? "px-2.5" : "px-1 2xl:px-2.5 justify-center 2xl:justify-start")}>
        <span className="w-7 h-7 rounded-[9px] flex items-center justify-center text-[12px] font-extrabold text-white shrink-0 cd-grad-fill">
          M
        </span>
        <span className={cn("items-baseline gap-1.5", labelCls, isDrawer ? "flex" : "hidden 2xl:flex")}>
          <span className="text-[16px] font-extrabold tracking-tight cd-text">MCM</span>
          <span className="text-[9.5px] font-semibold cd-text-faint">GROUPWARE</span>
        </span>
      </Link>

      <div className="flex flex-col gap-1.5 flex-1">
        {groups.map((g, gi) => (
          <div key={g.key} className={cn("flex flex-col gap-1.5", gi > 0 && "mt-2")}>
            {SECTION_LABEL[g.key] && (
              <>
                {/* 확장: 텍스트 라벨 / 레일: 구분선 */}
                <div className={cn("px-2.5 pt-3 pb-1 text-[9.5px] font-bold uppercase tracking-[0.12em] cd-text-faint", labelCls)}>
                  {SECTION_LABEL[g.key]}
                </div>
                {!isDrawer && <div className="2xl:hidden mx-3 my-1 border-t cd-hairline-c" />}
              </>
            )}
            {g.items.map((item) => (
              <NavItem
                key={item.title}
                item={item}
                pathname={pathname}
                badges={badges}
                isDrawer={isDrawer}
                labelCls={labelCls}
                expandOnlyCls={expandOnlyCls}
                open={openSections.includes(item.title)}
                onToggle={() => toggleSection(item.title)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

function NavItem({
  item,
  pathname,
  badges,
  isDrawer,
  labelCls,
  expandOnlyCls,
  open,
  onToggle,
  onNavigate,
}: {
  item: MenuItem;
  pathname: string | null;
  badges: NavBadges;
  isDrawer: boolean;
  labelCls: string;
  expandOnlyCls: string;
  open: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const hasSubmenu = !!item.submenu && item.submenu.length > 0;
  const isActive = hasSubmenu
    ? item.submenu!.some((s) => pathname === s.href || pathname?.startsWith(s.href + "/"))
    : pathname === item.href || pathname?.startsWith(item.href + "/");
  const count = item.badgeKey ? badges[item.badgeKey] : 0;

  // 아이콘 — 틴트 사각 배지 폐기, 무채 라인 아이콘(stroke 1.8·opacity 0.9). 레일 뱃지는 점(dot).
  const iconBlock = (
    <div className="relative flex items-center justify-center shrink-0">
      <Icon className="w-[15px] h-[15px] opacity-90" strokeWidth={1.8} />
      {!isDrawer && count > 0 && (
        <span className="2xl:hidden absolute -top-1 -right-1.5 w-2 h-2 rounded-full cd-grad-fill" />
      )}
    </div>
  );

  // 항목 = 글라스 칩(비활성) / 흰 글라스 필(선택) — 확정안 4a.
  const rowCls = cn(
    "flex items-center w-full rounded-[11px] text-[13px] transition-all",
    isDrawer ? "px-2.5 py-[7px] justify-between" : "px-2 2xl:px-2.5 py-[7px] justify-center 2xl:justify-between",
    isActive ? "cd-glass-active font-bold" : "cd-glass-chip font-medium text-[color:var(--cd-nav-muted)]"
  );

  // 뱃지 = 그라데이션 원형.
  const countBadge = count > 0 && (
    <span className="min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-extrabold inline-flex items-center justify-center cd-grad-fill">
      {count > 99 ? "99+" : count}
    </span>
  );

  if (!hasSubmenu) {
    return (
      <Link href={item.href} onClick={onNavigate} title={item.title} className={rowCls} aria-disabled={item.comingSoon}>
        <div className="flex items-center gap-2.5 min-w-0">
          {iconBlock}
          <span className={cn("truncate", labelCls)}>{item.title}</span>
        </div>
        <span className={cn("items-center gap-1", labelCls, isDrawer ? "flex" : expandOnlyCls)}>
          {countBadge}
          {item.comingSoon && <span className="text-[10px] cd-text-faint font-medium">예정</span>}
        </span>
      </Link>
    );
  }

  return (
    <div className="flex flex-col">
      {/* 레일 모드: 클릭=대표 경로 이동 / 확장: 클릭=접기토글 */}
      <button type="button" onClick={onToggle} title={item.title} className={cn(rowCls, !isDrawer && "max-2xl:hidden")}>
        <div className="flex items-center gap-2.5 min-w-0">
          {iconBlock}
          <span className={cn("truncate", labelCls)}>{item.title}</span>
        </div>
        <span className={cn("items-center gap-1", isDrawer ? "flex" : expandOnlyCls)}>
          {countBadge}
          {open ? <ChevronDown className="w-3.5 h-3.5 opacity-40" /> : <ChevronRight className="w-3.5 h-3.5 opacity-40" />}
        </span>
      </button>
      {!isDrawer && (
        <Link href={item.href} title={item.title} className={cn(rowCls, "2xl:hidden")} onClick={onNavigate}>
          {iconBlock}
        </Link>
      )}

      {open && (
        <div className={cn("flex-col gap-0.5 pl-4 mt-1 relative", isDrawer ? "flex" : "hidden 2xl:flex")}>
          <div className="absolute left-6 top-0 bottom-0 w-px" style={{ background: "var(--cd-hairline)" }} />
          {item.submenu!.map((sub) => {
            const subActive = pathname === sub.href;
            return (
              <Link
                key={sub.title}
                href={sub.href}
                onClick={onNavigate}
                className={cn(
                  "relative block px-2.5 py-[7px] text-[12.5px] rounded-[10px] ml-4 transition-colors",
                  subActive
                    ? "cd-glass-active font-bold"
                    : "font-medium text-[color:var(--cd-nav-muted)] cd-row-hover hover:text-[color:var(--cd-text)]"
                )}
              >
                {sub.title}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
