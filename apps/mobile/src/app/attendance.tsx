import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Badge, Card, EmptyState, Screen, SkeletonList } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

interface WeekRow {
  weekStart: string;
  workedMinutes: number;
  overtimeMinutes: number;
  overtimeNightMinutes: number;
  overtimeDayMinutes: number;
  excessMinutes: number;
  daysWorked: number;
  overLimit: boolean;
  excluded: boolean;
}
interface DailyRow {
  workDate: string;
  inAt: string | null;
  outAt: string | null;
  workedMinutes: number | null;
  nightMinutes: number | null;
  isLeaveDay: boolean;
}
interface Res {
  weeks: WeekRow[];
  week: string | null;
  daily: DailyRow[];
  limits: { weeklyStandardMinutes: number; weeklyLimitMinutes: number; weeklyOvertimeLimitMinutes: number };
}

const hm = (min?: number | null) => {
  const m = Math.max(0, Math.round(min ?? 0));
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
};
const hhmm = (iso?: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(11, 16) || '-';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const mmdd = (s: string) => (s.length >= 10 ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : s);
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 내 근태(M5) — 주별 근무·초과근무 + 선택 주의 일별 출퇴근.
 * 조회 전용이다. 출퇴근 체크인은 도입하지 않기로 확정했다(블루프린트 §7.6).
 */
export default function AttendanceScreen() {
  const [week, setWeek] = useState<string | null>(null);
  const path = `/api/approval/attendance/me${week ? `?week=${week}` : ''}`;
  const { data, loading, refreshing, error, reload } = useApi<Res>(path, { cache: true });
  const { c } = useTheme();

  if (loading && !data) {
    return (
      <Screen>
        <SkeletonList count={3} />
      </Screen>
    );
  }
  if (!data || data.weeks.length === 0) {
    return (
      <Screen scroll refreshing={refreshing} onRefresh={reload}>
        <EmptyState
          icon="time-outline"
          title={error ? '불러오지 못했습니다' : '근태 기록이 없습니다'}
          description={
            error ??
            '관리자가 근태 파일을 업로드하면 여기에 주별 근무시간이 표시됩니다.'
          }
        />
      </Screen>
    );
  }

  const current = data.weeks.find((w) => w.weekStart === (data.week ?? '')) ?? data.weeks[0];
  const std = data.limits.weeklyStandardMinutes;
  const limit = data.limits.weeklyLimitMinutes;
  const ratio = Math.min(1, current.workedMinutes / limit);
  const overStd = current.workedMinutes > std;
  const overLimit = current.workedMinutes > limit;

  return (
    <Screen scroll refreshing={refreshing} onRefresh={reload}>
      {/* 주 선택 */}
      <View className="flex-row flex-wrap gap-2">
        {data.weeks.slice(0, 6).map((w) => (
          <Pressable
            key={w.weekStart}
            onPress={() => setWeek(w.weekStart)}
            className={`min-h-[36px] justify-center rounded-full border px-3 active:opacity-70 ${
              w.weekStart === current.weekStart
                ? 'border-cd-primary bg-cd-primary-soft'
                : 'border-cd-border bg-cd-card'
            }`}>
            <Text
              className={`text-[13px] font-bold ${
                w.weekStart === current.weekStart ? 'text-cd-primary' : 'text-cd-muted'
              }`}>
              {mmdd(w.weekStart)} 주
            </Text>
          </Pressable>
        ))}
      </View>

      {/* 주간 근무시간 게이지 */}
      <Card title={`${mmdd(current.weekStart)} 주 근무`}>
        <View className="gap-2">
          <View className="flex-row items-end gap-2">
            <Text
              className="text-[30px] font-extrabold leading-8"
              style={{ color: overLimit ? c.error : overStd ? c.warning : c.primary }}>
              {(current.workedMinutes / 60).toFixed(1)}
            </Text>
            <Text className="pb-1 text-[13px] text-cd-muted">시간 / 주 {limit / 60}시간</Text>
            <View className="flex-1" />
            {current.excluded ? <Badge label="산정 제외" tone="neutral" /> : null}
            {current.overLimit ? <Badge label="한도 초과" tone="error" /> : null}
          </View>

          {/* 막대 — 소정(40h) 지점에 눈금을 둔다 */}
          <View className="h-2.5 overflow-hidden rounded-full bg-cd-surface">
            <View
              style={{
                width: `${ratio * 100}%`,
                backgroundColor: overLimit ? c.error : overStd ? c.warning : c.primary,
              }}
              className="h-full rounded-full"
            />
          </View>
          <View className="flex-row justify-between">
            <Text className="text-[11px] text-cd-faint">소정 {std / 60}h</Text>
            <Text className="text-[11px] text-cd-faint">한도 {limit / 60}h</Text>
          </View>

          <View className="mt-1 flex-row flex-wrap gap-x-4 gap-y-1">
            <Stat label="연장" value={hm(current.overtimeMinutes)} />
            <Stat label="야간" value={hm(current.overtimeNightMinutes)} />
            <Stat label="근무일" value={`${current.daysWorked}일`} />
            {current.excessMinutes > 0 ? (
              <Stat label="한도 초과분" value={hm(current.excessMinutes)} tone="error" />
            ) : null}
          </View>

          {current.excessMinutes > 0 ? (
            <Text className="mt-1 text-[12px] leading-4 text-cd-muted">
              주 연장 인정 한도({data.limits.weeklyOvertimeLimitMinutes / 60}시간)를 넘은 시간은
              사규상 특별휴가 대상입니다.
            </Text>
          ) : null}
        </View>
      </Card>

      {/* 일별 */}
      <Card title="일별 기록">
        {data.daily.length === 0 ? (
          <Text className="py-3 text-[13px] text-cd-faint">이 주의 일별 기록이 없습니다.</Text>
        ) : (
          <View className="gap-1">
            {data.daily.map((d, i) => {
              const dow = new Date(d.workDate).getDay();
              return (
                <View
                  key={d.workDate}
                  className={`flex-row items-center gap-2 py-1.5 ${i === 0 ? '' : 'border-t border-cd-border'}`}>
                  <Text
                    className="w-14 text-[13px] font-bold"
                    style={{ color: dow === 0 ? c.error : dow === 6 ? c.primary : c.text }}>
                    {mmdd(d.workDate)}({DOW[dow] ?? ''})
                  </Text>
                  {d.isLeaveDay ? (
                    <Text className="flex-1 text-[13px] text-cd-muted">휴가</Text>
                  ) : (
                    <>
                      <Text className="flex-1 text-[13px] text-cd-muted">
                        {hhmm(d.inAt)} ~ {hhmm(d.outAt)}
                      </Text>
                      <Text className="text-[12px] text-cd-faint">{hm(d.workedMinutes)}</Text>
                    </>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </Card>
    </Screen>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'error' }) {
  return (
    <Text className="text-[12px] text-cd-faint">
      {label} <Text className={`font-bold ${tone === 'error' ? 'text-cd-error' : 'text-cd-text'}`}>{value}</Text>
    </Text>
  );
}
