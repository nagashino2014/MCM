"use client";

import { useEffect, useState } from "react";

export type CdTheme = "light" | "dark";

/** 모든 Modernize(cdash) 섹션이 공유하는 테마 저장 키 — 대시보드/빌링과 동일. */
const THEME_STORAGE_KEY = "cdash-theme";
/** 같은 탭 내 여러 useCdashTheme 인스턴스 동기화용 커스텀 이벤트. */
const THEME_EVENT = "cdash-theme-change";

/**
 * cdash 섹션용 라이트/다크 테마 훅.
 * localStorage("cdash-theme") 를 계약 대시보드/빌링과 공유하므로
 * 한 곳에서 테마를 바꾸면 다른 Modernize 화면에도 동일하게 적용된다.
 *
 * 같은 페이지에서 여러 번 호출돼도(예: 페이지 + 포털 모달) storage/커스텀 이벤트로
 * 모든 인스턴스가 동기화된다 — 포털로 body 에 렌더되는 모달도 즉시 테마가 반영된다.
 */
export function useCdashTheme(defaultTheme: CdTheme = "dark") {
  const [theme, setThemeState] = useState<CdTheme>(defaultTheme);

  // 초기 마운트 시 저장된 테마 복원 + 다른 인스턴스 변경 구독
  useEffect(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") setThemeState(saved);

    const sync = () => {
      const cur = localStorage.getItem(THEME_STORAGE_KEY);
      if (cur === "light" || cur === "dark") setThemeState(cur);
    };
    window.addEventListener("storage", sync); // 다른 탭
    window.addEventListener(THEME_EVENT, sync); // 같은 탭
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(THEME_EVENT, sync);
    };
  }, []);

  const setTheme = (next: CdTheme) => {
    localStorage.setItem(THEME_STORAGE_KEY, next);
    setThemeState(next);
    window.dispatchEvent(new Event(THEME_EVENT));
  };

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  return { theme, setTheme, toggleTheme };
}
