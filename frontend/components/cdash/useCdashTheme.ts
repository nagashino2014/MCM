"use client";

import { useEffect, useState } from "react";

export type CdTheme = "light" | "dark";
const THEME_STORAGE_KEY = "cdash-theme";
const THEME_EVENT = "cdash-theme-change";
// 저장소를 사용할 수 없는 환경에서도 현재 탭의 선택을 유지한다.
let sessionPreference: CdTheme | null = null;
const isTheme = (value: unknown): value is CdTheme => value === "light" || value === "dark";
function savedTheme(): CdTheme | null {
  try { const value = localStorage.getItem(THEME_STORAGE_KEY); return isTheme(value) ? value : null; }
  catch { return null; }
}
function preferredTheme(fallback: CdTheme): CdTheme {
  return sessionPreference ?? savedTheme() ?? (typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light" : fallback);
}

/** 저장된 사용자 선택 → 시스템 테마 → 라이트. 포털·동일 탭·다른 탭을 동기화한다. */
export function useCdashTheme(defaultTheme: CdTheme = "light") {
  const [theme, setThemeState] = useState<CdTheme>(defaultTheme);
  useEffect(() => {
    const apply = (next: CdTheme) => {
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
      setThemeState(next);
    };
    const sync = () => apply(preferredTheme(defaultTheme));
    const syncStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
      sessionPreference = null;
      sync();
    };
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    sync();
    window.addEventListener("storage", syncStorage);
    window.addEventListener(THEME_EVENT, sync);
    media?.addEventListener("change", sync);
    return () => {
      window.removeEventListener("storage", syncStorage);
      window.removeEventListener(THEME_EVENT, sync);
      media?.removeEventListener("change", sync);
    };
  }, [defaultTheme]);

  const setTheme = (next: CdTheme) => {
    sessionPreference = next;
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* 선택은 현재 탭에서 유지한다. */ }
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    setThemeState(next);
    window.dispatchEvent(new Event(THEME_EVENT));
  };
  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");
  return { theme, setTheme, toggleTheme };
}
