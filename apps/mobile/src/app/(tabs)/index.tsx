import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import { Avatar, SkeletonList } from '@/components/ui';
import { HOME_WIDGET_NODES, MOBILE_WIDGET_ORDER } from '@/components/home/widgets';
import { WeatherWidget } from '@/components/home/weather/WeatherWidget';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth-context';
import { useNavBadges } from '@/lib/use-nav-badges';
import { fmtDate } from '@/lib/format';
import { useTheme } from '@/theme/useTheme';

interface Activity {
  activityId: string;
  projectTitle?: string;
  facilityName?: string;
  scheduledAt?: string | null;
}
interface PendingReport {
  projectId: string;
  title: string;
  facilityName?: string | null;
  activities?: unknown[];
}
interface BoardPost {
  postId: string;
  title: string;
  authorName?: string | null;
  createdAt: string;
  unread?: boolean;
  pinnedNow?: boolean;
}
interface HomeLayout {
  layout?: { hidden?: string[] };
  available?: { key: string; label: string }[];
}

/** 담당자 아이콘의 퍼플 — cd 토큰에 없는 색이라 웹 `--cd-av-2` 와 같은 값을 직접 쓴다. */
const AV_PURPLE = { light: '#7a6bb8', dark: '#b0a2e0' };

const WD = ['일', '월', '화', '수', '목', '금', '토'];

