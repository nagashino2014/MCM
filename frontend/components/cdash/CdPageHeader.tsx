"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface CdBreadcrumbItem {
  label: ReactNode;
  href?: string;
}

/**
 * 페이지 공용 헤더 — Soft Glass Ink 1층 헤더.
 * `제목(24/800) + 그라데이션 메타 1줄 + 우측 액션` 이 전부다.
 * 폐기: 틴트 아이콘 배지 · 영문 eyebrow · 설명문(subtitle) — 화면마다 반복되던 3층 공식이
 * "AI 템플릿" 인상의 최대 지분이었다(분석 §1). 기존 사용처 호환을 위해 prop 시그니처는
 * 유지하되 `icon`·`eyebrow` 는 렌더하지 않고, `subtitle` 은 그라데이션 메타 1줄로 축약한다.
 * breadcrumbs·tabs 는 그대로 유지(경로 맥락·탭은 정보 가치가 있음).
 */
export function CdPageHeader({
  eyebrow: _eyebrow,
  icon: _icon,
  subtitle: _subtitle,
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
  /** @deprecated 설명문 폐기 — 렌더되지 않는다. 필요한 안내는 빈 상태·툴팁으로 옮긴다. */
  subtitle?: ReactNode;
  /** 제목 옆 그라데이션 메타 1줄(카운트 요약 등). 짧게 유지할 것. */
  meta?: ReactNode;
  actions?: ReactNode;
  /** 헤더 하단 탭 슬롯(보통 <CdTabs variant="underline"/>). */
  tabs?: ReactNode;
}) {
  return (
    <header className="flex items-center justify-between gap-4 flex-wrap mb-5">
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="flex items-center gap-1 text-[11px] font-semibold mb-1" style={{ color: "var(--cd-faint)" }}>
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
          <h1 className="text-2xl font-extrabold tracking-[-0.02em] cd-text">
            {title}
            {titleSuffix && (
              <span className="ml-2 text-sm font-bold" style={{ color: "var(--cd-faint)" }}>
                {titleSuffix}
              </span>
            )}
          </h1>
          {meta && <span className="text-[13.5px] font-bold cd-grad-text min-w-0 truncate">{meta}</span>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      {tabs && <div className="w-full -mb-2">{tabs}</div>}
    </header>
  );
}
