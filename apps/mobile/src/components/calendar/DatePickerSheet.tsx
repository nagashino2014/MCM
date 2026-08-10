import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Sheet } from '@/components/ui';
import { MonthCalendar } from './MonthCalendar';

/** ISO + n 달력일(기안 폼의 휴가 자동 부여와 같은 규칙). */
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

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
  autoDays,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title?: string;
  mode?: 'single' | 'range';
  /** YYYY-MM-DD */
  value?: string | null;
  valueTo?: string | null;
  /**
   * 시작일만 고르고 종료일이 규정으로 정해지는 경우의 총 일수(휴가 경조 5일 등).
   * 주면 라벨에 실제 기간(시작~자동 종료일)을 보여 주고 확인 시에도 그 종료일로 확정한다.
   */
  autoDays?: number;
  onConfirm: (from: string, to: string) => void;
  onClose: () => void;
}) {
  const base = value ? new Date(`${value}T12:00:00`) : new Date();
  const [cur, setCur] = useState({ y: base.getFullYear(), m: base.getMonth() });
  const [from, setFrom] = useState<string | null>(value ?? null);
  const [to, setTo] = useState<string | null>(mode === 'range' ? (valueTo ?? null) : null);

  // 시트를 열 때마다 현재 값으로 동기화 — 컴포넌트가 계속 마운트돼 있어 초기값만으로는
  // 재오픈 시 이전 선택이 남는다(휴가 종류를 바꿔 기간이 재설정된 경우도 반영).
  useEffect(() => {
    if (!visible) return;
    setFrom(value ?? null);
    setTo(mode === 'range' ? (valueTo ?? null) : null);
    if (value) {
      const d = new Date(`${value}T12:00:00`);
      setCur({ y: d.getFullYear(), m: d.getMonth() });
    }
  }, [visible, value, valueTo, mode]);

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

  /** 자동 부여 종료일 — 시작일이 정해졌고 autoDays 가 있을 때만. */
  const autoTo = autoDays != null && from ? addDays(from, Math.max(1, autoDays) - 1) : null;
  const label = autoTo
    ? `${from} ~ ${autoTo}${autoDays! > 1 ? ` (${autoDays}일)` : ''}`
    : mode === 'range'
      ? `${from ?? '시작일'} ~ ${to ?? from ?? '종료일'}`
      : (from ?? '날짜를 선택하세요');

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
              onConfirm(from, autoTo ?? (mode === 'range' ? (to ?? from) : from));
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
          rangeEnd={autoTo ?? to}
        />
      </View>
    </Sheet>
  );
}
