import { StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Defs, Ellipse, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";

import { SHELL } from "./tokens";
import { useTheme } from "./useTheme";

/**
 * 앱 셸 바탕 — 웹 셸(`cd-shell`)과 같은 구성을 모바일에 옮긴 것(2026-11-04 사용자 결정).
 * 160° 그라데이션(쿨그레이 → 베이지) 위에 흐린 빛 두 점(좌상단 쿨·우하단 웜). 다크는 단색.
 *
 * ThemeProvider 루트에 한 번만 깔고 모든 화면 루트는 투명으로 둔다 — 화면마다 바탕을 칠하면 이 레이어가 가려진다.
 * RN 에는 CSS 그라데이션·blur 가 없어 react-native-svg 로 그린다(빛 점은 radial gradient 로 번짐을 흉내).
 * ⚠ viewBox + preserveAspectRatio="none" 조합은 실기기에서 그라데이션이 보이지 않았다(11-04) →
 *   창 크기를 받아 **픽셀 단위**로 그린다(웹도 같은 방식이라 플랫폼 분기가 없다).
 */
export function ShellBackground() {
  const { c, dark } = useTheme();
  const { width, height } = useWindowDimensions();
  if (dark) {
    return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]} />;
  }
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: SHELL.mid, overflow: "hidden" }]}>
      <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="shell-g" x1="0" y1="0" x2={w} y2={h} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={SHELL.from} />
            <Stop offset="0.55" stopColor={SHELL.mid} />
            <Stop offset="1" stopColor={SHELL.to} />
          </LinearGradient>
          {/* 빛 점 — 웹 셸(불투명도 .45/.5 + blur 90px)을 radial 로 흉내. 중심을 진하게 두고 가장자리로 사라지게. */}
          <RadialGradient id="shell-cool" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={SHELL.glowCool} stopOpacity={0.9} />
            <Stop offset="0.45" stopColor={SHELL.glowCool} stopOpacity={0.35} />
            <Stop offset="1" stopColor={SHELL.glowCool} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="shell-warm" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={SHELL.glowWarm} stopOpacity={0.95} />
            <Stop offset="0.45" stopColor={SHELL.glowWarm} stopOpacity={0.4} />
            <Stop offset="1" stopColor={SHELL.glowWarm} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={w} height={h} fill="url(#shell-g)" />
        <Ellipse cx={w * 0.1} cy={h * 0.06} rx={w * 0.62} ry={h * 0.24} fill="url(#shell-cool)" />
        <Ellipse cx={w * 0.95} cy={h * 0.92} rx={w * 0.66} ry={h * 0.26} fill="url(#shell-warm)" />
      </Svg>
    </View>
  );
}
