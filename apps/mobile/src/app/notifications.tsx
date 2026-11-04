import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Button, EmptyState, IconButton, Screen, SkeletonList } from '@/components/ui';
import { routeForLink } from '@/lib/deeplink';
import { apiJson } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { fmtIsoShort } from '@/lib/todo-utils';
import { useTheme } from '@/theme/useTheme';
import { SHADOW_CARD } from '@/theme/tokens';

/**
 * 알림 — 내게 발송된 푸시 알림 내역(2026-11-04 사용자 요청: 벨을 누르면 설정이 아니라 **받은 알림**이 보여야 한다).
 * 데이터 /api/mobile/push/log(mobile_push_log 의 발송 성공분, 최신순 50건 + 더 보기). 행을 누르면 알림의 딥링크(/approval/xxx 등)로 간다.
 * 알림 설정(이벤트별 수신·방해금지)은 헤더 우측 톱니 → /notification-settings.
 */
interface PushLogItem {
  pushId: string;
  eventKey: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
}
interface LogRes {
  items: PushLogItem[];
  total: number;
  limit: number;
  offset: number;
}

const PAGE = 50;

/** 이벤트 종류별 아이콘 — event_key 접두(approval·board·mail·chat·todo…)로 대략 나눈다. 모르면 종. */
function iconFor(eventKey: string): keyof typeof Ionicons.glyphMap {
  const k = eventKey.toLowerCase();
  if (k.startsWith('approval')) return 'clipboard-outline';
  if (k.startsWith('board') || k.startsWith('notice')) return 'megaphone-outline';
  if (k.startsWith('mail')) return 'mail-outline';
  if (k.startsWith('chat')) return 'chatbubble-outline';
  if (k.startsWith('todo')) return 'checkmark-done-outline';
  if (k.startsWith('bid')) return 'briefcase-outline';
  if (k.startsWith('leave') || k.startsWith('attendance')) return 'calendar-outline';
  return 'notifications-outline';
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { c, dark } = useTheme();
  const first = useApi<LogRes>(`/api/mobile/push/log?limit=${PAGE}&offset=0`, { cache: true });
  // 더 보기 — 첫 쪽은 useApi(캐시·당겨서 새로고침), 다음 쪽부터는 수동으로 이어 붙인다.
  const [more, setMore] = useState<PushLogItem[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const items = [...(first.data?.items ?? []), ...more];
  const total = first.data?.total ?? 0;
  const hasMore = items.length < total;

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const d = await apiJson<LogRes>(`/api/mobile/push/log?limit=${PAGE}&offset=${items.length}`);
      setMore((p) => [...p, ...d.items]);
    } finally {
      setLoadingMore(false);
    }
  };

  const open = (it: PushLogItem) => {
    const href = routeForLink(it.link);
    if (href) router.push(href);
  };

  return (
    <Screen
      title="알림"
      subtitle={total ? `${total}건` : undefined}
      back
      refreshing={first.refreshing}
      onRefresh={() => {
        setMore([]);
        return first.reload();
      }}
      right={<IconButton icon="settings-outline" color={c.text} onPress={() => router.push('/notification-settings')} />}>
      {first.loading && !first.data ? (
        <SkeletonList count={4} />
      ) : items.length === 0 ? (
        <EmptyState icon="notifications-off-outline" title="받은 알림이 없습니다" description="결재·공지·메일 등 알림이 오면 여기에 쌓입니다." />
      ) : (
        <View className="gap-2">
          {items.map((it) => {
            const href = routeForLink(it.link);
            return (
              <Pressable
                key={it.pushId}
                onPress={href ? () => open(it) : undefined}
                disabled={!href}
                accessibilityRole={href ? 'button' : undefined}
                style={[{ borderColor: c.cardBorder }, dark ? SHADOW_CARD.dark : SHADOW_CARD.light]}
                className="flex-row items-start gap-3 rounded-lg border bg-cd-card px-4 py-3 active:opacity-80">
                <Ionicons name={iconFor(it.eventKey)} size={20} color={c.muted} style={{ marginTop: 1 }} />
                <View className="flex-1" style={{ minWidth: 0 }}>
                  <Text numberOfLines={2} className="text-[15px] font-medium leading-[22px] text-cd-text">
                    {it.title || '(제목 없음)'}
                  </Text>
                  {it.body ? (
                    <Text numberOfLines={2} className="mt-0.5 text-[13px] leading-[20px] text-cd-muted">
                      {it.body}
                    </Text>
                  ) : null}
                  <Text className="mt-1 text-[12px] text-cd-faint">{fmtIsoShort(it.createdAt)}</Text>
                </View>
                {href ? <Ionicons name="chevron-forward" size={16} color={c.faint} style={{ marginTop: 3 }} /> : null}
              </Pressable>
            );
          })}
          {hasMore ? <Button label={`더 보기 (${total - items.length}건 남음)`} variant="ghost" loading={loadingMore} onPress={() => void loadMore()} full /> : null}
        </View>
      )}
    </Screen>
  );
}
