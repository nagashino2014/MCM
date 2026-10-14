import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useAuthedSource } from '@/components/ui/Avatar';
import { useTheme } from '@/theme/useTheme';
import type { TodoApprovalEvent, TodoPriority } from '@/lib/todo-types';
import { TODO_UI, initials, labelColors, type DueTone, type LabelTone } from '@/lib/todo-utils';

/**
 * To-do 화면의 작은 부품(v4 §19) — 파스텔 라벨 · 마감 라벨 · 우선순위 라벨 · 소형 아바타(사진/중립 이니셜) ·
 * 중립 체크 원 · 날짜 그룹 헤더 · 분절 진행바 · 좌측 색 띠 · 결재 종류 아이콘.
 * 색은 의미에만 쓴다: 지연·높음 파스텔 빨강, 오늘 마감 파스텔 주황, 상태·열은 파스텔 칩, 보드 색은 띠와 점.
 */

/** 파스텔 라벨(11~13px) — 상태 칩·열 이름 칩·그룹 pill·결재 종류 칩의 공통 바탕. */
export function PastelLabel({
  label,
  tone,
  size = 11,
  bold,
  bg,
  fg,
}: {
  label: string;
  tone: LabelTone;
  size?: number;
  bold?: boolean;
  /** 톤 대신 직접 색을 줄 때(결재 종류 칩 = kindColor 60%). */
  bg?: string;
  fg?: string;
}) {
  const { dark } = useTheme();
  const t = labelColors(tone, dark);
  return (
    <View style={{ backgroundColor: bg ?? t.bg, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 }}>
      <Text style={{ fontSize: size, color: fg ?? t.fg, fontWeight: bold ? '600' : '500' }}>{label}</Text>
    </View>
  );
}

/** 우선순위 라벨(§19-4) — 높음만 파스텔 빨강, 낮음은 회색. 보통·없음은 표시하지 않는다. */
export function PriorityLabel({ priority }: { priority: TodoPriority }) {
  if (priority === 3) return <PastelLabel label="높음" tone="over" bold />;
  if (priority === 1) return <PastelLabel label="낮음" tone="gray" />;
  return null;
}

/** 우선순위 점(8px) — 부가 설정 편집 UI 에서만 쓴다(목록·카드는 라벨). */
export function PriorityDot({ priority, size = 8 }: { priority: TodoPriority; size?: number }) {
  const { c, dark } = useTheme();
  const color =
    priority === 3 ? labelColors('over', dark).fg : priority === 2 ? labelColors('today', dark).fg : priority === 1 ? c.muted : 'transparent';
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        borderWidth: priority === 0 ? 1 : 0,
        borderColor: c.faint,
      }}
    />
  );
}

/** 마감 라벨(12px) — 초과·오늘은 파스텔 라벨, 이후는 글자만. */
export function DueBadge({ label, tone }: { label: string; tone: DueTone }) {
  if (tone === 'neutral') return <Text className="text-[12.5px] text-cd-muted">{label}</Text>;
  return <PastelLabel label={label} tone={tone} size={12} />;
}

/**
 * 소형 아바타(20~28px) — 사진(`photoUrl`, 앱 API 상대경로면 Bearer 헤더)이 있으면 원형 사진,
 * 없으면 중립 이니셜(배경 surface · 글자 muted). 사용자별 색은 쓰지 않는다(§19-8).
 */
export function MiniAvatar({ name, photoUrl, size = 22 }: { name: string | null | undefined; photoUrl?: string | null; size?: number }) {
  const source = useAuthedSource(photoUrl);
  if (source) {
    return <Image source={source} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" transition={120} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2 }} className="items-center justify-center bg-cd-surface">
      <Text style={{ fontSize: Math.round(size * 0.42) }} className="font-semibold text-cd-muted">
        {initials(name)}
      </Text>
    </View>
  );
}

/**
 * 체크 원(22px) — 테두리는 중립색(우선순위와 무관), 완료되면 primary 로 채워지고 체크가 뜬다.
 * 채움은 reanimated 120ms(§7.5). 되돌리기는 같은 버튼을 다시 누른다.
 */
export function CheckCircle({
  done,
  onPress,
  disabled,
  size = 22,
}: {
  done: boolean;
  onPress: () => void;
  disabled?: boolean;
  size?: number;
}) {
  const { c } = useTheme();
  const fill = useSharedValue(done ? 1 : 0);
  useEffect(() => {
    fill.value = withTiming(done ? 1 : 0, { duration: 120 });
  }, [done, fill]);
  const inner = useAnimatedStyle(() => ({
    transform: [{ scale: fill.value }],
    opacity: fill.value,
  }));
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={10}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={done ? '되돌리기' : '완료'}
      style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: done ? c.primary : c.faint, opacity: disabled && !done ? 0.5 : 1 }}
      className="items-center justify-center active:opacity-70">
      <Animated.View
        style={[
          { position: 'absolute', width: size - 3, height: size - 3, borderRadius: size / 2, backgroundColor: c.primary },
          inner,
        ]}>
        <View className="flex-1 items-center justify-center">
          <Ionicons name="checkmark" size={size - 9} color="#fff" />
        </View>
      </Animated.View>
    </Pressable>
  );
}

/** 좌측 색 띠(§19-1) — 행·카드 왼쪽 4px, 상세 헤더 5px. 부모는 position relative + overflow hidden. */
export function BoardStripe({ color, width = 4, inset = 10 }: { color: string; width?: number; inset?: number }) {
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, top: inset, bottom: inset, width, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: color }}
    />
  );
}

