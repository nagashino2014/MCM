import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme, View } from "react-native";
import { vars } from "nativewind";

import { DARK, LIGHT, paletteVars, type CdPalette } from "./tokens";
import { kvGet, kvSet } from "../lib/kv";

export type ThemeMode = "system" | "light" | "dark";

export interface ThemeState {
  /** 사용자가 고른 값(system 이면 OS 설정을 따른다). */
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  /** 실제 적용 중인 스킴. */
  dark: boolean;
  c: CdPalette;
}

const KEY = "theme.mode";

export const ThemeContext = createContext<ThemeState | null>(null);

/**
 * 테마 공급자 — cdash 토큰(--cd-*)을 **런타임에 주입**한다.
 *
 * global.css 의 `@media (prefers-color-scheme: dark)` 만으로는 OS 설정밖에 못 따르므로,
 * 사용자가 라이트/다크를 직접 고를 수 있도록 nativewind `vars()` 로 루트에 값을 덮어쓴다.
 * (media query 정의는 폴백으로 남겨둔다 — 주입이 닿지 않는 경계에서도 색이 나오게.)
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme() === "dark";
  const [mode, setModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    void (async () => {
      const saved = await kvGet<ThemeMode>(KEY);
      if (saved && ["system", "light", "dark"].includes(saved.value)) setModeState(saved.value);
    })();
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    void kvSet(KEY, m);
  }, []);

  const dark = mode === "system" ? system : mode === "dark";
  const palette = dark ? DARK : LIGHT;

  const value = useMemo<ThemeState>(
    () => ({ mode, setMode, dark, c: palette }),
    [mode, setMode, dark, palette]
  );

  return (
    <ThemeContext.Provider value={value}>
      <View style={vars(paletteVars(palette))} className="flex-1">
        {children}
      </View>
    </ThemeContext.Provider>
  );
}

/**
 * RN `Modal` 은 별도 뷰 계층으로 렌더돼 루트의 변수 주입이 닿지 않을 수 있다.
 * 모달 내용은 이 래퍼로 감싸 변수를 다시 주입한다(웹 cdash 의 포털 `cdash-vars` 와 같은 이유).
 */
export function ThemeVarsScope({ children }: { children: React.ReactNode }) {
  const ctx = useContext(ThemeContext);
  const palette = ctx?.c ?? LIGHT;
  return (
    <View style={vars(paletteVars(palette))} className="flex-1">
      {children}
    </View>
  );
}
