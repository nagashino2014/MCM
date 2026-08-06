import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { useTheme } from "@/theme/useTheme";

/**
 * 화면 자체 헤더 — 네비게이터 헤더를 끈 화면이 쓴다(핸드오프 2a §1).
 *
 * 제목 21px/700 + 부제 12 faint, 우측은 38px 원형 아이콘 버튼 슬롯.
 * ⚠ 네비게이터 헤더 옵션은 반드시 `_layout.tsx` 에서 정적으로 정의한다 —
 *   화면 안에서 `<Stack.Screen options>` 를 인라인 렌더하면 iOS 에서 헤더 갱신 루프가 생긴다.
 */
export function ScreenHeader({
  title,
  subtitle,
  back,
  right,
}: {
  title: string;
  subtitle?: string;
  /** 뒤로가기 버튼(스택 화면). */
  back?: boolean;
  right?: ReactNode;
}) {
  const { c } = useTheme();
  const router = useRouter();
  return (
    <View className="flex-row items-center justify-between px-[22px] pb-4 pt-3">
      {back ? (
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          className="mr-1 h-9 w-9 items-center justify-center rounded-full active:opacity-60">
          <Ionicons name="chevron-back" size={24} color={c.text} />
        </Pressable>
      ) : null}
      <View className="flex-1">
        <Text numberOfLines={1} className="text-[21px] font-bold tracking-tight text-cd-text">
          {title}
        </Text>
        {subtitle ? <Text className="mt-[3px] text-[12px] text-cd-faint">{subtitle}</Text> : null}
      </View>
      {right ? <View className="flex-row items-center gap-2.5 pl-2">{right}</View> : null}
    </View>
  );
}

/** 헤더 우측의 38px 원형 아이콘 버튼(알림 등). */
export function HeaderIconButton({
  icon,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      className="h-[38px] w-[38px] items-center justify-center rounded-full border border-cd-border bg-cd-card active:opacity-70">
      <Ionicons name={icon} size={19} color={c.body} />
    </Pressable>
  );
}
