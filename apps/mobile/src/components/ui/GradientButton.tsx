import { useId } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { useTheme } from '@/theme/useTheme';

/**
 * 화면 주 CTA — 핸드오프 3a 의 그라데이션 버튼(linear-gradient(135deg,#6b7cf6,#9b7ef2)).
 *
 * RN 에는 CSS 그라데이션이 없다. expo-linear-gradient 를 넣으면 네이티브 모듈이 늘어 EAS 재빌드가
 * 필요해지므로, 이미 쓰는 react-native-svg 로 배경을 깔았다(2차 개편의 OTA 배포 원칙 유지).
 */

export const CTA_FROM = '#6b7cf6';
export const CTA_TO = '#9b7ef2';

/**
 * 연한 변형 — 같은 그라데이션을 흰색과 섞은 톤.
 * 목록 안에서 여러 번 반복되는 작은 버튼·타일은 원본 채도가 튀어서(2026-08-10 사용자 피드백) 이걸 쓴다.
 */
export const CTA_SOFT_FROM = '#8f9bf8';
export const CTA_SOFT_TO = '#b39ef5';

/** CTA 그라데이션 배경 채움 — 부모가 `overflow-hidden` + 라운드를 갖고 이걸 첫 자식으로 깐다. */
export function CtaGradientFill({ soft }: { soft?: boolean } = {}) {
  const gid = `cta-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    // ⚠ 크기 지정은 플랫폼별로 다르다 — 세 번의 실측 사고 끝의 결론:
    //   ① props width/height="100%" + inset 없는 absolute = 네이티브에서 부모 "패딩 안쪽" 기준이라
    //      패딩 있는 버튼(Button md)에서 쪼그라든 직사각형.
    //   ② props 100% 와 style inset 병기 = 스타일 병합 충돌로 버튼 높이가 늘어나 화면 밖으로 잘림.
    //   ③ inset 만 지정 = 네이티브는 stretch 되지만 웹에선 SVG 가 대체 요소라 고유 기본 크기(300×150)로 남음.
    //   → 네이티브 = absoluteFill(inset 에서 크기 도출), 웹 = absoluteFill + width/height 100%(CSS 기준은 버튼 전체).
    <Svg
      style={
        Platform.OS === 'web'
          ? [StyleSheet.absoluteFill, { width: '100%', height: '100%' } as object]
          : StyleSheet.absoluteFill
      }>
      <Defs>
        <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={soft ? CTA_SOFT_FROM : CTA_FROM} />
          <Stop offset="1" stopColor={soft ? CTA_SOFT_TO : CTA_TO} />
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
  // 비활성 = 반투명 대신 불투명 감쇠색(Button 과 동일 규칙, 2026-08-10 사용자 피드백).
  const dim = !!disabled && !loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      className={`h-[46px] items-center justify-center overflow-hidden rounded-[14px] active:opacity-70 ${dim ? 'bg-cd-surface' : ''}`}>
      {!dim ? <CtaGradientFill /> : null}
      {loading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <View className="flex-row items-center gap-[7px]">
          {icon ? <Ionicons name={icon} size={17} color={dim ? '#9aa0b8' : '#FFFFFF'} /> : null}
          <Text className={`text-[14px] font-bold ${dim ? 'text-cd-faint' : 'text-white'}`}>{label}</Text>
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
  soft,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  diameter?: number;
  iconSize?: number;
  /** 목록에서 반복되는 버튼용 연한 톤. */
  soft?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={{ width: diameter, height: diameter }}
      className="items-center justify-center overflow-hidden rounded-full active:opacity-60">
      <CtaGradientFill soft={soft} />
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
  // 다크에서 고정 잉크(#565e82)와 기본 테두리가 배경에 묻혔다 — 테마 텍스트색·진한 테두리로(2026-08-20).
  const { c, dark } = useTheme();
  const fg = dark ? c.text : '#565e82';
  return (
    <Pressable
      onPress={onPress}
      className="h-[44px] flex-row items-center justify-center gap-[7px] rounded-[14px] border border-cd-border bg-cd-card active:opacity-70"
      style={dark ? { borderColor: c.muted } : undefined}>
      {icon ? <Ionicons name={icon} size={16} color={fg} /> : null}
      <Text className="text-[13.5px] font-bold" style={{ color: fg }}>
        {label}
      </Text>
    </Pressable>
  );
}
