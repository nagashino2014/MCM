import { StyleSheet, View, useWindowDimensions } from "react-native";

import { SHELL } from "./tokens";
import { useTheme } from "./useTheme";

/**
 * 앱 셸 바탕 — 웹 셸(`cd-shell`)과 같은 구성을 모바일에 옮긴 것(2026-11-04 사용자 결정).
 * 위→아래 그라데이션(쿨그레이 → 베이지) 위에 흐린 빛 두 점(좌상단 쿨·우하단 웜). 다크는 단색.
 *
 * ⚠ 두 번의 실기기 실패 끝의 구현(11-04): react-native-svg 그라데이션은 ThemeProvider 루트에 깔면 네이티브 스택 화면이
 *   가려 보이지 않았다(웹에서는 보임). 그래서 ① **화면 루트(SafeAreaView) 안**에서 그리고(Screen.tsx 와 자체 헤더 화면들),
 *   ② SVG 없이 **View 띠 + 동심원**만으로 그린다 — 대비가 작아 띠 경계는 보이지 않고, 원을 겹쳐 번짐을 흉내낸다.
 *   화면마다 한 번씩 그리지만 정적 View 50개 남짓이라 가볍다. ThemeProvider 루트의 것은 폴백(웹·로딩 화면).
 */
const STEPS = 32;
const RINGS = 10;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bb = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${bb})`;
}
const BANDS: string[] = Array.from({ length: STEPS }, (_, i) => {
  const t = i / (STEPS - 1);
  return t < 0.55 ? mix(SHELL.from, SHELL.mid, t / 0.55) : mix(SHELL.mid, SHELL.to, (t - 0.55) / 0.45);
});

/** 흐린 빛 점 — 같은 중심의 원 RINGS 개를 낮은 불투명도로 겹쳐 가장자리로 갈수록 옅어지게. */
function Glow({ cx, cy, r, color, alpha }: { cx: number; cy: number; r: number; color: string; alpha: number }) {
  const [cr, cg, cb] = hexToRgb(color);
  const each = 1 - Math.pow(1 - alpha, 1 / RINGS); // RINGS 겹이 중심에서 alpha 가 되도록
  return (
    <>
      {Array.from({ length: RINGS }, (_, k) => {
        const rr = r * (1 - k / RINGS);
        return (
          <View
            key={k}
            pointerEvents="none"
            style={{
              position: "absolute",
              left: cx - rr,
              top: cy - rr,
              width: rr * 2,
              height: rr * 2,
              borderRadius: rr,
              backgroundColor: `rgba(${cr},${cg},${cb},${each.toFixed(3)})`,
            }}
          />
        );
      })}
    </>
  );
}

export function ShellBackground() {
  const { c, dark } = useTheme();
  const { width, height } = useWindowDimensions();
  if (dark) {
    return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]} />;
  }
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const bandH = h / STEPS;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: SHELL.mid, overflow: "hidden" }]}>
      {BANDS.map((col, i) => (
        <View key={i} style={{ position: "absolute", left: 0, right: 0, top: i * bandH - 1, height: bandH + 2, backgroundColor: col }} />
      ))}
      <Glow cx={w * 0.1} cy={h * 0.06} r={w * 0.62} color={SHELL.glowCool} alpha={0.55} />
      <Glow cx={w * 0.95} cy={h * 0.93} r={w * 0.66} color={SHELL.glowWarm} alpha={0.6} />
    </View>
  );
}
