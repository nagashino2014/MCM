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
  // 캔버스와 카드가 같은 흰색이라 경계는 전적으로 테두리가 진다(theme/tokens.ts 참고).
  // 웹의 글라스 그림자에 해당하는 아주 얕은 그림자를 한 겹만 더해 카드를 살짝 띄운다.
  const shadow = {
    shadowColor: "#505F96",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  } as const;

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={shadow} className={`${cls} active:opacity-70`}>
        {inner}
      </Pressable>
    );
  }
  return (
    <View style={shadow} className={cls}>
      {inner}
    </View>
  );
}
