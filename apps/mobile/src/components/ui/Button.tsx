import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/theme/useTheme";

type Variant = "primary" | "ghost" | "danger" | "soft";
type Size = "md" | "sm";

const BOX: Record<Variant, string> = {
  primary: "bg-cd-primary",
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
  const iconColor =
    variant === "primary" || variant === "danger" ? "#fff" : variant === "soft" ? c.primary : c.text;

  return (
    <Pressable
      onPress={off ? undefined : onPress}
      disabled={off}
      className={[
        "flex-row items-center justify-center gap-1.5 rounded-xl active:opacity-75",
        size === "md" ? "min-h-[44px] px-4 py-3" : "min-h-[36px] px-3 py-2",
        BOX[variant],
        full ? "w-full" : "",
        off ? "opacity-45" : "",
      ].join(" ")}>
      {loading ? (
        <ActivityIndicator size="small" color={iconColor} />
      ) : icon ? (
        <Ionicons name={icon} size={size === "md" ? 18 : 16} color={iconColor} />
      ) : null}
      <Text
        className={[
          "font-bold",
          size === "md" ? "text-[15px]" : "text-[13px]",
          LABEL[variant],
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

/** 하단 고정 액션 바(결재 승인/반려 등). */
export function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <View className="flex-row gap-2 border-t border-cd-border bg-cd-card px-4 pb-6 pt-3">
      {children}
    </View>
  );
}
