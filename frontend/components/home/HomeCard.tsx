"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

/**
 * 홈 대시보드 위젯 카드 공용 셸(cdash cd-card — 글라스).
 * 헤더(제목 14/800 + 카운트 배지 + 딥링크) + 헤어라인 + 본문.
 * Soft Glass Ink: 틴트 사각 아이콘 배지는 폐기했다(화면이 파란 사각형으로 도배되던 원인 — 분석 §1).
 * `icon` prop 은 기존 13개 위젯 호환을 위해 남겨두되 렌더하지 않는다.
 */
export function HomeCard({
  icon: _icon,
  title,
  count,
  accent = "var(--cd-primary)",
  href,
  hrefLabel = "전체보기",
  loading = false,
  error,
  empty = false,
  emptyText = "표시할 항목이 없습니다.",
  children,
  headerActions,
}: {
  /** @deprecated 아이콘 배지 폐기 — 렌더되지 않는다. */
  icon?: ReactNode;
  title: string;
  count?: number;
  /** 카운트 배지 강조색(CSS 색 문자열). */
  accent?: string;
  href?: string;
  hrefLabel?: string;
  loading?: boolean;
  error?: string;
  empty?: boolean;
  emptyText?: string;
  children?: ReactNode;
  headerActions?: ReactNode;
}) {
  return (
    <section className="cd-card cd-reveal overflow-hidden">
      <header className="flex items-center gap-2 px-[18px] py-[13px] border-b cd-hairline-c shrink-0">
        <h2 className="text-sm font-extrabold cd-text truncate">{title}</h2>
        {typeof count === "number" && count > 0 && (
          <span
            className="text-[11px] font-extrabold rounded-md px-[7px] py-0.5 shrink-0"
            style={{ background: "color-mix(in srgb, " + accent + " 14%, transparent)", color: accent }}
          >
            {count}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {headerActions}
          {href && (
            <Link
              href={href}
              className="inline-flex items-center gap-1 text-xs font-semibold cd-text-faint hover:text-[color:var(--cd-text)] transition-colors"
            >
              {hrefLabel}
              <ArrowRight className="w-3 h-3" />
            </Link>
          )}
        </div>
      </header>

      {/* 고정 높이 카드(결재 대기·안읽은 메일)에서 내용이 넘치면 본문만 스크롤한다. */}
      <div className="min-h-[64px] flex-1 overflow-y-auto px-[18px] py-3">
        {loading ? (
          <div className="flex flex-col gap-2 animate-pulse">
            <div className="h-3.5 rounded" style={{ background: "var(--cd-hover)", width: "80%" }} />
            <div className="h-3.5 rounded" style={{ background: "var(--cd-hover)", width: "60%" }} />
            <div className="h-3.5 rounded" style={{ background: "var(--cd-hover)", width: "70%" }} />
          </div>
        ) : error ? (
          <p className="text-[13px] cd-text-faint py-4 text-center">불러오지 못했습니다.</p>
        ) : empty ? (
          <p className="text-[13px] cd-text-faint py-6 text-center">{emptyText}</p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/** 위젯 리스트 행 — 윤곽선 박스 폐기, 헤어라인 구분 + hover 글라스(120ms). */
export function HomeRow({
  children,
  href,
  onClick,
}: {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  const cls =
    "w-full flex items-center gap-2.5 rounded-[10px] px-2 py-2.5 text-left cd-row-hover";
  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
}
