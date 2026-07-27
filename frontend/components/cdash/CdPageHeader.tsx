"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface CdBreadcrumbItem {
  label: ReactNode;
  href?: string;
}

/**
 * Modernize(cdash) 페이지 공용 헤더.
 * 아이콘 배지 + eyebrow + 타이틀 + 서브타이틀 + 우측 액션(보통 테마 토글 포함)으로
 * 계약 대시보드 헤더와 동일한 결을 맞춘다.
 * G0 확장: breadcrumbs(eyebrow 대체 가능)·tabs(하단 슬롯 — 보통 <CdTabs/>). 기존 사용처 호환.
 */
export function CdPageHeader({
  icon,
  eyebrow,
  breadcrumbs,
  title,
  titleSuffix,
  subtitle,
  actions,
  tabs,
}: {
  icon?: ReactNode;
  eyebrow?: string;
  breadcrumbs?: CdBreadcrumbItem[];
  title: ReactNode;
  titleSuffix?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** 헤더 하단 탭 슬롯(보통 <CdTabs variant="underline"/>). */
  tabs?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3 flex-wrap mb-4">
      <div className="flex items-center gap-3">
        {icon && (
          <span
            className="inline-flex items-center justify-center w-10 h-10 rounded-xl shrink-0"
            style={{ background: "var(--cd-primary-soft)", color: "var(--cd-primary)" }}
          >
            {icon}
          </span>
        )}
        <div>
          {breadcrumbs && breadcrumbs.length > 0 ? (
            <nav className="flex items-center gap-1 text-[11px] font-semibold mb-0.5" style={{ color: "var(--cd-faint)" }}>
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
          ) : eyebrow ? (
            <p
              className="text-[10px] font-extrabold tracking-[0.22em] uppercase"
              style={{ color: "var(--cd-primary)" }}
            >
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-xl font-extrabold tracking-tight" style={{ color: "var(--cd-text)" }}>
            {title}
            {titleSuffix && (
              <span className="ml-2 text-sm font-bold" style={{ color: "var(--cd-faint)" }}>
                {titleSuffix}
              </span>
            )}
          </h1>
          {subtitle && (
            <p className="text-[13px] mt-1 max-w-3xl leading-relaxed" style={{ color: "var(--cd-muted)" }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      {tabs && <div className="w-full -mb-2">{tabs}</div>}
    </header>
  );
}
