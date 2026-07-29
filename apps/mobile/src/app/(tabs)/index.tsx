import { useCallback, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import { Avatar, Badge, Card, Screen, SkeletonList } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth-context';
import { useNavBadges } from '@/lib/use-nav-badges';
import { fmtDate, fmtTime } from '@/lib/format';
import { useTheme } from '@/theme/useTheme';

interface Activity {
  activityId: string;
  projectTitle?: string;
  facilityName?: string;
  scheduledAt?: string;
}
interface BoardPost {
  postId: string;
  title: string;
  authorName?: string | null;
  createdAt: string;
  unread?: boolean;
  pinnedNow?: boolean;
}

/**
 * 홈 — 오늘 처리할 것의 출발점(블루프린트 §7.1).
 * 요약 타일 4 + 빠른 실행 + 최근 공지 + 다가오는 일정.
 * 위젯별 API 를 병렬로 부르고 있고, 전용 집계 API(/api/mobile/home)는 M6 에 붙인다.
 */
export default function HomeScreen() {
  const { user } = useAuth();
  const { c } = useTheme();
  const router = useRouter();
  const badges = useNavBadges();

  const upcoming = useApi<{ activities: Activity[] }>('/api/sales/upcoming-activities', {
    cache: true,
  });
  const pending = useApi<{ reports: unknown[] }>('/api/sales/pending-reports', { cache: true });
  const board = useApi<{ posts: BoardPost[] }>('/api/board?scope=company', { cache: true });

  const [refreshing, setRefreshing] = useState(false);

  // 훅 반환 객체는 매 렌더 새로 만들어지므로 의존성에 넣지 않는다(재생성 루프 방지).
  // 대신 ref 로 최신 참조를 들고 있는다(첫 렌더의 낡은 클로저를 잡지 않도록).
  const latest = useRef({ upcoming, pending, board, badges });
  latest.current = { upcoming, pending, board, badges };

  const reloadAll = useCallback(async () => {
    setRefreshing(true);
    const { upcoming: u, pending: p, board: b, badges: n } = latest.current;
    await Promise.all([u.reload(), p.reload(), b.reload()]);
    n.reload();
    setRefreshing(false);
  }, []);

  // 홈으로 돌아올 때마다 위젯을 새로 읽는다.
  // 뱃지만 갱신하면 캐시된 공지·일정이 그대로 남아 새 글이 보이지 않는다(실측).
  // 캐시가 즉시 렌더되므로 재요청 중에도 화면이 비지 않는다.
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
  const posts = board.data?.posts ?? [];

  return (
    <Screen scroll refreshing={refreshing} onRefresh={reloadAll}>
      {/* 사용자 카드 */}
      <View className="flex-row items-center gap-3 rounded-card border border-cd-border bg-cd-card p-4">
        <Avatar name={user?.name} size="lg" />
        <View className="flex-1">
          <Text className="text-[17px] font-extrabold text-cd-text">{user?.name ?? '사용자'}</Text>
          <Text className="text-[12px] text-cd-faint">{user?.email ?? ''}</Text>
        </View>
      </View>

      {/* 요약 타일 4 */}
      <View className="flex-row gap-3">
        <Tile
          label="미결재"
          value={badges.approvalPending}
          icon="checkbox-outline"
          onPress={() => router.push('/(tabs)/approval')}
        />
        <Tile
          label="안읽은 메일"
          value={badges.mailUnread}
          icon="mail-outline"
          onPress={() => router.push('/(tabs)/mail')}
        />
      </View>
      <View className="flex-row gap-3">
        <Tile
          label="다가오는 일정"
          value={activities.length}
          icon="calendar-outline"
          onPress={() => router.push('/schedule')}
        />
        <Tile
          label="미입력 경과"
          value={pending.data?.reports?.length ?? 0}
          icon="create-outline"
          onPress={() => router.push('/schedule')}
        />
      </View>

      {/* 빠른 실행 — 영업 화면이 탭에서 내려갔으므로 여기서 1탭 진입을 보장한다(§5.2). */}
      <Card title="빠른 실행">
        <View className="flex-row gap-1">
          <Quick icon="camera" label="명함" onPress={() => router.push('/card')} />
          <Quick icon="airplane" label="휴가" onPress={() => router.push('/leave')} />
          <Quick icon="calendar" label="일정" onPress={() => router.push('/schedule')} />
          <Quick icon="business" label="사업장" onPress={() => router.push('/facilities')} />
          <Quick icon="people" label="담당자" onPress={() => router.push('/contacts')} />
        </View>
      </Card>

      {/* 최근 공지 */}
      <Card title="최근 공지">
        {board.loading ? (
          <SkeletonList count={2} />
        ) : posts.length === 0 ? (
          <Text className="py-3 text-[13px] text-cd-faint">등록된 공지가 없습니다.</Text>
        ) : (
          <View className="gap-2">
            {posts.slice(0, 3).map((p, i) => (
              <Pressable
                key={p.postId}
                onPress={() => router.push(`/board/${p.postId}`)}
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

      {/* 다가오는 일정 요약 */}
      {activities.length > 0 ? (
        <Card title="다가오는 일정" onPress={() => router.push('/schedule')}>
          <View className="gap-2">
            {activities.slice(0, 3).map((a, i) => (
              <View
                key={a.activityId}
                className={i === 0 ? '' : 'border-t border-cd-border pt-2'}>
                <Text numberOfLines={1} className="text-[14px] font-bold text-cd-text">
                  {a.facilityName ?? a.projectTitle ?? '일정'}
                </Text>
                <Text className="text-[11px] text-cd-faint">
                  {fmtDate(a.scheduledAt)} {fmtTime(a.scheduledAt)}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

function Tile({
  label,
  value,
  icon,
  onPress,
}: {
  label: string;
  value: number | null;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 rounded-card border border-cd-border bg-cd-card p-4 active:opacity-70">
      <View className="flex-row items-center justify-between">
        <Text className="text-[26px] font-extrabold text-cd-primary">{value ?? '–'}</Text>
        <Ionicons name={icon} size={20} color={c.faint} />
      </View>
      <Text className="mt-1 text-[12px] text-cd-muted">{label}</Text>
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
