import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import { Avatar, Badge, Card, Screen, SkeletonList } from '@/components/ui';
import { HOME_WIDGET_NODES, MOBILE_WIDGET_ORDER } from '@/components/home/widgets';
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
 * 홈(M6) — 데스크탑 홈 개편(Soft Glass Ink)에 맞춰 재구성.
 *
 * 구성은 데스크탑과 같은 뼈대다: 스탯 4 → 빠른 실행 → 위젯 → 공지·일정.
 * 위젯 표시 여부는 **웹과 같은 설정을 따른다** — `/api/home/layout` 의 available(권한)과
 * hidden(사용자가 웹 편집 모드에서 끈 카드). 다만 배치·크기 편집은 모바일에서 하지 않고
 * 중요도 고정 순서로 보여준다(작은 화면에서 자유 배치는 득보다 실이 크다).
 */
export default function HomeScreen() {
  const { user } = useAuth();
  const { c } = useTheme();
  const router = useRouter();
  const badges = useNavBadges();

  const upcoming = useApi<{ activities: Activity[] }>('/api/sales/upcoming-activities', {
    cache: true,
  });
  const pending = useApi<{ reports: { activities?: unknown[] }[] }>('/api/sales/pending-reports', {
    cache: true,
  });
  const board = useApi<{ posts: BoardPost[] }>('/api/board?scope=company', { cache: true });
  const home = useApi<HomeLayout>('/api/home/layout', { cache: true });

  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef({ upcoming, pending, board, home, badges });
  latest.current = { upcoming, pending, board, home, badges };

  const reloadAll = useCallback(async () => {
    setRefreshing(true);
    const { upcoming: u, pending: p, board: b, home: h, badges: n } = latest.current;
    await Promise.all([u.reload(), p.reload(), b.reload(), h.reload()]);
    n.reload();
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      const { upcoming: u, pending: p, board: b, badges: n } = latest.current;
      n.reload();
      void b.reload();
      void u.reload();
      void p.reload();
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
  const pendingCount = (pending.data?.reports ?? []).reduce(
    (s, r) => s + (r.activities?.length ?? 0),
    0
  );
  const posts = board.data?.posts ?? [];

  /** 권한(available)과 사용자 설정(hidden)을 통과한 위젯만, 고정 순서로. */
  const widgetKeys = useMemo(() => {
    const allowed = new Set((home.data?.available ?? []).map((a) => a.key));
    const hidden = new Set(home.data?.layout?.hidden ?? []);
    return MOBILE_WIDGET_ORDER.filter(
      (k) => (allowed.size === 0 || allowed.has(k)) && !hidden.has(k) && HOME_WIDGET_NODES[k]
    );
  }, [home.data]);

  return (
    <Screen scroll refreshing={refreshing} onRefresh={reloadAll}>
      <View className="flex-row items-center gap-3 rounded-card border border-cd-border bg-cd-card p-4">
        <Avatar name={user?.name} size="lg" />
        <View className="flex-1">
          <Text className="text-[17px] font-extrabold text-cd-text">{user?.name ?? '사용자'}</Text>
          <Text className="text-[12px] text-cd-faint">{user?.email ?? ''}</Text>
        </View>
      </View>

      {/* 스탯 4 — 데스크탑 HomeStats 와 같은 지표·델타 문구 */}
      <View className="flex-row gap-3">
        <Stat
          label="결재 대기"
          value={badges.approvalPending}
          delta={badges.approvalPending > 0 ? '내 차례' : null}
          tone={c.error}
          onPress={() => router.push('/(tabs)/approval')}
        />
        <Stat
          label="안읽은 메일"
          value={badges.mailUnread}
          delta={badges.mailUnread > 0 ? '확인 필요' : null}
          tone={c.primary}
          onPress={() => router.push('/(tabs)/mail')}
        />
      </View>
      <View className="flex-row gap-3">
        <Stat
          label="오늘 일정"
          value={today.length}
          delta={firstAt ? `${firstAt} 시작` : null}
          tone={c.secondary}
          onPress={() => router.push('/schedule')}
        />
        <Stat
          label="경과 미입력"
          value={pendingCount}
          delta={pendingCount > 0 ? '확인 필요' : null}
          tone={c.warning}
          onPress={() => router.push('/schedule')}
        />
      </View>

      {/* 빠른 실행 — 탭에 없는 기능으로 1탭 진입 */}
      <Card title="빠른 실행">
        <View className="flex-row gap-1">
          <Quick icon="camera" label="명함" onPress={() => router.push('/card')} />
          <Quick icon="airplane" label="휴가" onPress={() => router.push('/leave')} />
          <Quick icon="calendar" label="일정" onPress={() => router.push('/schedule')} />
          <Quick icon="business" label="사업장" onPress={() => router.push('/facilities')} />
          <Quick icon="people" label="담당자" onPress={() => router.push('/contacts')} />
        </View>
      </Card>

      {/* 위젯 — 각 카드는 데이터가 없으면 스스로 렌더를 생략한다 */}
      {widgetKeys.map((k) => {
        const Node = HOME_WIDGET_NODES[k];
        return <Node key={k} />;
      })}

      {/* 최근 공지 */}
      <Card title="최근 공지">
        {board.loading && !posts.length ? (
          <SkeletonList count={2} />
        ) : posts.length === 0 ? (
          <Text className="py-3 text-[13px] text-cd-faint">등록된 공지가 없습니다.</Text>
        ) : (
          <View className="gap-2">
            {posts.slice(0, 3).map((p, i) => (
              <Pressable
                key={p.postId}
                onPress={() => router.push({ pathname: '/board/[postId]', params: { postId: p.postId } })}
                className={`active:opacity-60 ${i === 0 ? '' : 'border-t border-cd-border pt-2'}`}>
                <View className="flex-row items-center gap-1.5">
                  {p.pinnedNow ? <Badge label="고정" tone="primary" /> : null}
                  <Text
                    numberOfLines={1}
                    className={`flex-1 text-[14px] ${
                      p.unread ? 'font-extrabold text-cd-text' : 'text-cd-muted'
                    }`}>
                    {p.title}
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={c.faint} />
                </View>
                <Text className="text-[11px] text-cd-faint">
                  {p.authorName ?? '-'} · {fmtDate(p.createdAt)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </Card>
    </Screen>
  );
}

function Stat({
  label,
  value,
  delta,
  tone,
  onPress,
}: {
  label: string;
  value: number;
  delta?: string | null;
  tone: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 gap-1 rounded-card border border-cd-border bg-cd-card p-4 active:opacity-70">
      <Text className="text-[11.5px] font-bold text-cd-muted">{label}</Text>
      <View className="flex-row items-baseline gap-1.5">
        <Text className="text-[25px] font-extrabold text-cd-text">{value}</Text>
        {delta ? (
          <Text style={{ color: tone }} className="text-[11.5px] font-bold">
            {delta}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function Quick({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} className="flex-1 items-center gap-1.5 active:opacity-70">
      <View className="h-12 w-12 items-center justify-center rounded-2xl bg-cd-primary-soft">
        <Ionicons name={icon} size={22} color={c.primary} />
      </View>
      <Text className="text-[11px] font-bold text-cd-muted">{label}</Text>
    </Pressable>
  );
}
