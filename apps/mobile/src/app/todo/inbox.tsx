import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { EmptyState, PullRefresh, Screen, SkeletonList, useToast } from '@/components/ui';
import { apiJson } from '@/lib/api';
import { routeForLink } from '@/lib/deeplink';
import { fmtRelative } from '@/lib/todo-utils';
import { useTheme } from '@/theme/useTheme';

// 할 일 알림함(277, docs/todo-kanban-blueprint.md §9 2차) — 배정·댓글·완료/검토·리마인드·아침 요약이 사람별로 쌓인다.
// 웹 탑바 알림함(TodoNotifyBell)과 같은 데이터(/api/todo/notifications). 행을 누르면 읽음 처리 후 해당 할 일로 간다.

interface Notif {
  notifId: string;
  event: string;
  title: string;
  body: string | null;
  link: string | null;
  itemId: string | null;
  readAt: string | null;
  createdAt: string;
}

const EVENT_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  'todo.assigned': 'person-add-outline',
  'todo.comment': 'chatbubble-ellipses-outline',
  'todo.status': 'checkmark-circle-outline',
  'todo.digest': 'sunny-outline',
  'todo.remind': 'time-outline',
  'todo.weekly': 'calendar-outline',
};

export default function TodoInboxScreen() {
  const { c } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState<Notif[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const r = await apiJson<{ items: Notif[]; unread: number }>('/api/todo/notifications?limit=50');
      setItems(r.items ?? []);
      setUnread(Number(r.unread) || 0);
    } catch {
      setItems((prev) => prev ?? []);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      void load(true);
    }, [load])
  );

  const markRead = async (ids: string[] | 'all') => {
    const now = new Date().toISOString();
    setItems((prev) => (prev ?? []).map((n) => (ids === 'all' || ids.includes(n.notifId) ? { ...n, readAt: n.readAt ?? now } : n)));
    setUnread((prev) => (ids === 'all' ? 0 : Math.max(0, prev - ids.length)));
    try {
      await apiJson('/api/todo/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids === 'all' ? { all: true } : { ids }),
      });
    } catch {
      toast.show('읽음 처리에 실패했습니다.', 'error');
      void load(true);
    }
  };

  const open = (n: Notif) => {
    if (!n.readAt) void markRead([n.notifId]);
    const href = routeForLink(n.link) ?? '/todo';
    router.push(href);
  };

  return (
    <Screen
      title="할 일 알림"
      back
      scroll={false}
      padded={false}
      right={
        <Pressable
          onPress={() => void markRead('all')}
          disabled={unread === 0}
          accessibilityLabel="모두 읽음"
          hitSlop={8}
          className="mr-2 h-9 flex-row items-center gap-1 rounded-lg px-2 active:opacity-70"
          style={{ opacity: unread === 0 ? 0.4 : 1 }}>
          <Ionicons name="checkmark-done-outline" size={17} color={c.primary} />
          <Text className="text-[13px] font-semibold text-cd-primary">모두 읽음</Text>
        </Pressable>
      }>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<PullRefresh refreshing={refreshing} onRefresh={() => void load()} tintColor={c.faint} />}>
        {items === null ? (
          <View className="p-4">
            <SkeletonList />
          </View>
        ) : items.length === 0 ? (
          <View className="p-4">
            <EmptyState icon="notifications-off-outline" title="알림이 없습니다" description="배정·댓글·완료·리마인드가 여기에 쌓입니다." />
          </View>
        ) : (
          items.map((n) => {
            const isUnread = !n.readAt;
            return (
              <Pressable
                key={n.notifId}
                onPress={() => open(n)}
                accessibilityRole="button"
                accessibilityLabel={`${isUnread ? '읽지 않음 · ' : ''}${n.title}`}
                className="flex-row items-start gap-3 border-b border-cd-border px-4 py-3 active:bg-cd-surface"
                style={isUnread ? { backgroundColor: c.primarySoft } : undefined}>
                <View className="mt-0.5 h-8 w-8 items-center justify-center rounded-lg bg-cd-surface">
                  <Ionicons name={EVENT_ICON[n.event] ?? 'notifications-outline'} size={17} color={isUnread ? c.primary : c.muted} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className={`text-[14px] text-cd-text ${isUnread ? 'font-bold' : 'font-medium'}`}>
                    {n.title}
                  </Text>
                  {n.body ? (
                    <Text numberOfLines={2} className="mt-0.5 text-[12.5px] text-cd-muted">
                      {n.body}
                    </Text>
                  ) : null}
                  <Text className="mt-1 text-[11px] text-cd-faint">{fmtRelative(n.createdAt)}</Text>
                </View>
                {isUnread ? <View className="mt-2 h-2 w-2 rounded-full" style={{ backgroundColor: c.primary }} /> : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}
