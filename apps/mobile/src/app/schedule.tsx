import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Badge, Button, Card, CardRow, EmptyState, ScreenHeader, Sheet, SkeletonList } from '@/components/ui';
import { MonthCalendar, type CalendarBar } from '@/components/calendar/MonthCalendar';
import { OrgPickerSheet } from '@/components/pickers/OrgPickerSheet';
import { apiJson } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';
import {
  CALENDAR_TAG_KEYS,
  CALENDAR_TAG_LABELS,
  CALENDAR_KIND_LABELS,
  DEFAULT_CALENDAR_PREFS,
  SCHEDULE_FORMS,
  TAG_COLOR,
  TAG_COLOR_STRONG,
  TAG_INK,
  type CalendarEvent,
  type CalendarPrefs,
  type CalendarRefs,
  type CalendarTagKey,
} from '@/lib/calendar/types';

/**
 * 일정 — 데스크탑 `/calendar`(G6-C)의 모바일 이식.
 *
 * 태그 칩(복수 토글·서버 저장) → 월 캘린더(카테고리 색 바) → 카테고리별 목록.
 * 웹은 캘린더 바를 누르면 하단 카드로 스크롤·강조하지만, 모바일에서는 **상세 시트**를 연다
 * (좁은 화면에서 스크롤 점프는 맥락을 잃는다 — 축소 대신 재배치 원칙).
 *
 * 새 일정 등록은 **기안으로 보낸다** — 출장·교육·휴가는 전부 결재 문서가 원천이고,
 * 일정은 그 문서의 투영이다(웹과 같은 원칙). 영업 스케줄만 예외로 직접 등록한다(P5).
 */

const monthKey = (y: number, m0: number) => `${y}-${String(m0 + 1).padStart(2, '0')}`;

