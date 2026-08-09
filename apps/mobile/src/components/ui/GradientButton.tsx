import { useId } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

/**
 * 화면 주 CTA — 핸드오프 3a 의 그라데이션 버튼(linear-gradient(135deg,#6b7cf6,#9b7ef2)).
 *
 * RN 에는 CSS 그라데이션이 없다. expo-linear-gradient 를 넣으면 네이티브 모듈이 늘어 EAS 재빌드가
 * 필요해지므로, 이미 쓰는 react-native-svg 로 배경을 깔았다(2차 개편의 OTA 배포 원칙 유지).
 */

export const CTA_FROM = '#6b7cf6';
export const CTA_TO = '#9b7ef2';

/** CTA 그라데이션 배경 채움 — 부모가 `overflow-hidden` + 라운드를 갖고 이걸 첫 자식으로 깐다. */
export function CtaGradientFill() {
  const gid = `cta-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg width="100%" height="100%" style={{ position: 'absolute' }}>
      <Defs>
        <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={CTA_FROM} />
          <Stop offset="1" stopColor={CTA_TO} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${gid})`} />
    </Svg>
  );
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
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={{ opacity: disabled ? 0.5 : 1 }}
      className="h-[46px] items-center justify-center overflow-hidden rounded-[14px] active:opacity-70">
      <CtaGradientFill />
      {loading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <View className="flex-row items-center gap-[7px]">
          {icon ? <Ionicons name={icon} size={17} color="#FFFFFF" /> : null}
          <Text className="text-[14px] font-bold text-white">{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** 소형 원형 아이콘 버튼(전화·문자 등) — CTA 그라데이션 채움 + 흰 아이콘. */
export function GradientIconButton({
  icon,
  onPress,
  diameter = 36,
  iconSize,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  diameter?: number;
  iconSize?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={{ width: diameter, height: diameter }}
      className="items-center justify-center overflow-hidden rounded-full active:opacity-60">
      <CtaGradientFill />
      <Ionicons name={icon} size={iconSize ?? Math.round(diameter * 0.46)} color="#FFFFFF" />
    </Pressable>
  );
}

/** 보조 버튼 — 흰 배경 + 테두리(핸드오프의 '초과/휴일근무 신청'). */
export function OutlineButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="h-[44px] flex-row items-center justify-center gap-[7px] rounded-[14px] border border-cd-border bg-cd-card active:opacity-70">
      {icon ? <Ionicons name={icon} size={16} color="#565e82" /> : null}
      <Text className="text-[13.5px] font-bold" style={{ color: '#565e82' }}>
        {label}
      </Text>
    </Pressable>
  );
}
