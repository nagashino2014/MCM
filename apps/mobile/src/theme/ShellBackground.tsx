import { Platform, StyleSheet, View } from "react-native";
import Svg, { Defs, Ellipse, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";

import { SHELL } from "./tokens";
import { useTheme } from "./useTheme";

/**
 * 앱 셸 바탕 — 웹 셸(`cd-shell`)과 같은 구성을 모바일에 연하게 옮긴 것(2026-11-04 사용자 결정).
 * 160° 그라데이션(쿨그레이 → 베이지) 위에 흐린 빛 두 점(좌상단 쿨·우하단 웜). 다크는 단색.
 *
 * ThemeProvider 루트에 한 번만 깔고 모든 화면 루트는 투명으로 둔다 — 화면마다 바탕을 칠하면 이 레이어가 가려진다.
 * RN 에는 CSS 그라데이션·blur 가 없어 react-native-svg 로 그린다(빛 점은 radial gradient 로 번짐을 흉내).
 * ⚠ SVG 크기 지정은 플랫폼별로 다르다(GradientButton 의 실측 사고와 같은 이유): 네이티브 = absoluteFill, 웹 = + width/height 100%.
 */
export function ShellBackground() {
  const { c, dark } = useTheme();
  if (dark) {
    return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]} />;
  }
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: SHELL.mid, overflow: "hidden" }]}>
      <Svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={
          Platform.OS === "web"
            ? [StyleSheet.absoluteFill, { width: "100%", height: "100%" } as object]
            : StyleSheet.absoluteFill
        }>
        <Defs>
          <LinearGradient id="shell-g" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={SHELL.from} />
            <Stop offset="0.55" stopColor={SHELL.mid} />
            <Stop offset="1" stopColor={SHELL.to} />
          </LinearGradient>
          <RadialGradient id="shell-cool" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={SHELL.glowCool} stopOpacity={0.5} />
            <Stop offset="1" stopColor={SHELL.glowCool} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="shell-warm" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={SHELL.glowWarm} stopOpacity={0.55} />
            <Stop offset="1" stopColor={SHELL.glowWarm} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={100} height={100} fill="url(#shell-g)" />
        <Ellipse cx={14} cy={10} rx={42} ry={20} fill="url(#shell-cool)" />
        <Ellipse cx={90} cy={92} rx={44} ry={22} fill="url(#shell-warm)" />
      </Svg>
    </View>
  );
}
