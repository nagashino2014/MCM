/**
 * 부품 미리보기 — **개발 전용** 화면(라우트 링크 없음, `__DEV__` 에서만 인증을 건너뛴다).
 *
 * 실제 화면에서는 조건이 맞아야 보이는 것들(날씨 씬 10종, 캘린더의 여러 상태)을 한자리에
 * 놓고 비교한다. `npx expo start --web` 으로 브라우저에서 열어 확인하는 용도.
 */
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ActionTile,
  Badge,
  Card,
  CardRow,
  SegmentedTabs,
  StatTile,
  TileGrid,
  type SegmentItem,
} from '@/components/ui';
import { MonthCalendar, type CalendarBar } from '@/components/calendar/MonthCalendar';
import { TAG_TINT, type CalendarTagKey } from '@/lib/calendar/types';
import { WeatherWidget } from '@/components/home/weather/WeatherWidget';
import { type SceneKind } from '@/components/home/weather/rules';
import { useTheme } from '@/theme/useTheme';

type Tab = 'calendar' | 'ui' | 'weather';

const ITEMS: SegmentItem<Tab>[] = [
  { key: 'calendar', label: '캘린더' },
  { key: 'ui', label: 'UI 부품' },
  { key: 'weather', label: '날씨 씬' },
];

const SCENES: SceneKind[] = ['맑음', '흐림', '비', '눈', '봄', '여름휴가', '가을', '설날', '추석', '크리스마스'];

const tint = (k: CalendarTagKey) => ({ color: TAG_TINT[k].pillBg, ink: TAG_TINT[k].text });

/** 캘린더 확인용 더미 — 하루짜리·여러 날·주 경계를 넘는 일정·한 칸 다건을 모두 포함한다. */
function sampleBars(y: number, m0: number): CalendarBar[] {
  const p = (d: number) => `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return [
    { id: 'a', startDate: p(3), endDate: p(7), title: '출장 : 통합허가', ...tint('self') },
    { id: 'b', startDate: p(5), endDate: p(5), title: '반차(오전)', ...tint('self') },
    { id: 'c', startDate: p(6), endDate: p(12), title: '니로 HEV', ...tint('vehicle') },
    { id: 'd', startDate: p(6), endDate: p(8), title: '㈜재영물산', ...tint('sales') },
    { id: 'e', startDate: p(7), endDate: p(9), title: '교육 : 화관법', ...tint('dept') },
    { id: 'f', startDate: p(14), endDate: p(14), title: '반차', ...tint('refs') },
    { id: 'g', startDate: p(18), endDate: p(24), title: '출장 : 삼척', ...tint('self') },
  ];
}

export default function DevPreviewScreen() {
  const { c } = useTheme();
  const [tab, setTab] = useState<Tab>('calendar');
  const now = new Date();
  const [cur, setCur] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [pick, setPick] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });

  const onPickDay = (iso: string) => {
    setPick((prev) =>
      !prev.from || prev.to ? { from: iso, to: null } : iso < prev.from ? { from: iso, to: prev.from } : { from: prev.from, to: iso }
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-cd-bg" edges={['top']}>
      <SegmentedTabs items={ITEMS} value={tab} onChange={setTab} />
      <ScrollView contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 40 }}>
        {tab === 'calendar' ? (
          <>
            <Text className="text-[12px] font-bold text-cd-muted">보기 모드 — 셀 안 이벤트 필 · +N</Text>
            <MonthCalendar
              events={sampleBars(cur.y, cur.m)}
              year={cur.y}
              month0={cur.m}
              onMonthChange={(y, m) => setCur({ y, m })}
              onEventPress={() => {}}
            />
            <Text className="text-[12px] font-bold text-cd-muted">
              선택 모드 — 기간 선택 {pick.from ?? '-'} ~ {pick.to ?? '-'}
            </Text>
            <MonthCalendar
              variant="picker"
              year={cur.y}
              month0={cur.m}
              onMonthChange={(y, m) => setCur({ y, m })}
              onDayPress={onPickDay}
              selected={pick.from}
              rangeEnd={pick.to}
            />
          </>
        ) : tab === 'ui' ? (
          <>
            <Text className="text-[12px] font-bold text-cd-muted">지표 타일 (3열 그리드)</Text>
            <TileGrid columns={3}>
              <StatTile key="1" label="결재 대기" value={1} delta="내 차례" tone={c.error} />
              <StatTile key="2" label="안읽은 메일" value={3} delta="확인 필요" tone={c.primary} />
              <StatTile key="3" label="오늘 일정" value={0} delta="확인 필요" tone={c.success} />
              <StatTile key="4" label="경과 미입력" value={4} delta="확인 필요" tone={c.warning} />
              <StatTile key="5" label="발행 요청" value={0} delta="확인 필요" tone={c.secondary} />
            </TileGrid>

            <Text className="text-[12px] font-bold text-cd-muted">카드 — 타이틀·배지·액션 링크</Text>
            <Card
              title="경과 미입력"
              badge={<Badge label="4" tone="warning" />}
              action={{ label: '경과 입력', onPress: () => {} }}>
              <View className="mt-1 gap-2">
                <View className="rounded-xl border border-cd-border bg-cd-surface px-3">
                  <CardRow
                    first
                    title="신규 공장 통합환경허가 용역 영업"
                    meta="㈜재영물산"
                    accent={c.warning}
                    right={<Badge label="4건" tone="warning" />}
                    onPress={() => {}}
                  />
                </View>
              </View>
            </Card>

            <Card title="최근 공지" action={{ label: '전체보기', onPress: () => {} }}>
              <CardRow first strong title="테스트 공지3" meta="이재영 · 7/28" onPress={() => {}} />
              <CardRow title="테스트 공지2" meta="이재영 · 7/28" onPress={() => {}} />
              <CardRow title="테스트 공지" meta="nagashino2014@gmail.com · 7/28" onPress={() => {}} />
            </Card>

            <Card title="빠른 실행">
              <View className="mt-1.5 flex-row justify-between">
                <ActionTile icon="camera-outline" label="명함" tone={c.primary} onPress={() => {}} />
                <ActionTile icon="paper-plane-outline" label="휴가" tone={c.success} onPress={() => {}} />
                <ActionTile icon="calendar-outline" label="일정" tone={c.warning} onPress={() => {}} />
                <ActionTile icon="business-outline" label="사업장" tone={c.secondary} onPress={() => {}} />
                <ActionTile icon="people-outline" label="담당자" tone="#7a6bb8" onPress={() => {}} />
              </View>
            </Card>
          </>
        ) : (
          <>
            {SCENES.map((s) => (
              <View key={s} className="gap-1.5">
                <Text className="text-[12px] font-bold text-cd-muted">{s}</Text>
                <WeatherWidget sceneOverride={s} nightOverride={false} />
              </View>
            ))}
            {SCENES.map((s) => (
              <View key={`n-${s}`} className="gap-1.5">
                <Text className="text-[12px] font-bold text-cd-muted">{s} · 밤</Text>
                <WeatherWidget sceneOverride={s} nightOverride />
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
