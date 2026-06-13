"use client";

import type { ReactNode } from "react";

/**
 * 대쉬보드 공용 카드 프레임 — Modernize 카드 스타일(보더 + 은은한 섀도 + 라운드).
 * area 클래스(cd-a-*)로 그리드 위치가 결정된다.
 */
export function CardFrame({
  area,
  icon,
  title,
  titleSuffix,
  extra,
  children,
  bodyClassName,
  delay,
}: {
  area: string;
  icon: ReactNode;
  title: string;
  titleSuffix?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  delay?: 1 | 2 | 3 | 4 | 5;
}) {
  return (
    <section className={`cd-card p-5 reveal ${delay ? `delay-${delay}` : ""} ${area}`}>
      <header className="flex items-center justify-between gap-2 mb-4 flex-wrap shrink-0">
        <h2 className="cd-card-title">
          <span className="cd-title-icon">{icon}</span>
          {title}
          {titleSuffix}
        </h2>
        {extra}
      </header>
      <div className={`flex-1 min-h-0 flex flex-col ${bodyClassName ?? ""}`}>{children}</div>
    </section>
  );
}

/** 용역분류 단색 실루엣 아이콘 — PNG 를 CSS mask 로 입혀 분류색으로 칠한다 (수주 모달과 동일 기법). */
export function ServiceIcon({ color, iconSrc, size = 14 }: { color: string; iconSrc: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        maskImage: `url(${iconSrc})`,
        WebkitMaskImage: `url(${iconSrc})`,
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
        maskSize: "contain",
        WebkitMaskSize: "contain",
      }}
    />
  );
}

export function CardSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-3 animate-pulse py-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-5 rounded-lg"
          style={{ background: "var(--cd-surface)", width: `${100 - i * 9}%` }}
        />
      ))}
    </div>
  );
}
