import { type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/theme/useTheme";

/**
 * 설정·더보기 등에서 쓰는 전체폭 터치 행 — 높이 52, hairline 구분, 아이콘은 글자색(아이콘 뒤 색 배경 없음).
 * 제목 15/500 ink · 부제 12 ink-muted · 값 13 ink-muted · chevron.
 */
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
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      className="min-h-[52px] flex-row items-center gap-3 border-b border-cd-border px-4 py-3 active:bg-cd-surface">
      {icon ? <Ionicons name={icon} size={20} color={danger ? c.error : c.muted} /> : null}
      <View className="flex-1">
        <Text className={`text-[15px] font-medium ${danger ? "text-cd-error" : "text-cd-text"}`}>{title}</Text>
        {subtitle ? <Text className="mt-0.5 text-[12px] text-cd-muted">{subtitle}</Text> : null}
      </View>
      {value ? <Text className="text-[13px] text-cd-muted">{value}</Text> : null}
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={c.faint} /> : null)}
    </Pressable>
  );
}

/**
 * 카드 안의 목록 행 — 제목 14(강조 500 ink · 기본 400) · 메타 12 ink-muted · hairline · chevron 14.
 * 색 막대 대신 6px 점(`accent`)으로 종류를 표시한다(카드·행에 색 막대 금지).
 */
export function CardRow({
  title,
  meta,
  right,
  accent,
  strong,
  first,
  onPress,
}: {
  title: string;
  meta?: string;
  /** 우측 슬롯(배지·금액). 없고 onPress 가 있으면 chevron 을 그린다. */
  right?: ReactNode;
  /** 종류 색 점(강조 행). */
  accent?: string;
  /** 미확인 등 강조 표시. */
  strong?: boolean;
  /** 첫 행이면 위쪽 구분선을 그리지 않는다. */
  first?: boolean;
  onPress?: () => void;
}) {
  const { c } = useTheme();
  const body = (
    <>
      {accent ? <View style={{ backgroundColor: accent, width: 6, height: 6, borderRadius: 3 }} /> : null}
      <View className="flex-1">
        <Text numberOfLines={1} className={`text-[14px] leading-[22px] ${strong ? "font-medium text-cd-text" : "text-cd-text"}`}>
          {title}
        </Text>
        {meta ? (
          <Text numberOfLines={1} className="mt-0.5 text-[12px] leading-[18px] text-cd-muted">
            {meta}
          </Text>
        ) : null}
      </View>
      {right}
      {!right && onPress ? <Ionicons name="chevron-forward" size={14} color={c.faint} /> : null}
    </>
  );
  const cls = `flex-row items-center gap-2.5 py-3 ${first ? "" : "border-t border-cd-border"}`;
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" className={`${cls} active:opacity-60`}>
      {body}
    </Pressable>
  ) : (
    <View className={cls}>{body}</View>
  );
}

/** 빈 상태 — 아이콘 + 한 문장(+동작 하나). 일러스트 없음. */
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
    <View className="items-center gap-2 px-6 py-10">
      <Ionicons name={icon} size={28} color={c.faint} />
      <Text className="text-[15px] font-medium text-cd-muted">{title}</Text>
      {description ? (
        <Text className="text-center text-[13px] leading-[20px] text-cd-muted">{description}</Text>
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
        <View key={i} className="h-20 rounded-lg bg-cd-surface" />
      ))}
    </View>
  );
}

/** 목록 하단 더 불러오기 인디케이터. */
export function ListFooter({ loading, end }: { loading?: boolean; end?: boolean }) {
  if (loading) return <ActivityIndicator className="py-4" />;
  if (end) return <Text className="py-4 text-center text-[12px] text-cd-muted">마지막입니다</Text>;
  return null;
}

/** 오프라인/갱신실패 안내 배너(캐시 표시 중일 때) — warning-soft 바탕 + warning 글자·아이콘. */
export function StaleBanner({ at }: { at?: number | null }) {
  const { c } = useTheme();
  if (!at) return null;
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return (
    <View className="flex-row items-center gap-1.5 rounded-lg bg-cd-warning-soft px-3 py-2">
      <Ionicons name="cloud-offline-outline" size={14} color={c.warning} />
      <Text className="text-[12px] text-cd-warning">
        연결이 불안정해 저장된 내용을 표시합니다 ({hh}:{mm} 기준)
      </Text>
    </View>
  );
}
