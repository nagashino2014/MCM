import { useMemo, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Badge, EmptyState, Screen, SegmentedTabs, SkeletonList, useToast } from '@/components/ui';
import type { SegmentItem } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

/** 발송 항목 구성(웹 알림 설정) 그대로 내려오는 상세 항목 — 값이 있는 것만 담겨 온다. */
interface MatchDetail {
  label: string;
  value: string;
  /** 원문 링크 항목 — 상세 카드 맨 아래 버튼으로 렌더한다. */
  link?: boolean;
}

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
  details?: MatchDetail[];
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
 * 앱에서 입찰을 편집·관리하지는 않는다. "알림으로 온 그 공고가 뭔지" 확인하는 것이 범위다.
 * 카드를 누르면 별도 화면으로 가지 않고 아래에 상세 카드를 펼친다(발송 항목 구성 그대로),
 * 원문(나라장터)으로는 그 카드 맨 아래 링크로 넘어간다.
 */
export default function BidsScreen() {
  const { c } = useTheme();
  const toast = useToast();
  const params = useLocalSearchParams<{ filter?: string }>();
  const [tab, setTab] = useState<Tab>(params.filter === 'deadline' ? 'deadline' : 'recent');
  /** 펼쳐 둔 카드(noticeId) — 여러 건 동시에 펼칠 수 있다. */
  const [expanded, setExpanded] = useState<string[]>([]);
  const toggle = (noticeId: string) =>
    setExpanded((prev) =>
      prev.includes(noticeId) ? prev.filter((x) => x !== noticeId) : [...prev, noticeId]
    );

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
      const isOpen = expanded.includes(b.noticeId);
      const details = b.details ?? [];
      const rows = details.filter((x) => !x.link);
      // 원문은 상세 항목 안의 링크를 우선 쓰고, 없으면 목록의 url 로 대체한다.
      const linkItem = details.find((x) => x.link);
      const linkUrl = linkItem?.value ?? b.url;

      return (
        <Pressable
          key={b.noticeId}
          onPress={() => toggle(b.noticeId)}
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
            <Text className="text-[11px] font-bold" style={{ color: c.primary }}>
              {isOpen ? '접기' : '상세 보기'}
            </Text>
            <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={13} color={c.primary} />
          </View>

          {/* 상세 카드 — 알림 발송 항목 구성 그대로(값이 있는 항목만), 맨 아래에 원문 링크 */}
          {isOpen ? (
            <View className="mt-3 rounded-card border border-cd-border bg-cd-bg p-3">
              {rows.length ? (
                rows.map((f) => (
                  <View key={f.label} className="flex-row gap-2 py-1">
                    <Text className="w-[104px] text-[11px] text-cd-faint">{f.label}</Text>
                    <Text className="flex-1 text-[12px] text-cd-text">{f.value}</Text>
                  </View>
                ))
              ) : (
                <Text className="py-1 text-[12px] text-cd-muted">표시할 상세 정보가 없습니다.</Text>
              )}
              {linkUrl ? (
                <Pressable
                  onPress={() => open(linkUrl)}
                  className="mt-2 flex-row items-center justify-center gap-1 rounded-card border border-cd-border py-2 active:opacity-70">
                  <Text className="text-[12px] font-bold" style={{ color: c.primary }}>
                    원문 열기
                  </Text>
                  <Ionicons name="open-outline" size={14} color={c.primary} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </Pressable>
      );
    });
  }, [items, loading, list.error, tab, today, c, expanded]);

  return (
    <Screen scroll padded={false} refreshing={list.refreshing} onRefresh={list.reload}>
      <SegmentedTabs items={SEGMENTS} value={tab} onChange={setTab} />
      <View className="gap-3 p-4 pt-1">{body}</View>
    </Screen>
  );
}
