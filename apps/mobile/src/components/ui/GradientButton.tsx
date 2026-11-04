import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/useTheme';

/**
 * 구 CTA 그라데이션 버튼 묶음 — KESI Frosted(2026-11-03)로 **그라데이션을 폐기**하고 남색 단색(primary-fill)으로 바꿨다.
 * 호출처(명함·영수증·담당자·대화 등 20여 곳)를 바꾸지 않도록 이름과 props 는 그대로 둔다. 새 코드는 `Button`·`PrimaryIconButton` 을 쓴다.
 */

/** 호환 상수 — 그라데이션 양 끝이던 값. 이제 둘 다 주 버튼 채움색. */
export const CTA_FROM = '#4a63d8';
export const CTA_TO = '#4a63d8';
export const CTA_SOFT_FROM = '#eef1fb';
export const CTA_SOFT_TO = '#eef1fb';

/**
 * 버튼 배경 채움 — 부모가 `overflow-hidden` + 라운드를 갖고 이걸 첫 자식으로 깐다(호출처 계약 유지).
 * `soft` 는 호출처가 흰 글자를 전제하므로 채움색을 바꾸지 않는다(같은 남색).
 */
export function CtaGradientFill({ soft: _soft }: { soft?: boolean } = {}) {
  const { c } = useTheme();
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.primaryFill }]} />;
}

export function GradientButton({
  label,
  icon,
  onPress,
  loading,
  disabled,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const { c } = useTheme();
  // 비활성 = 반투명 대신 불투명 감쇠색(Button 과 동일 규칙, 2026-08-10 사용자 피드백).
  const dim = !!disabled && !loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={{
        backgroundColor: dim ? c.surface : c.primaryFill,
        borderColor: dim ? c.border : c.primaryFillEdge,
        borderWidth: 1,
      }}
      className="h-11 items-center justify-center rounded-lg active:opacity-80">
      {loading ? (
        <ActivityIndicator color="#ffffff" />
      ) : (
        <View className="flex-row items-center gap-1.5">
          {icon ? <Ionicons name={icon} size={17} color={dim ? c.faint : '#ffffff'} /> : null}
          <Text style={{ color: dim ? c.faint : '#ffffff' }} className="text-[15px] font-medium">
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/**
 * 소형 원형 아이콘 버튼(전화·문자 등) — 기본은 남색 채움 + 흰 아이콘.
 * `soft`(목록에서 반복되는 작은 버튼)는 primary-soft 바탕 + primary-strong 아이콘으로 채도를 낮춘다.
 */
export function GradientIconButton({
  icon,
  onPress,
  diameter = 36,
  iconSize,
  soft,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  diameter?: number;
  iconSize?: number;
  soft?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      style={{
        width: diameter,
        height: diameter,
        backgroundColor: soft ? c.primarySoft : c.primaryFill,
        borderColor: soft ? c.primarySoft : c.primaryFillEdge,
        borderWidth: 1,
      }}
      className="items-center justify-center rounded-full active:opacity-80">
      <Ionicons name={icon} size={iconSize ?? Math.round(diameter * 0.46)} color={soft ? c.primaryStrong : '#ffffff'} />
    </Pressable>
  );
}

/** 보조 버튼 — 카드 바탕 + 테두리(= Button ghost 와 같은 모양, 호환용). */
export function OutlineButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="h-11 flex-row items-center justify-center gap-1.5 rounded-lg border border-cd-border bg-cd-card active:opacity-80">
      {icon ? <Ionicons name={icon} size={16} color={c.text} /> : null}
      <Text className="text-[15px] font-medium text-cd-text">{label}</Text>
    </Pressable>
  );
}
