import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

/**
 * 카드 프레임 — 웹 `.cd-card`(배경 card + 1px border + radius 20) 대응.
 * 원칙: 박스는 배경 채움 대신 윤곽선 기본, 강조만 tint(웹 UI 규칙과 동일).
 */
export function Card({
  title,
  icon,
  right,
  footer,
  onPress,
  children,
}: {
  title?: string;
  icon?: ReactNode;
  right?: ReactNode;
  footer?: ReactNode;
  onPress?: () => void;
  children?: ReactNode;
}) {
  const inner = (
    <>
      {title || right ? (
        <View className="mb-2 flex-row items-center gap-2">
          {icon}
          {title ? (
            <Text className="flex-1 text-[15px] font-extrabold text-cd-text">{title}</Text>
          ) : (
            <View className="flex-1" />
          )}
          {right}
        </View>
      ) : null}
      {children}
      {footer ? <View className="mt-2">{footer}</View> : null}
    </>
  );

  const cls = "rounded-card border border-cd-border bg-cd-card p-4";

  if (onPress) {
    return (
      <Pressable onPress={onPress} className={`${cls} active:opacity-70`}>
        {inner}
      </Pressable>
    );
  }
  return <View className={cls}>{inner}</View>;
}
