"use client";

// 전역 사이드바(G1) — 5섹션 IA(홈/협업/업무/사업운영/관리) + 카운트 뱃지 + 반응형 레일.
// 반응형(§3.0 FHD-first): ≥2xl(1536) 전체 확장(w-[248px]) · lg~2xl 아이콘 레일(라벨 숨김·title 툴팁) · <lg 미표시(AppShell 드로어).
// 자동 축소(2026-09-11 요청): 브랜드 우측 토글을 켜면 브레이크포인트와 무관하게 항상 아이콘 레일(76px)로 두고,
//   마우스 오버·키보드 포커스 동안에만 248px 로 펼친다. 펼침은 본문 위에 겹치는 오버레이라
//   본문 가로폭은 76px 기준으로 고정된다(4K 미만에서 카드 너비 확보 — 분석 요청 배경).
// mode="drawer" 면 폭 강제 확장(오버레이 드로어 내부용).
// 설계: docs/groupware-ux-overhaul-blueprint.md §2.1·§3.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/cdash/BrandMark";
import { CdIconButton } from "@/components/cdash/CdButton";
import { MENU_ITEMS, isMenuVisibleForRole, type MenuItem, type Role } from "@/config/menu";
import { resolveMenuRoute, type MenuRouteMatch } from "./menu-route";
import type { NavBadges } from "@/components/layout/useNavBadges";

interface SidebarProps {
  role: Role;
  badges: NavBadges;
  /** auto=데스크톱(레일↔확장 CSS 자동) / drawer=오버레이 내부(항상 확장). */
  mode?: "auto" | "drawer";
  /** 드로어에서 항목 클릭 시 닫기 콜백. */
  onNavigate?: () => void;
}

/** 현재 사이드바 폭 상태 — expand=펼침 고정 / rail=아이콘만 / responsive=브레이크포인트 자동. */
type NavWidth = "expand" | "rail" | "responsive";

// 폭 상태별 표시 클래스. Tailwind JIT 가 스캔하도록 리터럴로 둔다.
const NAV_CLS: Record<NavWidth, { label: string; flexLabel: string; railOnly: string; expandOnly: string }> = {
  expand: { label: "", flexLabel: "flex", railOnly: "hidden", expandOnly: "" },
  rail: { label: "hidden", flexLabel: "hidden", railOnly: "", expandOnly: "hidden" },
  responsive: { label: "hidden 2xl:block", flexLabel: "hidden 2xl:flex", railOnly: "2xl:hidden", expandOnly: "max-2xl:hidden" },
};

const SECTION_LABEL: Record<string, string> = {
  collab: "협업",
  work: "업무",
  main: "사업 운영",
  system: "관리",
};

// v2 = 기본 접힘 정책 도입(구 키의 "전체 펼침" 저장값이 복원되지 않도록 분리).
const OPEN_SECTIONS_KEY = "nav-open-sections-v2";
// 자동 축소(마우스 오버 시에만 펼침) 옵션.
const AUTO_COLLAPSE_KEY = "nav-auto-collapse";

/** 현재 경로가 속한 항목만 펼친다(기본 접힘 — 분석 §1 사이드바 '벽' 문제). */
function sectionsForPath(pathname: string | null, query: string): string[] {
  const active = resolveMenuRoute(MENU_ITEMS, pathname, query);
  return active ? [active.parentTitle] : [];
}

