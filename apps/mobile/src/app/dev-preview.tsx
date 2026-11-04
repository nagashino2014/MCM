/**
 * 부품 미리보기 — **개발 전용** 화면(라우트 링크 없음, `__DEV__` 에서만 인증을 건너뛴다).
 *
 * 실제 화면에서는 조건이 맞아야 보이는 것들(날씨 씬 10종, 캘린더의 여러 상태, Frosted 공용 부품)을 한자리에
 * 놓고 비교한다. `npx expo start --web` 으로 브라우저에서 열어 확인하는 용도.
 */
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ActionTile,
  Badge,
  Button,
  Card,
  CardRow,
  Count,
  FilterPill,
  Input,
  KpiStrip,
  PrimaryIconButton,
  SearchBar,
  SegmentedTabs,
  type SegmentItem,
} from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';

import { GlassTabBar } from '@/components/ui/GlassTabBar';
import { MonthCalendar, type CalendarBar } from '@/components/calendar/MonthCalendar';
import { TAG_TINT, type CalendarTagKey } from '@/lib/calendar/types';
import { WeatherWidget } from '@/components/home/weather/WeatherWidget';
import { type SceneKind } from '@/components/home/weather/rules';
import { useTheme } from '@/theme/useTheme';

type Tab = 'calendar' | 'ui' | 'weather';

const ITEMS: SegmentItem<Tab>[] = [
  { key: 'calendar', label: '캘린더' },
  { key: 'ui', label: 'UI 부품', count: 7 },
  { key: 'weather', label: '날씨 씬' },
];

const SCENES: SceneKind[] = ['맑음', '흐림', '비', '눈', '봄', '여름휴가', '가을', '설날', '추석', '크리스마스'];

const tint = (k: CalendarTagKey) => ({ color: TAG_TINT[k].pillBg, ink: TAG_TINT[k].text });

/** 캘린더 확인용 더미 — 하루짜리·여러 날·주 경계를 넘는 일정·한 칸 다건·휴일에서 끊기는 할 일을 모두 포함한다. */
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
    // 할 일 — 주말을 끼고 이어지는 기간 작업은 토·일·공휴일에서 막대가 끊긴다(2026-11-03)
    { id: 'h', startDate: p(10), endDate: p(20), title: '현장진단 - 1차 현장진단', ...tint('todo'), breakOnHoliday: true },
  ];
}

function Label({ children }: { children: string }) {
  return <Text className="text-[12px] font-medium text-cd-muted">{children}</Text>;
}

