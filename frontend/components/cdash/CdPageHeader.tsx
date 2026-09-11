"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CdHelp } from "./CdHelp";

export interface CdBreadcrumbItem {
  label: ReactNode;
  href?: string;
}

/** Precision 공용 헤더. 짧은 업무 맥락은 subtitle, 선택 안내는 help로 구분한다. */
export function CdPageHeader({
  eyebrow: _eyebrow,
  icon: _icon,
  subtitle,
  help,
  helpLabel,
  breadcrumbs,
  title,
  titleSuffix,
  meta,
  actions,
  tabs,
}: {
  /** @deprecated 아이콘 배지 폐기 — 렌더되지 않는다. */
  icon?: ReactNode;
  /** @deprecated 영문 eyebrow 폐기 — 렌더되지 않는다. */
  eyebrow?: string;
  breadcrumbs?: CdBreadcrumbItem[];
  title: ReactNode;
  titleSuffix?: ReactNode;
  /** 항상 보여야 하는 짧은 맥락·작업 영향. 선택 안내는 help로 전달한다. */
  subtitle?: ReactNode;
  /** 사용법·배경 설명. 제목 옆 ? 버튼으로 연다. */
  help?: ReactNode;
  helpLabel?: string;
  /** 현재 개수·범위 같은 짧은 업무 요약. */
  meta?: ReactNode;
  actions?: ReactNode;
  /** 헤더 하단 탭 슬롯(보통 <CdTabs variant="underline"/>). */
  tabs?: ReactNode;
}) {
  return (
    <header className="cd-page-header flex items-center justify-between gap-4 flex-wrap mb-5">
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="현재 위치" className="flex flex-wrap items-center gap-1 text-xs font-medium mb-1" style={{ color: "var(--cd-muted)" }}>
            {breadcrumbs.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="w-3 h-3 opacity-60" />}
                {b.href ? (
                  <Link href={b.href} className="hover:text-[color:var(--cd-primary)] transition-colors">
                    {b.label}
                  </Link>
                ) : (
                  <span style={{ color: "var(--cd-muted)" }}>{b.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <div className="flex items-baseline gap-3.5 flex-wrap min-w-0">
          <h1 className="cd-page-title text-xl sm:text-[22px] font-[650] tracking-[-0.02em] cd-text">
            {title}
            {titleSuffix && (
              <span className="ml-2 text-[13px] font-medium" style={{ color: "var(--cd-muted)" }}>
                {titleSuffix}
              </span>
            )}
          </h1>
          {help && <CdHelp label={helpLabel ?? (typeof title === "string" ? `${title} 도움말` : "페이지 도움말")}>{help}</CdHelp>}
          {meta && <span className="cd-page-meta text-[13px] font-normal cd-text-muted min-w-0">{meta}</span>}
        </div>
        {subtitle && <div className="cd-page-subtitle mt-1 text-[13px] leading-relaxed cd-text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="cd-page-actions flex flex-wrap items-center gap-2 min-w-0 max-w-full">{actions}</div>}
      {tabs && <div className="w-full -mb-2">{tabs}</div>}
    </header>
  );
}