/** 맥락 줄 앞 색 점(8px) — 보드 색. */
export function ContextDot({ color }: { color: string }) {
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' }} />;
}

/**
 * 분절 진행바(§19-7) — 하위 작업 n/m. 완료 `#9FD9BA` · 진행 중 `#B9CFEE` · 대기 회색.
 * 목록·카드는 7×5 미니, 상세는 18×5. 분절이 너무 많으면(>12) 하나의 비율 바로 그린다.
 */
export function SegBar({
  done,
  doing = 0,
  total,
  segW = 7,
  segH = 5,
}: {
  done: number;
  doing?: number;
  total: number;
  segW?: number;
  segH?: number;
}) {
  const { c } = useTheme();
  if (total <= 0) return null;
  if (total > 12) {
    const w = segW * 6;
    return (
      <View style={{ width: w, height: segH, borderRadius: 3, backgroundColor: c.gridLine, overflow: 'hidden', flexDirection: 'row' }}>
        <View style={{ width: Math.round((w * done) / total), backgroundColor: TODO_UI.segDone }} />
        <View style={{ width: Math.round((w * doing) / total), backgroundColor: TODO_UI.segDoing }} />
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={{
            width: segW,
            height: segH,
            borderRadius: 2,
            backgroundColor: i < done ? TODO_UI.segDone : i < done + doing ? TODO_UI.segDoing : c.gridLine,
          }}
        />
      ))}
    </View>
  );
}

/**
 * 날짜 그룹 헤더(42px, sticky) — 지연은 파스텔 빨강 pill, 오늘은 파스텔 파랑 pill, 그 외는 글자.
 * 보조 문구("10월 13일 월요일")와 우측 건수.
 */
export function DateGroupHeader({
  label,
  tone,
  sub,
  count,
}: {
  label: string;
  /** 'over' | 'sky' 면 pill 로, 없으면 글자만. */
  tone?: 'over' | 'sky';
  sub?: string;
  count?: number | string;
}) {
  return (
    <View style={{ height: 42 }} className="flex-row items-center gap-2 border-b border-cd-grid-line bg-cd-bg px-4">
      {tone ? (
        <PastelLabel label={label} tone={tone} size={11.5} bold />
      ) : (
        <Text className="text-[12.5px] font-semibold text-cd-text">{label}</Text>
      )}
      {sub ? <Text className="text-[12.5px] text-cd-muted">{sub}</Text> : null}
      <View className="flex-1" />
      {count != null ? <Text className="text-[12.5px] text-cd-faint">{String(count)}</Text> : null}
    </View>
  );
}

/** 접이식 섹션 헤더(카드 안, 36~40px) — 이름(글자 또는 파스텔 칩) + 건수 + 보조 라벨 + ▾/▸. */
export function SectionHeader({
  label,
  count,
  countLabel,
  danger,
  open,
  onToggle,
  height = 36,
  chipTone,
  extra,
}: {
  label: string;
  count?: number | string | null;
  /** 건수 대신 보일 보조 문구(예: "월 10/13"). */
  countLabel?: string;
  /** 헤더를 error 색으로(지연). */
  danger?: boolean;
  open?: boolean;
  onToggle?: () => void;
  height?: number;
  /** 열 이름을 파스텔 칩으로(보드 열 헤더). */
  chipTone?: LabelTone;
  /** 건수 뒤 보조 라벨("권장 3건 초과" 등). */
  extra?: React.ReactNode;
}) {
  const { c } = useTheme();
  const body = (
    <>
      {chipTone ? (
        <PastelLabel label={label} tone={chipTone} size={12.5} bold />
      ) : (
        <Text className={`text-[13px] font-semibold ${danger ? 'text-cd-error' : 'text-cd-text'}`}>{label}</Text>
      )}
      {countLabel ? (
        <Text className="text-[12px] text-cd-muted">{countLabel}</Text>
      ) : count != null ? (
        <Text className={`text-[12.5px] ${danger ? 'text-cd-error' : 'text-cd-faint'}`}>{String(count)}</Text>
      ) : null}
      {extra}
      <View className="flex-1" />
      {onToggle ? <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color={c.faint} /> : null}
    </>
  );
  const cls = `flex-row items-center gap-2 px-3 ${open === false ? '' : 'border-b border-cd-border'}`;
  return onToggle ? (
    <Pressable onPress={onToggle} style={{ height }} className={`${cls} active:opacity-70`}>
      {body}
    </Pressable>
  ) : (
    <View style={{ height }} className={cls}>
      {body}
    </View>
  );
}

/** 결재 일정 종류 아이콘(Ionicons) — 출장 briefcase · 휴가 leaf(야자수 대용) · 교육 school · 초과근무 time · 결재 대기 ribbon(도장 대용). */
export const APPROVAL_KIND_ICON: Record<TodoApprovalEvent['kind'], keyof typeof Ionicons.glyphMap> = {
  trip: 'briefcase-outline',
  leave: 'leaf-outline',
  education: 'school-outline',
  overtime: 'time-outline',
  sales: 'people-outline',
  vehicle: 'car-outline',
  meeting: 'people-outline',
  interview: 'person-outline',
  visit: 'location-outline',
  pending: 'ribbon-outline',
};

/** 결재 일정 종류 아이콘을 파스텔 원(24px) 안에. */
export function KindCircle({ kind, color, size = 24 }: { kind: TodoApprovalEvent['kind']; color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} className="items-center justify-center">
      <Ionicons name={APPROVAL_KIND_ICON[kind] ?? 'document-text-outline'} size={Math.round(size * 0.54)} color="#3d4350" />
    </View>
  );
}
