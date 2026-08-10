"use client";

import { useId } from "react";

/**
 * MCM 브랜드 심볼 — 확정안 5a(핸드오프 README-브랜드아이콘.md).
 * 그라데이션 스퀘어(#6b7cf6→#9b7ef2) + 흰 M 스트로크 + 옐로 도트.
 *
 * 모바일 앱 아이콘·데스크탑 위젯 아이콘과 같은 마스터를 쓴다(비율 96 viewBox 기준).
 * 24px 미만으로는 쓰지 않는다 — 그 크기에서는 도트를 뺀 변형이 필요하다(핸드오프 "사이즈별 규칙").
 */
export function BrandMark({ className, size }: { className?: string; size?: number }) {
  const gid = useId();
  return (
    <svg
      viewBox="0 0 96 96"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6b7cf6" />
          <stop offset="1" stopColor="#9b7ef2" />
        </linearGradient>
      </defs>
      <rect width="96" height="96" rx="23" fill={`url(#${gid})`} />
      <path
        d="M26 64 V34 L48 57 L70 34 V64"
        stroke="#ffffff"
        strokeWidth="8.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="48" cy="68" r="4.5" fill="#ffd166" />
    </svg>
  );
}
