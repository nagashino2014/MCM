import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/theme/useTheme";

type Variant = "primary" | "ghost" | "danger" | "soft";
type Size = "md" | "sm";

/**
 * 공통 버튼 — KESI Frosted(2026-11-03 모바일 이식).
 *
 * primary = 남색 단색 채움(primary-fill) + 한 단계 어두운 1px 테두리(primary-fill-edge) + 흰 글자. 그라데이션·그림자 없음, **화면당 하나**.
 * ghost(기본 보조) = 카드 바탕 + 테두리 + ink 글자. soft = primary-soft 바탕 + primary-strong 글자(긍정적이지만 주 동작은 아닌 것).
 * danger = 확인 시트 안에서만. 높이 md 44(터치 하한) · sm 36, 반경 10, 글자 md 15/500 · sm 13/500, 아이콘 글자 앞.
 */
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
  const look = dim
    ? { bg: c.surface, border: c.border, fg: c.faint }
    : variant === "primary"
      ? { bg: c.primaryFill, border: c.primaryFillEdge, fg: "#ffffff" }
      : variant === "danger"
        ? { bg: c.error, border: c.error, fg: c.onError }
        : variant === "soft"
          ? { bg: c.primarySoft, border: c.primarySoft, fg: c.primaryStrong }
          : { bg: c.card, border: c.border, fg: c.text };

  return (
    <Pressable
      onPress={off ? undefined : onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off }}
      style={{ backgroundColor: look.bg, borderColor: look.border, borderWidth: 1, height: size === "md" ? 44 : 36 }}
      className={[
        "flex-row items-center justify-center gap-1.5 rounded-lg active:opacity-80",
        size === "md" ? "px-4" : "px-3",
        full ? "w-full" : "",
      ].join(" ")}>
      {loading ? (
        <ActivityIndicator size="small" color={look.fg} />
      ) : icon ? (
        <Ionicons name={icon} size={size === "md" ? 18 : 16} color={look.fg} />
      ) : null}
      <Text style={{ color: look.fg }} className={size === "md" ? "text-[15px] font-medium" : "text-[13px] font-medium"}>
        {label}
      </Text>
    </Pressable>
  );
}

/** 아이콘 전용 버튼(헤더 우측 등) — 44 터치 타깃, 배경 없음(ghost). */
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
      accessibilityRole="button"
      className="h-11 w-11 items-center justify-center rounded-lg active:bg-cd-surface">
      <Ionicons name={icon} size={size} color={color ?? c.muted} />
    </Pressable>
  );
}

/**
 * 강조 아이콘 버튼 — 목록 헤더의 주요 행동(기안 작성·글쓰기·새 할 일). 화면의 주 버튼이므로 하나만.
 * 주 버튼과 같은 남색 단색 채움 + 테두리, 40×40, 반경 10.
 */
export function PrimaryIconButton({
  icon,
  onPress,
  size = 22,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  size?: number;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      style={{ backgroundColor: c.primaryFill, borderColor: c.primaryFillEdge, borderWidth: 1 }}
      className="h-10 w-10 items-center justify-center rounded-lg active:opacity-80">
      <Ionicons name={icon} size={size} color="#ffffff" />
    </Pressable>
  );
}

/** 하단 고정 액션 바(결재 승인/반려 등) — 카드 면 + 위쪽 hairline. */
export function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <View className="flex-row gap-2 border-t border-cd-border bg-cd-card px-4 pb-6 pt-3">
      {children}
    </View>
  );
}
