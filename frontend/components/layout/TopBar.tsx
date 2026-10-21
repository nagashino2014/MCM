"use client";

// 전역 탑바(G1) — 가로 메뉴 nav 폐지, 글로벌 액션만: 검색(⌘K)·+새로작성·매뉴얼(F1)·알림·테마·계정.
// <lg 에서는 좌측 햄버거로 사이드바 드로어를 연다(네비 소실 방지 — §3.0).
// 설계: docs/groupware-ux-overhaul-blueprint.md §2.2.

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { ClipboardCheck, KeyRound, ListChecks, LogOut, Mail, Menu, Moon, Plus, Search, Sun } from "lucide-react";
import { hasPerm, isSystemAdminPerms } from "@/lib/auth/perms";
import type { CdTheme } from "@/components/cdash/useCdashTheme";
import { CdAvatar } from "@/components/cdash/CdAvatar";
import { CdDropdown } from "@/components/cdash/CdDropdown";
import { CdIconButton } from "@/components/cdash/CdButton";
import { AlertBell } from "@/components/dashboard/AlertBell";
import { TodoNotifyBell } from "@/components/todo/TodoNotifyBell";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { ManualButton } from "@/components/manual/ManualButton";

interface TopBarProps {
  userName: string | null;
  userEmail: string | null;
  /** 세션의 권한 요약 — 라벨·알림 확인 버튼·전역 검색 후보 판정. */
  perms: readonly string[];
  theme: CdTheme;
  onToggleTheme: () => void;
  onOpenNav: () => void; // <lg 햄버거 → 사이드바 드로어
  navOpen?: boolean;
}


/** 영업 하위 경로 중 프로젝트 상세가 아닌 것(/sales/<projectId> 만 연결 대상). */
const SALES_NON_PROJECT = new Set(["bids", "contacts", "intel", "rag"]);

/**
 * "새 할 일" 진입 URL(docs/todo-kanban-blueprint.md §7.1 Autofill) — 계약·사업장·영업·결재 상세를 보고 있으면
 * 그 링크(linkKind/linkId/linkLabel)를 덧붙여 새 할 일 작성 화면(/todo/new, 2026-10-20)이 연결을 자동 첨부하게 한다.
 * 클릭 시점에 window.location 을 읽는다(useSearchParams 는 Suspense 경계를 요구해 전역 탑바에 두지 않는다).
 */
function todoNewHref(): string {
  const params = new URLSearchParams();
  if (typeof window === "undefined") return "/todo/new";
  const { pathname } = window.location;
  const query = new URLSearchParams(window.location.search);
  let linkKind: string | null = null;
  let linkId: string | null = null;
  if (pathname.startsWith("/contracts")) {
    linkKind = "contract";
    linkId = query.get("contract");
  } else if (pathname.startsWith("/facilities")) {
    linkKind = "facility";
    linkId = query.get("focus");
  } else if (pathname.startsWith("/sales/")) {
    const seg = pathname.split("/")[2] ?? "";
    if (seg && !SALES_NON_PROJECT.has(seg)) {
      linkKind = "sales_project";
      linkId = seg;
    }
  } else if (pathname.startsWith("/approval")) {
    linkKind = "approval_doc";
    linkId = query.get("docId");
  }
  if (linkKind && linkId) {
    params.set("linkKind", linkKind);
    params.set("linkId", linkId);
    const heading = document.querySelector("main h1")?.textContent?.trim();
    const label = (heading || document.title).trim().slice(0, 80);
    if (label) params.set("linkLabel", label);
  }
  const qs = params.toString();
  return `/todo/new${qs ? `?${qs}` : ""}`;
}

