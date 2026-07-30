import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Badge, Button, Card, EmptyState, Screen, SkeletonList } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

interface LeaveSummary {
  granted: number;
  used: number;
  remaining: number;
}
interface LeaveNotice {
  noticeId: string;
  round: number;
  title?: string | null;
  sentAt?: string | null;
  submittedAt?: string | null;
}
interface DocSummary {
  docId: string;
  title: string;
  status: string;
  submittedAt: string | null;
  updatedAt: string;
  formName: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: '작성 중',
  in_progress: '결재 중',
  approved: '승인',
  rejected: '반려',
  canceled: '취소',
};

const day = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}일`;

/** 내 휴가 — 잔여 연차·신청 이력·촉진 고지. 신청은 /leave/request(결재 상신). */
export default function LeaveScreen() {
  const router = useRouter();
  const { c } = useTheme();
  const year = String(new Date().getFullYear());

  const balance = useApi<{ summary: LeaveSummary | null }>(`/api/approval/leave?me=1&year=${year}`, {
    cache: true,
  });
  const notices = useApi<{ notices: LeaveNotice[] }>('/api/home/leave-notices', { cache: true });
  // 내가 올린 휴가 관련 기안(진행 중 + 완료)을 함께 본다.
  const mine = useApi<{ docs: DocSummary[] }>('/api/approval/docs?box=in_progress');
  const done = useApi<{ docs: DocSummary[] }>('/api/approval/docs?box=completed');

  const [refreshing, setRefreshing] = useState(false);
  const reloadAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([balance.reload(), notices.reload(), mine.reload(), done.reload()]);
    setRefreshing(false);
    // 훅 반환 객체는 매 렌더 새로 만들어진다 — 의존성에서 제외.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reloadAll();
    }, [reloadAll])
  );

  const leaveDocs = useMemo(() => {
    const all = [...(mine.data?.docs ?? []), ...(done.data?.docs ?? [])];
    return all
      .filter((d) => d.formName?.includes('휴가') || d.title?.includes('휴가'))
      .sort((a, b) => (b.submittedAt ?? b.updatedAt).localeCompare(a.submittedAt ?? a.updatedAt))
      .slice(0, 10);
  }, [mine.data, done.data]);

  const s = balance.data?.summary;
  const pendingNotices = (notices.data?.notices ?? []).filter((n) => !n.submittedAt);

  return (
    <Screen scroll refreshing={refreshing} onRefresh={reloadAll}>
      {/* 잔여 연차 */}
      {balance.loading && !s ? (
        <SkeletonList count={1} />
      ) : (
        <Card title={`${year}년 연차`}>
          {s ? (
            <View className="flex-row items-end gap-2">
              <Text className="text-[34px] font-extrabold leading-9 text-cd-primary">
                {Number.isInteger(s.remaining) ? s.remaining : s.remaining.toFixed(1)}
              </Text>
              <Text className="pb-1.5 text-[14px] text-cd-muted">일 남음</Text>
              <View className="flex-1" />
              <View className="items-end">
                <Text className="text-[12px] text-cd-faint">발생 {day(s.granted)}</Text>
                <Text className="text-[12px] text-cd-faint">사용 {day(s.used)}</Text>
              </View>
            </View>
          ) : (
            <Text className="py-2 text-[13px] text-cd-faint">
              연차 정보가 없습니다(직원 정보 연결이 필요합니다).
            </Text>
          )}
          <View className="mt-3">
            <Button
              label="휴가 신청"
              icon="calendar-outline"
              onPress={() => router.push('/leave/request')}
              full
            />
          </View>
        </Card>
      )}

      {/* 연차 촉진 고지 — 서명 대기가 있으면 눈에 띄게 */}
      {pendingNotices.length > 0 ? (
        <Card title="연차 사용 촉진 고지">
          <View className="gap-2">
            {pendingNotices.map((n) => (
              <View key={n.noticeId} className="gap-1 rounded-xl bg-cd-warning-soft px-3 py-2.5">
                <View className="flex-row items-center gap-1.5">
                  <Ionicons name="alert-circle" size={14} color={c.warning} />
                  <Text className="flex-1 text-[13px] font-bold text-cd-warning">
                    {n.round}차 고지 — 회신이 필요합니다
                  </Text>
                </View>
                <Text className="text-[12px] text-cd-muted">
                  회신은 웹에서 전자서명으로 진행합니다.
                </Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {/* 휴가 신청 이력 */}
      <Card title="내 휴가 신청">
        {leaveDocs.length === 0 ? (
          <Text className="py-3 text-[13px] text-cd-faint">최근 신청 내역이 없습니다.</Text>
        ) : (
          <View className="gap-2">
            {leaveDocs.map((d, i) => (
              <Pressable
                key={d.docId}
                onPress={() => router.push({ pathname: '/approval/[docId]', params: { docId: d.docId } })}
                className={`gap-0.5 active:opacity-70 ${i === 0 ? '' : 'border-t border-cd-border pt-2'}`}>
                <View className="flex-row items-center gap-1.5">
                  <Text numberOfLines={1} className="flex-1 text-[14px] font-bold text-cd-text">
                    {d.title}
                  </Text>
                  <Badge
                    label={STATUS_LABEL[d.status] ?? d.status}
                    tone={
                      d.status === 'approved'
                        ? 'success'
                        : d.status === 'rejected'
                          ? 'error'
                          : 'neutral'
                    }
                  />
                </View>
                <Text className="text-[11px] text-cd-faint">
                  {(d.submittedAt ?? d.updatedAt).slice(0, 10)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </Card>

      <Pressable
        onPress={() => router.push('/attendance')}
        className="flex-row items-center gap-2 rounded-card border border-cd-border bg-cd-card p-4 active:opacity-70">
        <Ionicons name="time-outline" size={20} color={c.primary} />
        <Text className="flex-1 text-[15px] font-bold text-cd-text">내 근태 보기</Text>
        <Ionicons name="chevron-forward" size={16} color={c.faint} />
      </Pressable>

      {balance.error && !s ? (
        <EmptyState icon="alert-circle-outline" title="불러오지 못했습니다" description={balance.error} />
      ) : null}
    </Screen>
  );
}
