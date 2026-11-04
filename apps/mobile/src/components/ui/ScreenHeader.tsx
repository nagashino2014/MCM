import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { useTheme } from "@/theme/useTheme";

/**
 * 화면 자체 헤더(PageHeader) — 네비게이터 헤더를 끈 화면이 쓴다. 바탕(canvas) 위에 바로 놓이는 유일한 글자다.
 *
 * 제목 22/600 ink(자간 -0.01em) + 부제 12 ink-muted. 배경 카드·그림자·아이콘 없음. 우측은 36px 아이콘 버튼 슬롯.
 * `home`(인사말) / `sub`(하위 화면, 뒤로가기) 두 변형은 같은 크기 — 화면 성격만 다르다.
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
  const { c } = useTheme();
  const router = useRouter();
  return (
    <View className={`flex-row items-center justify-between px-4 ${variant === 'sub' ? 'pb-3 pt-3' : 'pb-4 pt-3'}`}>
      {back ? (
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="뒤로"
          className="-ml-2 mr-1 h-10 w-10 items-center justify-center rounded-lg active:bg-cd-surface">
          <Ionicons name="chevron-back" size={22} color={c.text} />
        </Pressable>
      ) : null}
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