export function TopBar({ userName, userEmail, perms, theme, onToggleTheme, onOpenNav, navOpen = false }: TopBarProps) {
  // 계정 라벨 — role 이 아니라 시스템 관리자 템플릿 보유 여부로 표시(role 일원화 WP5).
  const roleLabel = isSystemAdminPerms(perms) ? "관리자" : "직원";
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const accountId = useId();
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const accountPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userMenuOpen) return;
    accountPanelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setUserMenuOpen(false);
        accountButtonRef.current?.focus();
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (!accountPanelRef.current?.contains(event.target as Node) && !accountButtonRef.current?.contains(event.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
    };
  }, [userMenuOpen]);

  // 전역 ⌘K/Ctrl+K 단축키.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header
      className="h-14 flex items-center gap-1.5 px-3 sm:gap-2 sm:px-7 sticky top-0 z-50 shrink-0 border-b cd-border-c"
      style={{ background: "var(--cd-card-solid)" }}
    >
      {/* <lg: 사이드바 드로어 열기 */}
      <CdIconButton label="메뉴 열기" className="lg:hidden" onClick={onOpenNav} aria-expanded={navOpen} aria-controls={navOpen ? "mobile-navigation" : undefined} aria-haspopup="dialog">
        <Menu className="w-5 h-5" />
      </CdIconButton>

      {/* 통합검색 트리거 — 입력처럼 보이는 버튼 */}
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        aria-label="통합검색 열기"
        aria-haspopup="dialog"
        className="flex h-9 min-w-9 items-center gap-2 flex-1 max-w-md rounded-md border cd-border-c cd-surface-bg px-2.5 sm:px-3 py-2 text-[13px] cd-text-muted hover:bg-[color:var(--cd-hover)] transition-colors"
      >
        <Search className="w-4 h-4 shrink-0" />
        <span className="hidden flex-1 text-left min-[420px]:inline">검색</span>
        <kbd className="hidden sm:inline text-[10px] border cd-line-c rounded px-1.5 py-0.5">Ctrl K</kbd>
      </button>

      <div className="flex-1" />

      {/* +새로 작성 */}
      <CdDropdown
        align="right"
        trigger={(open) => (
          <button
            type="button"
            className="cd-btn cd-btn-primary inline-flex shrink-0 items-center gap-1.5"
            aria-label="새로 작성"
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">새로 작성</span>
          </button>
        )}
        items={[
          { key: "mail", label: "새 메일", icon: <Mail className="w-4 h-4" />, onSelect: () => router.push("/mail/compose") },
          { key: "draft", label: "새 기안", icon: <ClipboardCheck className="w-4 h-4" />, onSelect: () => router.push("/approval/draft") },
          { key: "todo", label: "새 할 일", icon: <ListChecks className="w-4 h-4" />, onSelect: () => router.push(todoNewHref()) },
        ]}
      />

      {/* 사용 매뉴얼 — [새로 작성] 바로 오른쪽(docs/manual-help-blueprint.md §1.1) */}
      <ManualButton />

      {/* 할 일 알림함(277) — 배정·댓글·완료·리마인드·아침 요약. 운영 알람과 별개 */}
      <TodoNotifyBell />

      {/* 알림(운영 알람 통합 — AlertBell compact) */}
      <AlertBell variant="compact" canAck={hasPerm(perms, "data.collect")} />

      {/* 테마 */}
      <CdIconButton label={theme === "dark" ? "라이트 모드" : "다크 모드"} onClick={onToggleTheme}>
        {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </CdIconButton>

      {/* 계정 */}
      <div className="relative">
        <button
          ref={accountButtonRef}
          type="button"
          onClick={() => setUserMenuOpen((v) => !v)}
          className="flex shrink-0 items-center gap-2 pl-1 pr-1 sm:pr-2 py-1 rounded-md cd-row-hover border border-transparent transition-colors"
          aria-label={`${userName || "사용자"} 계정 메뉴`}
          aria-expanded={userMenuOpen}
          aria-controls={userMenuOpen ? accountId : undefined}
        >
          <CdAvatar name={userName || "사용자"} size="sm" />
          <div className="flex-col items-start hidden md:flex">
            <span className="text-[13px] font-medium cd-text leading-4">{userName || "사용자"}</span>
            <span className="text-[11px] cd-text-muted">{roleLabel}</span>
          </div>
        </button>
        {userMenuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => { setUserMenuOpen(false); accountButtonRef.current?.focus(); }} />
            <div
              ref={accountPanelRef}
              id={accountId}
              aria-label="계정"
              className="absolute top-[calc(100%+8px)] right-0 w-64 max-w-[calc(100vw-24px)] z-50 rounded-lg overflow-hidden border cd-border-c"
              style={{ background: "var(--cd-card-solid)", boxShadow: "var(--cd-shadow)" }}
            >
              <div className="px-4 py-3 border-b cd-hairline-c">
                <div className="text-sm font-bold cd-text truncate">{userName || "사용자"}</div>
                <div className="text-xs cd-text-muted truncate">{userEmail}</div>
                <div className="mt-1 inline-block text-[10px] font-bold uppercase tracking-wide cd-soft-primary px-2 py-0.5 rounded">
                  {roleLabel}
                </div>
              </div>
              {/* 본인 비밀번호 변경(F-9) — 최초 변경 화면을 재사용, 현재 비밀번호 확인 후 변경·재로그인 */}
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen(false);
                  router.push("/account/change-password?from=menu");
                }}
                className="w-full px-4 py-3 text-sm font-bold cd-text cd-row-hover flex items-center gap-2 border-b cd-hairline-c"
              >
                <KeyRound className="w-4 h-4" />
                비밀번호 변경
              </button>
              <button
                type="button"
                onClick={async () => {
                  // ALB(프록시) 뒤 next-auth host 문제 회피: redirect:false 후 상대경로 이동.
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

      <GlobalSearch perms={perms} open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}
