import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

/**
 * 카드 프레임 — **앱 전 화면의 기본 묶음 단위**.
 *
 * 규격은 모바일 홈 개편 핸드오프(확정안 2a "소프트 플랫"): 배경 card · 테두리 1px ·
 * radius 16 · padding 16 · 타이틀 14px/700. 그림자는 웹 글라스에 해당하는 아주 얕은 한 겹.
 * 원칙: 박스는 배경 채움 대신 윤곽선 기본, 강조만 tint(웹 UI 규칙과 동일).
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
  children?: ReactNode;
}) {
  const hasHead = !!(title || right || action || badge);
  const inner = (
    <>
      {hasHead ? (
        <View className="mb-2 flex-row items-center gap-2">
          {icon}
          {title ? <Text className="text-[14px] font-bold text-cd-text">{title}</Text> : null}
          {badge}
          <View className="flex-1" />
          {right}
          {action ? (
            <Pressable onPress={action.onPress} hitSlop={8} className="active:opacity-60">
              <Text className="text-[12px] font-semibold text-cd-primary">{action.label}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {children}
      {footer ? <View className="mt-2">{footer}</View> : null}
    </>
  );

  const cls = "rounded-card border border-cd-border bg-cd-card p-4";
  // 캔버스와 카드가 같은 흰색이라 경계는 전적으로 테두리가 진다(theme/tokens.ts 참고).
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
