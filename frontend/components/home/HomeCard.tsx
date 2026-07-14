"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

/**
 * 홈 대시보드 위젯 카드 공용 셸(cdash cd-card).
 * 헤더(아이콘 배지 + 타이틀 + 카운트 뱃지 + 딥링크) + 본문. 로딩/에러/빈 상태를 일관되게 처리한다.
 */
export function HomeCard({
  icon,
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
  icon: ReactNode;
  title: string;
  count?: number;
  /** 아이콘 배지·카운트 뱃지 강조색(CSS 색 문자열). */
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
    <section className="cd-card p-4 flex flex-col gap-3 cd-reveal">
      <header className="flex items-center gap-2.5">
        <span
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
          style={{ background: "color-mix(in srgb, " + accent + " 14%, transparent)", color: accent }}
        >
          {icon}
        </span>
        <h2 className="text-sm font-bold cd-text truncate">{title}</h2>
        {typeof count === "number" && count > 0 && (
          <span
            className="text-[11px] font-bold rounded-full px-2 py-0.5 shrink-0"
            style={{ background: "color-mix(in srgb, " + accent + " 16%, transparent)", color: accent }}
          >
            {count}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {headerActions}
          {href && (
            <Link
              href={href}
              className="inline-flex items-center gap-1 text-[11px] font-semibold cd-text-muted hover:cd-text"
            >
              {hrefLabel}
              <ArrowRight className="w-3 h-3" />
            </Link>
          )}
        </div>
      </header>

      <div className="min-h-[64px]">
        {loading ? (
          <div className="flex flex-col gap-2 animate-pulse">
            <div className="h-3.5 rounded" style={{ background: "var(--cd-surface)", width: "80%" }} />
            <div className="h-3.5 rounded" style={{ background: "var(--cd-surface)", width: "60%" }} />
            <div className="h-3.5 rounded" style={{ background: "var(--cd-surface)", width: "70%" }} />
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

/** 위젯 리스트 행 공용 스타일 — 윤곽선 기본, hover 시 surface. */
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
    "w-full flex items-center gap-2 rounded-lg border cd-border-c px-3 py-2 text-left hover:bg-[color:var(--cd-surface)] transition-colors";
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