export default function DevPreviewScreen() {
  const { c } = useTheme();
  const [tab, setTab] = useState<Tab>('calendar');
  const now = new Date();
  const [cur, setCur] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [pick, setPick] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  const [pills, setPills] = useState<string[]>(['self', 'todo']);
  const [q, setQ] = useState('');

  const onPickDay = (iso: string) => {
    setPick((prev) =>
      !prev.from || prev.to ? { from: iso, to: null } : iso < prev.from ? { from: iso, to: prev.from } : { from: prev.from, to: iso }
    );
  };
  const togglePill = (k: string) => setPills((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={['top']}>
      <SegmentedTabs items={ITEMS} value={tab} onChange={setTab} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
        {tab === 'calendar' ? (
          <>
            <Label>보기 모드 — 연속 막대 · 할 일은 주말에서 끊김 · +N</Label>
            <MonthCalendar
              events={sampleBars(cur.y, cur.m)}
              year={cur.y}
              month0={cur.m}
              onMonthChange={(y, m) => setCur({ y, m })}
              onEventPress={() => {}}
            />
            <Label>{`선택 모드 — 기간 선택 ${pick.from ?? '-'} ~ ${pick.to ?? '-'}`}</Label>
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
            <Label>요약 스트립 (KpiStrip, 3+3)</Label>
            <View className="gap-2">
              <KpiStrip
                items={[
                  { label: '결재 대기', value: 3, hint: '내 차례', tone: 'danger', onPress: () => {} },
                  { label: '안읽은 메일', value: 5, onPress: () => {} },
                  { label: '오늘 일정', value: 2, hint: '09:30 시작' },
                ]}
              />
              <KpiStrip
                items={[
                  { label: '경과 미입력', value: 1, tone: 'warning' },
                  { label: '발행 요청', value: 0 },
                  { label: '업무보고', value: 2, hint: '재작성 1', tone: 'danger' },
                ]}
              />
            </View>

            <Label>필터 필 (FilterPill) — 색 점·틴트·비활성</Label>
            <View className="flex-row flex-wrap gap-2">
              {(['self', 'sales', 'dept', 'refs', 'todo'] as CalendarTagKey[]).map((k) => (
                <FilterPill
                  key={k}
                  label={{ self: '본인', sales: '영업', dept: '부서', refs: '선택', vehicle: '차량', meeting: '회의', interview: '면접', todo: '할 일' }[k]}
                  active={pills.includes(k)}
                  dot={TAG_TINT[k].dot}
                  tint={{ bg: TAG_TINT[k].bg, text: TAG_TINT[k].text }}
                  onPress={() => togglePill(k)}
                />
              ))}
              <FilterPill label="오늘" count={4} active onPress={() => {}} />
              <FilterPill label="권한 없음" disabled />
            </View>

            <Label>버튼 — primary(화면당 하나)·ghost·soft·danger·sm·비활성</Label>
            <View className="gap-2">
              <Button label="저장" onPress={() => {}} />
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Button label="취소" variant="ghost" full onPress={() => {}} />
                </View>
                <View className="flex-1">
                  <Button label="승인" variant="soft" full onPress={() => {}} />
                </View>
              </View>
              <View className="flex-row items-center gap-2">
                <Button label="삭제" variant="danger" size="sm" onPress={() => {}} />
                <Button label="비활성" size="sm" disabled />
                <Button label="로딩" size="sm" loading />
                <PrimaryIconButton icon="add" onPress={() => {}} />
              </View>
            </View>

            <Label>상태 필·숫자 배지</Label>
            <View className="flex-row flex-wrap items-center gap-2">
              <Badge label="승인" tone="success" />
              <Badge label="긴급" tone="error" />
              <Badge label="경고" tone="warning" />
              <Badge label="진행" tone="primary" />
              <Badge label="초안" />
              <Count value={12} />
              <Count value={3} tone="error" />
            </View>

            <Label>카드 — 제목·배지·액션 링크·행(hairline)</Label>
            <Card title="경과 미입력" badge={<Badge label="4" tone="warning" />} action={{ label: '경과 입력', onPress: () => {} }}>
              <CardRow first title="신규 공장 통합환경허가 용역 영업" meta="㈜재영물산" right={<Badge label="4건" tone="warning" />} onPress={() => {}} />
              <CardRow strong title="테스트 공지3" meta="이재영 · 7/28" onPress={() => {}} />
              <CardRow title="테스트 공지2" meta="이재영 · 7/28" accent={c.success} onPress={() => {}} />
            </Card>

            <Card title="빠른 실행">
              <View className="flex-row justify-between">
                <ActionTile icon="camera-outline" label="명함" onPress={() => {}} />
                <ActionTile icon="paper-plane-outline" label="휴가" onPress={() => {}} />
                <ActionTile icon="calendar-outline" label="일정" onPress={() => {}} />
                <ActionTile icon="business-outline" label="사업장" onPress={() => {}} />
                <ActionTile icon="people-outline" label="담당자" onPress={() => {}} />
              </View>
            </Card>

            <Label>입력·검색</Label>
            <Card>
              <View className="gap-4">
                <Input label="사업장명" placeholder="예: ㈜재영물산" hint="정확한 상호를 입력하세요" />
                <Input label="계약일" placeholder="YYYY-MM-DD" error="날짜 형식이 맞지 않습니다" />
                <SearchBar value={q} onChangeText={setQ} placeholder="담당자 검색" />
              </View>
            </Card>
          </>
        ) : (
          <>
            {SCENES.map((s) => (
              <View key={s} className="gap-1.5">
                <Label>{s}</Label>
                <WeatherWidget sceneOverride={s} nightOverride={false} />
              </View>
            ))}
            {SCENES.map((s) => (
              <View key={`n-${s}`} className="gap-1.5">
                <Label>{`${s} · 밤`}</Label>
                <WeatherWidget sceneOverride={s} nightOverride />
              </View>
            ))}
          </>
        )}
      </ScrollView>
      {/* 글라스 플로팅 탭 바 샘플(UI 부품 탭) — 실제 탭 네비게이터 밖이라 더미 state 로 그린다. */}
      {tab === 'ui' ? (
        <GlassTabBar
          state={{ index: 0, routes: TAB_DEMO.map((t) => ({ key: t.key, name: t.key })) }}
          descriptors={Object.fromEntries(
            TAB_DEMO.map((t) => [
              t.key,
              { options: { title: t.title, tabBarIcon: ({ color, size }: { color: string; size: number }) => <Ionicons name={t.icon} color={color} size={size} /> } },
            ])
          )}
          navigation={{ emit: () => ({ defaultPrevented: false }), navigate: () => {} }}
        />
      ) : null}
    </SafeAreaView>
  );
}

const TAB_DEMO: { key: string; title: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'home', title: '홈', icon: 'home-outline' },
  { key: 'approval', title: '결재', icon: 'clipboard-outline' },
  { key: 'chat', title: '대화', icon: 'chatbubble-outline' },
  { key: 'mail', title: '메일', icon: 'mail-outline' },
  { key: 'more', title: '더보기', icon: 'ellipsis-horizontal' },
];
