"use client";

// cdash 공통 빈 상태 — 목록/검색 결과 없음 표준 표현(G0).
// 아이콘 + 제목 + 설명 + (선택) 액션 버튼.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface CdEmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode; // 보통 <CdButton variant="primary">…</CdButton>
  className?: string;
}

export function CdEmptyState({ icon, title, description, action, className }: CdEmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 py-12 px-6 text-center", className)}>
      {icon && (
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center mb-1"
          style={{ background: "var(--cd-primary-soft)", color: "var(--cd-primary)" }}
        >
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold cd-text">{title}</p>
      {description && <p className="text-xs cd-text-faint max-w-sm">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
