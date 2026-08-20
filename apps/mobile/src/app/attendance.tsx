import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

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
  /** 기록이 있는 월('YYYY-MM', 최신순) — 연/월 탐색용(2026-08-20). */
  months?: string[];
}

const hm = (min?: number | null) => {
  const m = Math.max(0, Math.round(min ?? 0));
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
};
/** H:MM — 일별 정규/초과 분해 표기용(좁은 행에 맞는 축약형). */
const hmm = (min: number) => {
  const m = Math.max(0, Math.round(min));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
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
 * 내 근태(M5) — 연/월을 고르면 그 달의 주가 태그로 나오고, 주를 고르면 일별 출퇴근이 보인다.
 * 종전에는 최근 8주 태그만 있어 기록이 쌓이면 과거를 볼 수 없었다(2026-08-20 사용자 지적).
 * 조회 전용이다. 출퇴근 체크인은 도입하지 않기로 확정했다(블루프린트 §7.6).
 */
export default function AttendanceScreen() {
  const [month, setMonth] = useState<string | null>(null); // null = 서버 기본(최근 주들)
  const [week, setWeek] = useState<string | null>(null);
  const params = [month ? `month=${month}` : null, week ? `week=${week}` : null].filter(Boolean).join('&');
  const path = `/api/approval/attendance/me${params ? `?${params}` : ''}`;
  const { data, loading, refreshing, error, reload } = useApi<Res>(path, { cache: true });
  const { c } = useTheme();

  const months = data?.months ?? [];
  const years = useMemo(() => [...new Set(months.map((m) => m.slice(0, 4)))], [months]);
  /** 표시 기준 월 — 미선택이면 최신 월. */
  const selMonth = month ?? months[0] ?? null;
  const selYear = selMonth?.slice(0, 4) ?? null;
  const monthsOfYear = useMemo(
    () => months.filter((m) => m.slice(0, 4) === selYear),
    [months, selYear]
  );

  if (loading && !data) {
    return (
      <Screen>
        <SkeletonList count={3} />
      </Screen>
    );
  }
  if (!data || data.weeks.length === 0) {
    // 월을 골랐는데 그 달 기록이 없을 수도 있다 — 선택 UI 는 남겨 되돌아갈 수 있게 한다.
    return (
      <Screen scroll refreshing={refreshing} onRefresh={reload}>
        {months.length > 0 ? (
          <MonthPicker
            years={years}
            monthsOfYear={monthsOfYear}
            selYear={selYear}
            selMonth={selMonth}
            onYear={(y) => {
              const first = months.find((m) => m.slice(0, 4) === y);
              setMonth(first ?? null);
              setWeek(null);
            }}
            onMonth={(m) => {
              setMonth(m);
              setWeek(null);
            }}
          />
        ) : null}
        <EmptyState
          icon="time-outline"
          title={error ? '불러오지 못했습니다' : '근태 기록이 없습니다'}
          description={
            error ??
            (selMonth
              ? `${selMonth.replace('-', '년 ')}월에는 기록이 없습니다.`
              : '관리자가 근태 파일을 업로드하면 여기에 주별 근무시간이 표시됩니다.')
          }
        />
      </Screen>
    );
  }

  const current = data.weeks.find((w) => w.weekStart === (data.week ?? '')) ?? data.weeks[0];
  const std = data.limits.weeklyStandardMinutes;
  const limit = data.limits.weeklyLimitMinutes;
  /** 하루 소정근로(8h) — 일별 정규/초과 분해 기준(주 소정 40h ÷ 5일). */
  const dayStd = std / 5;
  const ratio = Math.min(1, current.workedMinutes / limit);
  const overStd = current.workedMinutes > std;
  const overLimit = current.workedMinutes > limit;
  /** 이 화면의 주 태그 — 선택 월 소속 주만(월 미선택이면 최신 월 기준으로 좁힌다). */
  const weekTags = selMonth ? data.weeks.filter((w) => w.weekStart.slice(0, 7) === selMonth) : data.weeks;

  return (
    <Screen scroll refreshing={refreshing} onRefresh={reload}>
      {/* 연/월 선택 → 해당 월의 주 태그 */}
      <MonthPicker
        years={years}
        monthsOfYear={monthsOfYear}
        selYear={selYear}
        selMonth={selMonth}
        onYear={(y) => {
          const first = months.find((m) => m.slice(0, 4) === y);
          setMonth(first ?? null);
          setWeek(null);
        }}
        onMonth={(m) => {
          setMonth(m);
          setWeek(null);
        }}
      />
      <View className="flex-row flex-wrap gap-2">
        {(weekTags.length ? weekTags : data.weeks).map((w) => (
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
              const worked = d.workedMinutes ?? 0;
              const reg = Math.min(worked, dayStd);
              const over = Math.max(0, worked - dayStd);
              return (
                <View
                  key={d.workDate}
                  className={`flex-row items-center gap-2 py-1.5 ${i === 0 ? '' : 'border-t border-cd-border'}`}>
                  {/* 폭 74 + 1줄 고정 — 종전 w-14 는 "8/10(월)" 의 닫는 괄호가 다음 줄로 밀렸다. */}
                  <Text
                    numberOfLines={1}
                    className="text-[13px] font-bold"
                    style={{ width: 74, color: dow === 0 ? c.error : dow === 6 ? c.primary : c.text }}>
                    {mmdd(d.workDate)}({DOW[dow] ?? ''})
                  </Text>
                  {d.isLeaveDay ? (
                    <Text className="flex-1 text-[13px] text-cd-muted">휴가</Text>
                  ) : (
                    <>
                      <Text className="flex-1 text-[13px] text-cd-muted">
                        {hhmm(d.inAt)} ~ {hhmm(d.outAt)}
                      </Text>
                      <View className="items-end">
                        <Text className="text-[12px] font-semibold text-cd-text">{hm(d.workedMinutes)}</Text>
                        <Text className="text-[10.5px] text-cd-faint">
                          (정규 {hmm(reg)} / 초과 {hmm(over)})
                        </Text>
                      </View>
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

/** 연도·월 선택 — 기록이 있는 연/월만 칩으로(가로 스크롤, 축소 금지 원칙). */
function MonthPicker({
  years,
  monthsOfYear,
  selYear,
  selMonth,
  onYear,
  onMonth,
}: {
  years: string[];
  monthsOfYear: string[];
  selYear: string | null;
  selMonth: string | null;
  onYear: (y: string) => void;
  onMonth: (m: string) => void;
}) {
  if (!years.length) return null;
  return (
    <View className="gap-2">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
        {years.map((y) => (
          <PickPill key={y} label={`${y}년`} on={y === selYear} onPress={() => onYear(y)} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
        {monthsOfYear.map((m) => (
          <PickPill key={m} label={`${Number(m.slice(5, 7))}월`} on={m === selMonth} onPress={() => onMonth(m)} />
        ))}
      </ScrollView>
    </View>
  );
}

function PickPill({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`min-h-[34px] justify-center rounded-full border px-3.5 active:opacity-70 ${
        on ? 'border-cd-primary bg-cd-primary-soft' : 'border-cd-border bg-cd-card'
      }`}>
      <Text className={`text-[13px] font-bold ${on ? 'text-cd-primary' : 'text-cd-muted'}`}>{label}</Text>
    </Pressable>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'error' }) {
  return (
    <Text className="text-[12px] text-cd-faint">
      {label} <Text className={`font-bold ${tone === 'error' ? 'text-cd-error' : 'text-cd-text'}`}>{value}</Text>
    </Text>
  );
}
