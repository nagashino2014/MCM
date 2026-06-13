"use client";

import type { ReactNode } from "react";

/**
 * Modernize(cdash) 페이지 공용 헤더.
 * 아이콘 배지 + eyebrow + 타이틀 + 서브타이틀 + 우측 액션(보통 테마 토글 포함)으로
 * 계약 대시보드 헤더와 동일한 결을 맞춘다.
 */
export function CdPageHeader({
  icon,
  eyebrow,
  title,
  titleSuffix,
  subtitle,
  actions,
}: {
  icon?: ReactNode;
  eyebrow?: string;
  title: ReactNode;
  titleSuffix?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
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
          {eyebrow && (
            <p
              className="text-[10px] font-extrabold tracking-[0.22em] uppercase"
              style={{ color: "var(--cd-primary)" }}
            >
              {eyebrow}
            </p>
          )}
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
    </header>
  );
}
