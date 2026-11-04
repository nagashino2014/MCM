import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/theme/useTheme";

/**
 * 화면 상단 헤더 — **홈·전체 메뉴를 뺀 모든 화면이 같은 모양**(2026-11-04 사용자 결정, 명함 촬영 화면의 형식으로 통일).
 * 카드 면 + 아래 hairline, 왼쪽 뒤로가기(남색 셰브론 24, 40×40), 제목 16/600, 부제 12 ink-muted, 오른쪽 슬롯.
 * 안전영역(상단)은 호출한 쪽(SafeAreaView)이 처리한다 — 네비게이터가 그리는 경우는 NavHeader 가 더한다.
 */
export function AppHeader({
  title,
  subtitle,
  back,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  onBack?: () => void;
  right?: ReactNode;
}) {
  const { c } = useTheme();
  const router = useRouter();
  return (
    <View className="flex-row items-center gap-1 border-b border-cd-border bg-cd-card px-2 py-2">
      {back ? (
        <Pressable
          onPress={() => (onBack ? onBack() : router.back())}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="뒤로"
          className="h-10 w-10 items-center justify-center rounded-lg active:bg-cd-surface">
          <Ionicons name="chevron-back" size={24} color={c.primary} />
        </Pressable>
      ) : (
        <View className="w-2" />
      )}
      <View className="flex-1" style={{ minWidth: 0 }}>
        <Text numberOfLines={1} className="text-[16px] font-semibold text-cd-text">
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} className="text-[12px] text-cd-muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View className="flex-row items-center gap-1 pr-1">{right}</View> : null}
    </View>
  );
}

/** react-navigation(native-stack·bottom-tabs)의 `header` 옵션에 넘기는 것 중 쓰는 것만 — 타입 패키지를 직접 의존하지 않는다. */
export interface NavHeaderProps {
  navigation: { canGoBack: () => boolean; goBack: () => void };
  route: { name: string };
  options: {
    title?: string;
    headerTitle?: string | ((p: unknown) => ReactNode);
    headerRight?: (p: { tintColor?: string; canGoBack: boolean }) => ReactNode;
  };
  /** native-stack 이 넘기는 이전 화면 정보 — 있으면 뒤로가기를 보인다. */
  back?: unknown;
}

/** 네비게이터가 그리는 헤더(`_layout` 의 `header` 옵션) — 상단 안전영역을 더한 AppHeader. */
export function NavHeader({ navigation, route, options, back }: NavHeaderProps) {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const title = typeof options.headerTitle === "string" ? options.headerTitle : options.title ?? route.name;
  const canBack = !!back || navigation.canGoBack();
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: c.card }}>
      <AppHeader
        title={title}
        back={canBack}
        onBack={() => navigation.goBack()}
        right={options.headerRight ? options.headerRight({ tintColor: c.text, canGoBack: canBack }) : undefined}
      />
    </View>
  );
}
