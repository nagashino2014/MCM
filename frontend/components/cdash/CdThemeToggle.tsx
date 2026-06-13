"use client";

import { Moon, Sun } from "lucide-react";
import type { CdTheme } from "./useCdashTheme";

/** cd-chip 스타일의 라이트/다크 토글 버튼 (계약 대시보드와 동일 외형). */
export function CdThemeToggle({
  theme,
  onToggle,
}: {
  theme: CdTheme;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="cd-chip"
      aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
    >
      {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
      {theme === "dark" ? "라이트" : "다크"}
    </button>
  );
}