/** ISO → KST "HH:mm" (데스크탑 HomeStats 와 같은 규칙). */
function hhmm(dt?: string | null): string | null {
  if (!dt) return null;
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return null;
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`;
}

/** 오늘(KST) 일정만. */
function todayOnly(list: Activity[]): Activity[] {
  const key = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  return list.filter((a) => {
    if (!a.scheduledAt) return false;
    const d = new Date(a.scheduledAt);
    if (Number.isNaN(d.getTime())) return false;
    return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10) === key;
  });
}

/**
 * 홈 — 모바일 홈 개편 핸드오프(확정안 2a "소프트 플랫").
 *
 * 구성: 헤더(인사말) → 날씨 위젯 → KPI 6종(데스크탑 HomeStats 와 같은 소스) → 빠른 실행
 *       → 경과 미입력 → 사용자 위젯 → 최근 공지.
 * 색은 앱 cd 토큰에 매핑하고(다크 대응) 간격·타이포·라운드는 핸드오프 수치를 따른다.
 * 위젯 표시 여부는 웹과 같은 설정(`/api/home/layout` 의 available·hidden)을 따르되
 * 배치·크기 편집은 하지 않는다(작은 화면에서 자유 배치는 득보다 실이 크다).
 */
export default function HomeScreen() {
  const { user } = useAuth();
  const { c, dark } = useTheme();
  const router = useRouter();
  const badges = useNavBadges();

  const upcoming = useApi<{ activities: Activity[] }>('/api/sales/upcoming-activities', { cache: true });
  const pending = useApi<{ reports: PendingReport[] }>('/api/sales/pending-reports', { cache: true });
  const board = useApi<{ posts: BoardPost[] }>('/api/board?scope=company', { cache: true });
  const home = useApi<HomeLayout>('/api/home/layout', { cache: true });
  const inbox = useApi<{ items: { milestoneId: string }[] }>('/api/home/invoice-requests/inbox', { cache: true });
  const workPlan = useApi<{ rebound?: { count: number }; thisWeek?: { count: number } }>('/api/home/work-plan-todo', {
    cache: true,
  });

  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef({ upcoming, pending, board, home, inbox, workPlan, badges });
  latest.current = { upcoming, pending, board, home, inbox, workPlan, badges };

  const reloadAll = useCallback(async () => {
    setRefreshing(true);
    const l = latest.current;
    await Promise.all([
      l.upcoming.reload(),
      l.pending.reload(),
      l.board.reload(),
      l.home.reload(),
      l.inbox.reload(),
      l.workPlan.reload(),
    ]);
    l.badges.reload();
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      const l = latest.current;
      l.badges.reload();
      void l.board.reload();
      void l.upcoming.reload();
      void l.pending.reload();
    }, [])
  );

  const activities = upcoming.data?.activities ?? [];
  const today = useMemo(() => todayOnly(activities), [activities]);
  const firstAt = useMemo(
    () =>
      today
        .map((a) => hhmm(a.scheduledAt))
        .filter((v): v is string => !!v)
        .sort()[0],
    [today]
  );
  const reports = pending.data?.reports ?? [];
  const pendingCount = reports.reduce((s, r) => s + (r.activities?.length ?? 0), 0);
  const posts = board.data?.posts ?? [];
  const inboxCount = inbox.data?.items?.length ?? null;
  const rebound = workPlan.data?.rebound?.count ?? 0;
  const workTodo = workPlan.data ? rebound + (workPlan.data.thisWeek?.count ?? 0) : null;

  /** 권한(available)과 사용자 설정(hidden)을 통과한 위젯만, 고정 순서로.
   *  경과 미입력은 전용 카드가 대신하므로 위젯 목록에서 뺀다(중복 방지). */
  const widgetKeys = useMemo(() => {
    const allowed = new Set((home.data?.available ?? []).map((a) => a.key));
    const hidden = new Set(home.data?.layout?.hidden ?? []);
    return MOBILE_WIDGET_ORDER.filter(
      (k) =>
        k !== 'pendingProgress' &&
        (allowed.size === 0 || allowed.has(k)) &&
        !hidden.has(k) &&
        HOME_WIDGET_NODES[k]
    );
  }, [home.data]);

  const now = new Date();
  const dateStr = `${now.getMonth() + 1}월 ${now.getDate()}일 ${WD[now.getDay()]}요일`;

  // KPI 6종 — 데스크탑 HomeStats 와 같은 항목·소스. 권한이 없어 못 받은 항목은 빠진다.
  const kpis: KpiItem[] = [
    {
      key: 'approval',
      label: '결재 대기',
      value: badges.approvalPending,
      delta: '내 차례',
      tone: c.error,
      onPress: () => router.push('/(tabs)/approval'),
    },
    {
      key: 'mail',
      label: '안읽은 메일',
      value: badges.mailUnread,
      delta: '확인 필요',
      tone: c.primary,
      onPress: () => router.push('/(tabs)/mail'),
    },
    {
      key: 'schedule',
      label: '오늘 일정',
      value: today.length,
      delta: firstAt ? `${firstAt} 시작` : '확인 필요',
      tone: c.success,
      onPress: () => router.push('/schedule'),
    },
    {
      key: 'progress',
      label: '경과 미입력',
      value: pendingCount,
      delta: '확인 필요',
      tone: c.warning,
      onPress: () => router.push('/schedule'),
    },
    ...(inboxCount == null
      ? []
      : [
          {
            key: 'invoice',
            label: '발행 요청',
            value: inboxCount,
            delta: '확인 필요',
            tone: c.secondary,
          } as KpiItem,
        ]),
    ...(workTodo == null
      ? []
      : [
          {
            key: 'workPlan',
            label: '업무보고',
            value: workTodo,
            delta: rebound > 0 ? `재작성 ${rebound}건` : '확인 필요',
            tone: c.error,
          } as KpiItem,
        ]),
  ];

  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: c.bg }} className="flex-1 bg-cd-bg">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reloadAll} tintColor={c.faint} />}>
        {/* 헤더 — 인사말 + 알림·아바타 */}
        <View className="flex-row items-center justify-between px-[22px] pb-4 pt-3">
          <View className="flex-1">
            <Text numberOfLines={1} className="text-[21px] font-bold tracking-tight text-cd-text">
              {user?.name ?? '사용자'}님, 안녕하세요
            </Text>
            <Text className="mt-[3px] text-[12px] text-cd-faint">{dateStr}</Text>
          </View>
          <View className="flex-row items-center gap-2.5 pl-2">
            <Pressable
              onPress={() => router.push('/notifications')}
              hitSlop={8}
              className="h-[38px] w-[38px] items-center justify-center rounded-full border border-cd-border bg-cd-card active:opacity-70">
              <Ionicons name="notifications-outline" size={19} color={c.body} />
            </Pressable>
            <Avatar name={user?.name} size="md" />
          </View>
        </View>

        <View className="gap-3.5 px-[18px]">
          <WeatherWidget />

          {/* KPI 6종 — 3열 그리드 */}
          <View className="gap-2">
            {chunk(kpis, 3).map((row, i) => (
              <View key={i} className="flex-row gap-2">
                {row.map(({ key, ...rest }) => (
                  <Kpi key={key} {...rest} />
                ))}
                {row.length < 3
                  ? Array.from({ length: 3 - row.length }, (_, j) => <View key={`f${j}`} className="flex-1" />)
                  : null}
              </View>
            ))}
          </View>

          {/* 빠른 실행 — 탭에 없는 기능으로 1탭 진입 */}
          <Section title="빠른 실행">
            <View className="mt-3.5 flex-row justify-between">
              <Quick icon="camera-outline" label="명함" tone={c.primary} onPress={() => router.push('/card')} />
              <Quick icon="paper-plane-outline" label="휴가" tone={c.success} onPress={() => router.push('/leave')} />
              <Quick icon="calendar-outline" label="일정" tone={c.warning} onPress={() => router.push('/schedule')} />
              <Quick
                icon="business-outline"
                label="사업장"
                tone={c.secondary}
                onPress={() => router.push('/facilities')}
              />
              <Quick
                icon="people-outline"
                label="담당자"
                tone={dark ? AV_PURPLE.dark : AV_PURPLE.light}
                onPress={() => router.push('/contacts')}
              />
            </View>
          </Section>

          {/* 경과 미입력 — 건수만이 아니라 어떤 건인지 보여준다 */}
          {pendingCount > 0 ? (
            <Section
              title="경과 미입력"
              badge={pendingCount}
              action={{ label: '경과 입력', onPress: () => router.push('/schedule') }}>
              <View className="mt-3 gap-2">
                {reports.slice(0, 3).map((r) => (
                  <Pressable
                    key={r.projectId}
                    onPress={() => router.push('/schedule')}
                    className="flex-row items-center gap-3 rounded-xl border border-cd-border bg-cd-surface p-3 active:opacity-70">
                    <View className="w-[3px] self-stretch rounded-sm bg-cd-warning" />
                    <View className="flex-1">
                      <Text numberOfLines={1} className="text-[13px] font-semibold text-cd-text">
                        {r.title}
                      </Text>
                      {r.facilityName ? (
                        <Text numberOfLines={1} className="mt-[2px] text-[11.5px] text-cd-faint">
                          {r.facilityName}
                        </Text>
                      ) : null}
                    </View>
                    <CountBadge label={`${r.activities?.length ?? 0}건`} />
                  </Pressable>
                ))}
              </View>
            </Section>
          ) : null}

          {/* 위젯 — 각 카드는 데이터가 없으면 스스로 렌더를 생략한다 */}
          {widgetKeys.map((k) => {
            const Node = HOME_WIDGET_NODES[k];
            return <Node key={k} />;
          })}

          {/* 최근 공지 */}
          <Section title="최근 공지" action={{ label: '전체보기', onPress: () => router.push('/(tabs)/collab') }}>
            {board.loading && !posts.length ? (
              <View className="mt-2">
                <SkeletonList count={2} />
              </View>
            ) : posts.length === 0 ? (
              <Text className="py-3 text-[13px] text-cd-faint">등록된 공지가 없습니다.</Text>
            ) : (
              <View className="mt-1">
                {posts.slice(0, 3).map((p, i) => (
                  <Pressable
                    key={p.postId}
                    onPress={() => router.push({ pathname: '/board/[postId]', params: { postId: p.postId } })}
                    className={`flex-row items-center gap-2.5 py-3 active:opacity-60 ${
                      i === 0 ? '' : 'border-t border-cd-grid-line'
                    }`}>
                    <View className="flex-1">
                      <Text
                        numberOfLines={1}
                        className={`text-[13px] ${p.unread ? 'font-extrabold text-cd-text' : 'font-semibold text-cd-body'}`}>
                        {p.title}
                      </Text>
                      <Text numberOfLines={1} className="mt-[2px] text-[11.5px] text-cd-faint">
                        {p.authorName ?? '-'} · {fmtDate(p.createdAt)}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={c.faint} />
                  </Pressable>
                ))}
              </View>
            )}
          </Section>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** N개씩 끊기 — KPI 3열 그리드용. */
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

interface KpiItem {
  key: string;
  label: string;
  value: number;
  /** 값이 1 이상일 때 붙는 상태 문구. 0 이면 회색 "없음". */
  delta: string;
  tone: string;
  onPress?: () => void;
}

function Kpi({ label, value, delta, tone, onPress }: Omit<KpiItem, 'key'>) {
  const { c } = useTheme();
  const on = value > 0;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      className="flex-1 rounded-2xl border border-cd-border bg-cd-card py-3 pl-[13px] pr-2 active:opacity-70">
      <Text numberOfLines={1} className="text-[11px] text-cd-muted">
        {label}
      </Text>
      <Text className="mt-[5px] text-[22px] font-extrabold leading-none text-cd-text">{value}</Text>
      <Text
        numberOfLines={1}
        className={`mt-1 text-[10px] ${on ? 'font-bold' : ''}`}
        style={{ color: on ? tone : c.faint }}>
        {on ? delta : '없음'}
      </Text>
    </Pressable>
  );
}

/** 카드 프레임 — 핸드오프의 흰 카드(라운드 16·테두리 1px). */
function Section({
  title,
  badge,
  action,
  children,
}: {
  title: string;
  badge?: number;
  action?: { label: string; onPress: () => void };
  children: ReactNode;
}) {
  return (
    <View className="rounded-2xl border border-cd-border bg-cd-card p-4">
      <View className="flex-row items-center">
        <Text className="text-[14px] font-bold text-cd-text">{title}</Text>
        {badge ? (
          <View className="ml-[7px]">
            <CountBadge label={`${badge}`} />
          </View>
        ) : null}
        <View className="flex-1" />
        {action ? (
          <Pressable onPress={action.onPress} hitSlop={8} className="active:opacity-60">
            <Text className="text-[12px] font-semibold text-cd-primary">{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** 경고 톤 카운트 배지(경과 미입력). */
function CountBadge({ label }: { label: string }) {
  return (
    <View className="rounded-full bg-cd-warning-soft px-2 py-[2px]">
      <Text className="text-[11px] font-bold text-cd-warning">{label}</Text>
    </View>
  );
}

/** 빠른 실행 버튼 — 54px 스퀘클 + 옅은 그림자(핸드오프 1b 스타일). */
function Quick({
  icon,
  label,
  tone,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} className="items-center gap-[7px] active:opacity-70">
      <View
        className="h-[54px] w-[54px] items-center justify-center rounded-[19px] border border-cd-border bg-cd-card"
        style={{
          shadowColor: '#3C4696',
          shadowOpacity: 0.12,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 6 },
          elevation: 3,
        }}>
        <Ionicons name={icon} size={23} color={tone} />
      </View>
      <Text className="text-[11px] font-semibold text-cd-body">{label}</Text>
    </Pressable>
  );
}
