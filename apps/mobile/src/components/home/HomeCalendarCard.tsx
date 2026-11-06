import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { MonthCalendar, ymdOf, type CalendarBar } from '@/components/calendar/MonthCalendar';
import { Badge, Card } from '@/components/ui';
import { apiJson } from '@/lib/api';
import { DEFAULT_CALENDAR_PREFS, tagTint, type CalendarEvent, type CalendarPrefs, type CalendarTagKey } from '@/lib/calendar/types';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

const monthKey = (y: number, m0: number) => `${y}-${String(m0 + 1).padStart(2, '0')}`;

/**
 * 홈 2열(데스크탑 위젯·PWA 넓은 창)의 오른쪽 위 카드 — **캘린더(위) + 오늘 일정(아래)** 를 한 카드에(2026-11-06 사용자 요청,
 * 웹 홈의 일정 캘린더 카드와 같은 구성).
 *
 * - 데이터는 일정 화면(/schedule)과 같은 통합 조회(`/api/calendar`)와 같은 태그 설정(`/api/calendar/prefs`)을 쓴다 —
 *   일정 화면에서 켜 둔 종류(본인·부서·영업…)가 그대로 보인다.
 * - 달력은 MonthCalendar 의 `dots` 변형(바 없이 색 점) — 셀 높이가 고정이라 카드 높이를 왼쪽 열(날씨 + 요약 스트립)에 맞출 수 있다.
 * - `height` 를 주면 그 높이로 고정하고, 남는 공간이 오늘 일정 목록이 된다(넘치면 목록 안에서 스크롤).
 * - 날짜·일정을 누르면 일정 화면으로 간다(상세·등록은 그 화면이 맡는다).
 */
export function HomeCalendarCard({ height }: { height?: number }) {
  const { c } = useTheme();
  const router = useRouter();
  const now = useMemo(() => new Date(), []);
  const todayIso = ymdOf(now);
  const [cur, setCur] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [tags, setTags] = useState<CalendarTagKey[]>([...DEFAULT_CALENDAR_PREFS.tags]);

  // 태그 설정(1회) — 실패하면 기본값(본인·부서).
  useEffect(() => {
    let alive = true;
    apiJson<CalendarPrefs>('/api/calendar/prefs')
      .then((p) => {
        if (alive && Array.isArray(p.tags) && p.tags.length) setTags(p.tags);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const thisMonth = monthKey(now.getFullYear(), now.getMonth());
  const shownMonth = monthKey(cur.y, cur.m);
  const tagQs = tags.join(',');
  // 오늘 일정은 항상 이번 달 조회에서 뽑는다 — 달을 넘겨 보는 동안에도 목록은 오늘 기준.
  const todayApi = useApi<{ events: CalendarEvent[] }>(`/api/calendar?month=${thisMonth}&tags=${tagQs}`, { cache: true });
  const otherApi = useApi<{ events: CalendarEvent[] }>(`/api/calendar?month=${shownMonth}&tags=${tagQs}`, {
    cache: true,
    skip: shownMonth === thisMonth,
  });
  const shown = shownMonth === thisMonth ? todayApi.data : otherApi.data;

  // 홈으로 돌아오면 다시 읽는다. ⚠ useApi 의 reload 는 렌더마다 새 함수 — 의존성에 넣지 않고 ref 로 든다(schedule.tsx 와 같은 이유).
  const reloadRef = useRef(todayApi.reload);
  useEffect(() => {
    reloadRef.current = todayApi.reload;
  });
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void reloadRef.current();
    }, [])
  );

  const bars: CalendarBar[] = useMemo(
    () =>
      (shown?.events ?? [])
        .filter((e) => !e.canceled)
        .map((e) => ({
          id: e.id,
          startDate: e.startDate,
          endDate: e.endDate,
          title: e.title,
          color: tagTint(e.tag).dot,
          breakOnHoliday: e.tag === 'todo',
        })),
    [shown]
  );

  const todays = useMemo(
    () =>
      (todayApi.data?.events ?? [])
        .filter((e) => !e.canceled && e.startDate <= todayIso && (e.endDate || e.startDate) >= todayIso)
        .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.title.localeCompare(b.title)),
    [todayApi.data, todayIso]
  );

  const goSchedule = () => router.push('/schedule');

  return (
    <Card
      title="일정"
      action={{ label: '전체 일정', onPress: goSchedule }}
      style={height ? { height } : undefined}>
      <MonthCalendar
        bare
        variant="dots"
        events={bars}
        year={cur.y}
        month0={cur.m}
        onMonthChange={(y, m) => setCur({ y, m })}
        onDayPress={goSchedule}
      />

      {/* 오늘 일정 — 달력 아래 hairline 으로 나누고 남은 높이를 채운다. */}
      <View className="mt-2 flex-row items-center gap-2 border-t border-cd-border pt-3">
        <Text className="text-[13px] font-semibold text-cd-text">오늘 일정</Text>
        {todays.length ? <Badge label={`${todays.length}`} tone="success" /> : null}
      </View>
      {/* 안쪽 스크롤 층에도 불투명 바탕을 준다 — 웹에서 글자가 흐려지지 않게(리포트 §8-1). */}
      <ScrollView
        style={{ flex: 1, minHeight: 44, marginTop: 4, backgroundColor: c.card }}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}>
        {todays.length === 0 ? (
          <Text className="py-2 text-[13px] text-cd-muted">
            {todayApi.loading && !todayApi.data ? '불러오는 중…' : '오늘 예정된 일정이 없습니다.'}
          </Text>
        ) : (
          todays.map((e) => (
            <Pressable
              key={e.id}
              onPress={goSchedule}
              accessibilityRole="button"
              className="flex-row items-center gap-2 py-1.5 active:opacity-60">
              <View style={{ backgroundColor: tagTint(e.tag).dot }} className="h-2 w-2 rounded-full" />
              <Text className="w-[42px] text-[12px] text-cd-muted" style={{ fontVariant: ['tabular-nums'] }}>
                {e.startTime ?? '종일'}
              </Text>
              <Text numberOfLines={1} className="flex-1 text-[13px] text-cd-text">
                {e.title}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </Card>
  );
}
