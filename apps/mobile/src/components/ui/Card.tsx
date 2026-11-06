import { type ReactNode } from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "@/theme/useTheme";
import { SHADOW_CARD } from "@/theme/tokens";

/**
 * 카드 — **앱 전 화면의 기본 묶음 단위**(KESI Frosted 2026-11-03).
 *
 * 흰 면(card) + 옅은 바깥 테두리(card-border) 1px + 반경 10 + 1단 부드러운 그림자. 안쪽 여백 16(모바일),
 * 제목 16/600, 제목 줄과 본문 사이 12. 카드는 콘텐츠 그룹 단위다 — 카드 안에 카드를 넣지 않고, 목록 항목은 행(hairline)으로 나눈다.
 * 상단·좌측 색 막대, 제목 아이콘 배경, 그라데이션·반투명은 쓰지 않는다.
 *
 * ⚠ 화면마다 카드를 직접 그리지 말 것 — 두 벌이 되면 반드시 갈라진다.
 */
export function Card({
  title,
  icon,
  badge,
  right,
  action,
  footer,
  onPress,
  flat,
  flush,
  style: outerStyle,
  children,
}: {
  title?: string;
  icon?: ReactNode;
  /** 타이틀 옆 카운트 배지(`<Badge>` 등). */
  badge?: ReactNode;
  /** 헤더 우측 자유 슬롯. `action` 과 함께 쓰면 왼쪽에 놓인다. */
  right?: ReactNode;
  /** 헤더 우측 텍스트 링크("전체보기"·"경과 입력"). */
  action?: { label: string; onPress: () => void };
  footer?: ReactNode;
  onPress?: () => void;
  /** 카드 안·시트 안에 놓이는 카드 — 그림자 없음(그림자는 바탕 위 첫 겹에만). */
  flat?: boolean;
  /** 행 목록처럼 가장자리까지 쓰는 카드 — 안쪽 여백 없음(제목 줄에만 여백). */
  flush?: boolean;
  /** 바깥 상자에 더하는 스타일 — 높이를 옆 열에 맞춰 고정할 때만 쓴다(홈 2열의 캘린더 카드). 색·테두리·반경은 여기서 바꾸지 않는다. */
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const { c, dark } = useTheme();
  const hasHead = !!(title || right || action || badge);
  const inner = (
    <>
      {hasHead ? (
        <View className={`flex-row items-center gap-2 ${flush ? "px-4 pb-2 pt-4" : "mb-3"}`}>
          {icon}
          {title ? <Text className="text-[16px] font-semibold text-cd-text">{title}</Text> : null}
          {badge}
          <View className="flex-1" />
          {right}
          {action ? (
            <Pressable onPress={action.onPress} hitSlop={8} accessibilityRole="link" className="active:opacity-60">
              <Text className="text-[13px] font-medium text-cd-primary">{action.label}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {children}
      {footer ? <View className={`mt-3 ${flush ? "px-4 pb-4" : ""}`}>{footer}</View> : null}
    </>
  );

  const cls = `rounded-lg border bg-cd-card ${flush ? "" : "p-4"}`;
  const style = [{ borderColor: c.cardBorder }, flat ? null : dark ? SHADOW_CARD.dark : SHADOW_CARD.light, outerStyle];

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={style} className={`${cls} active:opacity-80`}>
        {inner}
      </Pressable>
    );
  }
  return (
    <View style={style} className={cls}>
      {inner}
    </View>
  );
}
