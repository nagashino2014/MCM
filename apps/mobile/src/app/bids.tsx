import { useMemo, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Badge, EmptyState, Screen, SegmentedTabs, SkeletonList, useToast } from '@/components/ui';
import type { SegmentItem } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

interface BidMatch {
  noticeId: string;
  bidType: string;
  bidId: string;
  categoryName: string | null;
  title: string | null;
  orgName: string | null;
  budget: number | null;
  postedAt: string | null;
  deadline: string | null;
  url: string | null;
  matchedAt: string | null;
}

type Tab = 'recent' | 'deadline';

const SEGMENTS: SegmentItem<Tab>[] = [
  { key: 'recent', label: '최근 매칭' },
  { key: 'deadline', label: '마감 임박' },
];
const TYPE_LABEL: Record<string, string> = {
  order_plan: '발주계획',
  prior_spec: '사전규격',
  bid_notice: '입찰공고',
};

const money = (n?: number | null) =>
  n && n > 0 ? `${Math.round(n / 10000).toLocaleString('ko-KR')}만원` : '';

/** 마감까지 남은 일수. 마감이 없거나 형식이 다르면 null. */
function dday(deadline: string | null, today: string): number | null {
  if (!deadline) return null;
  const d = deadline.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const ms = Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.round(ms / 86400000);
}

/**
 * 공공입찰 매칭 공고(M6-C) — 푸시 알림의 착지 화면.
 *
 * 앱에서 입찰을 편집·관리하지는 않는다. "알림으로 온 그 공고가 뭔지" 확인하고
 * 원문(나라장터 등)으로 넘어가는 것까지가 범위다. 상세 화면 대신 원문 링크를 연다.
 */
export default function BidsScreen() {
  const { c } = useTheme();
  const toast = useToast();
  const params = useLocalSearchParams<{ filter?: string }>();
  const [tab, setTab] = useState<Tab>(params.filter === 'deadline' ? 'deadline' : 'recent');

  const list = useApi<{ items: BidMatch[]; today: string }>(
    `/api/sales/bids/matches?limit=60${tab === 'deadline' ? '&filter=deadline' : ''}`,
    { cache: true }
  );

  const items = list.data?.items ?? [];
  const today = list.data?.today ?? new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const loading = list.loading && !list.data;

  const open = async (url: string | null) => {
    if (!url) {
      toast.show('원문 링크가 없는 공고입니다.', 'info');
      return;
    }
    const ok = await Linking.canOpenURL(url).catch(() => false);
    if (!ok) {
      toast.show('링크를 열 수 없습니다.', 'error');
      return;
    }
    await Linking.openURL(url);
  };

  const body = useMemo(() => {
    if (loading) return <SkeletonList count={4} />;
    // 영업 조회 권한이 없는 계정은 403 — "공고가 없다"로 보이면 오해하므로 사유를 밝힌다.
    if (list.error && !items.length) {
      return (
        <EmptyState
          icon="lock-closed-outline"
          title="열람 권한이 없습니다"
          description="공공입찰 조회 권한이 필요합니다. 관리자에게 문의해 주세요."
        />
      );
    }
    if (!items.length) {
      return (
        <EmptyState
          icon="briefcase-outline"
          title={tab === 'deadline' ? '마감이 남은 공고가 없습니다' : '매칭된 공고가 없습니다'}
        />
      );
    }
    return items.map((b) => {
      const d = dday(b.deadline, today);
      const urgent = d != null && d <= 3;
      return (
        <Pressable
          key={b.noticeId}
          onPress={() => open(b.url)}
          className="rounded-card border border-cd-border bg-cd-card p-4 active:opacity-70">
          <View className="flex-row items-center gap-2">
            <Badge label={TYPE_LABEL[b.bidType] ?? b.bidType} tone="primary" />
            {b.categoryName ? (
              <Text className="flex-1 text-[11px] text-cd-muted" numberOfLines={1}>
                {b.categoryName}
              </Text>
            ) : (
              <View className="flex-1" />
            )}
            {d != null ? (
              <Text
                className="text-[11px] font-extrabold"
                style={{ color: urgent ? c.error : c.faint }}>
                {d === 0 ? '오늘 마감' : `D-${d}`}
              </Text>
            ) : null}
          </View>

          <Text className="mt-2 text-[15px] font-bold text-cd-text" numberOfLines={2}>
            {b.title || '(제목 없음)'}
          </Text>

          <View className="mt-1 flex-row items-center gap-2">
            <Text className="flex-1 text-[12px] text-cd-muted" numberOfLines={1}>
              {b.orgName ?? '-'}
            </Text>
            {money(b.budget) ? (
              <Text className="text-[12px] text-cd-muted">{money(b.budget)}</Text>
            ) : null}
          </View>

          <View className="mt-2 flex-row items-center gap-1 border-t border-cd-border pt-2">
            <Text className="flex-1 text-[11px] text-cd-faint">
              {b.deadline ? `마감 ${b.deadline.slice(0, 10)}` : '마감 미정'}
            </Text>
            {b.url ? (
              <>
                <Text className="text-[11px] font-bold" style={{ color: c.primary }}>
                  원문 열기
                </Text>
                <Ionicons name="open-outline" size={13} color={c.primary} />
              </>
            ) : null}
          </View>
        </Pressable>
      );
    });
  }, [items, loading, list.error, tab, today, c]);

  return (
    <Screen scroll padded={false} refreshing={list.refreshing} onRefresh={list.reload}>
      <SegmentedTabs items={SEGMENTS} value={tab} onChange={setTab} />
      <View className="gap-3 p-4 pt-1">{body}</View>
    </Screen>
  );
}