export function Sidebar({ role, badges, mode = "auto", onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const active = resolveMenuRoute(MENU_ITEMS.filter((item) => isMenuVisibleForRole(item, role)), pathname, query);
  const [openSections, setOpenSections] = useState<string[]>(() => sectionsForPath(pathname, query));
  const isDrawer = mode === "drawer";
  const [autoCollapse, setAutoCollapse] = useState(false);
  const [peek, setPeek] = useState(false); // 자동 축소 중 마우스 오버·포커스로 임시 펼침

  // 접힘 상태 기억(클라이언트 전용) — 저장값 ∪ 현재 경로 섹션(경로 이동 시 자동 펼침).
  useEffect(() => {
    let saved: string[] = [];
    try {
      const raw = localStorage.getItem(OPEN_SECTIONS_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch {
      /* noop */
    }
    setOpenSections(Array.from(new Set([...saved, ...sectionsForPath(pathname, query)])));
  }, [pathname, query]);

  // 자동 축소 옵션 복원(드로어는 항상 확장이라 해당 없음).
  useEffect(() => {
    if (isDrawer) return;
    try {
      setAutoCollapse(localStorage.getItem(AUTO_COLLAPSE_KEY) === "1");
    } catch {
      /* noop */
    }
  }, [isDrawer]);

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

  const toggleAutoCollapse = () => {
    setAutoCollapse((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTO_COLLAPSE_KEY, next ? "1" : "0");
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

  const width: NavWidth = isDrawer ? "expand" : autoCollapse ? (peek ? "expand" : "rail") : "responsive";
  const cls = NAV_CLS[width];
  const showRail = width !== "expand";

  const nav = (
    <aside
      className={cn(
        "cd-nav-flat rounded-lg flex-col overflow-y-auto overflow-x-hidden scrollbar-hide border flex",
        isDrawer
          ? "h-full w-72 p-5 px-3.5"
          : autoCollapse
            ? cn(
                "absolute inset-y-0 left-0 z-40 transition-[width] duration-200 ease-out",
                width === "expand" ? "w-[248px] px-3.5 py-5" : "w-[76px] p-3"
              )
            : "h-full w-full p-3 2xl:px-3.5 2xl:py-5"
      )}
      style={{
        background: "var(--cd-card)",
        backdropFilter: "none",
        WebkitBackdropFilter: "none",
        borderColor: "var(--cd-border)",
        boxShadow: "var(--cd-shadow)",
      }}
    >
      {/* 브랜드 — 심볼(확정안 5a) + MCM/GROUPWARE 로크업 · 우측(반응형 레일에서는 아래) 자동 축소 토글 */}
      <div
        className={cn(
          "mb-[18px] flex",
          width === "expand"
            ? "items-center gap-2.5 px-2.5"
            : width === "rail"
              ? "flex-col items-center gap-2 px-1"
              : "flex-col items-center gap-2 px-1 2xl:flex-row 2xl:items-center 2xl:gap-2.5 2xl:px-2.5"
        )}
      >
        <Link
          href="/home"
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-2.5 min-w-0",
            width === "expand" ? "flex-1" : width === "rail" ? "" : "2xl:flex-1"
          )}
        >
          <BrandMark className="w-[30px] h-[30px] shrink-0" />
          <span className={cn("flex-col leading-none", cls.flexLabel)}>
            <span className="text-[15px] font-semibold tracking-[-0.02em] cd-text">MCM</span>
            <span className="mt-[3px] text-[9px] font-semibold tracking-[0.25em] cd-text-faint">GROUPWARE</span>
          </span>
        </Link>
        {/* 자동 축소 중에는 펼쳐졌을 때만 노출 — 레일에 뒀다가 펼침과 함께 위치가 튀는 것을 막는다. */}
        {!isDrawer && (!autoCollapse || width === "expand") && (
          <CdIconButton
            size="sm"
            className="shrink-0"
            active={autoCollapse}
            aria-pressed={autoCollapse}
            onClick={toggleAutoCollapse}
            label={autoCollapse ? "메뉴 항상 펼치기" : "메뉴 자동 축소 — 마우스를 올릴 때만 펼침"}
          >
            {autoCollapse ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </CdIconButton>
        )}
      </div>

      <div className="flex flex-col gap-1.5 flex-1">
        {groups.map((g, gi) => (
          <div key={g.key} className={cn("flex flex-col gap-1.5", gi > 0 && "mt-2")}>
            {SECTION_LABEL[g.key] && (
              <>
                {/* 확장: 텍스트 라벨 / 레일: 구분선 */}
                <div className={cn("px-2.5 pt-3 pb-1 text-[11px] font-medium cd-text-faint", cls.label)}>
                  {SECTION_LABEL[g.key]}
                </div>
                {showRail && <div className={cn("mx-3 my-1 border-t cd-hairline-c", cls.railOnly)} />}
              </>
            )}
            {g.items.map((item) => (
              <NavItem
                key={item.title}
                item={item}
                active={active}
                badges={badges}
                width={width}
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

  if (isDrawer) return nav;

  // 자동 축소 시 펼침이 본문을 밀지 않도록 자리(76px)는 래퍼가 유지하고 사이드바만 오버레이로 띄운다.
  return (
    <div
      className={cn("relative h-full shrink-0 hidden lg:block", autoCollapse ? "w-[76px]" : "w-[76px] 2xl:w-[248px]")}
      onMouseEnter={() => setPeek(true)}
      onMouseLeave={() => setPeek(false)}
      onFocus={() => setPeek(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPeek(false);
      }}
    >
      {nav}
    </div>
  );
}

function NavItem({
  item,
  active,
  badges,
  width,
  open,
  onToggle,
  onNavigate,
}: {
  item: MenuItem;
  active: MenuRouteMatch | null;
  badges: NavBadges;
  width: NavWidth;
  open: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const cls = NAV_CLS[width];
  const showRail = width !== "expand"; // 레일 전용(아이콘 링크·점 뱃지) 렌더 여부
  const hasSubmenu = !!item.submenu && item.submenu.length > 0;
  const isActive = active?.parentTitle === item.title;
  const count = item.badgeKey ? badges[item.badgeKey] : 0;

  // 아이콘 — 틴트 사각 배지 폐기, 무채 라인 아이콘(stroke 1.8·opacity 0.9). 레일 뱃지는 점(dot).
  const iconBlock = (
    <div className="relative flex items-center justify-center shrink-0">
      <Icon className="w-[15px] h-[15px] opacity-90" strokeWidth={1.8} />
      {showRail && count > 0 && (
        <span className={cn("absolute -top-1 -right-1.5 w-2 h-2 rounded-full cd-surface-bg cd-text-muted border cd-border-c", cls.railOnly)} />
      )}
    </div>
  );

  // 항목 = 글라스 칩(비활성) / 흰 글라스 필(선택) — 확정안 4a.
  const rowCls = cn(
    "flex items-center w-full rounded-md text-[13px] transition-all",
    width === "expand"
      ? "px-2.5 py-[7px] justify-between"
      : width === "rail"
        ? "px-2 py-[7px] justify-center"
        : "px-2 2xl:px-2.5 py-[7px] justify-center 2xl:justify-between",
    isActive ? "cd-glass-active font-bold" : "cd-glass-chip font-medium text-[color:var(--cd-nav-muted)]"
  );

  // 뱃지 = 그라데이션 원형.
  const countBadge = count > 0 && (
    <span className="min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-semibold inline-flex items-center justify-center cd-surface-bg cd-text-muted border cd-border-c">
      {count > 99 ? "99+" : count}
    </span>
  );

  if (!hasSubmenu) {
    return (
      <Link href={item.href} aria-current={isActive ? "page" : undefined} onClick={onNavigate} title={item.title} className={rowCls} aria-disabled={item.comingSoon}>
        <div className="flex items-center gap-2.5 min-w-0">
          {iconBlock}
          <span className={cn("truncate", cls.label)}>{item.title}</span>
        </div>
        <span className={cn("items-center gap-1", cls.flexLabel)}>
          {countBadge}
          {item.comingSoon && <span className="text-[10px] cd-text-faint font-medium">예정</span>}
        </span>
      </Link>
    );
  }

  return (
    <div className="flex flex-col">
      {/* 레일 모드: 클릭=대표 경로 이동 / 확장: 클릭=접기토글 */}
      <button type="button" onClick={onToggle} aria-expanded={open} title={item.title} className={cn(rowCls, cls.expandOnly)}>
        <div className="flex items-center gap-2.5 min-w-0">
          {iconBlock}
          <span className={cn("truncate", cls.label)}>{item.title}</span>
        </div>
        <span className={cn("items-center gap-1", cls.flexLabel)}>
          {countBadge}
          {open ? <ChevronDown className="w-3.5 h-3.5 opacity-40" /> : <ChevronRight className="w-3.5 h-3.5 opacity-40" />}
        </span>
      </button>
      {showRail && (
        <Link href={item.href} title={item.title} className={cn(rowCls, cls.railOnly)} onClick={onNavigate}>
          {iconBlock}
        </Link>
      )}

      {open && (
        <div className={cn("flex-col gap-0.5 pl-4 mt-1 relative", cls.flexLabel)}>
          <div className="absolute left-6 top-0 bottom-0 w-px" style={{ background: "var(--cd-hairline)" }} />
          {item.submenu!.map((sub) => {
            const subActive = isActive && active?.href === sub.href;
            return (
              <Link
                key={sub.title}
                href={sub.href}
                aria-current={subActive ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "relative block px-2.5 py-[7px] text-[12.5px] rounded-md ml-4 transition-colors",
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
