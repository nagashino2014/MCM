import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Sheet } from '@/components/ui';
import { MonthCalendar } from './MonthCalendar';

/**
 * 날짜·기간 선택 시트 — 기안 폼의 `date`/`period`, 영업 일정 등록이 공유한다.
 * 네이티브 date picker 대신 공용 월 캘린더를 쓴다(네이티브 모듈 추가 없이 OTA 배포 유지).
 */
export function DatePickerSheet({
  visible,
  title,
  mode = 'single',
  value,
  valueTo,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title?: string;
  mode?: 'single' | 'range';
  /** YYYY-MM-DD */
  value?: string | null;
  valueTo?: string | null;
  onConfirm: (from: string, to: string) => void;
  onClose: () => void;
}) {
  const base = value ? new Date(`${value}T12:00:00`) : new Date();
  const [cur, setCur] = useState({ y: base.getFullYear(), m: base.getMonth() });
  const [from, setFrom] = useState<string | null>(value ?? null);
  const [to, setTo] = useState<string | null>(mode === 'range' ? (valueTo ?? null) : null);

  const onDay = (iso: string) => {
    if (mode === 'single') {
      setFrom(iso);
      setTo(null);
      return;
    }
    // 범위: 시작이 없거나 이미 범위가 잡혔으면 새로 시작, 아니면 끝을 잡는다.
    if (!from || to) {
      setFrom(iso);
      setTo(null);
    } else if (iso < from) {
      setTo(from);
      setFrom(iso);
    } else {
      setTo(iso);
    }
  };

  const label =
    mode === 'range' ? `${from ?? '시작일'} ~ ${to ?? from ?? '종료일'}` : (from ?? '날짜를 선택하세요');

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title ?? (mode === 'range' ? '기간 선택' : '날짜 선택')}
      footer={
        // Sheet footer 는 flex-row — 감싸지 않으면 버튼이 내용 폭으로 좁아진다.
        <View className="flex-1">
          <Button
            label="확인"
            disabled={!from}
            onPress={() => {
              if (!from) return;
              onConfirm(from, mode === 'range' ? (to ?? from) : from);
              onClose();
            }}
          />
        </View>
      }>
      <View className="gap-2">
        <Text className="text-[13px] font-bold text-cd-muted">{label}</Text>
        <MonthCalendar
          variant="picker"
          year={cur.y}
          month0={cur.m}
          onMonthChange={(y, m) => setCur({ y, m })}
          onDayPress={onDay}
          selected={from}
          rangeEnd={to}
        />
      </View>
    </Sheet>
  );
}