export default function ScheduleScreen() {
  const { c } = useTheme();
  const router = useRouter();
  const now = useMemo(() => new Date(), []);
  const [cur, setCur] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [tags, setTags] = useState<CalendarTagKey[]>([...DEFAULT_CALENDAR_PREFS.tags]);
  const [refs, setRefs] = useState<CalendarRefs>({ ...DEFAULT_CALENDAR_PREFS.refs });
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [detail, setDetail] = useState<CalendarEvent | null>(null);
  const [newFor, setNewFor] = useState<string | null>(null);
  const [refsOpen, setRefsOpen] = useState(false);

  // 설정 로드(1회) — 이후 태그·선택 대상 변경 시 서버에 저장한다.
  useEffect(() => {
    let alive = true;
    apiJson<CalendarPrefs>('/api/calendar/prefs')
      .then((p) => {
        if (!alive) return;
        if (Array.isArray(p.tags) && p.tags.length) setTags(p.tags);
        if (p.refs) setRefs(p.refs);
      })
      .catch(() => {
        /* 설정 실패는 기본값으로 */
      })
      .finally(() => alive && setPrefsLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  const savePrefs = useCallback(
    (next: Partial<CalendarPrefs>) => {
      if (!prefsLoaded) return;
      void apiJson('/api/calendar/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      }).catch(() => {
        /* 저장 실패는 조용히 — 화면 상태는 유지된다 */
      });
    },
    [prefsLoaded]
  );

  const month = monthKey(cur.y, cur.m);
  const { data, loading, refreshing, reload } = useApi<{ events: CalendarEvent[]; salesDenied?: boolean }>(
    `/api/calendar?month=${month}&tags=${tags.join(',')}`,
    { cache: true }
  );
  const events = data?.events ?? [];

  const bars: CalendarBar[] = useMemo(
    () =>
      events.map((e) => ({
        id: e.id,
        startDate: e.startDate,
        endDate: e.endDate,
        title: e.title,
        color: TAG_COLOR[e.tag],
        ink: TAG_INK,
      })),
    [events]
  );

  /** 카테고리별 묶음 — 켜둔 태그 순서대로. */
  const grouped = useMemo(() => {
    const map = new Map<CalendarTagKey, CalendarEvent[]>();
    for (const e of events) {
      const arr = map.get(e.tag) ?? [];
      arr.push(e);
      map.set(e.tag, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));
    }
    return CALENDAR_TAG_KEYS.filter((t) => tags.includes(t) && map.has(t)).map((t) => ({ tag: t, list: map.get(t)! }));
  }, [events, tags]);

  const toggleTag = (t: CalendarTagKey) => {
    const next = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t];
    if (!next.length) return; // 전부 끄면 볼 게 없다
    setTags(next);
    savePrefs({ tags: next });
  };

  const period = (e: CalendarEvent) =>
    `${e.startDate}${e.endDate && e.endDate !== e.startDate ? ` ~ ${e.endDate}` : ''}${e.startTime ? ` ${e.startTime}` : ''}`;

  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: c.bg }} className="flex-1 bg-cd-bg">
      <ScreenHeader
        title="일정"
        subtitle={`${cur.y}년 ${cur.m + 1}월`}
        back
        right={
          <Pressable
            onPress={() => setRefsOpen(true)}
            hitSlop={8}
            className="h-[38px] flex-row items-center gap-1 rounded-full border border-cd-border bg-cd-card px-3 active:opacity-70">
            <Ionicons name="people-outline" size={15} color={c.body} />
            <Text className="text-[12px] font-semibold text-cd-body">참조 지정</Text>
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={c.faint} />}>
        {/* 태그 칩 */}
        <View className="flex-row flex-wrap gap-2">
          {CALENDAR_TAG_KEYS.map((t) => {
            const on = tags.includes(t);
            const off = t === 'sales' && data?.salesDenied;
            return (
              <Pressable
                key={t}
                onPress={() => !off && toggleTag(t)}
                className={`min-h-[34px] flex-row items-center gap-1.5 rounded-full border px-3 active:opacity-70 ${
                  off ? 'opacity-40' : ''
                }`}
                style={{
                  borderColor: on ? TAG_COLOR_STRONG[t] : c.border,
                  backgroundColor: on ? TAG_COLOR[t] : c.card,
                }}>
                <View style={{ backgroundColor: TAG_COLOR_STRONG[t] }} className="h-2 w-2 rounded-full" />
                <Text className="text-[12.5px] font-bold" style={{ color: on ? TAG_INK : c.muted }}>
                  {CALENDAR_TAG_LABELS[t]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <MonthCalendar
          events={bars}
          year={cur.y}
          month0={cur.m}
          onMonthChange={(y, m) => setCur({ y, m })}
          onEventPress={(bar) => setDetail(events.find((e) => e.id === bar.id) ?? null)}
          onDayPress={(iso) => setNewFor(iso)}
        />

        {loading && !events.length ? (
          <SkeletonList count={3} />
        ) : !grouped.length ? (
          <EmptyState icon="calendar-outline" title="이 달에 표시할 일정이 없습니다" />
        ) : (
          grouped.map(({ tag, list }) => (
            <Card
              key={tag}
              title={CALENDAR_TAG_LABELS[tag]}
              badge={<Badge label={`${list.length}`} tone="neutral" />}
              icon={<View style={{ backgroundColor: TAG_COLOR_STRONG[tag] }} className="h-2.5 w-2.5 rounded-full" />}>
              <View className="mt-1">
                {list.map((e, i) => (
                  <CardRow
                    key={e.id}
                    first={i === 0}
                    title={e.title}
                    meta={`${CALENDAR_KIND_LABELS[e.kind]} · ${period(e)}`}
                    onPress={() => setDetail(e)}
                  />
                ))}
              </View>
            </Card>
          ))
        )}
      </ScrollView>

      {/* 일정 상세 */}
      <Sheet visible={!!detail} onClose={() => setDetail(null)} title={detail?.title ?? '일정'}>
        {detail ? (
          <View className="gap-3">
            <View className="flex-row items-center gap-2">
              <Badge label={CALENDAR_KIND_LABELS[detail.kind]} tone="neutral" />
              <Text className="text-[13px] text-cd-body">{period(detail)}</Text>
            </View>
            {detail.people.length ? (
              <View className="gap-1">
                <Text className="text-[12px] font-bold text-cd-faint">대상</Text>
                <Text className="text-[14px] text-cd-text">
                  {detail.people.map((p) => `${p.name}${p.positionName ? ` ${p.positionName}` : ''}`).join(', ')}
                </Text>
              </View>
            ) : null}
            {detail.summary ? (
              <View className="gap-1">
                <Text className="text-[12px] font-bold text-cd-faint">내용</Text>
                <Text className="text-[14px] leading-6 text-cd-text">{detail.summary}</Text>
              </View>
            ) : null}
            {detail.docId ? (
              <Button
                label="결재 문서 보기"
                onPress={() => {
                  const id = detail.docId as string;
                  setDetail(null);
                  router.push({ pathname: '/approval/[docId]', params: { docId: id } });
                }}
              />
            ) : null}
          </View>
        ) : null}
      </Sheet>

      {/* 날짜 탭 → 새 일정(기안으로) */}
      <Sheet visible={!!newFor} onClose={() => setNewFor(null)} title={`${newFor ?? ''} 일정 추가`}>
        <View className="gap-1 pb-2">
          <Text className="pb-1 text-[12.5px] text-cd-faint">
            출장·교육·휴가 일정은 결재 문서에서 만들어집니다. 양식을 고르면 날짜가 채워집니다.
          </Text>
          {SCHEDULE_FORMS.map((f) => (
            <Pressable
              key={f.formId}
              onPress={() => {
                const date = newFor;
                setNewFor(null);
                router.push({ pathname: '/approval/draft', params: { formId: f.formId, date: date ?? '' } });
              }}
              className="flex-row items-center gap-2 rounded-xl px-4 py-3 active:opacity-70">
              <Ionicons name="create-outline" size={17} color={c.primary} />
              <Text className="flex-1 text-[15px] text-cd-text">{f.label}</Text>
              <Ionicons name="chevron-forward" size={15} color={c.faint} />
            </Pressable>
          ))}
        </View>
      </Sheet>

      {/* '선택' 태그 대상 지정 */}
      <OrgPickerSheet
        visible={refsOpen}
        title="참조 대상 지정"
        hint="여기서 고른 인원의 일정이 '선택' 태그로 함께 표시됩니다."
        multi
        selectedIds={refs.employeeIds}
        onSelect={(emp) => {
          const next: CalendarRefs = refs.employeeIds.includes(emp.employeeId)
            ? { ...refs, employeeIds: refs.employeeIds.filter((id) => id !== emp.employeeId) }
            : { ...refs, employeeIds: [...refs.employeeIds, emp.employeeId] };
          setRefs(next);
          savePrefs({ refs: next });
          if (!tags.includes('refs')) toggleTag('refs');
        }}
        onClose={() => {
          setRefsOpen(false);
          void reload();
        }}
      />
    </SafeAreaView>
  );
}
