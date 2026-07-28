import { useContext } from "react";
import { useColorScheme } from "react-native";

import { ThemeContext, type ThemeState } from "./ThemeProvider";
import { DARK, LIGHT } from "./tokens";

/**
 * 현재 적용 중인 cdash 팔레트.
 * 기본은 OS 설정을 따르고, 설정 화면에서 라이트/다크를 직접 고르면 그 값이 우선한다.
 */
export function useTheme(): { dark: boolean; c: ThemeState["c"] } {
  const ctx = useContext(ThemeContext);
  // Provider 밖(부팅 초기 등)에서도 안전하게 — 시스템 스킴으로 폴백.
  const system = useColorScheme() === "dark";
  if (!ctx) return { dark: system, c: system ? DARK : LIGHT };
  return { dark: ctx.dark, c: ctx.c };
}

/** 테마 선택 UI(설정 화면)에서 쓰는 전체 상태. */
export function useThemeMode(): ThemeState | null {
  return useContext(ThemeContext);
}
