import { type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/theme/useTheme";

/** 설정·더보기 등에서 쓰는 터치 행. */
export function ListRow({
  icon,
  title,
  subtitle,
  value,
  right,
  onPress,
  danger,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  value?: string;
  right?: ReactNode;
  onPress?: () => void;
  danger?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="min-h-[52px] flex-row items-center gap-3 border-b border-cd-border px-4 py-3 active:bg-cd-surface">
      {icon ? (
        <View className="h-9 w-9 items-center justify-center rounded-xl bg-cd-primary-soft">
          <Ionicons name={icon} size={18} color={danger ? c.error : c.primary} />
        </View>
      ) : null}
      <View className="flex-1">
        <Text className={`text-[15px] font-bold ${danger ? "text-cd-error" : "text-cd-text"}`}>
          {title}
        </Text>
        {subtitle ? <Text className="text-[12px] text-cd-faint">{subtitle}</Text> : null}
      </View>
      {value ? <Text className="text-[13px] text-cd-muted">{value}</Text> : null}
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={c.faint} /> : null)}
    </Pressable>
  );
}

/** 빈 상태 — 목록이 비었을 때의 표준 안내. */
export function EmptyState({
  icon = "documents-outline",
  title,
  description,
  action,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View className="items-center gap-2 px-6 py-12">
      <Ionicons name={icon} size={40} color={c.faint} />
      <Text className="text-[15px] font-bold text-cd-muted">{title}</Text>
      {description ? (
        <Text className="text-center text-[13px] leading-5 text-cd-faint">{description}</Text>
      ) : null}
      {action ? <View className="mt-2">{action}</View> : null}
    </View>
  );
}

/** 로딩 스켈레톤(카드 n개). */
export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <View className="gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          className="h-[86px] rounded-card border border-cd-border bg-cd-surface opacity-60"
        />
      ))}
    </View>
  );
}

/** 목록 하단 더 불러오기 인디케이터. */
export function ListFooter({ loading, end }: { loading?: boolean; end?: boolean }) {
  if (loading) return <ActivityIndicator className="py-4" />;
  if (end) return <Text className="py-4 text-center text-[12px] text-cd-faint">마지막입니다</Text>;
  return null;
}

/** 오프라인/갱신실패 안내 배너(캐시 표시 중일 때). */
export function StaleBanner({ at }: { at?: number | null }) {
  if (!at) return null;
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return (
    <View className="flex-row items-center gap-1.5 rounded-xl bg-cd-warning-soft px-3 py-2">
      <Ionicons name="cloud-offline-outline" size={14} color="#ffae1f" />
      <Text className="text-[12px] text-cd-warning">
        연결이 불안정해 저장된 내용을 표시합니다 ({hh}:{mm} 기준)
      </Text>
    </View>
  );
}
