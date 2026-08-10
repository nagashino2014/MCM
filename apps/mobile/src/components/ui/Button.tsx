import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/theme/useTheme";

import { CTA_FROM, CtaGradientFill } from "./GradientButton";

type Variant = "primary" | "ghost" | "danger" | "soft";
type Size = "md" | "sm";

// primary 는 단색 채움 대신 CTA 그라데이션(핸드오프 3a)을 깐다 — 배경 클래스 없이 overflow 만 자른다.
const BOX: Record<Variant, string> = {
  primary: "overflow-hidden",
  ghost: "border border-cd-border bg-cd-card",
  danger: "bg-cd-error",
  soft: "bg-cd-primary-soft",
};

const LABEL: Record<Variant, string> = {
  primary: "text-white",
  ghost: "text-cd-text",
  danger: "text-white",
  soft: "text-cd-primary",
};

/** 공통 버튼 — 터치 타깃 44pt 하한(md), 아이콘·로딩·비활성 지원. */
export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  icon,
  loading,
  disabled,
  full,
}: {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  full?: boolean;
}) {
  const { c } = useTheme();
  const off = disabled || loading;
  // 비활성은 반투명 대신 **불투명한 감쇠색**으로 — 시트·겹침 배경 위에서 반쯤 비쳐 보이는
  // 가시성 문제(2026-08-10 사용자 피드백). 로딩 중에는 원래 모양을 유지한다(진행 표시일 뿐).
  const dim = !!disabled && !loading;
  const iconColor = dim
    ? c.faint
    : variant === "primary" || variant === "danger"
      ? "#fff"
      : variant === "soft"
        ? c.primary
        : c.text;

  return (
    <Pressable
      onPress={off ? undefined : onPress}
      disabled={off}
      className={[
        "flex-row items-center justify-center gap-1.5 rounded-xl active:opacity-75",
        size === "md" ? "min-h-[44px] px-4 py-3" : "min-h-[36px] px-3 py-2",
        dim ? (variant === "ghost" ? "border border-cd-border bg-cd-card" : "bg-cd-surface") : BOX[variant],
        full ? "w-full" : "",
      ].join(" ")}>
      {variant === "primary" && !dim ? <CtaGradientFill /> : null}
      {loading ? (
        <ActivityIndicator size="small" color={iconColor} />
      ) : icon ? (
        <Ionicons name={icon} size={size === "md" ? 18 : 16} color={iconColor} />
      ) : null}
      <Text
        className={[
          "font-bold",
          size === "md" ? "text-[15px]" : "text-[13px]",
          dim ? "text-cd-faint" : LABEL[variant],
        ].join(" ")}>
        {label}
      </Text>
    </Pressable>
  );
}

/** 아이콘 전용 버튼(헤더 우측 등). */
export function IconButton({
  icon,
  onPress,
  color,
  size = 22,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  color?: string;
  size?: number;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      className="h-11 w-11 items-center justify-center rounded-full active:opacity-60">
      <Ionicons name={icon} size={size} color={color ?? c.muted} />
    </Pressable>
  );
}

/**
 * 강조 아이콘 버튼 — 목록 헤더의 주요 행동(기안 작성·글쓰기)에 쓴다.
 * 흐린 아이콘만 두면 눈에 띄지 않아, primary 로 채운 원형에 흰 아이콘을 얹는다.
 */
export function PrimaryIconButton({
  icon,
  onPress,
  size = 24,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  size?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={{
        shadowColor: CTA_FROM,
        shadowOpacity: 0.35,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 3,
      }}
      className="h-11 w-11 items-center justify-center overflow-hidden rounded-full active:opacity-70">
      <CtaGradientFill />
      <Ionicons name={icon} size={size} color="#FFFFFF" />
    </Pressable>
  );
}

/** 하단 고정 액션 바(결재 승인/반려 등). */
export function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <View className="flex-row gap-2 border-t border-cd-border bg-cd-card px-4 pb-6 pt-3">
      {children}
    </View>
  );
}
