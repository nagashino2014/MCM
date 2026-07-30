import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  Badge,
  EmptyState,
  Screen,
  SegmentedTabs,
  SkeletonList,
  StaleBanner,
  type SegmentItem,
} from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { useNavBadges } from '@/lib/use-nav-badges';
import { useTheme } from '@/theme/useTheme';

export interface DocSummary {
  docId: string;
  docNo: string | null;
  formName: string;
  title: string;
  urgent: boolean;
  status: string;
  drafterName: string | null;
  submittedAt: string | null;
  updatedAt: string;
  aiSummary?: { lines: string[]; figures: { label: string; value: string }[] } | null;
}

type Box = 'pending' | 'upcoming' | 'mine';

/** 웹 ApprovalDocModal 의 라벨과 같은 값을 쓴다(용어가 갈리면 사용자가 혼란스럽다). */
export const DOC_STATUS_LABEL: Record<string, string> = {
  draft: '작성 중',
  in_progress: '진행 중',
  approved: '승인',
  rejected: '반려',
  canceled: '취소',
};

/** "2026-07-28T14:03:00Z" → "07/28 14:03" */
function shortDateTime(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 결재함(M2) — 대기/예정/내 기안. 상세·승인반려는 /approval/[docId].
export default function ApprovalScreen() {
  const router = useRouter();
  const badges = useNavBadges();
  const [box, setBox] = useState<Box>('pending');

  // '내 기안'은 진행 중 문서를 본다(작성 중 초안은 웹에서 이어 쓰는 편이 낫다).
  const path = `/api/approval/docs?box=${box === 'mine' ? 'in_progress' : box}`;
  const { data, loading, refreshing, error, staleAt, reload } = useApi<{ docs: DocSummary[] }>(
    path,
    { cache: true }
  );

  // 결재 처리 후 돌아오면 목록·뱃지를 새로 읽는다.
  useFocusEffect(
    useCallback(() => {
      reload();
      badges.reload();
      // 훅 반환 객체는 매 렌더 새로 만들어지므로 의존성에서 제외한다.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path])
  );

  const items = useMemo<SegmentItem<Box>[]>(
    () => [
      { key: 'pending', label: '결재 대기', count: badges.approvalPending },
      { key: 'upcoming', label: '예정' },
      { key: 'mine', label: '내 기안' },
    ],
    [badges.approvalPending]
  );

  const docs = data?.docs ?? [];

  return (
    <Screen scroll={false} padded={false}>
      <SegmentedTabs items={items} value={box} onChange={setBox} />

      {loading && !docs.length ? (
        <View className="p-4">
          <SkeletonList count={3} />
        </View>
      ) : (
        <FlatList
          data={docs}
          keyExtractor={(d) => d.docId}
          contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}
          ListHeaderComponent={
            staleAt ? (
              <View className="pb-3">
                <StaleBanner at={staleAt} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            error ? (
              <EmptyState icon="alert-circle-outline" title="불러오지 못했습니다" description={error} />
            ) : (
              <EmptyState
                icon="checkmark-done-outline"
                title={
                  box === 'pending'
                    ? '결재할 문서가 없습니다'
                    : box === 'upcoming'
                      ? '예정된 결재가 없습니다'
                      : '진행 중인 기안이 없습니다'
                }
              />
            )
          }
          renderItem={({ item }) => (
            <DocCard doc={item} onPress={() => router.push({ pathname: '/approval/[docId]', params: { docId: item.docId } })} />
          )}
        />
      )}
    </Screen>
  );
}

function DocCard({ doc, onPress }: { doc: DocSummary; onPress: () => void }) {
  const { c } = useTheme();
  const lines = doc.aiSummary?.lines ?? [];

  return (
    <Pressable
      onPress={onPress}
      className="gap-1.5 rounded-card border border-cd-border bg-cd-card p-4 active:opacity-70">
      <View className="flex-row items-center gap-1.5">
        {doc.urgent ? <Badge label="긴급" tone="error" /> : null}
        <Badge label={doc.formName} tone="primary" />
        <View className="flex-1" />
        <Text
          className="text-[11px] font-bold"
          style={{
            color:
              doc.status === 'approved'
                ? c.success
                : doc.status === 'rejected'
                  ? c.error
                  : c.faint,
          }}>
          {DOC_STATUS_LABEL[doc.status] ?? doc.status}
        </Text>
      </View>

      <Text numberOfLines={2} className="text-[15px] font-bold leading-5 text-cd-text">
        {doc.title}
      </Text>
      <Text className="text-[12px] text-cd-faint">
        {doc.drafterName ?? '-'} · {shortDateTime(doc.submittedAt ?? doc.updatedAt)}
        {doc.docNo ? ` · ${doc.docNo}` : ''}
      </Text>

      {lines.length > 0 ? (
        <View className="mt-1 gap-0.5 rounded-xl bg-cd-primary-soft px-3 py-2">
          <Text className="text-[10px] font-extrabold tracking-wide text-cd-primary">AI 요약</Text>
          {lines.slice(0, 3).map((l, i) => (
            <Text key={i} className="text-[12px] leading-4 text-cd-text">
              · {l}
            </Text>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}
