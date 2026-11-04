import { Platform, Pressable, Text, View } from "react-native";

import { useTheme } from "@/theme/useTheme";
import { type GlassTabBarProps } from "./GlassTabBar";

/** 레일 폭 — 데스크탑 위젯 창(560)에서 콘텐츠 472 를 남긴다(WID-P0 때부터의 값). */
export const SIDE_RAIL_WIDTH = 88;

/**
 * 좌측 세로 레일(2026-11-04, 데스크탑 위젯·PWA 전용) — 모바일 글라스 플로팅 탭 바(GlassTabBar)의 세로판.
 * react-navigation 기본 바(material 변형, 불투명 흰 면)를 대신하는 커스텀 tabBar 라 변형(variant) 함정과 무관하다.
 *
 * 규격: 반투명 글라스 면(웹 backdrop-filter) + 오른쪽 hairline, 항목은 아이콘 22 + 라벨 11/500 을 세로로,
 * 선택 항목은 pillSelected 상자(64×56, 반경 10) 위에 primary 색·600. 뱃지는 tabBarIcon 안에서 그대로 온다.
 * 셸 바탕 그라데이션(ThemeProvider 루트의 ShellBackground)이 레일 뒤로 비친다.
 */
export function SideRail({ state, descriptors, navigation }: GlassTabBarProps) {
  const { c, dark } = useTheme();
  const routes = state.routes.filter((r) => {
    const o = descriptors[r.key]?.options ?? {};
    return o.href !== null && o.tabBarButton == null && o.tabBarItemStyle?.display !== "none";
  });
  const glass =
    Platform.OS === "web"
      ? ({ backdropFilter: "blur(18px) saturate(1.3)", WebkitBackdropFilter: "blur(18px) saturate(1.3)" } as object)
      : null;

  return (
    <View
      accessibilityRole="tablist"
      style={[
        {
          width: SIDE_RAIL_WIDTH,
          paddingTop: 14,
          paddingHorizontal: 12,
          gap: 6,
          backgroundColor: dark ? "rgba(24,26,33,0.86)" : "rgba(255,255,255,0.72)",
          borderRightColor: dark ? c.border : "rgba(255,255,255,0.75)",
          borderRightWidth: 1,
        },
        glass,
      ]}
      className="items-stretch">
      {routes.map((route) => {
        const focused = state.routes[state.index]?.key === route.key;
        const o = descriptors[route.key]?.options ?? {};
        const color = focused ? c.primary : c.muted;
        const onPress = () => {
          const ev = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !ev.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={o.tabBarAccessibilityLabel ?? o.title ?? route.name}
            style={{ height: 56, borderRadius: 10, backgroundColor: focused ? c.pillSelected : "transparent" }}
            className="items-center justify-center gap-1 active:opacity-70">
            {o.tabBarIcon ? o.tabBarIcon({ focused, color, size: 22 }) : null}
            <Text style={{ color }} className={`text-[11px] ${focused ? "font-semibold" : "font-medium"}`}>
              {o.title ?? route.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
