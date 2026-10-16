import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  GENERAL_PURPOSES,
  PURPOSE_HINTS,
  TRIP_PURPOSES,
  purposeNeedsRelated,
  type RelatedRef,
} from '@/lib/expense-purpose';

/**
 * 지출 목적 칩 + 연관 용역/사업장 줄(2026-10-16) — 영수증 촬영·영수증 보관함이 같이 쓴다.
 * 출장 4종은 출장보고서, 일반 4종은 지출결의서 지출내역에 실린다. '기타 …'를 고르면 예시를 보여 준다.
 */

export function PurposeChips({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const chip = (p: string) => {
    const on = value === p;
    return (
      <Pressable
        key={p}
        disabled={disabled}
        onPress={() => onChange(on ? '' : p)}
        className={`rounded-full border px-3 py-1.5 ${disabled ? 'opacity-60' : 'active:opacity-70'} ${
          on ? 'border-cd-primary bg-cd-primary-soft' : 'border-cd-border'
        }`}>
        <Text className={`text-[12.5px] ${on ? 'font-semibold text-cd-primary' : 'text-cd-text'}`}>{p}</Text>
      </Pressable>
    );
  };
  return (
    <View className="gap-1.5">
      <Text className="text-[13px] font-bold text-cd-muted">지출 목적 *</Text>
      <Text className="text-[11px] text-cd-faint">출장 경비 — 출장보고서에 실립니다</Text>
      <View className="flex-row flex-wrap gap-1.5">{TRIP_PURPOSES.map(chip)}</View>
      <Text className="mt-1 text-[11px] text-cd-faint">그 밖의 경비 — 지출결의서에 실립니다</Text>
      <View className="flex-row flex-wrap gap-1.5">{GENERAL_PURPOSES.map(chip)}</View>
      {value && !(TRIP_PURPOSES as readonly string[]).includes(value) && !(GENERAL_PURPOSES as readonly string[]).includes(value) ? (
        <Text className="text-[11.5px] text-cd-faint">기존 입력: {value} — 목록에서 다시 고르세요</Text>
      ) : null}
      {PURPOSE_HINTS[value] ? (
        <View className="mt-1 flex-row items-start gap-1">
          <Ionicons name="help-circle-outline" size={14} color="#6b7280" />
          <Text className="flex-1 text-[11.5px] text-cd-muted">{PURPOSE_HINTS[value]}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function RelatedField({
  purpose,
  value,
  onPress,
  disabled,
}: {
  purpose: string;
  value: RelatedRef | null;
  onPress: () => void;
  disabled?: boolean;
}) {
  const need = purposeNeedsRelated(purpose);
  return (
    <View className="gap-1.5">
      <Text className="text-[13px] font-bold text-cd-muted">{need ? '연관 용역/사업장 *' : '연관 용역/사업장'}</Text>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        className={`min-h-[44px] flex-row items-center justify-between rounded-xl border px-3.5 py-2.5 ${
          need && !value ? 'border-red-400' : 'border-cd-border'
        } ${disabled ? 'opacity-60' : 'active:opacity-70'}`}>
        <Text numberOfLines={1} className={`flex-1 text-[15px] ${value ? 'text-cd-text' : 'text-cd-faint'}`}>
          {value?.label || (need ? '선택 필요 — 어느 용역에 쓴 비용인지' : '선택(필요 없으면 비워 둠)')}
        </Text>
        <Ionicons name="chevron-forward" size={16} color="#6b7280" />
      </Pressable>
    </View>
  );
}
