import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/theme/useTheme";
import { AppHeader } from "./AppHeader";

/**
 * 화면 자체 헤더 — 네비게이터 헤더를 끈 화면이 쓴다.
 *
 * `home`(뒤로가기 없음, 홈 인사말): 바탕 위에 제목 22/600 + 부제 12 — 홈만 이 모양이다.
 * 그 밖(뒤로가기가 있거나 `sub`): 공용 AppHeader(카드 면 + hairline, 남색 셰브론, 제목 16/600) — 2026-11-04 사용자 결정으로
 * 홈·전체 메뉴를 뺀 모든 화면의 상단이 같은 모양이다.
 * ⚠ 네비게이터 헤더 옵션은 반드시 `_layout.tsx` 에서 정적으로 정의한다 —
 *   화면 안에서 `<Stack.Screen options>` 를 인라인 렌더하면 iOS 에서 헤더 갱신 루프가 생긴다.
 */
export function ScreenHeader({
  title,
  subtitle,
  back,
  right,
  variant = 'home',
}: {
  title: string;
  subtitle?: string;
  /** 뒤로가기 버튼(스택 화면). */
  back?: boolean;
  right?: ReactNode;
  variant?: 'home' | 'sub';
}) {
  if (back || variant === 'sub') {
    return <AppHeader title={title} subtitle={subtitle} back={back} right={right} />;
  }
  return (
    <View className="flex-row items-center justify-between px-4 pb-4 pt-3">
      <View className="flex-1">
        <Text numberOfLines={1} className="text-[22px] font-semibold tracking-tight text-cd-text">
          {title}
        </Text>
        {subtitle ? <Text className="mt-0.5 text-[12px] text-cd-muted">{subtitle}</Text> : null}
      </View>
      {right ? <View className="flex-row items-center gap-2 pl-2">{right}</View> : null}
    </View>
  );
}

/** 헤더 우측의 36px 원형 아이콘 버튼(알림 등) — 카드 면 + 테두리(ghost). */
export function HeaderIconButton({
  icon,
  onPress,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  /** 접근성 이름(아이콘만 있는 버튼). */
  label?: string;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-9 w-9 items-center justify-center rounded-full border border-cd-border bg-cd-card active:bg-cd-surface">
      <Ionicons name={icon} size={18} color={c.text} />
    </Pressable>
  );
}
