import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Card, SkeletonList } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

interface LeaveSummary {
  granted: number;
  used: number;
  remaining: number;
}
interface WeekRow {
  workedMinutes: number;
  overtimeMinutes: number;
  excessMinutes: number;
}
interface AttendanceRes {
  weeks: WeekRow[];
  limits: { weeklyStandardMinutes: number; weeklyLimitMinutes: number; weeklyOvertimeLimitMinutes: number };
}

const d1 = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
/** 분 → 시간(소수 1자리, 정수면 정수). */
const hours = (min: number) => d1(Math.round((Math.max(0, min) / 60) * 10) / 10);

/**
 * 홈 2열의 근태·휴가 현황 카드(2026-11-06 사용자 요청) — 영업 담당자가 아닌 직원에게 "경과 미입력" 자리에 보인다.
 * 근태·휴가 화면(/leave)과 같은 데이터원(내 연차 요약 · 이번 주 근태)에서 숫자 세 개만 뽑는다:
 * 남은 연차 / 이번 주 근무시간 / 이번 주 초과근무. 자세한 내역·신청은 "자세히"로 그 화면에서.
 * 한 카드 안 세 칸은 세로 hairline 으로만 나눈다(카드 안 카드 금지). 숫자 색은 한도를 넘었을 때만.
 * `height` — 홈 2열에서 왼쪽 "빠른 실행" 카드와 같은 높이로 맞춘다(사용자 요청).
 */
export function AttendanceLeaveCard({ height }: { height?: number } = {}) {
  const { c } = useTheme();
  const router = useRouter();
  const year = String(new Date().getFullYear());
  const balance = useApi<{ summary: LeaveSummary | null }>(`/api/approval/leave?me=1&year=${year}`, { cache: true });
  const att = useApi<AttendanceRes>('/api/approval/attendance/me', { cache: true });

  const summary = balance.data?.summary ?? null;
  const limits = att.data?.limits;
  const week = att.data?.weeks?.[0] ?? null;
  const otUsed = week ? week.overtimeMinutes + week.excessMinutes : 0;
  const otLimit = limits?.weeklyOvertimeLimitMinutes ?? 720;
  const standard = limits?.weeklyStandardMinutes ?? 2400;
  const over52 = !!(week && limits && week.workedMinutes > limits.weeklyLimitMinutes);
  const loading = (balance.loading && !balance.data) || (att.loading && !att.data);

  const cells: { label: string; value: string; unit: string; hint: string; color?: string }[] = [
    {
      label: '남은 연차',
      value: summary ? d1(summary.remaining) : '-',
      unit: '일',
      hint: summary ? `사용 ${d1(summary.used)} / ${d1(summary.granted)}` : '연차 정보 없음',
    },
    {
      label: '이번 주 근무',
      value: week ? hours(week.workedMinutes) : '-',
      unit: '시간',
      hint: `소정 ${hours(standard)}`,
      color: over52 ? c.error : undefined,
    },
    {
      label: '초과근무',
      value: week ? hours(otUsed) : '-',
      unit: '시간',
      hint: `한도 ${hours(otLimit)}`,
      color: otUsed > otLimit ? c.error : undefined,
    },
  ];

  return (
    <Card title="근태·휴가" action={{ label: '자세히', onPress: () => router.push('/leave') }} style={height ? { height } : undefined}>
      {loading ? (
        <SkeletonList count={1} />
      ) : (
        <View className="flex-row">
          {cells.map((it, i) => (
            <View key={it.label} style={{ width: `${100 / cells.length}%`, minWidth: 0 }} className={i > 0 ? 'border-l border-cd-border pl-3' : 'pr-3'}>
              <Text numberOfLines={1} className="text-[12px] font-medium text-cd-muted">
                {it.label}
              </Text>
              <View className="mt-1 flex-row items-baseline gap-1">
                <Text style={{ color: it.color ?? c.text, fontVariant: ['tabular-nums'] }} className="text-[24px] font-semibold leading-[28px] tracking-tight">
                  {it.value}
                </Text>
                <Text className="text-[12px] text-cd-muted">{it.unit}</Text>
              </View>
              <Text numberOfLines={1} className="mt-0.5 text-[12px] text-cd-muted">
                {it.hint}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}
