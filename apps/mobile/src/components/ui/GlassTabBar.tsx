import { Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/theme/useTheme";
import { SHADOW_POPOVER } from "@/theme/tokens";

/**
 * 글라스 플로팅 탭 바(2026-11-04 사용자 결정) — 화면 바닥에 붙은 흰 바 대신 좌우 16, 홈 인디케이터 위로 띄운
 * 반투명 바(높이 64, 반경 10, 흰 75% 테두리, popover 그림자). 셸 크롬에만 허용되는 글라스다.
 *
 * blur 는 웹(backdrop-filter)에서만 실제로 걸린다 — 네이티브는 expo-blur 가 설치돼 있지 않아(OTA 로 네이티브 모듈을 더할 수 없다)
 * 반투명 흰색으로 근사한다. 콘텐츠가 바 뒤로 비치려면 scene 바탕이 투명이고 각 탭 화면의 스크롤 하단 여백이 TAB_BAR_INSET 이어야 한다.
 */
export const GLASS_TAB_BAR_HEIGHT = 64;
/** 바와 홈 인디케이터(안전영역) 사이 간격. */
export const GLASS_TAB_BAR_GAP = 8;
/** 탭 화면 스크롤 콘텐츠의 하단 여백(안전영역 제외) — 바 높이 + 간격 + 바 위 여백. */
export const TAB_BAR_INSET = GLASS_TAB_BAR_HEIGHT + GLASS_TAB_BAR_GAP + 24;

/** 탭 화면의 떠 있는 버튼(FAB)이 바 위에 놓이도록 하는 bottom 값 — 안전영역 + 바 + 간격 + 16. */
export function useTabBarFabBottom(): number {
  const insets = useSafeAreaInsets();
  return insets.bottom + GLASS_TAB_BAR_GAP + GLASS_TAB_BAR_HEIGHT + 16;
}

interface TabRoute {
  key: string;
  name: string;
  params?: object;
}
interface TabOptions {
  title?: string;
  href?: unknown;
  tabBarButton?: unknown;
  tabBarItemStyle?: { display?: string } | null;
  tabBarIcon?: (p: { focused: boolean; color: string; size: number }) => React.ReactNode;
  tabBarAccessibilityLabel?: string;
}
/** react-navigation BottomTabBarProps 중 쓰는 것만 — 타입 패키지를 직접 의존하지 않는다(expo-router 가 내부 의존). */
export interface GlassTabBarProps {
  state: { index: number; routes: TabRoute[] };
  descriptors: Record<string, { options: TabOptions }>;
  navigation: {
    emit: (e: { type: string; target: string; canPreventDefault: boolean }) => { defaultPrevented: boolean };
    navigate: (name: string, params?: object) => void;
  };
}

export function GlassTabBar({ state, descriptors, navigation }: GlassTabBarProps) {
  const { c, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const routes = state.routes.filter((r) => {
    const o = descriptors[r.key]?.options ?? {};
    // expo-router 의 `href: null`(탭에서 감춤) — 옵션에 href null 이 남거나 tabBarButton/display none 으로 변환된다.
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
          position: "absolute",
          left: 16,
          right: 16,
          bottom: insets.bottom + GLASS_TAB_BAR_GAP,
          height: GLASS_TAB_BAR_HEIGHT,
          backgroundColor: dark ? "rgba(24,26,33,0.86)" : "rgba(255,255,255,0.8)",
          borderColor: dark ? c.border : "rgba(255,255,255,0.75)",
          borderWidth: 1,
        },
        dark ? SHADOW_POPOVER.dark : SHADOW_POPOVER.light,
        glass,
      ]}
      className="flex-row items-stretch rounded-lg">
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
            className="flex-1 items-center justify-center gap-1 active:opacity-70">
            {o.tabBarIcon ? o.tabBarIcon({ focused, color, size: 22 }) : null}
            <Text style={{ color }} className="text-[11px] font-medium">
              {o.title ?? route.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
